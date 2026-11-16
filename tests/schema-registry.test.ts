/**
 * `schema/registry.ts` — the section-scoped key registry (`architecture.md` §5, §13; F1).
 *
 * Two kinds of assertion, both fixture-driven:
 *
 * 1. **The whole catalog reconciles.** Every committed synthetic fixture is scanned, classified and
 *    compared with the codes and counts its catalog entry declares. The catalog is the oracle, so a
 *    registry entry that is missing, a duplicate rule that is too eager or a key that quietly
 *    stopped being decoded fails here rather than in a later unit.
 * 2. **The specific findings are read out of the fixtures that contain them**: the unknown keys of
 *    txt-04, the duplicate scalars of txt-05/txt-06, the legacy `Index` of fmt-02/sem-04, and the
 *    key that must *not* warn (fmt-03/fmt-05's legacy geometry).
 *
 * No assertion here reaches into semantics: `V_*` codes and positional `Field` decoding are other
 * units, and the codes this unit owns are compared as a multiset, never as "contains".
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { DecodedSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import type { Classification } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { SyntaxScan } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

/**
 * Codes the syntax and registry stages own together.
 *
 * `S_FIELD_*` joined in 3B-2, when the `Field` decoder landed; every `V_` belongs to the validator.
 */
const REGISTRY_CODES: ReadonlySet<string> = new Set([
  'S_UNKNOWN_KEY',
  'S_LEGACY_KEY',
  'S_DUPLICATE_KEY',
  'S_COMPLEX_UNTERMINATED_QUOTE',
  'S_UNKNOWN_SECTION',
  'S_MALFORMED_LINE',
  'S_HEADER_UNKNOWN_FORMAT',
  'S_FIELD_TOO_FEW_ELEMENTS',
  'S_FIELD_TOO_MANY_ELEMENTS',
]);

/** The `S_` codes a fixture declares that this unit is responsible for. */
function expectedCodes(spec: FixtureSpec): string[] {
  return spec.expectation.codes.filter((code) => REGISTRY_CODES.has(code));
}

const SOURCES = new Map<string, DecodedSource>();

