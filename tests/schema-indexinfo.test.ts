/**
 * `schema/indexinfo.ts` — canonical `IndexInfo` and the legacy `Index`/`IndexOption` (`§6`, P8, U7).
 *
 * The fixture that justifies F3 is val-02: `"user_name,birthday"` is **one** quoted element and
 * **two** columns. A decoder that split the raw value on commas would produce three elements and an
 * index with a column called `"user_name` — which is why the column list is taken from the
 * tokeniser's element and split only afterwards.
 *
 * The legacy payload is the opposite case: the format never documented it (U7), so the decoder
 * recognises the *observed* `name=flag,cols` shape and says so, and anything else keeps its raw text
 * with `shape: 'unrecognised'` rather than guessing at a grammar.
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import type { Classification } from '../src/schema/registry.js';
import { decodeLegacyIndex } from '../src/schema/indexinfo.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { Span } from '../src/model/span.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

const CLASSIFICATIONS = new Map<string, Classification>();

function classificationOf(id: string): Classification {
  const cached = CLASSIFICATIONS.get(id);
  if (cached !== undefined) return cached;
  if (FIXTURES.find((spec) => spec.id === id) === undefined) throw new Error(`${id} unknown`);
  const staged = stage(id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    const classification = classify(scanSource(outcome.source));
    CLASSIFICATIONS.set(id, classification);
    return classification;
  } finally {
    staged.cleanup();
  }
}

function indexesOf(id: string) {
  const section = classificationOf(id).sections.find((candidate) => candidate.kind === 'Entity');
  if (section === undefined) throw new Error(`${id} has no Entity section`);
  return section.decoded.indexes;
}

describe('IndexInfo — one quoted list, many columns (val-02, P8)', () => {
  const indexes = indexesOf('val-02');

  it('keeps the comma-containing column list as one element and splits it after', () => {
    const index = indexes.canonical[0];
    if (index === undefined) throw new Error('no canonical index');

    expect(index.name.value).toBe('users_ix1');
    expect(index.uniqueness?.value).toBe('unique');
    expect(index.elementsSeen).toBe(4);
    // Two columns, not three fragments: the comma was inside the quoted element (F3).
    expect(index.columns.map((column) => column.value)).toEqual(['user_name', 'birthday']);
    expect(index.columns.map((column) => column.raw)).toEqual(['user_name', 'birthday']);
    expect(index.option.value).toBe('');
    expect(index.option.raw).toBe('""');
  });

  it('decodes the document’s three flag values, and only those (P8)', () => {
    const second = indexes.canonical[1];
    if (second === undefined) throw new Error('no second index');

    expect(second.uniqueness?.value).toBe('unique-constraint');
    expect(second.columns.map((column) => column.value)).toEqual(['user_name']);
    expect(second.option.value).toBe('UNIQUE');
  });

  it('keeps every index on its own key line', () => {
    expect(indexes.canonical.map((index) => index.span.keyLine)).toEqual([7, 8]);
    expect(indexes.canonical[0]?.columns[1]?.span).toEqual({
      sectionIndex: 1,
      startLine: 7,
      endLine: 7,
      keyLine: 7,
    });
  });

  it('reports no diagnostic: §11 defines no arity warning for IndexInfo', () => {
    expect(classificationOf('val-02').diagnostics).toEqual([]);
  });

  it('keeps a flag outside 0/1/2 visible instead of guessing a value (synthetic edge)', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nIndexInfo="ix",7,"a", ""\n',
      format: 21,
    });
    const index = classify(scan).sections[0]?.decoded.indexes.canonical[0];

    expect(index?.uniqueness).toBeNull();
    expect(index?.uniquenessToken).toBe('7');
    expect(index?.columns.map((column) => column.value)).toEqual(['a']);
  });
});

describe('the legacy payload is observed, not documented (U7, F2)', () => {
  it('decodes the observed name=flag,cols shape under FORMAT:19 (fmt-02)', () => {
    const indexes = indexesOf('fmt-02');
    const legacy = indexes.legacy[0];
    if (legacy === undefined) throw new Error('no legacy index');

    expect(legacy.shape).toBe('observed');
    expect(legacy.name?.value).toBe('legacy_orders_ix1');
    expect(legacy.uniqueness?.value).toBe('non-unique');
    expect(legacy.columns.map((column) => column.value)).toEqual(['id']);
    expect(legacy.payload.value).toBe('legacy_orders_ix1=0,id');
    expect(indexes.canonical).toEqual([]);
  });

  it('keeps a multi-column legacy payload in order (sem-04)', () => {
    const legacy = indexesOf('sem-04').legacy[0];

    expect(legacy?.name?.value).toBe('legacy_ix1');
    expect(legacy?.columns.map((column) => column.value)).toEqual(['user_id', 'created_at']);
  });

  it('keeps legacy data under FORMAT:21 too, as compatibility (sem-04)', () => {
    const indexes = indexesOf('sem-04');
    const classification = classificationOf('sem-04');

    expect(classification.profile.legacy).toBe(false);
    expect(indexes.primarySource).toBe('canonical');
    expect(indexes.legacy[0]?.role).toBe('compatibility');
    // Decoded, not dropped: only the *role* changed with the profile (§6).
    expect(indexes.legacy[0]?.columns).toHaveLength(2);
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_LEGACY_KEY'],
    );
  });

  it('refuses to invent fields for a payload that does not match the observed shape', () => {
    const span: Span = { sectionIndex: 2, startLine: 5, endLine: 5, keyLine: 5 };

    expect(decodeLegacyIndex('no-equals-here', span)).toMatchObject({
      shape: 'unrecognised',
      name: null,
      uniqueness: null,
      columns: [],
      payload: { value: 'no-equals-here', raw: 'no-equals-here' },
    });
    // `=id` has an empty name: still not the observed shape.
    expect(decodeLegacyIndex('=0,id', span).shape).toBe('unrecognised');
  });

  it('keeps an IndexOption addressable without claiming to understand it', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nIndex=ix=1,a\nIndexOption="ix","SOMETHING"\n',
      format: 19,
    });
    const indexes = classify(scan).sections[0]?.decoded.indexes;

    expect(indexes?.legacyOptions).toHaveLength(1);
    expect(indexes?.legacyOptions[0]).toMatchObject({
      shape: 'undocumented',
      payload: { value: '"ix","SOMETHING"', raw: '"ix","SOMETHING"' },
      role: 'primary',
    });
  });
});

describe('index decoding keeps the classification intact', () => {
  it('counts both spellings as parsed keys (synthetic edge)', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nIndexInfo="a",1,"c", ""\nIndex=b=0,c\n',
      format: 21,
    });
    const classification = classify(scan);

    expect(classification.completeness.keys).toEqual({ total: 3, parsed: 3, preservedRaw: 0 });
    expect(classification.completeness.dropped).toBe(0);
    expect(classification.problems).toEqual([]);
  });

  it('does not validate references (no V_* here)', () => {
    // The columns name nothing that exists; referential checks are the validator's (§9, out of scope).
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nIndexInfo="ix",1,"ghost", ""\n',
      format: 21,
    });

    expect(classify(scan).diagnostics).toEqual([]);
  });

  it('keeps a repeated IndexInfo as repeated entries, not a duplicate (P4)', () => {
    const indexes = indexesOf('val-02');
    expect(indexes.canonical).toHaveLength(2);
    expect(classificationOf('val-02').diagnostics).toEqual([]);
  });
});
