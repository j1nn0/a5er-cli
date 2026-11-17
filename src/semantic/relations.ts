/**
 * Relation resolution (`architecture.md` §9.2, P9; `format-coverage.md` F5, K7, U8).
 *
 * A relation names two entities and the columns that join them. What this module may conclude is
 * bounded by what the format stores:
 *
 * | Fact | Source | Rule |
 * |---|---|---|
 * | endpoints | `Entity1` / `Entity2` | resolved against **`[Entity]` `PName` only** |
 * | columns | `Fields1` / `Fields2` | tokenised first, then split per element (§7.1; val-02, txt-03) |
 * | cardinality | `RelationType1/2`, `Cardinarity1/2` | kept as declared, spelling included (K7) |
 *
 * Three decisions worth naming:
 *
 * - **Entities only.** `[View]` has no `Field` and `[Subtype]` has no documented membership (K11,
 *   F7), so neither can be an endpoint this stage can verify. A relation naming a view is reported
 *   as dangling rather than quietly accepted: an accepted endpoint that cannot declare columns
 *   would mean an unchecked mapping.
 * - **An unresolved endpoint makes its columns unresolvable.** `sem-01`'s `Entity2="ghost_table"`
 *   with `Fields2="ghost_column"` is one `V_DANGLING_ENTITY` *and* one `V_DANGLING_COLUMN`: the
 *   column cannot be checked against an entity that does not exist, and reporting only the entity
 *   would leave the reader believing the mapping was fine.
 * - **Nothing is truncated to make the two sides line up.** `V_FIELD_COUNT_MISMATCH` reports the
 *   difference and both lists stay complete (U8). No constraint name is invented: the format stores
 *   printf *templates* in `[Manager]`, not names (D7).
 */

import type { Span } from '../model/span.js';
import type { Classification, ClassifiedSection } from '../schema/registry.js';
import { partRaw, unescapeEscaped } from '../schema/values.js';
import { integerOf, pnameCounts, pnameOf, textOf } from './access.js';

/** One column of a relation side, as declared. */
export interface RelationColumn {
  /** The column's physical name, escapes applied and nothing else changed. */
  readonly pname: string;
  /** The declared element text it came from (`"a,b"` yields two columns and one shared raw). */
  readonly raw: string;
  readonly span: Span;
  /** Position inside the `Fields1`/`Fields2` list. */
  readonly index: number;
}

/** How one endpoint name resolved. */
export type EndpointStatus = 'resolved' | 'dangling' | 'ambiguous';

/** One side of a relation. */
export interface RelationEndpoint {
  readonly key: 'Entity1' | 'Entity2';
  /** The declared spelling, verbatim: quotes removed, escapes applied, case untouched. */
  readonly declared: string;
  readonly raw: string;
  readonly span: Span;
  readonly status: EndpointStatus;
  /** The `[Entity]` `PName` it resolved to, or `null` when it did not resolve uniquely. */
  readonly resolvedEntity: string | null;
  /** How many `[Entity]` sections declare that name; more than one is why `ambiguous` exists. */
  readonly candidates: number;
}

/** One `Fields1`/`Fields2` list, complete. */
export interface RelationColumnList {
  readonly key: 'Fields1' | 'Fields2';
  readonly raw: string;
  readonly span: Span;
  readonly columns: readonly RelationColumn[];
}

/** One relation, as declared and as far as it could be resolved. */
export interface ResolvedRelation {
  readonly sectionIndex: number;
  /** Header exactly as written: `[Relation]`, or `[Relationship]` for the alias (txt-02). */
  readonly sectionHeader: string;
  /** The relation's own `PName`, when the file carries one; never synthesised (D7). */
  readonly pname: string | null;
  /** `null` when the endpoint key is absent — that is a required-key finding, not a dangling name. */
  readonly from: RelationEndpoint | null;
  readonly to: RelationEndpoint | null;
  readonly fromColumns: RelationColumnList | null;
  readonly toColumns: RelationColumnList | null;
  /** `RelationType1/2` as declared: the documented `0`–`5` codes (P9), never defaulted (K6). */
  readonly relationType1: number | null;
  readonly relationType2: number | null;
  /** `Cardinarity1/2` — the format's own misspelling, kept as written (K7). */
  readonly cardinarity1: string | null;
  readonly cardinarity2: string | null;
  /** `true` when both sides declare the same number of columns (U8). */
  readonly columnsAligned: boolean;
}

/** A reference to an entity that does not resolve the way the relation needs. */
export interface EndpointReference {
  readonly sectionIndex: number;
  readonly endpoint: 'Entity1' | 'Entity2';
  readonly declared: string;
  readonly span: Span;
}

/** A mapped column that cannot be verified against the entity on its side. */
export interface DanglingColumn {
  readonly sectionIndex: number;
  readonly endpoint: 'Entity1' | 'Entity2';
  readonly column: string;
  readonly span: Span;
  /** The entity the column was checked against; `null` when its endpoint did not resolve. */
  readonly entity: string | null;
}

/** A relation whose two sides map a different number of columns (U8). */
export interface FieldCountMismatch {
  readonly sectionIndex: number;
  readonly fromCount: number;
  readonly toCount: number;
  readonly span: Span;
}

export interface RelationResult {
  readonly relations: readonly ResolvedRelation[];
  /** Endpoints naming no `[Entity]` of the document. */
  readonly danglingEntities: readonly EndpointReference[];
  /** Endpoints naming an entity that more than one section declares; reported, not resolved (P6). */
  readonly ambiguousEntities: readonly EndpointReference[];
  readonly danglingColumns: readonly DanglingColumn[];
  readonly countMismatches: readonly FieldCountMismatch[];
}

