/**
 * The pre-scan shape of a decoded document (U5; `architecture.md` §10.5, §13).
 *
 * Admission has to refuse a document before the scan builds its records, so the figures such a
 * decision rests on must be countable without them: this module walks the text once and keeps
 * counters. It decides nothing — no weights, no thresholds, no refusal, no diagnostic — the same
 * way `budget/measure.ts` decides nothing; that module measures the **finished** scan, this one
 * measures the **text**, and the two must agree.
 *
 * Three rules keep the two paths from drifting apart:
 *
 * 1. **One classification.** A line is classified by the scan's own `classify()`, and a header's
 *    kind by the scan's own `sectionKindOf()`. Nothing here re-implements §7.3/§7.4's decision
 *    order or §5's alias table, so `[a=b]` stays a header, `[Relationship]` is a relation,
 *    `[entity]` is unknown and ` Field=` is a key named ` Field`.
 * 2. **Counters, not records.** The walk retains a fixed group of counts plus the current
 *    section's kind and ordinal. No line array, no record array, no per-line map, no copy of the
 *    text: the only allocation per line is the temporary record `forEachLine` hands to the
 *    callback, and nothing of it outlives the callback.
 * 3. **Checked before published.** Every published figure is proven to be a non-negative safe
 *    integer, and §13's line partition is proven to add up, before the result is returned. A count
 *    that fails either check is an internal defect — `RangeError`, naming the field and never the
 *    document — and is thrown rather than published.
 *
 * Purity: the input is a string and the output depends only on it; no filesystem, no clock, no
 * environment, no second pass over the text. That the counters agree with `scanSource`'s §13
 * accounting and with `measure().counters.entityFieldOccurrences` is pinned on every committed
 * synthetic fixture in `tests/budget-measure.test.ts`, because two bookkeeping paths that are only
 * *argued* to agree are exactly how one of them stops counting a line (§13).
 */

import { forEachLine } from './lines.js';
import { classify } from './scanner.js';
import type { SyntaxAccounting } from './scanner.js';
import { sectionKindOf } from './sections.js';
import type { SectionKind } from './sections.js';

/**
 * What the text looks like before it is scanned (§10.5, §13).
 *
 * Occurrences, not verdicts: `entityFieldOccurrences` says how many `Field=` lines sit in
 * `[Entity]` sections, not how many columns a decode would produce, and `contentLineOccurrences`
 * says how many lines carry data, not how much of it is understood.
 */
export interface SourceShape {
  /**
   * §13's line partition, counted over the physical lines instead of the scan's records.
   *
   * The same shape as `SyntaxAccounting['lines']` on purpose: the pre-scan figure is only usable
   * if it is the scan's figure, field for field, and the agreement test compares them as objects
   * and per field.
   */
  readonly lines: SyntaxAccounting['lines'];
  /**
   * `Field=` lines inside `[Entity]` sections, in every such section, named or not.
   *
   * The same figure `measure().counters.entityFieldOccurrences` derives from the finished scan:
   * the key is compared as written (a ` Field` or `Field ` line is a different key), a wrong-case
   * or aliased header (`[entity]`, `[Manager]`, `[Relationship]`) is not an `[Entity]` section, and
   * a line before the first header belongs to no section at all.
   */
  readonly entityFieldOccurrences: number;
  /**
   * Lines that carry data: section headers, `key=value` lines and raw lines together.
   *
   * Comments and blank lines are excluded (§7.4: they are not data), and the three terms are §13's
   * own partition members, so this is `total - comments - blank` for any document the scan
   * reconciles.
   */
  readonly contentLineOccurrences: number;
}

/**
 * Measure `text` without building anything proportional to its line count (§10.5, U5).
 *
 * One `forEachLine` pass, the scan's own classification rules, and a fixed group of counters. The
 * section a line belongs to is tracked the way `scanSource` tracks it: `0` before the first
 * header, then that header's 1-based ordinal, with the kind coming from `sectionKindOf()` — so
 * `[Relationship]` counts as `Relation` and `[entity]` as `unknown`, never as `Entity`.
 */
export function measureSourceShape(text: string): SourceShape {
  let total = 0;
  let sectionHeaders = 0;
  let keys = 0;
  let comments = 0;
  let blank = 0;
  let raw = 0;
  let entityFieldOccurrences = 0;

  // The section the next line belongs to, exactly as the scan assigns it: the header line itself
  // is classified under the *previous* section's ordinal, and the increment happens after.
  let sectionIndex = 0;
  let sectionKind: SectionKind | null = null;

  forEachLine(text, (line) => {
    const classified = classify(line, sectionIndex);
    total += 1;

    switch (classified.kind) {
      case 'header': {
        sectionIndex += 1;
        sectionKind = sectionKindOf(classified.name);
        sectionHeaders += 1;
        break;
      }
      case 'blank': {
        blank += 1;
        break;
      }
      case 'comment': {
        comments += 1;
        break;
      }
      case 'key': {
        keys += 1;
        // Exact key text, as the registry reads it, and only inside an `[Entity]` section: before
        // the first header there is no section, so there is no entity to belong to.
        if (sectionKind === 'Entity' && classified.key === 'Field') entityFieldOccurrences += 1;
        break;
      }
      case 'raw-line': {
        raw += 1;
        break;
      }
    }
  });

  const lines: SyntaxAccounting['lines'] = {
    total: checkedCount(total, 'lines.total'),
    sectionHeaders: checkedCount(sectionHeaders, 'lines.sectionHeaders'),
    keys: checkedCount(keys, 'lines.keys'),
    comments: checkedCount(comments, 'lines.comments'),
    blank: checkedCount(blank, 'lines.blank'),
    raw: checkedCount(raw, 'lines.raw'),
  };

  // §13's partition, checked rather than assumed: a remainder means this walk lost or double-counted
  // a line, which must stop the caller instead of becoming a plausible-looking figure.
  const accounted = checkedSum(
    [lines.sectionHeaders, lines.keys, lines.comments, lines.blank, lines.raw],
    'lines.partition',
  );
  if (accounted !== lines.total) {
    throw new RangeError(
      `measureSourceShape(): lines.partition accounts for ${accounted} of ${lines.total} lines`,
    );
  }

  return {
    lines,
    entityFieldOccurrences: checkedCount(entityFieldOccurrences, 'entityFieldOccurrences'),
    contentLineOccurrences: checkedSum(
      [lines.sectionHeaders, lines.keys, lines.raw],
      'contentLineOccurrences',
    ),
  };
}

/**
 * `value` when it is a non-negative safe integer, else a `RangeError` naming `field`.
 *
 * The same rule `budget/measure.ts` applies to the figures it publishes, kept local so the syntax
 * layer does not import the budget layer: a counter here is incremented by one per physical line,
 * so anything else is a defect in this module, never a property of a document.
 */
function checkedCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`measureSourceShape(): ${field} is not a non-negative safe integer`);
  }
  return value;
}

/**
 * The sum of non-negative safe integers, else a `RangeError` naming `field`.
 *
 * Each term and the running total are checked, so a sum that leaves the safe range is refused
 * rather than published with lost precision. The terms arrive as a fixed-size array literal — no
 * list grows with the input.
 */
function checkedSum(terms: readonly number[], field: string): number {
  let sum = 0;
  for (const term of terms) {
    sum = checkedCount(sum, field) + checkedCount(term, field);
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(`measureSourceShape(): ${field} exceeds the safe-integer range`);
    }
  }
  return sum;
}
