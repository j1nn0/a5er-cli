/**
 * `schema/position.ts` — one key, three grammars (`§4.5`, §6 F1, P9, P11, K12).
 *
 * `Position` is the key that proves the registry has to be section-scoped: `[Entity]` writes
 * `"ページ名",X,Y[,幅,高さ]` and `[Relation]` writes an eight-element line geometry under the *same
 * name*. A decoder dispatched on the key alone would read a relation's terminal positions as an
 * object's width and height, which is exactly the class of silent corruption this project exists to
 * prevent.
 *
 * Two things are deliberately *not* done here: page names are not matched (the resolver's
 * case-insensitive rule, P9), and geometry that the documents do not define is not interpreted — it
 * becomes an `unsupported` record with its elements intact.
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import type { Classification } from '../src/schema/registry.js';
import { decodePosition, positionShapeOf } from '../src/schema/position.js';
import { splitComplex } from '../src/syntax/complex.js';
import type { Span } from '../src/model/span.js';
import { scanSource } from '../src/syntax/scanner.js';
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

/** Every decoded Position of a fixture, in file order. */
function positionsOf(id: string) {
  return classificationOf(id).sections.flatMap((section) => section.decoded.positions);
}

const SPAN: Span = { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 };

/** Decode one `Position` value for a section kind, going through the real tokeniser. */
function decode(kind: Parameters<typeof decodePosition>[0], value: string) {
  const parts = splitComplex(value, SPAN);
  return decodePosition(
    kind,
    { parts: parts.parts, trailingElementsOmitted: parts.trailingElementsOmitted },
    SPAN,
    value,
  );
}

describe('the object shape: "ページ名",X,Y[,幅,高さ] (P11)', () => {
  it('decodes three elements (fmt-01 entity)', () => {
    const position = positionsOf('fmt-01').find((entry) => entry.kind === 'object');
    if (position === undefined) throw new Error('no object position');

    expect(position.elementsSeen).toBe(3);
    expect(position.page.value).toBe('Main');
    expect(position.page.origin).toBe('declared');
    expect(position.x?.value).toBe(1000);
    expect(position.y?.value).toBe(2000);
    expect(position.width).toBeNull();
    expect(position.height).toBeNull();
    // Coordinates are integers in 0.1 mm units (P11); the raw token stays available.
    expect(position.x?.raw).toBe('1000');
  });

  it('decodes five elements, where width and height are declared (synthetic edge)', () => {
    const position = decode('Entity', '"Main",10,20,300,400');

    expect(position.kind).toBe('object');
    if (position.kind !== 'object') throw new Error('expected an object shape');
    expect(position.elementsSeen).toBe(5);
    expect([
      position.x?.value,
      position.y?.value,
      position.width?.value,
      position.height?.value,
    ]).toEqual([10, 20, 300, 400]);
  });

  it('records a four-element position as unsupported instead of inventing a height', () => {
    const position = decode('Entity', '"Main",10,20,300');

    expect(position.kind).toBe('unsupported');
    if (position.kind !== 'unsupported') throw new Error('expected an unsupported record');
    expect(position.reason).toBe('unexpected-element-count');
    expect(position.elementsSeen).toBe(4);
    expect(position.rawElements.map((element) => element.raw)).toEqual([
      '"Main"',
      '10',
      '20',
      '300',
    ]);
  });

  it('does not coerce a non-integer coordinate (synthetic edge)', () => {
    const position = decode('Entity', '"Main",10.5,20');

    if (position.kind !== 'object') throw new Error('expected an object shape');
    expect(position.x).toBeNull();
    expect(position.rawElements[1]?.raw).toBe('10.5');
    expect(position.y?.value).toBe(20);
  });
});

describe('the relation shape: eight elements with terminals and vertices (P9)', () => {
  it('decodes every documented element (txt-03)', () => {
    const relation = positionsOf('txt-03').find((entry) => entry.kind === 'relation');
    if (relation === undefined) throw new Error('no relation position');

    expect(relation.elementsSeen).toBe(8);
    expect(relation.page.value).toBe('Main');
    expect(relation.lineMode?.value).toBe(0);
    expect(relation.linePositions.map((value) => value?.value)).toEqual([400, 400, 400]);
    expect(relation.terminals.map((terminal) => terminal.value)).toEqual(['R', 'R']);
    expect(relation.vertices.value).toBe('');
    expect(relation.vertices.raw).toBe('""');
  });

  it('keeps the vertex list whole: its inner format is never defined (K12)', () => {
    const relation = decode('Relation', '"Main",3,0,10000,5000,R,L,"10,20;30,40"');

    if (relation.kind !== 'relation') throw new Error('expected the relation shape');
    // The outer list is `;`-separated, but a point's inner format is undefined, so it is not split.
    expect(relation.vertices.value).toBe('10,20;30,40');
    expect(relation.terminals.map((terminal) => terminal.value)).toEqual(['R', 'L']);
    expect(relation.lineMode?.value).toBe(3);
  });

  it('records a seven-element relation position as unsupported', () => {
    const position = decode('Relation', '"Main",0,500,500,500,R,R');

    expect(position.kind).toBe('unsupported');
    if (position.kind !== 'unsupported') throw new Error('expected an unsupported record');
    expect(position.reason).toBe('unexpected-element-count');
    expect(position.rawElements).toHaveLength(7);
  });

  it('reads Shape/Line/Comment positions as undocumented, keeping their elements', () => {
    for (const kind of ['Shape', 'Line', 'Comment'] as const) {
      expect(positionShapeOf(kind), kind).toBe('undocumented');
      const position = decode(kind, '"Main",10,10');
      expect(position.kind, kind).toBe('unsupported');
      if (position.kind !== 'unsupported') throw new Error('expected an unsupported record');
      expect(position.reason, kind).toBe('shape-not-documented');
      expect(
        position.rawElements.map((element) => element.raw),
        kind,
      ).toEqual(['"Main"', '10', '10']);
    }
  });

  it('treats the two shapes as different for the same value (F1)', () => {
    const value = '"Main",0,500,500,500,R,R,""';
    const asObject = decode('Entity', value);
    const asRelation = decode('Relation', value);

    expect(asObject.kind).toBe('unsupported');
    expect(asRelation.kind).toBe('relation');
  });
});

