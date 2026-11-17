/**
 * The envelope factory and its deterministic serializer (`architecture.md` §12, §13;
 * `test-strategy.md` §3.6, §14 stage 6).
 *
 * **One authority, with one documented addition.** `serialize()` calls `validate/integrate()`
 * exactly once and projects its result. Status, diagnostic order, exit policy, the reconciled counts
 * and Integration's `unsupported` records are its answers, not this module's: nothing here re-sorts
 * a diagnostic, re-derives a status from severities, recounts a section or concatenates
 * `semantics.diagnostics` a second time. The diagnostics were already ordered by §12 rule 7 and
 * their duplicates are meaningful, so they are copied in order, verbatim.
 *
 * The one addition is `unrepresentedEvidence()`: `[Shape]`, `[Line]` and `[Comment]` are known
 * section kinds that §4.5's model has no collection for, so their declarations would be counted and
 * then shown nowhere. `RetentionKind` has the evidence kind for them but no producer in
 * `validate/`, and moving that producer is outside this unit, so the envelope layer emits the
 * records — once, in one function, merged into Integration's list under the same order. It adds
 * evidence only: the counts stay Integration's, and no diagnostic is invented.
 *
 * **No re-parsing, no mutation.** The semantic records and the classification are read only; every
 * array and object below is freshly allocated, so a caller can freeze its input, serialize, and
 * compare. A value's interpretation (`value`) never travels without its `raw` and its `span`
 * (§12 rule 4); a defaulted value keeps `origin: 'defaulted'` with `raw: ''` and `span: null`, and
 * an inferred primary key keeps `origin: 'inferred'`, `span: null` and its `derivedFrom` spans.
 *
 * **Nothing is silently dropped.** Registered keys the resolved model does not otherwise project
 * become `attributes` with the registry's disposition (`structured` / `presentation` / `ddl-only` /
 * `legacy`), their token kept as written. A token that did not decode is an `invalid` attribute, not
 * a missing one. Interpreted scalars carry their own raw text and span, and every declaration of a
 * **projected** key — duplicates and unreadable tokens included — is in `scalars`, so last-wins
 * never deletes a line. That now covers every projected key: `[Relation]`'s nine since 6-A/6-B,
 * an entity's, view's and subtype's `PName`/`LName`/`Comment` since 6-B unit 1, and the ten
 * single-fact slots (`UsingCommonColumns`, `Query`, `LNameByComment`, `SharedMode`,
 * `CompleteCategory`, `ZOrder`, and the relation's `Entity1`/`Entity2`/`Fields1`/`Fields2`) in unit
 * 2. A view's columns stay `{ status: 'unknown' }` and a subtype's membership stays `{ status:
 * 'unsupported' }`; neither becomes `[]`.
 *
 * **Failed input.** A rejected read yields the documented shape, not a partial diagram: `status:
 * 'failed'`, `source: null`, `schema: null`, `completeness: null`, `unsupported: []`, and the fatal
 * diagnostics exactly as `loadSource` produced them (§12 rule 1, §14 row 11).
 *
 * Pure: no filesystem, no clock, no environment, no stdout, no `process.exit`. The exit codes stay
 * data in `Integration.exitPolicy`; this stage writes a value and returns it.
 */

import type { Limits } from '../io/limits.js';
import { DEFAULT_LIMITS } from '../io/limits.js';
import type { Span } from '../model/span.js';
import type { DecodedField } from '../schema/field.js';
import type { DecodedIndexes } from '../schema/indexinfo.js';
import type {
  DecodedPosition,
  ObjectPosition,
  RawElement,
  RelationPosition,
  UnsupportedPosition,
} from '../schema/position.js';
import type { Classification, ClassifiedSection, KeyOccurrence } from '../schema/registry.js';
import type {
  ComplexValue,
  DecodeOutcome,
  DecodedValue,
  Value,
  ValueType,
} from '../schema/values.js';
import type {
  CommonColumnDeclaration,
  EffectiveColumn,
  EntityColumns,
} from '../semantic/common-columns.js';
import type {
  DomainDeclaration,
  DomainReference,
  TypeClassification,
} from '../semantic/domains.js';
import type { PageDeclaration, PageReference } from '../semantic/pages.js';
import type {
  ResolvedRelation,
  RelationColumn,
  RelationColumnList,
  RelationEndpoint,
} from '../semantic/relations.js';
import type { InferredPrimaryKey, IndeterminateKey } from '../semantic/primary-key.js';
import type { SubtypeDeclaration } from '../semantic/subtypes.js';
import type { SectionKind } from '../syntax/sections.js';
import type {
  CompletedIntegration,
  Integration,
  IntegrationInput,
  LoadedIntegrationInput,
  UnsupportedEvidence,
} from '../validate/index.js';
import { integrate, isLoadedInput } from '../validate/index.js';
import type {
  JsonAttribute,
  JsonAttributeToken,
  JsonCommand,
  JsonCompleteness,
  JsonCommonField,
  JsonComplexValue,
  JsonDiagnostic,
  JsonDomain,
  JsonDomainReference,
  JsonEffectiveColumn,
  JsonEntityColumns,
  JsonEntityObject,
  JsonEnvelope,
  JsonField,
  JsonIndexOption,
  JsonIndexInfo,
  JsonIndexes,
  JsonInvalidOrdinal,
  JsonLegacyIndex,
  JsonObject,
  JsonObjectPosition,
  JsonObjectScalarKey,
  JsonPage,
  JsonPageReference,
  JsonPosition,
  JsonPrimaryKey,
  JsonPrimaryKeyColumn,
  JsonProjectedScalar,
  JsonRawElement,
  JsonRelation,
  JsonRelationColumn,
  JsonRelationColumnList,
  JsonRelationEndpoint,
  JsonRelationPosition,
  JsonRelationScalar,
  JsonRelationScalarKey,
  JsonSchema,
  JsonSource,
  JsonSpan,
  JsonSubtypeObject,
  JsonTypeResolution,
  JsonUnsupported,
  JsonUnsupportedPosition,
  JsonViewObject,
  JsonValue,
} from './envelope.js';
import { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION } from './envelope.js';

/** What the command layer tells the serializer about the invocation. */
export interface SerializeContext {
  readonly command: JsonCommand;
  /** The path the caller read; echoed, never resolved any further. */
  readonly path: string;
  /** The limits the read ran under; omitted means the documented defaults (§10.2). */
  readonly limits?: Limits;
}

