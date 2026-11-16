/**
 * Object identity (`architecture.md` §9.1, P6, §4.2).
 *
 * The specification says a physical name (`PName`) is unique **across all objects in the diagram**
 * («ER図内の全オブジェクトでユニーク», P6), and that is the only identity rule this project may act on
 * without inventing one. Two consequences shape this module:
 *
 * - **Uniqueness spans section kinds.** `[Entity]`, `[View]` and `[Subtype]` all declare `PName`,
 *   so a name collision between an entity and a view is the same finding as one between two
 *   entities (sem-08). `[Manager]` and the other sections are not objects and take no part.
 * - **Nothing is deduplicated.** Every declaring section stays an identity in the list; the
 *   duplicate is a *finding about* those identities, never a merge. A consumer that collapsed them
 *   would lose the second object's spans, which is exactly what §4.3 forbids.
 *
 * `Position` lines are **placements, not objects** (§P11: one object may sit on several pages), so
 * an object with three `Position` lines is one identity with three placements.
 */

import type { Span } from '../model/span.js';
import type { Classification, ClassifiedSection, KeyOccurrence } from '../schema/registry.js';

/** A section kind that declares an object identity (§9.1). */
export type ObjectKind = 'Entity' | 'View' | 'Subtype';

/** One object, as declared. */
export interface ObjectIdentity {
  /** `PName` as interpreted (quotes removed, escapes applied); never normalised further. */
  readonly pname: string;
  readonly kind: ObjectKind;
  /** 1-based section ordinal the object was declared in. */
  readonly sectionIndex: number;
  /** Header text exactly as written, so the object is traceable even with an odd name. */
  readonly sectionHeader: string;
  /** Every span that declares this name: all `PName` lines (more than one is a duplicate key). */
  readonly spans: readonly Span[];
  /** How many `Position` lines place it. Placements, not extra objects (§P11). */
  readonly placements: number;
}

/** A name declared by more than one object (§11 `V_DUPLICATE_OBJECT_NAME`). */
export interface DuplicateObjectName {
  readonly pname: string;
  /** Every identity that declares it, in file order. All of them are kept. */
  readonly identities: readonly ObjectIdentity[];
  /** Every declaring span, in file order. */
  readonly spans: readonly Span[];
}

/**
 * The identity rule's answer for one document.
 *
 * Findings only: the diagnostics for them are emitted in one place (`partial.ts`), so the code,
 * the severity and the count live together instead of being spread over four modules.
 */
export interface IdentityResult {
  readonly identities: readonly ObjectIdentity[];
  readonly duplicates: readonly DuplicateObjectName[];
}

/** `[Entity]`, `[View]` and `[Subtype]` declare objects; nothing else does (§9.1). */
function objectKindOf(section: ClassifiedSection): ObjectKind | null {
  switch (section.kind) {
    case 'Entity':
    case 'View':
    case 'Subtype':
      return section.kind;
    default:
      return null;
  }
}

/** The `PName` occurrences of a section, in file order. */
function pnameOccurrences(section: ClassifiedSection): KeyOccurrence[] {
  const found: KeyOccurrence[] = [];
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed') continue;
    if (entry.occurrence.spec.key !== 'PName') continue;
    found.push(entry.occurrence);
  }
  return found;
}

/** The interpreted value of one occurrence, when it decoded to a string. */
function stringValue(occurrence: KeyOccurrence): string | null {
  if (!occurrence.decoded.ok) return null;
  const value = occurrence.decoded.value.value;
  return typeof value === 'string' ? value : null;
}

/**
 * Every object the document declares, plus the names declared more than once.
 *
 * Pure: reads the classification, allocates its own structures, mutates nothing.
 */
export function identitiesOf(classification: Classification): IdentityResult {
  const identities: ObjectIdentity[] = [];

  for (const section of classification.sections) {
    const kind = objectKindOf(section);
    if (kind === null) continue;
    const occurrences = pnameOccurrences(section);
    if (occurrences.length === 0) continue;

    // §4.2: a repeated scalar is last-wins for the *value*; every occurrence keeps its span.
    const selected = occurrences.at(-1);
    const pname = selected === undefined ? null : stringValue(selected);
    if (pname === null) continue;

    identities.push({
      pname,
      kind,
      sectionIndex: section.index,
      sectionHeader: section.headerRaw,
      spans: occurrences.flatMap((occurrence) =>
        occurrence.span === null ? [] : [occurrence.span],
      ),
      placements: section.decoded.positions.length,
    });
  }

  /** Group by name; a group of one is unique (§9.1's rule is exactly this comparison). */
  const byName = new Map<string, ObjectIdentity[]>();
  for (const identity of identities) {
    const existing = byName.get(identity.pname);
    if (existing === undefined) byName.set(identity.pname, [identity]);
    else existing.push(identity);
  }

  const duplicates: DuplicateObjectName[] = [];
  for (const [pname, group] of byName) {
    if (group.length < 2) continue;
    duplicates.push({
      pname,
      identities: group,
      spans: group.flatMap((identity) => identity.spans),
    });
  }

  return { identities, duplicates };
}
