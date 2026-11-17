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
 * | a required key is absent | `V_MISSING_REQUIRED_KEY` | §5's `required`, §7.2, §9.3, §11 |
 * | the declared ordinals are not a key | `V_PK_ORDER_CONFLICT` | P8's キー順, §11 |
 * | legacy index data is the only index data | `V_INDEX_LEGACY_ONLY` | §6 row 6, D5/L6 |
 * | a relation endpoint or column does not resolve | `V_DANGLING_ENTITY`, `V_DANGLING_COLUMN` | P9, U8 |
 * | the two sides of a relation map different counts | `V_FIELD_COUNT_MISMATCH` | U8 |
 * | a placement names no declared page | `V_DANGLING_PAGE` | P9, P11, F5 |
 * | a view has no stored columns | `V_VIEW_COLUMNS_UNKNOWN` | P6, P10, §9.6 |
 * | a subtype has no membership key | `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` | F7, D6, K11, §9.6 |
 *
 * Domains and common columns are resolved too (§9.4, P12), but nothing about them has a closed
 * diagnostic code in §11, so they are reported in the model only — a dangling domain name, an
 * ambiguous domain, a duplicate common column and a column collision are all carried as records, and
 * none of them invents a code.
 *
 * **This is not a resolved schema, and it does not claim to be.** `PartialSemantics` is named for
 * the boundary: everything §9 lists and this unit does not do belongs in `unresolved`, so a consumer
 * can see what is missing instead of assuming an absent field means "nothing there".
 *
 * **An empty `unresolved` is not a finished product.** The list is now empty because every area it
 * ever named has an explicit per-object model — domains and common columns in their records, view
 * columns as `effectiveColumns: { status: 'unknown' }`, subtype membership as `membership: {
 * status: 'unsupported' }`. It says nothing about the JSON envelope, the serializer or the CLI, which
 * are later units, and nothing about format features outside §9 (`§17`).
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
import type { InferredPrimaryKey, IndeterminateKey, PkOrderConflict } from './primary-key.js';
import { primaryKeysOf } from './primary-key.js';
import type {
  DanglingColumn,
  EndpointReference,
  FieldCountMismatch,
  ResolvedRelation,
} from './relations.js';
import { relationsOf } from './relations.js';
import type { DuplicatePage, PageDeclaration, PageReference } from './pages.js';
import { pagesOf } from './pages.js';
import type { DomainDeclaration, DomainReference, DuplicateDomain } from './domains.js';
import { domainsOf } from './domains.js';
import type {
  CommonColumnDeclaration,
  DuplicateCommonColumn,
  EntityColumns,
} from './common-columns.js';
import { commonColumnsOf } from './common-columns.js';
import type { ViewDeclaration } from './views.js';
import { viewsOf } from './views.js';
import type { SubtypeDeclaration } from './subtypes.js';
import { subtypesOf } from './subtypes.js';
import type { MissingRequiredKeys } from './required.js';
import { missingRequiredKeysOf } from './required.js';

/**
 * The parts of §9 this stage deliberately leaves open.
 *
 * Empty: both areas this list ever named now have an explicit per-object model, so "nothing
 * reported" can no longer mean "nothing checked" for them — every `[View]` carries
 * `effectiveColumns.status === 'unknown'` and one `V_VIEW_COLUMNS_UNKNOWN`, and every `[Subtype]`
 * carries `membership.status === 'unsupported'` and one `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP`.
 *
 * The type keeps the vocabulary instead of collapsing to `never`, so a future unit can name an area
 * again rather than invent a second reporting channel.
 */
export type UnresolvedArea = 'view-columns' | 'subtype-membership';

/**
 * What the resolution unit still owes, in one place (§9.4–§9.6, §17).
 *
 * Areas left this list as they were implemented: `relation-endpoints` and `page-resolution`
 * (`relations.ts`, `pages.ts`), then `domain-resolution` and `common-columns` (`domains.ts`,
 * `common-columns.ts`), and finally `view-columns` and `subtype-membership`, which are answered by
 * declaring the columns unknown and the membership unsupported (`views.ts`, `subtypes.ts`).
 */
export const UNRESOLVED_AREAS: readonly UnresolvedArea[] = [];

