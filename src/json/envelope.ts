/**
 * The JSON envelope's contract (`architecture.md` §12, §13; `test-strategy.md` §3.6, §14 stage 6).
 *
 * **What this module is.** The type system of the one machine-readable document the CLI will emit:
 * the envelope fields of §12, the resolved model's five collections plus `manager` (§4.5), and the
 * §4.2 shapes (`Value<T>`, spans, raw text) projected into JSON. It holds no logic and touches no
 * stage: construction is `serialize.ts`'s job, and everything here is a type or a frozen constant.
 *
 * **Two versions, deliberately independent.** `CONTRACT_VERSION` is the JSON contract's version
 * (§12 rule 5, TBD-O5), not the package's: a package release that changes no field does not move it,
 * and a field change bumps it even if the package version stays put. `TOOL_VERSION` is the real
 * package version, mirrored as a literal here because `src/json/` must not import `package.json`
 * (a runtime manifest read would make output depend on the installation layout) and must not import
 * `src/index.ts` (the library surface is a consumer of this module, not its source). A test pins all
 * three constants against `package.json` and `VERSION`.
 *
 * **Construction order is emission order** (§12 rule 6 in reverse: renaming a field is a contract
 * change, so the order is part of the contract too). Every interface below lists its fields in the
 * order `serialize.ts` writes them, arrays are file order, and no field is optional: a member that
 * has nothing to say is an explicit `null` or a status object, never `undefined` and never omitted.
 * That is what lets `toJsonString` reject `undefined` outright instead of silently dropping it.
 *
 * **Unknown stays representable.** Three shapes exist so a consumer cannot read absence as a fact:
 * `JsonViewColumns` has no `columns` member at all (a `[View]`'s columns are not stored); the
 * `[Subtype]` membership has no member list (v2.21 declares no membership key); and a primary key
 * that could not be fully read is a status, not `[]`. They mirror the semantic records they project
 * (`ViewColumns`, `SubtypeMembership`, `InferredPrimaryKey`), which is why no new vocabulary is
 * introduced here.
 *
 * **Not modelled here.** `[Shape]`, `[Line]`, `[Comment]` and unknown sections are outside §4.5's
 * resolved model, so the envelope has no collection for them. What they contain is still evidence,
 * never a silent omission: an unknown section arrives as `unknown-section` (§4.3), and a *known*
 * section kind the model has no slot for arrives as `unsupported-construct` — one record for the
 * header and one per parsed key, each with the original line and its span (stage 6-A, §13). This
 * module does not invent a sixth schema collection for them; §17's open points own that decision.
 */

import type { Codec } from '../decode/bom.js';
import type { DiagnosticCode, DiagnosticDetail, Severity } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';
import type { KeyOrderToken, NotNullToken } from '../schema/field.js';
import type { IndexRole, Uniqueness } from '../schema/indexinfo.js';
import type {
  ObjectPosition,
  RawElement,
  RelationPosition,
  UnsupportedPosition,
} from '../schema/position.js';
import type { KeySpec } from '../schema/registry.js';
import type { InvalidReason, ValueType } from '../schema/values.js';
import type { SubtypeScalarToken } from '../semantic/subtypes.js';
import type { LNameByCommentToken, ViewColumnReason } from '../semantic/views.js';
import type { SectionKind } from '../syntax/sections.js';
import type {
  IntegrationCompleteness,
  IntegrationStatus,
  UnsupportedKind,
} from '../validate/index.js';

/**
 * The envelope's own version (`architecture.md` §12 rule 5, TBD-O5).
 *
 * Frozen at the documented `0.1.0` and **not** derived from the package version: the contract
 * version moves only when a field is added, removed or renamed.
 */
export const CONTRACT_VERSION = '0.1.0';

/** The package name, mirrored from `package.json` (which `src/json/` must not read). */
export const TOOL_NAME = '@j1nn0/a5er-cli';

/** The package version, mirrored from `package.json`; a test asserts all three agree. */
export const TOOL_VERSION = '0.1.0';

/** The two commands the envelope is built for (§12; the commands themselves are stage 7). */
export type JsonCommand = 'inspect' | 'validate';

/** Where a value came from (§4.2). `inferred` exists only on synthesised values. */
export type JsonOrigin = 'declared' | 'defaulted' | 'inferred';

