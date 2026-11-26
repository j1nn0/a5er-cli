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

import type { ResourceMeasure } from './measure.js';

/** The two compositions that read a document, each with its own ceilings. */
export type BudgetProfile = 'envelope' | 'tables';

/**
 * The counters a budget can cap.
 *
 * Exactly the two figures `measure()` publishes as an amplification proxy or as an upper bound:
 * `relationValueLengthSquares` (Σ`L²` over relation values) and `composedColumnsUpperBound`
 * (`[Entity]` sections × decoded `CommonField` declarations). Byte and line counts are already
 * refused by `io/`/`decode/` and never appear here.
 */
export type BudgetCounter = 'relationValueLengthSquares' | 'composedColumnsUpperBound';

/**
 * The ceilings `inspect` and `validate` apply: one envelope string is built from all four stages.
 *
 * Both figures are capped, in this order: Σ`L²` first, because it is the proxy for the relation
 * stage's amplification, then the composed-column bound, because a document can hold the first far
 * below its ceiling and still adopt an unreasonable number of common columns.
 */
export interface EnvelopeResourceBudget {
  readonly profile: 'envelope';
  readonly relationValueLengthSquares: number;
  readonly composedColumnsUpperBound: number;
}

/**
 * The ceiling `tables` applies: the common-column composition only.
 *
 * Σ`L²` has no member here on purpose. `tables` renders a projection of the same record; the
 * relation-column amplification observed in `inspect`/`validate` is not part of its work, so capping
 * it would refuse documents this command can answer. That absence is structural: the type has no
 * such member, and `withResourceBudget()` never copies one in.
 */
export interface TablesResourceBudget {
  readonly profile: 'tables';
  readonly composedColumnsUpperBound: number;
}

/** One complete, profile-specific set of ceilings. */
export type ResourceBudget = EnvelopeResourceBudget | TablesResourceBudget;

/**
 * The ceilings this build applies, per profile.
 *
 * `134_217_728` (2²⁷) for Σ`L²` on the envelope profiles: a document whose relation values average
 * one code unit each would need about 1.3·10⁸ of them, far past what `maxLines` allows, so reaching
 * it takes a handful of very long values. `524_288` (2¹⁹) composed columns for the envelope
 * profiles, and `4_194_304` (2²²) for `tables`, which holds no relation text and therefore has the
 * stricter of its two costs removed.
 *
 * These are **tentative operational values**: not RSS, not a heap limit, not a bound on the envelope
 * string, and not a guarantee that a document below them is cheap. See the module comment.
 */
export const DEFAULT_RESOURCE_BUDGETS = {
  envelope: {
    profile: 'envelope',
    relationValueLengthSquares: 134_217_728,
    composedColumnsUpperBound: 524_288,
  },
  tables: {
    profile: 'tables',
    composedColumnsUpperBound: 4_194_304,
  },
} as const satisfies Readonly<Record<BudgetProfile, ResourceBudget>>;

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
 * Resolve one budget into the ceilings it is allowed to carry, or throw.
 *
 * Every ceiling is a **positive safe integer**. `0`, `-1`, `1.5`, `NaN` and `±Infinity` would each
 * silently change what the tool accepts, and `2**53` is a positive integer that no longer counts
 * exactly — the next integer shares its double, so a ceiling there cannot be compared or reported as
 * the number it names. `Number.isSafeInteger` draws exactly that line and keeps
 * `Number.MAX_SAFE_INTEGER` a valid setting.
 *
 * The result is a **fresh object holding only the members the profile declares**, built member by
 * member rather than spread: a caller's extra property — a restated Σ`L²` ceiling on a `tables`
 * budget, or a typo'd member — cannot ride along into the admission decision. A bad setting comes
 * from code and not from the input, so it throws here rather than becoming a diagnostic.
 */
export function withResourceBudget(budget: ResourceBudget): ResourceBudget {
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
    };
  }

  return {
    profile: 'tables',
    composedColumnsUpperBound: checkedCeiling(
      budget.composedColumnsUpperBound,
      'composedColumnsUpperBound',
    ),
  };
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
 * The budget is validated here even when it came from `withResourceBudget()`: admission is the call
 * that compares, so it must be the call that can prove the numbers it compares. Nothing about the
 * measurement is written to — the record is read-only from this module's side — and the answer is a
 * function of the two inputs alone: no clock, no environment, no free-memory figure, so the same
 * measurement and the same budget always give the same admission.
 */
export function admit(measurement: ResourceMeasure, budget: ResourceBudget): Admission {
  const applied = withResourceBudget(budget);

  if (applied.profile === 'envelope') {
    const relationValues = refuseIfOver(
      checkedObserved(
        measurement.counters.relationValueLengthSquares,
        'relationValueLengthSquares',
      ),
      applied.relationValueLengthSquares,
      'relationValueLengthSquares',
    );
    if (relationValues !== null) return relationValues;
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
