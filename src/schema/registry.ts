/**
 * The section-scoped key registry (`architecture.md` §5, F1; `format-coverage.md` F1).
 *
 * **A key name means nothing on its own.** `Position` is a 3-or-5-element object shape in
 * `[Entity]` and an 8-element line shape in `[Relation]` (§P9/P11), `PName` is required in three
 * sections and absent from two, and `Page` is legacy geometry in one section and a legacy global
 * setting in another. The registry is therefore indexed by **(canonical section kind, exact key
 * name)** — never by a global key name, because a global table is exactly how a parser starts
 * inventing semantics for a key it has not understood in the section it appeared in.
 *
 * Rules this module implements, each traceable:
 *
 * - **Exact match, no case folding** (§5). `[entity]` is already an unknown section by the time
 *   the registry sees it; `pname` inside `[Entity]` is an unknown key (txt-07).
 * - **Repeatable keys are silent** (§P4). `Field`, `IndexInfo`, `Position`, `PageInfo`,
 *   `DomainInfo` and `CommonField` may appear any number of times; a scalar that appears twice is
 *   `S_DUPLICATE_KEY` (txt-05, txt-06).
 * - **Everything is kept** (§4.3, L2). Unknown keys, unknown-section keys and continuation lines
 *   become `RawEntry` records with their verbatim text, order and span; duplicates keep every
 *   occurrence and only *selection* is last-wins (§4.2).
 * - **The profile changes interpretation, never acceptance** (§6). A legacy `Index` is decoded and
 *   marked `S_LEGACY_KEY` in every profile; `profile.legacy` says whether it is the primary index
 *   source or a compatibility leftover.
 *
 * What this module deliberately does **not** do: decode `Field`/`IndexInfo`/`Position`
 * positionally (§7.2 and the per-section shapes are the next unit), resolve anything, or emit a
 * `V_` finding.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { emitRegistry } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';
import type { KeyRecord, SyntaxScan } from '../syntax/scanner.js';
import type { SectionKind } from '../syntax/sections.js';
import type { DecodedField } from './field.js';
import { decodeField } from './field.js';
import type {
  DecodedIndexOption,
  DecodedIndexes,
  DecodedIndexInfo,
  DecodedLegacyIndex,
} from './indexinfo.js';
import { decodeIndexInfo, decodeIndexOption, decodeLegacyIndex, indexesOf } from './indexinfo.js';
import type { DecodedPosition } from './position.js';
import { decodePosition } from './position.js';
import type { FormatProfile } from './profiles.js';
import { profileOf } from './profiles.js';
import type {
  ComplexValue,
  DecodeOutcome,
  DecodedValue,
  InvalidReason,
  ValueType,
} from './values.js';
import { decodeValue, defaultValue } from './values.js';

/** A section kind this project models; the 8 of §10.4 with `[Relationship]` folded into `Relation`. */
export type CanonicalKind = Exclude<SectionKind, 'unknown'>;

/** One key's declared behaviour (§5's `KeySpec`). */
export interface KeySpec {
  /** Canonical on-disk spelling, including the format's own misspelling `Cardinarity` (K7). */
  readonly key: string;
  readonly type: ValueType;
  readonly repeatable: boolean;
  /** 必須 per the specification. Reported by the validator, recorded here (§7.2, K6). */
  readonly required: boolean;
  readonly disposition: 'structured' | 'presentation' | 'ddl-only' | 'legacy';
  /**
   * Superseded by a canonical spelling, so decoding it is a legacy action (`S_LEGACY_KEY`).
   *
   * `Index`/`IndexOption` are superseded by `IndexInfo` (§6, D5). The legacy geometry keys
   * (`Page`, `Left`, `Top`) are old but have no successor, so they are decoded quietly: the
   * fixtures pin the difference — fmt-02 expects one `S_LEGACY_KEY` for `Index`, while fmt-03 and
   * fmt-05 carry `Page`/`Left`/`Top` and expect none.
   */
  readonly superseded: boolean;
  /** A default the specification states, applied when the key is absent (§4.2 `defaulted`). */
  readonly defaultValue: DecodedValue | null;
}