/** `Span` as JSON: the same four 1-based positions, never collapsed into a line number alone. */
export interface JsonSpan {
  /** 1-based section ordinal; `0` is the header block. */
  readonly sectionIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly keyLine: number;
}

/**
 * §4.2's `Value<T>` in JSON: interpretation, origin, raw text and span, always together.
 *
 * `origin` is `declared` or `defaulted` here; a value this project computed is an
 * `JsonInferredValue` instead, so an inferred fact cannot pass for a declared one.
 */
export interface JsonValue<T> {
  readonly value: T;
  readonly origin: 'declared' | 'defaulted';
  /** The exact source text of the value; `''` when `origin` is `defaulted`. */
  readonly raw: string;
  /** The line the token came from; `null` only for a defaulted value. */
  readonly span: JsonSpan | null;
}

/** A value this project computed, with the inputs it cites (§4.2, §12 rule 3). */
export interface JsonInferredValue<T> {
  readonly value: T;
  readonly origin: 'inferred';
  /** Always `null`: an inferred value is not written on any line. */
  readonly span: null;
  readonly derivedFrom: readonly JsonSpan[];
}

/** A `RawElement` of a `Position`, kept as written. */
export interface JsonRawElement {
  readonly index: number;
  readonly raw: string;
  readonly quoted: boolean;
}

/** `[Entity]`/`[View]`/`[Subtype]` placement: `"ページ名",X,Y[,幅,高さ]` (§4.6, P11). */
export interface JsonObjectPosition {
  readonly kind: 'object';
  readonly page: JsonValue<string>;
  readonly x: JsonValue<number> | null;
  readonly y: JsonValue<number> | null;
  readonly width: JsonValue<number> | null;
  readonly height: JsonValue<number> | null;
  readonly rawElements: readonly JsonRawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: JsonSpan;
}

/** `[Relation]` line geometry: the 8-element shape (§4.6, P9). */
export interface JsonRelationPosition {
  readonly kind: 'relation';
  readonly page: JsonValue<string>;
  readonly lineMode: JsonValue<number> | null;
  readonly linePositions: readonly (JsonValue<number> | null)[];
  readonly terminals: readonly JsonValue<string>[];
  /** 頂点座標リスト, kept whole: the inner point format is not defined (K12). */
  readonly vertices: JsonValue<string>;
  readonly rawElements: readonly JsonRawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: JsonSpan;
}

/**
 * A `Position` whose grammar is undocumented or whose arity does not fit it.
 *
 * Kept in the object's `positions` **and** reported in the envelope's `unsupported` list by
 * `validate/`: the same construct appears twice on purpose, once as a placement record and once as
 * §13 evidence, and neither copy is invented here.
 */
export interface JsonUnsupportedPosition {
  readonly kind: 'unsupported';
  readonly reason: UnsupportedPosition['reason'];
  readonly sectionKind: SectionKind;
  readonly rawElements: readonly JsonRawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: JsonSpan;
}

export type JsonPosition = JsonObjectPosition | JsonRelationPosition | JsonUnsupportedPosition;

/** One decoded `Field` column (§4.7, §7.2), every element and its provenance retained. */
export interface JsonField {
  /** How many elements the writer emitted, before any defaulting (U15). */
  readonly elementsSeen: number;
  readonly logicalName: JsonValue<string>;
  readonly physicalName: JsonValue<string>;
  /** データ型 as declared; a domain name is not resolved here (P7, P12). */
  readonly dataType: JsonValue<string>;
  /** `null` when the token is neither the `NOT NULL` literal nor empty (R20). */
  readonly notNull: JsonValue<boolean> | null;
  readonly notNullToken: NotNullToken;
  readonly notNullRaw: string | null;
  /** The declared キー順 ordinal, never used to hide an unreadable one (R19). */
  readonly keyOrder: JsonValue<number> | null;
  readonly keyOrderToken: KeyOrderToken;
  readonly keyOrderRaw: string | null;
  /** デフォルト値: an expression, never evaluated (D3). */
  readonly defaultValue: JsonValue<string>;
  readonly comment: JsonValue<string>;
  /** 色 as the declared token; no RGB interpretation is claimed (F8, K10). */
  readonly color: JsonValue<string> | null;
  readonly option: JsonValue<string>;
  readonly additionalOption: JsonValue<string>;
  readonly raw: string;
  readonly span: JsonSpan;
}

