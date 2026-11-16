/**
 * `semantic/` — bounded semantics over a classification (`architecture.md` §9, §11, §13).
 *
 * Four findings only: object identity, required keys, inferred primary keys and legacy-only index
 * data. Everything else §9 asks for — relation endpoints, page names, domains, common columns, view
 * columns, subtype membership — is listed in `PartialSemantics.unresolved` rather than modelled
 * optimistically, so a missing field is never mistaken for a satisfied one.
 *
 * The whole module is pure: it consumes a `Classification`, never mutates it, and emits findings
 * whose spans point at the lines that produced them.
 */

export type {
  DuplicateObjectName,
  IdentityResult,
  ObjectIdentity,
  ObjectKind,
} from './identity.js';
export { identitiesOf } from './identity.js';
export type { LegacyOnlyIndex } from './indexes.js';
export { legacyOnlyIndexesOf } from './indexes.js';
export type {
  InferredPrimaryKey,
  InferredPrimaryKeyColumn,
  PkConflictReason,
  PkOrderConflict,
  PrimaryKeyResult,
} from './primary-key.js';
export { primaryKeysOf } from './primary-key.js';
export type { MissingRequiredKeys } from './required.js';
export { missingRequiredKeysOf } from './required.js';
export type { PartialSemantics, UnresolvedArea } from './partial.js';
export { derivePartialSemantics, UNRESOLVED_AREAS } from './partial.js';