/** Builder with the defaults that make the table below readable. */
function key(
  spec: Pick<KeySpec, 'key' | 'type'> &
    Partial<
      Pick<KeySpec, 'repeatable' | 'required' | 'disposition' | 'superseded' | 'defaultValue'>
    >,
): KeySpec {
  return {
    key: spec.key,
    type: spec.type,
    repeatable: spec.repeatable ?? false,
    required: spec.required ?? false,
    disposition: spec.disposition ?? 'structured',
    superseded: spec.superseded ?? false,
    defaultValue: spec.defaultValue ?? null,
  };
}

/** `[Manager]` — the document-wide settings block (§3.1). Repeated sections share one scope. */
const MANAGER_KEYS: readonly KeySpec[] = [
  key({ key: 'PageInfo', type: 'complex', repeatable: true, required: true }),
  key({ key: 'ProjectName', type: 'string' }),
  key({ key: 'DomainInfo', type: 'complex', repeatable: true }),
  key({ key: 'CommonField', type: 'complex', repeatable: true }),
  key({ key: 'LogicalView', type: 'boolean' }),
  key({ key: 'ShowTag', type: 'boolean' }),
  key({ key: 'ShowCommonAttributes', type: 'boolean' }),
  key({ key: 'ShowDisableAttributes', type: 'boolean' }),
  key({ key: 'DecodeDomain', type: 'integer' }),
  key({ key: 'CreatePkIndex', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'CreateFk', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'FKParentIndex', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'CreateFK_ParentCard1Only', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'GenerateCommentStatement', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'GenerateCommentStatement_LName', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'GenerateCommentStatement_Comment', type: 'boolean', disposition: 'ddl-only' }),
  key({ key: 'GenerateCommentStatement_Separator', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'DefaultPkName', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'DefaultPkIndexName', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'DefaultIndexName', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'DefaultFkName', type: 'string', disposition: 'ddl-only' }),
  // Typed Float in 2.21 and Integer in 2.20 (P13), so the five basic types cannot express it
  // without either rejecting a legitimate value or inventing a rounding rule: kept verbatim.
  key({ key: 'FontSize', type: 'string', disposition: 'presentation' }),
  key({ key: 'FontSizeReal', type: 'string', disposition: 'presentation', superseded: true }),
  // §3.1's "old items, ignore them" list: decoded, no successor, so no legacy warning.
  key({ key: 'Page', type: 'string', disposition: 'legacy' }),
  key({ key: 'Domain', type: 'string', disposition: 'legacy' }),
  key({ key: 'ViewModePageIndividually', type: 'string', disposition: 'legacy' }),
  key({ key: 'ViewMode', type: 'string', disposition: 'legacy' }),
  key({ key: 'PaperSize', type: 'string', disposition: 'legacy' }),
  key({ key: 'RDBMSType', type: 'string', disposition: 'legacy' }),
];

/** `[Entity]` — one table per section (§4.1; §5's worked excerpt, 16 current + 5 legacy). */
const ENTITY_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'LName', type: 'string' }),
  key({ key: 'Comment', type: 'escaped' }),
  key({ key: 'Field', type: 'complex', repeatable: true }),
  key({ key: 'IndexInfo', type: 'complex', repeatable: true }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'UsingCommonColumns', type: 'integer', defaultValue: 1 }),
  key({ key: 'TableOption', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'TableInnerOption', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'NoDDL', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'Tag', type: 'string', disposition: 'presentation' }),
  key({ key: 'Color', type: 'string', disposition: 'presentation' }),
  key({ key: 'BkColor', type: 'string', disposition: 'presentation' }),
  key({ key: 'EffectMode', type: 'string', disposition: 'presentation' }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
  key({ key: 'ModifiedDateTime', type: 'string', disposition: 'presentation' }),
  // §4.1's "old items": legacy geometry and the superseded index payload (F2, D5).
  key({ key: 'Page', type: 'string', disposition: 'legacy' }),
  key({ key: 'Left', type: 'string', disposition: 'legacy' }),
  key({ key: 'Top', type: 'string', disposition: 'legacy' }),
  key({ key: 'Index', type: 'string', disposition: 'legacy', superseded: true }),
  key({ key: 'IndexOption', type: 'string', disposition: 'legacy', superseded: true }),
];

