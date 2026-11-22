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
import type {
  RelationColumnList,
  RelationEndpoint,
  RelationResult,
} from '../src/semantic/relations.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
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
    // R25: ambiguity is not absence. The columns are unverified, never reported as dangling.
    expect(result.danglingColumns).toEqual([]);
    expect(result.unverifiedColumns.map((entry) => entry.column)).toEqual(['id', 'id']);
    expect(result.unverifiedColumns[0]).toMatchObject({ candidates: 2 });
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

  it('keeps an empty element as an empty slot, not as a missing column (R28)', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2=""\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );
    const slots = result.relations[0]?.toColumns?.columns ?? [];

    // One slot on each side: the arity matches, and an empty name is neither resolved nor dangling.
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ pname: '', raw: '""', index: 0, empty: true });
    expect(result.relations[0]?.columnsAligned).toBe(true);
    expect(result.countMismatches).toEqual([]);
    expect(result.danglingColumns).toEqual([]);
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

// ── R25–R28 regressions ────────────────────────────────────────────────────

describe('R25 — an ambiguous endpoint is unverified, not missing', () => {
  it('keeps the columns of a duplicated-name endpoint out of the dangling list', () => {
    const result = relationsOfText(
      MANAGER +
        '[Entity]\nPName="twin"\nField="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n' +
        '[Entity]\nPName="twin"\nField="I","id2","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",2,2\n' +
        '[Relation]\nEntity1="twin"\nEntity2="twin"\nFields1="id"\nFields2="id2"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    // Both names exist and each *could* hold the column, so neither is a missing column.
    expect(result.danglingEntities).toEqual([]);
    expect(result.danglingColumns).toEqual([]);
    expect(result.ambiguousEntities).toHaveLength(2);
    expect(result.unverifiedColumns.map((entry) => entry.column)).toEqual(['id', 'id2']);
    expect(result.unverifiedColumns.every((entry) => entry.candidates === 2)).toBe(true);
  });

  it('still reports a truly missing column as dangling (sem-01 behaviour preserved)', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="absent"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.danglingEntities).toEqual([]);
    expect(result.unverifiedColumns).toEqual([]);
    expect(result.danglingColumns.map((entry) => entry.column)).toEqual(['absent']);
    expect(result.danglingColumns[0]?.entity).toBe('child');
  });
});

describe('R26 — a repeated scalar is last-wins even when the last one is broken', () => {
  it('returns null for RelationType1=2 followed by an unusable token', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="p_id"\n' +
        'RelationType1=2\nRelationType1=bad\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    // The earlier `2` is shadowed evidence, not the value: reading it back would resurrect it.
    expect(result.relations[0]?.relationType1).toBeNull();
    expect(result.relations[0]?.relationType2).toBe(3);
  });

  it('returns the value when the last occurrence is the valid one', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="p_id"\n' +
        'RelationType1=bad\nRelationType1=2\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.relations[0]?.relationType1).toBe(2);
  });

  it('keeps both occurrences and the registry duplicate finding in the classification', () => {
    const classification = classify(
      scanSource({
        text:
          '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n' +
          '[Relation]\nEntity1="a"\nEntity2="b"\nFields1="x"\nFields2="y"\n' +
          'RelationType1=2\nRelationType1=bad\nPosition="M",0,1,1,1,R,R,""\n',
        format: 21,
      }),
    );
    const relation = classification.sections.find((section) => section.kind === 'Relation');
    const occurrences = relation?.entries.filter(
      (entry) => entry.kind === 'parsed' && entry.occurrence.spec.key === 'RelationType1',
    );

    expect(occurrences).toHaveLength(2);
    expect(
      classification.diagnostics.filter((diagnostic) => diagnostic.code === 'S_DUPLICATE_KEY'),
    ).toHaveLength(1);
  });

  it('applies the same rule to a text key: the last occurrence decides', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="p_id"\n' +
        'RelationType1=1\nRelationType2=3\nCardinarity1="P"\nCardinarity1="Z"\n' +
        'Position="M",0,1,1,1,R,R,""\n',
    );

    expect(result.relations[0]?.cardinarity1).toBe('Z');
  });
});

