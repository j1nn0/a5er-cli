/**
 * `syntax/` — the line scanner (`architecture.md` §3, §4.1, §4.4, §6, §7.3, §13).
 *
 * The fixtures decide almost everything here, and each assertion reads a value out of a fixture
 * that contains the construct it claims to test (`docs/test-strategy.md` §7 T1): the header text
 * comes from a padded header, the duplicate key from a file that repeats it, the malformed line
 * from the file whose `Query` really is broken across two lines.
 *
 * What this file does **not** assert: `primaryKey`, resolved columns, effective columns, the
 * envelope, or status. Those are the semantic and JSON stages. The codes checked here are the
 * three the line scan itself can raise; the registry-stage codes (`S_UNKNOWN_KEY`,
 * `S_DUPLICATE_KEY`, …) are asserted *absent*, because raising them without the key registry
 * would be a guess (§5), and the tokeniser's one code is asserted in `syntax-complex.test.ts`.
 *
 * Losslessness is asserted the way §7 T9 defines it: every source line is accounted for, and the
 * scan's line records reconstruct the decoded text exactly — not that the file's bytes match.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { DecodedSource } from '../src/decode/load.js';
import { splitComplex } from '../src/syntax/complex.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { KeyRecord, SectionEntry, SectionScan, SyntaxScan } from '../src/syntax/scanner.js';
import { splitLines } from '../src/syntax/lines.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { SYNTHETIC_DIR, sha256File, stage } from './helpers/stage.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';

/** The fixtures this unit is responsible for (`architecture.md` §18 stage 3, unit 3A). */
const FIXTURE_IDS = [
  'fmt-01',
  'fmt-02',
  'fmt-03',
  'fmt-04',
  'fmt-05',
  'txt-01',
  'txt-02',
  'txt-03',
  'txt-04',
  'txt-05',
  'txt-06',
  'txt-07',
  'txt-08',
  'txt-09',
  'val-01',
  'val-02',
  'val-08',
  'val-10',
  'val-11',
  'hst-04',
  'hst-05',
] as const;

/**
 * Codes the *line scan* may raise.
 *
 * A line scan can decide these three. Everything else in the `S_` family needs the
 * section-scoped key registry (§5), and the fourth code this unit produces
 * (`S_COMPLEX_UNTERMINATED_QUOTE`) belongs to the tokeniser, which is called per Complex-typed
 * key by the registry stage — not swept over every value, because a `String`-typed value (val-08's
 * `Query`) is not a Complex value at all and tokenising it would invent a diagnostic.
 */
const SCAN_CODES: ReadonlySet<string> = new Set([
  'S_HEADER_UNKNOWN_FORMAT',
  'S_UNKNOWN_SECTION',
  'S_MALFORMED_LINE',
]);

/** Codes a later stage owns; asserted absent so a premature guess fails loudly. */
const DEFERRED_CODES = [
  'S_UNKNOWN_KEY',
  'S_LEGACY_KEY',
  'S_DUPLICATE_KEY',
  'S_FIELD_TOO_FEW_ELEMENTS',
  'S_FIELD_TOO_MANY_ELEMENTS',
];

/**
 * The catalog's source paths this stage can answer.
 *
 * Written as one pattern, independently of the branches that match each shape, so the
 * "every catalog fact" test can prove that every fact it claims to answer was answered.
 */
const SCANNER_FACT_PATH =
  /^(?:line\.\d+\.(?:key|value)|section\.\d+\.(?:header|headerLength)|header\.(?:format|absent))$/;

