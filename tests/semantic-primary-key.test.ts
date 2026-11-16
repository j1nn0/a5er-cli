/**
 * Primary-key inference (`architecture.md` §9.2, P8, §11 `V_PK_ORDER_CONFLICT`).
 *
 * The format stores a key as `Field` element 5, `キー順` — a `0`-based ordinal and nothing else (P8).
 * The assertions below therefore read the *declared* ordinals out of the fixture and check three
 * properties:
 *
 * 1. the inferred key's columns are the declared ones, sorted by ordinal, with `origin: 'inferred'`
 *    and every contributing `Field` span cited;
 * 2. a sequence that is not a key is reported and **left alone** — no renumbering, no filled gaps;
 * 3. an ordinal that could not be decoded exactly (R19) contributes nothing, rather than becoming a
 *    `0` the file never wrote.
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { primaryKeysOf } from '../src/semantic/primary-key.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { semanticsOf } from './helpers/classified.js';

/** Primary-key findings of an inline document. */
function keysOfText(text: string) {
  return primaryKeysOf(classify(scanSource({ text, format: 21 })));
}

describe('an inferred key is declared, sorted and cited (§9.2, §4.2)', () => {
  it('reads the composite key 0,1,2 in order (val-06)', () => {
    const semantics = semanticsOf('val-06');
    const key = semantics.primaryKeys[0];

    expect(semantics.primaryKeys).toHaveLength(1);
    expect(key?.object).toBe('memberships');
    expect(key?.origin).toBe('inferred');
    expect(key?.columns.map((column) => [column.ordinal, column.pname])).toEqual([
      [0, 'user_id'],
      [1, 'group_id'],
      [2, 'role'],
    ]);
    // Every contributing line is cited, so the inference travels with its inputs (§4.2).
    expect(key?.derivedFrom.map((span) => span.keyLine)).toEqual([5, 6, 7]);
    expect(key?.columns.map((column) => column.span.keyLine)).toEqual([5, 6, 7]);
    expect(semantics.pkConflicts).toEqual([]);
    expect(semantics.diagnostics).toEqual([]);
  });

  it('sorts by ordinal, not by declaration order (synthetic edge)', () => {
    const result = keysOfText(
      '[Entity]\nPName="t"\n' +
        'Field="B","b","Integer","",1,"","",$FFFFFFFF,"",""\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.keys[0]?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
    expect(result.conflicts).toEqual([]);
  });

  it('infers one key per entity, and none for a view or a field-less entity (fmt-01, sem-11)', () => {
    const fmt = semanticsOf('fmt-01');
    expect(fmt.primaryKeys.map((key) => key.object)).toEqual(['users', 'orders']);
    expect(fmt.primaryKeys.map((key) => key.columns.map((column) => column.pname))).toEqual([
      ['id'],
      ['id'],
    ]);

    expect(semanticsOf('sem-11').primaryKeys).toEqual([]);
  });

  it('uses only the declared ordinals: an empty slot is not a key part (fmt-01)', () => {
    // The second column of the first entity has an empty キー順, so the key is `id` alone.
    const key = semanticsOf('fmt-01').primaryKeys[0];
    expect(key?.columns).toHaveLength(1);
    expect(key?.columns[0]?.span.keyLine).toBe(11);
  });
});

describe('a sequence that is not a key is reported, never repaired', () => {
  it('reports the gap 0,2 and keeps the ordinals as declared (val-09)', () => {
    const semantics = semanticsOf('val-09');
    const conflict = semantics.pkConflicts[0];

    expect(semantics.pkConflicts).toHaveLength(1);
    expect(conflict).toMatchObject({ object: 'gap_pk', reason: 'gap', ordinals: [0, 2] });
    expect(conflict?.spans.map((span) => span.keyLine)).toEqual([8, 9]);
    // No repair: the columns keep 0 and 2, they are not renumbered to 0 and 1.
    expect(semantics.primaryKeys[0]?.columns.map((column) => column.ordinal)).toEqual([0, 2]);

    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_PK_ORDER_CONFLICT'],
    );
    expect(semantics.diagnostics[0]?.severity).toBe('warning');
    expect(semantics.diagnostics[0]?.span).toEqual({
      sectionIndex: 2,
      startLine: 8,
      endLine: 8,
      keyLine: 8,
    });
    expect(semantics.diagnostics[0]?.details).toEqual({
      object: 'gap_pk',
      ordinals: '0,2',
      reason: 'gap',
    });
  });

  it('reports repeated ordinals instead of dropping one', () => {
    const result = keysOfText(
      '[Entity]\nPName="dup"\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Field="B","b","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.conflicts[0]).toMatchObject({ reason: 'duplicate', ordinals: [0, 0] });
    expect(result.keys[0]?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
  });

  it('reports a sequence that does not start at zero', () => {
    const result = keysOfText(
      '[Entity]\nPName="late"\n' +
        'Field="A","a","Integer","",1,"","",$FFFFFFFF,"",""\n' +
        'Field="B","b","Integer","",2,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.conflicts[0]).toMatchObject({ reason: 'not-zero-based', ordinals: [1, 2] });
  });

  it('conflicts never crash a document whose Field counts disagree (sem-03)', () => {
    // sem-03's finding is the relation's column-count mismatch, which is out of scope here; the key
    // inference must simply keep working on both entities.
    const semantics = semanticsOf('sem-03');

    expect(semantics.primaryKeys.map((key) => key.object)).toEqual(['parent_a', 'child_b']);
    expect(semantics.primaryKeys.map((key) => key.columns.length)).toEqual([2, 3]);
    expect(semantics.pkConflicts).toEqual([]);
    // Nothing invented for the out-of-scope area: no V_FIELD_COUNT_MISMATCH from this unit.
    expect(semantics.diagnostics).toEqual([]);
  });
});

describe('R19 protects the inference from unrepresentable ordinals', () => {
  it('contributes no column for an unsafe ordinal, and reports no key', () => {
    const result = keysOfText(
      '[Entity]\nPName="unsafe"\n' +
        'Field="A","a","Integer","",9007199254740993,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    // `Number()` would have rounded it to ...992 and produced a key from a number the file never wrote.
    expect(result.keys).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('keeps the safe ordinals of a value that also carries an unsafe one', () => {
    const result = keysOfText(
      '[Entity]\nPName="mixed"\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Field="B","b","Integer","",999999999999999999999999,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.keys[0]?.columns.map((column) => column.pname)).toEqual(['a']);
    expect(result.conflicts).toEqual([]);
  });
});
