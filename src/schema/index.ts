/**
 * `schema/` — the section-scoped key registry, FORMAT profiles and basic typed values
 * (`architecture.md` §5, §6, §7.1).
 *
 * Three pure pieces, composed by `classify`:
 *
 * - `registry.ts` — what a key means *in its section*, and what happens to everything else
 *   (preserved as `RawEntry` evidence, never dropped);
 * - `profiles.ts` — what the declared FORMAT lets the reader conclude, never what it lets it
 *   accept;
 * - `values.ts` — the five basic types, keeping `value`, `raw`, `origin` and `span` apart.
 *
 * Not here, on purpose: `Field`/`IndexInfo`/`Position` positional decoding (§7.2, the per-section
 * shapes), resolution (§9) and anything that emits a `V_` finding.
 */

export type {
  Classification,
  ClassifiedEntry,
  ClassifiedKey,
  ClassifiedSection,
  CanonicalKind,
  Completeness,
  CompletenessViolation,
  KeyOccurrence,
  KeySpec,
  RawEntry,
  RetentionKind,
} from './registry.js';
export {
  classify,
  CompletenessError,
  deriveCompleteness,
  lookupKey,
  REGISTRY,
  verifyCompleteness,
} from './registry.js';
export type { FormatProfile } from './profiles.js';
export { profileOf } from './profiles.js';
export type {
  ComplexValue,
  DecodeOutcome,
  DecodedValue,
  IntegerOutcome,
  InvalidReason,
  InvalidValue,
  Origin,
  Value,
  ValueType,
} from './values.js';
export {
  decodeBoolean,
  decodeInteger,
  decodeValue,
  defaultValue,
  unescapeEscaped,
  unquote,
} from './values.js';