function specOf(id: string): FixtureSpec {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not a registered fixture`);
  return spec;
}

function decodedSource(spec: FixtureSpec): DecodedSource {
  if (spec.fixtureClass === 'bytes') {
    // Byte fixtures are modules, not paths: write them out so the real loader runs.
    const directory = mkdtempSync(join(tmpdir(), 'a5er-syntax-'));
    try {
      const path = join(directory, `${spec.id}.a5er`);
      writeFileSync(path, hst05.BYTES);
      return unwrap(loadSource(path), spec.id);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const staged = stage(spec.id);
  try {
    return unwrap(loadSource(staged.path), spec.id);
  } finally {
    staged.cleanup();
  }
}

function unwrap(outcome: ReturnType<typeof loadSource>, id: string): DecodedSource {
  if (outcome.ok) return outcome.source;
  const codes = outcome.diagnostics.map((diagnostic) => diagnostic.code).join(',');
  throw new Error(`fixture ${id} did not load: ${codes}`);
}

/** Decoded sources, memoised: staging every fixture once per test would be pure overhead. */
const SOURCES = new Map<string, DecodedSource>();

function sourceOf(id: string): DecodedSource {
  const cached = SOURCES.get(id);
  if (cached !== undefined) return cached;
  const source = decodedSource(specOf(id));
  SOURCES.set(id, source);
  return source;
}

const SCANS = new Map<string, SyntaxScan>();

function scanOf(id: string): SyntaxScan {
  const cached = SCANS.get(id);
  if (cached !== undefined) return cached;
  const scan = scanSource(sourceOf(id));
  SCANS.set(id, scan);
  return scan;
}

/** The exact text a scan's line records describe, for the losslessness assertion (T9). */
function renderLines(scan: SyntaxScan): string {
  return scan.lines.map((line) => line.text + line.ending).join('');
}

function keysOf(entries: readonly SectionEntry[]): KeyRecord[] {
  return entries.filter((entry): entry is KeyRecord => entry.kind === 'key');
}

function sectionAt(scan: SyntaxScan, index: number): SectionScan {
  const section = scan.sections[index - 1];
  if (section === undefined) throw new Error(`section ${String(index)} does not exist`);
  return section;
}

/** Every key of the document, in file order. */
function allKeys(scan: SyntaxScan): KeyRecord[] {
  return [...scan.header.keyLines, ...scan.sections.flatMap((section) => keysOf(section.entries))];
}

/** The one key named `key`, failing when it is absent or repeated. */
function onlyKey(scan: SyntaxScan, key: string): KeyRecord {
  const found = allKeys(scan).filter((candidate) => candidate.key === key);
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${key} key, found ${String(found.length)}`);
  }
  const record = found[0];
  if (record === undefined) throw new Error(`missing ${key}`);
  return record;
}

/** The scan's codes, i.e. everything the line scan itself raised. */
function syntaxCodes(scan: SyntaxScan): string[] {
  return scan.diagnostics.map((diagnostic) => diagnostic.code);
}

/** The one key at `line`, failing when there is none. */
function keyAtLine(scan: SyntaxScan, line: number): KeyRecord {
  const found = allKeys(scan).find((key) => key.span.keyLine === line);
  if (found === undefined) throw new Error(`no key at line ${String(line)}`);
  return found;
}

/** The catalog codes the line scan owns. */
function expectedSyntaxCodes(spec: FixtureSpec): string[] {
  return spec.expectation.codes.filter((code) => SCAN_CODES.has(code));
}

// ── line splitting (§4.1, U4) ───────────────────────────────────────────────

