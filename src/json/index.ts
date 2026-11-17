/**
 * The JSON envelope's public surface (`architecture.md` §12).
 *
 * `envelope.ts` owns the contract's types and frozen constants; `serialize.ts` owns the one factory
 * and the deterministic string form. The CLI (stage 7) imports from here, so neither half has to be
 * reached through a deep path.
 */

export type {
  JsonAttribute,
  JsonAttributeToken,
  JsonColumnCollision,
  JsonCommand,
  JsonCommonField,
  JsonCompleteness,
  JsonComplexPart,
  JsonComplexValue,
  JsonDiagnostic,
  JsonDomain,
  JsonEffectiveColumn,
  JsonEntityColumns,
  JsonEntityObject,
  JsonEnvelope,
  JsonField,
  JsonIndexInfo,
  JsonIndexOption,
  JsonIndexes,
  JsonInferredValue,
  JsonInvalidOrdinal,
  JsonLegacyIndex,
  JsonLNameByComment,
  JsonLimits,
  JsonManager,
  JsonObject,
  JsonObjectPosition,
  JsonObjectScalar,
  JsonObjectScalarKey,
  JsonOrigin,
  JsonPage,
  JsonPosition,
  JsonPrimaryKey,
  JsonPrimaryKeyColumn,
  JsonProjectedScalar,
  JsonRawElement,
  JsonRelation,
  JsonRelationColumn,
  JsonRelationColumnList,
  JsonRelationEndpoint,
  JsonRelationPosition,
  JsonRelationScalar,
  JsonRelationScalarKey,
  JsonSchema,
  JsonSource,
  JsonSpan,
  JsonSubtypeMembership,
  JsonSubtypeObject,
  JsonSubtypeScalar,
  JsonUnsupported,
  JsonUnsupportedPosition,
  JsonUsingCommonColumns,
  JsonValue,
  JsonViewColumns,
  JsonViewObject,
} from './envelope.js';
export type { SerializeContext } from './serialize.js';
export { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION } from './envelope.js';
export { serialize, toJsonString } from './serialize.js';