/**
 * Every key each object kind projects into a typed slot, and therefore retains every declaration of
 * (§4.5, §9.6, §12 rule 4).
 *
 * Two families, one rule. The three `JsonValue` slots (`PName`/`LName`/`Comment`) and the six
 * single-fact slots (`UsingCommonColumns`, `Query`, `LNameByComment`, `SharedMode`,
 * `CompleteCategory`, `ZOrder`) are each a slot **and** every declaration of them in `scalars`.
 * Without the second half a repeated key is erased down to its terminal occurrence, surviving only
 * as an `S_DUPLICATE_KEY` count; the slot keeps what the file means, `scalars` keeps the history
 * (§12 rule 4, R26). Unit 1 did the `JsonValue` half, unit 2 the fact half.
 *
 * The `*_PROJECTED` sets below spread these lists, so a key cannot be retained without also being
 * kept out of `attributes` — the same source line would otherwise be reported twice.
 *
 * Only `parsed` entries are read. `UsingCommonColumns` has a documented default (§4.2) and a
 * defaulted value has `span: null`, so it is never fabricated into this list; the other eight have
 * no default at all.
 */
const ENTITY_SCALAR_KEYS: readonly JsonObjectScalarKey[] = [
  'PName',
  'LName',
  'Comment',
  'UsingCommonColumns',
];

const VIEW_SCALAR_KEYS: readonly JsonObjectScalarKey[] = [
  'PName',
  'LName',
  'Comment',
  'Query',
  'LNameByComment',
];

/** `[Subtype]` registers no `LName`, `Comment` or `Query`, so this is its whole projected surface. */
const SUBTYPE_SCALAR_KEYS: readonly JsonObjectScalarKey[] = [
  'PName',
  'SharedMode',
  'CompleteCategory',
  'ZOrder',
];

/**
 * A membership test for one kind's scalar keys, built from its list so the two cannot drift apart.
 *
 * The same shape `isRelationScalarKey` uses: one list per kind, one set built from it, and the
 * kind's `*_PROJECTED` set spreads the list, so a key cannot be retained without also being kept
 * out of `attributes` (and cannot be in both).
 */
function scalarKeyGuard(
  keys: readonly JsonObjectScalarKey[],
): (key: string) => key is JsonObjectScalarKey {
  const members: ReadonlySet<string> = new Set(keys);
  return (key: string): key is JsonObjectScalarKey => members.has(key);
}

const isEntityScalarKey = scalarKeyGuard(ENTITY_SCALAR_KEYS);
const isViewScalarKey = scalarKeyGuard(VIEW_SCALAR_KEYS);
const isSubtypeScalarKey = scalarKeyGuard(SUBTYPE_SCALAR_KEYS);

const ENTITY_PROJECTED: ReadonlySet<string> = new Set([
  ...ENTITY_SCALAR_KEYS,
  'Field',
  'IndexInfo',
  'Index',
  'IndexOption',
  'Position',
]);

const VIEW_PROJECTED: ReadonlySet<string> = new Set([...VIEW_SCALAR_KEYS, 'Position']);

const SUBTYPE_PROJECTED: ReadonlySet<string> = new Set([...SUBTYPE_SCALAR_KEYS, 'Position']);

/**
 * The `[Relation]` keys the envelope carries in a slot of their own (§9.2, P9, K7).
 *
 * All nine are typed slots **and** every declaration of them is in `scalars`; `Entity1`/`Entity2`
 * live in `from`/`to`, `Fields1`/`Fields2` in `fromColumns`/`toColumns`, and `Position` in
 * `positions`. Everything else registered for the section is an attribute.
 */
const RELATION_SCALAR_KEYS: readonly JsonRelationScalarKey[] = [
  'PName',
  'RelationType1',
  'RelationType2',
  'Cardinarity1',
  'Cardinarity2',
  'Entity1',
  'Entity2',
  'Fields1',
  'Fields2',
];

const RELATION_SCALARS: ReadonlySet<string> = new Set(RELATION_SCALAR_KEYS);

/** Membership test for the nine projected keys; built from the list so the two cannot drift apart. */
function isRelationScalarKey(key: string): key is JsonRelationScalarKey {
  return RELATION_SCALARS.has(key);
}

const RELATION_PROJECTED: ReadonlySet<string> = new Set([...RELATION_SCALAR_KEYS, 'Position']);

/** The three Manager keys with their own collections (§9.3, §9.4). */
const MANAGER_PROJECTED: ReadonlySet<string> = new Set(['PageInfo', 'DomainInfo', 'CommonField']);

/** A `Span` as JSON. Fresh objects only: the stage results are never handed to a caller. */
function jsonSpan(span: Span): JsonSpan {
  return {
    sectionIndex: span.sectionIndex,
    startLine: span.startLine,
    endLine: span.endLine,
    keyLine: span.keyLine,
  };
}

/** §4.2's `Value<T>`, projected field by field. */
function jsonValue<T>(value: Value<T>): JsonValue<T> {
  return {
    value: value.value,
    origin: value.origin,
    raw: value.raw,
    span: value.span === null ? null : jsonSpan(value.span),
  };
}

/** A decoded element that may legitimately be absent (`color`, `keyOrder`, `notNull`). */
function jsonOptionalValue<T>(value: Value<T> | null): JsonValue<T> | null {
  return value === null ? null : jsonValue(value);
}

/** A raw `Position` element, kept as written. */
function jsonRawElement(element: RawElement): JsonRawElement {
  return { index: element.index, raw: element.raw, quoted: element.quoted };
}

function jsonRawElements(elements: readonly RawElement[]): JsonRawElement[] {
  return elements.map(jsonRawElement);
}

/** Every parsed occurrence of one key, in file order — duplicates included. */
function occurrencesOf(section: ClassifiedSection, key: string): KeyOccurrence[] {
  return section.entries.flatMap((entry) =>
    entry.kind === 'parsed' && entry.occurrence.spec.key === key ? [entry.occurrence] : [],
  );
}

/**
 * The last declared value of one key, decoded to `T` (§4.2 last-wins), with its raw text and span.
 *
 * `null` means the key never appeared, or that its last occurrence does not decode to `T` — the
 * last-wins rule is not re-negotiated here by walking backwards to something readable (R26). Never
 * an earlier valid occurrence in place of a terminal unreadable one.
 *
 * The occurrence itself always remains readable elsewhere: for any key a section *projects*, in
 * `scalars` (every declaration, in file order) — the five `[Relation]` interpreted scalars, the
 * object `JsonValue` slots and every single-fact slot; for a key that is not projected at all, in
 * `attributes` and the diagnostic list.
 *
 * **Finding 5-d is closed for projected keys (6-B).** Every key a slot carries is now also a
 * `scalars` record, so a repeated declaration never survives only as an `S_DUPLICATE_KEY` count.
 * Retention is by *key*, not by slot shape: `JsonProjectedScalar` is one record type for a
 * `JsonValue` slot, a `JsonUsingCommonColumns`, a `JsonLNameByComment`, a `JsonSubtypeScalar`, a
 * `JsonRelationEndpoint` and a `JsonRelationColumnList` alike.
 *
 * What is still not modelled is not a retention gap and is recorded for later units: page and
 * domain element coverage, the FORMAT gate and `enc-05`'s key count, the `limits` family, and the
 * §12/§13 wording. A rename of `scalars` itself would be a contract bump and is not this unit's.
 */