describe('R27 — an absent column list is unknown, not aligned', () => {
  it('reports null and no mismatch when one side is missing (synthetic edge)', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(result.relations[0]?.columnsAligned).toBeNull();
    expect(result.countMismatches).toEqual([]);
  });

  it('reports true for equal lists and false plus a mismatch for different ones', () => {
    const equal = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="p_id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );
    const different = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id"\nFields2="p_id,id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );

    expect(equal.relations[0]?.columnsAligned).toBe(true);
    expect(equal.countMismatches).toEqual([]);
    expect(different.relations[0]?.columnsAligned).toBe(false);
    expect(different.countMismatches).toHaveLength(1);
  });
});

describe('R28 — every slot is kept, so an empty one cannot make a false match', () => {
  it('counts an empty middle slot, turning a false 2:2 into a real 3:2 (synthetic edge)', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id,,id"\nFields2="p_id,id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );
    const slots = result.relations[0]?.fromColumns?.columns ?? [];

    expect(slots.map((slot) => slot.pname)).toEqual(['id', '', 'id']);
    expect(slots.map((slot) => slot.index)).toEqual([0, 1, 2]);
    expect(slots.map((slot) => slot.empty)).toEqual([false, true, false]);
    // The empty slot names nothing, so it is not a dangling column...
    expect(result.danglingColumns).toEqual([]);
    // ...but it is a slot, so the arity difference is real and reported.
    expect(result.countMismatches[0]).toMatchObject({ fromCount: 3, toCount: 2 });
  });

  it('keeps leading and trailing empty positions inside a quoted list', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1=",id,id2,"\nFields2="p_id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );
    const slots = result.relations[0]?.fromColumns?.columns ?? [];

    // The whole value is one quoted element, so its inner commas are list separators: four
    // positions, two of them empty (P9's カラムリスト).
    expect(slots.map((slot) => slot.pname)).toEqual(['', 'id', 'id2', '']);
    expect(slots.map((slot) => slot.empty)).toEqual([true, false, false, true]);
    expect(result.countMismatches[0]).toMatchObject({ fromCount: 4, toCount: 1 });
  });

  it('drops only the slot a trailing *element* separator leaves blank (§7.1)', () => {
    const result = relationsOfText(
      MANAGER +
        ONE_ENTITY +
        CHILD +
        '[Relation]\nEntity1="parent"\nEntity2="child"\nFields1="id",\nFields2="p_id"\n' +
        'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n',
    );
    const slots = result.relations[0]?.fromColumns?.columns ?? [];

    // `"id",` is one element plus an omitted tail: one column, and aligned with the other side.
    expect(slots.map((slot) => slot.pname)).toEqual(['id']);
    expect(result.relations[0]?.columnsAligned).toBe(true);
  });

  it('still reads a quoted comma list as two columns (val-02 shape)', () => {
    const relation = semanticsOf('txt-03').relations[0];

    expect(relation?.fromColumns?.columns.map((slot) => slot.empty)).toEqual([false, false]);
    expect(relation?.fromColumns?.columns.map((slot) => slot.pname)).toEqual(['a', 'b']);
  });
});

// ── F4-B2-A: resolution does not depend on where a section is written ─────

/** An `[Entity]` section declaring `columns` in order. */
function entity(name: string, columns: readonly string[], position: number): string {
  return (
    `[Entity]\nPName="${name}"\n` +
    columns
      .map((column) => `Field="I","${column}","Serial","NOT NULL",0,"","",$FFFFFFFF,""\n`)
      .join('') +
    `Position="M",${position},1\n`
  );
}