/** `[Relation]` and its `[Relationship]` alias (§4.2). */
const RELATION_KEYS: readonly KeySpec[] = [
  key({ key: 'Entity1', type: 'string', required: true }),
  key({ key: 'Entity2', type: 'string', required: true }),
  key({ key: 'Fields1', type: 'complex', required: true }),
  key({ key: 'Fields2', type: 'complex', required: true }),
  key({ key: 'RelationType1', type: 'integer', required: true }),
  key({ key: 'RelationType2', type: 'integer', required: true }),
  // Misspelled in the format itself — keep the real spelling (K7).
  key({ key: 'Cardinarity1', type: 'string' }),
  key({ key: 'Cardinarity2', type: 'string' }),
  key({ key: 'Dependence', type: 'string' }),
  key({ key: 'Caption', type: 'string' }),
  key({ key: 'PName', type: 'string' }),
  key({ key: 'NoDDL', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'FkOnDeleteOption', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'FkOnUpdateOption', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'LineColor', type: 'string', disposition: 'presentation' }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
  key({ key: 'ModifiedDateTime', type: 'string', disposition: 'presentation' }),
  // §4.2's "old items": line routing and bar geometry, decoded but never interpreted.
  key({ key: 'LineMode', type: 'string', disposition: 'legacy' }),
  key({ key: 'Bar1', type: 'string', disposition: 'legacy' }),
  key({ key: 'Bar2', type: 'string', disposition: 'legacy' }),
  key({ key: 'Bar3', type: 'string', disposition: 'legacy' }),
  key({ key: 'TermPos1', type: 'string', disposition: 'legacy' }),
  key({ key: 'TermPos2', type: 'string', disposition: 'legacy' }),
];

/** `[View]` — shares most `[Entity]` items but has no `Field`/`Index` and adds `Query` (§4.3). */
const VIEW_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'LName', type: 'string' }),
  // K4: typed `String` in the spec but written like the entity's `EscapedString`; the superset
  // reading is the only one that cannot corrupt a comment containing a quote.
  key({ key: 'Comment', type: 'escaped' }),
  // P13: `Query` is typed `String`; no escaping is applied and a broken line stays evidence.
  key({ key: 'Query', type: 'string' }),
  key({ key: 'LNameByComment', type: 'boolean' }),
  key({ key: 'MaterializedView', type: 'boolean' }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'NoDDL', type: 'string', disposition: 'ddl-only' }),
  key({ key: 'Tag', type: 'string', disposition: 'presentation' }),
  key({ key: 'Color', type: 'string', disposition: 'presentation' }),
  key({ key: 'BkColor', type: 'string', disposition: 'presentation' }),
  key({ key: 'EffectMode', type: 'string', disposition: 'presentation' }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
  key({ key: 'ModifiedDateTime', type: 'string', disposition: 'presentation' }),
  key({ key: 'Page', type: 'string', disposition: 'legacy' }),
  key({ key: 'Left', type: 'string', disposition: 'legacy' }),
  key({ key: 'Top', type: 'string', disposition: 'legacy' }),
];

/**
 * `[Subtype]` (§4.4).
 *
 * Membership is undocumentable (K11, F7) and no key states it, so the section is modelled at the
 * key level only. `SharedMode` and `CompleteCategory` are untyped in the specification, so they are
 * kept verbatim rather than coerced into a number the spec never declared.
 */
const SUBTYPE_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'SharedMode', type: 'string' }),
  key({ key: 'CompleteCategory', type: 'string' }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
];

/**
 * `[Shape]` (§4.5) and `[Line]` (§4.6).
 *
 * `format-coverage.md` states the counts ("23 keys incl. 13 `ShapeType`s", "13 keys") but does
 * not enumerate them, and `docs/architecture.md` §5 names no `[Shape]` key. Only the keys the
 * documents name are registered: everything else is reported as an unknown key and preserved
 * verbatim, which is the lossless outcome and the honest one — inventing a key list from the
 * counts would be the coverage-by-assertion this project rejects.
 */
const SHAPE_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'ShapeType', type: 'string' }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
];

const LINE_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'StartLineTermType', type: 'integer' }),
  key({ key: 'EndLineTermType', type: 'integer' }),
  key({ key: 'TermSize', type: 'integer' }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
];

/** `[Comment]` — a sticky note; `Width` and `Height` are required (§4.7). */
const COMMENT_KEYS: readonly KeySpec[] = [
  key({ key: 'PName', type: 'string', required: true }),
  key({ key: 'Position', type: 'complex', repeatable: true, required: true }),
  key({ key: 'Width', type: 'integer', required: true }),
  key({ key: 'Height', type: 'integer', required: true }),
  key({ key: 'ZOrder', type: 'integer', disposition: 'presentation' }),
];

