/**
 * P1-A — the `tables` projection and its document
 * (`docs/proposals/human-cli.md` §5.2–§5.6, §8.2).
 *
 * What this file pins, and only this:
 *
 * 1. the §5.4 row and omission invariants on real fixtures, staged and run through the real
 *    pipeline: `objects` counts every kind, `tables.length + omitted.subtypes.count` accounts for
 *    all of them, `objectIndex` strictly increases over non-subtype objects, and every copied member
 *    (`sectionIndex`, `span`, `kind`, `pname`, `lname`) equals the object it came from;
 * 2. the three column arms — `complete`, `partial`, `unknown` — with `null` for what the file does
 *    not say, never `0`, and `effective === declared + common` where the composition ran;
 * 3. the omissions and the awkward names: a subtype is counted and cited but never listed, and two
 *    objects with the same `PName` are two rows;
 * 4. the document itself: the key sets of §5.3 in order, no `schema` member, the two status arms of
 *    §5.6, shared members taken by reference, and a throw when status contradicts its nulls;
 * 5. purity — the projection mutates nothing, is a function of its input alone, and shares no
 *    array with it.
 *
 * Expectations are derived from the specification and from the fixtures' own text, never from the
 * serializer's output: the arms that no fixture reaches (a partial entity, an absent or empty
 * name, a subtype alone, no objects at all) are built by patching a real envelope member by member.
 * No real `.a5er` export is ever read (`test-strategy.md` §3.7).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type {
  JsonEntityObject,
  JsonEnvelope,
  JsonSchema,
  JsonTableRow,
  JsonViewObject,
} from '../src/json/index.js';
import { CONTRACT_VERSION, serialize } from '../src/json/index.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import type { IntegrationInput, LoadedIntegrationInput } from '../src/validate/index.js';
import {
  TABLE_COLUMNS_KEYS,
  TABLE_ROW_KEYS,
  TABLE_SPAN_KEYS,
  TABLES_ENVELOPE_KEYS,
  TABLES_OMITTED_KEYS,
  TABLES_OMITTED_SUBTYPES_KEYS,
  TABLES_RESULT_KEYS,
  NOTE_PREFIX,
  projectTables,
  toTablesEnvelope,
} from '../src/view/tables.js';
import { stage } from './helpers/stage.js';

/** Fixtures that between them reach every reachable shape of §5.4. */
const INVARIANT_FIXTURES = [
  'fmt-01', // entity + view, the baseline
  'sem-05', // an entity and a subtype
  'sem-06', // two views, one of each column reason
  'sem-07', // a composed entity and one with UsingCommonColumns=0
  'sem-08', // an entity and a view with the same PName
  'sem-09', // Manager only: no objects at all
  'txt-01', // CJK LNames, three entities and two views
  'txt-04', // an unsupported construct survives alongside the rows
  'val-08', // degraded, with a continuation-line view
  'hst-04', // hostile section headers, one inert entity
  'enc-02', // no BOM
] as const;

