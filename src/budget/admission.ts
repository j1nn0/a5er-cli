/**
 * Admission: the one decision `src/budget/` makes about one measurement (F4, U5-ADMIT1).
 *
 * `measure()` answers *what the document would cost to finish*. This module answers *whether this
 * composition is willing to pay it*, and nothing else: no diagnostic, no exit code, no I/O. The
 * caller (`src/pipeline.ts`) turns a refusal into the `E_LIMIT_BUDGET` fatal.
 *
 * **Two compositions, two profiles.** `inspect` and `validate` build one envelope string, then the
 * `tables` projection renders that record again — but the amplification is not the same, so the
 * ceilings are not either. The profile is a discriminated union rather than a set of numbers with a
 * switch that might be forgotten: `tables` has no `relationValueLengthSquares` member at all, so
 * "the tables profile does not cap Σ`L²`" is a property of the type and of the object, not a
 * comparison against `Number.MAX_SAFE_INTEGER` that a later edit could quietly turn back on.
 *
 * - **`envelope`** (`inspect`, `validate`): `relationValueLengthSquares` first (the relation-column
 *   amplification), then `composedColumnsUpperBound.upperBound` (the common-column composition).
 * - **`tables`**: `composedColumnsUpperBound.upperBound` only.
 *
 * **Two entry points, one rule.** `admit()` decides a finished `measure()`; `admitShape()` decides
 * the pre-scan figures `measureSourceShape()` counts, so a Field- or content-heavy document can be
 * refused before the scan allocates its records (U5-ADMIT2). Both compare `observed <= ceiling`,
 * both prove every figure they read before they compare any of them, and both resolve the budget
 * through `withResourceBudget()`, so there is one validation path and one comparison rule. The two
 * pre-scan figures are members of *both* profiles: the scan they protect runs for every command.
 *
 * **The rule is a comparison, not a policy.** `observed <= ceiling` admits; `observed > ceiling`
 * refuses. A figure *at* the ceiling is accepted, because the ceilings below were chosen as values
 * the tool is expected to finish under, not as an off-by-one on a measured cost. Nothing is clamped,
 * rounded or saturated on the way: a measurement that cannot be read as a non-negative safe integer,
 * or a ceiling that is not a positive safe integer, is a caller defect and throws
 * `ResourceAdmissionError` — it is never reported as a refusal, because a refusal is a statement
 * about a document and this tool cannot make one it does not have the numbers for.
 *
 * **The thresholds are tentative operational values.** They are not an RSS figure, a heap ceiling,
 * a heap-size fraction or a promise that a document below them fits in memory: a proxy cannot
 * bound memory (see `ResourceCounters.relationValueLengthSquares`), and the runtime's own limits are
 * environment-specific. They exist so that one pathological document is refused before a quadratic
 * stage runs, and they are expected to be revised with measured evidence; `Limits` (§10.2) is
 * deliberately *not* where they live, because that object is a byte and line contract the reader
 * enforces, not an estimate of downstream work.
 */

import type { SourceShape } from '../syntax/shape.js';
import type { ResourceMeasure } from './measure.js';

/** The two compositions that read a document, each with its own ceilings. */
export type BudgetProfile = 'envelope' | 'tables';

/**
 * The counters a budget can cap.
 *
 * Two of them are the figures `measure()` publishes after the scan — `relationValueLengthSquares`
 * (Σ`L²` over relation values) and `composedColumnsUpperBound` (`[Entity]` sections × decoded
 * `CommonField` declarations) — and two are the pre-scan figures `measureSourceShape()` counts
 * before the scan exists: `entityFieldOccurrences` (`Field=` lines in `[Entity]` sections) and
 * `contentLineOccurrences` (section headers, keys and raw lines together).
 *
 * Byte counts are already refused by `io/`/`decode/` and never appear here. Neither do total lines,
 * comments or blank lines: the read limits bound the input, and the pre-scan ceilings cap the two
 * figures a refused document is expensive *through*, not every line it happens to have.
 */
export type BudgetCounter =
  | 'relationValueLengthSquares'
  | 'composedColumnsUpperBound'
  | 'entityFieldOccurrences'
  | 'contentLineOccurrences';