/** The registry: one table per canonical kind, and nothing global. */
export const REGISTRY: Readonly<Record<CanonicalKind, readonly KeySpec[]>> = {
  Manager: MANAGER_KEYS,
  Entity: ENTITY_KEYS,
  Relation: RELATION_KEYS,
  View: VIEW_KEYS,
  Subtype: SUBTYPE_KEYS,
  Shape: SHAPE_KEYS,
  Line: LINE_KEYS,
  Comment: COMMENT_KEYS,
};

/**
 * Where a non-repeatable key's uniqueness is decided.
 *
 * `[Manager]` is one settings block that may be split across repeated sections, so its scalars are
 * document-scoped and "last wins" across them (txt-06). Every other section is one object, so its
 * scalars are section-scoped and two objects may freely share a `PName` — that collision is
 * `V_DUPLICATE_OBJECT_NAME` (§P6), a semantic finding, not a duplicate key.
 */
const DOCUMENT_SCOPED: ReadonlySet<CanonicalKind> = new Set<CanonicalKind>(['Manager']);

/** (kind, key) → spec, built once. A miss is an unknown key, never a guess. */
const BY_KIND_AND_KEY: ReadonlyMap<string, KeySpec> = new Map(
  (Object.entries(REGISTRY) as [CanonicalKind, readonly KeySpec[]][]).flatMap(([kind, specs]) =>
    specs.map((spec) => [`${kind}\u0000${spec.key}`, spec] as const),
  ),
);

/** Look up one key in one section kind, case-sensitively (§5). */
export function lookupKey(kind: CanonicalKind, key: string): KeySpec | undefined {
  return BY_KIND_AND_KEY.get(`${kind}\u0000${key}`);
}

/** §4.3's retention kinds. `legacy-key` is unused here: a decoded legacy key is still decoded. */
export type RetentionKind =
  | 'unknown-section'
  | 'unknown-key'
  | 'unsupported-construct'
  | 'multiline-value';

/** §4.3: something we read and deliberately did not model, kept with its provenance. */
export interface RawEntry {
  readonly kind: RetentionKind;
  readonly sectionKind: SectionKind;
  /** Header text exactly as written; `''` for the region before the first header. */
  readonly sectionHeader: string;
  /** Key text exactly as written; `null` when the line is not a `key=value` line. */
  readonly key: string | null;
  /** The full original line, verbatim. */
  readonly raw: string;
  readonly span: Span;
  /** Stable machine code, e.g. `no-registry-entry`. */
  readonly reason: string;
}

/** A declared token that its type could not decode, with everything needed to point at it. */
export interface InvalidEntry {
  readonly key: string;
  readonly sectionKind: SectionKind;
  readonly reason: InvalidReason;
  readonly raw: string;
  readonly span: Span;
}

/** One occurrence of a registered key. */
export interface KeyOccurrence {
  readonly keyRaw: string;
  readonly spec: KeySpec;
  /** The key line; `null` for a defaulted value, which no line declared (§4.2, T6). */
  readonly span: Span | null;
  /** The value text verbatim, before any unquoting; `''` for a defaulted value. */
  readonly raw: string;
  readonly decoded: DecodeOutcome;
}

/** All occurrences of one key in one uniqueness scope. */
export interface ClassifiedKey {
  readonly kind: CanonicalKind;
  readonly spec: KeySpec;
  /** Every occurrence in file order, across repeated sections when the scope is the document. */
  readonly occurrences: readonly KeyOccurrence[];
  /** Last-wins selection for a non-repeatable key (§4.2); `null` when the key repeats by design. */
  readonly selected: KeyOccurrence | null;
  /** Occurrences beyond the first, which is what `S_DUPLICATE_KEY` counts. */
  readonly duplicateCount: number;
}

/** One line of a section, classified. */
export type ClassifiedEntry =
  | { readonly kind: 'parsed'; readonly occurrence: KeyOccurrence }
  | { readonly kind: 'preserved'; readonly entry: RawEntry };

/**
 * The typed reading of a section's shaped keys.
 *
 * Separate from `KeyOccurrence.decoded`, which is the *token*: every shaped key is tokenised once
 * (that is where `S_COMPLEX_UNTERMINATED_QUOTE` comes from) and then interpreted here by the decoder
 * its section kind and key name select (§7.2, P8, P11). A key this section does not define never
 * reaches this layer — it is preserved raw instead.
 *
 * Arrays are empty when the section has no such key, so a consumer reads one uniform shape.
 */
