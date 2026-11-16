/**
 * Primary-key inference (`architecture.md` §9.2, P8, F4).
 *
 * The format has **no primary-key object**: the key is `Field` element 5, キー順, a `0`-based
 * ordinal (P8). What this module does is the smallest honest reading of that:
 *
 * - take the ordinals that decoded exactly (R19: an unsafe or malformed token is not an ordinal and
 *   is skipped, not guessed);
 * - sort by ordinal;
 * - mark the result `origin: 'inferred'` and cite every `Field` line it came from, because §4.2
 *   requires an inferred value to travel with the facts it was inferred from.
 *
 * **Nothing is repaired.** A gap (`0`, `2`), a repeat (`0`, `0`) or a sequence that does not start at
 * `0` is reported as `V_PK_ORDER_CONFLICT` and left exactly as declared — no renumbering, no filling
 * the hole, no dropping the duplicate. A repaired key would look like a fact the file never stated,
 * which is the failure mode this project exists to avoid (§13, L4).
 *
 * Deferred to the resolution work: joining these columns to the declared `Field` entries as a
 * `Value<...>` with `derivedFrom`, and any comparison against `IndexInfo` (P8 keeps them separate).
 */

import type { Span } from '../model/span.js';
import type { Classification } from '../schema/registry.js';

/** One column of an inferred key, with the ordinal the file declared. */
export interface InferredPrimaryKeyColumn {
  /** The column's physical name (`Field` element 2) as interpreted. */
  readonly pname: string;
  /** The declared キー順 ordinal. */
  readonly ordinal: number;
  /** The `Field` line the ordinal came from. */
  readonly span: Span;
}

/** The key inferred for one object. */
export interface InferredPrimaryKey {
  readonly sectionIndex: number;
  /** The object's `PName`, so the key is addressable without re-reading the section. */
  readonly object: string;
  /** Columns in ordinal order. Empty when the object declares no ordinals at all. */
  readonly columns: readonly InferredPrimaryKeyColumn[];
  readonly origin: 'inferred';
  /** Every `Field` span the inference used (§4.2: an inferred value cites its inputs). */
  readonly derivedFrom: readonly Span[];
}

/** Why a declared ordinal sequence is not a key. */
export type PkConflictReason = 'gap' | 'duplicate' | 'not-zero-based';

/** A sequence that cannot be a key, reported instead of repaired. */
export interface PkOrderConflict {
  readonly sectionIndex: number;
  readonly object: string;
  /** The ordinals exactly as declared, in declaration order. */
  readonly ordinals: readonly number[];
  readonly reason: PkConflictReason;
  /** Every contributing `Field` span, in declaration order. */
  readonly spans: readonly Span[];
}

export interface PrimaryKeyResult {
  /** One entry per object that declares at least one usable ordinal. */
  readonly keys: readonly InferredPrimaryKey[];
  readonly conflicts: readonly PkOrderConflict[];
}

/** The object's `PName`, or `null` when it never declared one (that is the required-key finding). */
function objectNameOf(section: Classification['sections'][number]): string | null {
  let name: string | null = null;
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed' || entry.occurrence.spec.key !== 'PName') continue;
    if (!entry.occurrence.decoded.ok) continue;
    const value = entry.occurrence.decoded.value.value;
    if (typeof value === 'string') name = value;
  }
  return name;
}

/**
 * Infer one key per `[Entity]` section, and report the sequences that are not keys.
 *
 * `Field` exists only in `[Entity]` (§P6: views have no columns), so no other section can carry a
 * key; an entity with no ordinals simply has no key, which is legal (§P11's zero-`Field` entity and
 * sem-11's `no_fields`).
 */
export function primaryKeysOf(classification: Classification): PrimaryKeyResult {
  const keys: InferredPrimaryKey[] = [];
  const conflicts: PkOrderConflict[] = [];

  for (const section of classification.sections) {
    if (section.kind !== 'Entity') continue;

    const declared = section.decoded.fields
      .filter((field) => field.keyOrder !== null)
      .map((field) => ({
        pname: field.physicalName.value,
        ordinal: field.keyOrder?.value ?? 0,
        span: field.span,
      }))
      // Stable by construction: `sort` is stable in ES2019+, so equal ordinals keep file order.
      .sort((left, right) => left.ordinal - right.ordinal);

    if (declared.length === 0) continue;

    const object = objectNameOf(section) ?? '';
    keys.push({
      sectionIndex: section.index,
      object,
      columns: declared,
      origin: 'inferred',
      derivedFrom: declared.map((column) => column.span),
    });

    const ordinals = declared.map((column) => column.ordinal);
    const reason = conflictOf(ordinals);
    if (reason === null) continue;
    conflicts.push({
      sectionIndex: section.index,
      object,
      // Declaration order, not sorted order: the finding quotes what the file said.
      ordinals: section.decoded.fields
        .filter((field) => field.keyOrder !== null)
        .map((field) => field.keyOrder?.value ?? 0),
      reason,
      spans: declared.map((column) => column.span),
    });
  }

  return { keys, conflicts };
}

/** `null` for a unique `0..n-1` sequence; otherwise the reason it is not one. */
function conflictOf(ordinals: readonly number[]): PkConflictReason | null {
  if (new Set(ordinals).size !== ordinals.length) return 'duplicate';
  if (ordinals[0] !== 0) return 'not-zero-based';
  for (const [index, ordinal] of ordinals.entries()) {
    if (ordinal !== index) return 'gap';
  }
  return null;
}
