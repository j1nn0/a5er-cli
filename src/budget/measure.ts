/**
 * Deterministic structural measurement of one finished scan (F4; `architecture.md` §13).
 *
 * F4 asks how much work a document is allowed to make the pipeline do. Before any admission
 * decision can exist, the numbers such a decision would rest on have to be measurable,
 * reproducible and honest about what they are — and this module is that and nothing else. It
 * publishes **structural counters** (facts a line scan settles) and **two conservative upper
 * bounds**, and it decides nothing: no weights, no thresholds, no refusal, no diagnostics, no CLI
 * output. Calibration is a separate decision that needs measurements first.
 *
 * Four rules make the numbers usable:
 *
 * 1. **Nothing is re-counted.** Lines, sections, keys, comments, blanks, raw lines and the
 *    unknown-section split are §13's reconciliation, and `scan.accounting` already carries it.
 *    This module reuses that object **by reference** and never walks the records to produce a
 *    second opinion: a counter that disagreed with §13 would be a second bookkeeping path, which
 *    is exactly what §13 forbids.
 * 2. **Occurrences, not verdicts.** `entityFieldOccurrences` counts `Field=` lines inside
 *    `[Entity]` sections; it does not claim they decode and it is not a column count. The scan
 *    settles lines and headers only, so any decoded, adopted or resolved figure would be a guess
 *    here (§4.2's provenance rules). Key names and values are compared **as written**, because the
 *    registry looks keys up as written: no trimming, no case folding, no normalisation.
 * 3. **Kind, never name.** `[Relationship]` is a spelling of `Relation` (§5), so it counts as a
 *    relation section and its `Fields1`/`Fields2` lines count like any other; `[entity]` is
 *    `unknown`, so its keys count as unknown-section keys. Counting by header name would miss the
 *    alias and invent a second kind (`txt-02`, `txt-07`).
 * 4. **Ranges and value types are checked, not assumed.** Every declared numeric field read from
 *    `scan.accounting`, every published counter and bound, every section kind and every
 *    `Fields1`/`Fields2` value is checked at runtime: a number must be a non-negative safe integer,
 *    a kind must be one of the nine declared kinds, and a relation value must be a string. A
 *    violation is never clamped, rounded or substituted into a plausible-looking figure — it throws
 *    `ResourceMeasureError`, naming the field or the operation at fault and never the offending
 *    value. The check covers ranges and value types only: an extra `accounting` property, a
 *    logically inconsistent scan and a getter's side effects are outside it (see
 *    `ResourceCounters`).
 *
 * Purity: the scan is read, never modified; the result is new and flat. No filesystem, process,
 * clock, environment or V8 heap figure is consulted, no parser or decoder is re-implemented, and
 * the same scan yields the same result. One pass over the sections and every section entry,
 * `O(S+E+ΣL)` with `S` sections, `E` key plus raw-line entries and `ΣL` the UTF-16 code units of
 * the `Fields1`/`Fields2` values, which are also walked once — character by character, allocating no
 * list — with a fixed-size group of counters and no input-proportional intermediate array.
 *
 * Not to be confused with `src/text/tables.ts`, which has a private `measure(rows)` that measures
 * **column widths** for the `tables` renderer. Same word, unrelated job; this module never widens a
 * column.
 */

import type { SyntaxAccounting, SyntaxScan } from '../syntax/scanner.js';
import type { SectionKind } from '../syntax/sections.js';

/**
 * The internal-contract violation `measure()` reports.
 *
 * `measure()` throws this, and only this, when a figure it would publish cannot be proven to be a
 * non-negative safe integer — a numeric input outside that range, a product or sum that leaves it,
 * or a value whose type makes it unmeasurable (a section kind outside the nine declared ones, a
 * `Fields1`/`Fields2` value that is not a string).
 * It is not a finding about the document — under the default read limits no `.a5er` input reaches
 * it — and nothing here turns it into a CLI refusal, a diagnostic or an exit code; admission is a
 * separate decision that has not been made.
 *
 * The contract, in full:
 *
 * 1. `instanceof ResourceMeasureError`, `instanceof Error`, and `name === 'ResourceMeasureError'`.
 * 2. The message is deterministic: the same violation yields the same bytes, with no clock, random
 *    value, heap figure or environment in it.
 * 3. It names the field or the operation that failed — `accounting.lines.total`,
 *    `bounds.composedColumnsUpperBound.upperBound` — so the defect is locatable without a
 *    debugger.
 * 4. It never contains the document's text, a key, a value or anything derived from the input body;
 *    a field name and one fixed reason are all it says.
 * 5. It means "correctness cannot be proven", never "the input is refused": no clamp, saturation,
 *    `Infinity`, `NaN`, substitution or fail-open path returns a rounded figure instead.
 * 6. `measure()` keeps its signature and its return type, and the normal path is unchanged.
 */