/** A relation section; the header is a parameter so the `[Relationship]` alias is exercised too. */
function relation(
  header: '[Relation]' | '[Relationship]',
  from: string,
  to: string,
  fields: readonly [string, string],
  position: number,
): string {
  return (
    `${header}\nEntity1="${from}"\nEntity2="${to}"\n` +
    `Fields1="${fields[0]}"\nFields2="${fields[1]}"\n` +
    `RelationType1=1\nRelationType2=3\nPosition="M",0,${position},1,1,R,R,""\n`
  );
}

/**
 * A `RelationResult` with every position dropped.
 *
 * Two documents that declare the same sections in a different order must resolve identically; only
 * `sectionIndex` and the span line numbers may differ, so those are the only fields dropped.
 */
function withoutPositions(result: RelationResult) {
  const endpoint = (side: RelationEndpoint | null) =>
    side === null
      ? null
      : {
          key: side.key,
          declared: side.declared,
          raw: side.raw,
          status: side.status,
          resolvedEntity: side.resolvedEntity,
          candidates: side.candidates,
        };
  const columns = (list: RelationColumnList | null) =>
    list === null
      ? null
      : {
          key: list.key,
          raw: list.raw,
          columns: list.columns.map((column) => ({
            pname: column.pname,
            raw: column.raw,
            index: column.index,
            empty: column.empty,
          })),
        };

  return {
    relations: result.relations.map((entry) => ({
      sectionHeader: entry.sectionHeader,
      pname: entry.pname,
      from: endpoint(entry.from),
      to: endpoint(entry.to),
      fromColumns: columns(entry.fromColumns),
      toColumns: columns(entry.toColumns),
      relationType1: entry.relationType1,
      relationType2: entry.relationType2,
      cardinarity1: entry.cardinarity1,
      cardinarity2: entry.cardinarity2,
      columnsAligned: entry.columnsAligned,
    })),
    danglingEntities: result.danglingEntities.map((entry) => [entry.endpoint, entry.declared]),
    ambiguousEntities: result.ambiguousEntities.map((entry) => [entry.endpoint, entry.declared]),
    danglingColumns: result.danglingColumns.map((entry) => [
      entry.endpoint,
      entry.column,
      entry.entity,
    ]),
    unverifiedColumns: result.unverifiedColumns.map((entry) => [
      entry.endpoint,
      entry.column,
      entry.candidates,
    ]),
    countMismatches: result.countMismatches.map((entry) => [entry.fromCount, entry.toCount]),
  };
}