export interface SectionDecoding {
  /** `Field` columns in declaration order (`[Entity]`). */
  readonly fields: readonly DecodedField[];
  /** Index data from both spellings, labelled with the role the profile gives each (§6). */
  readonly indexes: DecodedIndexes;
  /** Every `Position` occurrence in declaration order, whatever its shape. */
  readonly positions: readonly DecodedPosition[];
}

export interface ClassifiedSection {
  readonly index: number;
  readonly kind: SectionKind;
  readonly headerRaw: string;
  readonly span: Span;
  /** One entry per non-blank, non-comment line of the section, in file order. */
  readonly entries: readonly ClassifiedEntry[];
  /** Documented defaults for required-by-default keys this section omitted (§4.2 `defaulted`). */
  readonly defaults: readonly KeyOccurrence[];
  /** Typed decoding of the shaped keys, with the profile's interpretation applied. */
  readonly decoded: SectionDecoding;
}

/** §13's counters, resolved over the classified entries. */
export interface Completeness {
  readonly sections: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
  };
  readonly keys: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
  };
  /** §13 remainder; must be `0`, and is computed rather than asserted. */
  readonly dropped: number;
}

/** One reason the classification does not reconcile. An internal defect, never input-driven. */
export interface CompletenessViolation {
  readonly rule:
    | 'key-not-accounted'
    | 'key-double-counted'
    | 'section-total-mismatch'
    | 'key-total-mismatch';
  readonly detail: string;
}

/** Thrown when the derivation disagrees with the scan. Never silent, never input-triggered. */
export class CompletenessError extends Error {
  readonly violations: readonly CompletenessViolation[];

  constructor(violations: readonly CompletenessViolation[]) {
    super(`classification does not reconcile: ${violations.map((v) => v.rule).join(', ')}`);
    this.name = 'CompletenessError';
    this.violations = violations;
  }
}

export interface Classification {
  readonly profile: FormatProfile;
  readonly sections: readonly ClassifiedSection[];
  /** Every non-repeatable key's occurrences and selection, in first-appearance order. */
  readonly keys: readonly ClassifiedKey[];
  /** `unsupported` evidence, ordered by position (§12): sections, keys and broken lines. */
  readonly preserved: readonly RawEntry[];
  /**
   * Declared tokens a type could not decode, in file order.
   *
   * They are *not* in `preserved`: the key was understood and its line is modelled, only the token
   * is bad. There is no diagnostic code for this in §11 and inventing one is out of scope, so this
   * list is how an invalid value stays visible instead of looking like data.
   */
  readonly problems: readonly InvalidEntry[];
  readonly completeness: Completeness;
  /** Ordered by line (§12 rule 7). */
  readonly diagnostics: readonly Diagnostic[];
}

/** One key group while it is being filled. */
interface GroupDraft {
  readonly kind: CanonicalKind;
  readonly spec: KeySpec;
  readonly occurrences: KeyOccurrence[];
}

/** Build a `RawEntry` for a key the registry did not model. */
function preservedKey(
  section: { readonly kind: SectionKind; readonly headerRaw: string },
  entry: KeyRecord,
  reason: string,
): RawEntry {
  return {
    kind: 'unknown-key',
    sectionKind: section.kind,
    sectionHeader: section.headerRaw,
    key: entry.key,
    raw: entry.raw,
    span: entry.span,
    reason,
  };
}

/**
 * The tokenised form of a Complex occurrence.
 *
 * `decodeValue` only ever produces this shape for a `complex` key, so a `null` here means the
 * occurrence is not a Complex value at all — a case that cannot arise for the keys this is used on,
 * and that is handled rather than asserted so a future registry edit fails softly.
 */
function complexOf(occurrence: KeyOccurrence): ComplexValue | null {
  if (!occurrence.decoded.ok) return null;
  const value = occurrence.decoded.value.value;
  if (typeof value !== 'object') return null;
  return value;
}

/**
 * Decode the shaped keys of one section (`Field`, `IndexInfo`/`Index`/`IndexOption`, `Position`).
 *
 * Dispatch is by `(section kind, key)`, which is the whole reason the registry is section-scoped:
 * `Position` means three different things in three sections, and `Field` exists only in `[Entity]`.
 * A decoder never sees a key that is not registered for the section, because unregistered keys were
 * preserved raw before this point.
 */
