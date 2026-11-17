/**
 * Views (`architecture.md` §4.3, §4.5, §9.6, P6, P10, P11, P13; `format-coverage.md` F6, K4).
 *
 * A `[View]` shares most of `[Entity]`'s keys but 「`Field`や`Index`は持ちません」 (P6): the columns a
 * view produces live in its `Query` and nowhere else. Three rules decide what this module may say:
 *
 * - **Columns are unknown, never empty.** §4.5's `EffectiveColumns` has an `unknown` arm with a
 *   `reason`, and this module's shape has **no `columns` member at all**, so `columns: []` — the
 *   reading "this view has zero columns" — is unrepresentable. P10 is explicit about why: a `[View]`
 *   whose columns came back empty is indistinguishable from a table that declares none.
 * - **`Query` is one `String`, kept whole.** P13 types it `String`, so it is unquoted and nothing
 *   else: not trimmed, not re-escaped, not split on `;`, not parsed as SQL, and **not joined** with a
 *   following physical line (U12 — a broken value stays evidence, `val-08`). Only the quoting the
 *   format itself defines is removed.
 * - **`LNameByComment` changes the reason, never the fact.** `1` means the column logical names are
 *   read out of comments inside the SELECT (P10), which moves the answer further out of reach:
 *   `view-columns-named-from-query` instead of `view-columns-not-stored`. Either way the columns are
 *   unknown, so `Position` count — one placement or five (§P11) — cannot change the record.
 *
 * `LNameByComment` has **no default** in v2.21: only `1` and `0` are documented and the registry
 * declares no `defaultValue` for it, so an absent key is recorded as absent and no value is assumed
 * (§4.2's `defaulted` origin requires a default the specification states). A token that is neither
 * `1` nor `0` keeps its text and is `indeterminate`, for the same reason.
 *
 * Nothing here is resolved, rewritten or mutated, and nothing invents a diagnostic: the single
 * `V_VIEW_COLUMNS_UNKNOWN` per view is emitted in `partial.ts` from this module's records.
 */

import type { Span } from '../model/span.js';
import type { DecodedPosition } from '../schema/position.js';
import type { Classification, ClassifiedSection, KeyOccurrence } from '../schema/registry.js';

/** Why a view's column list cannot be stated from the file (P10, §9.6). */
export type ViewColumnReason = 'view-columns-not-stored' | 'view-columns-named-from-query';

/**
 * A view's effective columns: always `unknown`.
 *
 * The arm deliberately has no `columns` member (§4.5). A consumer that wants a list has to handle
 * `status` first, which is the only way "not stored in this file" cannot be printed as "zero".
 */
export interface ViewColumns {
  readonly status: 'unknown';
  readonly reason: ViewColumnReason;
}

/** How the `LNameByComment` key was written. */
export type LNameByCommentToken = 'one' | 'zero' | 'absent' | 'unrecognised';

/**
 * `LNameByComment` with its provenance.
 *
 * `origin` has no `defaulted` member on purpose: v2.21 states no default for this key, so an absent
 * key cannot be reported as a defaulted value without inventing one.
 */
export interface LNameByCommentFact {
  /** `true`/`false` only for a declared `1`/`0`; `null` when the key is absent or unusable. */
  readonly value: boolean | null;
  readonly origin: 'declared' | 'absent' | 'invalid';
  /** The value text exactly as written; the empty string when the key is absent. */
  readonly raw: string;
  /** The key line; `null` when the key is absent (nothing in the file declares it). */
  readonly span: Span | null;
  readonly token: LNameByCommentToken;
}

/** One `[View]` section, as declared. */
export interface ViewDeclaration {
  /** 1-based section ordinal the view was declared in. */
  readonly sectionIndex: number;
  /** Header text exactly as written, kept so a view is traceable even without a `PName`. */
  readonly headerRaw: string;
  /** `PName` with escapes applied — the spelling the file used; `null` when it declares none. */
  readonly pname: string | null;
  /** Every `PName` line in file order: more than one is a duplicate key, and all are kept (§4.2). */
  readonly pnameSpans: readonly Span[];
  /** `Query` as the `String` P13 types it: unquoted and otherwise untouched; `null` when absent. */
  readonly query: string | null;
  /** The `Query` value text exactly as written, quotes included — a broken line stays evidence. */
  readonly queryRaw: string | null;
  readonly querySpan: Span | null;
  readonly lnameByComment: LNameByCommentFact;
  /** Always `unknown` with a reason (§9.6). There is no arm that carries a column list. */
  readonly effectiveColumns: ViewColumns;
  /** Every `Position` occurrence, verbatim: placements, never columns (§P11). */
  readonly positions: readonly DecodedPosition[];
  /** The line this view's finding points at: its `PName` line, else the `[View]` header. */
  readonly span: Span;
}