export class ResourceMeasureError extends Error {
  /** Build the error from a reason that names a field or an operation, never from input bytes. */
  constructor(reason: string) {
    super(`measure(): ${reason}`);
    this.name = 'ResourceMeasureError';
  }
}

/**
 * `value` when it is a non-negative safe integer, else a `ResourceMeasureError` naming `field`.
 *
 * Total by design: a negative number, a fraction, `NaN`, `±Infinity`, `2**53` and a non-number all
 * fail, and none of them is rounded or substituted. The check is a range check — it says nothing
 * about whether the number means anything (see `ResourceCounters`).
 */
function checkedCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ResourceMeasureError(`${field} is not a non-negative safe integer`);
  }
  return value;
}

/**
 * The product of two non-negative safe integers, else a `ResourceMeasureError` naming `field`.
 *
 * The check is exact, not a tolerance: for integers below `2**53` a product is represented exactly,
 * so a result that passes is the true product, while a true product at or past `2**53` cannot be a
 * safe integer and is rejected. Nothing is clamped or saturated — an upper bound that lost
 * precision is no longer an upper bound. Exported for the boundary tests only; `index.ts` does not
 * re-export it.
 */
export function checkedProduct(left: number, right: number, field: string): number {
  const product =
    checkedCount(left, `${field} (factor)`) * checkedCount(right, `${field} (factor)`);
  if (!Number.isSafeInteger(product)) {
    throw new ResourceMeasureError(`${field} exceeds the safe-integer range`);
  }
  return product;
}

/**
 * The sum of non-negative safe integers, else a `ResourceMeasureError` naming `field`.
 *
 * Every term is checked on the way in and the running total is checked after each addition: the
 * terms are non-negative, so a total can only grow, and once it leaves the safe range no later
 * term can bring it back. Exported for the boundary tests only; `index.ts` does not re-export it.
 */
export function checkedSum(terms: readonly number[], field: string): number {
  let total = 0;
  for (const term of terms) total = checkedAdded(total, term, field);
  return total;
}

/**
 * `total + addend` when both are non-negative safe integers and the sum is one too, else a
 * `ResourceMeasureError` naming `field`.
 *
 * The running form of `checkedSum()`'s rule, for an accumulator that receives its terms one at a
 * time: collecting them in an array first would make the extra memory grow with the input, which
 * the Σ`L²` counter (one term per relation value) must not do. Both forms share this check, so a
 * running total cannot be validated more weakly than a batch sum.
 */
function checkedAdded(total: number, addend: number, field: string): number {
  const sum = checkedCount(total, field) + checkedCount(addend, field);
  if (!Number.isSafeInteger(sum)) {
    throw new ResourceMeasureError(`${field} exceeds the safe-integer range`);
  }
  return sum;
}

/** `total + length²`, with the factor, the product, the addend and the running total all checked. */
function addValueSquare(total: number, length: number): number {
  const field = 'counters.relationValueLengthSquares';
  return checkedAdded(total, checkedProduct(length, length, field), field);
}

/**
 * The relation columns one raw `Fields1`/`Fields2` value declares: `1 + its literal commas`.
 *
 * A character scan, not `split(',').length`: splitting would allocate an array and one substring per
 * column, and this figure is read for every relation value of every document. The caller has already
 * proven the value is a string (`checkedValueLength`), so no type check is repeated here.
 */
function relationColumnsOfValue(value: string): number {
  let columns = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x2c) columns += 1;
  }
  return columns;
}

/** `total + the relation columns one raw value declares`, the running total checked after the add. */
function addRelationColumns(total: number, value: string): number {
  return checkedAdded(
    total,
    relationColumnsOfValue(value),
    'counters.relationColumnCountUpperBound',
  );
}