function declaredOf<T extends DecodedValue>(
  section: ClassifiedSection,
  key: string,
  accepts: (value: DecodedValue) => value is T,
): JsonValue<T> | null {
  const occurrence = occurrencesOf(section, key).at(-1);
  if (occurrence === undefined) return null;
  const decoded = occurrence.decoded;
  if (!decoded.ok) return null;
  const value = decoded.value.value;
  if (!accepts(value)) return null;
  return jsonValue({ ...decoded.value, value });
}

/** A text slot (`string`/`escaped`), e.g. `PName` or `Cardinarity1`. */
function declaredString(section: ClassifiedSection, key: string): JsonValue<string> | null {
  return declaredOf(section, key, (value): value is string => typeof value === 'string');
}

/** An `integer` slot, e.g. `RelationType1`. */
function declaredNumber(section: ClassifiedSection, key: string): JsonValue<number> | null {
  return declaredOf(section, key, (value): value is number => typeof value === 'number');
}

/** The `PName` lines of a section, in file order: more than one is a duplicate key (§4.2). */
function pnameSpans(section: ClassifiedSection): Span[] {
  return occurrencesOf(section, 'PName').flatMap((occurrence) =>
    occurrence.span === null ? [] : [occurrence.span],
  );
}

/** The header line as a one-line span; `ClassifiedSection.span.keyLine` is the header (§4.1). */
function headerSpanOf(section: ClassifiedSection): Span {
  return {
    sectionIndex: section.index,
    startLine: section.span.keyLine,
    endLine: section.span.keyLine,
    keyLine: section.span.keyLine,
  };
}

/**
 * The line an object reports on: its last `PName` line, else its header.
 *
 * The same "one line, the most specific one the file contains" convention `semantic/required.ts`,
 * `views.ts` and `subtypes.ts` already use. The header *extent* is not used, because a finding is
 * about a line, not a range (§12 rule 3).
 */
function reportSpanOf(section: ClassifiedSection): Span {
  return pnameSpans(section).at(-1) ?? headerSpanOf(section);
}

/** A section named by a semantic record must exist; its absence would be a defect, not input data. */
function requireSection(classification: Classification, sectionIndex: number): ClassifiedSection {
  const section = classification.sections.find((candidate) => candidate.index === sectionIndex);
  if (section === undefined) {
    throw new Error(`json envelope: section ${String(sectionIndex)} is missing from the scan`);
  }
  return section;
}

/** A semantic record named by a section must exist; same contract as `requireSection`. */
function requireRecord<T>(record: T | undefined, what: string, sectionIndex: number): T {
  if (record === undefined) {
    throw new Error(
      `json envelope: ${what} for section ${String(sectionIndex)} is missing from the semantics`,
    );
  }
  return record;
}

function jsonField(field: DecodedField): JsonField {
  return {
    elementsSeen: field.elementsSeen,
    logicalName: jsonValue(field.logicalName),
    physicalName: jsonValue(field.physicalName),
    dataType: jsonValue(field.dataType),
    notNull: jsonOptionalValue(field.notNull),
    notNullToken: field.notNullToken,
    notNullRaw: field.notNullRaw,
    keyOrder: jsonOptionalValue(field.keyOrder),
    keyOrderToken: field.keyOrderToken,
    keyOrderRaw: field.keyOrderRaw,
    defaultValue: jsonValue(field.defaultValue),
    comment: jsonValue(field.comment),
    color: jsonOptionalValue(field.color),
    option: jsonValue(field.option),
    additionalOption: jsonValue(field.additionalOption),
    raw: field.raw,
    span: jsonSpan(field.span),
  };
}

function jsonIndexInfo(index: DecodedIndexes['canonical'][number]): JsonIndexInfo {
  return {
    name: jsonValue(index.name),
    uniqueness: jsonOptionalValue(index.uniqueness),
    uniquenessToken: index.uniquenessToken,
    columns: index.columns.map(jsonValue),
    option: jsonValue(index.option),
    elementsSeen: index.elementsSeen,
    raw: index.raw,
    span: jsonSpan(index.span),
    role: index.role,
  };
}

function jsonLegacyIndex(index: DecodedIndexes['legacy'][number]): JsonLegacyIndex {
  return {
    shape: index.shape,
    name: jsonOptionalValue(index.name),
    uniqueness: jsonOptionalValue(index.uniqueness),
    columns: index.columns.map(jsonValue),
    payload: jsonValue(index.payload),
    raw: index.raw,
    span: jsonSpan(index.span),
    role: index.role,
  };
}

function jsonIndexOption(option: DecodedIndexes['legacyOptions'][number]): JsonIndexOption {
  return {
    shape: option.shape,
    payload: jsonValue(option.payload),
    raw: option.raw,
    span: jsonSpan(option.span),
    role: option.role,
  };
}

/** Both index spellings, in declaration order; the role is the profile's label, not a filter. */
function jsonIndexes(indexes: DecodedIndexes): JsonIndexes {
  return {
    canonical: indexes.canonical.map(jsonIndexInfo),
    legacy: indexes.legacy.map(jsonLegacyIndex),
    legacyOptions: indexes.legacyOptions.map(jsonIndexOption),
    primarySource: indexes.primarySource,
  };
}

function jsonObjectPosition(position: ObjectPosition): JsonObjectPosition {
  return {
    kind: 'object',
    page: jsonValue(position.page),
    x: jsonOptionalValue(position.x),
    y: jsonOptionalValue(position.y),
    width: jsonOptionalValue(position.width),
    height: jsonOptionalValue(position.height),
    rawElements: jsonRawElements(position.rawElements),
    elementsSeen: position.elementsSeen,
    raw: position.raw,
    span: jsonSpan(position.span),
  };
}

function jsonRelationPosition(position: RelationPosition): JsonRelationPosition {
  return {
    kind: 'relation',
    page: jsonValue(position.page),
    lineMode: jsonOptionalValue(position.lineMode),
    linePositions: position.linePositions.map(jsonOptionalValue),
    terminals: position.terminals.map(jsonValue),
    vertices: jsonValue(position.vertices),
    rawElements: jsonRawElements(position.rawElements),
    elementsSeen: position.elementsSeen,
    raw: position.raw,
    span: jsonSpan(position.span),
  };
}

