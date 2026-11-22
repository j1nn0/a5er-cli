/**
 * `view/` — the projection behind `a5er tables` (`docs/proposals/human-cli.md` §5.2–§5.5).
 *
 * **What this module is.** The tables document, built from the stage results `tables` already
 * holds: `buildTablesEnvelope(input, integration, { path })` walks `classification.sections` once,
 * reads each object's column counts out of the semantic records, and emits the envelope. Nothing
 * is decoded, resolved or decided a second time, and `inspect`'s `schema` — with `serialize()` —
 * is never built for this command (§2).
 *
 * **The oracle.** `projectTables(schema)` and `toTablesEnvelope(envelope)` are the same answer
 * taken from the inspect envelope instead: one row per object of `schema.objects`, wrapped in the
 * tables document. They are kept as the reference the builder must agree with byte for byte
 * (§5.4, §5.5), and the `tables` command calls neither.
 *
 * **What it invents.** Nothing. A count is counted (`declared.length`), a position is taken from
 * the iteration (`objectIndex`), and everything else is copied. `null` never means zero: an entity
 * whose common columns were not composed, and a view, which stores no columns at all, report
 * `null` with the `reason` the semantic layer gave, which is what the renderer turns into a note
 * (§4.5, §4.8).
 *
 * **Key sets are part of the contract.** The document is built only from the object literals below,
 * which spell out every member in emission order, plus the key lists exported here for the tests
 * that check them (§5.3, §5.4 item 7). Nothing is spread or copied wholesale from an inspect
 * envelope — a copy would carry `schema` along.
 *
 * **Status and nulls.** Neither the stage results nor the semantic records tie `status` to the
 * tables document's nulls, so the narrowing into the two arms of §5.6 is checked at run time and a
 * contradiction throws. That is a defect, not a finding about the file; it happens before any
 * output exists (§7.2).
 *
 * No I/O, no `node:` import, no clock and no locale: the result depends on the input, on the
 * `Integration` of that same input, and on the echoed path.
 */

import type { Limits } from '../io/limits.js';
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
  JsonViewColumns,
  JsonViewObject,
} from '../json/index.js';
import { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION } from '../json/index.js';
import { sharedEnvelopeMembers } from '../json/serialize.js';
import type { Span } from '../model/span.js';
import type { ClassifiedSection, KeyOccurrence } from '../schema/index.js';
import type { Integration, IntegrationInput } from '../validate/index.js';
import { isLoadedInput } from '../validate/index.js';

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

/** Every parsed occurrence of one key, in file order — duplicates included (§4.2). */
function occurrencesOf(section: ClassifiedSection, key: string): KeyOccurrence[] {
  return section.entries.flatMap((entry) =>
    entry.kind === 'parsed' && entry.occurrence.spec.key === key ? [entry.occurrence] : [],
  );
}

/**
 * The last declared text of one key, decoded, or `null` (§4.2 last-wins).
 *
 * The rule the inspect object's `pname` and `lname` slots follow: the last parsed occurrence is
 * the answer, and when it does not decode there is no walk back to an earlier readable one. So
 * `null` means "no usable declaration", never "no declaration" — the line itself stays evidence,
 * as the diagnostics report it.
 */
function declaredText(section: ClassifiedSection, key: string): string | null {
  const occurrence = occurrencesOf(section, key).at(-1);
  if (occurrence === undefined) return null;
  const decoded = occurrence.decoded;
  if (!decoded.ok) return null;
  const { value } = decoded.value;
  return typeof value === 'string' ? value : null;
}

/** The `PName` lines of a section, in file order: more than one is a duplicate key (§4.2). */
function pnameSpans(section: ClassifiedSection): Span[] {
  return occurrencesOf(section, 'PName').flatMap((occurrence) =>
    occurrence.span === null ? [] : [occurrence.span],
  );
}

/** The header line as a one-line span; `ClassifiedSection.span.keyLine` is the header (§4.1). */
function headerSpan(section: ClassifiedSection): Span {
  return {
    sectionIndex: section.index,
    startLine: section.span.keyLine,
    endLine: section.span.keyLine,
    keyLine: section.span.keyLine,
  };
}

/**
 * The line an entity's span reports on: its last `PName` line, else its header (§5.3, §12 rule 3).
 *
 * The most specific line the file contains, which is the convention the inspect object's `span`
 * and the semantic records both use. A view is not asked here: its `span` is the semantic layer's
 * own record, which is where `inspect` takes it from as well.
 */
function entitySpan(section: ClassifiedSection): Span {
  return pnameSpans(section).at(-1) ?? headerSpan(section);
}

/**
 * Index `records` by `sectionIndex`, keeping the **first** record per key.
 *
 * First-wins is the rule the inspect envelope's lookups follow, because `Array#find` — the call
 * these maps replace — returns the first match. `new Map(records.map(...))` would keep the last,
 * which is a different row for a duplicated ordinal; every map here is only ever `.get()`, never
 * iterated, so the rows below still follow `classification.sections` in file order.
 */