describe('splitLines — physical lines and their terminators', () => {
  it('records CRLF, LF and bare CR as three different endings', () => {
    expect(splitLines('a\r\nb\nc\rd')).toEqual([
      { number: 1, text: 'a', ending: '\r\n' },
      { number: 2, text: 'b', ending: '\n' },
      { number: 3, text: 'c', ending: '\r' },
      { number: 4, text: 'd', ending: '' },
    ]);
  });

  it('does not invent a line for a trailing terminator', () => {
    // `wc -l` also reports one line; the newline belongs to the line it closes.
    expect(splitLines('a\n')).toEqual([{ number: 1, text: 'a', ending: '\n' }]);
    expect(splitLines('a\n\n')).toEqual([
      { number: 1, text: 'a', ending: '\n' },
      { number: 2, text: '', ending: '\n' },
    ]);
  });

  it('splits an empty text into no lines at all', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('reconstructs its input character for character', () => {
    const text = '\uFEFF# A5:ER FORMAT:21\r\n[Manager]\rPageInfo=1\n[Entity]';
    expect(
      splitLines(text)
        .map((line) => line.text + line.ending)
        .join(''),
    ).toBe(text);
  });
});

// ── classification (§7.3, §7.4, §10.4) ─────────────────────────────────────

describe('scanSource — one record per line', () => {
  it('classifies a header, a key, a comment, a blank and a raw line', () => {
    const scan = scanSource({
      text: '# header comment\n\n[Entity]\nPName="x"\nbroken line\n',
      format: 21,
    });

    expect(scan.sections).toHaveLength(1);
    expect(scan.comments).toEqual([
      { raw: '# header comment', span: { sectionIndex: 0, startLine: 1, endLine: 1, keyLine: 1 } },
    ]);
    expect(scan.blankLines).toEqual([2]);
    expect(keysOf(scan.sections[0]?.entries ?? [])).toHaveLength(1);
    expect(scan.accounting.lines).toEqual({
      total: 5,
      sectionHeaders: 1,
      keys: 1,
      comments: 1,
      blank: 1,
      raw: 1,
    });
    expect(scan.accounting.dropped).toBe(0);
    assertCodes(syntaxCodes(scan), ['S_MALFORMED_LINE']);
  });

  it('keeps a key line that appears before any header, instead of dropping it', () => {
    const scan = scanSource({ text: 'Stray="1"\n[Manager]\nPageInfo="Main"\n', format: 21 });

    expect(scan.header.keyLines).toHaveLength(1);
    expect(scan.header.keyLines[0]?.span).toEqual({
      sectionIndex: 0,
      startLine: 1,
      endLine: 1,
      keyLine: 1,
    });
    // Nothing is lost: the line partition still reconciles to zero.
    expect(scan.accounting.dropped).toBe(0);
    expect(scan.accounting.keys).toEqual({
      total: 2,
      inRecognisedSections: 1,
      inUnknownSections: 0,
      beforeFirstSection: 1,
    });
  });

  it('reads a header-shaped line with `=` inside as a header, not a key', () => {
    const scan = scanSource({ text: '[Memo=a]\nNote="x"\n', format: 21 });

    expect(scan.sections[0]?.name).toBe('Memo=a');
    expect(scan.sections[0]?.kind).toBe('unknown');
    expect(scan.accounting.keys.total).toBe(1);
  });

  it('treats `#` lines as comments even when they contain `=` and §10.4 syntax', () => {
    const scan = scanSource({
      text: '[Manager]\n# [Entity] not a header = 1\nPageInfo="x"\n',
      format: 21,
    });

    expect(scan.sections).toHaveLength(1);
    expect(scan.comments[0]?.raw).toBe('# [Entity] not a header = 1');
    expect(scan.comments[0]?.span.sectionIndex).toBe(1);
  });

  it('takes a line whose first `=` has an empty key as a raw line', () => {
    const scan = scanSource({ text: '[Manager]\n=1\n', format: 21 });

    expect(scan.sections[0]?.entries).toEqual([
      {
        kind: 'raw-line',
        raw: '=1',
        span: { sectionIndex: 1, startLine: 2, endLine: 2, keyLine: 2 },
      },
    ]);
    assertCodes(syntaxCodes(scan), ['S_MALFORMED_LINE']);
  });

  it('closes the last section at the last line of the file', () => {
    const scan = scanSource({ text: '[Manager]\nPageInfo="x"\n\n', format: 21 });

    expect(scan.sections[0]?.span).toEqual({
      sectionIndex: 1,
      startLine: 1,
      endLine: 3,
      keyLine: 1,
    });
    expect(scan.blankLines).toEqual([3]);
    expect(scan.accounting.dropped).toBe(0);
  });

  it('never emits a registry-stage code', () => {
    // Two unknown keys, a duplicate and a short Field all need the registry (§5), so a line
    // scan must stay silent about them; only the malformed line is its business.
    const scan = scanSource({
      text: '[Entity]\nPName="a"\nPName="b"\nMystery="1"\nField="x",0\n',
      format: 21,
    });

    for (const code of DEFERRED_CODES) {
      expect(syntaxCodes(scan)).not.toContain(code);
    }
  });
});

// ── every fixture: counts, spans, codes, losslessness (§13, §7 T5/T9) ──────

describe('the committed fixtures', () => {
  for (const id of FIXTURE_IDS) {
    describe(`${id} — ${specOf(id).file}`, () => {
      const spec = specOf(id);

      it('reconciles the section and key totals the catalog declares', () => {
        const { sections, keys } = scanOf(id).accounting;
        expect(sections.total, 'sections.total').toBe(spec.expectation.counts.sections.total);
        expect(keys.total, 'keys.total').toBe(spec.expectation.counts.keys.total);
        // The line scan can tell recognised from unknown; the catalog's `preservedRaw` for
        // sections is exactly that split, which is why it can be asserted here.
        expect(sections.unknown, 'sections.preservedRaw').toBe(
          spec.expectation.counts.sections.preservedRaw,
        );
        expect(sections.recognised + sections.unknown).toBe(sections.total);
      });

      it('accounts for every source line and computes a zero remainder', () => {
        const { accounting, lines } = scanOf(id);
        const { sectionHeaders, keys, comments, blank, raw } = accounting.lines;

        expect(sectionHeaders + keys + comments + blank + raw, 'line partition').toBe(lines.length);
        expect(accounting.dropped, 'dropped').toBe(0);
        expect(keys, 'key lines vs key records').toBe(accounting.keys.total);
        expect(
          accounting.keys.inRecognisedSections +
            accounting.keys.inUnknownSections +
            accounting.keys.beforeFirstSection,
        ).toBe(accounting.keys.total);
      });

      it('reconstructs the decoded text from its line records', () => {
        const scan = scanOf(id);
        expect(renderLines(scan)).toBe(sourceOf(id).text);
      });

      it('matches every catalog source fact the scan can answer', () => {
        // The catalog's source paths address the raw document; these five are readable from a
        // scan, so a fixture whose key moved or whose header text changed fails here.
        const scan = scanOf(id);
        const answered: string[] = [];

        for (const fact of spec.expectation.sourceFacts) {
          const lineKey = /^line\.(\d+)\.key$/.exec(fact.path);
          if (lineKey !== null) {
            expect(keyAtLine(scan, Number(lineKey[1])).key, fact.path).toBe(fact.equals);
            answered.push(fact.path);
          }

          const lineValue = /^line\.(\d+)\.value$/.exec(fact.path);
          if (lineValue !== null) {
            expect(keyAtLine(scan, Number(lineValue[1])).value, fact.path).toBe(fact.equals);
            answered.push(fact.path);
          }

          const header = /^section\.(\d+)\.header$/.exec(fact.path);
          if (header !== null) {
            expect(sectionAt(scan, Number(header[1])).headerRaw, fact.path).toBe(fact.equals);
            answered.push(fact.path);
          }

          const headerLength = /^section\.(\d+)\.headerLength$/.exec(fact.path);
          if (headerLength !== null) {
            const section = sectionAt(scan, Number(headerLength[1]));
            expect(section.headerRaw.length, fact.path).toBe(fact.equals);
            answered.push(fact.path);
          }

          if (fact.path === 'header.format') {
            expect(scan.format.declared, fact.path).toBe(fact.equals);
            answered.push(fact.path);
          }
          if (fact.path === 'header.absent') {
            expect(scan.format.declared, fact.path).toBeNull();
            answered.push(fact.path);
          }
        }

        // The two pattern sets are written independently on purpose: a branch that stopped
        // matching would leave a path unanswered and fail here instead of asserting nothing.
        expect(answered).toEqual(
          spec.expectation.sourceFacts
            .map((fact) => fact.path)
            .filter((path) => SCANNER_FACT_PATH.test(path)),
        );
      });

      it('places every catalog span on the record it names', () => {
        const scan = scanOf(id);
        const spans = [
          ...scan.sections.map((section) => section.headerSpan),
          ...allKeys(scan).map((key) => key.span),
        ];

        for (const expected of spec.expectation.spans) {
          const found = spans.filter(
            (span) =>
              span.sectionIndex === expected.sectionIndex && span.keyLine === expected.keyLine,
          );
          expect(found, `span at ${String(expected.keyLine)}`).toEqual([expected]);
        }
      });

      it('reports exactly the codes this stage owns', () => {
        assertCodes(syntaxCodes(scanOf(id)), expectedSyntaxCodes(spec), `${id} syntax codes`);
      });

      it('holds every span inside the document', () => {
        const scan = scanOf(id);
        const lineCount = scan.lines.length;
        const spans = [
          ...scan.sections.map((section) => section.headerSpan),
          ...scan.sections.map((section) => section.span),
          ...allKeys(scan).map((key) => key.span),
          ...scan.comments.map((comment) => comment.span),
        ];

        for (const span of spans) {
          expect(span.startLine).toBeGreaterThanOrEqual(1);
          expect(span.startLine).toBeLessThanOrEqual(span.keyLine);
          expect(span.keyLine).toBeLessThanOrEqual(span.endLine);
          expect(span.endLine).toBeLessThanOrEqual(lineCount);
          expect(span.sectionIndex).toBeGreaterThanOrEqual(0);
          expect(span.sectionIndex).toBeLessThanOrEqual(scan.sections.length);
        }
      });
    });
  }
});

// ── the FORMAT gate (§6) ───────────────────────────────────────────────────

describe('FORMAT classification (§6)', () => {
  it('21 (fmt-01) is known and silent', () => {
    const scan = scanOf('fmt-01');
    expect(scan.format).toEqual({ declared: 21, known: true });
    expect(scan.diagnostics).toEqual([]);
  });

  it('19 (fmt-02) is a known legacy version and silent', () => {
    const scan = scanOf('fmt-02');
    expect(scan.format).toEqual({ declared: 19, known: true });
    expect(scan.diagnostics).toEqual([]);
  });

  it('an absent FORMAT is unknown and warned about, not fatal (fmt-03)', () => {
    const scan = scanOf('fmt-03');
    expect(scan.format).toEqual({ declared: null, known: false });
    assertCodes(
      scan.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_HEADER_UNKNOWN_FORMAT'],
    );
    const [warning] = scan.diagnostics;
    expect(warning?.severity).toBe('warning');
    expect(warning?.details).toEqual({ declared: null });
    expect(warning?.span).toEqual({ sectionIndex: 0, startLine: 1, endLine: 1, keyLine: 1 });
    expect(warning?.construct).toBe('Header');
  });

  it('FORMAT:20 — the hole in the map — is unknown and warned about (fmt-04)', () => {
    const scan = scanOf('fmt-04');
    expect(scan.format).toEqual({ declared: 20, known: false });
    expect(scan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'S_HEADER_UNKNOWN_FORMAT',
    ]);
    expect(scan.diagnostics[0]?.details).toEqual({ declared: 20 });
  });

  it('FORMAT:99 is treated as unknown and warned about (fmt-05)', () => {
    const scan = scanOf('fmt-05');
    expect(scan.format).toEqual({ declared: 99, known: false });
    expect(scan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'S_HEADER_UNKNOWN_FORMAT',
    ]);
  });

  it('keeps the canonical and legacy keys of an unknown FORMAT (fmt-05)', () => {
    // §6: the gate decides interpretation, never acceptance.
    const keys = allKeys(scanOf('fmt-05')).map((key) => key.key);
    expect(keys).toContain('IndexInfo');
    expect(keys).toContain('Page');
  });
});