function jsonUnsupportedPosition(position: UnsupportedPosition): JsonUnsupportedPosition {
  return {
    kind: 'unsupported',
    reason: position.reason,
    sectionKind: position.sectionKind,
    rawElements: jsonRawElements(position.rawElements),
    elementsSeen: position.elementsSeen,
    raw: position.raw,
    span: jsonSpan(position.span),
  };
}

function jsonPosition(position: DecodedPosition): JsonPosition {
  switch (position.kind) {
    case 'object':
      return jsonObjectPosition(position);
    case 'relation':
      return jsonRelationPosition(position);
    case 'unsupported':
      return jsonUnsupportedPosition(position);
  }
}

/** A Complex token, projected without decoding it: elements and the omitted-tail flag (§7.1). */
function jsonComplexValue(value: ComplexValue): JsonComplexValue {
  return {
    parts: value.parts.map((part) => ({
      value: part.value,
      quoted: part.quoted,
      hadEscape: part.hadEscape,
    })),
    trailingElementsOmitted: value.trailingElementsOmitted,
  };
}

/** One token, as decoded, or the reason it was not. Never `undefined`, never a silent default. */
function jsonAttributeToken(outcome: DecodeOutcome, kind: ValueType): JsonAttributeToken {
  if (!outcome.ok) return { status: 'invalid', kind, reason: outcome.invalid.reason };
  const value = outcome.value.value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { status: 'decoded', kind, value };
  }
  return { status: 'decoded', kind, value: jsonComplexValue(value) };
}

/** One non-projected key with its provenance (§4.5 `attributes`, §9.3). */
function jsonAttribute(occurrence: KeyOccurrence): JsonAttribute {
  return {
    key: occurrence.spec.key,
    keyRaw: occurrence.keyRaw,
    disposition: occurrence.spec.disposition,
    // A token that did not decode was still declared; `value.status` carries the failure.
    origin: occurrence.decoded.ok ? occurrence.decoded.value.origin : 'declared',
    raw: occurrence.raw,
    span: occurrence.span === null ? null : jsonSpan(occurrence.span),
    value: jsonAttributeToken(occurrence.decoded, occurrence.spec.type),
  };
}

/**
 * Every key of a section that is not carried by a structured slot, in file order.
 *
 * Defaulted keys come after the declared ones: a default has no line, so it cannot take a place in
 * file order, and appending it keeps the declared sequence intact (§4.2).
 */
function jsonAttributes(
  section: ClassifiedSection,
  projected: ReadonlySet<string>,
): JsonAttribute[] {
  const attributes: JsonAttribute[] = [];
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    if (projected.has(entry.occurrence.spec.key)) continue;
    attributes.push(jsonAttribute(entry.occurrence));
  }
  for (const occurrence of section.defaults) {
    if (projected.has(occurrence.spec.key)) continue;
    attributes.push(jsonAttribute(occurrence));
  }
  return attributes;
}

function jsonInvalidOrdinal(
  ordinal: InferredPrimaryKey['invalidOrdinals'][number],
): JsonInvalidOrdinal {
  return { raw: ordinal.raw, span: jsonSpan(ordinal.span) };
}

function jsonPrimaryKeyColumn(column: InferredPrimaryKey['columns'][number]): JsonPrimaryKeyColumn {
  return { pname: column.pname, ordinal: column.ordinal, span: jsonSpan(column.span) };
}

/**
 * The inferred key as one of four explicit states (§9.2, R23).
 *
 * A key whose ordinals did not all decode is `partial`, and its `value` is only the safe subset —
 * the omitted ordinals are in `invalidOrdinals`, so the subset is never passed off as the key. An
 * object with no usable ordinal has no key record at all and is `indeterminate`, not `absent`, when
 * the file did declare one that failed to decode.
 */
function jsonPrimaryKey(
  key: InferredPrimaryKey | undefined,
  indeterminate: IndeterminateKey | undefined,
): JsonPrimaryKey {
  if (key === undefined) {
    if (indeterminate === undefined) return { status: 'absent' };
    return {
      status: 'indeterminate',
      invalidOrdinals: indeterminate.invalidOrdinals.map(jsonInvalidOrdinal),
    };
  }

  const base = {
    value: key.columns.map((column) => column.pname),
    origin: 'inferred' as const,
    span: null,
    derivedFrom: key.derivedFrom.map(jsonSpan),
    columns: key.columns.map(jsonPrimaryKeyColumn),
  };

  if (key.invalidOrdinals.length === 0) return { status: 'inferred', ...base };
  return {
    status: 'partial',
    ...base,
    invalidOrdinals: key.invalidOrdinals.map(jsonInvalidOrdinal),
  };
}

function jsonEffectiveColumn(column: EffectiveColumn): JsonEffectiveColumn {
  return {
    pname: column.pname,
    logicalName: column.logicalName,
    source: column.source,
    span: jsonSpan(column.span),
    collision: column.collision,
  };
}

/** An entity's effective list, with `partial` for an undecidable common-column opt-in (§4.5, P12). */
function jsonEntityColumns(columns: EntityColumns): JsonEntityColumns {
  const base = {
    columns: columns.effective.map(jsonEffectiveColumn),
    declared: columns.declared.map(jsonEffectiveColumn),
    common: columns.common.map(jsonEffectiveColumn),
    collisions: columns.collisions.map((collision) => ({
      sectionIndex: collision.sectionIndex,
      object: collision.object,
      pname: collision.pname,
      spans: collision.spans.map(jsonSpan),
    })),
    usingCommonColumns: {
      value: columns.usingCommonColumns.value,
      origin: columns.usingCommonColumns.origin,
      raw: columns.usingCommonColumns.raw,
      span:
        columns.usingCommonColumns.span === null ? null : jsonSpan(columns.usingCommonColumns.span),
      token: columns.usingCommonColumns.token,
    },
  };

  if (!columns.indeterminate) return { status: 'complete', ...base };
  return {
    status: 'partial',
    unknown: 'common-fields-not-enumerated',
    reason: 'using-common-columns-unrecognised',
    ...base,
  };
}

function entityObject(input: LoadedIntegrationInput, section: ClassifiedSection): JsonEntityObject {
  const key = input.semantics.primaryKeys.find(
    (candidate) => candidate.sectionIndex === section.index,
  );
  const indeterminate = input.semantics.indeterminateKeys.find(
    (candidate) => candidate.sectionIndex === section.index,
  );
  const columns = requireRecord(
    input.semantics.entityColumns.find((candidate) => candidate.sectionIndex === section.index),
    'effective columns',
    section.index,
  );

  return {
    kind: 'entity',
    sectionIndex: section.index,
    sectionHeader: section.headerRaw,
    span: jsonSpan(reportSpanOf(section)),
    pname: declaredString(section, 'PName'),
    lname: declaredString(section, 'LName'),
    comment: declaredString(section, 'Comment'),
    scalars: jsonProjectedScalars(section, isEntityScalarKey),
    fields: section.decoded.fields.map(jsonField),
    indexes: jsonIndexes(section.decoded.indexes),
    primaryKey: jsonPrimaryKey(key, indeterminate),
    positions: section.decoded.positions.map(jsonPosition),
    effectiveColumns: jsonEntityColumns(columns),
    attributes: jsonAttributes(section, ENTITY_PROJECTED),
  };
}

