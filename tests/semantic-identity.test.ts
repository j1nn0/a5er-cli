/**
 * Identity and duplicate names (`architecture.md` §9.1, P6, §11 `V_DUPLICATE_OBJECT_NAME`).
 *
 * The rule under test is one sentence of the specification — a physical name is unique across *all*
 * objects — and the two properties that make it safe: nothing is deduplicated, and a `Position` line
 * places an object rather than creating one.
 *
 * Span and count conventions come from the catalog, not from the implementation: sem-08 declares an
 * entity and a view with one name and expects exactly one `V_DUPLICATE_OBJECT_NAME`, with both
 * `PName` lines exhibited.
 */

import { describe, expect, it } from 'vitest';
import { identitiesOf } from '../src/semantic/identity.js';
import { classify } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';

/** Identity findings of an inline document. */
function identitiesOfText(text: string) {
  return identitiesOf(classify(scanSource({ text, format: 21 })));
}

describe('every object is an identity, duplicates and all (§9.1)', () => {
  it('keeps both objects that share a name (sem-08)', () => {
    const { identities, duplicates } = identitiesOf(classificationOf('sem-08'));

    expect(identities.map((identity) => [identity.kind, identity.pname])).toEqual([
      ['Entity', 'twin'],
      ['View', 'twin'],
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.pname).toBe('twin');
    // Both declaring lines are cited, in file order, and both objects survive.
    expect(duplicates[0]?.spans.map((span) => span.keyLine)).toEqual([7, 12]);
    expect(duplicates[0]?.identities.map((identity) => identity.sectionIndex)).toEqual([2, 3]);
  });

  it('emits one error on the later declaration (sem-08)', () => {
    const semantics = semanticsOf('sem-08');
    const duplicate = semantics.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'V_DUPLICATE_OBJECT_NAME',
    );

    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe('error');
    expect(duplicate[0]?.details).toEqual({ pname: 'twin', occurrences: 2 });
    expect(duplicate[0]?.span).toEqual({
      sectionIndex: 3,
      startLine: 12,
      endLine: 12,
      keyLine: 12,
    });
  });

  it('reports nothing when every name is unique (fmt-01, txt-01)', () => {
    for (const id of ['fmt-01', 'txt-01']) {
      const { identities, duplicates } = identitiesOf(classificationOf(id));
      expect(duplicates, id).toEqual([]);
      expect(identities.length, id).toBeGreaterThan(0);
    }
    expect(identitiesOf(classificationOf('txt-01')).identities).toHaveLength(5);
  });

  it('counts [Subtype] as an object kind (sem-05)', () => {
    const { identities } = identitiesOf(classificationOf('sem-05'));

    expect(identities.map((identity) => identity.kind)).toEqual(['Entity', 'Subtype']);
    expect(identities[1]?.pname).toBe('unknown_membership');
  });

  it('never treats [Manager] or an unknown section as an object', () => {
    const { identities } = identitiesOf(classificationOf('txt-04'));
    expect(identities.map((identity) => identity.kind)).toEqual(['Entity']);

    const hostile = identitiesOf(classificationOf('hst-04')).identities;
    // `[<script>]` and `[[Entity]]` have no registry, so they declare no object.
    expect(hostile.map((identity) => identity.sectionHeader)).toEqual(['[Entity]']);
  });
});

describe('one object per section, one placement per Position (§P11)', () => {
  it('keeps a multi-page object as a single identity with several placements', () => {
    const result = identitiesOfText(
      '[Entity]\nPName="two_pages"\nField="I","i","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",10,10\nPosition="Detail",20,20\nPosition="Other",30,30\n',
    );

    expect(result.identities).toHaveLength(1);
    expect(result.identities[0]?.placements).toBe(3);
    expect(result.duplicates).toEqual([]);
  });

  it('keeps three same-named objects as three identities', () => {
    const result = identitiesOfText(
      ['[Entity]', 'PName="same"', 'Position="Main",1,1', ''].join('\n') +
        ['[View]', 'PName="same"', 'Position="Main",2,2', ''].join('\n') +
        ['[Subtype]', 'PName="same"', 'Position="Main",3,3', ''].join('\n'),
    );

    expect(result.identities).toHaveLength(3);
    expect(result.identities.map((identity) => identity.kind)).toEqual([
      'Entity',
      'View',
      'Subtype',
    ]);
    expect(result.duplicates[0]?.identities).toHaveLength(3);
  });

  it('uses the last PName when one section repeats it, citing every span', () => {
    // A repeated scalar is already `S_DUPLICATE_KEY`; identity takes the selected value (§4.2).
    const result = identitiesOfText(
      '[Entity]\nPName="first"\nPName="second"\nPosition="Main",1,1\n',
    );

    expect(result.identities).toHaveLength(1);
    expect(result.identities[0]?.pname).toBe('second');
    expect(result.identities[0]?.spans.map((span) => span.keyLine)).toEqual([2, 3]);
  });

  it('emits no duplicate finding for a name only one kind declares', () => {
    const semantics = semanticsOf('sem-05');
    assertCodes(
      semantics.diagnostics
        .filter((diagnostic) => diagnostic.code === 'V_DUPLICATE_OBJECT_NAME')
        .map((diagnostic) => diagnostic.code),
      [],
    );
  });
});
