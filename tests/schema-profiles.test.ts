/**
 * FORMAT profiles — R18 and the §6 policy table (`architecture.md` §6, F2; `format-coverage.md`
 * P1, K2, U1).
 *
 * The table is the test: five declarations, and for each one what the *reader is entitled to
 * conclude*. Asserting `legacy` alone would pin the flag but not the behaviour, so every row also
 * checks the downstream answer — which index source is primary once the decoder has run — and that
 * **both** index spellings are decoded in every profile, because §6's gate changes interpretation
 * and never acceptance.
 *
 * R18 was the `99` row: `declared < 21` left `99` canonical, although §6 says it behaves like an
 * absent declaration. The regression is the second assertion in that row.
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import { profileOf } from '../src/schema/profiles.js';
import { scanSource } from '../src/syntax/scanner.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

/** A minimal document with both index spellings, so the profile has something to interpret. */
function document(formatLine: string): string {
  return [
    ...(formatLine === '' ? [] : [formatLine]),
    '[Entity]',
    'PName="both"',
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
    'IndexInfo="ix_canonical",1,"id", ""',
    'Index=ix_legacy=0,id',
    'Position="Main",10,10',
    '',
  ].join('\n');
}

/** `format` as `decode/` would report it for `# A5:ER FORMAT:<n>`. */
function declaredOf(formatLine: string): number | null {
  const match = /FORMAT:(\d+)/.exec(formatLine);
  return match?.[1] === undefined ? null : Number(match[1]);
}

interface Row {
  readonly label: string;
  readonly formatLine: string;
  readonly known: boolean;
  readonly legacy: boolean;
  /** Which spelling §6 makes primary for this declaration. */
  readonly primarySource: 'canonical' | 'legacy';
  /** Which role the canonical spelling carries. */
  readonly canonicalRole: 'primary' | 'compatibility';
  readonly legacyRole: 'primary' | 'compatibility';
}

const ROWS: readonly Row[] = [
  {
    label: 'absent',
    formatLine: '',
    known: false,
    legacy: true,
    primarySource: 'legacy',
    canonicalRole: 'compatibility',
    legacyRole: 'primary',
  },
  {
    label: '19 (2.20-era)',
    formatLine: '# A5:ER FORMAT:19',
    known: true,
    legacy: true,
    primarySource: 'legacy',
    canonicalRole: 'compatibility',
    legacyRole: 'primary',
  },
  {
    label: '20 (the hole, K2)',
    formatLine: '# A5:ER FORMAT:20',
    known: false,
    legacy: true,
    primarySource: 'legacy',
    canonicalRole: 'compatibility',
    legacyRole: 'primary',
  },
  {
    label: '21 (canonical)',
    formatLine: '# A5:ER FORMAT:21',
    known: true,
    legacy: false,
    primarySource: 'canonical',
    canonicalRole: 'primary',
    legacyRole: 'compatibility',
  },
  {
    label: '99 (future, as absent, U1)',
    formatLine: '# A5:ER FORMAT:99',
    known: false,
    legacy: true,
    primarySource: 'legacy',
    canonicalRole: 'compatibility',
    legacyRole: 'primary',
  },
];