function viewObject(input: LoadedIntegrationInput, section: ClassifiedSection): JsonViewObject {
  const view = requireRecord(
    input.semantics.views.find((candidate) => candidate.sectionIndex === section.index),
    'view',
    section.index,
  );

  return {
    kind: 'view',
    sectionIndex: section.index,
    sectionHeader: section.headerRaw,
    span: jsonSpan(view.span),
    pname: declaredString(section, 'PName'),
    lname: declaredString(section, 'LName'),
    comment: declaredString(section, 'Comment'),
    scalars: jsonProjectedScalars(section, isViewScalarKey),
    query: view.query,
    queryRaw: view.queryRaw,
    querySpan: view.querySpan === null ? null : jsonSpan(view.querySpan),
    lnameByComment: {
      value: view.lnameByComment.value,
      origin: view.lnameByComment.origin,
      raw: view.lnameByComment.raw,
      span: view.lnameByComment.span === null ? null : jsonSpan(view.lnameByComment.span),
      token: view.lnameByComment.token,
    },
    effectiveColumns: {
      status: view.effectiveColumns.status,
      reason: view.effectiveColumns.reason,
    },
    positions: view.positions.map(jsonPosition),
    attributes: jsonAttributes(section, VIEW_PROJECTED),
  };
}

function subtypeObject(
  input: LoadedIntegrationInput,
  section: ClassifiedSection,
): JsonSubtypeObject {
  const subtype: SubtypeDeclaration = requireRecord(
    input.semantics.subtypes.find((candidate) => candidate.sectionIndex === section.index),
    'subtype',
    section.index,
  );

  return {
    kind: 'subtype',
    sectionIndex: section.index,
    sectionHeader: section.headerRaw,
    span: jsonSpan(subtype.span),
    headerSpan: jsonSpan(subtype.headerSpan),
    pname: declaredString(section, 'PName'),
    lname: declaredString(section, 'LName'),
    comment: declaredString(section, 'Comment'),
    scalars: jsonProjectedScalars(section, isSubtypeScalarKey),
    sharedMode: {
      value: subtype.sharedMode.value,
      raw: subtype.sharedMode.raw,
      span: subtype.sharedMode.span === null ? null : jsonSpan(subtype.sharedMode.span),
      token: subtype.sharedMode.token,
    },
    completeCategory: {
      value: subtype.completeCategory.value,
      raw: subtype.completeCategory.raw,
      span: subtype.completeCategory.span === null ? null : jsonSpan(subtype.completeCategory.span),
      token: subtype.completeCategory.token,
    },
    zOrder: {
      value: subtype.zOrder.value,
      raw: subtype.zOrder.raw,
      span: subtype.zOrder.span === null ? null : jsonSpan(subtype.zOrder.span),
      token: subtype.zOrder.token,
    },
    membership: {
      status: subtype.membership.status,
      reason: subtype.membership.reason,
    },
    positions: subtype.positions.map(jsonPosition),
    attributes: jsonAttributes(section, SUBTYPE_PROJECTED),
  };
}

/** Every resolved object, in file order; a section with no `PName` is still an object. */
function jsonObjects(input: LoadedIntegrationInput): JsonObject[] {
  const objects: JsonObject[] = [];
  for (const section of input.classification.sections) {
    switch (section.kind) {
      case 'Entity':
        objects.push(entityObject(input, section));
        break;
      case 'View':
        objects.push(viewObject(input, section));
        break;
      case 'Subtype':
        objects.push(subtypeObject(input, section));
        break;
      default:
        // `[Manager]`, relations and the unmodelled section kinds are projected elsewhere or not
        // at all (§4.5); they are not objects.
        break;
    }
  }
  return objects;
}

function jsonRelationEndpoint(endpoint: RelationEndpoint): JsonRelationEndpoint {
  return {
    key: endpoint.key,
    declared: endpoint.declared,
    raw: endpoint.raw,
    span: jsonSpan(endpoint.span),
    status: endpoint.status,
    resolvedEntity: endpoint.resolvedEntity,
    candidates: endpoint.candidates,
  };
}

function jsonRelationColumn(column: RelationColumn): JsonRelationColumn {
  return {
    pname: column.pname,
    raw: column.raw,
    span: jsonSpan(column.span),
    index: column.index,
    empty: column.empty,
  };
}

function jsonRelationColumnList(list: RelationColumnList): JsonRelationColumnList {
  return {
    key: list.key,
    raw: list.raw,
    span: jsonSpan(list.span),
    columns: list.columns.map(jsonRelationColumn),
  };
}

/**
 * Every declared occurrence of one kind's projected scalars, in file order.
 *
 * This is the retention half of §4.2's last-wins rule: the typed slots keep the occurrence the
 * rule selects, and this list keeps all of them, so an overwritten value never survives only as an
 * `S_DUPLICATE_KEY` count. `value` is the same token shape `attributes` uses, so an occurrence that
 * did not decode is kept as `invalid` with its reason rather than disappearing (R26).
 *
 * One function for every kind that has projected keys — the three objects and `[Relation]` — so the
 * record shape cannot drift between them; `isScalarKey` is the kind's own membership test and `Key`
 * its key union, so a record cannot name a key the kind does not project. The record is shared by
 * every slot shape: a `JsonValue`, an `Entity1`/`Fields1` endpoint or column list, a subtype fact —
 * all of them are a declaration with a line, so all of them belong here.
 *
 * Only `parsed` entries are read: a defaulted key has no line, and of these keys only
 * `UsingCommonColumns` has a documented default (§4.2), so nothing can be fabricated here.
 */
function jsonProjectedScalars<Key extends string>(
  section: ClassifiedSection,
  isScalarKey: (key: string) => key is Key,
): JsonProjectedScalar<Key>[] {
  const scalars: JsonProjectedScalar<Key>[] = [];
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    const { occurrence } = entry;
    if (!isScalarKey(occurrence.spec.key)) continue;
    // Every entry is a line, so its span exists; the guard keeps the type honest, not the data.
    if (occurrence.span === null) continue;
    scalars.push({
      key: occurrence.spec.key,
      keyRaw: occurrence.keyRaw,
      origin: 'declared',
      raw: occurrence.raw,
      span: jsonSpan(occurrence.span),
      value: jsonAttributeToken(occurrence.decoded, occurrence.spec.type),
    });
  }
  return scalars;
}