/** One canonical `IndexInfo` (P8), with the profile's role label (§6). */
export interface JsonIndexInfo {
  readonly name: JsonValue<string>;
  readonly uniqueness: JsonValue<Uniqueness> | null;
  /** The declared flag text behind a `null` uniqueness, so an unexpected token stays visible. */
  readonly uniquenessToken: string | null;
  readonly columns: readonly JsonValue<string>[];
  readonly option: JsonValue<string>;
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly role: IndexRole;
}

/** One legacy `Index` (U7), labelled with the role the profile gives the legacy spelling. */
export interface JsonLegacyIndex {
  readonly shape: 'observed' | 'unrecognised';
  readonly name: JsonValue<string> | null;
  readonly uniqueness: JsonValue<Uniqueness> | null;
  readonly columns: readonly JsonValue<string>[];
  readonly payload: JsonValue<string>;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly role: IndexRole;
}

/** One legacy `IndexOption` (U7): undocumented, so only its payload is claimed. */
export interface JsonIndexOption {
  readonly shape: 'undocumented';
  readonly payload: JsonValue<string>;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly role: IndexRole;
}

/** Both index spellings, kept, with the source the profile prefers (§6, D5, L6). */
export interface JsonIndexes {
  readonly canonical: readonly JsonIndexInfo[];
  readonly legacy: readonly JsonLegacyIndex[];
  readonly legacyOptions: readonly JsonIndexOption[];
  readonly primarySource: 'canonical' | 'legacy';
}

/** One column of an entity's effective list (§9.4, P12). */
export interface JsonEffectiveColumn {
  readonly pname: string;
  readonly logicalName: string;
  readonly source: 'declared' | 'common';
  readonly span: JsonSpan;
  readonly collision: boolean;
}

/** A physical name declared twice in one effective list (kept, never overridden). */
export interface JsonColumnCollision {
  readonly sectionIndex: number;
  readonly object: string;
  readonly pname: string;
  readonly spans: readonly JsonSpan[];
}

/** How `UsingCommonColumns` was written (§4.2's default, or a token the format does not define). */
export interface JsonUsingCommonColumns {
  readonly value: number | null;
  readonly origin: 'declared' | 'defaulted';
  readonly raw: string;
  readonly span: JsonSpan | null;
  readonly token: 'one' | 'zero' | 'absent' | 'unrecognised';
}

/** The shared body of both `effectiveColumns` arms: every declared and composed record. */
interface JsonEntityColumnsBase {
  /** Declared first, then composed; nothing dropped (P12, R30's collision rule). */
  readonly columns: readonly JsonEffectiveColumn[];
  readonly declared: readonly JsonEffectiveColumn[];
  readonly common: readonly JsonEffectiveColumn[];
  readonly collisions: readonly JsonColumnCollision[];
  readonly usingCommonColumns: JsonUsingCommonColumns;
}

/**
 * An entity's effective columns, §4.5's two reachable states for a table.
 *
 * `partial` is the case where the declared columns are complete but the common-field contribution
 * cannot be decided: `UsingCommonColumns` was neither the documented `1` nor `0`, so §4.2's default
 * does not apply and composition is withheld rather than guessed (P12).
 */
export type JsonEntityColumns =
  | (JsonEntityColumnsBase & { readonly status: 'complete' })
  | (JsonEntityColumnsBase & {
      readonly status: 'partial';
      readonly unknown: 'common-fields-not-enumerated';
      readonly reason: 'using-common-columns-unrecognised';
    });

/**
 * A view's effective columns: always `unknown` (§9.6, P10).
 *
 * Deliberately has **no** `columns` member, mirroring `ViewColumns`: a `[View]` whose columns came
 * back empty would be indistinguishable from a table that declares none.
 */
export interface JsonViewColumns {
  readonly status: 'unknown';
  readonly reason: ViewColumnReason;
}

/** `LNameByComment` with its provenance; v2.21 states no default, so `absent` is never `0` (P10). */
export interface JsonLNameByComment {
  readonly value: boolean | null;
  readonly origin: 'declared' | 'absent' | 'invalid';
  readonly raw: string;
  readonly span: JsonSpan | null;
  readonly token: LNameByCommentToken;
}

/** One untyped `[Subtype]` scalar, kept as declared (F7, K11). */
export interface JsonSubtypeScalar<T> {
  readonly value: T | null;
  readonly raw: string | null;
  readonly span: JsonSpan | null;
  readonly token: SubtypeScalarToken;
}

