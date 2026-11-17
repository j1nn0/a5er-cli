/**
 * Page resolution (`architecture.md` §9.3, P9, P11, F5; `format-coverage.md` K12).
 *
 * Pages are declared once, in `[Manager]`, as a four-element Complex value:
 * `PageInfo = "ページ名",表示モード,"用紙サイズ","背景色"` (P11). Objects then refer to a page by name
 * in their `Position` value, and the specification says that match is **case-insensitive**
 * (「大文字小文字の区別なし」, P9) — the spec's own sample declares `PageInfo="Main"` and places a
 * relation on `"MAIN"`.
 *
 * What this module does, and refuses to do:
 *
 * - **Resolves, never rewrites.** A position's page reference keeps the spelling the file used, and
 *   the resolved declaration is reported beside it. Rewriting `"MAIN"` to `"Main"` would destroy the
 *   evidence the match was made from.
 * - **Retains ambiguity.** Two `PageInfo` values that differ only in case are a duplicate the format
 *   forbids (page names are unique *without* case, P11) and this stage cannot resolve; both
 *   declarations are kept and references are reported as ambiguous rather than silently bound to one
 *   of them. There is no diagnostic code for a duplicate page name in §11, so it is recorded in the
 *   result — the honest place for it — and not turned into an invented code.
 * - **An unnamed declaration is not a target.** `PageInfo="",…` is kept as evidence, but no
 *   reference can resolve to it: binding a reference to a page with no name would be inventing one.
 * - **No geometry.** Display mode, paper size and background colour are kept as declared and not
 *   interpreted; coordinates, margins and routing are presentation (P11: "not planned") and are not
 *   even read here.
 */

import type { Span } from '../model/span.js';
import type { Classification } from '../schema/registry.js';
import type { ComplexPart } from '../syntax/complex.js';
import { decodeInteger, partRaw, unescapeEscaped } from '../schema/values.js';
import type { RawElement } from '../schema/position.js';
import type { SectionKind } from '../syntax/sections.js';

/** One `PageInfo` declaration, as written. */
export interface PageDeclaration {
  /** `ページ名` with escapes applied — the spelling the file used, case included. */
  readonly name: string;
  readonly raw: string;
  readonly span: Span;
  /** 表示モード, documented `0`–`7`; `null` when the token is absent or not an integer. */
  readonly displayMode: number | null;
  /** 用紙サイズ (`A4Landscape`, …) verbatim — a string the spec enumerates, not a layout to apply. */
  readonly paperSize: string | null;
  /** 背景色 (`$BBGGRR` per P11) as the declared token. */
  readonly background: string | null;
  readonly elementsSeen: number;
  /** `documented` for the four-element shape; anything else keeps every element raw (P11). */
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly RawElement[];
}

/** Two or more declarations that share one case-insensitive name. */
export interface DuplicatePage {
  /** The spelling of the first declaration, for display. */
  readonly name: string;
  readonly declarations: readonly PageDeclaration[];
}

/**
 * One declaration that matched a reference case-insensitively, as evidence.
 *
 * Only the two facts a consumer needs to find the declaration again: its own spelling and the line
 * it was written on. The rest of the `PageInfo` is already in `pages`.
 */
export interface PageCandidate {
  readonly name: string;
  readonly span: Span;
}
/**
 * One page reference from a `Position`, with the declaration it resolved to.
 *
 * The three candidates *are* resolution metadata carried beside the decision, not a second
 * resolution: `raw` is the token the `Position` wrote, `resolvedSpan` is the line of the one
 * declaration a `resolved` reference matched, and `candidates` is every declaration an `ambiguous`
 * reference matched (the same declarations `duplicates` groups, in file order). Neither an
 * ambiguous nor a dangling reference names a target — `resolvedPage`/`resolvedSpan` stay `null` —
 * so no consumer can read a chosen page out of a reference the file left open (R29).
 */
export interface PageReference {
  readonly sectionIndex: number;
  /** The section kind that placed the object, so the reference is traceable to a node type. */
  readonly sectionKind: SectionKind;
  /** The reference exactly as written; never rewritten to the declared spelling. */
  readonly declared: string;
  /** The page element exactly as written, before the escape/quote layer was decoded. */
  readonly raw: string;
  readonly span: Span;
  readonly status: 'resolved' | 'dangling' | 'ambiguous';
  /** The declared spelling it resolved to, or `null` when the reference is not usable. */
  readonly resolvedPage: string | null;
  /** The line of that declaration; `null` unless `status` is `resolved`. */
  readonly resolvedSpan: Span | null;
  /** Every declaration the reference matched, in file order; empty unless `status` is ambiguous. */
  readonly candidates: readonly PageCandidate[];
}

export interface PageResult {
  readonly pages: readonly PageDeclaration[];
  /** Declarations that collide case-insensitively; kept, not merged. */
  readonly duplicates: readonly DuplicatePage[];
  readonly references: readonly PageReference[];
  readonly danglingReferences: readonly PageReference[];
}

/** One element of a `PageInfo` as written. */
function elementText(part: ComplexPart | undefined): string | null {
  return part === undefined ? null : unescapeEscaped(part.value);
}