function decodeSection(
  kind: SectionKind,
  entries: readonly ClassifiedEntry[],
  profile: FormatProfile,
  sectionSpan: Span,
): { decoding: SectionDecoding; diagnostics: readonly Diagnostic[] } {
  const fields: DecodedField[] = [];
  const canonical: DecodedIndexInfo[] = [];
  const legacy: DecodedLegacyIndex[] = [];
  const legacyOptions: DecodedIndexOption[] = [];
  const positions: DecodedPosition[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    if (entry.kind !== 'parsed') continue;
    const { occurrence } = entry;
    const span = occurrence.span ?? sectionSpan;
    const key = occurrence.spec.key;

    // The legacy index payloads are bare strings, not Complex values (U7): `name=flag,cols` has no
    // quoting at all, so they are decoded before the Complex gate below.
    if (key === 'Index') {
      legacy.push(decodeLegacyIndex(occurrence.raw, span));
      continue;
    }
    if (key === 'IndexOption') {
      legacyOptions.push(decodeIndexOption(occurrence.raw, span));
      continue;
    }

    if (occurrence.spec.type !== 'complex') continue;
    const parts = complexOf(occurrence);
    if (parts === null) continue;

    switch (key) {
      case 'Field': {
        const decoded = decodeField(parts, span, occurrence.raw);
        fields.push(decoded.field);
        diagnostics.push(...decoded.diagnostics);
        break;
      }
      case 'IndexInfo':
        canonical.push(decodeIndexInfo(parts, span, occurrence.raw));
        break;
      case 'Position':
        positions.push(decodePosition(kind, parts, span, occurrence.raw));
        break;
      default:
        // Any other Complex key is tokenised but not shaped by this unit (§7.2's per-key decoders).
        break;
    }
  }

  return {
    decoding: { fields, indexes: indexesOf(canonical, legacy, legacyOptions, profile), positions },
    diagnostics,
  };
}

/**
 * Classify every section and key of a scan against the registry.
 *
 * Pure and total: it never throws for input, and every line the scanner produced ends up either in
 * a `ClassifiedEntry` or in the file-level `preserved` list. The only throw is `CompletenessError`,
 * which fires when this module's own accounting disagrees with the scan — a defect in the code,
 * never in the file.
 */