/**
 * The nine declared section kinds, as an own-property table for the runtime input check.
 *
 * A null prototype and `Object.hasOwn()` are the point: `__proto__`, `constructor`, `toString` and
 * every other name a prototype could offer are *inherited*, not own, so they are rejected instead of
 * being counted — or coerced into a property name, or (for a symbol) added as a key that
 * `Object.entries` would never see. `Record<SectionKind, true>` makes the compiler reject a table
 * that misses or invents a kind, so it cannot drift from the type. Built once, frozen.
 */
const DECLARED_SECTION_KINDS: Readonly<Record<SectionKind, true>> = Object.freeze(
  Object.assign(Object.create(null) as Record<SectionKind, true>, {
    Manager: true,
    Entity: true,
    Relation: true,
    View: true,
    Subtype: true,
    Shape: true,
    Line: true,
    Comment: true,
    unknown: true,
  }),
);

/**
 * `kind` when it is one of the nine declared section kinds, else a `ResourceMeasureError`.
 *
 * The test is `typeof kind === 'string'` plus own-property membership, so a symbol, a number, `null`
 * and an object are refused without being coerced, and a prototype name is not mistaken for a
 * declared kind. The message is fixed: the kind is never echoed, because a hand-built scan can put
 * anything there and it may be file-derived text.
 */
function assertSectionKind(kind: unknown): SectionKind {
  if (typeof kind !== 'string' || !Object.hasOwn(DECLARED_SECTION_KINDS, kind)) {
    throw new ResourceMeasureError('counters.sectionsByKind has an unrecognised section kind');
  }
  return kind as SectionKind;
}

/**
 * The code-unit length of a `Fields1`/`Fields2` value, else a `ResourceMeasureError` naming `field`.
 *
 * A hand-built scan can put anything under `value`, and reading `.length` off it is not safe: a
 * negative or fractional `length` could cancel a real one and leave a healthy-looking bound. Only a
 * real string is measured, and no part of the value is echoed — it can be file text.
 */
function checkedValueLength(value: unknown, field: string): number {
  if (typeof value !== 'string') {
    throw new ResourceMeasureError(`${field} has a non-string value`);
  }
  return value.length;
}

/**
 * §13's totals plus the structural occurrences a line scan settles exactly.
 *
 * Every numeric member is a non-negative integer produced by a length or a count.
 *
 * **What the range check guarantees.** On a clean return these four populations are non-negative
 * safe integers:
 *
 * 1. every declared `ResourceCounters` number below;
 * 2. every declared `ResourceBounds` number (see that type);
 * 3. the 14 declared numeric fields of `SyntaxAccounting`, as they were when `measure()` read them;
 * 4. every length taken from a normal string value — a `Fields1`/`Fields2` value that is not a
 *    string, and a section kind outside the nine declared ones, are refused before they are
 *    counted — plus both aggregates, which use checked arithmetic.
 *
 * **What it does not guarantee:**
 *
 * - **Extra accounting properties.** Only the 14 declared fields are read and checked. An extra
 *   property — top-level or nested, even one holding `NaN` — is carried through untouched and sits
 *   outside this contract: `measure()` neither validates it nor rejects it.
 * - **Logical consistency.** Reconciliation, the line partition and `dropped` are the scanner's
 *   contract (§13). A **range violation is detected** and throws `ResourceMeasureError`; a
 *   range-valid but internally **inconsistent** `accounting` is not inspected here, produces no
 *   error, and is measured as it stands.
 * - **Provenance.** The check is about numbers and value types, not about who produced them: a
 *   hand-built scan or a scan from a larger custom limit with in-range numbers is measured like
 *   any other.
 * - **Getter side effects.** Each declared field is read once, in a fixed order; a property
 *   implemented as a getter runs its own code during that read, and `measure()` neither forbids nor
 *   analyses that.
 * - **Mutation during or after the call.** `accounting` is returned **by reference**, so a caller
 *   that mutates the scan or its `accounting` while the call runs (through a getter or a proxy) or
 *   after it returns leaves this contract behind. No copy or deep freeze is added, and no
 *   post-return mutation safety is promised.
 * - **Load and size.** Nothing here estimates the unknown-key-heavy load, the diagnostics or JSON
 *   size, the heap or the RSS, and nothing here prevents an out-of-memory abort (F-4).
 *
 * A normal scan from the default read limits (`maxLines` 2,000,000, `maxLineLength` 4 MiB, §10.2)
 * keeps every counter and both bounds far below `Number.MAX_SAFE_INTEGER` (see the bound docs for
 * the figures); the runtime check exists so that an anomalous one is not silently measured as if it
 * were normal. Figures derived from the runtime's own string-length limits are environment-specific
 * and are not treated as a universal guarantee.
 */
