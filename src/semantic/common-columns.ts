/**
 * Common columns and the effective column list (`architecture.md` §9.4, P12, D6; K9).
 *
 * `[Manager].CommonField` declares a column that any entity may inherit:
 * `"共通列論理名","共通列物理名","データ型","NOT NULL","キー順","デフォルト値","コメント",色` — eight
 * elements, with the middle slots routinely left empty (P12's own sample does exactly that, and so
 * does `sem-07`). Two rules decide composition:
 *
 * - **Opt-out, default opt-in.** `UsingCommonColumns` is `1` by default (§9.4, P6). An entity that
 *   omits the key inherits the common columns with `origin: 'defaulted'`; an entity that declares
 *   `0` does not. An entity whose `UsingCommonColumns` token is unusable is **indeterminate**: it is
 *   not silently treated as the default, because §4.2's default applies to an *absent* key, not to a
 *   broken one.
 * - **Nothing is overridden.** If a common column and a declared `Field` share a physical name, both
 *   are kept in the effective list in declaration order and the pair is reported as a collision. A
 *   composition that silently dropped one would be the "last wins" of a key the format never said
 *   was duplicated.
 *
 * `CommonField`'s `NOT NULL` slot holds the literal token `NotNull` (P12), not the `NOT NULL` that
 * `Field` uses, so it is read as its own literal and an unexpected token stays unrecognised (R20's
 * rule, applied to this section's spelling).
 */

import type { Span } from '../model/span.js';
import type { ComplexPart } from '../syntax/complex.js';
import type { Classification, ClassifiedSection } from '../schema/registry.js';
import { decodeInteger, partRaw, unescapeEscaped } from '../schema/values.js';
import type { RawElement } from '../schema/position.js';
import { pnameOf } from './access.js';

/** The literal `CommonField` uses for "not null" (P12); `Field` uses `NOT NULL` instead. */
const NOT_NULL_LITERAL = 'NotNull';

/** How the `NOT NULL` slot of a common column was written. */
export type CommonNotNullToken = 'not-null' | 'nullable' | 'unrecognised';

/** One `CommonField` declaration. */
export interface CommonColumnDeclaration {
  /** 共通列論理名, escapes applied. */
  readonly logicalName: string;
  /** 共通列物理名, escapes applied. */
  readonly physicalName: string;
  /** データ型 as written; never resolved (a domain reference stays a name, see `domains.ts`). */
  readonly dataType: string;
  /** The literal `NotNull`, an empty slot, or an unrecognised token — never coerced. */
  readonly notNull: boolean | null;
  readonly notNullToken: CommonNotNullToken;
  /** キー順, when it is a usable integer (the same rule as `Field`, R19). */
  readonly keyOrder: number | null;
  /** デフォルト値, never evaluated. */
  readonly defaultValue: string;
  /** コメント, escapes applied. */
  readonly comment: string;
  /** 色 as the declared token (P12: `$AARRGGBB`). */
  readonly color: string;
  readonly raw: string;
  readonly span: Span;
  readonly elementsSeen: number;
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly RawElement[];
}

/** Two or more common columns that share one case-insensitive physical name (P12). */
export interface DuplicateCommonColumn {
  readonly physicalName: string;
  readonly declarations: readonly CommonColumnDeclaration[];
}

/** Where an effective column came from. */
export type ColumnSource = 'declared' | 'common';

/** One column of an entity's effective list. */
export interface EffectiveColumn {
  /** Physical name, as declared. */
  readonly pname: string;
  /** Logical name, as declared (`Field` element 1 / `CommonField` element 1). */
  readonly logicalName: string;
  readonly source: ColumnSource;
  /** The line that declared it: the `Field` line, or the `CommonField` line it was composed from. */
  readonly span: Span;
  /** True when the same physical name also arrives from the other source. */
  readonly collision: boolean;
}

/** A physical name declared twice in one entity's effective list. */
export interface ColumnCollision {
  readonly sectionIndex: number;
  readonly object: string;
  readonly pname: string;
  /** Both declaring lines, in effective order. */
  readonly spans: readonly Span[];
}

