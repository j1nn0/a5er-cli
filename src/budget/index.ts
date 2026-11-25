/**
 * Resource measurement (`src/budget/`).
 *
 * `measure.ts` owns the structural counters, the two conservative upper bounds and the runtime
 * range check behind them. Nothing in this directory decides anything: admission, weights,
 * thresholds, diagnostics and CLI output belong to later units and are not imported here.
 *
 * `ResourceMeasureError` is the module's own contract violation — a number it cannot prove to be a
 * non-negative safe integer. It is exported so that a caller of `measure()` can tell that failure
 * apart; no CLI, diagnostic or exit code is derived from it in this unit.
 */

export { measure, ResourceMeasureError } from './measure.js';
export type {
  ComposedColumnsUpperBound,
  ResourceBounds,
  ResourceCounters,
  ResourceMeasure,
} from './measure.js';