describe('page names and occurrences (P9, P11)', () => {
  it('keeps the page spelling verbatim: resolution is the resolver’s job (sem-02)', () => {
    const position = positionsOf('sem-02').find((entry) => entry.kind === 'object');
    if (position === undefined) throw new Error('no object position');

    // `PageInfo="Main"` and `Position="MAIN"` must both be readable; matching them is deferred.
    expect(position.page.value).toBe('MAIN');
    expect(position.page.raw).toBe('"MAIN"');
  });

  it('keeps a page that names nothing yet (sem-01)', () => {
    const relation = positionsOf('sem-01').find((entry) => entry.kind === 'relation');
    if (relation === undefined) throw new Error('no relation position');

    expect(relation.page.value).toBe('GhostPage');
    // No diagnostic: a dangling page is `V_DANGLING_PAGE`, a validator finding (§9).
    expect(classificationOf('sem-01').diagnostics).toEqual([]);
  });

  it('keeps every occurrence of a multi-page object, in order (fmt-01 relation + entity)', () => {
    const classification = classificationOf('fmt-01');
    const entities = classification.sections.filter((section) => section.kind === 'Entity');
    const relations = classification.sections.filter((section) => section.kind === 'Relation');

    expect(entities.every((section) => section.decoded.positions.length === 1)).toBe(true);
    expect(relations[0]?.decoded.positions).toHaveLength(1);

    const multi = scanSource({
      text:
        '[Entity]\nPName="two_pages"\nField="I","i","Integer","",0,"","",$FFFFFFFF,"",""\n' +
        'Position="Main",10,10\nPosition="Detail",20,20\n',
      format: 21,
    });
    const positions = classify(multi).sections[0]?.decoded.positions ?? [];

    expect(positions).toHaveLength(2);
    expect(
      positions.map((position) => (position.kind === 'object' ? position.page.value : null)),
    ).toEqual(['Main', 'Detail']);
    // ...and `Position` is repeatable, so two occurrences are not a duplicate (§P4).
    expect(classify(multi).diagnostics).toEqual([]);
  });

  it('gives the [Relationship] alias the relation shape (txt-02, §5)', () => {
    const classification = classificationOf('txt-02');
    const sections = classification.sections.filter((section) => section.kind === 'Relation');

    // Two sections, one spelled `[Relation]` and one `[Relationship]`; both decode as relations.
    expect(sections.map((section) => section.headerRaw)).toEqual(['[Relation]', '[Relationship]']);
    for (const section of sections) {
      expect(section.decoded.positions).toHaveLength(1);
      expect(section.decoded.positions[0]?.kind).toBe('relation');
    }
  });

  it('gives [Manager] no position shape at all (positionShapeOf)', () => {
    expect(positionShapeOf('Manager')).toBeNull();
    expect(positionShapeOf('unknown')).toBeNull();
    expect(classificationOf('fmt-01').sections[0]?.decoded.positions).toEqual([]);
  });
});

describe('position decoding leaves interpretation to later stages', () => {
  it('produces no diagnostics: §11 defines none for geometry', () => {
    for (const id of ['fmt-01', 'txt-03', 'sem-01', 'sem-02', 'val-06']) {
      expect(
        classificationOf(id).diagnostics.filter(
          (diagnostic) => !diagnostic.code.startsWith('S_FIELD'),
        ),
        id,
      ).toEqual([]);
    }
  });

  it('keeps raw and value apart for a coordinate', () => {
    const classification = classify(
      scanSource({ text: '[Entity]\nPName="x"\nPosition="Main",10,20\n', format: 21 }),
    );
    const position = classification.sections[0]?.decoded.positions[0];
    if (position?.kind !== 'object') throw new Error('expected an object shape');

    expect(position.y).toMatchObject({ value: 20, raw: '20', origin: 'declared' });
    expect(position.y?.span).toEqual({
      sectionIndex: 1,
      startLine: 3,
      endLine: 3,
      keyLine: 3,
    });
    expect(classification.completeness.keys).toEqual({ total: 2, parsed: 2, preservedRaw: 0 });
  });
});
