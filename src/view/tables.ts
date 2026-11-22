/**
 * `view/` — the projection behind `a5er tables` (`docs/proposals/human-cli.md` §5.2–§5.5).
 *
 * **What this module is.** A pure function over the JSON envelope the library already produces:
 * `projectTables(schema)` turns `inspect.schema` into the small answer `tables` exists to give, and
 * `toTablesEnvelope(envelope)` is the tables document itself. No stage is imported and nothing is
 * re-read, re-resolved or re-decided: every row is a projection of an object the serializer already
 * emitted, so `tables` cannot disagree with `inspect` about the same bytes.
 *
 * **What it invents.** Nothing. A count is counted (`declared.length`), a position is taken from
 * the iteration (`objectIndex`), and everything else is copied. `null` never means zero: an entity
 * whose common columns were not composed, and a view, which stores no columns at all, report
 * `null` with the `reason` the semantic layer gave, which is what the renderer turns into a note
 * (§4.5, §4.8).
 *
 * **Key sets are part of the contract.** The document is built only from the object literals below,
 * which spell out every member in emission order, plus the key lists exported here for the tests
 * that check them (§5.3, §5.4 item 7). Nothing is spread or copied wholesale from the inspect
 * envelope — a copy would carry `schema` along.
 *
 * **Status and nulls.** `JsonEnvelope` does not tie `status` to its nulls, so the narrowing into the
 * two arms of §5.6 is checked at run time and a contradiction throws. That is a defect, not a
 * finding about the file; it happens before any output exists (§7.2).
 *
 * No I/O, no `node:` import, no clock and no locale: the result depends on the envelope alone.
 */

import type {
  JsonEntityObject,
  JsonEnvelope,
  JsonSchema,
  JsonSpan,
  JsonTableColumns,
  JsonTableRow,
  JsonTablesCommand,
  JsonTablesEnvelope,
  JsonTablesResult,
  JsonViewObject,
} from '../json/index.js';

/** The one command whose document carries a projection instead of the schema (§5.1). */
export const TABLES_COMMAND: JsonTablesCommand = 'tables';

/**
 * The prefix every note line of the text renderer starts with (§4.8).
 *
 * Held here rather than in the renderer so that the JSON and text halves of `tables` cannot drift:
 * a note is `#`-marked in both, and a table row never starts with it.
 */
export const NOTE_PREFIX = '#';

/** The tables document's keys, in emission order (§5.3). No `schema` member. */
export const TABLES_ENVELOPE_KEYS = [
  'contractVersion',
  'tool',
  'command',
  'status',
  'source',
  'limits',
  'result',
  'unsupported',
  'diagnostics',
  'completeness',
] as const;

/** `result`'s keys, in emission order. */
export const TABLES_RESULT_KEYS = ['objects', 'tables', 'omitted'] as const;

/** One row's keys, in emission order. */
export const TABLE_ROW_KEYS = [
  'objectIndex',
  'sectionIndex',
  'span',
  'kind',
  'pname',
  'lname',
  'columns',
] as const;

/** The copied span's keys, in emission order — the same four positions `JsonSpan` has. */
export const TABLE_SPAN_KEYS = ['sectionIndex', 'startLine', 'endLine', 'keyLine'] as const;

/** The column counts' keys, in emission order; every arm has all six. */
export const TABLE_COLUMNS_KEYS = [
  'status',
  'reason',
  'declared',
  'common',
  'effective',
  'collisions',
] as const;

/** `omitted`'s keys, in emission order. */
export const TABLES_OMITTED_KEYS = ['subtypes'] as const;

/** `omitted.subtypes`' keys, in emission order. */
export const TABLES_OMITTED_SUBTYPES_KEYS = ['count', 'sectionIndexes'] as const;

/**
 * A value the type system says cannot exist.
 *
 * The column switches are exhaustive over the projected unions, so a new arm there becomes a
 * compile error rather than a silent fallback; this is the run-time half, for a value that reached
 * here through an untyped boundary. It is a defect and throws, like the status/nulls check below.
 */
function assertNever(value: never, what: string): never {
  throw new TypeError(`unexpected ${what}: ${String(value)}`);
}

/** The four positions of a span, copied member by member into a new object (§5.3). */
function copySpan(span: JsonSpan): JsonSpan {
  return {
    sectionIndex: span.sectionIndex,
    startLine: span.startLine,
    endLine: span.endLine,
    keyLine: span.keyLine,
  };
}

/**
 * The column counts of one entity.
 *
 * `complete`: the composition ran, so all four counts are known and, because the effective list is
 * the declared list followed by the composed one, `effective === declared + common` (§4.5, §9.4).
 * A physical name repeated in that list is counted once per occurrence — that is what the list
 * holds — and `collisions` says how many repeats it reports.
 *
 * `partial`: the composition was withheld, so `common` is "not composed" rather than "zero", and
 * so are `effective` and `collisions`. Reporting `0` here would be a fact the file never states.
 */
