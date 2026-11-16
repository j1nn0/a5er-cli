/**
 * Bounded semantics — what this stage is allowed to conclude, and what it explicitly does not
 * (`architecture.md` §9, §11, §13).
 *
 * Four findings, each one traceable to a sentence in the specification or to a documented local
 * decision:
 *
 * | Finding | Code | Source |
 * |---|---|---|
 * | two objects share a physical name | `V_DUPLICATE_OBJECT_NAME` | P6 («全オブジェクトでユニーク») |
 * | a required key is absent | `V_MISSING_REQUIRED_KEY` | §5's `required`, §7.2, §11 |
 * | the declared ordinals are not a key | `V_PK_ORDER_CONFLICT` | P8's キー順, §11 |
 * | legacy index data is the only index data | `V_INDEX_LEGACY_ONLY` | §6 row 6, D5/L6 |
 *
 * **This is not a resolved schema, and it does not claim to be.** `PartialSemantics` is named for
 * the boundary: everything §9 lists and this unit does not do is in `unresolved`, so a consumer can
 * see what is missing instead of assuming an absent field means "nothing there". The five open
 * areas are relations, pages, domains, common columns and views — the parts of §9 that need
 * cross-object lookup and the decisions recorded in §17.
 *
 * Pure: every rule reads the classification and allocates its own findings; nothing in the
 * classification is mutated, so a caller can derive twice and compare.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { emitMissingRequiredKey, emitSemantic } from '../diagnostics/diagnostic.js';
import type { Classification } from '../schema/registry.js';
import type { DuplicateObjectName, ObjectIdentity } from './identity.js';
import { identitiesOf } from './identity.js';
import type { LegacyOnlyIndex } from './indexes.js';
import { legacyOnlyIndexesOf } from './indexes.js';
import type { InferredPrimaryKey, PkOrderConflict } from './primary-key.js';
import { primaryKeysOf } from './primary-key.js';
import type { MissingRequiredKeys } from './required.js';
import { missingRequiredKeysOf } from './required.js';

/**
 * The parts of §9 this stage deliberately leaves open.
 *
 * Named so that "no finding" can never be read as "nothing wrong": a consumer that wants these
 * must wait for the resolution unit, and a reader of `PartialSemantics` can see the list.
 */
export type UnresolvedArea =
  | 'relation-endpoints'
  | 'page-resolution'
  | 'domain-resolution'
  | 'common-columns'
  | 'view-columns'
  | 'subtype-membership';

/** Everything the resolution unit still owes, in one place (§9, §17). */
export const UNRESOLVED_AREAS: readonly UnresolvedArea[] = [
  'relation-endpoints',
  'page-resolution',
  'domain-resolution',
  'common-columns',
  'view-columns',
  'subtype-membership',
];

/** The bounded semantic result: four findings, their diagnostics, and the open boundary. */
export interface PartialSemantics {
  /** Every object, duplicates included (§9.1). */
  readonly identities: readonly ObjectIdentity[];
  readonly duplicateNames: readonly DuplicateObjectName[];
  readonly missingRequired: readonly MissingRequiredKeys[];
  /** One entry per object that declares at least one usable ordinal. */
  readonly primaryKeys: readonly InferredPrimaryKey[];
  readonly pkConflicts: readonly PkOrderConflict[];
  readonly legacyOnlyIndexes: readonly LegacyOnlyIndex[];
  /** Ordered by line (§12 rule 7). */
  readonly diagnostics: readonly Diagnostic[];
  /** The §9 work this stage does not do. Never empty, by design. */
  readonly unresolved: readonly UnresolvedArea[];
}

/**
 * Derive the four findings from a classification.
 *
 * Diagnostic counts, deliberately:
 *
 * - **one `V_DUPLICATE_OBJECT_NAME` per duplicated name**, pointing at the later declaring `PName`
 *   line, with every involved identity kept in the finding (sem-08 has one name, two objects);
 * - **one `V_MISSING_REQUIRED_KEY` per subject** — a section or a column — carrying the absent key
 *   names, so an empty section is one finding and not a burst of them (txt-09);
 * - **one `V_PK_ORDER_CONFLICT` per conflicted object**, pointing at the first contributing `Field`
 *   line (val-09), with the declared ordinals quoted in the details;
 * - **one `V_INDEX_LEGACY_ONLY` per object** whose only index evidence is legacy (fmt-02, sem-04).
 */
export function derivePartialSemantics(classification: Classification): PartialSemantics {
  const identity = identitiesOf(classification);
  const missingRequired = missingRequiredKeysOf(classification);
  const primaryKey = primaryKeysOf(classification);
  const legacyOnlyIndexes = legacyOnlyIndexesOf(classification);

  const diagnostics: Diagnostic[] = [];

  for (const duplicate of identity.duplicates) {
    // The later declaration is the one reported; every span is cited in the finding (§12 rule 3).
    const last = duplicate.identities.at(-1);
    diagnostics.push(
      emitSemantic('V_DUPLICATE_OBJECT_NAME', {
        details: { pname: duplicate.pname, occurrences: duplicate.identities.length },
        span: last?.spans.at(-1) ?? null,
        construct: 'Object',
      }),
    );
  }

  for (const finding of missingRequired) {
    diagnostics.push(
      emitMissingRequiredKey({
        severity: finding.severity,
        details: {
          keys: finding.keys.join(','),
          subject: finding.subject,
          section: finding.sectionKind,
          column: finding.column,
        },
        span: finding.span,
        construct: finding.subject === 'column' ? 'Field' : 'Section',
      }),
    );
  }

  for (const conflict of primaryKey.conflicts) {
    diagnostics.push(
      emitSemantic('V_PK_ORDER_CONFLICT', {
        details: {
          object: conflict.object,
          ordinals: conflict.ordinals.join(','),
          reason: conflict.reason,
        },
        span: conflict.spans[0] ?? null,
        construct: 'Entity',
      }),
    );
  }

  for (const finding of legacyOnlyIndexes) {
    diagnostics.push(
      emitSemantic('V_INDEX_LEGACY_ONLY', {
        details: {
          object: finding.object,
          declared: finding.profile.declared,
          legacyRecords: finding.legacyRecords.length,
        },
        span: finding.span,
        construct: 'Index',
      }),
    );
  }

  diagnostics.sort((left, right) => (left.span?.startLine ?? 0) - (right.span?.startLine ?? 0));

  return {
    identities: identity.identities,
    duplicateNames: identity.duplicates,
    missingRequired,
    primaryKeys: primaryKey.keys,
    pkConflicts: primaryKey.conflicts,
    legacyOnlyIndexes,
    diagnostics,
    unresolved: UNRESOLVED_AREAS,
  };
}