export interface ResourceCounters {
  /** §13 `lines.total`: every physical line. Taken from `scan.accounting`, never recomputed. */
  readonly totalLines: number;
  /** §13 `sections.total`: every `[…]` header. From `scan.accounting`, never recomputed. */
  readonly totalSections: number;
  /** §13 `keys.total`: every `key=value` line. Taken from `scan.accounting`, never recomputed. */
  readonly totalKeys: number;
  /** §13 `lines.comments`: every `#` line. Taken from `scan.accounting`, never recomputed. */
  readonly totalComments: number;
  /** §13 `lines.blank`: every blank line. Taken from `scan.accounting`, never recomputed. */
  readonly totalBlankLines: number;
  /** §13 `lines.raw`: every raw line, the same set `S_MALFORMED_LINE` reports. */
  readonly totalRawLines: number;
  /** §13 `keys.inUnknownSections`: `key=value` lines in headers this project does not model. */
  readonly unknownSectionKeyOccurrences: number;
  /**
   * Section headers per canonical kind.
   *
   * `Relation` includes the `[Relationship]` spelling, and `unknown` includes every header outside
   * §5's list, including a wrong-case `[entity]`.
   */
  readonly sectionsByKind: Readonly<Record<SectionKind, number>>;
  /**
   * `Field=` lines inside `[Entity]` sections, in every such section, named or not.
   *
   * An occurrence, not a column: whether the line declares a usable field is the decoder's call.
   */
  readonly entityFieldOccurrences: number;
  /**
   * `CommonField=` lines inside `[Manager]` sections, in every such section.
   *
   * An occurrence, not a declaration: it is the largest possible count of them (see the bound).
   */
  readonly managerCommonFieldOccurrences: number;
  /**
   * `Fields1=` lines inside relation sections — `[Relation]` and `[Relationship]` alike.
   *
   * An occurrence, not a column: one line can declare several columns or none.
   */
  readonly relationFields1Occurrences: number;
  /**
   * `Fields2=` lines inside relation sections — `[Relation]` and `[Relationship]` alike.
   *
   * An occurrence, not a column: one line can declare several columns or none.
   */
  readonly relationFields2Occurrences: number;
  /** `UsingCommonColumns=` lines inside `[Entity]` sections, whatever their value says. */
  readonly entityUsingCommonColumnsOccurrences: number;
  /** UTF-16 code units of the raw `Fields1` value text, quoting and escapes included. */
  readonly fields1ValueCodeUnits: number;
  /** UTF-16 code units of the raw `Fields2` value text, quoting and escapes included. */
  readonly fields2ValueCodeUnits: number;
  /**
   * Σ `L²` over every `Fields1`/`Fields2` key occurrence in relation sections, `L` being the raw
   * value text's UTF-16 code-unit length — the same text `fields1ValueCodeUnits` and
   * `fields2ValueCodeUnits` sum, quoting and escapes included.
   *
   * `[Relationship]` counts as `Relation`, every duplicate key counts once per occurrence, a value
   * with no text at all (`Fields1=`) adds `0`, and a `Fields1`/`Fields2` line in any other section
   * — a recognised one or an unknown one — adds nothing.
   *
   * **A proxy, not a bound.** It exists to expose one quadratic amplification observed in
   * `inspect`/`validate`: a single value can describe a list whose work grows with its length, so
   * the work one value can provoke grows with `L²`, while the code-unit counters above only sum
   * `L`. It is deliberately **not** an upper bound on the bytes, the heap or the RSS that any output
   * can cost — a large Σ`L²` with small real amplification is possible, and a small Σ`L²` says
   * nothing about the rest of the document. Admission, weights and thresholds are separate
   * decisions that have not been made.
   */
  readonly relationValueLengthSquares: number;
  /**
   * Σ over every `Fields1`/`Fields2` key occurrence in a relation section of 1 + the number of
   * literal commas in the raw value text, quoting and escapes included.
   *
   * `[Relationship]` counts as `Relation`, every duplicate key counts once per occurrence, a value
   * with no text at all (`Fields1=`) adds `1`, and a `Fields1`/`Fields2` line in any other section
   * adds nothing.
   *
   * **An upper bound on the columns the relation stage retains, not a promise of equality.** The
   * element splitter yields one slice per comma outside quotes plus a final one, `readPart` maps each
   * slice to exactly one part, and `columnsOf` turns each kept part into `commas + 1` columns
   * (`src/semantic/relations.ts:188-193`), so one value declares exactly `1 + its literal commas`
   * columns. On top of that the figure over-counts, always in the safe direction: an occurrence that
   * `columnsOf` never reads (a later duplicate replaces it, it has no span, it fails to decode) is
   * still counted in full, and a value whose trailing element is omitted contributes the one column
   * that `columnsOf` drops. Equality therefore holds only where no `Fields1`/`Fields2` occurrence is
   * replaced by a duplicate and no trailing element is omitted; the figure is never *below* the
   * retained count.
   *
   * **The maintenance obligation.** That soundness depends on the grammar `columnsOf` implements:
   * every literal comma outside double quotes becomes a column boundary, and no other separator
   * exists. A change that adds a separator, CSV-style `""` doubling or any path by which a comma
   * reaches a part's text from somewhere other than the raw value must re-derive this figure in the
   * same change; the counter mirrors a grammar, not a measurement of its own.
   *
   * **Range.** Per value `commas + 1 ≤ L + 1 ≤ maxLineLength + 1` (4,194,305), and the running total
   * is at most `occurrences × (maxLineLength + 1) ≤ 2,000,000 × 4,194,305 ≈ 8.4·10¹²`, far below
   * `Number.MAX_SAFE_INTEGER`. It is accumulated through `checkedAdded()`, so an anomalous scan throws
   * `ResourceMeasureError` instead of publishing a rounded figure.
   *
   * **Not an output-size bound.** It bounds the retained column records and the column-driven
   * diagnostics of the relation path, not the bytes they hold, the heap behind them or the whole
   * `tables` output: endpoint and required-key findings are linear in the relation count and are
   * bounded by the pre-scan content-line ceiling instead (`architecture.md` §10.5).
   */
  readonly relationColumnCountUpperBound: number;
}