describe('§6 policy table, one row per declaration', () => {
  for (const row of ROWS) {
    it(`${row.label}: legacy=${String(row.legacy)}, primary index source ${row.primarySource}`, () => {
      const text = document(row.formatLine);
      const scan = scanSource({ text, format: declaredOf(row.formatLine) });
      const profile = profileOf(scan.format);

      expect(profile.declared).toBe(declaredOf(row.formatLine));
      expect(profile.known).toBe(row.known);
      expect(profile.legacy).toBe(row.legacy);

      // The downstream interpretation, not just the flag: which source is primary, and what role
      // the other spelling keeps even though it is still decoded.
      const classification = classify(scan);
      const entity = classification.sections.find((section) => section.kind === 'Entity');
      const indexes = entity?.decoded.indexes;
      if (indexes === undefined) throw new Error('no Entity section');

      expect(indexes.primarySource).toBe(row.primarySource);
      expect(indexes.canonical[0]?.role).toBe(row.canonicalRole);
      expect(indexes.legacy[0]?.role).toBe(row.legacyRole);
    });

    it(`${row.label}: decodes both spellings and erases neither`, () => {
      // §6: the gate decides interpretation, never acceptance — so no profile may drop one of them.
      const scan = scanSource({
        text: document(row.formatLine),
        format: declaredOf(row.formatLine),
      });
      const classification = classify(scan);
      const entity = classification.sections.find((section) => section.kind === 'Entity');
      const indexes = entity?.decoded.indexes;

      expect(indexes?.canonical).toHaveLength(1);
      expect(indexes?.legacy).toHaveLength(1);
      expect(indexes?.canonical[0]?.name.value).toBe('ix_canonical');
      expect(indexes?.legacy[0]?.name?.value).toBe('ix_legacy');
      // `Index` is superseded, so decoding it is a legacy action in every profile (§6, F2).
      expect(
        classification.diagnostics.filter((diagnostic) => diagnostic.code === 'S_LEGACY_KEY'),
      ).toHaveLength(1);
      // Nothing is preserved raw: both spellings are modelled, so the counters stay clean.
      expect(classification.completeness.keys.preservedRaw).toBe(0);
      expect(classification.completeness.dropped).toBe(0);
    });
  }

  it('99 is not canonical (R18 regression)', () => {
    // The bug: `declared < 21` left 99 canonical, contradicting §6's "as absent".
    const scan = scanSource({ text: document('# A5:ER FORMAT:99'), format: 99 });
    expect(profileOf(scan.format).legacy).toBe(true);
    // ...and the ≥ 21 future declarations behave the same way, which is the same rule.
    for (const declared of [22, 99, 100]) {
      const future = scanSource({
        text: document(`# A5:ER FORMAT:${String(declared)}`),
        format: declared,
      });
      expect(profileOf(future.format), String(declared)).toMatchObject({
        declared,
        known: false,
        legacy: true,
      });
    }
  });

  it('agrees with the committed FORMAT fixtures (fmt-01/02/03/04/05)', () => {
    const cases = [
      ['fmt-01', 21, true, false],
      ['fmt-02', 19, true, true],
      ['fmt-03', null, false, true],
      ['fmt-04', 20, false, true],
      ['fmt-05', 99, false, true],
    ] as const;

    for (const [id, declared, known, legacy] of cases) {
      const spec = FIXTURES.find((candidate) => candidate.id === id);
      if (spec === undefined) throw new Error(`${id} is not registered`);
      const staged = stage(spec.id);
      try {
        const outcome = loadSource(staged.path);
        if (!outcome.ok) throw new Error(`${id} did not load`);
        const classification = classify(scanSource(outcome.source));
        expect(classification.profile, id).toEqual({ declared, known, legacy });
      } finally {
        staged.cleanup();
      }
    }
  });

  it('only 21 is canonical', () => {
    for (const declared of [null, 1, 18, 19, 20, 99]) {
      const scan = scanSource({ text: document(''), format: declared });
      expect(profileOf(scan.format).legacy, String(declared)).toBe(declared !== 21);
    }
  });

  it('keeps the omitted §6 fields equivalent, not absent by accident', () => {
    // `legacyIndex` is true in every profile (both spellings are decoded), so it is equivalent to
    // the constant `true`; `fontSize` is equivalent to reading `declared` at the point of use.
    for (const row of ROWS) {
      const scan = scanSource({
        text: document(row.formatLine),
        format: declaredOf(row.formatLine),
      });
      const classification = classify(scan);
      const indexes = classification.sections.find((section) => section.kind === 'Entity')?.decoded
        .indexes;
      // legacyIndex ≡ true: canonical IndexInfo is always decoded...
      expect(indexes?.canonical, row.label).toHaveLength(1);
      // ...and legacy Index/IndexOption always too.
      expect(indexes?.legacy, row.label).toHaveLength(1);
      // fontSize ≡ declared: the profile carries the number the decision would be made from.
      expect(classification.profile.declared, row.label).toBe(declaredOf(row.formatLine));
    }
  });
});
