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
 * 4. **Ranges are checked, not assumed.** Every numeric field read from `scan.accounting` and every
 *    numeric field published must be a non-negative safe integer, and the two aggregates are
 *    computed with checked arithmetic. A value outside that range is never clamped, rounded or
 *    substituted into a plausible-looking figure: it throws `ResourceMeasureError`, naming the
 *    field or the operation that failed. The check covers ranges only — what it cannot establish is
 *    listed in `ResourceCounters`.
 *
 * Purity: the scan is read, never modified; the result is new and flat. No filesystem, process,
 * clock, environment or V8 heap figure is consulted, no parser or decoder is re-implemented, and
 * the same scan yields the same result. One pass over the sections and every section entry,
 * `O(S+E)` with `S` sections and `E` key plus raw-line entries, with a fixed-size group of
 * counters and no input-proportional intermediate array.
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
 * non-negative safe integer: a numeric input outside that range, or a product or sum that leaves it.
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
  for (const term of terms) {
    total += checkedCount(term, field);
    if (!Number.isSafeInteger(total)) {
      throw new ResourceMeasureError(`${field} exceeds the safe-integer range`);
    }
  }
  return total;
}

/**
 * §13's totals plus the structural occurrences a line scan settles exactly.
 *
 * Every numeric member is a non-negative integer produced by a length or a count, and `measure()`
 * checks that at runtime: on a clean return every numeric field is a non-negative safe integer, and
 * a value outside that range is rejected before a result is published.
 *
 * **What the range check guarantees.** Every numeric field read from `scan.accounting`, every
 * count derived from the sections, and the two aggregates are non-negative safe integers; the
 * product and the sum behind the bounds use checked arithmetic, so an over-range aggregate throws
 * instead of being returned rounded. **What it does not guarantee:**
 *
 * - **Logical correctness.** Reconciliation, the line partition and `dropped` are the scanner's
 *   contract (§13); `measure()` reuses `accounting` and never produces a second opinion.
 * - **Provenance.** The check is about numbers, not about who produced them: a hand-built scan, a
 *   scan from a larger custom limit, or an internally inconsistent `accounting` with in-range
 *   numbers is measured like any other.
 * - **Safety after the call.** `accounting` is returned **by reference**, so a caller that mutates
 *   the scan or its `accounting` during or after measuring leaves this contract behind. No copy or
 *   deep freeze is added, and no post-return mutation safety is promised.
 * - **Load and size.** Nothing here estimates the unknown-key-heavy load, the diagnostics or JSON
 *   size, the heap or the RSS, and nothing here prevents an out-of-memory abort (F-4).
 *
 * A consistent scan from the default read limits (`maxLines` 2,000,000, `maxLineLength` 4 MiB,
 * §10.2) keeps every counter and both bounds far below `Number.MAX_SAFE_INTEGER` (see the bound
 * docs for the figures); the runtime check exists so that an inconsistent one is not silently
 * measured as if it were. Figures derived from the runtime's own string-length limits are
 * environment-specific and are not treated as a universal guarantee.
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
 * The walk covers whatever the returned object actually carries, including a `sectionsByKind` key a
 * hand-built scan invented, and every leaf must be a number: a missing field or a substituted
 * string is a contract violation too. The aggregates were already checked where they were computed;
 * this is the gate that makes "the returned object carries only non-negative safe integers" true of
 * the object that is returned, not only of the parts validated on the way in.
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
 * The numbers that come in and the numbers that go out are range-checked: every numeric field of
 * `scan.accounting` is read through `checkedCount()`, the two aggregates use `checkedProduct()` and
 * `checkedSum()`, and the finished counters and bounds are checked once more before they are
 * returned. A value that is not a non-negative safe integer throws `ResourceMeasureError` — there
 * is no clamp, no rounding and no fail-open path, because a bound that lost precision is not a
 * bound. Normal scans are unaffected: the check is a handful of comparisons per call.
 */
export function measure(scan: SyntaxScan): ResourceMeasure {
  // §13's numbers are checked on the way in — every numeric field, not only the seven this
  // measurement publishes — and the published counters are the checked values, never a second read.
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

  for (const section of scan.sections) {
    sectionsByKind[section.kind] += 1;

    if (section.kind === 'Entity') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        // Exact key text: a ` Field` or `Field ` line is a different key, exactly as the registry
        // reads it, and is preserved as an unknown key rather than counted here.
        if (entry.key === 'Field') entityFieldOccurrences += 1;
        else if (entry.key === 'UsingCommonColumns') entityUsingCommonColumnsOccurrences += 1;
      }
    } else if (section.kind === 'Manager') {
      for (const entry of section.entries) {
        if (entry.kind === 'key' && entry.key === 'CommonField') managerCommonFieldOccurrences += 1;
      }
    } else if (section.kind === 'Relation') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        if (entry.key === 'Fields1') {
          relationFields1Occurrences += 1;
          fields1ValueCodeUnits += entry.value.length;
        } else if (entry.key === 'Fields2') {
          relationFields2Occurrences += 1;
          fields2ValueCodeUnits += entry.value.length;
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