/** The real four stages over a path — the same composition `src/cli.ts` runs. */
function inputFromPath(path: string): LoadedIntegrationInput {
  const load = loadSource(path);
  if (!load.ok) throw new Error(`input ${path} did not load`);
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

/** The inspect envelope of a staged fixture, and its schema: what `tables` projects. */
interface ProjectedFixture {
  readonly envelope: JsonEnvelope;
  readonly schema: JsonSchema;
}

/** Stage a committed fixture, project it, and throw the staging away. */
function projectFixture(id: string): ProjectedFixture {
  const staged = stage(id);
  try {
    const envelope = serialize(inputFromPath(staged.path), {
      command: 'inspect',
      path: staged.path,
    });
    const schema = envelope.schema;
    if (schema === null) throw new Error(`${id} produced no schema`);
    return { envelope, schema };
  } finally {
    staged.cleanup();
  }
}

/** The one entity at `index`, or a thrown error naming the fixture. */
function entityAt(schema: JsonSchema, index: number): JsonEntityObject {
  const object = schema.objects[index];
  if (object === undefined || object.kind !== 'entity') {
    throw new Error(`schema.objects[${index}] is not an entity`);
  }
  return object;
}

/** The one view at `index`, or a thrown error naming the fixture. */
function viewAt(schema: JsonSchema, index: number): JsonViewObject {
  const object = schema.objects[index];
  if (object === undefined || object.kind !== 'view') {
    throw new Error(`schema.objects[${index}] is not a view`);
  }
  return object;
}

/** The first row, or a thrown error: every call site here expects exactly one. */
function firstRow(rows: readonly JsonTableRow[]): JsonTableRow {
  const row = rows[0];
  if (row === undefined) throw new Error('the projection listed no rows');
  return row;
}

/** Recursively freeze a value so any mutation attempt throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** A failed read's envelope, written to a throwaway `.a5er` path from committed bytes or text. */
function failedEnvelopeOf(bytes: string | Uint8Array): JsonEnvelope {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-tables-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, bytes);
    const load = loadSource(path);
    if (load.ok) throw new Error('the input was expected to be rejected');
    const input: IntegrationInput = { load };
    return serialize(input, { command: 'inspect', path });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('tables projection — §5.4 invariants over the real pipeline', () => {
  for (const id of INVARIANT_FIXTURES) {
    it(`holds for ${id}`, () => {
      const { schema } = projectFixture(id);
      const result = projectTables(schema);

      // 1. `objects` counts every kind, subtypes included.
      expect(result.objects).toBe(schema.objects.length);
      // 2. nothing is lost: every object is either listed or counted as omitted.
      expect(result.tables.length + result.omitted.subtypes.count).toBe(result.objects);
      // 7. the key sets of §5.3, in order, on the projection itself.
      expect(Object.keys(result)).toEqual([...TABLES_RESULT_KEYS]);
      expect(Object.keys(result.omitted)).toEqual([...TABLES_OMITTED_KEYS]);
      expect(Object.keys(result.omitted.subtypes)).toEqual([...TABLES_OMITTED_SUBTYPES_KEYS]);

      let previousIndex = -1;
      for (const row of result.tables) {
        // 3. positions strictly increase and never point at a subtype.
        expect(row.objectIndex).toBeGreaterThan(previousIndex);
        previousIndex = row.objectIndex;

        const object = schema.objects[row.objectIndex];
        if (object === undefined) throw new Error(`${id}: row ${row.objectIndex} has no object`);
        expect(object.kind).not.toBe('subtype');

        expect(Object.keys(row)).toEqual([...TABLE_ROW_KEYS]);
        expect(Object.keys(row.span)).toEqual([...TABLE_SPAN_KEYS]);
        expect(Object.keys(row.columns)).toEqual([...TABLE_COLUMNS_KEYS]);

        // 4. copied members equal the object they came from, and the span is a new object.
        expect(row.sectionIndex).toBe(object.sectionIndex);
        expect(row.span).toEqual({
          sectionIndex: object.span.sectionIndex,
          startLine: object.span.startLine,
          endLine: object.span.endLine,
          keyLine: object.span.keyLine,
        });
        expect(row.span).not.toBe(object.span);
        expect(row.kind).toBe(object.kind);
        expect(row.pname).toBe(object.pname === null ? null : object.pname.value);
        expect(row.lname).toBe(object.lname === null ? null : object.lname.value);

        // 5. the column arm, decided by the object's kind and its own status.
        if (object.kind === 'entity') {
          const columns = object.effectiveColumns;
          if (columns.status === 'complete') {
            expect(row.columns).toEqual({
              status: 'complete',
              reason: null,
              declared: columns.declared.length,
              common: columns.common.length,
              effective: columns.columns.length,
              collisions: columns.collisions.length,
            });
            // §4.5: the effective list is the declared list followed by the composed one.
            const projected = row.columns;
            if (projected.status !== 'complete') throw new Error(`${id}: row ${row.objectIndex}`);
            expect(projected.effective).toBe(projected.declared + projected.common);
          } else {
            expect(row.columns).toEqual({
              status: 'partial',
              reason: columns.reason,
              declared: columns.declared.length,
              common: null,
              effective: null,
              collisions: null,
            });
          }
        } else if (object.kind === 'view') {
          // A view stores no columns: all four counts are unknown, never zero (§4.5).
          expect(row.columns).toEqual({
            status: 'unknown',
            reason: object.effectiveColumns.reason,
            declared: null,
            common: null,
            effective: null,
            collisions: null,
          });
        } else {
          // Unreachable: invariant 3 already refused a subtype row.
          throw new Error(`${id}: row ${row.objectIndex} has no columns arm`);
        }
      }

      // 6. every subtype, in file order, cited by the section it was declared in.
      const subtypeSectionIndexes = schema.objects.flatMap((object) =>
        object.kind === 'subtype' ? [object.sectionIndex] : [],
      );
      expect(result.omitted.subtypes.sectionIndexes).toEqual(subtypeSectionIndexes);
      expect(result.omitted.subtypes.count).toBe(subtypeSectionIndexes.length);
    });
  }
});

describe('tables projection — the fixtures stated explicitly', () => {
  it('sem-05 lists the entity and cites the omitted subtype', () => {
    const { schema } = projectFixture('sem-05');
    const result = projectTables(schema);

    // Fixture evidence: [Manager] 1 key, [Entity] PName + one Field + Position, [Subtype] 4 keys.
    expect(result.objects).toBe(2);
    expect(result.tables).toHaveLength(1);
    const row = firstRow(result.tables);
    expect(row.objectIndex).toBe(0);
    expect(row.sectionIndex).toBe(2);
    expect(row.span).toEqual(entityAt(schema, 0).span);
    expect(row.kind).toBe('entity');
    expect(row.pname).toBe('subtype_member');
    expect(row.lname).toBeNull();
    // One declared column, no common field in the file, so the effective list has one entry.
    expect(row.columns).toEqual({
      status: 'complete',
      reason: null,
      declared: 1,
      common: 0,
      effective: 1,
      collisions: 0,
    });
    expect(result.omitted).toEqual({ subtypes: { count: 1, sectionIndexes: [3] } });
  });

  it('sem-06 reports both view reasons and four unknown counts', () => {
    const { schema } = projectFixture('sem-06');
    const result = projectTables(schema);

    expect(result.objects).toBe(2);
    expect(result.tables).toHaveLength(2);
    const [namedFromQuery, stored] = result.tables;
    expect(namedFromQuery?.pname).toBe('view_with_lname');
    expect(namedFromQuery?.columns).toEqual({
      status: 'unknown',
      reason: 'view-columns-named-from-query',
      declared: null,
      common: null,
      effective: null,
      collisions: null,
    });
    expect(stored?.pname).toBe('plain_view');
    expect(stored?.columns).toEqual({
      status: 'unknown',
      reason: 'view-columns-not-stored',
      declared: null,
      common: null,
      effective: null,
      collisions: null,
    });
    expect(result.omitted).toEqual({ subtypes: { count: 0, sectionIndexes: [] } });
  });

  it('sem-07 composes common columns for one entity and not for the other', () => {
    const { schema } = projectFixture('sem-07');
    const result = projectTables(schema);

    // `with_common` declares two fields and takes the one [Manager] CommonField; `without_common`
    // declares UsingCommonColumns=0, so its composition ran and contributed nothing.
    expect(result.tables.map((row) => [row.pname, row.columns])).toEqual([
      [
        'with_common',
        {
          status: 'complete',
          reason: null,
          declared: 2,
          common: 1,
          effective: 3,
          collisions: 0,
        },
      ],
      [
        'without_common',
        {
          status: 'complete',
          reason: null,
          declared: 1,
          common: 0,
          effective: 1,
          collisions: 0,
        },
      ],
    ]);
  });

  it('sem-08 keeps both objects that share a PName as separate rows', () => {
    const { schema } = projectFixture('sem-08');
    const result = projectTables(schema);

    // §4.6: the duplication is the semantic layer's finding, not a reason to merge rows.
    expect(result.tables.map((row) => [row.objectIndex, row.kind, row.pname])).toEqual([
      [0, 'entity', 'twin'],
      [1, 'view', 'twin'],
    ]);
  });

  it('txt-01 keeps file order and copies the CJK logical names', () => {
    const { schema } = projectFixture('txt-01');
    const result = projectTables(schema);

    expect(result.tables.map((row) => [row.objectIndex, row.kind, row.pname, row.lname])).toEqual([
      [0, 'entity', 'users', 'ユーザー'],
      [1, 'entity', 'orders', '注文'],
      [2, 'entity', 'audit_log', '監査ログ'],
      [3, 'view', 'active_users', null],
      [4, 'view', 'order_summary', null],
    ]);
  });

  it('sem-09 has no objects at all', () => {
    const { schema } = projectFixture('sem-09');
    const result = projectTables(schema);

    expect(schema.objects).toEqual([]);
    expect(result).toEqual({
      objects: 0,
      tables: [],
      omitted: { subtypes: { count: 0, sectionIndexes: [] } },
    });
  });
});

describe('tables projection — arms no fixture reaches', () => {
  it('projects a partial entity as unknown common, effective and collisions', () => {
    const { schema } = projectFixture('sem-07');
    const entity = entityAt(schema, 0);
    const columns = entity.effectiveColumns;
    // The only patch is the status: `UsingCommonColumns` was neither 1 nor 0 (§4.5's partial arm).
    const partial: JsonEntityObject = {
      ...entity,
      effectiveColumns: {
        status: 'partial',
        unknown: 'common-fields-not-enumerated',
        reason: 'using-common-columns-unrecognised',
        columns: columns.columns,
        declared: columns.declared,
        common: columns.common,
        collisions: columns.collisions,
        usingCommonColumns: columns.usingCommonColumns,
      },
    };

    const row = firstRow(projectTables({ ...schema, objects: [partial] }).tables);

    // The declared columns are known even though the composition was withheld.
    expect(row.columns).toEqual({
      status: 'partial',
      reason: 'using-common-columns-unrecognised',
      declared: 2,
      common: null,
      effective: null,
      collisions: null,
    });
  });

  it('projects a subtype-only file as no rows and one omitted subtype', () => {
    const { schema } = projectFixture('sem-05');
    const subtype = schema.objects[1];
    if (subtype === undefined) throw new Error('sem-05 lost its subtype');

    const result = projectTables({ ...schema, objects: [subtype] });

    expect(result).toEqual({
      objects: 1,
      tables: [],
      omitted: { subtypes: { count: 1, sectionIndexes: [3] } },
    });
  });

  it('keeps an absent PName null and a declared empty one empty', () => {
    const { schema } = projectFixture('fmt-01');
    const entity = entityAt(schema, 0);

    const absent = firstRow(
      projectTables({ ...schema, objects: [{ ...entity, pname: null }] }).tables,
    );
    expect(absent.pname).toBeNull();

    // `""` is a declared value, not a missing one, so it stays `''` and never becomes `null`.
    const declaredEmpty = firstRow(
      projectTables({
        ...schema,
        objects: [
          {
            ...entity,
            pname: { value: '', origin: 'declared', raw: '""', span: entity.span },
          },
        ],
      }).tables,
    );
    expect(declaredEmpty.pname).toBe('');
  });

  it('copies a hostile name verbatim: the projection escapes nothing', () => {
    const { schema } = projectFixture('fmt-01');
    const entity = entityAt(schema, 0);
    // ESC, a tab, RLO, a NUL and a tag character: escaping is the renderer's job (§4.4), not the
    // projection's, so the value must arrive byte for byte.
    const hostile = '顧客\u001b\t\u202e\u0000\u{e0041}一覧';

    const row = firstRow(
      projectTables({
        ...schema,
        objects: [
          {
            ...entity,
            pname: { value: hostile, origin: 'declared', raw: `"${hostile}"`, span: entity.span },
          },
        ],
      }).tables,
    );

    expect(row.pname).toBe(hostile);
    expect([...(row.pname ?? '')].map((character) => character.codePointAt(0))).toEqual([
      0x9867, 0x5ba2, 0x1b, 0x9, 0x202e, 0x0, 0xe0041, 0x4e00, 0x89a7,
    ]);
  });

  it('projects a view patched to the not-stored reason as unknown', () => {
    const { schema } = projectFixture('sem-06');
    const view = viewAt(schema, 0);

    const row = firstRow(
      projectTables({
        ...schema,
        objects: [
          { ...view, effectiveColumns: { status: 'unknown', reason: 'view-columns-not-stored' } },
        ],
      }).tables,
    );

    expect(row.columns).toEqual({
      status: 'unknown',
      reason: 'view-columns-not-stored',
      declared: null,
      common: null,
      effective: null,
      collisions: null,
    });
  });
});

describe('tables projection — purity', () => {
  it('projects a deeply frozen schema, twice, with the same result', () => {
    const { schema } = projectFixture('sem-07');
    const frozen = deepFreeze(schema);

    const first = projectTables(frozen);
    const second = projectTables(frozen);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('shares no mutable array with its input', () => {
    const { schema } = projectFixture('sem-05');
    const result = projectTables(schema);

    expect(result.tables).not.toBe(schema.objects);
    expect(result.omitted.subtypes.sectionIndexes).not.toBe(schema.objects);
    // The rows are new objects, and the span inside each is a copy (§5.3).
    const object = schema.objects[0];
    const row = firstRow(result.tables);
    if (object === undefined) throw new Error('sem-05 lost its entity');
    expect(row).not.toBe(object);
    expect(row.span).not.toBe(object.span);
  });
});

describe('tables document — §5.3, §5.5, §5.6', () => {
  it('builds the ok arm with the §5.3 key set and no schema member', () => {
    const { envelope } = projectFixture('fmt-01');
    const document = toTablesEnvelope(envelope);
    const documentSchema = envelope.schema;
    if (documentSchema === null) throw new Error('fmt-01 produced no schema');

    expect(Object.keys(document)).toEqual([...TABLES_ENVELOPE_KEYS]);
    expect(Object.keys(document)).not.toContain('schema');
    expect('schema' in document).toBe(false);
    expect(Object.keys(envelope)).not.toContain('result');

    expect(document.contractVersion).toBe(CONTRACT_VERSION);
    expect(document.command).toBe('tables');
    expect(document.status).toBe('ok');
    expect(document.source).toBe(envelope.source);
    expect(document.limits).toBe(envelope.limits);
    expect(document.unsupported).toBe(envelope.unsupported);
    expect(document.diagnostics).toBe(envelope.diagnostics);
    expect(document.completeness).toBe(envelope.completeness);
    expect(document.tool).toBe(envelope.tool);
    const projected = document.result;
    if (projected === null) throw new Error('fmt-01 produced no result');
    expect(projected.objects).toBe(documentSchema.objects.length);
  });

  it('builds the degraded arm with a result, not with nulls', () => {
    const { envelope } = projectFixture('val-08');
    const document = toTablesEnvelope(envelope);

    expect(envelope.status).toBe('degraded');
    expect(document.status).toBe('degraded');
    expect(document.result).not.toBeNull();
    expect(document.source).not.toBeNull();
    expect(document.completeness).not.toBeNull();
    expect(Object.keys(document)).toEqual([...TABLES_ENVELOPE_KEYS]);
  });

  it('builds the failed arm with source, result and completeness null', () => {
    const envelope = failedEnvelopeOf('');
    const document = toTablesEnvelope(envelope);

    expect(envelope.status).toBe('failed');
    expect(envelope.schema).toBeNull();
    expect(Object.keys(document)).toEqual([...TABLES_ENVELOPE_KEYS]);
    expect('schema' in document).toBe(false);
    expect(document.status).toBe('failed');
    expect(document.source).toBeNull();
    expect(document.result).toBeNull();
    expect(document.completeness).toBeNull();
    expect(document.diagnostics).toBe(envelope.diagnostics);
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain('E_EMPTY_INPUT');
  });

  it('throws when status contradicts its nulls', () => {
    const { envelope: usable } = projectFixture('fmt-01');
    const rejected = failedEnvelopeOf('');
    const source = usable.source;
    const schema = usable.schema;
    const completeness = usable.completeness;
    if (source === null || schema === null || completeness === null) {
      throw new Error('fmt-01 lost a member the read produced');
    }

    // A `failed` read cannot carry a source, and an `ok` one cannot lose it.
    expect(() => toTablesEnvelope({ ...rejected, source })).toThrow(TypeError);
    expect(() => toTablesEnvelope({ ...usable, source: null })).toThrow(TypeError);
    expect(() => toTablesEnvelope({ ...usable, schema: null })).toThrow(TypeError);
    expect(() => toTablesEnvelope({ ...usable, completeness: null })).toThrow(TypeError);
  });

  it("keeps the text renderer's note prefix out of every row", () => {
    const { envelope } = projectFixture('txt-01');
    const document = toTablesEnvelope(envelope);
    const result = document.result;
    if (result === null) throw new Error('txt-01 produced no result');

    // `#` starts a note line and nothing else (§4.8); the projection never emits it as a name.
    expect(NOTE_PREFIX).toBe('#');
    for (const row of result.tables) {
      expect(row.pname).not.toBe(NOTE_PREFIX);
    }
  });
});