// ── sections: order, raw text, aliases, case (§4.4, §5) ───────────────────

describe('sections', () => {
  it('keeps every header in file order with its verbatim text (fmt-01)', () => {
    const scan = scanOf('fmt-01');
    expect(scan.sections.map((section) => section.headerRaw)).toEqual([
      '[Manager]',
      '[Entity]',
      '[Entity]',
      '[Relation]',
      '[View]',
    ]);
    expect(scan.sections.map((section) => section.kind)).toEqual([
      'Manager',
      'Entity',
      'Entity',
      'Relation',
      'View',
    ]);
  });

  it('numbers sections 1-based and points their header span at the header line', () => {
    const scan = scanOf('fmt-01');
    expect(scan.sections.map((section) => section.headerSpan)).toEqual([
      { sectionIndex: 1, startLine: 4, endLine: 4, keyLine: 4 },
      { sectionIndex: 2, startLine: 7, endLine: 7, keyLine: 7 },
      { sectionIndex: 3, startLine: 16, endLine: 16, keyLine: 16 },
      { sectionIndex: 4, startLine: 23, endLine: 23, keyLine: 23 },
      { sectionIndex: 5, startLine: 34, endLine: 34, keyLine: 34 },
    ]);
  });

  it('normalises [Relationship] to kind Relation and keeps the spelling (txt-02)', () => {
    const relation = sectionAt(scanOf('txt-02'), 4);
    const alias = sectionAt(scanOf('txt-02'), 5);

    expect(relation.kind).toBe('Relation');
    expect(relation.name).toBe('Relation');
    expect(alias.kind).toBe('Relation');
    expect(alias.name).toBe('Relationship');
    expect(alias.headerRaw).toBe('[Relationship]');
  });

  it('keeps both [Manager] sections of a duplicate document (txt-06)', () => {
    const scan = scanOf('txt-06');
    const managers = scan.sections.filter((section) => section.kind === 'Manager');

    expect(managers.map((section) => section.index)).toEqual([1, 3]);
    expect(managers.map((section) => section.headerSpan.keyLine)).toEqual([3, 12]);
    // Nothing is merged: each section keeps its own copy of the scalar.
    const projectNames = allKeys(scan).filter((key) => key.key === 'ProjectName');
    expect(projectNames.map((key) => key.value)).toEqual(['"first_manager"', '"second_manager"']);
    expect(projectNames.map((key) => key.span.sectionIndex)).toEqual([1, 3]);
  });

  it('keeps the padding around a header in headerRaw and trims only the name (txt-08)', () => {
    const section = sectionAt(scanOf('txt-08'), 2);

    expect(section.headerRaw).toBe('  [Entity] ');
    expect(section.name).toBe('Entity');
    expect(section.kind).toBe('Entity');
    expect(section.headerSpan.keyLine).toBe(6);
  });

  it('keeps an empty [Relation] section with zero entries (txt-09)', () => {
    const scan = scanOf('txt-09');
    const relation = sectionAt(scan, 3);

    expect(relation.kind).toBe('Relation');
    expect(relation.entries).toEqual([]);
    expect(relation.span).toEqual({ sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 });
  });

  it('keeps [Memo] as an unknown section with its one key (txt-04)', () => {
    const scan = scanOf('txt-04');
    const memo = sectionAt(scan, 2);

    expect(memo.kind).toBe('unknown');
    expect(memo.headerRaw).toBe('[Memo]');
    expect(keysOf(memo.entries).map((key) => key.key)).toEqual(['Note']);
    assertCodes(
      scan.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_UNKNOWN_SECTION'],
    );
    expect(scan.diagnostics[0]?.details).toEqual({ section: '[Memo]', keys: 1 });
    expect(scan.diagnostics[0]?.severity).toBe('info');
    expect(scan.diagnostics[0]?.span).toEqual(memo.span);
  });

  it('treats [entity] in lower case as a different, unknown section (txt-07)', () => {
    const scan = scanOf('txt-07');
    const lower = sectionAt(scan, 3);

    expect(lower.name).toBe('entity');
    expect(lower.kind).toBe('unknown');
    expect(lower.headerRaw).toBe('[entity]');
    expect(scan.sections.filter((section) => section.kind === 'Entity')).toHaveLength(1);
  });
});

