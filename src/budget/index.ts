/**
 * Resource measurement and admission (`src/budget/`).
 *
 * `measure.ts` owns the structural counters, the two conservative upper bounds and the runtime
 * range check behind them. `admission.ts` owns the one decision this directory makes: whether one
 * measurement is within one profile's ceilings (`inspect`/`validate` versus `tables`). The ceilings
 * themselves are tentative operational values published there; nothing here reads the environment,
 * a clock or a heap figure, and no diagnostic or CLI output is produced in this directory.
 *
 * `ResourceMeasureError` and `ResourceAdmissionError` are the module's own contract violations — a
 * number it cannot prove to be a safe integer, or a ceiling it cannot compare. They are exported so
 * that a caller can tell that failure apart; the pipeline never turns either into a diagnostic.
 */

export {
  admit,
  DEFAULT_RESOURCE_BUDGETS,
  ResourceAdmissionError,
  withResourceBudget,
} from './admission.js';
export type {
  Admission,
  BudgetCounter,
  BudgetProfile,
  EnvelopeResourceBudget,
  ResourceBudget,
  TablesResourceBudget,
} from './admission.js';
export { measure, ResourceMeasureError } from './measure.js';
export type {
  ComposedColumnsUpperBound,
  ResourceBounds,
  ResourceCounters,
  ResourceMeasure,
} from './measure.js';
