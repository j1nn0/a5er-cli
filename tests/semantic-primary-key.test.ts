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
import { classificationOf, semanticsOf } from './helpers/classified.js';

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
    // sem-03's own finding is the relation's column-count mismatch; the key inference must simply
    // keep working on both entities, and must not emit a PK conflict for either.
    const result = primaryKeysOf(classificationOf('sem-03'));

    expect(result.keys.map((key) => key.object)).toEqual(['parent_a', 'child_b']);
    expect(result.keys.map((key) => key.columns.length)).toEqual([2, 3]);
    expect(result.conflicts).toEqual([]);
    expect(result.indeterminate).toEqual([]);
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

describe('R23 — an odd ordinal does not disappear from the key', () => {
  it('tracks every unusable ordinal with its text and line', () => {
    const result = keysOfText(
      '[Entity]\nPName="all_bad"\n' +
        'Field="A","a","Integer","",9007199254740993,"","",$FFFFFFFF,"",""\n' +
        'Field="B","b","Integer","",nope,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    // Nothing usable → no key at all, but the evidence is not lost.
    expect(result.keys).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.indeterminate).toHaveLength(1);
    expect(result.indeterminate[0]?.object).toBe('all_bad');
    expect(result.indeterminate[0]?.invalidOrdinals.map((ordinal) => ordinal.raw)).toEqual([
      '9007199254740993',
      'nope',
    ]);
    expect(result.indeterminate[0]?.invalidOrdinals.map((ordinal) => ordinal.span.keyLine)).toEqual(
      [3, 4],
    );
  });

  it('marks a partially usable key as incomplete rather than presenting the subset', () => {
    const result = keysOfText(
      '[Entity]\nPName="mixed"\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Field="B","b","Integer","",9007199254740993,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );
    const key = result.keys[0];

    // The safe column is reported — it is real evidence — but never as the whole key.
    expect(key?.columns.map((column) => column.pname)).toEqual(['a']);
    expect(key?.invalidOrdinals).toHaveLength(1);
    expect(key?.invalidOrdinals[0]?.raw).toBe('9007199254740993');
    expect(result.indeterminate).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
  });

  it('reports no invalid ordinals for a complete composite key (val-06)', () => {
    const result = primaryKeysOf(classificationOf('val-06'));

    expect(result.keys[0]?.invalidOrdinals).toEqual([]);
    expect(result.indeterminate).toEqual([]);
  });

  it('does not count an empty key-order slot as an invalid ordinal (fmt-01)', () => {
    const result = primaryKeysOf(classificationOf('fmt-01'));

    expect(result.keys.map((key) => key.invalidOrdinals)).toEqual([[], []]);
    expect(result.indeterminate).toEqual([]);
  });
});

describe('R24 — a conflict quotes the file: ordinals and spans in declaration order', () => {
  it('pairs ordinals[i] with spans[i] as written, while the columns stay sorted', () => {
    // Declared deliberately out of order: B has ordinal 2 and comes first, A has 0.
    const result = keysOfText(
      '[Entity]\nPName="reordered"\n' +
        'Field="B","b","Integer","",2,"","",$FFFFFFFF,"",""\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );
    const conflict = result.conflicts[0];
    const key = result.keys[0];

    expect(conflict?.ordinals).toEqual([2, 0]);
    expect(conflict?.spans.map((span) => span.keyLine)).toEqual([3, 4]);
    // The pairing is the point: ordinal 2 belongs to line 3 (`b`), 0 to line 4 (`a`).
    expect(conflict?.spans[0]?.keyLine).toBe(key?.columns[1]?.span.keyLine);
    expect(conflict?.spans[1]?.keyLine).toBe(key?.columns[0]?.span.keyLine);
    // The sorted view is the key itself, and it stays sorted with matched provenance.
    expect(key?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
    expect(key?.columns.map((column) => column.ordinal)).toEqual([0, 2]);
    expect(key?.derivedFrom.map((span) => span.keyLine)).toEqual([4, 3]);
  });

  it('does not report a conflict for a valid key declared out of order', () => {
    const result = keysOfText(
      '[Entity]\nPName="ordered"\n' +
        'Field="B","b","Integer","",1,"","",$FFFFFFFF,"",""\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.conflicts).toEqual([]);
    expect(result.keys[0]?.columns.map((column) => column.pname)).toEqual(['a', 'b']);
  });

  it('keeps declaration order in the duplicate case too', () => {
    const result = keysOfText(
      '[Entity]\nPName="dup2"\n' +
        'Field="B","b","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Field="A","a","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",1,1\n',
    );

    expect(result.conflicts[0]?.ordinals).toEqual([0, 0]);
    expect(result.conflicts[0]?.spans.map((span) => span.keyLine)).toEqual([3, 4]);
  });
});
