/**
 * `Position` — the same key name with different shapes per section (`architecture.md` §4.5, F1;
 * `format-coverage.md` P9, P11, K12).
 *
 * This is the clearest case of why the registry is keyed by `(section kind, key)`: the *same* key
 * holds two unrelated grammars, and a decoder that dispatched on the key name alone would read a
 * relation's terminal positions as an object's width and height.
 *
 * | Section | Shape | Status |
 * |---|---|---|
 * | `[Entity]`, `[View]`, `[Subtype]` | `"ページ名",X,Y[,幅,高さ]` — 3 or 5 elements | documented (§4.1.3, P11) |
 * | `[Relation]` / `[Relationship]` | `"ページ名",ラインモード,線位置1..3,端子位置1..2,"頂点座標リスト"` — 8 | documented (§4.2.1, P9) |
 * | `[Shape]`, `[Line]`, `[Comment]` | not documented | **unsupported record**, never interpreted |
 *
 * Rules that keep this stage honest:
 *
 * - **Page names stay verbatim.** Matching them is case-insensitive in the *resolver* (§P9's
 *   inferred rule, forced by the spec's own `PageInfo="Main"` / `Position="MAIN"` sample), so doing
 *   it here would duplicate a semantic decision and hide it from the validator. `sem-02`'s
 *   `"MAIN"` and `sem-01`'s `"GhostPage"` are therefore stored exactly as written.
 * - **Every occurrence is kept.** One object may be placed on several pages (`§P11`), so a section
 *   with three `Position` lines yields three records in declaration order.
 * - **Unexpected arity is a record, not a guess.** A 4-element object position or a 7-element
 *   relation position becomes `kind: 'unsupported'` with its elements intact. §11 defines no code
 *   for geometry, and inventing one — or silently reading the first three elements as `x, y, w` —
 *   would be the silent truncation this project forbids.
 * - **Coordinates are integers by documentation** (`0.1 mm` units); a non-integer token yields
 *   `null` with the declared text kept beside it, never `0`.
 */

import type { Span } from '../model/span.js';
import type { SectionKind } from '../syntax/sections.js';
import type { ComplexValue, Value } from './values.js';
import type { ComplexPart } from '../syntax/complex.js';
import { decodeInteger, elementAt, emptyDefault, partRaw, unescapeEscaped } from './values.js';

/** Which grammar a section's `Position` follows. */
export type PositionShape = 'object' | 'relation' | 'undocumented';

/** `[Shape]`, `[Line]` and `[Comment]` have the key but no documented grammar (P12). */
export function positionShapeOf(kind: SectionKind): PositionShape | null {
  switch (kind) {
    case 'Entity':
    case 'View':
    case 'Subtype':
      return 'object';
    case 'Relation':
      return 'relation';
    case 'Shape':
    case 'Line':
    case 'Comment':
      return 'undocumented';
    case 'Manager':
    case 'unknown':
      // `[Manager]` has no `Position` key at all; an unknown section is not modelled either.
      return null;
  }
}

/** One element of an unsupported position, kept addressable. */
export interface RawElement {
  readonly index: number;
  readonly raw: string;
  readonly quoted: boolean;
}

/** `[Entity]`/`[View]`/`[Subtype]`: `"ページ名",X,Y[,幅,高さ]` (§4.1.3, P11). */
export interface ObjectPosition {
  readonly kind: 'object';
  /** The page name exactly as written; resolution is the resolver's job (§P9). */
  readonly page: Value<string>;
  readonly x: Value<number> | null;
  readonly y: Value<number> | null;
  /** Present only when the size is fixed («自動計算するときは出力されない», P11). */
  readonly width: Value<number> | null;
  readonly height: Value<number> | null;
  /** The declared token behind a `null` coordinate, so an invalid number stays visible. */
  readonly rawElements: readonly RawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: Span;
}

/** `[Relation]`/`[Relationship]`: the 8-element line shape (§4.2.1, P9). */
export interface RelationPosition {
  readonly kind: 'relation';
  readonly page: Value<string>;
  /** ラインモード, documented `0`–`10`. */
  readonly lineMode: Value<number> | null;
  /** 線位置1–3, documented `0`–`10000`. */
  readonly linePositions: readonly (Value<number> | null)[];
  /** 端子位置1–2: `R` or `L`. Kept as text; an unexpected token is not coerced. */
  readonly terminals: readonly Value<string>[];
  /**
   * 頂点座標リスト — the raw token.
   *
   * The outer list is `;`-separated but the **inner point format is never defined** (K12), so the
   * list is kept whole rather than split into points that would have to be invented.
   */
  readonly vertices: Value<string>;
  readonly rawElements: readonly RawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: Span;
}

