/**
 * `view/relations.ts` — the projection behind `a5er relations` (`docs/architecture.md` §12).
 *
 * **What this module is.** One pure answer over stage results the pipeline already produced:
 * `buildRelationsEnvelope()` turns `semantics.relations` into this command's document. Nothing is
 * resolved or classified a second time — the endpoint statuses, the candidate counts and the
 * column counts are the records `relationsOf()` returned, projected member for member.
 *
 * **Unknown stays unknown.** A missing `Fields1`/`Fields2` list is `null`, never `0`, and a present
 * but empty list is `0`; a missing endpoint key is `null` in the row (a required-key finding), never
 * a `dangling` endpoint. `columnsAligned` keeps its third value, so a consumer cannot read "one side
 * is absent" as "the sides agree". `cardinarity1/2` is the declared string, spelling of the key
 * included, because this build does not interpret it.
 *
 * **Construction order is emission order**, exactly as `src/json/` requires: the envelope literal
 * below spells every member out, nothing is spread from another document, and the arm ends in
 * `schema?: never` so a consumer can tell this shape from a schema envelope.
 *
 * No I/O, no clock, no locale: the result depends on the input, its `Integration` and the echoed path.
 */

import type {
  JsonRelationsEndpoint,
  JsonRelationsEnvelope,
  JsonRelationsResult,
  JsonRelationsRow,
} from '../json/index.js';
import { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION } from '../json/index.js';
import { sharedEnvelopeMembers } from '../json/serialize.js';
import type { Limits } from '../io/limits.js';
import type { RelationEndpoint, ResolvedRelation } from '../semantic/index.js';
import type { Integration, IntegrationInput } from '../validate/index.js';
import { isLoadedInput } from '../validate/index.js';

/** The command whose document lists every relation. */
export const RELATIONS_COMMAND = 'relations';

/** The document's keys, in emission order: the shared ten, with `result` in `schema`'s place. */
export const RELATIONS_ENVELOPE_KEYS = [
  'contractVersion',
  'tool',
  'command',
  'status',
  'source',
  'limits',
  'result',
  'unsupported',
  'diagnostics',
  'completeness',
] as const;

/** One row's keys, in emission order (the test pins the order against the bytes). */
export const RELATION_ROW_KEYS = [
  'sectionIndex',
  'sectionHeader',
  'pname',
  'from',
  'to',
  'fields1Count',
  'fields2Count',
  'relationType1',
  'relationType2',
  'cardinarity1',
  'cardinarity2',
  'columnsAligned',
] as const;

/** One endpoint's keys, in emission order. */
export const RELATION_ENDPOINT_KEYS = [
  'declared',
  'status',
  'candidates',
  'resolvedEntity',
] as const;

/** One endpoint as JSON, member by member; `null` when the section declares no such key. */
function endpointJson(endpoint: RelationEndpoint | null): JsonRelationsEndpoint | null {
  if (endpoint === null) return null;
  return {
    declared: endpoint.declared,
    status: endpoint.status,
    candidates: endpoint.candidates,
    resolvedEntity: endpoint.resolvedEntity,
  };
}

/**
 * One relation as JSON.
 *
 * A column list is projected as its slot count alone: this command answers "which relations does
 * this file declare, and how far did they resolve", and the per-column detail is the `inspect`
 * envelope's `schema.relations`. The count keeps empty slots (§7.1 R28), because a 3:2 pairing that
 * looked like 2:2 would hide a real mismatch.
 */
function relationRow(relation: ResolvedRelation): JsonRelationsRow {
  return {
    sectionIndex: relation.sectionIndex,
    sectionHeader: relation.sectionHeader,
    pname: relation.pname,
    from: endpointJson(relation.from),
    to: endpointJson(relation.to),
    fields1Count: relation.fromColumns === null ? null : relation.fromColumns.columns.length,
    fields2Count: relation.toColumns === null ? null : relation.toColumns.columns.length,
    relationType1: relation.relationType1,
    relationType2: relation.relationType2,
    cardinarity1: relation.cardinarity1,
    cardinarity2: relation.cardinarity2,
    columnsAligned: relation.columnsAligned,
  };
}

/**
 * Build the relations document for one read.
 *
 * `semantics.relations` is the pipeline's own list, in file order; a document with no relations
 * yields `[]`, which is a complete answer rather than a missing one.
 */
export function buildRelationsEnvelope(
  input: IntegrationInput,
  integration: Integration,
  context: { readonly path: string; readonly limits?: Limits },
): JsonRelationsEnvelope {
  const shared = sharedEnvelopeMembers(input, integration, context);

  if (integration.status === 'failed') {
    // `source`, `result` and `completeness` are null exactly on this arm; a contradiction is a defect.
    if (shared.source !== null || shared.completeness !== null) {
      throw new TypeError('a failed envelope must have null source, result and completeness');
    }
    return {
      contractVersion: CONTRACT_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      command: RELATIONS_COMMAND,
      status: 'failed',
      source: null,
      limits: shared.limits,
      result: null,
      unsupported: shared.unsupported,
      diagnostics: shared.diagnostics,
      completeness: null,
    };
  }

  if (!isLoadedInput(input) || shared.source === null || shared.completeness === null) {
    throw new TypeError(
      `an ${integration.status} envelope must have non-null source and completeness`,
    );
  }

  const result: JsonRelationsResult = input.semantics.relations.map(relationRow);

  return {
    contractVersion: CONTRACT_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    command: RELATIONS_COMMAND,
    status: integration.status,
    source: shared.source,
    limits: shared.limits,
    result,
    unsupported: shared.unsupported,
    diagnostics: shared.diagnostics,
    completeness: shared.completeness,
  };
}