/** How the entity's `UsingCommonColumns` was written. */
export interface UsingCommonColumnsFact {
  /** `1` or `0` when it decoded; `null` when the key is absent or its token is unusable. */
  readonly value: number | null;
  readonly origin: 'declared' | 'defaulted';
  /** The value text as written; `''` when the key is absent. */
  readonly raw: string;
  /** The key line, or `null` when the key is absent (a default has no line). */
  readonly span: Span | null;
  readonly token: 'one' | 'zero' | 'absent' | 'unrecognised';
}

/** One entity's declared and composed columns. */
export interface EntityColumns {
  readonly sectionIndex: number;
  readonly object: string;
  readonly usingCommonColumns: UsingCommonColumnsFact;
  /** The entity's own `Field` entries, in declaration order. */
  readonly declared: readonly EffectiveColumn[];
  /** The common columns composed in, in declaration order; empty when the entity opted out. */
  readonly common: readonly EffectiveColumn[];
  /** Declared first, then composed: every column, nothing dropped (see the header). */
  readonly effective: readonly EffectiveColumn[];
  readonly collisions: readonly ColumnCollision[];
  /** True when the opt-in could not be decided, so `effective` is not a complete answer. */
  readonly indeterminate: boolean;
}

export interface CommonColumnResult {
  readonly commonFields: readonly CommonColumnDeclaration[];
  readonly duplicates: readonly DuplicateCommonColumn[];
  readonly entities: readonly EntityColumns[];
  /** Entities whose composition is uncertain, for a consumer that must not trust `effective`. */
  readonly indeterminate: readonly EntityColumns[];
}

/** One element of a `CommonField` as written. */
function element(parts: readonly ComplexPart[], index: number): string {
  const part = parts[index];
  return part === undefined ? '' : unescapeEscaped(part.value);
}

/** The `NOT NULL` slot: the literal `NotNull`, an empty slot, or an unrecognised token (R20's rule). */
function readNotNull(raw: string): { value: boolean | null; token: CommonNotNullToken } {
  if (raw === '') return { value: false, token: 'nullable' };
  if (raw === NOT_NULL_LITERAL) return { value: true, token: 'not-null' };
  return { value: null, token: 'unrecognised' };
}

/** Every `CommonField` of the document, in file order. */
function declarationsOf(classification: Classification): CommonColumnDeclaration[] {
  const declarations: CommonColumnDeclaration[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Manager') continue;
    for (const entry of section.entries) {
      if (entry.kind !== 'parsed') continue;
      const { occurrence } = entry;
      if (occurrence.spec.key !== 'CommonField' || occurrence.span === null) continue;
      const decoded = occurrence.decoded;
      if (!decoded.ok) continue;
      const value = decoded.value.value;
      if (typeof value !== 'object') continue;

      const parts = value.parts;
      const notNullRaw = element(parts, 3);
      const notNull = readNotNull(notNullRaw);
      const keyOrderText = element(parts, 4);
      const keyOrder = keyOrderText === '' ? null : decodeInteger(keyOrderText);

      declarations.push({
        logicalName: element(parts, 0),
        physicalName: element(parts, 1),
        dataType: element(parts, 2),
        notNull: notNull.value,
        notNullToken: notNull.token,
        keyOrder: keyOrder !== null && keyOrder.ok ? keyOrder.value : null,
        defaultValue: element(parts, 5),
        comment: element(parts, 6),
        color: element(parts, 7),
        raw: occurrence.raw,
        span: occurrence.span,
        elementsSeen: parts.length,
        shape: parts.length === 8 ? 'documented' : 'unexpected-element-count',
        rawElements: parts.map((part, index) => ({
          index,
          raw: partRaw(part),
          quoted: part.quoted,
        })),
      });
    }
  }
  return declarations;
}

