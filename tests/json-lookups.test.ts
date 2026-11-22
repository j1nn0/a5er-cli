/**
 * `tests/json-lookups.test.ts` — the first-wins section lookups of the JSON projection (F4-B1a).
 *
 * The projection used `.find()` to reach the semantic record and the classified section an object
 * or relation names, which is O(sections × records) on a large diagram. It now indexes those
 * collections once per `serialize()` call. What must not change is *which* record is used: `.find()`
 * answers with the **first** match, so the index has to as well — an index built with
 * `new Map(records.map(...))` would silently keep the last one and hand a different key, a
 * different query or a different span to the envelope.
 *
 * Two synthetic documents provide the sections. The base document declares one entity with a usable
 * ordinal, one whose ordinal did not decode, one view, one subtype and one relation; the interleaved
 * document alternates entity/view/relation/subtype so the file order of the output is observable.
 * The duplicate records are built from the real ones — one field overridden, so the assertion names
 * the one field the lookup decides — and inserted *before* and *after* the real record, which is how
 * a first-wins index and a last-wins index are told apart.
 *
 * Runs in-process over the real four stages; nothing is spawned and nothing is committed.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type {
  JsonEntityObject,
  JsonEnvelope,
  JsonObject,
  JsonRelation,
  JsonSubtypeObject,
  JsonViewObject,
} from '../src/json/index.js';
import { serialize } from '../src/json/index.js';
import type { Classification, ClassifiedSection } from '../src/schema/registry.js';
import { classify } from '../src/schema/registry.js';
import type { PartialSemantics } from '../src/semantic/partial.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { LoadedIntegrationInput } from '../src/validate/index.js';

/** A caller-supplied context; the path is echoed and never resolved. */
const CONTEXT = { command: 'inspect', path: '/tmp/lookups.a5er' } as const;

/**
 * Sections 1–6: `[Manager]`, `[Entity] e1` (one usable ordinal), `[Entity] e2` (an ordinal that did
 * not decode, so its key is `indeterminate`), `[View] v1`, `[Subtype] s1`, `[Relation] r1`.
 */
const BASE = [
  '# A5:ER FORMAT:21',
  '# A5:ER ENCODING:UTF8',
  '',
  '[Manager]',
  'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
  '',
  '[Entity]',
  'PName="e1"',
  'LName="l1"',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
  'Position="Main",10,10',
  '',
  '[Entity]',
  'PName="e2"',
  'LName="l2"',
  'Field="","","","",x,"","",$FFFFFFFF,"",""',
  'Position="Main",20,20',
  '',
  '[View]',
  'PName="v1"',
  'Position="Main",30,30',
  '',
  '[Subtype]',
  'PName="s1"',
  'Position="Main",40,40',
  '',
  '[Relation]',
  'PName="r1"',
  'Entity1="e1"',
  'Entity2="e2"',
  'Position="Main",50,50',
  '',
].join('\n');

/**
 * Sections 1–8: `[Manager]`, entity `e1`, view `v1`, relation `r1`, entity `e2`, subtype `s1`,
 * view `v2`, relation `r2`. The relations resolve document-wide, so `r1` may name `e2` before it is
 * declared.
 */
const INTERLEAVED = [
  '# A5:ER FORMAT:21',
  '# A5:ER ENCODING:UTF8',
  '',
  '[Manager]',
  'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
  '',
  '[Entity]',
  'PName="e1"',
  'LName="l1"',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
  'Position="Main",10,10',
  '',
  '[View]',
  'PName="v1"',
  'Position="Main",20,20',
  '',
  '[Relation]',
  'PName="r1"',
  'Entity1="e1"',
  'Entity2="e2"',
  'Position="Main",30,30',
  '',
  '[Entity]',
  'PName="e2"',
  'LName="l2"',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
  'Position="Main",40,40',
  '',
  '[Subtype]',
  'PName="s1"',
  'Position="Main",50,50',
  '',
  '[View]',
  'PName="v2"',
  'Position="Main",60,60',
  '',
  '[Relation]',
  'PName="r2"',
  'Entity1="e2"',
  'Entity2="e1"',
  'Position="Main",70,70',
  '',
].join('\n');

