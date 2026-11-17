/**
 * Relation resolution (`architecture.md` §9.2, P9; `format-coverage.md` F5, K7, U8).
 *
 * Three fixture-driven proofs, plus the adversarial cases the catalog cannot cover:
 *
 * - `sem-01` — an endpoint that names nothing, and the column that becomes unverifiable because of
 *   it: exactly one `V_DANGLING_ENTITY` and one `V_DANGLING_COLUMN`;
 * - `txt-03` — `Fields1="a,b"` is **two** columns in **one** quoted element, so a raw comma split
 *   would be wrong (the same reason F3 exists);
 * - `sem-03` — two sides with different column counts: one `V_FIELD_COUNT_MISMATCH`, and both lists
 *   stay complete.
 *
 * The relation's cardinality keeps the format's own misspelling (`Cardinarity`, K7) and no
 * constraint name is ever synthesised — the format stores printf templates, not names (D7).
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { relationsOf } from '../src/semantic/relations.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { semanticsOf } from './helpers/classified.js';

/** Relation findings of an inline document. */
function relationsOfText(text: string) {
  return relationsOf(classify(scanSource({ text, format: 21 })));
}

const ONE_ENTITY =
  '[Entity]\nPName="parent"\nField="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n';
const CHILD =
  '[Entity]\nPName="child"\nField="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nField="親","p_id","Integer","",1,"","",$FFFFFFFF,""\nPosition="M",2,2\n';
const MANAGER = '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n';

describe('relations resolve against [Entity] names only (§9.2, P9)', () => {
  it('resolves a two-entity relation and keeps every declared value (txt-02)', () => {
    const semantics = semanticsOf('txt-02');
    const relation = semantics.relations[0];

    expect(semantics.relations).toHaveLength(2);
    expect(relation).toMatchObject({
      sectionHeader: '[Relation]',
      relationType1: 2,
      relationType2: 4,
      cardinarity1: 'P',
      cardinarity2: 'Z',
      columnsAligned: true,
      pname: null,
    });
    expect(relation?.from).toMatchObject({
      key: 'Entity1',
      declared: 'parent_t',
      status: 'resolved',
      resolvedEntity: 'parent_t',
    });
    expect(relation?.to?.resolvedEntity).toBe('child_t');
    expect(relation?.fromColumns?.columns.map((column) => column.pname)).toEqual(['id']);
    expect(relation?.toColumns?.columns.map((column) => column.pname)).toEqual(['parent_id']);
    expect(semantics.diagnostics).toEqual([]);
  });

  it('keeps the [Relationship] alias with its own header (txt-02)', () => {
    const seman = semanticsOf('txt-02');

    expect(seman.relations.map((relation) => relation.sectionHeader)).toEqual([
      '[Relation]',
      '[Relationship]',
    ]);
    // Both are relations and both resolve; the alias is a spelling, not a second kind (§5).
    expect(seman.relations[1]?.from?.resolvedEntity).toBe('parent_t');
  });

  it('reports a dangling endpoint and the column it makes unverifiable (sem-01)', () => {
    const semantics = semanticsOf('sem-01');
    const relation = semantics.relations[0];

    expect(relation?.from).toMatchObject({ declared: 'orders', status: 'resolved' });
    expect(relation?.to).toMatchObject({
      declared: 'ghost_table',
      status: 'dangling',
      resolvedEntity: null,
    });

    expect(semantics.danglingEntities).toHaveLength(1);
    expect(semantics.danglingEntities[0]).toMatchObject({
      endpoint: 'Entity2',
      declared: 'ghost_table',
    });
    expect(semantics.danglingEntities[0]?.span.keyLine).toBe(14);

    expect(semantics.danglingColumns).toHaveLength(1);
    expect(semantics.danglingColumns[0]).toMatchObject({
      endpoint: 'Entity2',
      column: 'ghost_column',
      entity: null,
    });

    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_DANGLING_ENTITY', 'V_DANGLING_COLUMN', 'V_DANGLING_PAGE'],
    );
  });

  it('does not resolve a [View] or [Subtype] as an endpoint', () => {
    const result = relationsOfText(
      MANAGER +
        '[View]\nPName="v"\nQuery="SELECT 1"\nPosition="M",1,1\n' +
        '[Relation]\nEntity1="v"\nEntity2="v"\nFields1="x"\nFields2="x"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    // A view declares no columns, so accepting it would mean an unchecked mapping (K11, P6).
    expect(result.danglingEntities.map((entry) => entry.declared)).toEqual(['v', 'v']);
    expect(result.danglingColumns.map((entry) => entry.column)).toEqual(['x', 'x']);
    expect(result.relations[0]?.from?.status).toBe('dangling');
  });

  it('retains an ambiguous endpoint instead of binding one entity', () => {
    const result = relationsOfText(
      MANAGER +
        '[Entity]\nPName="twin"\nField="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n' +
        '[Entity]\nPName="twin"\nPosition="M",2,2\n' +
        '[Relation]\nEntity1="twin"\nEntity2="twin"\nFields1="id"\nFields2="id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    // Two declarations of one name is not a resolution: both are named, neither is chosen.
    expect(result.ambiguousEntities.map((entry) => entry.declared)).toEqual(['twin', 'twin']);
    expect(result.danglingEntities).toEqual([]);
    expect(result.relations[0]?.from).toMatchObject({ status: 'ambiguous', resolvedEntity: null });
    // An ambiguous endpoint cannot verify its columns either, and that is reported as dangling.
    expect(result.danglingColumns).toHaveLength(2);
  });
});

describe('columns come from the tokeniser, not from a raw split (P9, F3)', () => {
  it('reads a composite foreign key declared as one quoted element (txt-03)', () => {
    const relation = semanticsOf('txt-03').relations[0];

    expect(relation?.fromColumns?.raw).toBe('"a,b"');
    expect(relation?.fromColumns?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
    expect(relation?.toColumns?.columns.map((column) => column.pname)).toEqual(['x', 'y']);
    expect(relation?.columnsAligned).toBe(true);
    expect(semanticsOf('txt-03').diagnostics).toEqual([]);
  });

  it('reports a column that the resolved entity does not declare', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="nope"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.danglingEntities).toEqual([]);
    expect(result.danglingColumns).toHaveLength(1);
    expect(result.danglingColumns[0]).toMatchObject({
      endpoint: 'Entity2',
      column: 'nope',
      entity: 'child',
    });
  });

  it('reports one finding per dangling column, not per relation', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="nope,missing"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.danglingColumns.map((entry) => entry.column)).toEqual(['nope', 'missing']);
  });

  it('treats an empty column list as no columns at all', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2=""\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.relations[0]?.toColumns?.columns).toEqual([]);
    expect(result.countMismatches[0]).toMatchObject({ fromCount: 1, toCount: 0 });
  });
});