/**
 * A subtype's membership: always unsupported, with no member list (§9.6, F7, K11).
 *
 * Mirrors `SubtypeMembership`: the shape itself guarantees no entity can be read out of it.
 */
export interface JsonSubtypeMembership {
  readonly status: 'unsupported';
  readonly reason: 'no-membership-key-in-v2.21';
}

/** One column of an inferred primary key, with the declared ordinal and the `Field` line. */
export interface JsonPrimaryKeyColumn {
  readonly pname: string;
  readonly ordinal: number;
  readonly span: JsonSpan;
}

/** An ordinal that did not decode exactly, kept with its text (R23). */
export interface JsonInvalidOrdinal {
  readonly raw: string;
  readonly span: JsonSpan;
}

/**
 * A primary key synthesised from `Field` キー順 ordinals (§9.2, §4.2).
 *
 * Four states, because "no key", "a complete key", "a key whose other ordinals did not decode" and
 * "no usable ordinal at all" are different answers. None of them is `[]`; the safe subset of a
 * `partial` key is never presented as the whole key (R23).
 */
export type JsonPrimaryKey =
  | { readonly status: 'absent' }
  | {
      readonly status: 'inferred';
      readonly value: readonly string[];
      readonly origin: 'inferred';
      readonly span: null;
      readonly derivedFrom: readonly JsonSpan[];
      readonly columns: readonly JsonPrimaryKeyColumn[];
    }
  | {
      readonly status: 'partial';
      readonly value: readonly string[];
      readonly origin: 'inferred';
      readonly span: null;
      readonly derivedFrom: readonly JsonSpan[];
      readonly columns: readonly JsonPrimaryKeyColumn[];
      readonly invalidOrdinals: readonly JsonInvalidOrdinal[];
    }
  | {
      readonly status: 'indeterminate';
      readonly invalidOrdinals: readonly JsonInvalidOrdinal[];
    };

/** One element of an uninterpreted Complex token, kept as written (§7.1). */
export interface JsonComplexPart {
  readonly value: string;
  readonly quoted: boolean;
  readonly hadEscape: boolean;
}

/** A Complex value projected without decoding it: elements and the omitted-tail flag (§7.1). */
export interface JsonComplexValue {
  readonly parts: readonly JsonComplexPart[];
  readonly trailingElementsOmitted: boolean;
}

/** What a registered key's token decoded to, or why it did not. */
export type JsonAttributeToken =
  | {
      readonly status: 'decoded';
      /** The registry's declared type, so `boolean` and `integer` stay distinguishable. */
      readonly kind: ValueType;
      readonly value: string | number | boolean | JsonComplexValue;
    }
  | {
      readonly status: 'invalid';
      /** The type the registry declared for this key, even though the token did not fit it. */
      readonly kind: ValueType;
      readonly reason: InvalidReason;
    };

/**
 * One section key that is not projected into a structured slot (§4.5 `attributes`, §9.3).
 *
 * Presentation and DDL keys exist to be preserved, not interpreted (F9, D7): this record keeps the
 * canonical key name, the spelling the file used, the registry's disposition, the raw token and its
 * line. A defaulted key has `origin: 'defaulted'`, `raw: ''` and `span: null`, exactly as §4.2 says.
 */
export interface JsonAttribute {
  /** Canonical key name (`spec.key`), e.g. the format's own `Cardinarity` spelling. */
  readonly key: string;
  /** The key text exactly as written, whitespace included. */
  readonly keyRaw: string;
  readonly disposition: KeySpec['disposition'];
  readonly origin: 'declared' | 'defaulted';
  readonly raw: string;
  readonly span: JsonSpan | null;
  readonly value: JsonAttributeToken;
}

/**
 * One declared occurrence of a key the envelope also carries in a typed slot, with its line.
 *
 * The typed slots hold the occurrence §4.2's last-wins rule **selects**; this record exists for
 * every declaration, so an overwritten value keeps its text and its line instead of surviving only
 * as an `S_DUPLICATE_KEY` count (§12 rule 4, R26). `value` is the token shape `attributes` already
 * uses: a token its type could not decode is `invalid` with the reason, never a missing
 * occurrence.
 *
 * `Key` is the kind's own key union, so the record cannot claim a key the kind does not project.
 */