function sourceOf(spec: FixtureSpec): DecodedSource {
  const cached = SOURCES.get(spec.id);
  if (cached !== undefined) return cached;
  const staged = stage(spec.id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${spec.id} did not load`);
    SOURCES.set(spec.id, outcome.source);
    return outcome.source;
  } finally {
    staged.cleanup();
  }
}

const SCANS = new Map<string, SyntaxScan>();
const CLASSIFICATIONS = new Map<string, Classification>();

function scanOf(spec: FixtureSpec): SyntaxScan {
  const cached = SCANS.get(spec.id);
  if (cached !== undefined) return cached;
  const scan = scanSource(sourceOf(spec));
  SCANS.set(spec.id, scan);
  return scan;
}

function classificationOf(spec: FixtureSpec): Classification {
  const cached = CLASSIFICATIONS.get(spec.id);
  if (cached !== undefined) return cached;
  const classification = classify(scanOf(spec));
  CLASSIFICATIONS.set(spec.id, classification);
  return classification;
}

/** Every code the syntax and registry stages produce together. */
function allCodes(scan: SyntaxScan, classification: Classification): string[] {
  return [
    ...scan.diagnostics.map((diagnostic) => diagnostic.code),
    ...classification.diagnostics.map((diagnostic) => diagnostic.code),
  ];
}

const SYNTHETIC = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');

describe('the fixture catalog reconciles with the registry', () => {
  for (const spec of SYNTHETIC) {
    describe(`${spec.id} — ${spec.file}`, () => {
      it('reports exactly the syntax-stage codes the catalog declares', () => {
        assertCodes(
          allCodes(scanOf(spec), classificationOf(spec)),
          expectedCodes(spec),
          `${spec.id} syntax codes`,
        );
      });

      it('reconciles section and key counts with the catalog', () => {
        const { completeness } = classificationOf(spec);
        const { sections, keys } = spec.expectation.counts;

        expect(completeness.sections, 'sections').toEqual(sections);
        expect(completeness.keys, 'keys').toEqual(keys);
        expect(completeness.dropped, 'dropped').toBe(0);
      });

      it('accounts for every key the scanner found', () => {
        const scan = scanOf(spec);
        const { completeness } = classificationOf(spec);

        expect(completeness.keys.total).toBe(scan.accounting.keys.total);
        expect(completeness.sections.total).toBe(scan.accounting.sections.total);
        expect(completeness.keys.parsed + completeness.keys.preservedRaw).toBe(
          completeness.keys.total,
        );
      });

      it('classifies every key line exactly once', () => {
        const classification = classificationOf(spec);
        const parsed = classification.sections.flatMap((section) =>
          section.entries.filter((entry) => entry.kind === 'parsed'),
        );
        const preservedKeys = classification.preserved.filter(
          (entry) => entry.key !== null && entry.kind === 'unknown-key',
        );
        const scannedLines = scanOf(spec).accounting.keys.total;

        expect(parsed.length + preservedKeys.length).toBe(scannedLines);
      });

      it('is deterministic', () => {
        const first = classificationOf(spec);
        const second = classify(scanOf(spec));
        expect(second.completeness).toEqual(first.completeness);
        expect(second.keys.map((group) => group.spec.key)).toEqual(
          first.keys.map((group) => group.spec.key),
        );
      });
    });
  }
});

describe('unknown keys are preserved, not dropped (txt-04)', () => {
  const spec = FIXTURES.find((candidate) => candidate.id === 'txt-04');
  if (spec === undefined) throw new Error('txt-04 is not registered');
  const classification = classificationOf(spec);

  it('reports one S_UNKNOWN_KEY per unknown key and none for the unknown section', () => {
    const keyDiagnostics = classification.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'S_UNKNOWN_KEY',
    );
    expect(keyDiagnostics).toHaveLength(2);
    expect(keyDiagnostics.map((diagnostic) => diagnostic.details['key'])).toEqual([
      'MysteryKey',
      'SecondMystery',
    ]);
    // `[Memo]` is unknown as a *section*; its `Note` is preserved without a second complaint.
    const memo = classification.sections.find((section) => section.kind === 'unknown');
    expect(memo?.entries.map((entry) => entry.kind)).toEqual(['preserved']);
  });

  it('keeps the verbatim line, key text and span of each unknown key', () => {
    const preserved = classification.preserved.filter((entry) => entry.kind === 'unknown-key');
    expect(preserved.map((entry) => entry.raw)).toEqual([
      'MysteryKey="value"',
      'SecondMystery="value2"',
      'Note="自由メモ"',
    ]);
    expect(preserved.map((entry) => entry.key)).toEqual(['MysteryKey', 'SecondMystery', 'Note']);
    expect(preserved.map((entry) => entry.span.keyLine)).toEqual([5, 6, 10]);
    expect(preserved.map((entry) => entry.reason)).toEqual([
      'no-registry-entry',
      'no-registry-entry',
      'section-not-modelled',
    ]);
  });
});

describe('duplicate scalars keep every occurrence and select the last (txt-05, txt-06)', () => {
  it('flags the second ProjectName in one section (txt-05)', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'txt-05');
    if (spec === undefined) throw new Error('txt-05 is not registered');
    const classification = classificationOf(spec);
    const group = classification.keys.find((key) => key.spec.key === 'ProjectName');

    expect(group?.occurrences.map((occurrence) => occurrence.raw)).toEqual([
      '"first_project"',
      '"second_project"',
    ]);
    expect(group?.occurrences.map((occurrence) => occurrence.span?.keyLine)).toEqual([4, 6]);
    expect(group?.duplicateCount).toBe(1);
    // Last-wins applies to the *selected* value only; both occurrences stay in the section.
    expect(group?.selected?.raw).toBe('"second_project"');
    expect(group?.selected?.decoded).toMatchObject({
      ok: true,
      value: { value: 'second_project', origin: 'declared', raw: '"second_project"' },
    });
  });

  it('flags ProjectName across two [Manager] sections, which share one scope (txt-06)', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'txt-06');
    if (spec === undefined) throw new Error('txt-06 is not registered');
    const classification = classificationOf(spec);
    const group = classification.keys.find((key) => key.spec.key === 'ProjectName');

    expect(group?.occurrences.map((occurrence) => occurrence.span?.sectionIndex)).toEqual([1, 3]);
    expect(group?.duplicateCount).toBe(1);
    expect(group?.selected?.raw).toBe('"second_manager"');
  });

  it('never flags a repeatable key', () => {
    // fmt-01 has two Field lines in one [Entity] section and PageInfo once; no duplicate code.
    const spec = FIXTURES.find((candidate) => candidate.id === 'fmt-01');
    if (spec === undefined) throw new Error('fmt-01 is not registered');
    const classification = classificationOf(spec);

    expect(classification.diagnostics).toEqual([]);
    const fields = classification.keys.filter((group) => group.spec.key === 'Field');
    // Section-scoped: fmt-01's two entities each hold two Field lines, and neither is a duplicate.
    expect(fields.map((group) => group.occurrences.length)).toEqual([2, 2]);
    expect(fields.every((group) => group.selected === null)).toBe(true);
  });
});

describe('legacy keys: superseded warn, old-but-quiet do not (§6, F2)', () => {
  it('decodes the legacy Index under FORMAT:19 and warns once (fmt-02)', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'fmt-02');
    if (spec === undefined) throw new Error('fmt-02 is not registered');
    const classification = classificationOf(spec);
    const index = classification.keys.find((group) => group.spec.key === 'Index');

    expect(classification.profile).toEqual({ declared: 19, known: true, legacy: true });
    expect(index?.spec.disposition).toBe('legacy');
    expect(index?.spec.superseded).toBe(true);
    expect(index?.occurrences).toHaveLength(1);
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_LEGACY_KEY'],
    );
  });

  it('decodes the same legacy Index under FORMAT:21 and still marks it legacy (sem-04)', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'sem-04');
    if (spec === undefined) throw new Error('sem-04 is not registered');
    const classification = classificationOf(spec);

    expect(classification.profile.legacy).toBe(false);
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_LEGACY_KEY'],
    );
  });

  it('keeps the legacy geometry keys without a warning (fmt-03, fmt-05)', () => {
    for (const id of ['fmt-03', 'fmt-05']) {
      const spec = FIXTURES.find((candidate) => candidate.id === id);
      if (spec === undefined) throw new Error(`${id} is not registered`);
      const classification = classificationOf(spec);
      const keys = classification.keys.map((group) => group.spec.key);

      expect(keys, id).toContain('Page');
      expect(keys, id).toContain('Left');
      expect(keys, id).toContain('Top');
      expect(
        classification.diagnostics.filter((diagnostic) => diagnostic.code === 'S_LEGACY_KEY'),
        id,
      ).toEqual([]);
      // They are still decoded rather than preserved raw: legacy is a disposition, not a refusal.
      expect(classification.completeness.keys.preservedRaw, id).toBe(0);
    }
  });
});

describe('the registry is keyed by (kind, key), never by key name', () => {
  it('gives Position the same shape class in every section that has it', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'fmt-01');
    if (spec === undefined) throw new Error('fmt-01 is not registered');
    const classification = classificationOf(spec);
    const positions = classification.keys.filter((group) => group.spec.key === 'Position');

    // One per Entity (section-scoped) and one document-scoped group for the Relation.
    expect(positions.map((group) => group.kind).sort()).toEqual([
      'Entity',
      'Entity',
      'Relation',
      'View',
    ]);
  });

  it('treats a key that exists in one section as unknown in another', () => {
    // `UsingCommonColumns` is an [Entity] key; the same spelling in [View] would be unknown.
    const spec = FIXTURES.find((candidate) => candidate.id === 'sem-07');
    if (spec === undefined) throw new Error('sem-07 is not registered');
    const classification = classificationOf(spec);
    const entity = classification.sections.filter((section) => section.kind === 'Entity');

    expect(entity).toHaveLength(2);
    expect(classification.diagnostics).toEqual([]);
  });

  it('is case-sensitive: a lower-case key name is unknown', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'txt-07');
    if (spec === undefined) throw new Error('txt-07 is not registered');
    const classification = classificationOf(spec);
    const unknownSection = classification.sections.find((section) => section.kind === 'unknown');

    // `[entity]`'s keys are preserved as raw because the *section* is unknown, and no
    // S_UNKNOWN_KEY is added on top of S_UNKNOWN_SECTION.
    expect(unknownSection?.entries.every((entry) => entry.kind === 'preserved')).toBe(true);
    expect(classification.diagnostics).toEqual([]);
  });
});

describe('documented defaults (§4.2 `defaulted`)', () => {
  it('fills UsingCommonColumns with 1 only where it is absent', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'sem-07');
    if (spec === undefined) throw new Error('sem-07 is not registered');
    const classification = classificationOf(spec);

    for (const section of classification.sections.filter((entry) => entry.kind === 'Entity')) {
      const declared = section.entries.find(
        (entry) => entry.kind === 'parsed' && entry.occurrence.spec.key === 'UsingCommonColumns',
      );
      const defaults = section.defaults.filter((entry) => entry.keyRaw === 'UsingCommonColumns');
      // Exactly one of the two readings exists: the file declares it or the spec supplies it.
      expect((declared === undefined) !== (defaults.length === 0)).toBe(true);
      for (const fallback of defaults) {
        expect(fallback.decoded).toMatchObject({
          ok: true,
          value: { value: 1, origin: 'defaulted', raw: '', span: null },
        });
      }
    }
  });
});

describe('keys outside any section and invalid tokens stay traceable', () => {
  it('counts a key line before the first header as preserved, not as a lost line', () => {
    const scan = scanSource({ text: 'Stray="1"\n[Manager]\nPageInfo="Main"\n', format: 21 });
    const classification = classify(scan);

    expect(classification.problems).toEqual([]);
    expect(classification.completeness.keys).toEqual({
      total: 2,
      parsed: 1,
      preservedRaw: 1,
    });
    expect(classification.completeness.dropped).toBe(0);
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_UNKNOWN_KEY'],
    );
    expect(classification.preserved[0]).toMatchObject({
      kind: 'unknown-key',
      key: 'Stray',
      raw: 'Stray="1"',
      reason: 'no-section',
      span: { sectionIndex: 0, keyLine: 1 },
    });
  });

  it('lists an invalid token instead of coercing it, and still counts the key', () => {
    const scan = scanSource({ text: '[Entity]\nPName="x"\nZOrder=lots\n', format: 21 });
    const classification = classify(scan);

    expect(classification.problems).toEqual([
      {
        key: 'ZOrder',
        sectionKind: 'Entity',
        reason: 'not-an-integer',
        raw: 'lots',
        span: { sectionIndex: 1, startLine: 3, endLine: 3, keyLine: 3 },
      },
    ]);
    // The key is understood and its line modelled, so it counts as parsed, not as raw evidence.
    expect(classification.completeness.keys).toEqual({ total: 2, parsed: 2, preservedRaw: 0 });
    expect(classification.diagnostics).toEqual([]);
  });

  it('keeps a boolean that is neither 1 nor 0 as an invalid record', () => {
    const scan = scanSource({ text: '[Manager]\nPageInfo="Main"\nLogicalView=yes\n', format: 21 });
    const classification = classify(scan);

    expect(classification.problems[0]).toMatchObject({
      key: 'LogicalView',
      reason: 'not-a-boolean',
      raw: 'yes',
    });
  });
});