describe('a column-count difference is reported, never repaired (U8)', () => {
  it('keeps both complete lists and reports one mismatch (sem-03)', () => {
    const semantics = semanticsOf('sem-03');
    const relation = semantics.relations[0];

    expect(relation?.fromColumns?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
    expect(relation?.toColumns?.columns.map((column) => column.pname)).toEqual(['x', 'y', 'z']);
    expect(relation?.columnsAligned).toBe(false);

    expect(semantics.fieldCountMismatches).toHaveLength(1);
    expect(semantics.fieldCountMismatches[0]).toMatchObject({ fromCount: 2, toCount: 3 });
    expect(semantics.fieldCountMismatches[0]?.span.keyLine).toBe(23);

    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_FIELD_COUNT_MISMATCH'],
    );
    const diagnostic = semantics.diagnostics[0];
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.details).toEqual({ from: 2, to: 3 });
  });

  it('does not invent a constraint name for the relation (D7)', () => {
    const relation = semanticsOf('fmt-01').relations[0];

    expect(relation?.pname).toBeNull();
    expect(JSON.stringify(relation)).not.toContain('_FK');
  });
});

describe('relations keep their declared cardinality as written (K7)', () => {
  it('keeps the misspelled Cardinarity keys and their values (fmt-01)', () => {
    const relation = semanticsOf('fmt-01').relations[0];

    expect(relation).toMatchObject({
      cardinarity1: 'P',
      cardinarity2: 'Z',
      relationType1: 2,
      relationType2: 4,
    });
  });

  it('keeps a relation that is missing an endpoint, for the required-key finding', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        '[Relation]\nEntity1="parent"\nFields1="id"\nRelationType1=1\nRelationType2=3\n' +
        'Position="M",0,1,1,1,R,R,""\n',
    );

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.to).toBeNull();
    expect(result.danglingEntities).toEqual([]);
    expect(result.countMismatches).toEqual([]);
  });
});
