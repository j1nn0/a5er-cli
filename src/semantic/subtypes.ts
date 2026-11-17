/**
 * Subtypes (`architecture.md` §4.4, §9.6, §11; `format-coverage.md` F7, D6, K11, U11).
 *
 * `[Subtype]` declares an object with five keys — `PName`, `SharedMode`, `CompleteCategory`,
 * `Position`, `ZOrder` — and **no key anywhere states which entities belong to it** (K11, F7). The
 * specification mentions `Subtype` twice in the whole document, both times as a heading, and no
 * `[Entity]`-side key points back at one. Three consequences:
 *
 * - **Membership is unsupported, not empty.** The record carries
 *   `membership: { status: 'unsupported', reason: 'no-membership-key-in-v2.21' }` and has **no
 *   member list at all**, so "no members" is unrepresentable. A `memberships: []` would be the same
 *   fabrication as a view reporting `columns: []`.
 * - **Nothing is inferred.** Not from a `[Subtype]`'s name, not from its `Position` overlapping an
 *   entity's, not from declaration order (A14, D6). Every one of those is a guess dressed as data,
 *   and U11 says a real export is what would settle the question — not a heuristic.
 * - **The object's own keys are still read.** `SharedMode` and `CompleteCategory` are untyped in the
 *   specification, so they are kept as declared text and never coerced; `ZOrder` goes through the
 *   same strict integer rule as every other number in this stage (R19), and `Position` keeps its
 *   decoded occurrences, unusable shapes included.
 *
 * The one `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` per subtype is emitted in `partial.ts` from these
 * records. Nothing is resolved, rewritten or mutated, and no diagnostic code is invented.
 */

import type { Span } from '../model/span.js';
import type { DecodedPosition } from '../schema/position.js';
import type {
  Classification,
  ClassifiedSection,
  KeyOccurrence,
  RawEntry,
} from '../schema/registry.js';

/**
 * What a subtype's membership can be said to be: nothing.
 *
 * There is no `entities` or `members` member, so a consumer cannot read a list that was never
 * stated — the shape itself is the guarantee (§9.6, D6).
 */
export interface SubtypeMembership {
  readonly status: 'unsupported';
  /** The reason is fixed by the specification's silence (F7, K11), not by this file's content. */
  readonly reason: 'no-membership-key-in-v2.21';
}

/** How one untyped `[Subtype]` key was written. */
export type SubtypeScalarToken = 'declared' | 'absent' | 'unrecognised';

/**
 * One `[Subtype]` key kept as declared text (or a decoded number), with its provenance.
 *
 * The three states are distinguishable on purpose: an absent key (`'absent'`, no raw, no span), a
 * key whose token decoded (`'declared'`) and a key whose token did not (`'unrecognised'`, value
 * `null` but **raw and span kept**). Collapsing the last two would let a malformed token look like
 * a missing one, and vice versa.
 */
export interface SubtypeScalar<T> {
  /** The interpreted value, or `null` when the key is absent or its token did not decode. */
  readonly value: T | null;
  /** The value text exactly as written; `null` when the key is absent. */
  readonly raw: string | null;
  /** The key line; `null` when the key is absent. */
  readonly span: Span | null;
  readonly token: SubtypeScalarToken;
}

/** One `[Subtype]` section, as declared. */
export interface SubtypeDeclaration {
  /** 1-based section ordinal the subtype was declared in. */
  readonly sectionIndex: number;
  /** Header text exactly as written, kept so a subtype is traceable even without a `PName`. */
  readonly headerRaw: string;
  /**
   * The `[Subtype]` header line itself — the line `headerRaw` was read from (§4.1).
   *
   * Separate from `span` on purpose, and the two must not be swapped. `span` anchors the semantic
   * finding at the most specific line the file actually contains (the `PName` line when there is
   * one), while any record that *quotes* `headerRaw` — the `unsupported` evidence in
   * `src/validate/` — has to point at the line that text occupies. One span cannot do both without
   * claiming the header text sits on the `PName` line (§4.2, §12 rules 3–4).
   */
  readonly headerSpan: Span;
  /** `PName` with escapes applied — the spelling the file used; `null` when it declares none. */
  readonly pname: string | null;
  /** Every `PName` line in file order: more than one is a duplicate key, and all are kept (§4.2). */
  readonly pnameSpans: readonly Span[];
  /** `SharedMode` verbatim: untyped in the specification, so it is never coerced to a number. */
  readonly sharedMode: SubtypeScalar<string>;
  /** `CompleteCategory` verbatim, for the same reason. */
  readonly completeCategory: SubtypeScalar<string>;
  /** Every `Position` occurrence, verbatim; an unusable shape is kept, not dropped. */
  readonly positions: readonly DecodedPosition[];
  /** `ZOrder`, decoded by the stage's strict integer rule (`null` when absent or unusable). */
  readonly zOrder: SubtypeScalar<number>;
  /** Always `unsupported`; see `SubtypeMembership`. */
  readonly membership: SubtypeMembership;
  /** Keys this section does not define, preserved raw with their own spans (§4.3). */
  readonly unknownEntries: readonly RawEntry[];
  /**
   * The line this subtype's finding points at: its `PName` line, else `headerSpan` (§4.1's "one
   * line, the most specific one the file contains", the convention `required.ts` uses).
   */
  readonly span: Span;
}