function firstBySection<T extends { readonly sectionIndex: number }>(
  records: readonly T[],
): ReadonlyMap<number, T> {
  const index = new Map<number, T>();
  for (const record of records) {
    if (!index.has(record.sectionIndex)) index.set(record.sectionIndex, record);
  }
  return index;
}

/**
 * A semantic record a section must have.
 *
 * Its absence is a defect in this tool, not a property of the file, so it throws before any byte
 * is written; inside Phase B that is an output-generation failure (§2, §7.2), never prose. The
 * wording is the inspect envelope's, so a missing record fails the same way for either document.
 */
function requireRecord<T>(record: T | undefined, what: string, sectionIndex: number): T {
  if (record === undefined) {
    throw new Error(
      `json envelope: ${what} for section ${String(sectionIndex)} is missing from the semantics`,
    );
  }
  return record;
}

/** The four lengths an entity's column counts are made of, whichever record carries them. */
interface EntityColumnLengths {
  readonly declared: number;
  readonly common: number;
  readonly effective: number;
  readonly collisions: number;
}

/**
 * The column counts of one entity (§4.5, §9.4).
 *
 * `complete`: the composition ran, so all four counts are known and, because the effective list is
 * the declared list followed by the composed one, `effective === declared + common` (§4.5, §9.4).
 * A physical name repeated in that list is counted once per occurrence — that is what the list
 * holds — and `collisions` says how many repeats it reports.
 *
 * `partial`: the composition was withheld, so `common` is "not composed" rather than "zero", and
 * so are `effective` and `collisions`. Reporting `0` here would be a fact the file never states.
 *
 * `indeterminate` is the semantic record's own switch (`common-columns.ts`) and the inspect
 * object's `status` is the same one; taking the boolean lets both records share this statement of
 * which arm withholds which count.
 */
function entityColumns(indeterminate: boolean, lengths: EntityColumnLengths): JsonTableColumns {
  const { declared } = lengths;
  if (indeterminate) {
    return {
      status: 'partial',
      reason: 'using-common-columns-unrecognised',
      declared,
      common: null,
      effective: null,
      collisions: null,
    };
  }

  return {
    status: 'complete',
    reason: null,
    declared,
    common: lengths.common,
    effective: lengths.effective,
    collisions: lengths.collisions,
  };
}

/**
 * The lengths a schema object's `effectiveColumns` state, with the arm it is in.
 *
 * `columns.columns` is the effective list, which the semantic record calls `effective`. The switch
 * is exhaustive, so a third arm there is a compile error and never a silent `complete`.
 */
function schemaColumnLengths(columns: JsonEntityObject['effectiveColumns']): {
  readonly indeterminate: boolean;
  readonly lengths: EntityColumnLengths;
} {
  const lengths: EntityColumnLengths = {
    declared: columns.declared.length,
    common: columns.common.length,
    effective: columns.columns.length,
    collisions: columns.collisions.length,
  };
  switch (columns.status) {
    case 'complete':
      return { indeterminate: false, lengths };
    case 'partial':
      return { indeterminate: true, lengths };
    default:
      return assertNever(columns, 'entity column status');
  }
}

/**
 * The column counts of one view: always `unknown`, never `0` (§4.5).
 *
 * A `[View]` does not store its columns, so all four counts are `null` and `reason` carries why
 * (`view-columns-not-stored`, or `view-columns-named-from-query` when `LNameByComment=1`). One
 * shape serves both records: the semantic `ViewColumns` and the inspect object's
 * `effectiveColumns`, which is that record copied member for member.
 */
function viewColumns(columns: JsonViewColumns): JsonTableColumns {
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
    case 'entity': {
      const { indeterminate, lengths } = schemaColumnLengths(object.effectiveColumns);
      return entityColumns(indeterminate, lengths);
    }
    case 'view':
      return viewColumns(object.effectiveColumns);
    default:
      return assertNever(object, 'table kind');
  }
}

/**
 * Build the tables document from the stage results and their integration (§5.3, §5.5, §5.6).
 *
 * One pass over `classification.sections` replaces the inspect envelope: an `Entity` or `View`
 * section becomes one row, in file order, and a `Subtype` is counted and cited instead of listed
 * (§4.9); every other kind is not an object (§4.5). The counts are the lengths of the records'
 * own arrays, so no per-column object is built for this command (§5.4), and `objectIndex` is the
 * row's position in the filtered list — the index it has in `schema.objects`, whose only gaps are
 * the subtypes.
 *
 * The shared members come from `sharedEnvelopeMembers()`, the function the inspect envelope uses
 * too, over the same input and the same `Integration`: the two commands cannot state a different
 * `source`, `limits`, `unsupported`, `diagnostics` or `completeness` for the same bytes, and
 * neither document is built from the other.
 *
 * `status` decides the arm and a contradiction throws before any byte is produced: `failed`
 * requires a null `source` and `completeness`, `ok`/`degraded` requires both non-null (§5.6). No
 * fixture reaches those throws; a defect does.
 */
