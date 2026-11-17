/**
 * `semantic/` — bounded semantics over a classification (`architecture.md` §9, §11, §13).
 *
 * Every `V_` finding of §11: object identity, required keys, inferred primary keys, legacy-only index
 * data, dangling reference resolution, field counts, view columns and subtype membership. The last two
 * are answered by declaring what the format does not carry — a view's columns are `unknown`, a
 * subtype's membership is `unsupported` — so neither is guessed. Domains and common columns have no
 * `V_` code in §11 and are carried as records only.
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
  IndeterminateKey,
  InferredPrimaryKey,
  InferredPrimaryKeyColumn,
  InvalidOrdinal,
  PkConflictReason,
  PkOrderConflict,
  PrimaryKeyResult,
} from './primary-key.js';
export { primaryKeysOf } from './primary-key.js';
export type {
  CommonColumnDeclaration,
  CommonColumnResult,
  CommonNotNullToken,
  ColumnSource,
  ColumnCollision,
  DuplicateCommonColumn,
  EffectiveColumn,
  EntityColumns,
  UsingCommonColumnsFact,
} from './common-columns.js';
export { commonColumnsOf } from './common-columns.js';
export type {
  DomainDeclaration,
  DomainReference,
  DomainResult,
  DomainTypeKind,
  DuplicateDomain,
  TypeClassification,
} from './domains.js';
export { classifyType, domainsOf, domainTypeKindOf, SYSTEM_DOMAINS } from './domains.js';
export type { DuplicatePage, PageDeclaration, PageReference, PageResult } from './pages.js';
export { pagesOf } from './pages.js';
export type {
  DanglingColumn,
  EndpointReference,
  EndpointStatus,
  FieldCountMismatch,
  RelationColumn,
  RelationColumnList,
  RelationEndpoint,
  RelationResult,
  ResolvedRelation,
  UnverifiedColumn,
} from './relations.js';
export { relationsOf } from './relations.js';
export type { MissingRequiredKeys, MissingSubject } from './required.js';
export { missingRequiredKeysOf } from './required.js';
export type {
  LNameByCommentFact,
  LNameByCommentToken,
  ViewColumnReason,
  ViewColumns,
  ViewDeclaration,
  ViewResult,
} from './views.js';
export { viewsOf } from './views.js';
export type {
  SubtypeDeclaration,
  SubtypeMembership,
  SubtypeResult,
  SubtypeScalar,
  SubtypeScalarToken,
} from './subtypes.js';
export { subtypesOf } from './subtypes.js';
export type { PartialSemantics, UnresolvedArea } from './partial.js';
export { derivePartialSemantics, UNRESOLVED_AREAS } from './partial.js';