/** Run the real four stages over a synthetic document written to a throwaway path. */
function inputFromText(text: string): LoadedIntegrationInput {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-lookups-'));
  try {
    const path = join(directory, 'lookups.a5er');
    writeFileSync(path, text, 'utf8');
    const load = loadSource(path);
    if (!load.ok) throw new Error('the synthetic document did not load');
    const scan = scanSource(load.source);
    const classification = classify(scan);
    return { load, scan, classification, semantics: derivePartialSemantics(classification) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The same input with some semantic collections replaced; nothing else is touched. */
function withSemantics(
  input: LoadedIntegrationInput,
  overrides: Partial<PartialSemantics>,
): LoadedIntegrationInput {
  return { ...input, semantics: { ...input.semantics, ...overrides } };
}

/** The same input with a different section list; the classification's own counts stay as they are. */
function withSections(
  input: LoadedIntegrationInput,
  sections: readonly ClassifiedSection[],
): LoadedIntegrationInput {
  return { ...input, classification: { ...input.classification, sections } };
}

/** The semantic record for one section, or a thrown error naming the layout this file assumes. */
function recordFor<T extends { readonly sectionIndex: number }>(
  records: readonly T[],
  sectionIndex: number,
): T {
  const record = records.find((candidate) => candidate.sectionIndex === sectionIndex);
  if (record === undefined) throw new Error(`no record for section ${String(sectionIndex)}`);
  return record;
}

/** The classified section with one ordinal, or a thrown error naming the assumed layout. */
function sectionFor(classification: Classification, index: number): ClassifiedSection {
  const section = classification.sections.find((candidate) => candidate.index === index);
  if (section === undefined) throw new Error(`no section ${String(index)}`);
  return section;
}

function objectsOf(envelope: JsonEnvelope): readonly JsonObject[] {
  const schema = envelope.schema;
  if (schema === null) throw new Error('the envelope has no schema');
  return schema.objects;
}

function entityOf(envelope: JsonEnvelope, pname: string): JsonEntityObject {
  const object = objectsOf(envelope).find(
    (candidate) => candidate.kind === 'entity' && candidate.pname?.value === pname,
  );
  if (object === undefined || object.kind !== 'entity') throw new Error(`no entity ${pname}`);
  return object;
}

function viewOf(envelope: JsonEnvelope, pname: string): JsonViewObject {
  const object = objectsOf(envelope).find(
    (candidate) => candidate.kind === 'view' && candidate.pname?.value === pname,
  );
  if (object === undefined || object.kind !== 'view') throw new Error(`no view ${pname}`);
  return object;
}

function subtypeOf(envelope: JsonEnvelope, pname: string): JsonSubtypeObject {
  const object = objectsOf(envelope).find(
    (candidate) => candidate.kind === 'subtype' && candidate.pname?.value === pname,
  );
  if (object === undefined || object.kind !== 'subtype') throw new Error(`no subtype ${pname}`);
  return object;
}

function relationsOf(envelope: JsonEnvelope): readonly JsonRelation[] {
  const schema = envelope.schema;
  if (schema === null) throw new Error('the envelope has no schema');
  return schema.relations;
}

function relationOf(envelope: JsonEnvelope): JsonRelation {
  const relation = relationsOf(envelope).at(0);
  if (relation === undefined) throw new Error('the envelope has no relation');
  return relation;
}

/** The message `serialize` throws for this input, or a thrown error saying it did not throw. */
function serializeError(input: LoadedIntegrationInput): string {
  try {
    serialize(input, CONTEXT);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('serialize did not throw');
}

describe('first-wins section lookups', () => {
  it('keeps the first inferred primary key of a section', () => {
    const input = inputFromText(BASE);
    const real = recordFor(input.semantics.primaryKeys, 2);
    // Same object, no columns: only the lookup decides whether the envelope shows the key or not.
    const synthetic = { ...real, columns: [] };

    const first = {
      ...input,
      semantics: { ...input.semantics, primaryKeys: [synthetic, ...input.semantics.primaryKeys] },
    };
    const last = {
      ...input,
      semantics: { ...input.semantics, primaryKeys: [...input.semantics.primaryKeys, synthetic] },
    };

    const firstKey = entityOf(serialize(first, CONTEXT), 'e1').primaryKey;
    expect(firstKey.status).toBe('inferred');
    expect(firstKey.status === 'inferred' ? firstKey.value : null).toEqual([]);

    const lastKey = entityOf(serialize(last, CONTEXT), 'e1').primaryKey;
    expect(lastKey.status).toBe('inferred');
    expect(lastKey.status === 'inferred' ? lastKey.value : null).toEqual(['id']);
  });

  it('keeps the first indeterminate key of a section', () => {
    const input = inputFromText(BASE);
    const real = recordFor(input.semantics.indeterminateKeys, 3);
    // The real record keeps the ordinal token that did not decode; the copy keeps none.
    const synthetic = { ...real, invalidOrdinals: [] };

    const first = withSemantics(input, {
      indeterminateKeys: [synthetic, ...input.semantics.indeterminateKeys],
    });
    const last = withSemantics(input, {
      indeterminateKeys: [...input.semantics.indeterminateKeys, synthetic],
    });

    const firstKey = entityOf(serialize(first, CONTEXT), 'e2').primaryKey;
    expect(firstKey.status).toBe('indeterminate');
    expect(firstKey.status === 'indeterminate' ? firstKey.invalidOrdinals : null).toEqual([]);

    const lastKey = entityOf(serialize(last, CONTEXT), 'e2').primaryKey;
    expect(lastKey.status).toBe('indeterminate');
    expect(
      lastKey.status === 'indeterminate'
        ? lastKey.invalidOrdinals.map((ordinal) => ordinal.raw)
        : null,
    ).toEqual(['x']);
  });

  it('keeps the first effective-columns record of a section', () => {
    const input = inputFromText(BASE);
    const real = recordFor(input.semantics.entityColumns, 2);
    const synthetic = { ...real, effective: [], declared: [], common: [] };

    const first = withSemantics(input, {
      entityColumns: [synthetic, ...input.semantics.entityColumns],
    });
    const last = withSemantics(input, {
      entityColumns: [...input.semantics.entityColumns, synthetic],
    });

    expect(entityOf(serialize(first, CONTEXT), 'e1').effectiveColumns.columns).toHaveLength(0);
    expect(entityOf(serialize(last, CONTEXT), 'e1').effectiveColumns.columns).toHaveLength(1);
  });

  it('keeps the first view record of a section', () => {
    const input = inputFromText(BASE);
    const real = recordFor(input.semantics.views, 4);
    // The real view declares no `Query`, so the copy's query is visible only if the copy is used.
    expect(real.query).toBeNull();
    const synthetic = { ...real, query: 'synthetic' };

    const first = withSemantics(input, { views: [synthetic, ...input.semantics.views] });
    const last = withSemantics(input, { views: [...input.semantics.views, synthetic] });

    expect(viewOf(serialize(first, CONTEXT), 'v1').query).toBe('synthetic');
    expect(viewOf(serialize(last, CONTEXT), 'v1').query).toBeNull();
  });

  it('keeps the first subtype record of a section', () => {
    const input = inputFromText(BASE);
    const real = recordFor(input.semantics.subtypes, 5);
    const synthetic = {
      ...real,
      span: { ...real.span, startLine: 4242, endLine: 4242, keyLine: 4242 },
    };

    const first = withSemantics(input, { subtypes: [synthetic, ...input.semantics.subtypes] });
    const last = withSemantics(input, { subtypes: [...input.semantics.subtypes, synthetic] });

    expect(subtypeOf(serialize(first, CONTEXT), 's1').span.startLine).toBe(4242);
    expect(subtypeOf(serialize(last, CONTEXT), 's1').span.startLine).toBe(real.span.startLine);
  });

  it('keeps the first classified section of an ordinal', () => {
    const input = inputFromText(BASE);
    const real = sectionFor(input.classification, 6);
    // Same ordinal, no entries: the relation's own `PName` and its header line both disappear.
    const synthetic = {
      ...real,
      entries: [],
      defaults: [],
      span: { ...real.span, startLine: 4242, endLine: 4242, keyLine: 4242 },
    };

    const first = withSections(input, [synthetic, ...input.classification.sections]);
    const last = withSections(input, [...input.classification.sections, synthetic]);

    const fromCopy = relationOf(serialize(first, CONTEXT));
    expect(fromCopy.pname).toBeNull();
    expect(fromCopy.span.keyLine).toBe(4242);

    // `[Relation]`'s `PName` is line 28 of `BASE`.
    const fromReal = relationOf(serialize(last, CONTEXT));
    expect(fromReal.pname?.value).toBe('r1');
    expect(fromReal.span.keyLine).toBe(28);
  });
});

describe('missing records and sections', () => {
  it('names a section the classification does not have', () => {
    const input = inputFromText(BASE);
    const sections = input.classification.sections.filter((section) => section.index !== 6);
    expect(serializeError(withSections(input, sections))).toBe(
      'json envelope: section 6 is missing from the scan',
    );
  });

  it('names the effective columns a section has no record for', () => {
    const input = inputFromText(BASE);
    const entityColumns = input.semantics.entityColumns.filter(
      (record) => record.sectionIndex !== 2,
    );
    expect(serializeError(withSemantics(input, { entityColumns }))).toBe(
      'json envelope: effective columns for section 2 is missing from the semantics',
    );
  });

  it('names the view a section has no record for', () => {
    const input = inputFromText(BASE);
    const views = input.semantics.views.filter((record) => record.sectionIndex !== 4);
    expect(serializeError(withSemantics(input, { views }))).toBe(
      'json envelope: view for section 4 is missing from the semantics',
    );
  });

  it('names the subtype a section has no record for', () => {
    const input = inputFromText(BASE);
    const subtypes = input.semantics.subtypes.filter((record) => record.sectionIndex !== 5);
    expect(serializeError(withSemantics(input, { subtypes }))).toBe(
      'json envelope: subtype for section 5 is missing from the semantics',
    );
  });
});

describe('output order', () => {
  it('projects objects and relations in file order', () => {
    const envelope = serialize(inputFromText(INTERLEAVED), CONTEXT);

    // Sections 1–8 in declaration order; the projections below must follow it, not the index.
    expect(objectsOf(envelope).map((object) => [object.kind, object.sectionIndex])).toEqual([
      ['entity', 2],
      ['view', 3],
      ['entity', 5],
      ['subtype', 6],
      ['view', 7],
    ]);
    expect(relationsOf(envelope).map((relation) => relation.sectionIndex)).toEqual([4, 8]);
    expect(relationsOf(envelope).map((relation) => relation.pname?.value)).toEqual(['r1', 'r2']);
  });
});