/**
 * Upper bound on the common columns every entity's effective list can adopt, with its two factors.
 *
 * An entity composes the document's decoded `CommonField` declarations when its
 * `UsingCommonColumns` resolves to `1`, and nothing otherwise, so the total across all entities is
 * at most `[Entity] section count × decoded declaration count`. The scan cannot decode, so the
 * second factor is replaced by the number of `CommonField=` lines, which is at least as large:
 * an occurrence that fails to decode only shrinks the real count.
 *
 * **Range check, not a provenance check.** Both factors and the product are verified at runtime:
 * each must be a non-negative safe integer and so must the product, or `measure()` throws
 * `ResourceMeasureError` instead of publishing a figure it cannot prove. Because this is an *upper*
 * bound the product is deliberately **not** clamped: `Math.min(MAX_SAFE_INTEGER, …)` would silently
 * turn an over-estimate into an under-estimate, and a product past the safe-integer range can lose
 * precision and round *down*, so a clamped product would no longer bound anything. A consistent
 * scan from input accepted under the default read limits (`maxLines` 2,000,000, `maxLineLength`
 * 4 MiB, §10.2) has both factors at most `2·10⁶` and a product at most `4·10¹²` — three orders
 * below `Number.MAX_SAFE_INTEGER`. The check says nothing about whether the scan came from that
 * scope; a future admission check must establish the scan's provenance and the limits before
 * comparing (U3 design).
 */
export interface ComposedColumnsUpperBound {
  /** `[Entity]` sections the scan holds: each one composes a list, with or without a `PName`. */
  readonly entitySections: number;
  /** `CommonField=` lines in `[Manager]` sections: at least the declarations that can decode. */
  readonly managerCommonFieldOccurrences: number;
  /** The product of the two factors above, unclamped and checked to be a safe integer. */
  readonly upperBound: number;
}

/** Conservative bounds derived from the counters; each is an over-estimate by construction, checked to be a safe integer. */
export interface ResourceBounds {
  /** Upper bound on the common columns all entities together can adopt. */
  readonly composedColumnsUpperBound: ComposedColumnsUpperBound;
  /**
   * Upper bound on the `Fields1`/`Fields2` slots the relation stage can list, both sides together.
   *
   * A Complex value of raw length `L` holds at most `L + 1` comma-separated slots (each separator
   * is one character of the raw text), summed over every such line in every relation section. The
   * sum is an over-estimate on purpose: it counts every occurrence, while the stage keeps one list
   * per key and may drop a trailing blank slot.
   */
  readonly relationColumnSlotsUpperBound: number;
}

