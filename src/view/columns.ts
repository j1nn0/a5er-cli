/**
 * `view/columns.ts` — the projection behind `a5er columns` (`docs/architecture.md` §12).
 *
 * **What this module is.** Two pure answers over stage results the pipeline already produced:
 * `selectColumnsObject()` picks the one object whose decoded `PName` matches the operand, and
 * `buildColumnsEnvelope()` turns that object's semantic record into this command's document. Nothing
 * is decoded, resolved or composed a second time — the selection reads `semantics.identities`, and
 * the columns are the same `EntityColumns` / `ViewColumns` records the inspect envelope publishes.
 *
 * **Selection is exact and total.** The name is compared as decoded (quotes removed, escapes
 * applied) and case-sensitively; no normalisation, no fuzzy match, no `--section`. Zero matches, more
 * than one match, or a single `[Subtype]` are *answers*, not silent choices, so the caller can report
 * them and exit without writing a document (a subtype declares membership, never columns).
 *
 * **Unknown stays unknown.** A view's record has no column list at all (`JsonViewColumns`), and an
 * entity whose `UsingCommonColumns` could not be decided keeps the inspect envelope's `partial` arm
 * with `unknown: common-fields-not-enumerated`. The visible counts are never relabelled complete.
 *
 * **Construction order is emission order**, exactly as `src/json/` requires: the envelope literals
 * below spell every member out, nothing is spread from another document, and the two arms end in
 * `schema?: never` so a consumer can tell this shape from a schema envelope.
 *
 * No I/O, no clock, no locale: the result depends on the input, its `Integration` and the echoed path.
 */

import type { JsonColumnsEnvelope, JsonColumnsResult, JsonSpan } from '../json/index.js';
import { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION } from '../json/index.js';
import { jsonEntityColumns, sharedEnvelopeMembers } from '../json/serialize.js';
import type { Limits } from '../io/limits.js';
import type { Span } from '../model/span.js';
import type { ClassifiedSection } from '../schema/index.js';
import type { ObjectIdentity } from '../semantic/index.js';
import type { Integration, IntegrationInput } from '../validate/index.js';
import { isLoadedInput } from '../validate/index.js';

/** The command whose document carries one object's columns. */
export const COLUMNS_COMMAND = 'columns';

/** The document's keys, in emission order: the shared ten, with `result` in `schema`'s place. */
export const COLUMNS_ENVELOPE_KEYS = [
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

/**
 * What the operand selected.
 *
 * `ambiguous` carries every candidate's section index in document order, so the report can cite them
 * without naming objects the operand did not match exactly; `subtype` is the one match that cannot
 * have columns.
 */
export type ColumnsSelection =
  | { readonly kind: 'selected'; readonly identity: ObjectIdentity }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly sectionIndexes: readonly number[] }
  | { readonly kind: 'subtype'; readonly sectionIndex: number };

/**
 * The one object whose decoded `PName` equals `name`, or why there is not exactly one.
 *
 * `identities` already holds every entity, view and subtype with a decoded name, in file order, so
 * this is one walk and no second interpretation of `PName`. Case is preserved on both sides: `A` and
 * `a` are different objects.
 */
export function selectColumnsObject(
  identities: readonly ObjectIdentity[],
  name: string,
): ColumnsSelection {
  const matches = identities.filter((identity) => identity.pname === name);

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) {
    return { kind: 'ambiguous', sectionIndexes: matches.map((match) => match.sectionIndex) };
  }

  const match = matches[0];
  if (match === undefined) return { kind: 'none' };
  return match.kind === 'Subtype'
    ? { kind: 'subtype', sectionIndex: match.sectionIndex }
    : { kind: 'selected', identity: match };
}

/** The four positions of a span, copied member by member — the JSON layer's own shape. */
function spanJson(span: Span): JsonSpan {
  return {
    sectionIndex: span.sectionIndex,
    startLine: span.startLine,
    endLine: span.endLine,
    keyLine: span.keyLine,
  };
}

/** The header line of a section, as a one-line span (the object's last resort, like `tables`). */
function headerSpan(section: ClassifiedSection): Span {
  return {
    sectionIndex: section.index,
    startLine: section.span.keyLine,
    endLine: section.span.keyLine,
    keyLine: section.span.keyLine,
  };
}

