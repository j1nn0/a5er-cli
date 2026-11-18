/**
 * Stage 6-C Unit 1 — source-derived provenance for the golden envelopes (`architecture.md` §13,
 * `test-strategy.md` §3.6, §14 stage 6).
 *
 * **What this file is.** A regression fence, not a defect fix. Every golden already reconciles, but
 * `lines.total` and the five-way line partition had exactly one witness: the golden itself, written
 * by the same hand that read the model. This file supplies the second witness by counting the
 * fixture's own bytes with `tests/helpers/source-counts.ts` — a reader that imports nothing from
 * `src/` — and comparing the ten facts a source can decide (Stage 6-C Unit 3 also derives the key split):
 *
 *     sections.total, sections.parsed, sections.preservedRaw, sections.unknown,
 *     keys.total, keys.parsed, keys.preservedRaw, lines.total, lines.accounted, lines.dropped
 *
 * `keys.parsed` / `keys.preservedRaw` are decided by a lookup of the key text in the per-section key tables
 * (`tests/helpers/key-tables.ts`, transcribed from the registry's key lists, never the registry code path),
 * so a source-only reader derives that split without becoming a second parser. See `keySplit`.
 *
 * **What it deliberately does not do.** It never edits a golden, a fixture or the catalog, never
 * runs the pipeline, and never asks the serializer what a count should be. The two `failed`
 * fixtures (`enc-04`, `hst-02`) have `completeness: null` and are excluded from every count — a
 * fabricated zero count would be a worse lie than no count. The catalog's `0/0` for those rows is a
 * registry convention for "no counts", not a measurement.
 *
 * **Why a second reader instead of `tests/helpers/fixture-text.ts`.** Its `lines` is
 * `text.split(/\r\n|\n|\r/)`, which yields one extra entry whenever the text ends with a
 * terminator — that is every synthetic fixture — so it cannot supply a physical line count. It is
 * used there only as a span upper bound, where the `+1` is harmless. The guard below pins that this
 * file and its helper never fall back to it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { DerivableCompleteness, FixtureCodec } from './helpers/source-counts.js';
import { compareCounts, countSource, decodeBytes, keySplit } from './helpers/source-counts.js';

const SYNTHETIC_DIR = fileURLToPath(new URL('./fixtures/synthetic/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/json-goldens/', import.meta.url));
const HELPERS_DIR = fileURLToPath(new URL('./helpers/', import.meta.url));

/** `completeness` as the envelope carries it; `keys.parsed`/`preservedRaw` are read but not judged. */
interface Completeness extends DerivableCompleteness {
  readonly keys: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
  };
}
/** Just enough of a golden to audit its counts without importing the envelope's types. */
interface Golden {
  readonly status: string;
  readonly completeness: Completeness | null;
}

/** The committed bytes of the three byte fixtures that decode, with the codec their module declares. */
const BYTE_SOURCES: Readonly<
  Record<string, { readonly bytes: Uint8Array; readonly codec: FixtureCodec }>
> = {
  'enc-03': { bytes: enc03.BYTES, codec: enc03.ENCODING },
  'enc-05': { bytes: enc05.BYTES, codec: enc05.ENCODING },
  'hst-05': { bytes: hst05.BYTES, codec: hst05.ENCODING },
};

/** Every golden on disk, by id, in a stable order. */
const GOLDEN_IDS: readonly string[] = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.expected.json'))
  .map((name) => name.replace('.expected.json', ''))
  .sort();

function specOf(id: string): FixtureSpec {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`golden ${id} has no catalog entry`);
  return spec;
}

function readGolden(id: string): Golden {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, `${id}.expected.json`), 'utf8')) as Golden;
}

/** The fixture's bytes and the codec its class uses, or `null` when nothing decodes them. */
function sourceOf(
  spec: FixtureSpec,
): { readonly bytes: Uint8Array; readonly codec: FixtureCodec } | null {
  if (spec.fixtureClass === 'synthetic') {
    // Read as bytes, not as a string: the UTF-8 decoder strips a BOM, `readFileSync` does not, and
    // a BOM left in the text would turn the first comment line into a raw line.
    return { bytes: readFileSync(join(SYNTHETIC_DIR, spec.file)), codec: 'utf-8' };
  }
  if (spec.fixtureClass === 'bytes') return BYTE_SOURCES[spec.id] ?? null;
  return null;
}