describe('F4-B2-A — a name resolves the same wherever its section is written', () => {
  it('returns the same result for entity sections declared first and declared last', () => {
    const relations =
      relation('[Relation]', 'alpha', 'beta', ['id', 'a_ref'], 1) +
      relation('[Relationship]', 'beta', 'alpha', ['a_ref', 'id'], 2);
    const entities = entity('alpha', ['id', 'a_ref'], 1) + entity('beta', ['a_ref', 'id'], 2);
    const first = relationsOfText(MANAGER + entities + relations);
    const last = relationsOfText(MANAGER + relations + entities);

    expect(withoutPositions(last)).toEqual(withoutPositions(first));
    // The equality is of two successful resolutions, not of two failures.
    for (const result of [first, last]) {
      expect(result.relations.map((entry) => entry.from?.status)).toEqual(['resolved', 'resolved']);
      expect(result.relations.map((entry) => entry.to?.status)).toEqual(['resolved', 'resolved']);
      expect(result.danglingEntities).toEqual([]);
      expect(result.danglingColumns).toEqual([]);
      expect(result.countMismatches).toEqual([]);
    }
  });

  it('resolves every one of many references to the same entity', () => {
    const references = Array.from({ length: 6 }, (_, index) =>
      relation('[Relation]', 'hub', 'hub', ['id', 'id'], index + 1),
    ).join('');
    const result = relationsOfText(MANAGER + entity('hub', ['id'], 1) + references);

    expect(result.relations).toHaveLength(6);
    expect(
      result.relations.every(
        (entry) => entry.from?.resolvedEntity === 'hub' && entry.to?.resolvedEntity === 'hub',
      ),
    ).toBe(true);
    expect(result.danglingEntities).toEqual([]);
    expect(result.danglingColumns).toEqual([]);
  });

  it('checks each side against its own entity, not the previous side', () => {
    // `left` and `right` share no column name, so reusing one side's set for the other would hide
    // both findings below.
    const result = relationsOfText(
      MANAGER +
        entity('left', ['left_id'], 1) +
        entity('right', ['right_id'], 2) +
        relation('[Relation]', 'left', 'right', ['left_id', 'left_id'], 1) +
        relation('[Relation]', 'right', 'left', ['right_id', 'right_id'], 2),
    );

    expect(result.danglingEntities).toEqual([]);
    expect(
      result.danglingColumns.map((entry) => [entry.endpoint, entry.column, entry.entity]),
    ).toEqual([
      ['Entity2', 'left_id', 'right'],
      ['Entity2', 'right_id', 'left'],
    ]);
  });

  it('checks a wide entity against every declared column on each reference', () => {
    const columns = Array.from({ length: 12 }, (_, index) => `c${index}`);
    const accepted = Array.from({ length: 3 }, (_, index) =>
      relation('[Relation]', 'wide', 'wide', ['c0,c6,c11', 'c0,c6,c11'], index + 1),
    ).join('');
    const complete = relationsOfText(MANAGER + entity('wide', columns, 1) + accepted);

    // c0, the middle c6 and the last c11 all resolve, so the set is complete on every side.
    expect(complete.relations).toHaveLength(3);
    expect(complete.danglingColumns).toEqual([]);
    expect(complete.unverifiedColumns).toEqual([]);

    const missing = relationsOfText(
      MANAGER +
        entity('wide', columns, 1) +
        Array.from({ length: 3 }, (_, index) =>
          relation('[Relation]', 'wide', 'wide', ['c0', 'gone'], index + 1),
        ).join(''),
    );
    // One finding per referencing side: reusing the set must not swallow repeats.
    expect(missing.danglingColumns.map((entry) => [entry.column, entry.entity])).toEqual([
      ['gone', 'wide'],
      ['gone', 'wide'],
      ['gone', 'wide'],
    ]);
  });
});