/** One deterministic measurement of one scan. */
export interface ResourceMeasure {
  readonly counters: ResourceCounters;
  readonly bounds: ResourceBounds;
  /** The scan's §13 object, the same reference: the `total*` counters above are its fields.
   * TypeScript `readonly` is not a runtime freeze — a caller that mutates the scan during or after
   * measuring leaves the documented scope. No copy or deep freeze is added. */
  readonly accounting: SyntaxAccounting;
}

/**
 * Check every number the result publishes, naming the field that failed.
 *
 * The walk covers every declared counter and bound, and every leaf must be a number: a missing field
 * or a substituted string is a contract violation too. The aggregates were already checked where
 * they were computed; this is the gate that makes "the counters and bounds carry only non-negative
 * safe integers" true of the object that is returned, not only of the parts validated on the way in.
 * It says nothing about `accounting`: that object is returned by reference and is not walked, so its
 * extra properties are outside the contract (see `ResourceCounters`).
 */
function assertPublishedNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    checkedCount(value, path);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    throw new ResourceMeasureError(`${path} is not a number`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertPublishedNumbers(child, `${path}.${key}`);
  }
}

/**
 * Measure one scan.
 *
 * Returns a new record; the scan, its sections and its entries are only read. See the module
 * comment for why every figure here is a structural fact or a documented upper bound.
 *
 * numeric field of `scan.accounting` is read through `checkedCount()`, every section kind and every
 * `Fields1`/`Fields2` value is checked before it is counted, the two bound aggregates use
 * `checkedProduct()` and `checkedSum()`, the relation-column count and Σ`L²` are accumulated with the
 * same `checkedAdded()` rule, and the finished counters and bounds are checked once more before they
 * are returned.
 * before they are returned. A value that is not a non-negative safe integer — or that has the wrong
 * type for the field it feeds — throws `ResourceMeasureError`; there is no clamp, no rounding and no
 * fail-open path, because a bound that lost precision is not a bound. Normal scans are unaffected:
 * the check is a handful of comparisons per call, and extra `accounting` properties are neither read
 * nor rejected.
 */