/**
 * The ceilings `inspect` and `validate` apply: one envelope string is built from all four stages.
 *
 * All four figures are capped, in this order: Σ`L²` first, because it is the proxy for the relation
 * stage's amplification; then the composed-column bound, because a document can hold the first far
 * below its ceiling and still adopt an unreasonable number of common columns; then the two
 * pre-scan figures, which admission can read before the scan has built a single record.
 */
export interface EnvelopeResourceBudget {
  readonly profile: 'envelope';
  readonly relationValueLengthSquares: number;
  readonly composedColumnsUpperBound: number;
  readonly entityFieldOccurrences: number;
  readonly contentLineOccurrences: number;
}

/**
 * The ceilings `tables` applies: the common-column composition and the two pre-scan figures.
 *
 * Σ`L²` has no member here on purpose. `tables` renders a projection of the same record; the
 * relation-column amplification observed in `inspect`/`validate` is not part of its work, so capping
 * it would refuse documents this command can answer. That absence is structural: the type has no
 * such member, and `withResourceBudget()` never copies one in. The pre-scan figures *are* capped
 * here, at this profile's own values: the scan they protect runs for `tables` too.
 */
export interface TablesResourceBudget {
  readonly profile: 'tables';
  readonly composedColumnsUpperBound: number;
  readonly entityFieldOccurrences: number;
  readonly contentLineOccurrences: number;
}

/** One complete, profile-specific set of ceilings. */
export type ResourceBudget = EnvelopeResourceBudget | TablesResourceBudget;

/**
 * The ceilings this build applies, per profile.
 *
 * `134_217_728` (2²⁷) for Σ`L²` on the envelope profile: a document whose relation values average
 * one code unit each would need about 1.3·10⁸ of them, far past what `maxLines` allows, so reaching
 * it takes a handful of very long values. `524_288` (2¹⁹) composed columns for the envelope
 * profile, and `4_194_304` (2²²) for `tables`, which holds no relation text and therefore has the
 * stricter of its two costs removed.
 *
 * The two pre-scan ceilings are counts of lines a linear walk visits, so they are round numbers
 * rather than powers of two: `200_000` `Field=` occurrences and `400_000` content lines for the
 * envelope profile, `500_000` and `1_000_000` for `tables`. These four are the U5-ADMIT2
 * specification's approved values, recorded here as given — this module does not calibrate them.
 *
 * Every figure is a **tentative operational value**: not RSS, not a heap limit, not a bound on the
 * envelope string, and not a guarantee that a document below it is cheap. See the module comment.
 *
 * **Frozen at runtime, and frozen per profile.** `as const` is a compile-time claim about this
 * build's own literal; it does not stop the published object from being written to once the module
 * has loaded. Every level is therefore `Object.freeze()`d — the outer table and each profile object
 * — so the ceilings a running process compares against are the ones this file states, whatever a
 * caller does with the export.
 */
export const DEFAULT_RESOURCE_BUDGETS = Object.freeze({
  envelope: Object.freeze<EnvelopeResourceBudget>({
    profile: 'envelope',
    relationValueLengthSquares: 134_217_728,
    composedColumnsUpperBound: 524_288,
    entityFieldOccurrences: 200_000,
    contentLineOccurrences: 400_000,
  }),
  tables: Object.freeze<TablesResourceBudget>({
    profile: 'tables',
    composedColumnsUpperBound: 4_194_304,
    entityFieldOccurrences: 500_000,
    contentLineOccurrences: 1_000_000,
  }),
}) satisfies Readonly<Record<BudgetProfile, ResourceBudget>>;

/**
 * The admission module's own contract violation: a ceiling it was handed, or an observation it was
 * given, is not a number it can compare.
 *
 * The contract matches `ResourceMeasureError`'s, for the same reasons:
 *
 * 1. `instanceof ResourceAdmissionError`, `instanceof Error`, and `name === 'ResourceAdmissionError'`.
 * 2. The message is deterministic and names the counter and the fault; it never contains the
 *    observed figure, the ceiling that was set, or anything read from the document, so a caller can
 *    log it without leaking the input.
 * 3. It is **internal**: `src/pipeline.ts` does not catch it, so it can never become an
 *    `E_LIMIT_BUDGET` diagnostic. "The tool cannot prove its own numbers" is a defect, while
 *    `E_LIMIT_BUDGET` says "this document is too expensive" — two different statements.
 * 4. Nothing is clamped or substituted to avoid it: a value that cannot be compared is not compared.
 */