/** Group common columns by case-insensitive physical name, keeping every one (P12). */
function groupByPhysicalName(
  declarations: readonly CommonColumnDeclaration[],
): Map<string, CommonColumnDeclaration[]> {
  const groups = new Map<string, CommonColumnDeclaration[]>();
  for (const declaration of declarations) {
    if (declaration.physicalName === '') continue;
    const key = declaration.physicalName.toLowerCase();
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [declaration]);
    else existing.push(declaration);
  }
  return groups;
}

/** How one entity's `UsingCommonColumns` was written (§4.2: absent is a documented default). */
function usingCommonColumnsOf(section: ClassifiedSection): UsingCommonColumnsFact {
  let last: { raw: string; span: Span; value: number | null } | null = null;
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    const { occurrence } = entry;
    if (occurrence.spec.key !== 'UsingCommonColumns' || occurrence.span === null) continue;
    const decoded = occurrence.decoded;
    const value =
      decoded.ok && typeof decoded.value.value === 'number' ? decoded.value.value : null;
    last = { raw: occurrence.raw, span: occurrence.span, value };
  }
  if (last === null) {
    // P6: `UsingCommonColumns` defaults to 1, so an entity that says nothing opts in (§4.2 defaulted).
    return { value: 1, origin: 'defaulted', raw: '', span: null, token: 'absent' };
  }
  if (last.value === 1) {
    return { value: 1, origin: 'declared', raw: last.raw, span: last.span, token: 'one' };
  }
  if (last.value === 0) {
    return { value: 0, origin: 'declared', raw: last.raw, span: last.span, token: 'zero' };
  }
  // A token the format does not define is not "the default": the entity's opt-in is unknown.
  return { value: null, origin: 'declared', raw: last.raw, span: last.span, token: 'unrecognised' };
}

/**
 * Compose every entity's effective column list.
 *
 * Pure: reads the classification and the common-column declarations, builds new arrays; no decoded
 * field, no section and no classification node is modified.
 */
export function commonColumnsOf(classification: Classification): CommonColumnResult {
  const commonFields = declarationsOf(classification);
  const groups = groupByPhysicalName(commonFields);

  const duplicates: DuplicateCommonColumn[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length < 2 || first === undefined) continue;
    duplicates.push({ physicalName: first.physicalName, declarations: group });
  }

  const entities: EntityColumns[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Entity') continue;
    const object = pnameOf(section) ?? '';
    const using = usingCommonColumnsOf(section);

    const declared: EffectiveColumn[] = section.decoded.fields.map((field) => ({
      pname: field.physicalName.value,
      logicalName: field.logicalName.value,
      source: 'declared',
      span: field.span,
      collision: false,
    }));

    // `null` means the opt-in is undecidable, and an undecidable opt-in composes nothing:
    // reporting a column the file may not include would be the same invention as dropping one.
    const composed: EffectiveColumn[] =
      using.value === 1
        ? commonFields.map((declaration) => ({
            pname: declaration.physicalName,
            logicalName: declaration.logicalName,
            source: 'common' as const,
            span: declaration.span,
            collision: false,
          }))
        : [];

    const effective = [...declared, ...composed];
    const seen = new Map<string, EffectiveColumn[]>();
    for (const column of effective) {
      if (column.pname === '') continue;
      const key = column.pname.toLowerCase();
      const existing = seen.get(key);
      if (existing === undefined) seen.set(key, [column]);
      else existing.push(column);
    }

    const collisions: ColumnCollision[] = [];
    const colliding = new Set<string>();
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      const first = group[0];
      if (first === undefined) continue;
      colliding.add(first.pname.toLowerCase());
      collisions.push({
        sectionIndex: section.index,
        object,
        pname: first.pname,
        spans: group.map((column) => column.span),
      });
    }

    entities.push({
      sectionIndex: section.index,
      object,
      usingCommonColumns: using,
      declared,
      common: composed,
      effective: effective.map((column) => ({
        ...column,
        collision: colliding.has(column.pname.toLowerCase()),
      })),
      collisions,
      indeterminate: using.value === null,
    });
  }

  return {
    commonFields,
    duplicates,
    entities,
    indeterminate: entities.filter((entity) => entity.indeterminate),
  };
}