export function measure(scan: SyntaxScan): ResourceMeasure {
  // §13's declared numbers are checked on the way in — all 14, not only the seven this measurement
  // publishes — and the published counters are the checked values, never a second read. Extra
  // properties are not read at all, so they can neither fail the check nor change its result.
  const accounting = scan.accounting;
  checkedCount(accounting.lines.sectionHeaders, 'accounting.lines.sectionHeaders');
  checkedCount(accounting.lines.keys, 'accounting.lines.keys');
  checkedCount(accounting.sections.recognised, 'accounting.sections.recognised');
  checkedCount(accounting.sections.unknown, 'accounting.sections.unknown');
  checkedCount(accounting.keys.inRecognisedSections, 'accounting.keys.inRecognisedSections');
  checkedCount(accounting.keys.beforeFirstSection, 'accounting.keys.beforeFirstSection');
  checkedCount(accounting.dropped, 'accounting.dropped');

  const totalLines = checkedCount(accounting.lines.total, 'accounting.lines.total');
  const totalSections = checkedCount(accounting.sections.total, 'accounting.sections.total');
  const totalKeys = checkedCount(accounting.keys.total, 'accounting.keys.total');
  const totalComments = checkedCount(accounting.lines.comments, 'accounting.lines.comments');
  const totalBlankLines = checkedCount(accounting.lines.blank, 'accounting.lines.blank');
  const totalRawLines = checkedCount(accounting.lines.raw, 'accounting.lines.raw');
  const unknownSectionKeyOccurrences = checkedCount(
    accounting.keys.inUnknownSections,
    'accounting.keys.inUnknownSections',
  );

  const sectionsByKind: Record<SectionKind, number> = {
    Manager: 0,
    Entity: 0,
    Relation: 0,
    View: 0,
    Subtype: 0,
    Shape: 0,
    Line: 0,
    Comment: 0,
    unknown: 0,
  };

  let entityFieldOccurrences = 0;
  let managerCommonFieldOccurrences = 0;
  let relationFields1Occurrences = 0;
  let relationFields2Occurrences = 0;
  let entityUsingCommonColumnsOccurrences = 0;
  let fields1ValueCodeUnits = 0;
  let fields2ValueCodeUnits = 0;
  let relationValueLengthSquares = 0;
  let relationColumnCountUpperBound = 0;

  for (const section of scan.sections) {
    // The kind is checked before it is written: an undeclared one would otherwise create a NaN
    // entry under a name the counters do not declare — invisible to `Object.entries` when it is a
    // symbol, or coerced out of a prototype when it is `__proto__`.
    const kind = assertSectionKind(section.kind);
    sectionsByKind[kind] += 1;

    if (kind === 'Entity') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        // Exact key text: a ` Field` or `Field ` line is a different key, exactly as the registry
        // reads it, and is preserved as an unknown key rather than counted here.
        if (entry.key === 'Field') entityFieldOccurrences += 1;
        else if (entry.key === 'UsingCommonColumns') entityUsingCommonColumnsOccurrences += 1;
      }
    } else if (kind === 'Manager') {
      for (const entry of section.entries) {
        if (entry.kind === 'key' && entry.key === 'CommonField') managerCommonFieldOccurrences += 1;
      }
    } else if (kind === 'Relation') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        if (entry.key === 'Fields1') {
          // The length is added only after the value is proven to be a string: a hand-built
          // `{ length: -1 }` would otherwise cancel a real length into a healthy-looking bound.
          const length = checkedValueLength(entry.value, 'counters.fields1ValueCodeUnits');
          fields1ValueCodeUnits += length;
          relationFields1Occurrences += 1;
          // ΣL² is accumulated one value at a time: no list of squares is built, so the extra
          // memory stays constant however many relation values the scan holds.
          relationValueLengthSquares = addValueSquare(relationValueLengthSquares, length);
          // The same value feeds the column count, character by character: no split array.
          relationColumnCountUpperBound = addRelationColumns(
            relationColumnCountUpperBound,
            entry.value,
          );
        } else if (entry.key === 'Fields2') {
          const length = checkedValueLength(entry.value, 'counters.fields2ValueCodeUnits');
          fields2ValueCodeUnits += length;
          relationFields2Occurrences += 1;
          relationValueLengthSquares = addValueSquare(relationValueLengthSquares, length);
          relationColumnCountUpperBound = addRelationColumns(
            relationColumnCountUpperBound,
            entry.value,
          );
        }
      }
    }
  }

  const entitySections = sectionsByKind.Entity;

  // The two aggregates are computed with checked arithmetic: a product or sum that leaves the
  // safe-integer range throws instead of being published rounded. Neither is clamped — a clamped
  // upper bound is no longer an upper bound (see `ComposedColumnsUpperBound`).
  const composedColumnsUpperBound: ComposedColumnsUpperBound = {
    entitySections,
    managerCommonFieldOccurrences,
    upperBound: checkedProduct(
      entitySections,
      managerCommonFieldOccurrences,
      'bounds.composedColumnsUpperBound.upperBound',
    ),
  };
  // Σ(raw length + 1) over every `Fields1`/`Fields2` occurrence = Σ length + Σ 1.
  const relationColumnSlotsUpperBound = checkedSum(
    [
      fields1ValueCodeUnits,
      relationFields1Occurrences,
      fields2ValueCodeUnits,
      relationFields2Occurrences,
    ],
    'bounds.relationColumnSlotsUpperBound',
  );

  const result: ResourceMeasure = {
    counters: {
      totalLines,
      totalSections,
      totalKeys,
      totalComments,
      totalBlankLines,
      totalRawLines,
      unknownSectionKeyOccurrences,
      sectionsByKind,
      entityFieldOccurrences,
      managerCommonFieldOccurrences,
      relationFields1Occurrences,
      relationFields2Occurrences,
      entityUsingCommonColumnsOccurrences,
      fields1ValueCodeUnits,
      fields2ValueCodeUnits,
      relationValueLengthSquares,
      relationColumnCountUpperBound,
    },
    bounds: { composedColumnsUpperBound, relationColumnSlotsUpperBound },
    accounting,
  };

  // The final gate: every number the object carries is checked, so "inside the safe range" is a
  // property of the returned object and not only of the parts that were validated on the way in.
  assertPublishedNumbers(result.counters, 'counters');
  assertPublishedNumbers(result.bounds, 'bounds');
  return result;
}