/** The nine projected `[Relation]` keys, through the shared record builder. */
function jsonRelationScalars(section: ClassifiedSection): JsonRelationScalar[] {
  return jsonProjectedScalars(section, isRelationScalarKey);
}

/**
 * One relation: the resolved record, its presentation records and its scalar declarations.
 *
 * The interpreted scalars are read from the classification, not copied from `ResolvedRelation`,
 * because the semantic record keeps only the interpretation while §12 rules 3 and 4 need the token
 * it came from. Both derive from the same occurrence under the same last-wins rule
 * (`semantic/access.ts`), so the pair cannot disagree; `tests/json-contract.test.ts` pins that.
 */
function jsonRelation(relation: ResolvedRelation, classification: Classification): JsonRelation {
  const section = requireSection(classification, relation.sectionIndex);
  return {
    sectionIndex: relation.sectionIndex,
    sectionHeader: relation.sectionHeader,
    span: jsonSpan(reportSpanOf(section)),
    pname: declaredString(section, 'PName'),
    from: relation.from === null ? null : jsonRelationEndpoint(relation.from),
    to: relation.to === null ? null : jsonRelationEndpoint(relation.to),
    fromColumns:
      relation.fromColumns === null ? null : jsonRelationColumnList(relation.fromColumns),
    toColumns: relation.toColumns === null ? null : jsonRelationColumnList(relation.toColumns),
    relationType1: declaredNumber(section, 'RelationType1'),
    relationType2: declaredNumber(section, 'RelationType2'),
    cardinarity1: declaredString(section, 'Cardinarity1'),
    cardinarity2: declaredString(section, 'Cardinarity2'),
    scalars: jsonRelationScalars(section),
    columnsAligned: relation.columnsAligned,
    positions: section.decoded.positions.map(jsonPosition),
    attributes: jsonAttributes(section, RELATION_PROJECTED),
  };
}

function jsonPage(page: PageDeclaration): JsonPage {
  return {
    name: page.name,
    raw: page.raw,
    span: jsonSpan(page.span),
    displayMode: page.displayMode,
    paperSize: page.paperSize,
    background: page.background,
    elementsSeen: page.elementsSeen,
    shape: page.shape,
    rawElements: jsonRawElements(page.rawElements),
  };
}
/**
 * One `Position` page reference: what the placement asked for, its own line, and the outcome.
 *
 * Read from `pagesOf`'s record, not re-resolved: `status`, the target and the candidates were
 * decided once, over the whole file, and the serializer only shapes them.
 */
function jsonPageReference(reference: PageReference): JsonPageReference {
  const base = {
    sectionIndex: reference.sectionIndex,
    sectionKind: reference.sectionKind,
    declared: reference.declared,
    raw: reference.raw,
    span: jsonSpan(reference.span),
  };
  switch (reference.status) {
    case 'resolved': {
      const target = reference.resolvedPage;
      const targetSpan = reference.resolvedSpan;
      // `pagesOf` sets the two members together; a resolved reference without them would be a
      // semantic bug, and inventing a target here would hide it.
      if (target === null || targetSpan === null) {
        throw new Error('a resolved page reference carries no target declaration');
      }
      return {
        ...base,
        status: 'resolved',
        resolvedPage: { name: target, span: jsonSpan(targetSpan) },
        candidates: [],
      };
    }
    case 'ambiguous':
      return {
        ...base,
        status: 'ambiguous',
        resolvedPage: null,
        candidates: reference.candidates.map((candidate) => ({
          name: candidate.name,
          span: jsonSpan(candidate.span),
        })),
      };
    case 'dangling':
      return { ...base, status: 'dangling', resolvedPage: null, candidates: [] };
  }
}
/** The semantic classification, arm for arm; nothing is re-decided and no SQL type is inferred. */
function jsonTypeResolution(classification: TypeClassification): JsonTypeResolution {
  switch (classification.kind) {
    case 'system':
      return { kind: 'system', name: classification.name, known: classification.known };
    case 'user':
      if (classification.status === 'resolved') {
        return {
          kind: 'user',
          status: 'resolved',
          name: classification.name,
          resolvedDomain: {
            name: classification.resolvedDomain,
            span: jsonSpan(classification.resolvedSpan),
          },
        };
      }
      return {
        kind: 'user',
        status: 'ambiguous',
        name: classification.name,
        candidates: classification.candidates.map((candidate) => ({
          name: candidate.name,
          span: jsonSpan(candidate.span),
        })),
      };
    case 'plain':
      // Unreachable: `domainsOf` keeps only system and user references (`referencesOf` drops the
      // plain arm), and a plain `Field` type is documented as absent, not as an empty record.
      throw new Error('a plain type has no domain reference to project');
  }
}
/** One `Field` that names a domain, with the classification the semantic layer decided (§9.4). */
function jsonDomainReference(reference: DomainReference): JsonDomainReference {
  return {
    sectionIndex: reference.sectionIndex,
    column: reference.column,
    dataType: reference.dataType,
    span: jsonSpan(reference.span),
    classification: jsonTypeResolution(reference.classification),
  };
}

function jsonDomain(domain: DomainDeclaration): JsonDomain {
  return {
    name: domain.name,
    dataType: domain.dataType,
    dataTypeKind: domain.dataTypeKind,
    comment: domain.comment,
    defaultColumn: domain.defaultColumn,
    raw: domain.raw,
    span: jsonSpan(domain.span),
    elementsSeen: domain.elementsSeen,
    shape: domain.shape,
    rawElements: jsonRawElements(domain.rawElements),
  };
}

function jsonCommonField(declaration: CommonColumnDeclaration): JsonCommonField {
  return {
    logicalName: declaration.logicalName,
    physicalName: declaration.physicalName,
    dataType: declaration.dataType,
    notNull: declaration.notNull,
    notNullToken: declaration.notNullToken,
    keyOrder: declaration.keyOrder,
    keyOrderToken: declaration.keyOrderToken,
    keyOrderRaw: declaration.keyOrderRaw,
    defaultValue: declaration.defaultValue,
    comment: declaration.comment,
    color: declaration.color,
    raw: declaration.raw,
    span: jsonSpan(declaration.span),
    elementsSeen: declaration.elementsSeen,
    shape: declaration.shape,
    rawElements: jsonRawElements(declaration.rawElements),
  };
}

/** `[Manager]`'s remaining keys, from every repeated Manager section in file order (§3.1). */
function jsonManagerAttributes(classification: Classification): JsonAttribute[] {
  const attributes: JsonAttribute[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Manager') continue;
    attributes.push(...jsonAttributes(section, MANAGER_PROJECTED));
  }
  return attributes;
}