/** A position whose grammar the documents do not state, or whose arity does not fit it. */
export interface UnsupportedPosition {
  readonly kind: 'unsupported';
  readonly reason: 'shape-not-documented' | 'unexpected-element-count';
  readonly sectionKind: SectionKind;
  readonly rawElements: readonly RawElement[];
  readonly elementsSeen: number;
  readonly raw: string;
  readonly span: Span;
}

export type DecodedPosition = ObjectPosition | RelationPosition | UnsupportedPosition;

/** Page name: escapes apply (a quoted Complex element), nothing else (§7.1). */
function pageOf(parts: readonly ComplexPart[], span: Span): Value<string> {
  const element = elementAt(parts, 0, span);
  if (element === null) return emptyDefault();
  return { ...element, value: unescapeEscaped(element.value) };
}

/**
 * A documented integer element: `null` when the token is absent, not a decimal integer, or outside
 * the exact range a JavaScript number can hold (R19).
 *
 * The number goes through `decodeInteger`, so `9999999999999999999999` cannot arrive as `1e22` and
 * `9007199254740993` cannot silently become `9007199254740992`. A negative coordinate is decoded as
 * the integer it is: the documented ranges (`0`–`10000`, `0`–`10`) are validation concerns, and
 * rejecting a value here would be this stage inventing a rule the specification states elsewhere.
 * The declared token stays in `rawElements` either way.
 */
function numberAt(parts: ComplexValue['parts'], index: number, span: Span): Value<number> | null {
  const element = elementAt(parts, index, span);
  if (element === null) return null;
  const decoded = decodeInteger(element.value);
  if (!decoded.ok) return null;
  return { ...element, value: decoded.value };
}

/** A text element with escapes applied; empty default when the writer stopped earlier. */
function textAt(parts: ComplexValue['parts'], index: number, span: Span): Value<string> {
  const element = elementAt(parts, index, span);
  if (element === null) return emptyDefault();
  return { ...element, value: unescapeEscaped(element.value) };
}

/** Every element as written, for a record that claims no meaning. */
function rawElementsOf(parts: ComplexValue['parts']): RawElement[] {
  return parts.map((part, index) => ({ index, raw: partRaw(part), quoted: part.quoted }));
}

/** 3 elements (page, x, y) or 5 (page, x, y, width, height); nothing else (P11). */
const OBJECT_ELEMENT_COUNTS: readonly number[] = [3, 5];

/** The relation grammar is exactly 8 elements (§4.2.1). */
const RELATION_ELEMENT_COUNT = 8;

/**
 * Decode one `Position` occurrence for the section it appeared in.
 *
 * Total: every input yields a record. A shape that is not documented, or an element count the
 * documented shape does not allow, comes back as `kind: 'unsupported'` with the elements intact —
 * no diagnostic, because §11 has no code for geometry and this unit does not invent one.
 */
export function decodePosition(
  kind: SectionKind,
  parts: ComplexValue,
  span: Span,
  raw: string,
): DecodedPosition {
  const shape = positionShapeOf(kind);
  const elements = parts.parts;
  const elementsSeen = elements.length;
  const unsupported = (reason: UnsupportedPosition['reason']): UnsupportedPosition => ({
    kind: 'unsupported',
    reason,
    sectionKind: kind,
    rawElements: rawElementsOf(elements),
    elementsSeen,
    raw,
    span,
  });

  if (shape === 'undocumented') return unsupported('shape-not-documented');
  if (shape === 'object') {
    if (!OBJECT_ELEMENT_COUNTS.includes(elementsSeen)) {
      return unsupported('unexpected-element-count');
    }
    return {
      kind: 'object',
      page: pageOf(elements, span),
      x: numberAt(elements, 1, span),
      y: numberAt(elements, 2, span),
      width: numberAt(elements, 3, span),
      height: numberAt(elements, 4, span),
      rawElements: rawElementsOf(elements),
      elementsSeen,
      raw,
      span,
    };
  }
  if (elementsSeen !== RELATION_ELEMENT_COUNT) return unsupported('unexpected-element-count');

  return {
    kind: 'relation',
    page: pageOf(elements, span),
    lineMode: numberAt(elements, 1, span),
    linePositions: [
      numberAt(elements, 2, span),
      numberAt(elements, 3, span),
      numberAt(elements, 4, span),
    ],
    terminals: [textAt(elements, 5, span), textAt(elements, 6, span)],
    vertices: textAt(elements, 7, span),
    rawElements: rawElementsOf(elements),
    elementsSeen,
    raw,
    span,
  };
}
