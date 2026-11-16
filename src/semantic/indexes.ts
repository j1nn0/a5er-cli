/**
 * Legacy-only index data (`architecture.md` §6 row 6, §11 `V_INDEX_LEGACY_ONLY`; D5, L6, U7).
 *
 * The 2.21 document tells readers to ignore `Index`/`IndexOption` and use `IndexInfo`. Followed
 * literally, every index in an older file disappears silently — which is why §6 decodes both
 * spellings and this rule reports the case where the legacy spelling is the *only* evidence. The
 * data is kept either way: this is a warning about provenance, not a filter.
 *
 * The rule is deliberately profile-free. `fmt-02` (`FORMAT:19`, legacy by declaration) and `sem-04`
 * (`FORMAT:21`, legacy by compatibility) both declare exactly one `V_INDEX_LEGACY_ONLY`, because in
 * both the object has legacy index data and no canonical data. The profile is *recorded* on the
 * finding — a consumer comparing `declared` sees which situation it is — but it does not decide
 * whether the finding exists.
 */

import type { Span } from '../model/span.js';
import type { FormatProfile } from '../schema/profiles.js';
import type { DecodedLegacyIndex } from '../schema/indexinfo.js';
import type { Classification } from '../schema/registry.js';

/** An object whose only index data uses the legacy spelling. */
export interface LegacyOnlyIndex {
  readonly sectionIndex: number;
  /** The object's `PName`, or `''` when it declared none. */
  readonly object: string;
  /** The first legacy `Index` line: the evidence the warning is about. */
  readonly span: Span;
  /** The profile the file was read under, recorded as provenance (§6). */
  readonly profile: FormatProfile;
  /** Every legacy index record of the object, decoded and kept. */
  readonly legacyRecords: readonly DecodedLegacyIndex[];
  /** How many canonical `IndexInfo` records the object has — always `0` when reported. */
  readonly canonicalCount: number;
}

/** The object's `PName`, or `''` for an object that never declared one. */
function objectNameOf(section: Classification['sections'][number]): string {
  let name = '';
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed' || entry.occurrence.spec.key !== 'PName') continue;
    if (!entry.occurrence.decoded.ok) continue;
    const value = entry.occurrence.decoded.value.value;
    if (typeof value === 'string') name = value;
  }
  return name;
}

/**
 * Find the objects whose index evidence is legacy-only.
 *
 * One finding per object, because the finding is about the object's index *source*, not about each
 * `Index` line — an object with `Index` and `IndexOption` and no `IndexInfo` is one such case.
 */
export function legacyOnlyIndexesOf(classification: Classification): LegacyOnlyIndex[] {
  const findings: LegacyOnlyIndex[] = [];

  for (const section of classification.sections) {
    const indexes = section.decoded.indexes;
    if (indexes.legacy.length === 0) continue;
    if (indexes.canonical.length > 0) continue;

    const first = indexes.legacy[0];
    if (first === undefined) continue;

    findings.push({
      sectionIndex: section.index,
      object: objectNameOf(section),
      span: first.span,
      profile: classification.profile,
      legacyRecords: indexes.legacy,
      canonicalCount: indexes.canonical.length,
    });
  }

  return findings;
}