/** The resolved model of §4.5, built from the classification and the semantic projections. */
function jsonSchema(input: LoadedIntegrationInput): JsonSchema {
  const { classification, semantics } = input;
  return {
    objects: jsonObjects(input),
    relations: semantics.relations.map((relation) => jsonRelation(relation, classification)),
    pages: semantics.pages.map(jsonPage),
    pageReferences: semantics.pageReferences.map(jsonPageReference),
    domains: semantics.domains.map(jsonDomain),
    domainReferences: semantics.domainReferences.map(jsonDomainReference),
    commonFields: semantics.commonFields.map(jsonCommonField),
    manager: { attributes: jsonManagerAttributes(classification) },
  };
}

/** The read's identity and decoding facts; only a loaded input has them (§14 row 11). */
function jsonSource(input: LoadedIntegrationInput, path: string): JsonSource {
  const source = input.load.source;
  const declared = source.format;
  const known = input.scan.format.known;
  return {
    path,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    encoding: {
      detected: source.encoding.detected,
      bom: source.encoding.bom,
      declared: source.encoding.declared,
      mismatch: source.encoding.mismatch,
    },
    format: {
      declared,
      // `effective` is declared only when this build knows the declaration; see `envelope.ts`.
      effective: known ? declared : null,
      known,
    },
  };
}

/**
 * The known section kinds the resolved model of §4.5 has no collection for.
 *
 * They are *recognised* (`src/syntax/sections.ts`) and have real registries
 * (`src/schema/registry.ts`), so their keys are classified and counted — but `jsonObjects` has no
 * arm for them, and §4.5's model has no slot. Without the projection below, `[Shape]`, `[Line]`
 * and `[Comment]` would be counted as parsed and reported nowhere: `keys.parsed` would claim keys
 * the envelope never shows, which is the "nothing is silently dropped" promise broken quietly.
 *
 * `'unknown'` is deliberately absent: an unmodelled header already arrives as an
 * `unknown-section` `RawEntry` from Integration (§4.3).
 */
const UNRESOLVED_SECTION_KINDS: ReadonlySet<SectionKind> = new Set(['Shape', 'Line', 'Comment']);

/**
 * The two stable machine reasons of the `unsupported-construct` records projected below.
 *
 * They are evidence codes, not diagnostics: §11 assigns no `V_*` to an unmodelled section kind,
 * and inventing one is out of scope. Never file text, so a reason stays comparable across files.
 */
const UNRESOLVED_SECTION_REASON = 'section-not-in-resolved-model';
const UNRESOLVED_KEY_REASON = 'key-not-in-resolved-model';

/** One physical line's key in `keyLineTexts`, carrying the same coordinates a `Span` does. */
function lineKey(span: Span): string {
  return `${String(span.sectionIndex)}:${String(span.keyLine)}`;
}

/**
 * Every `key=value` line of the scan, by the line it sits on.
 *
 * §12 rule 4 wants the *line* a record is about, and a parsed occurrence keeps only its value text
 * (`KeyOccurrence.raw`), so the original line is read from the scan rather than rebuilt as
 * `keyRaw + '=' + raw`. That concatenation happens to reproduce the line exactly — the scanner
 * splits on the first `=` — but a lookup cannot drift from the scan, and re-deriving whitespace is
 * exactly the re-parsing this layer does not do.
 */
function keyLineTexts(scan: LoadedIntegrationInput['scan']): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  for (const entry of scan.header.keyLines) texts.set(lineKey(entry.span), entry.raw);
  for (const section of scan.sections) {
    for (const entry of section.entries) {
      if (entry.kind !== 'key') continue;
      texts.set(lineKey(entry.span), entry.raw);
    }
  }
  return texts;
}

/**
 * §13 evidence for every `[Shape]`, `[Line]` and `[Comment]` declaration (§12 rule 7).
 *
 * One record for the header — the section has no object to hang it on — and one per parsed key, in
 * file order. Every record carries the line it is about: the header's own line, or the original
 * `key=value` line taken from the scan.
 *
 * **Why this is not a recount.** `keys.parsed` already counts these keys, and completeness is not
 * touched here: the records are evidence, exactly like an `unsupported-position`, and Integration's
 * counters are projected unchanged. **Why nothing is counted twice.** The two sources are disjoint
 * by construction: Integration's list holds records for lines the registry could *not* model
 * (unknown sections, unknown keys, broken lines, unsupported positions, subtype membership), while
 * this projection only reads `parsed` entries of three *known* kinds and their headers.
 *
 * **Where this belongs.** `RetentionKind` already declares `'unsupported-construct'`
 * (`src/schema/registry.ts`), but no production path emits it; the registry stage would have to
 * keep the line and the resolved model would have to own the projection. Both are outside this
 * unit's scope, so the projection lives here, in one function, and reads nothing but the scan and
 * the classification. Recorded as a known scope boundary: a later move into `validate/` should
 * delete this function and emit the same records there, not add a second copy.
 */
function unrepresentedEvidence(input: LoadedIntegrationInput): UnsupportedEvidence[] {
  const lines = keyLineTexts(input.scan);
  const evidence: UnsupportedEvidence[] = [];
  for (const section of input.classification.sections) {
    if (!UNRESOLVED_SECTION_KINDS.has(section.kind)) continue;
    evidence.push({
      kind: 'unsupported-construct',
      sectionKind: section.kind,
      sectionHeader: section.headerRaw,
      key: null,
      raw: section.headerRaw,
      span: headerSpanOf(section),
      reason: UNRESOLVED_SECTION_REASON,
    });
    for (const entry of section.entries) {
      if (entry.kind !== 'parsed') continue;
      const { occurrence } = entry;
      const span = occurrence.span;
      // A defaulted key has no line; none of these kinds declares a default, so this is a guard.
      if (span === null) continue;
      const line = lines.get(lineKey(span));
      if (line === undefined) {
        // Every parsed occurrence came from a scanned line: a miss is this tool's defect, not data.
        throw new Error(
          `json envelope: no scanned line for ${occurrence.spec.key} at line ${String(span.keyLine)}`,
        );
      }
      evidence.push({
        kind: 'unsupported-construct',
        sectionKind: section.kind,
        sectionHeader: section.headerRaw,
        key: occurrence.keyRaw,
        raw: line,
        span,
        reason: UNRESOLVED_KEY_REASON,
      });
    }
  }
  return evidence;
}

/** Lexicographic text order, matching `validate/`'s comparator so both lists sort identically. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** §12 rule 7's evidence order: position first, then the fields that keep a tie deterministic. */
function compareEvidence(left: UnsupportedEvidence, right: UnsupportedEvidence): number {
  return (
    left.span.startLine - right.span.startLine ||
    left.span.sectionIndex - right.span.sectionIndex ||
    compareText(left.kind, right.kind) ||
    compareText(left.raw, right.raw) ||
    compareText(left.reason, right.reason)
  );
}