export function classify(scan: SyntaxScan): Classification {
  const profile = profileOf(scan.format);
  const diagnostics: Diagnostic[] = [];
  const preserved: RawEntry[] = [];
  const problems: InvalidEntry[] = [];
  const sections: ClassifiedSection[] = [];
  const groups = new Map<string, GroupDraft>();
  const groupOrder: string[] = [];

  /** Header-region keys have no section to consult, so they are evidence, not data. */
  for (const entry of scan.header.keyLines) {
    const raw = preservedKey({ kind: 'unknown', headerRaw: '' }, entry, 'no-section');
    preserved.push(raw);
    diagnostics.push(
      emitRegistry('S_UNKNOWN_KEY', {
        details: { key: entry.key, section: null },
        span: entry.span,
        construct: 'Key',
      }),
    );
  }
  for (const entry of scan.header.rawLines) {
    preserved.push({
      kind: 'multiline-value',
      sectionKind: 'unknown',
      sectionHeader: '',
      key: null,
      raw: entry.raw,
      span: entry.span,
      reason: 'not-a-key-value-line',
    });
  }

  for (const section of scan.sections) {
    const entries: ClassifiedEntry[] = [];
    const defaults: KeyOccurrence[] = [];

    if (section.kind === 'unknown') {
      // The section itself is the evidence (§4.3 `unknown-section`); its keys follow as
      // preserved lines, so `unsupported` stays in file order (§12 rule 7).
      preserved.push({
        kind: 'unknown-section',
        sectionKind: 'unknown',
        sectionHeader: section.headerRaw,
        key: null,
        raw: section.headerRaw,
        span: section.headerSpan,
        reason: 'section-not-modelled',
      });
    }

    for (const entry of section.entries) {
      if (entry.kind === 'raw-line') {
        const raw: RawEntry = {
          kind: 'multiline-value',
          sectionKind: section.kind,
          sectionHeader: section.headerRaw,
          key: null,
          raw: entry.raw,
          span: entry.span,
          reason: 'not-a-key-value-line',
        };
        preserved.push(raw);
        entries.push({ kind: 'preserved', entry: raw });
        continue;
      }

      if (section.kind === 'unknown') {
        // The section's own S_UNKNOWN_SECTION explains these; a per-key warning would repeat it.
        const raw = preservedKey(section, entry, 'section-not-modelled');
        preserved.push(raw);
        entries.push({ kind: 'preserved', entry: raw });
        continue;
      }

      const spec = lookupKey(section.kind, entry.key);
      if (spec === undefined) {
        const raw = preservedKey(section, entry, 'no-registry-entry');
        preserved.push(raw);
        entries.push({ kind: 'preserved', entry: raw });
        diagnostics.push(
          emitRegistry('S_UNKNOWN_KEY', {
            details: { key: entry.key, section: section.kind },
            span: entry.span,
            construct: 'Key',
          }),
        );
        continue;
      }

      const occurrence: KeyOccurrence = {
        keyRaw: entry.key,
        spec,
        span: entry.span,
        raw: entry.value,
        decoded: decodeValue(spec.type, entry.value, entry.span),
      };
      entries.push({ kind: 'parsed', occurrence });
      diagnostics.push(...occurrence.decoded.diagnostics);
      if (!occurrence.decoded.ok) {
        problems.push({
          key: entry.key,
          sectionKind: section.kind,
          reason: occurrence.decoded.invalid.reason,
          raw: occurrence.decoded.invalid.raw,
          span: occurrence.decoded.invalid.span,
        });
      }

      if (spec.superseded) {
        diagnostics.push(
          emitRegistry('S_LEGACY_KEY', {
            details: { key: entry.key, section: section.kind },
            span: entry.span,
            construct: 'Key',
          }),
        );
      }

      const scope = DOCUMENT_SCOPED.has(section.kind) ? '' : String(section.index);
      const id = `${section.kind}\u0000${scope}\u0000${entry.key}`;
      const draft = groups.get(id);
      if (draft === undefined) {
        groups.set(id, { kind: section.kind, spec, occurrences: [occurrence] });
        groupOrder.push(id);
      } else {
        draft.occurrences.push(occurrence);
      }
    }

    // Documented defaults (§4.2 `defaulted`): only where the spec states one, and only for an
    // absent key, so a default never shadows a declared value.
    if (section.kind !== 'unknown') {
      const present = new Set(
        section.entries
          .filter((entry): entry is KeyRecord => entry.kind === 'key')
          .map((entry) => entry.key),
      );
      for (const spec of REGISTRY[section.kind]) {
        if (spec.defaultValue === null || present.has(spec.key)) continue;
        defaults.push({
          keyRaw: spec.key,
          spec,
          span: null,
          raw: '',
          decoded: { ok: true, value: defaultValue(spec.defaultValue), diagnostics: [] },
        });
      }
    }

    const typed = decodeSection(section.kind, entries, profile, section.span);
    diagnostics.push(...typed.diagnostics);

    sections.push({
      index: section.index,
      kind: section.kind,
      headerRaw: section.headerRaw,
      span: section.span,
      entries,
      defaults,
      decoded: typed.decoding,
    });
  }

  const keys: ClassifiedKey[] = [];
  for (const id of groupOrder) {
    const draft = groups.get(id);
    if (draft === undefined) continue;
    // §P4: a repeatable key may appear any number of times, so only a scalar can collide.
    const duplicateCount = draft.spec.repeatable ? 0 : draft.occurrences.length - 1;
    if (duplicateCount > 0) {
      for (const occurrence of draft.occurrences.slice(1)) {
        diagnostics.push(
          emitRegistry('S_DUPLICATE_KEY', {
            details: { key: draft.spec.key, occurrences: draft.occurrences.length },
            span: occurrence.span,
            construct: 'Key',
          }),
        );
      }
    }
    keys.push({
      kind: draft.kind,
      spec: draft.spec,
      occurrences: draft.occurrences,
      selected: draft.spec.repeatable ? null : (draft.occurrences.at(-1) ?? null),
      duplicateCount: Math.max(0, duplicateCount),
    });
  }

  // §12 rule 7: the file's order, so a consumer never has to merge streams to see causality.
  const position = (span: Span | null): number => span?.startLine ?? 0;
  diagnostics.sort((left, right) => position(left.span) - position(right.span));
  preserved.sort((left, right) => position(left.span) - position(right.span));

  const completeness = deriveCompleteness(scan, sections, preserved);

  return { profile, sections, keys, preserved, problems, completeness, diagnostics };
}