/**
 * Split one `Fields1`/`Fields2` value into column names.
 *
 * The value is a Complex token whose elements are quoted *lists*: `"a,b"` is one element holding two
 * column names (P9's カラムリスト rule, proven by val-02 and txt-03). Splitting the raw value on
 * commas would cut inside the quotes, so the tokeniser runs first and only element contents are
 * split — and an empty element (`""`) contributes no column.
 */
function columnsOf(
  section: ClassifiedSection,
  key: 'Fields1' | 'Fields2',
): RelationColumnList | null {
  let list: RelationColumnList | null = null;
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    const { occurrence } = entry;
    if (occurrence.spec.key !== key || occurrence.span === null) continue;
    const decoded = occurrence.decoded;
    if (!decoded.ok) continue;
    const value = decoded.value.value;
    if (typeof value !== 'object') continue;

    const columns: RelationColumn[] = [];
    for (const part of value.parts) {
      for (const name of part.value.split(',')) {
        if (name === '') continue;
        columns.push({
          pname: unescapeEscaped(name),
          raw: partRaw(part),
          span: occurrence.span,
          index: columns.length,
        });
      }
    }
    list = { key, raw: occurrence.raw, span: occurrence.span, columns };
  }
  return list;
}

/** The column names an entity declares, or `null` when no `[Entity]` section carries that name. */
function entityColumns(classification: Classification, pname: string): Set<string> | null {
  for (const section of classification.sections) {
    if (section.kind !== 'Entity') continue;
    if (pnameOf(section) !== pname) continue;
    return new Set(section.decoded.fields.map((field) => field.physicalName.value));
  }
  return null;
}

/** One endpoint, resolved against the `[Entity]` names. */
function endpointOf(
  section: ClassifiedSection,
  key: 'Entity1' | 'Entity2',
  names: Map<string, number>,
): RelationEndpoint | null {
  const declared = textOf(section, key);
  if (declared === null) return null;
  const candidates = names.get(declared.value) ?? 0;
  const status: EndpointStatus =
    candidates === 0 ? 'dangling' : candidates === 1 ? 'resolved' : 'ambiguous';
  return {
    key,
    declared: declared.value,
    raw: declared.raw,
    span: declared.span,
    status,
    resolvedEntity: status === 'resolved' ? declared.value : null,
    candidates,
  };
}

/**
 * Resolve every relation of the document.
 *
 * Pure: reads the classification, returns new records; no section, entry or decoded value is
 * touched.
 */
export function relationsOf(classification: Classification): RelationResult {
  const names = pnameCounts(classification, 'Entity');
  const relations: ResolvedRelation[] = [];
  const danglingEntities: EndpointReference[] = [];
  const ambiguousEntities: EndpointReference[] = [];
  const danglingColumns: DanglingColumn[] = [];
  const countMismatches: FieldCountMismatch[] = [];

  for (const section of classification.sections) {
    if (section.kind !== 'Relation') continue;

    const from = endpointOf(section, 'Entity1', names);
    const to = endpointOf(section, 'Entity2', names);
    const fromColumns = columnsOf(section, 'Fields1');
    const toColumns = columnsOf(section, 'Fields2');

    relations.push({
      sectionIndex: section.index,
      sectionHeader: section.headerRaw,
      pname: textOf(section, 'PName')?.value ?? null,
      from,
      to,
      fromColumns,
      toColumns,
      relationType1: integerOf(section, 'RelationType1'),
      relationType2: integerOf(section, 'RelationType2'),
      cardinarity1: textOf(section, 'Cardinarity1')?.value ?? null,
      cardinarity2: textOf(section, 'Cardinarity2')?.value ?? null,
      columnsAligned:
        fromColumns === null || toColumns === null
          ? true
          : fromColumns.columns.length === toColumns.columns.length,
    });

    for (const endpoint of [from, to]) {
      if (endpoint === null) continue;
      if (endpoint.status === 'dangling') {
        danglingEntities.push({
          sectionIndex: section.index,
          endpoint: endpoint.key,
          declared: endpoint.declared,
          span: endpoint.span,
        });
      }
      if (endpoint.status === 'ambiguous') {
        ambiguousEntities.push({
          sectionIndex: section.index,
          endpoint: endpoint.key,
          declared: endpoint.declared,
          span: endpoint.span,
        });
      }
    }

    for (const [endpoint, list] of [
      [from, fromColumns],
      [to, toColumns],
    ] as [
      [RelationEndpoint | null, RelationColumnList | null],
      [RelationEndpoint | null, RelationColumnList | null],
    ]) {
      if (endpoint === null || list === null) continue;
      const declared =
        endpoint.resolvedEntity === null
          ? null
          : entityColumns(classification, endpoint.resolvedEntity);
      for (const column of list.columns) {
        if (declared !== null && declared.has(column.pname)) continue;
        danglingColumns.push({
          sectionIndex: section.index,
          endpoint: endpoint.key,
          column: column.pname,
          span: column.span,
          entity: endpoint.resolvedEntity,
        });
      }
    }

    if (fromColumns !== null && toColumns !== null) {
      if (fromColumns.columns.length !== toColumns.columns.length) {
        countMismatches.push({
          sectionIndex: section.index,
          fromCount: fromColumns.columns.length,
          toCount: toColumns.columns.length,
          // The shorter side is the one that looks truncated; point at the child's list.
          span: toColumns.span,
        });
      }
    }
  }

  return { relations, danglingEntities, ambiguousEntities, danglingColumns, countMismatches };
}