// ── keys: verbatim, first `=`, duplicates (§4.2, P4, U6) ───────────────────

describe('keys', () => {
  it('splits on the first `=` only, so a value may contain more (val-10)', () => {
    const key = onlyKey(scanOf('val-10'), 'TableInnerOption');

    expect(key.value).toBe('"ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"');
    expect(key.raw).toBe('TableInnerOption="ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"');
  });

  it('keeps both occurrences of a duplicate scalar key, in file order (txt-05)', () => {
    const scan = scanOf('txt-05');
    const duplicates = allKeys(scan).filter((key) => key.key === 'ProjectName');

    expect(duplicates.map((key) => key.value)).toEqual(['"first_project"', '"second_project"']);
    expect(duplicates.map((key) => key.span.keyLine)).toEqual([4, 6]);
    expect(duplicates.map((key) => key.span.sectionIndex)).toEqual([1, 1]);
    // The duplicate is recorded as data, not diagnosed here: S_DUPLICATE_KEY needs the registry.
    expect(syntaxCodes(scan)).toEqual([]);
  });

  it('keeps a repeated complex key as separate entries (fmt-01 Fields)', () => {
    const fields = keysOf(sectionAt(scanOf('fmt-01'), 2).entries).filter(
      (key) => key.key === 'Field',
    );

    expect(fields).toHaveLength(2);
    expect(fields.map((field) => field.span.keyLine)).toEqual([11, 12]);
  });

  it('keeps escape sequences verbatim and applies none of them (val-01)', () => {
    const key = onlyKey(scanOf('val-01'), 'Comment');

    expect(key.value).toBe('"引用\\Qと\\\\と\\qと\\tと\\nです"');
    // Tokenisation keeps the escapes; 3B is what turns `\Q` into a quote.
    expect(splitComplex(key.value).parts).toEqual([
      { value: '引用\\Qと\\\\と\\qと\\tと\\nです', quoted: true, hadEscape: true },
    ]);
  });

  it('keeps a broken Query line and the continuation apart, never joined (val-08)', () => {
    const scan = scanOf('val-08');
    const view = sectionAt(scan, 2);
    const query = keysOf(view.entries).find((entry) => entry.key === 'Query');

    expect(query?.value).toBe('"SELECT id');
    expect(view.entries.map((entry) => entry.kind)).toEqual(['key', 'key', 'raw-line', 'key']);
    const broken = view.entries[2];
    expect(broken).toEqual({
      kind: 'raw-line',
      raw: 'FROM users WHERE id > 0"',
      span: { sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 },
    });
    assertCodes(
      scan.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_MALFORMED_LINE'],
    );
    expect(scan.diagnostics[0]?.severity).toBe('warning');
  });
});