/** Parse one `PageInfo` value into its documented four elements (P11). */
function pageOf(parts: readonly ComplexPart[], span: Span, raw: string): PageDeclaration {
  const name = elementText(parts[0]) ?? '';
  const displayModeText = elementText(parts[1]);
  // Same rule as every other number in this stage: strict, exact, never rounded (R19).
  const decodedMode = displayModeText === null ? null : decodeInteger(displayModeText);
  const displayMode = decodedMode !== null && decodedMode.ok ? decodedMode.value : null;

  return {
    name,
    raw,
    span,
    displayMode,
    paperSize: elementText(parts[2]),
    background: elementText(parts[3]),
    elementsSeen: parts.length,
    shape: parts.length === 4 ? 'documented' : 'unexpected-element-count',
    rawElements: parts.map((part, index) => ({ index, raw: partRaw(part), quoted: part.quoted })),
  };
}

/** Every `PageInfo` declaration of the document, in file order. */
function declarationsOf(classification: Classification): PageDeclaration[] {
  const pages: PageDeclaration[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Manager') continue;
    for (const entry of section.entries) {
      if (entry.kind !== 'parsed') continue;
      const { occurrence } = entry;
      if (occurrence.spec.key !== 'PageInfo' || occurrence.span === null) continue;
      const decoded = occurrence.decoded;
      if (!decoded.ok) continue;
      const value = decoded.value.value;
      if (typeof value !== 'object') continue;
      pages.push(pageOf(value.parts, occurrence.span, occurrence.raw));
    }
  }
  return pages;
}

/** Group declarations by case-insensitive name; a group of two or more is a duplicate (P11). */
function duplicatesOf(pages: readonly PageDeclaration[]): DuplicatePage[] {
  const groups = new Map<string, PageDeclaration[]>();
  for (const page of pages) {
    const key = page.name.toLowerCase();
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [page]);
    else existing.push(page);
  }

  const duplicates: DuplicatePage[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length < 2 || first === undefined) continue;
    duplicates.push({ name: first.name, declarations: group });
  }
  return duplicates;
}

/** A page reference held by one decoded `Position`. */
interface RawReference {
  readonly sectionIndex: number;
  readonly sectionKind: SectionKind;
  readonly declared: string;
  readonly raw: string;
  readonly span: Span;
}

/**
 * The page a decoded `Position` refers to, or `null` when the shape is not a documented one.
 *
 * Only the two documented shapes carry a page name: the object shape (element 1) and the relation
 * shape (element 1). An `unsupported` shape is not interpreted at all — inventing a page reference
 * out of an unknown grammar is exactly what P12's "not planned" list forbids.
 */
function referencesOf(classification: Classification): RawReference[] {
  const references: RawReference[] = [];
  for (const section of classification.sections) {
    for (const position of section.decoded.positions) {
      if (position.kind === 'unsupported') continue;
      references.push({
        sectionIndex: section.index,
        sectionKind: section.kind,
        declared: position.page.value,
        raw: position.page.raw,
        span: position.page.span ?? position.span,
      });
    }
  }
  return references;
}

/**
 * Resolve the document's pages and every reference to them.
 *
 * Pure: reads the classification, returns new records. References are matched
 * case-insensitively and kept verbatim; an ambiguous match is reported as ambiguous rather than
 * bound to whichever declaration happened to come first.
 */
export function pagesOf(classification: Classification): PageResult {
  const pages = declarationsOf(classification);
  const duplicates = duplicatesOf(pages);

  /**
   * Case-insensitive name → the declarations that carry it.
   *
   * A declaration whose name element is empty is kept in `pages` as evidence but cannot be a
   * resolution target: an unnamed page names nothing, and binding a reference to it would be
   * inventing the name. The four-element shape is *not* a condition for resolving — the name is
   * element 1 in every version of the format we know, and the `shape` marker already tells a
   * consumer that a declaration deviated.
   */
  const byName = new Map<string, PageDeclaration[]>();
  for (const page of pages) {
    if (page.name === '') continue;
    const key = page.name.toLowerCase();
    const existing = byName.get(key);
    if (existing === undefined) byName.set(key, [page]);
    else existing.push(page);
  }

  const references: PageReference[] = [];
  for (const reference of referencesOf(classification)) {
    const matches = byName.get(reference.declared.toLowerCase()) ?? [];
    const resolved = matches[0];
    const status: PageReference['status'] =
      matches.length === 0 ? 'dangling' : matches.length === 1 ? 'resolved' : 'ambiguous';
    const selected = status === 'resolved' ? resolved : undefined;
    references.push({
      sectionIndex: reference.sectionIndex,
      sectionKind: reference.sectionKind,
      declared: reference.declared,
      raw: reference.raw,
      span: reference.span,
      status,
      resolvedPage: selected === undefined ? null : selected.name,
      resolvedSpan: selected === undefined ? null : selected.span,
      // Every declaration an ambiguous reference matched, in file order — the same records,
      // `duplicatePages` groups, so the list cannot disagree with the evidence beside it.
      candidates:
        status === 'ambiguous'
          ? matches.map((match) => ({ name: match.name, span: match.span }))
          : [],
    });
  }

  return {
    pages,
    duplicates,
    references,
    danglingReferences: references.filter((reference) => reference.status === 'dangling'),
  };
}