describe('F4-B2-A — the index follows the flat PName rules (§9.1)', () => {
  it('keeps an empty PName as a name like any other', () => {
    const result = relationsOfText(
      MANAGER + entity('', ['id'], 1) + relation('[Relation]', '', '', ['id', 'id'], 1),
    );

    // `''` is a declared name, so the endpoint resolves; a presence test written as a truthiness
    // check would turn it into a dangling name.
    expect(result.relations[0]?.from).toMatchObject({
      declared: '',
      status: 'resolved',
      resolvedEntity: '',
      candidates: 1,
    });
    expect(result.danglingEntities).toEqual([]);
    expect(result.danglingColumns).toEqual([]);
  });

  it('matches the name byte for byte: no case folding and no trimming', () => {
    const result = relationsOfText(
      MANAGER +
        entity('orders', ['id'], 1) +
        relation('[Relation]', 'Orders', 'orders', ['', 'ID'], 1) +
        relation('[Relation]', ' orders', 'orders', ['', 'id'], 2),
    );

    expect(result.relations[0]?.from).toMatchObject({ declared: 'Orders', status: 'dangling' });
    expect(result.relations[0]?.to?.status).toBe('resolved');
    // `ID` is a different column name than `id`; nothing folds case, here or in the endpoint.
    expect(
      result.danglingColumns.map((entry) => [entry.endpoint, entry.column, entry.entity]),
    ).toEqual([['Entity2', 'ID', 'orders']]);
    expect(result.relations[1]?.from).toMatchObject({ declared: ' orders', status: 'dangling' });
  });

  it('indexes a section by its last PName, not its first', () => {
    const result = relationsOfText(
      MANAGER +
        '[Entity]\nPName="first"\nPName="second"\n' +
        'Field="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n' +
        relation('[Relation]', 'second', 'second', ['id', 'id'], 1) +
        relation('[Relation]', 'first', 'second', ['', ''], 2),
    );

    expect(result.relations[0]?.from).toMatchObject({
      declared: 'second',
      status: 'resolved',
      candidates: 1,
    });
    // The overwritten name is not a name: §4.2 last-wins, `PName` included.
    expect(result.relations[1]?.from).toMatchObject({ declared: 'first', status: 'dangling' });
    expect(result.danglingColumns).toEqual([]);
  });

  it('stays ambiguous when both sections declare the column', () => {
    const result = relationsOfText(
      MANAGER +
        entity('twin', ['id'], 1) +
        entity('twin', ['id'], 2) +
        relation('[Relation]', 'twin', 'twin', ['id', 'id'], 1),
    );

    // A presence-based lookup would bind one `twin` and silently accept `id` (R25). Ambiguity is
    // a count, and the count wins over what either section happens to declare.
    expect(result.relations[0]?.from).toMatchObject({
      status: 'ambiguous',
      resolvedEntity: null,
      candidates: 2,
    });
    expect(result.danglingColumns).toEqual([]);
    expect(result.unverifiedColumns.map((entry) => [entry.column, entry.candidates])).toEqual([
      ['id', 2],
      ['id', 2],
    ]);
  });

  it('leaves a section without a PName unreachable by any name', () => {
    const text =
      MANAGER +
      '[Entity]\nPosition="M",1,1\n' +
      entity('named', ['id'], 2) +
      relation('[Relation]', 'named', 'named', ['id', 'id'], 1) +
      relation('[Relation]', '', 'named', ['', ''], 2);
    const semantics = derivePartialSemantics(classify(scanSource({ text, format: 21 })));

    // A nameless section is an object the file cannot identify; it is not the owner of `''`.
    expect(semantics.danglingEntities.map((entry) => entry.declared)).toEqual(['']);
    expect(semantics.relations[1]?.from).toMatchObject({ declared: '', status: 'dangling' });
    expect(semantics.relations[1]?.to?.status).toBe('resolved');
    const missing = semantics.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'V_MISSING_REQUIRED_KEY',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.severity).toBe('error');
    expect(missing[0]?.span?.keyLine).toBe(3);
  });
});

describe('F4-B2-A — compound relation findings keep their order and their spans', () => {
  it('orders one dangling endpoint, two dangling columns and the mismatch by line', () => {
    const text =
      MANAGER +
      // 3–6: an entity a relation can use
      entity('a', ['id'], 1) +
      // 7–8: a nameless entity, so its missing PName is a finding of its own
      '[Entity]\nPosition="M",2,2\n' +
      // 9–16: one relation carrying both defects
      '[Relation]\nEntity1="a"\nEntity2="ghost"\nFields1="id"\nFields2="x,y"\n' +
      'RelationType1=1\nRelationType2=3\nPosition="M",0,1,1,1,R,R,""\n';
    const semantics = derivePartialSemantics(classify(scanSource({ text, format: 21 })));

    expect(semantics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V_MISSING_REQUIRED_KEY',
      'V_DANGLING_ENTITY',
      'V_DANGLING_COLUMN',
      'V_DANGLING_COLUMN',
      'V_FIELD_COUNT_MISMATCH',
    ]);
    expect(semantics.diagnostics.map((diagnostic) => diagnostic.span?.keyLine)).toEqual([
      7, 11, 13, 13, 13,
    ]);
    // Both columns come from the same `Fields2` line, so list order survives the stable sort.
    expect(
      semantics.diagnostics
        .filter((diagnostic) => diagnostic.code === 'V_DANGLING_COLUMN')
        .map((diagnostic) => diagnostic.details),
    ).toEqual([
      { endpoint: 'Entity2', column: 'x', entity: null },
      { endpoint: 'Entity2', column: 'y', entity: null },
    ]);
    expect(semantics.diagnostics[4]?.details).toEqual({ from: 1, to: 2 });
  });
});