export class ResourceAdmissionError extends Error {
  /** Build the error from a reason that names a counter and a fixed fault, never from a value. */
  constructor(reason: string) {
    super(`admission: ${reason}`);
    this.name = 'ResourceAdmissionError';
  }
}

/** `value` when it is a positive safe integer, else a `ResourceAdmissionError` naming `counter`. */
function checkedCeiling(value: unknown, counter: BudgetCounter): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ResourceAdmissionError(`the ${counter} ceiling is not a positive safe integer`);
  }
  return value;
}

/** `value` when it is a non-negative safe integer, else a `ResourceAdmissionError` naming `counter`. */
function checkedObserved(value: unknown, counter: BudgetCounter): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ResourceAdmissionError(`${counter} is not a non-negative safe integer`);
  }
  return value;
}

/**
 * The one message for a profile this build does not apply.
 *
 * Fixed text with no figure, no name and nothing read from the value it rejects, so a caller may log
 * it without repeating what it was handed (the same rule the counter faults follow).
 */
const UNKNOWN_PROFILE = 'the budget names a profile this build does not apply';

/**
 * Resolve one budget into the ceilings it is allowed to carry, or throw.
 *
 * The result is a **fresh object holding only the members the profile declares**, built member by
 * member rather than spread: a caller's extra property — a restated Σ`L²` ceiling on a `tables`
 * budget, or a typo'd member — cannot ride along into the admission decision. A bad setting comes
 * from code and not from the input, so it throws here rather than becoming a diagnostic.
 *
 * **The discriminant is checked here, never taken from the type.** `ResourceBudget` is a union the
 * compiler knows and the runtime does not: a `.js` caller, a `JSON.parse()`d record or a cast hands
 * this function an object whose `profile` is any value at all, `undefined` included. So the profile
 * is read first, and a value that is not one of this build's two — another string, an empty one, a
 * differently cased one, `null`, a number — throws instead of falling into the `tables` branch.
 * That branch is the last one left, and a last arm that doubles as "anything else" is how an
 * unknown profile silently acquires the tables ceilings. The message is fixed, so no value travels
 * in it.
 */
export function withResourceBudget(budget: ResourceBudget): ResourceBudget {
  // A type is not a check: `null`, `undefined` and every non-object reach this point at runtime.
  if (typeof budget !== 'object' || budget === null) {
    throw new ResourceAdmissionError(UNKNOWN_PROFILE);
  }

  if (budget.profile === 'envelope') {
    return {
      profile: 'envelope',
      relationValueLengthSquares: checkedCeiling(
        budget.relationValueLengthSquares,
        'relationValueLengthSquares',
      ),
      composedColumnsUpperBound: checkedCeiling(
        budget.composedColumnsUpperBound,
        'composedColumnsUpperBound',
      ),
      entityFieldOccurrences: checkedCeiling(
        budget.entityFieldOccurrences,
        'entityFieldOccurrences',
      ),
      contentLineOccurrences: checkedCeiling(
        budget.contentLineOccurrences,
        'contentLineOccurrences',
      ),
    };
  }

  // Explicit, and not the `else` of the branch above: at runtime this is the second and last value
  // the discriminant is allowed to take, not whatever is left over.
  if (budget.profile === 'tables') {
    return {
      profile: 'tables',
      composedColumnsUpperBound: checkedCeiling(
        budget.composedColumnsUpperBound,
        'composedColumnsUpperBound',
      ),
      entityFieldOccurrences: checkedCeiling(
        budget.entityFieldOccurrences,
        'entityFieldOccurrences',
      ),
      contentLineOccurrences: checkedCeiling(
        budget.contentLineOccurrences,
        'contentLineOccurrences',
      ),
    };
  }

  throw new ResourceAdmissionError(UNKNOWN_PROFILE);
}

/**
 * What admission decided about one measurement.
 *
 * A refusal carries the three numbers the `E_LIMIT_BUDGET` details repeat — which counter, what was
 * observed, what the ceiling was — so the caller never re-derives them from the measurement and the
 * diagnostic cannot disagree with the decision. All three are this tool's own figures and fixed
 * vocabulary: no path, key, column or other input text travels in them.
 */