export interface JsonProjectedScalar<Key extends string> {
  readonly key: Key;
  /** The key text exactly as written, whitespace included. */
  readonly keyRaw: string;
  /** Always `'declared'`: a defaulted key has no line to point at and is never in this list. */
  readonly origin: 'declared';
  /** The value text verbatim, before any unquoting. */
  readonly raw: string;
  readonly span: JsonSpan;
  readonly value: JsonAttributeToken;
}

/**
 * The scalar keys the three object kinds project into `JsonValue` slots (§4.5).
 *
 * The union is across kinds, not a claim that every kind can declare every key: `serialize.ts`
 * keeps one key set per kind, and `[Subtype]` has `PName` alone because the registry declares no
 * `LName` and no `Comment` for it. Everything else the kind registers is an attribute.
 */
export type JsonObjectScalarKey = 'PName' | 'LName' | 'Comment';

/** One declared occurrence of an object scalar, the same record a relation scalar uses. */
export type JsonObjectScalar = JsonProjectedScalar<JsonObjectScalarKey>;

/** The fields every object kind shares (§4.5 `SchemaObject`). */
interface JsonObjectBase {
  /** 1-based section ordinal the object was declared in. */
  readonly sectionIndex: number;
  /** Section header exactly as written, so an object is traceable even without a `PName`. */
  readonly sectionHeader: string;
  /**
   * The line this object reports on: its last `PName` line, else the header line.
   *
   * The same convention `semantic/required.ts`, `views.ts` and `subtypes.ts` use — one line, the
   * most specific one the file contains. It is not the header extent.
   */
  readonly span: JsonSpan;
  /** `PName` with its raw text and span; `null` when the object declares none. */
  readonly pname: JsonValue<string> | null;
  readonly lname: JsonValue<string> | null;
  readonly comment: JsonValue<string> | null;
  /**
   * Every declared occurrence of this kind's projected scalars, in file order.
   *
   * The three slots above hold the occurrence §4.2's last-wins rule selects; this list is the
   * history behind them, so an overwritten `PName`, `LName` or `Comment` keeps its text and its
   * line instead of surviving only as an `S_DUPLICATE_KEY` count (§12 rule 4, R26). A key the kind
   * does not project is never here — `[Subtype]` has `PName` alone.
   */
  readonly scalars: readonly JsonObjectScalar[];
  /** Every `Position` occurrence, in declaration order, shapes included (§P11). */
  readonly positions: readonly JsonPosition[];
  /**
   * Every other registered key of the section, in file order (F9, D7).
   *
   * A projected key is never also an attribute, duplicates included: the same source line would
   * then be reported twice. A repeated projected scalar is in `scalars` instead.
   */
  readonly attributes: readonly JsonAttribute[];
}

/** `[Entity]` — fields, both index spellings and the inferred key (§4.5, §7.2, §9.2). */
export interface JsonEntityObject extends JsonObjectBase {
  readonly kind: 'entity';
  readonly fields: readonly JsonField[];
  readonly indexes: JsonIndexes;
  readonly primaryKey: JsonPrimaryKey;
  /** Always present for a classified `[Entity]`; a missing composition is a defect, not `[]`. */
  readonly effectiveColumns: JsonEntityColumns;
}

/** `[View]` — query text, the `LNameByComment` fact and the always-unknown columns (§9.6). */
export interface JsonViewObject extends JsonObjectBase {
  readonly kind: 'view';
  /** `Query` with the one quote pair the format defines removed; otherwise untouched (P13). */
  readonly query: string | null;
  /** The `Query` value text exactly as written, so a broken line stays evidence (U12). */
  readonly queryRaw: string | null;
  readonly querySpan: JsonSpan | null;
  readonly lnameByComment: JsonLNameByComment;
  readonly effectiveColumns: JsonViewColumns;
}

/** `[Subtype]` — its own keys and the unsupported membership (§9.6, F7). */
export interface JsonSubtypeObject extends JsonObjectBase {
  readonly kind: 'subtype';
  /** The `[Subtype]` header line itself: the text anchor for evidence (§4.2, §12 rule 4). */
  readonly headerSpan: JsonSpan;
  readonly sharedMode: JsonSubtypeScalar<string>;
  readonly completeCategory: JsonSubtypeScalar<string>;
  readonly zOrder: JsonSubtypeScalar<number>;
  readonly membership: JsonSubtypeMembership;
}

/** Every resolved object, discriminated on `kind` so absent members are unrepresentable. */
export type JsonObject = JsonEntityObject | JsonViewObject | JsonSubtypeObject;