/**
 * Integration's evidence plus the `unsupported-construct` records, in one ordered list.
 *
 * A **merge**, not a re-sort: each added record is inserted at its position under the same total
 * order, so Integration's own sequence keeps its relative order and its duplicates stay where they
 * were. Two records may share a line without being ambiguous — a `[Shape]` `Position` line is both
 * an unmodelled key and an undocumented position shape — and there the comparator's `kind`/`raw`
 * tie-breaks put them in the documented order rather than in arrival order.
 */
function mergeEvidence(
  ordered: readonly UnsupportedEvidence[],
  added: readonly UnsupportedEvidence[],
): UnsupportedEvidence[] {
  const merged = [...ordered];
  for (const record of added) {
    const at = merged.findIndex((existing) => compareEvidence(record, existing) < 0);
    if (at === -1) merged.push(record);
    else merged.splice(at, 0, record);
  }
  return merged;
}

/**
 * The envelope's `unsupported` list: Integration's evidence, plus the known-but-unprojected kinds.
 *
 * A failed read has no classification to project from, so it keeps Integration's empty list.
 */
function jsonUnsupportedList(
  integration: Integration,
  loaded: LoadedIntegrationInput | null,
): JsonUnsupported[] {
  if (loaded === null) return integration.unsupported.map(jsonUnsupported);
  return mergeEvidence(integration.unsupported, unrepresentedEvidence(loaded)).map(jsonUnsupported);
}
function jsonUnsupported(evidence: UnsupportedEvidence): JsonUnsupported {
  return {
    kind: evidence.kind,
    sectionKind: evidence.sectionKind,
    sectionHeader: evidence.sectionHeader,
    key: evidence.key,
    raw: evidence.raw,
    span: jsonSpan(evidence.span),
    reason: evidence.reason,
  };
}

function jsonDiagnostic(diagnostic: CompletedIntegration['diagnostics'][number]): JsonDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    details: { ...diagnostic.details },
    span: diagnostic.span === null ? null : jsonSpan(diagnostic.span),
    construct: diagnostic.construct,
  };
}

/**
 * §13's counters, projected verbatim: this layer recounts nothing.
 *
 * **Documented contradiction, recorded not fixed.** §12 rule 2 (`docs/architecture.md`, the
 * sentence "`sections.total` and `keys.total` must equal structured + raw-preserved +
 * unsupported-reported") is arithmetically false with `unsupported` as a third term: that list is a
 * *projection* of records already counted in `preservedRaw` plus constructs that own no counter at
 * all (`multiline-value`, `unsupported-position`, `subtype-membership`), which is why `hst-04` has
 * 5 sections against 11 evidence records. The two-term identity in §13 (`parsed + preservedRaw`)
 * is what `validate/` reconciles and what every golden holds; fixing the wording is a docs change
 * outside stage 6-A. The same stale formula is in `docs/test-strategy.md`'s G-1 row.
 *
 * The `unsupported-construct` records this module adds are no exception: they are evidence for
 * parsed keys, counted in `keys.parsed` once, and never a third term.
 */
function jsonCompleteness(completeness: CompletedIntegration['completeness']): JsonCompleteness {
  return {
    sections: {
      total: completeness.sections.total,
      parsed: completeness.sections.parsed,
      preservedRaw: completeness.sections.preservedRaw,
      unknown: completeness.sections.unknown,
    },
    keys: {
      total: completeness.keys.total,
      parsed: completeness.keys.parsed,
      preservedRaw: completeness.keys.preservedRaw,
    },
    lines: {
      total: completeness.lines.total,
      accounted: completeness.lines.accounted,
      dropped: completeness.lines.dropped,
    },
    dropped: completeness.dropped,
  };
}

/**
 * Build the envelope for one invocation.
 *
 * `integrate()` is called exactly once, and every policy answer in the result comes from it. A
 * rejected input has no source, no schema and no counts, so all three are `null` rather than empty
 * placeholders (§12 rule 1, §14 row 11). `limits.truncated` is derived from the integrated
 * diagnostic sequence and nothing else: `E_TRUNCATED_INPUT` is the only code that reports a read
 * that stopped early, and Integration already placed it where it belongs.
 */
export function serialize(input: IntegrationInput, context: SerializeContext): JsonEnvelope {
  const integration = integrate(input);
  const limits = context.limits ?? DEFAULT_LIMITS;
  const truncated = integration.diagnostics.some(
    (diagnostic) => diagnostic.code === 'E_TRUNCATED_INPUT',
  );
  const loaded: LoadedIntegrationInput | null = isLoadedInput(input) ? input : null;

  return {
    contractVersion: CONTRACT_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    command: context.command,
    status: integration.status,
    source: loaded === null ? null : jsonSource(loaded, context.path),
    limits: { maxBytes: limits.maxBytes, truncated },
    schema: loaded === null ? null : jsonSchema(loaded),
    unsupported: jsonUnsupportedList(integration, loaded),
    diagnostics: integration.diagnostics.map(jsonDiagnostic),
    completeness:
      integration.completeness === null ? null : jsonCompleteness(integration.completeness),
  };
}

/**
 * `JSON.stringify` with a replacer that refuses lossy values.
 *
 * `JSON.stringify` silently drops `undefined`, functions and symbols, turns `NaN`/`±Infinity` into
 * `null` and throws on `bigint` only by accident of the runtime. Each of those would turn a missing
 * fact into a different, plausible-looking one, so this replacer throws a `TypeError` instead. The
 * key is named; the value is not echoed, because it can be file text.
 */
function strictReplacer(key: string, value: unknown): unknown {
  const where = ` at key ${JSON.stringify(key)}`;
  switch (typeof value) {
    case 'undefined':
      throw new TypeError(`cannot serialise undefined${where}`);
    case 'function':
      throw new TypeError(`cannot serialise a function${where}`);
    case 'symbol':
      throw new TypeError(`cannot serialise a symbol${where}`);
    case 'bigint':
      throw new TypeError(`cannot serialise a bigint${where}`);
    case 'number':
      if (!Number.isFinite(value))
        throw new TypeError(`cannot serialise a non-finite number${where}`);
      return value;
    default:
      return value;
  }
}

/**
 * The envelope as one deterministic JSON string.
 *
 * No indentation and no newline: formatting belongs to the command layer, while this function's
 * contract is byte-for-byte repeatability for the same envelope. Key order is the construction
 * order of `envelope.ts`, which is the emission order of §12.
 */
export function toJsonString(envelope: JsonEnvelope): string {
  return JSON.stringify(envelope, strictReplacer);
}