export interface ViewResult {
  /** Every `[View]` of the document, in file order. One record per section. */
  readonly views: readonly ViewDeclaration[];
}

/** Every parsed occurrence of one key in a section, in file order. */
function occurrencesOf(section: ClassifiedSection, key: string): KeyOccurrence[] {
  return section.entries.flatMap((entry) =>
    entry.kind === 'parsed' && entry.occurrence.spec.key === key ? [entry.occurrence] : [],
  );
}

/** The interpreted text of one occurrence, or `null` when its token did not decode. */
function decodedTextOf(occurrence: KeyOccurrence): string | null {
  if (!occurrence.decoded.ok) return null;
  const value = occurrence.decoded.value.value;
  return typeof value === 'string' ? value : null;
}

/**
 * The line a view reports on: its `PName` line, else the `[View]` header.
 *
 * The same convention `required.ts` uses for a missing key — one line, the most specific one the file
 * actually contains — so a consumer never has to interpret the span to find the object it names.
 */
function reportSpanOf(section: ClassifiedSection, pnameSpans: readonly Span[]): Span {
  return (
    pnameSpans.at(-1) ?? {
      sectionIndex: section.index,
      startLine: section.span.keyLine,
      endLine: section.span.keyLine,
      keyLine: section.span.keyLine,
    }
  );
}

/** `LNameByComment`: the last occurrence wins (§4.2), a token that is not `1`/`0` is not coerced. */
function lnameByCommentOf(section: ClassifiedSection): LNameByCommentFact {
  const last = occurrencesOf(section, 'LNameByComment').at(-1);
  if (last === undefined) {
    return { value: null, origin: 'absent', raw: '', span: null, token: 'absent' };
  }
  const span = last.span;
  if (last.decoded.ok && last.decoded.value.value === true) {
    return { value: true, origin: 'declared', raw: last.raw, span, token: 'one' };
  }
  if (last.decoded.ok && last.decoded.value.value === false) {
    return { value: false, origin: 'declared', raw: last.raw, span, token: 'zero' };
  }
  return { value: null, origin: 'invalid', raw: last.raw, span, token: 'unrecognised' };
}

/** One `[View]` section as a record. Always returned: a view without a name is still a view. */
function viewOf(section: ClassifiedSection): ViewDeclaration {
  const pnameOccurrences = occurrencesOf(section, 'PName');
  const pnameSpans = pnameOccurrences.flatMap((occurrence) =>
    occurrence.span === null ? [] : [occurrence.span],
  );
  const pnameOccurrence = pnameOccurrences.at(-1);
  const queryOccurrence = occurrencesOf(section, 'Query').at(-1);
  const lnameByComment = lnameByCommentOf(section);

  return {
    sectionIndex: section.index,
    headerRaw: section.headerRaw,
    pname: pnameOccurrence === undefined ? null : decodedTextOf(pnameOccurrence),
    pnameSpans,
    query: queryOccurrence === undefined ? null : decodedTextOf(queryOccurrence),
    queryRaw: queryOccurrence?.raw ?? null,
    querySpan: queryOccurrence?.span ?? null,
    lnameByComment,
    // P10: only `1` moves the reason. `0`, an absent key and an unusable token all mean the file
    // states no comment-sourced names, so the ordinary reason stands — the flag itself is still
    // carried, and an unusable one is `indeterminate` there rather than silently read as `0`.
    effectiveColumns: {
      status: 'unknown',
      reason:
        lnameByComment.value === true ? 'view-columns-named-from-query' : 'view-columns-not-stored',
    },
    positions: [...section.decoded.positions],
    span: reportSpanOf(section, pnameSpans),
  };
}

/**
 * Every view of the document, with its unknown column state.
 *
 * One record per `[View]` section, in file order — a section that declares no `PName` is still a
 * view (and still cannot supply its columns), so it is not dropped; the missing name is a
 * `V_MISSING_REQUIRED_KEY` finding, not a reason to lose the object.
 *
 * Pure: reads the classification, allocates its own records, mutates nothing.
 */
export function viewsOf(classification: Classification): ViewResult {
  const views: ViewDeclaration[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'View') continue;
    views.push(viewOf(section));
  }
  return { views };
}