export function buildTablesEnvelope(
  input: IntegrationInput,
  integration: Integration,
  context: { readonly path: string; readonly limits?: Limits },
): JsonTablesEnvelope {
  const shared = sharedEnvelopeMembers(input, integration, context);

  if (integration.status === 'failed') {
    // `schema` needs no check of its own: it and `source` are both null exactly when the input was
    // not loaded, which is the only way `completeness` is null as well.
    if (shared.source !== null || shared.completeness !== null) {
      throw new TypeError('a failed envelope must have null source, schema and completeness');
    }
    return {
      contractVersion: CONTRACT_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      command: TABLES_COMMAND,
      status: 'failed',
      source: null,
      limits: shared.limits,
      result: null,
      unsupported: shared.unsupported,
      diagnostics: shared.diagnostics,
      completeness: null,
    };
  }

  // `source` and `completeness` are non-null only for an input that was loaded, and so is the
  // `schema` an inspect envelope would carry; one check states all three (§5.6).
  if (!isLoadedInput(input) || shared.source === null || shared.completeness === null) {
    throw new TypeError(
      `an ${integration.status} envelope must have non-null source, schema and completeness`,
    );
  }

  const tables: JsonTableRow[] = [];
  const subtypeSectionIndexes: number[] = [];
  const entityColumnsOf = firstBySection(input.semantics.entityColumns);
  const viewsOf = firstBySection(input.semantics.views);
  const subtypesOf = firstBySection(input.semantics.subtypes);
  // `objectIndex` is a position in `schema.objects` (§5.3, §4.9), so the counter advances for a
  // subtype too even though a subtype gets no row: a subtype declared before an entity is one of
  // that entity's gaps, and the row's index is the join key back to the inspect envelope.
  let objectsSeen = 0;

  for (const section of input.classification.sections) {
    switch (section.kind) {
      case 'Entity': {
        const columns = requireRecord(
          entityColumnsOf.get(section.index),
          'effective columns',
          section.index,
        );
        tables.push({
          objectIndex: objectsSeen,
          sectionIndex: section.index,
          span: copySpan(entitySpan(section)),
          kind: 'entity',
          pname: declaredText(section, 'PName'),
          lname: declaredText(section, 'LName'),
          columns: entityColumns(columns.indeterminate, {
            declared: columns.declared.length,
            common: columns.common.length,
            effective: columns.effective.length,
            collisions: columns.collisions.length,
          }),
        });
        objectsSeen += 1;
        break;
      }
      case 'View': {
        const view = requireRecord(viewsOf.get(section.index), 'view', section.index);
        tables.push({
          objectIndex: objectsSeen,
          sectionIndex: section.index,
          span: copySpan(view.span),
          kind: 'view',
          pname: declaredText(section, 'PName'),
          lname: declaredText(section, 'LName'),
          columns: viewColumns(view.effectiveColumns),
        });
        objectsSeen += 1;
        break;
      }
      case 'Subtype':
        // No row: it is cited by `sectionIndex` instead (§4.9). The record itself is still
        // required — the inspect envelope needed it for the object it then left out — so a
        // missing one fails here as well, and with the same message.
        requireRecord(subtypesOf.get(section.index), 'subtype', section.index);
        subtypeSectionIndexes.push(section.index);
        objectsSeen += 1;
        break;
      default:
        // `[Manager]`, relations and the unmodelled section kinds are projected elsewhere or not
        // at all (§4.5); they are not objects.
        break;
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    command: TABLES_COMMAND,
    status: integration.status,
    source: shared.source,
    limits: shared.limits,
    result: {
      // Every entity, view and subtype is one object of `schema.objects` (§5.3).
      objects: objectsSeen,
      tables,
      omitted: {
        subtypes: {
          count: subtypeSectionIndexes.length,
          sectionIndexes: subtypeSectionIndexes,
        },
      },
    },
    unsupported: shared.unsupported,
    diagnostics: shared.diagnostics,
    completeness: shared.completeness,
  };
}

/**
 * Project `inspect.schema` into the tables result (§5.3, §5.4) — the oracle.
 *
 * Every entity and view of `schema.objects` becomes exactly one row, in file order; nothing is
 * merged or de-duplicated, so two objects with the same `PName` are two rows and the duplicate is
 * reported by the diagnostic notes, not by this function (§4.6). A subtype gets no row: it is
 * counted in `omitted.subtypes.count` and cited by `sectionIndex`, so the omission is stated rather
 * than silent, and `objectIndex` keeps pointing into the inspect envelope's own list (§4.9).
 *
 * `buildTablesEnvelope()` must agree with this function for every input; the `tables` command
 * calls that one, not this.
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
 * Build the tables document from the inspect envelope of the same input (§5.3, §5.5, §5.6) — the
 * oracle half of `buildTablesEnvelope()`, kept as the reference that function is compared against.
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