export interface SubtypeResult {
  /** Every `[Subtype]` of the document, in file order. One record per section, none merged. */
  readonly subtypes: readonly SubtypeDeclaration[];
}

/**
 * Membership's answer, which never varies with the file (F7).
 *
 * A builder rather than a shared constant: every record owns its own object, so a consumer that
 * mutated one result could not silently change what the next derivation reports.
 */
function membershipOf(): SubtypeMembership {
  return { status: 'unsupported', reason: 'no-membership-key-in-v2.21' };
}

/** Every parsed occurrence of one key in a section, in file order. */
function occurrencesOf(section: ClassifiedSection, key: string): KeyOccurrence[] {
  return section.entries.flatMap((entry) =>
    entry.kind === 'parsed' && entry.occurrence.spec.key === key ? [entry.occurrence] : [],
  );
}

/**
 * The `[Subtype]` header as a single-line span.
 *
 * `ClassifiedSection.span` is the section's extent, and the scanner guarantees its `keyLine` is the
 * header line (§4.1), so the one-line span is derived rather than stored twice. The same shape
 * `required.ts` uses for a section-level finding — `headerRaw`, this span and the semantic `span`
 * then all describe the line the file actually wrote.
 */
function headerSpanOf(section: ClassifiedSection): Span {
  return {
    sectionIndex: section.index,
    startLine: section.span.keyLine,
    endLine: section.span.keyLine,
    keyLine: section.span.keyLine,
  };
}

/**
 * The line a subtype reports on: its `PName` line, else the `[Subtype]` header.
 *
 * The same convention `required.ts` uses for a missing key — one line, the most specific one the
 * file actually contains. This is the *finding* anchor; `headerSpanOf` is the *text* anchor.
 */
function reportSpanOf(section: ClassifiedSection, pnameSpans: readonly Span[]): Span {
  return pnameSpans.at(-1) ?? headerSpanOf(section);
}

/** Absent, declared or unreadable — never a default, because v2.21 states none for these keys. */
function absentScalar<T>(): SubtypeScalar<T> {
  return { value: null, raw: null, span: null, token: 'absent' };
}

/**
 * Read one scalar key with the last occurrence winning (§4.2), keeping the token when it fails.
 *
 * `text` extracts the value from a decoded occurrence and returns `null` for a token its type could
 * not read; the raw text and the span survive in every case, so a malformed value is still visible
 * as itself and cannot be mistaken for an absent one (R26's rule: last-wins means last, even when
 * the last one is broken).
 */
function scalarOf<T>(
  section: ClassifiedSection,
  key: string,
  text: (value: unknown) => T | null,
): SubtypeScalar<T> {
  const last = occurrencesOf(section, key).at(-1);
  if (last === undefined) return absentScalar<T>();
  const value = last.decoded.ok ? text(last.decoded.value.value) : null;
  if (value === null) return { value: null, raw: last.raw, span: last.span, token: 'unrecognised' };
  return { value, raw: last.raw, span: last.span, token: 'declared' };
}

/** The string a decoded token carries, or `null` when it is not a string. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The integer a decoded token carries, or `null` when it is not a safe integer. */
function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** One `[Subtype]` section as a record. */
function subtypeOf(section: ClassifiedSection): SubtypeDeclaration {
  const pnameOccurrences = occurrencesOf(section, 'PName');
  const pnameSpans = pnameOccurrences.flatMap((occurrence) =>
    occurrence.span === null ? [] : [occurrence.span],
  );
  const pnameScalar = scalarOf(section, 'PName', asString);

  return {
    sectionIndex: section.index,
    headerRaw: section.headerRaw,
    headerSpan: headerSpanOf(section),
    pname: pnameScalar.value,
    pnameSpans,
    sharedMode: scalarOf(section, 'SharedMode', asString),
    completeCategory: scalarOf(section, 'CompleteCategory', asString),
    positions: [...section.decoded.positions],
    zOrder: scalarOf(section, 'ZOrder', asInteger),
    membership: membershipOf(),
    unknownEntries: section.entries.flatMap((entry) =>
      entry.kind === 'preserved' ? [entry.entry] : [],
    ),
    span: reportSpanOf(section, pnameSpans),
  };
}

/**
 * Every subtype of the document, with its unsupported membership.
 *
 * One record per `[Subtype]` section, in file order. A section with no `PName` is still a subtype —
 * the absent name is a `V_MISSING_REQUIRED_KEY` finding, not a reason to drop the object.
 *
 * Pure: reads the classification, allocates its own records, mutates nothing.
 */
export function subtypesOf(classification: Classification): SubtypeResult {
  const subtypes: SubtypeDeclaration[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Subtype') continue;
    subtypes.push(subtypeOf(section));
  }
  return { subtypes };
}
