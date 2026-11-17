/**
 * Small readers over a `ClassifiedSection`.
 *
 * Three modules need the same three questions — "what is this object's `PName`?", "what did this
 * scalar key say?" and "was this integer key decoded?" — and each of them has exactly one correct
 * answer: the **last** occurrence (§4.2 last-wins), only when it decoded, and only from a `parsed`
 * entry (a raw-preserved line is evidence, not a value). Keeping the answer here is what stops the
 * three call sites from quietly disagreeing.
 */

import type { Span } from '../model/span.js';
import type { Classification, ClassifiedSection } from '../schema/registry.js';

/** A declared text value with the line it was written on. */
export interface TextReading {
  readonly value: string;
  readonly raw: string;
  readonly span: Span;
}

/** Every parsed occurrence of one key, in file order. */
function occurrencesOf(section: ClassifiedSection, key: string) {
  return section.entries.flatMap((entry) =>
    entry.kind === 'parsed' && entry.occurrence.spec.key === key && entry.occurrence.span !== null
      ? [{ occurrence: entry.occurrence, span: entry.occurrence.span }]
      : [],
  );
}

/** The last declared text value of `key`, or `null` when it is absent or did not decode to text. */
export function textOf(section: ClassifiedSection, key: string): TextReading | null {
  let found: TextReading | null = null;
  for (const { occurrence, span } of occurrencesOf(section, key)) {
    const decoded = occurrence.decoded;
    if (!decoded.ok) continue;
    const value = decoded.value.value;
    if (typeof value !== 'string') continue;
    found = { value, raw: occurrence.raw, span };
  }
  return found;
}

/** The last declared integer value of `key`, or `null` when it is absent or not an integer. */
export function integerOf(section: ClassifiedSection, key: string): number | null {
  let found: number | null = null;
  for (const { occurrence } of occurrencesOf(section, key)) {
    const decoded = occurrence.decoded;
    if (!decoded.ok) continue;
    const value = decoded.value.value;
    if (typeof value === 'number') found = value;
  }
  return found;
}

/** The object's `PName`, or `null` when it never declared one (that is a required-key finding). */
export function pnameOf(section: ClassifiedSection): string | null {
  return textOf(section, 'PName')?.value ?? null;
}

/** How many sections of one kind declare each `PName`. Duplicates stay visible as a count. */
export function pnameCounts(classification: Classification, kind: 'Entity'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of classification.sections) {
    if (section.kind !== kind) continue;
    const name = pnameOf(section);
    if (name === null) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