/** The bounded semantic result: every finding, its diagnostics, and the boundary. */
export interface PartialSemantics {
  /** Every object, duplicates included (§9.1). */
  readonly identities: readonly ObjectIdentity[];
  readonly duplicateNames: readonly DuplicateObjectName[];
  readonly missingRequired: readonly MissingRequiredKeys[];
  /** One entry per object that declares at least one usable ordinal. */
  readonly primaryKeys: readonly InferredPrimaryKey[];
  readonly pkConflicts: readonly PkOrderConflict[];
  /** Objects whose key cannot be verified because an ordinal did not decode (R23). */
  readonly indeterminateKeys: readonly IndeterminateKey[];
  readonly legacyOnlyIndexes: readonly LegacyOnlyIndex[];
  /** Every relation, with both endpoints' resolution status (§9.2). */
  readonly relations: readonly ResolvedRelation[];
  readonly danglingEntities: readonly EndpointReference[];
  readonly ambiguousEntities: readonly EndpointReference[];
  readonly danglingColumns: readonly DanglingColumn[];
  readonly fieldCountMismatches: readonly FieldCountMismatch[];
  /** `[Manager].PageInfo` declarations, duplicates retained (§9.3, P11). */
  readonly pages: readonly PageDeclaration[];
  readonly duplicatePages: readonly DuplicatePage[];
  /** Every `Position` page reference, verbatim, with what it resolved to (§P9). */
  readonly pageReferences: readonly PageReference[];
  /** `[Manager].DomainInfo` declarations and every `Field` type that names one (§9.4, P12). */
  readonly domains: readonly DomainDeclaration[];
  readonly duplicateDomains: readonly DuplicateDomain[];
  readonly domainReferences: readonly DomainReference[];
  /** The common columns and every entity's composed column list (§9.4, P12). */
  readonly commonFields: readonly CommonColumnDeclaration[];
  readonly duplicateCommonFields: readonly DuplicateCommonColumn[];
  readonly entityColumns: readonly EntityColumns[];
  /** Entities whose `UsingCommonColumns` could not be decided, so `effective` is not final. */
  readonly indeterminateColumnLists: readonly EntityColumns[];
  /** Every `[View]`, each with `effectiveColumns: { status: 'unknown' }` (§9.6, P10). */
  readonly views: readonly ViewDeclaration[];
  /** Views whose `LNameByComment` did not decode, so even the reason is indeterminate (P10). */
  readonly indeterminateViewNames: readonly ViewDeclaration[];
  /** Every `[Subtype]`, each with `membership: { status: 'unsupported' }` (§9.6, F7). */
  readonly subtypes: readonly SubtypeDeclaration[];
  /** Ordered by line (§12 rule 7). */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The §9 work this stage does not do. Empty now — see the header: an empty list is not a finished
   * product.
   */
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
 * - **one `V_INDEX_LEGACY_ONLY` per object** whose only index evidence is legacy (fmt-02, sem-04);
 * - **one `V_VIEW_COLUMNS_UNKNOWN` per `[View]`** and **one `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` per
 *   `[Subtype]`**, pointing at the object's `PName` line (§9.6, P10, F7). Both are `info` and
 *   unconditional: every view and every subtype carries one, because the fact they state is true of
 *   every view and every subtype in v2.21 and a reader must be able to count them. Emitting them
 *   here — once per object, from the object's own record — is what keeps the count honest.
 */
export function derivePartialSemantics(classification: Classification): PartialSemantics {
  const identity = identitiesOf(classification);
  const missingRequired = missingRequiredKeysOf(classification);
  const primaryKey = primaryKeysOf(classification);
  const legacyOnlyIndexes = legacyOnlyIndexesOf(classification);
  const relations = relationsOf(classification);
  const pages = pagesOf(classification);
  const domains = domainsOf(classification);
  const columns = commonColumnsOf(classification);
  const views = viewsOf(classification);
  const subtypes = subtypesOf(classification);

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

  // One finding per dangling name per relation: an endpoint that names nothing, and each column
  // that cannot be verified against the entity on its side (sem-01 has one of each).
  for (const finding of relations.danglingEntities) {
    diagnostics.push(
      emitSemantic('V_DANGLING_ENTITY', {
        details: { endpoint: finding.endpoint, declared: finding.declared },
        span: finding.span,
        construct: 'Relation',
      }),
    );
  }

  for (const finding of relations.danglingColumns) {
    diagnostics.push(
      emitSemantic('V_DANGLING_COLUMN', {
        details: { endpoint: finding.endpoint, column: finding.column, entity: finding.entity },
        span: finding.span,
        construct: 'Relation',
      }),
    );
  }

  for (const finding of relations.countMismatches) {
    diagnostics.push(
      emitSemantic('V_FIELD_COUNT_MISMATCH', {
        details: { from: finding.fromCount, to: finding.toCount },
        span: finding.span,
        construct: 'Relation',
      }),
    );
  }

  // One finding per placement that names a page nobody declared (sem-01's `GhostPage`).
  for (const reference of pages.danglingReferences) {
    diagnostics.push(
      emitSemantic('V_DANGLING_PAGE', {
        details: { page: reference.declared, section: reference.sectionKind },
        span: reference.span,
        construct: 'Position',
      }),
    );
  }

  // One finding per view, whatever made its columns unavailable (§9.6, P10). The reason travels in
  // `details`: two views with the same reason are two findings, ordered by line like every other.
  for (const view of views.views) {
    diagnostics.push(
      emitSemantic('V_VIEW_COLUMNS_UNKNOWN', {
        details: { view: view.pname ?? '', reason: view.effectiveColumns.reason },
        span: view.span,
        construct: 'View',
      }),
    );
  }

  // One finding per subtype: membership has no key in v2.21 (F7, K11), so the finding is a fact
  // about the format rather than about this file, and it is emitted for every subtype alike.
  for (const subtype of subtypes.subtypes) {
    diagnostics.push(
      emitSemantic('V_UNSUPPORTED_SUBTYPE_MEMBERSHIP', {
        details: { subtype: subtype.pname ?? '', reason: subtype.membership.reason },
        span: subtype.span,
        construct: 'Subtype',
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
    indeterminateKeys: primaryKey.indeterminate,
    legacyOnlyIndexes,
    relations: relations.relations,
    danglingEntities: relations.danglingEntities,
    ambiguousEntities: relations.ambiguousEntities,
    danglingColumns: relations.danglingColumns,
    fieldCountMismatches: relations.countMismatches,
    pages: pages.pages,
    duplicatePages: pages.duplicates,
    pageReferences: pages.references,
    domains: domains.domains,
    duplicateDomains: domains.duplicates,
    domainReferences: domains.references,
    commonFields: columns.commonFields,
    duplicateCommonFields: columns.duplicates,
    entityColumns: columns.entities,
    indeterminateColumnLists: columns.indeterminate,
    views: views.views,
    indeterminateViewNames: views.views.filter((view) => view.lnameByComment.origin === 'invalid'),
    subtypes: subtypes.subtypes,
    diagnostics,
    unresolved: UNRESOLVED_AREAS,
  };
}