/** One side of a relation, with what its name resolved to (§9.2, P9). */
export interface JsonRelationEndpoint {
  readonly key: 'Entity1' | 'Entity2';
  readonly declared: string;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly status: 'resolved' | 'dangling' | 'ambiguous';
  readonly resolvedEntity: string | null;
  readonly candidates: number;
}

/** One column slot of a mapped side; empty slots keep their index and their `` name (R28). */
export interface JsonRelationColumn {
  readonly pname: string;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly index: number;
  readonly empty: boolean;
}

/** One `Fields1`/`Fields2` list, complete (U8: nothing is truncated to match the other side). */
export interface JsonRelationColumnList {
  readonly key: 'Fields1' | 'Fields2';
  readonly raw: string;
  readonly span: JsonSpan;
  readonly columns: readonly JsonRelationColumn[];
}

/**
 * The `[Relation]` scalar keys the envelope projects into a typed slot (§9.2, P9, K7).
 *
 * Exactly the keys `serialize.ts` excludes from `attributes` because a structured slot carries
 * them; every other `[Relation]` key is an attribute.
 */
export type JsonRelationScalarKey =
  | 'PName'
  | 'RelationType1'
  | 'RelationType2'
  | 'Cardinarity1'
  | 'Cardinarity2';

/** One declared occurrence of a projected `[Relation]` scalar, the record `JsonProjectedScalar` defines. */
export type JsonRelationScalar = JsonProjectedScalar<JsonRelationScalarKey>;

/**
 * One relation: the resolved record plus its presentation records and its declarations.
 *
 * `columnsAligned` is three-valued on purpose (R27): `null` means a side is absent, which is
 * "unknown", not "aligned". `positions` and `attributes` are added here so the relation's geometry
 * and DDL/presentation keys are not the only records the classification holds and the envelope
 * loses; they are projections, not new interpretation.
 *
 * **Provenance (§12 rules 3 and 4).** `span` anchors the relation record — its last `PName` line,
 * else its header line, the convention `JsonObjectBase.span` follows — and is deliberately *not*
 * any value's line. Each interpreted scalar carries its own provenance through `JsonValue`, and
 * `scalars` keeps every declared occurrence of the five projected keys, duplicates included. The
 * typed slots hold the last-wins selection §4.2 defines; `scalars` is the history behind it, so a
 * consumer can see both what the file means and what it wrote.
 */
export interface JsonRelation {
  readonly sectionIndex: number;
  readonly sectionHeader: string;
  /** The record's own anchor: last `PName` line, else the header line. Not the header extent. */
  readonly span: JsonSpan;
  readonly pname: JsonValue<string> | null;
  readonly from: JsonRelationEndpoint | null;
  readonly to: JsonRelationEndpoint | null;
  readonly fromColumns: JsonRelationColumnList | null;
  readonly toColumns: JsonRelationColumnList | null;
  /** `RelationType1` as declared: the last-wins occurrence, or `null` when none decoded (R26). */
  readonly relationType1: JsonValue<number> | null;
  readonly relationType2: JsonValue<number> | null;
  /** `Cardinarity1` — the format's own misspelling, kept as written (K7). */
  readonly cardinarity1: JsonValue<string> | null;
  readonly cardinarity2: JsonValue<string> | null;
  /** Every declared occurrence of the five projected keys, in file order, duplicates included. */
  readonly scalars: readonly JsonRelationScalar[];
  readonly columnsAligned: boolean | null;
  readonly positions: readonly JsonPosition[];
  readonly attributes: readonly JsonAttribute[];
}

/** One `[Manager].PageInfo` declaration (P11), with every element kept. */
export interface JsonPage {
  readonly name: string;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly displayMode: number | null;
  readonly paperSize: string | null;
  readonly background: string | null;
  readonly elementsSeen: number;
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly JsonRawElement[];
}

/** One `[Manager].DomainInfo` declaration (P12); its データ型 is a kind, never followed. */
export interface JsonDomain {
  readonly name: string;
  readonly dataType: string;
  readonly dataTypeKind: 'empty' | 'system' | 'name';
  readonly comment: string;
  readonly defaultColumn: string;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly elementsSeen: number;
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly JsonRawElement[];
}