// ── hostile names (hst-04, §14 row 15, P3) ────────────────────────────────

describe('hostile headers (hst-04)', () => {
  const scan = scanOf('hst-04');

  it('keeps five headers and their kinds', () => {
    expect(scan.sections.map((section) => section.kind)).toEqual([
      'Manager',
      'Entity',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(scan.accounting.sections).toEqual({ total: 5, recognised: 2, unknown: 3 });
  });

  it('keeps a script-tag header verbatim', () => {
    expect(sectionAt(scan, 3).headerRaw).toBe('[<script>]');
    expect(sectionAt(scan, 3).name).toBe('<script>');
  });

  it('reads [[Entity]] as a header named [Entity] (greedy outer pair)', () => {
    const nested = sectionAt(scan, 4);
    expect(nested.headerRaw).toBe('[[Entity]]');
    expect(nested.name).toBe('[Entity]');
    expect(nested.kind).toBe('unknown');
  });

  it('keeps a 4 KiB header and bounds it only in the diagnostic detail', () => {
    const long = sectionAt(scan, 5);
    expect(long.headerRaw).toHaveLength(4098);
    expect(long.name).toHaveLength(4096);

    const unknown = scan.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'S_UNKNOWN_SECTION',
    );
    expect(unknown).toHaveLength(3);
    for (const diagnostic of unknown) {
      const detail = diagnostic.details['section'];
      expect(typeof detail).toBe('string');
      expect(String(detail).length).toBeLessThanOrEqual(200);
    }
  });

  it('reports [Entity]x as a malformed line, not as a header', () => {
    const entries = sectionAt(scan, 4).entries;
    expect(entries.at(-1)).toEqual({
      kind: 'raw-line',
      raw: '[Entity]x',
      span: { sectionIndex: 4, startLine: 17, endLine: 17, keyLine: 17 },
    });
    assertCodes(
      scan.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_UNKNOWN_SECTION', 'S_UNKNOWN_SECTION', 'S_MALFORMED_LINE', 'S_UNKNOWN_SECTION'],
    );
  });
});

// ── line endings across a whole document (hst-05, U4) ──────────────────────

describe('mixed line endings (hst-05)', () => {
  const scan = scanOf('hst-05');

  it('records each line ending as written', () => {
    expect(scan.lines.map((line) => line.ending)).toEqual([
      '\r\n',
      '\n',
      '\r',
      '\r\n',
      '\n',
      '\r\n',
      '\n',
    ]);
    expect(scan.lines).toHaveLength(7);
  });

  it('numbers lines across all three terminators', () => {
    const entity = sectionAt(scan, 2);
    expect(entity.headerSpan.keyLine).toBe(4);
    expect(onlyKey(scan, 'PName').span).toEqual({
      sectionIndex: 2,
      startLine: 5,
      endLine: 5,
      keyLine: 5,
    });
  });

  it('reports nothing: the format defines no line ending to get wrong', () => {
    expect(scan.diagnostics).toEqual([]);
    expect(scan.accounting.lines).toEqual({
      total: 7,
      sectionHeaders: 2,
      keys: 4,
      comments: 1,
      blank: 0,
      raw: 0,
    });
  });
});

// ── immutability (§14 row 14, test-strategy §11) ──────────────────────────

describe('the input is never touched', () => {
  for (const id of FIXTURE_IDS) {
    const spec = specOf(id);
    if (spec.fixtureClass !== 'synthetic') continue;

    it(`${id}: sha256, size and mtime survive a scan`, () => {
      const path = join(SYNTHETIC_DIR, spec.file);
      const before = statSync(path);
      const hashBefore = sha256File(path);
      const bytesBefore = readFileSync(path);

      scanOf(id);

      const after = statSync(path);
      expect(sha256File(path)).toBe(hashBefore);
      expect(readFileSync(path).equals(bytesBefore)).toBe(true);
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });
  }

  it('hst-05: the byte fixture is unchanged after loading and scanning', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-syntax-imm-'));
    try {
      const path = join(directory, 'hst-05.a5er');
      writeFileSync(path, Buffer.from(hst05.BYTES));
      const hashBefore = sha256File(path);
      const outcome = loadSource(path);
      if (!outcome.ok) throw new Error('hst-05 did not load');
      scanSource(outcome.source);
      expect(sha256File(path)).toBe(hashBefore);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