export type Admission =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      readonly counter: BudgetCounter;
      readonly observed: number;
      readonly ceiling: number;
    };

/** The refusal when `observed` is past `ceiling`, else `null`. Exactly at the ceiling is admitted. */
function refuseIfOver(
  observed: number,
  ceiling: number,
  counter: BudgetCounter,
): Extract<Admission, { readonly admitted: false }> | null {
  return observed > ceiling ? { admitted: false, counter, observed, ceiling } : null;
}

/**
 * Decide whether one measurement is within one budget.
 *
 * The profile decides which counters exist, and the order is fixed: on `envelope`, Σ`L²` is compared
 * first, so a document that is over both reports the relation value proxy rather than the composed
 * bound. `tables` compares its one counter and never reads `counters` at all.
 *
 * **Every observation this profile reads is proved comparable before the first comparison.** The
 * order that decides the answer and the order that decides "can I decide?" are not the same one: a
 * document over the Σ`L²` ceiling whose composed bound is `NaN` is a defect in this tool's own
 * measurement, not a refusal about that document, so it throws instead of reporting a refusal the
 * figures do not support. A refusal states a document's cost, and this module may only state costs
 * it can compare.
 *
 * The budget is validated here even when it came from `withResourceBudget()`: admission is the call
 * that compares, so it must be the call that can prove the numbers it compares. Nothing about the
 * measurement is written to — the record is read-only from this module's side — and the answer is a
 * function of the two inputs alone: no clock, no environment, no free-memory figure, so the same
 * measurement and the same budget always give the same admission.
 */
export function admit(measurement: ResourceMeasure, budget: ResourceBudget): Admission {
  const applied = withResourceBudget(budget);

  if (applied.profile === 'envelope') {
    // Both figures this profile reads, proved before either is compared. `tables` reads the composed
    // bound only and reaches it below, so an unreadable Σ`L²` is not a fault there.
    const relationValues = checkedObserved(
      measurement.counters.relationValueLengthSquares,
      'relationValueLengthSquares',
    );
    const composedColumns = checkedObserved(
      measurement.bounds.composedColumnsUpperBound.upperBound,
      'composedColumnsUpperBound',
    );

    return (
      refuseIfOver(
        relationValues,
        applied.relationValueLengthSquares,
        'relationValueLengthSquares',
      ) ??
      refuseIfOver(
        composedColumns,
        applied.composedColumnsUpperBound,
        'composedColumnsUpperBound',
      ) ?? { admitted: true }
    );
  }

  return (
    refuseIfOver(
      checkedObserved(
        measurement.bounds.composedColumnsUpperBound.upperBound,
        'composedColumnsUpperBound',
      ),
      applied.composedColumnsUpperBound,
      'composedColumnsUpperBound',
    ) ?? { admitted: true }
  );
}

/**
 * Decide whether one pre-scan shape is within one budget (U5-ADMIT2).
 *
 * The same rule and the same budget validation as `admit()`, on the two figures that exist before
 * the scan does: `entityFieldOccurrences` is compared first, so a document over both ceilings
 * reports the `Field=` occurrences, and `contentLineOccurrences` second.
 *
 * **Both observations are proved comparable before either is compared**, for the reason `admit()`
 * gives: a shape whose content figure is `NaN` is a defect in this tool's own walk, not a refusal
 * about that document, so it throws instead of reporting a refusal the figures do not support.
 *
 * Only these two members are read. `shape.lines` is the pre-scan accounting, and the read limits
 * already bound total lines, comments and blanks; nothing about the shape is written to, and the
 * answer depends on the two arguments alone.
 */
export function admitShape(shape: SourceShape, budget: ResourceBudget): Admission {
  const applied = withResourceBudget(budget);

  const entityFields = checkedObserved(shape.entityFieldOccurrences, 'entityFieldOccurrences');
  const contentLines = checkedObserved(shape.contentLineOccurrences, 'contentLineOccurrences');

  return (
    refuseIfOver(entityFields, applied.entityFieldOccurrences, 'entityFieldOccurrences') ??
    refuseIfOver(contentLines, applied.contentLineOccurrences, 'contentLineOccurrences') ?? {
      admitted: true,
    }
  );
}