/**
 * Resolve §13's counters from the classified entries.
 *
 * Like the scanner's coverage derivation, nothing here is taken on trust: the key counts are the
 * occurrences actually stored in `sections`, and the section counts are the classified sections
 * themselves. `dropped` is the remainder.
 */
export function deriveCompleteness(
  scan: SyntaxScan,
  sections: readonly ClassifiedSection[],
  preserved: readonly RawEntry[],
): Completeness {
  const counts = countCompleteness(sections, preserved);
  const violations = verifyCompleteness(scan, sections, preserved);
  if (violations.length > 0) throw new CompletenessError(violations);
  return counts;
}

/**
 * Compare the derivation with the scan's own totals, and check that every key is in one bucket.
 *
 * Exported so a test can hand it a deliberately inconsistent structure: a key occurrence that
 * vanished or was counted twice must be visible, never absorbed into a zero.
 */
export function verifyCompleteness(
  scan: SyntaxScan,
  sections: readonly ClassifiedSection[],
  preserved: readonly RawEntry[] = [],
): readonly CompletenessViolation[] {
  const violations: CompletenessViolation[] = [];
  const counts = countCompleteness(sections, preserved);

  if (counts.sections.total !== scan.accounting.sections.total) {
    violations.push({
      rule: 'section-total-mismatch',
      detail: `classified ${String(counts.sections.total)}, scanned ${String(scan.accounting.sections.total)}`,
    });
  }
  if (counts.keys.total !== scan.accounting.keys.total) {
    violations.push({
      rule: 'key-total-mismatch',
      detail: `classified ${String(counts.keys.total)}, scanned ${String(scan.accounting.keys.total)}`,
    });
  }
  if (counts.keys.parsed + counts.keys.preservedRaw !== counts.keys.total) {
    violations.push({
      rule: 'key-not-accounted',
      detail: `${String(counts.keys.parsed)} + ${String(counts.keys.preservedRaw)} != ${String(counts.keys.total)}`,
    });
  }
  for (const section of sections) {
    const parsed = section.entries.filter((entry) => entry.kind === 'parsed').length;
    const kept = section.entries.filter(
      (entry) => entry.kind === 'preserved' && entry.entry.key !== null,
    ).length;
    const scanned = scan.sections[section.index - 1]?.entries.filter(
      (entry) => entry.kind === 'key',
    ).length;
    if (scanned !== undefined && parsed + kept !== scanned) {
      violations.push({
        rule: 'key-double-counted',
        detail: `section ${String(section.index)}: ${String(parsed)} + ${String(kept)} != ${String(scanned)}`,
      });
    }
  }

  return violations;
}

/** Pure count: every key occurrence lands in exactly one of `parsed`/`preservedRaw`. */
function countCompleteness(
  sections: readonly ClassifiedSection[],
  preserved: readonly RawEntry[],
): Completeness {
  let keyTotal = 0;
  let keyParsed = 0;
  let keyPreserved = 0;
  let recognised = 0;

  for (const section of sections) {
    if (section.kind === 'unknown') continue;
    recognised += 1;
    for (const entry of section.entries) {
      if (entry.kind === 'parsed') {
        keyTotal += 1;
        keyParsed += 1;
        continue;
      }
      // A preserved *line* that is not a `key=value` line is not a key (§13 counts keys).
      if (entry.entry.key === null) continue;
      keyTotal += 1;
      keyPreserved += 1;
    }
  }
  for (const section of sections) {
    if (section.kind !== 'unknown') continue;
    for (const entry of section.entries) {
      if (entry.kind !== 'preserved' || entry.entry.key === null) continue;
      keyTotal += 1;
      keyPreserved += 1;
    }
  }

  // A key before the first header belongs to no section, so it is counted from `preserved`:
  // it is evidence, and §13's `keys.total` is every `key=value` line in the file.
  for (const entry of preserved) {
    if (entry.kind !== 'unknown-key' || entry.span.sectionIndex !== 0) continue;
    keyTotal += 1;
    keyPreserved += 1;
  }

  return {
    sections: {
      total: sections.length,
      parsed: recognised,
      preservedRaw: sections.length - recognised,
    },
    keys: { total: keyTotal, parsed: keyParsed, preservedRaw: keyPreserved },
    dropped: keyTotal - (keyParsed + keyPreserved),
  };
}