/** The decoded text of one fixture, decoded strictly in its own codec. */
function textOf(id: string): string {
  const spec = specOf(id);
  const source = sourceOf(spec);
  if (source === null) throw new Error(`${id} has no decodable source`);
  return decodeBytes(source.bytes, source.codec);
}

/** The field name a mismatch message is about (`<id>: <field> source=… envelope=…`). */
function fieldOf(message: string): string {
  const afterLabel = message.slice(message.indexOf(': ') + 2);
  return afterLabel.slice(0, afterLabel.indexOf(' '));
}

describe('json source counts — every golden reconciles against its own bytes (stage 6-C unit 1)', () => {
  it('covers exactly the 44 committed goldens, each with a catalog entry', () => {
    expect(GOLDEN_IDS).toHaveLength(44);
    const committed = FIXTURES.filter(
      (spec) => spec.fixtureClass === 'synthetic' || spec.fixtureClass === 'bytes',
    ).map((spec) => spec.id);
    expect([...GOLDEN_IDS]).toEqual([...committed].sort());
  });
  it('derives all ten countable facts for the 42 count-bearing goldens (no mismatch)', () => {
    const mismatches: string[] = [];
    let counted = 0;
    let fatal = 0;
    for (const id of GOLDEN_IDS) {
      const spec = specOf(id);
      const golden = readGolden(id);
      // The fatal arm is the only one without counts, and it must have no decodable source: a
      // zero count there would be an invented measurement (§14 row 11, §12 rule 1).
      const expectCounts = spec.expectation.status !== 'failed';
      expect(golden.completeness === null, `${id}: completeness null iff catalog failed`).toBe(
        !expectCounts,
      );
      if (!expectCounts) {
        fatal += 1;
        expect(golden.status, id).toBe('failed');
        expect(sourceOf(spec), `${id}: a failed fixture must not be countable`).toBeNull();
        continue;
      }
      counted += 1;
      const completeness = golden.completeness;
      if (completeness === null) throw new Error(`${id} lost its completeness`);
      // The catalog's own counts are a third witness for the two partitions it carries.
      expect(completeness.sections.total, id).toBe(spec.expectation.counts.sections.total);
      expect(completeness.sections.parsed, id).toBe(spec.expectation.counts.sections.parsed);
      expect(completeness.sections.preservedRaw, id).toBe(
        spec.expectation.counts.sections.preservedRaw,
      );
      expect(completeness.keys.total, id).toBe(spec.expectation.counts.keys.total);
      // The catalog's key split is the third witness beside the golden and the derivation: three
      // independent numbers must agree, and the two below used to be "not derivable".
      expect(completeness.keys.parsed, id).toBe(spec.expectation.counts.keys.parsed);
      expect(completeness.keys.preservedRaw, id).toBe(spec.expectation.counts.keys.preservedRaw);
      mismatches.push(...compareCounts(countSource(textOf(id)), completeness, id));
    }
    // One message per mismatched field, so a failure names every wrong number at once.
    expect(mismatches).toEqual([]);
    expect(counted).toBe(42);
    expect(fatal).toBe(2);
  });
  it('derives the key split from the section-scoped tables (only three fixtures preserve)', () => {
    const preserving: { id: string; parsed: number; preserved: number; reasons: string[] }[] = [];
    let parsed = 0;
    let preserved = 0;
    for (const id of GOLDEN_IDS) {
      const spec = specOf(id);
      if (spec.expectation.status === 'failed') continue;
      const split = keySplit(countSource(textOf(id)));
      parsed += split.parsed;
      preserved += split.preservedRaw;
      // The partition closes on every fixture: a key is parsed or preserved, never both or neither.
      expect(split.parsed + split.preservedRaw, id).toBe(countSource(textOf(id)).keys);
      if (split.preservedRaw > 0) {
        preserving.push({
          id,
          parsed: split.parsed,
          preserved: split.preservedRaw,
          reasons: split.preserved.map(
            (entry) => `${String(entry.line)}:${entry.reason}:${entry.key}`,
          ),
        });
      }
    }
    expect(parsed + preserved).toBeGreaterThan(300);
    // Exactly three fixtures preserve a key, and each does so for a documented reason.
    expect(preserving).toEqual([
      {
        id: 'hst-04',
        parsed: 4,
        preserved: 2,
        // Two keys inside unknown sections: `[<script>]` (l.11) and `[[Entity]]` (l.14).
        reasons: ['12:unknown-section:alert', '15:unknown-section:PName'],
      },
      {
        id: 'txt-04',
        parsed: 3,
        preserved: 3,
        // Two keys a *known* section does not register, and one key of an unknown section.
        reasons: [
          '5:no-registry-entry:MysteryKey',
          '6:no-registry-entry:SecondMystery',
          '10:unknown-section:Note',
        ],
      },
      {
        id: 'txt-07',
        parsed: 4,
        preserved: 3,
        // `[entity]` is a different header from `[Entity]`: three keys are preserved, and
        // `PageInfo` above it (in `[Manager]`) is parsed.
        reasons: [
          '12:unknown-section:PName',
          '13:unknown-section:Field',
          '14:unknown-section:Position',
        ],
      },
    ]);
  });
  it('decodes legacy keys as parsed, and never as preserved text (§13)', () => {
    // `fmt-02` declares `FORMAT:19` and writes `Index=`/`Page=`; `sem-04` writes a legacy `Index=`
    // under `FORMAT:21`. Both are decoded, so both splits are `parsed` with nothing preserved —
    // which is the concrete proof of the rule, not an absence of evidence.
    for (const id of ['fmt-02', 'sem-04']) {
      const split = keySplit(countSource(textOf(id)));
      expect(split.preserved, id).toEqual([]);
      expect(split.preservedRaw, id).toBe(0);
      const keys = countSource(textOf(id))
        .records.filter((record) => record.kind === 'key')
        .map((record) => record.key);
      expect(keys, id).toContain('Index');
      expect(split.parsed, id).toBe(keys.length);
    }
  });
  it('preserves a header-region key and a padded key, which no fixture exercises', () => {
    // A key before the first header belongs to no section, so it is evidence, not data
    // (`registry.ts:570-580`). No fixture has one; this is the only place the rule is pinned.
    const headerRegion = countSource('Alpha=1\n[Beta]\nGamma=2\n');
    expect(headerRegion.records.map((record) => record.kind)).toEqual(['key', 'header', 'key']);
    expect(keySplit(headerRegion)).toEqual({
      parsed: 0,
      preservedRaw: 2,
      preserved: [
        { line: 1, key: 'Alpha', reason: 'header-region' },
        // `[Beta]` is not one of the nine names, so its key is preserved too — two reasons in one
        // document, which is what makes this test worth having.
        { line: 3, key: 'Gamma', reason: 'unknown-section' },
      ],
    });
    // … and with a modelled section, the header-region key is the only preserved one.
    const knownSection = countSource('Alpha=1\n[Entity]\nPName="e"\n');
    expect(keySplit(knownSection)).toEqual({
      parsed: 1,
      preservedRaw: 1,
      preserved: [{ line: 1, key: 'Alpha', reason: 'header-region' }],
    });

    // The lookup is exact and case-sensitive, so padding makes a key unknown rather than close:
    // ` Name` is not `Name`, and `PName ` is not `PName` (§5, `registry.ts:288-297`).
    const padded = countSource('[Entity]\n PName="a"\nPName ="b"\nPName="c"\n');
    expect(
      padded.records.filter((record) => record.kind === 'key').map((record) => record.key),
    ).toEqual([' PName', 'PName ', 'PName']);
    expect(keySplit(padded)).toEqual({
      parsed: 1,
      preservedRaw: 2,
      preserved: [
        { line: 2, key: ' PName', reason: 'no-registry-entry' },
        { line: 3, key: 'PName ', reason: 'no-registry-entry' },
      ],
    });
    // A different case is a different key, in a known section as well.
    const lowercase = countSource('[Entity]\npname="a"\n');
    expect(keySplit(lowercase).preserved[0]?.reason).toBe('no-registry-entry');
  });
  it("pins the ambiguous source lines, so the reader cannot drift into the parser's reading", () => {
    // Two lines in the whole fixture set are genuinely ambiguous, and both are checked by hand.
    const hostile = countSource(textOf('hst-04'));
    // `[Entity]x`: bracket-led with a trailing character, so not a header; no `=`, so a raw line.
    expect(
      hostile.records.filter((record) => record.kind === 'raw').map((record) => record.line),
    ).toEqual([17]);
    expect(hostile.records[16]?.text).toBe('[Entity]x');
    expect(hostile.records[16]?.kind).toBe('raw');
    // The 4098-character header: the "name" is everything between the greedy outer brackets.
    const longHeader = hostile.records.find(
      (record) => record.kind === 'header' && record.line === 19,
    );
    expect(longHeader?.text.length).toBe(4098);
    expect(longHeader?.headerName?.length).toBe(4096);
    expect(longHeader?.recognisedHeader).toBe(false);
    // Five headers, two of them modelled (`[Manager]` l.3, `[Entity]` l.6) and three not
    // (`[<script>]` l.11, `[[Entity]]` l.14 whose name is `[Entity]`, and the 4098-character one).
    expect(
      hostile.records.filter((record) => record.kind === 'header').map((record) => record.line),
    ).toEqual([3, 6, 11, 14, 19]);
    expect(
      hostile.records
        .filter((record) => record.kind === 'header' && !record.recognisedHeader)
        .map((record) => record.line),
    ).toEqual([11, 14, 19]);
    expect(hostile.recognised).toBe(2);
    expect(hostile.unknown).toBe(3);

    // The `Query` continuation: no `=`, so a raw line rather than a key.
    const continuation = countSource(textOf('val-08'));
    expect(
      continuation.records.filter((record) => record.kind === 'raw').map((record) => record.line),
    ).toEqual([9]);
    expect(continuation.records[8]?.text).toBe('FROM users WHERE id > 0"');

    // Mixed endings with no empty line at all: the only fixture with zero blank lines.
    const mixed = countSource(textOf('hst-05'));
    expect(mixed.blank).toBe(0);
    expect(mixed.comments).toBe(1);
    expect(mixed.lines).toBe(mixed.accounted);

    // A header keeps the whitespace it was written with; the name is what trimming leaves.
    const spaced = countSource(textOf('txt-08'));
    expect(spaced.records[5]?.kind).toBe('header');
    expect(spaced.records[5]?.text).toBe('  [Entity] ');
    expect(spaced.records[5]?.headerName).toBe('Entity');
    expect(spaced.records[5]?.recognisedHeader).toBe(true);

    // Names are case-sensitive (§10.4 defines no case rule): `[entity]` is an unknown header.
    const lowercase = countSource(textOf('txt-07'));
    expect(lowercase.records[10]?.kind).toBe('header');
    expect(lowercase.records[10]?.recognisedHeader).toBe(false);
    expect(lowercase.unknown).toBe(1);
  });
  it('counts physical lines by §4.1, so a trailing terminator never adds a line (R17)', () => {
    // The one rule `String.prototype.split` gets wrong for this purpose, pinned directly.
    expect(countSource('').lines).toBe(0);
    expect(countSource('a').lines).toBe(1);
    expect(countSource('a\n').lines).toBe(1);
    expect(countSource('a\n\n').lines).toBe(2);
    expect(countSource('a\r\nb\rc').lines).toBe(3);
    expect(countSource('a\r\n').lines).toBe(1);
    // A line that begins with `=` has no key name, so it is raw rather than a key.
    expect(countSource('=x').keys).toBe(0);
    expect(countSource('=x').raw).toBe(1);
    expect(countSource('k=v').keys).toBe(1);
    expect(countSource('k=v').records[0]?.key).toBe('k');
    // A header wins over the key rule even when an `=` appears inside the name.
    expect(countSource('[a=b]').records[0]?.kind).toBe('header');
  });
  it('flags a corrupted count or a phantom line instead of trusting the golden', () => {
    const id = 'fmt-01';
    const completeness = readGolden(id).completeness;
    if (completeness === null) throw new Error(`${id} lost its completeness`);
    const text = textOf(id);
    // The clean case: the source and the golden agree, so the guard is silent.
    expect(compareCounts(countSource(text), completeness, id)).toEqual([]);

    // Corrupt the *source*: one appended terminator is the classic phantom line, and the very
    // defect no existing test can see (`accounted` and `total` would move together).
    const phantom = compareCounts(countSource(`${text}\n`), completeness, id);
    expect(phantom.length).toBeGreaterThan(0);
    expect(phantom.some((message) => message.includes('lines.total'))).toBe(true);

    // Corrupt the *envelope*: every one of the eight fields is judged on its own, so bumping one
    // by one must be reported by name — and must name nothing else.
    const corruptions: readonly {
      readonly field: string;
      readonly corrupt: (c: Completeness) => Completeness;
    }[] = [
      {
        field: 'sections.total',
        corrupt: (c) => ({ ...c, sections: { ...c.sections, total: c.sections.total + 1 } }),
      },
      {
        field: 'sections.parsed',
        corrupt: (c) => ({ ...c, sections: { ...c.sections, parsed: c.sections.parsed + 1 } }),
      },
      {
        field: 'sections.preservedRaw',
        corrupt: (c) => ({
          ...c,
          sections: { ...c.sections, preservedRaw: c.sections.preservedRaw + 1 },
        }),
      },
      {
        field: 'sections.unknown',
        corrupt: (c) => ({ ...c, sections: { ...c.sections, unknown: c.sections.unknown + 1 } }),
      },
      {
        field: 'keys.total',
        corrupt: (c) => ({ ...c, keys: { ...c.keys, total: c.keys.total + 1 } }),
      },
      {
        field: 'lines.total',
        corrupt: (c) => ({ ...c, lines: { ...c.lines, total: c.lines.total + 1 } }),
      },
      {
        field: 'lines.accounted',
        corrupt: (c) => ({ ...c, lines: { ...c.lines, accounted: c.lines.accounted + 1 } }),
      },
      {
        field: 'lines.dropped',
        corrupt: (c) => ({ ...c, lines: { ...c.lines, dropped: 1 } }),
      },
    ];
    expect(corruptions.map((entry) => entry.field)).toHaveLength(8);
    for (const { field, corrupt } of corruptions) {
      expect(
        compareCounts(countSource(text), corrupt(completeness), id).map(fieldOf),
        field,
      ).toEqual([field]);
    }
    // The message carries both numbers, so a reviewer sees what disagreed without opening a file.
    const bumped = corruptions[5]?.corrupt(completeness);
    if (bumped === undefined || corruptions[5] === undefined)
      throw new Error('no lines.total case');
    expect(compareCounts(countSource(text), bumped, id)).toEqual([
      `${id}: lines.total source=${String(completeness.lines.total)} envelope=${String(
        completeness.lines.total + 1,
      )}`,
    ]);
    // And the copy helper is a copy: the golden-derived object is unchanged by all of the above.
    expect(completeness).toEqual(readGolden(id).completeness);
  });
  it('keeps the reader independent: no src/ import, no split-based line count, no pipeline', () => {
    // The guard is about the reader, so it is enforced on the reader and on this file: comments are
    // stripped first, because both discuss the defects they avoid.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const files = [
      join(HELPERS_DIR, 'source-counts.ts'),
      fileURLToPath(new URL('./json-source-counts.test.ts', import.meta.url)),
    ];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // No part of the pipeline: a second implementation must not call the first one.
      expect(code, file).not.toMatch(/from\s+['"][^'"]*src\//);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*fixture-text\.js['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*classified\.js['"]/);
      // And never the split that would import the off-by-one this guard exists to catch.
      expect(code, file).not.toMatch(/\.split\s*\(/);
    }
  });
});
