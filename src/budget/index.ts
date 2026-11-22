/**
 * Resource measurement (`src/budget/`).
 *
 * `measure.ts` owns the structural counters, the two conservative upper bounds and their
 * preconditions. Nothing in this directory decides anything: admission, weights, thresholds,
 * diagnostics and CLI output belong to later units and are not imported here.
 */

export { measure } from './measure.js';
export type {
  ComposedColumnsUpperBound,
  ResourceBounds,
  ResourceCounters,
  ResourceMeasure,
} from './measure.js';