/** One `[Manager].CommonField` declaration (P12), every slot kept as declared. */
export interface JsonCommonField {
  readonly logicalName: string;
  readonly physicalName: string;
  readonly dataType: string;
  readonly notNull: boolean | null;
  readonly notNullToken: 'not-null' | 'nullable' | 'unrecognised';
  readonly keyOrder: number | null;
  readonly keyOrderToken: KeyOrderToken;
  readonly keyOrderRaw: string | null;
  readonly defaultValue: string;
  readonly comment: string;
  /** 色 as the declared token; no RGB interpretation is claimed (F8). */
  readonly color: string;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly elementsSeen: number;
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly JsonRawElement[];
}

/**
 * `[Manager]`: presentation and DDL switches, uninterpreted (§9.3).
 *
 * `PageInfo`, `DomainInfo` and `CommonField` are the only Manager keys projected into their own
 * collections; every other key — `PaperSize`, `ViewMode`, `CreatePkIndex`, `%…%` tokens — is an
 * attribute here, because it is preserved but decides nothing (§9.3, F9, D7).
 */
export interface JsonManager {
  readonly attributes: readonly JsonAttribute[];
}

/** The resolved model of §4.5, as the envelope carries it. */
export interface JsonSchema {
  readonly objects: readonly JsonObject[];
  readonly relations: readonly JsonRelation[];
  readonly pages: readonly JsonPage[];
  readonly domains: readonly JsonDomain[];
  readonly commonFields: readonly JsonCommonField[];
  readonly manager: JsonManager;
}

/** §13's evidence, one record per construct read and deliberately not modelled (§12 rule 7). */
export interface JsonUnsupported {
  readonly kind: UnsupportedKind;
  readonly sectionKind: SectionKind;
  readonly sectionHeader: string;
  readonly key: string | null;
  readonly raw: string;
  readonly span: JsonSpan;
  readonly reason: string;
}

/** One diagnostic, projected from `validate/integrate` verbatim (§11, §12 rule 7). */
export interface JsonDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly details: Readonly<Record<string, DiagnosticDetail>>;
  readonly span: JsonSpan | null;
  readonly construct: string | null;
}

/** §13's reconciled counters, projected verbatim; nothing is counted again here. */
export type JsonCompleteness = IntegrationCompleteness;

/** The read's identity and decoding facts; `null` for a rejected input (§14 row 11). */
export interface JsonSource {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly encoding: {
    readonly detected: Codec;
    readonly bom: boolean;
    readonly declared: string | null;
    readonly mismatch: boolean;
  };
  readonly format: {
    readonly declared: number | null;
    /**
     * The FORMAT the decoders actually ran under (§6's sketch; the gap `profiles.ts` records).
     *
     * The documented `FormatProfile` has an `effective` member to be "declared, or filled in from a
     * legacy marker", but v2.21 defines no such marker, so the local profile deliberately omits it
     * (`src/schema/profiles.ts`). This projection makes the choice explicit rather than guessing:
     * `effective` is `declared` when the declaration is one this build knows, and `null` otherwise —
     * an absent, future or hole-in-the-map declaration decides interpretation but is not a version
     * the envelope can name. `known` is carried beside it so the two readings stay separable.
     */
    readonly effective: number | null;
    readonly known: boolean;
  };
}

/** The limits the read ran under (§10.2) and the one truncation fact the envelope reports. */
export interface JsonLimits {
  readonly maxBytes: number;
  /** §10.4's fail-closed stop, decided only by an `E_TRUNCATED_INPUT` in `diagnostics`. */
  readonly truncated: boolean;
}

/**
 * The one document an invocation emits (`architecture.md` §12).
 *
 * Field order is emission order. `source`, `schema` and `completeness` are `null` exactly when
 * `status` is `failed`: a rejected read has no decoded source metadata, no resolved model and no
 * counts, and fabricating any of the three would be the partial diagram §14 row 11 forbids.
 */
export interface JsonEnvelope {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly tool: {
    readonly name: typeof TOOL_NAME;
    readonly version: typeof TOOL_VERSION;
  };
  readonly command: JsonCommand;
  readonly status: IntegrationStatus;
  readonly source: JsonSource | null;
  readonly limits: JsonLimits;
  readonly schema: JsonSchema | null;
  readonly unsupported: readonly JsonUnsupported[];
  readonly diagnostics: readonly JsonDiagnostic[];
  readonly completeness: JsonCompleteness | null;
}

/** Re-exported for `serialize.ts`'s narrowing; keeps the JSON layer's imports in one place. */
export type { ObjectPosition, RawElement, RelationPosition, Span };