function entityColumns(columns: JsonEntityObject['effectiveColumns']): JsonTableColumns {
  switch (columns.status) {
    case 'complete':
      return {
        status: 'complete',
        reason: null,
        declared: columns.declared.length,
        common: columns.common.length,
        effective: columns.columns.length,
        collisions: columns.collisions.length,
      };
    case 'partial':
      return {
        status: 'partial',
        reason: columns.reason,
        declared: columns.declared.length,
        common: null,
        effective: null,
        collisions: null,
      };
    default:
      return assertNever(columns, 'entity column status');
  }
}

/**
 * The column counts of one view: always `unknown`, never `0` (§4.5).
 *
 * A `[View]` does not store its columns, so all four counts are `null` and `reason` carries why
 * (`view-columns-not-stored`, or `view-columns-named-from-query` when `LNameByComment=1`).
 */
function viewColumns(columns: JsonViewObject['effectiveColumns']): JsonTableColumns {
  return {
    status: 'unknown',
    reason: columns.reason,
    declared: null,
    common: null,
    effective: null,
    collisions: null,
  };
}

/** The column counts of a listed row, decided by the object's kind. */
function rowColumns(object: JsonEntityObject | JsonViewObject): JsonTableColumns {
  switch (object.kind) {
    case 'entity':
      return entityColumns(object.effectiveColumns);
    case 'view':
      return viewColumns(object.effectiveColumns);
    default:
      return assertNever(object, 'table kind');
  }
}

/**
 * Project `inspect.schema` into the tables result (§5.3, §5.4).
 *
 * Every entity and view of `schema.objects` becomes exactly one row, in file order; nothing is
 * merged or de-duplicated, so two objects with the same `PName` are two rows and the duplicate is
 * reported by the diagnostic notes, not by this function (§4.6). A subtype gets no row: it is
 * counted in `omitted.subtypes.count` and cited by `sectionIndex`, so the omission is stated rather
 * than silent, and `objectIndex` keeps pointing into the inspect envelope's own list (§4.9).
 */
export function projectTables(schema: JsonSchema): JsonTablesResult {
  const tables: JsonTableRow[] = [];
  const subtypeSectionIndexes: number[] = [];

  for (const [objectIndex, object] of schema.objects.entries()) {
    if (object.kind === 'subtype') {
      subtypeSectionIndexes.push(object.sectionIndex);
      continue;
    }
    tables.push({
      objectIndex,
      sectionIndex: object.sectionIndex,
      span: copySpan(object.span),
      kind: object.kind,
      pname: object.pname === null ? null : object.pname.value,
      lname: object.lname === null ? null : object.lname.value,
      columns: rowColumns(object),
    });
  }

  return {
    objects: schema.objects.length,
    tables,
    omitted: {
      subtypes: {
        count: subtypeSectionIndexes.length,
        sectionIndexes: subtypeSectionIndexes,
      },
    },
  };
}

/**
 * Build the tables document from the inspect envelope of the same input (§5.3, §5.5, §5.6).
 *
 * The shared members (`contractVersion`, `tool`, `limits`, `source`, `unsupported`, `diagnostics`,
 * `completeness`) are taken by reference: they are the ones the serializer produced, so the two
 * commands cannot disagree about them and their key sets stay the existing contract's.
 *
 * `status` decides the arm, and a contradiction throws before any byte is produced: `failed`
 * requires `source`, `schema` and `completeness` all `null`, and `ok`/`degraded` requires all three
 * non-null. No fixture reaches that throw; a defect does.
 */
export function toTablesEnvelope(envelope: JsonEnvelope): JsonTablesEnvelope {
  if (envelope.status === 'failed') {
    if (envelope.source !== null || envelope.schema !== null || envelope.completeness !== null) {
      throw new TypeError('a failed envelope must have null source, schema and completeness');
    }
    return {
      contractVersion: envelope.contractVersion,
      tool: envelope.tool,
      command: TABLES_COMMAND,
      status: 'failed',
      source: null,
      limits: envelope.limits,
      result: null,
      unsupported: envelope.unsupported,
      diagnostics: envelope.diagnostics,
      completeness: null,
    };
  }

  if (envelope.source === null || envelope.schema === null || envelope.completeness === null) {
    throw new TypeError(
      `an ${envelope.status} envelope must have non-null source, schema and completeness`,
    );
  }

  return {
    contractVersion: envelope.contractVersion,
    tool: envelope.tool,
    command: TABLES_COMMAND,
    status: envelope.status,
    source: envelope.source,
    limits: envelope.limits,
    result: projectTables(envelope.schema),
    unsupported: envelope.unsupported,
    diagnostics: envelope.diagnostics,
    completeness: envelope.completeness,
  };
}