/** The object's line: its last `PName` line, else its header (the convention `tables` follows). */
function objectSpan(identity: ObjectIdentity, section: ClassifiedSection): Span {
  return identity.spans.at(-1) ?? headerSpan(section);
}

/**
 * The last decoded text of one key in a section, or `null` (§4.2 last-wins).
 *
 * Only `LName` is read here; the physical name comes from the identity. A later occurrence that does
 * not decode makes the answer `null` — there is no walk back to an earlier readable line, the same
 * rule the inspect envelope follows.
 */
function decodedText(section: ClassifiedSection, key: string): string | null {
  let value: string | null = null;
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    const { occurrence } = entry;
    if (occurrence.spec.key !== key) continue;
    const decoded = occurrence.decoded;
    if (!decoded.ok) {
      value = null;
      continue;
    }
    const decodedValue = decoded.value.value;
    value = typeof decodedValue === 'string' ? decodedValue : null;
  }
  return value;
}

/** A record a section must have; its absence is a defect and throws before any byte is written. */
function requireRecord<T>(record: T | undefined, what: string, sectionIndex: number): T {
  if (record === undefined) {
    throw new Error(
      `columns envelope: ${what} for section ${String(sectionIndex)} is missing from the semantics`,
    );
  }
  return record;
}

/**
 * Build the columns document for one selected object.
 *
 * `identity` is the match `selectColumnsObject()` returned; a `Subtype` never reaches here, and a
 * record missing for a matched section is a defect (thrown, then reported as exit `70` by the
 * command layer), never a silently empty answer.
 */
export function buildColumnsEnvelope(
  input: IntegrationInput,
  integration: Integration,
  context: {
    readonly path: string;
    readonly limits?: Limits;
    /** The selected object; `null` only for a failed read, whose arm uses no identity. */
    readonly identity: ObjectIdentity | null;
  },
): JsonColumnsEnvelope {
  const shared = sharedEnvelopeMembers(input, integration, context);
  const identity = context.identity;

  if (integration.status === 'failed') {
    // `source`, `result` and `completeness` are null exactly on this arm; a contradiction is a defect.
    if (shared.source !== null || shared.completeness !== null) {
      throw new TypeError('a failed envelope must have null source, result and completeness');
    }
    return {
      contractVersion: CONTRACT_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      command: COLUMNS_COMMAND,
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
  if (identity === null) {
    throw new TypeError(`an ${integration.status} envelope must have a selected object`);
  }

  const section = input.classification.sections.find(
    (candidate) => candidate.index === identity.sectionIndex,
  );
  if (section === undefined) {
    throw new Error(
      `columns envelope: section ${String(identity.sectionIndex)} is missing from the classification`,
    );
  }

  let result: JsonColumnsResult;
  switch (identity.kind) {
    case 'Entity': {
      const columns = requireRecord(
        input.semantics.entityColumns.find((record) => record.sectionIndex === section.index),
        'effective columns',
        section.index,
      );
      result = {
        kind: 'entity',
        sectionIndex: section.index,
        span: spanJson(objectSpan(identity, section)),
        pname: identity.pname,
        lname: decodedText(section, 'LName'),
        columns: jsonEntityColumns(columns),
      };
      break;
    }
    case 'View': {
      const view = requireRecord(
        input.semantics.views.find((record) => record.sectionIndex === section.index),
        'view',
        section.index,
      );
      result = {
        kind: 'view',
        sectionIndex: section.index,
        span: spanJson(objectSpan(identity, section)),
        pname: identity.pname,
        lname: decodedText(section, 'LName'),
        columns: { status: view.effectiveColumns.status, reason: view.effectiveColumns.reason },
      };
      break;
    }
    default:
      // Selection never hands a subtype to this builder; a value that got here is a defect.
      throw new TypeError(`columns envelope: a ${identity.kind} has no column record`);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    command: COLUMNS_COMMAND,
    status: integration.status,
    source: shared.source,
    limits: shared.limits,
    result,
    unsupported: shared.unsupported,
    diagnostics: shared.diagnostics,
    completeness: shared.completeness,
  };
}
