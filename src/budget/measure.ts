/**
 * Deterministic structural measurement of one finished scan (F4; `architecture.md` §13).
 *
 * F4 asks how much work a document is allowed to make the pipeline do. Before any admission
 * decision can exist, the numbers such a decision would rest on have to be measurable,
 * reproducible and honest about what they are — and this module is that and nothing else. It
 * publishes **structural counters** (facts a line scan settles) and **two conservative upper
 * bounds**, and it decides nothing: no weights, no thresholds, no refusal, no diagnostics, no CLI
 * output. Calibration is a separate decision that needs measurements first.
 *
 * Three rules make the numbers usable:
 *
 * 1. **Nothing is re-counted.** Lines, sections, keys, comments, blanks, raw lines and the
 *    unknown-section split are §13's reconciliation, and `scan.accounting` already carries it.
 *    This module reuses that object **by reference** and never walks the records to produce a
 *    second opinion: a counter that disagreed with §13 would be a second bookkeeping path, which
 *    is exactly what §13 forbids.
 * 2. **Occurrences, not verdicts.** `entityFieldOccurrences` counts `Field=` lines inside
 *    `[Entity]` sections; it does not claim they decode and it is not a column count. The scan
 *    settles lines and headers only, so any decoded, adopted or resolved figure would be a guess
 *    here (§4.2's provenance rules). Key names and values are compared **as written**, because the
 *    registry looks keys up as written: no trimming, no case folding, no normalisation.
 * 3. **Kind, never name.** `[Relationship]` is a spelling of `Relation` (§5), so it counts as a
 *    relation section and its `Fields1`/`Fields2` lines count like any other; `[entity]` is
 *    `unknown`, so its keys count as unknown-section keys. Counting by header name would miss the
 *    alias and invent a second kind (`txt-02`, `txt-07`).
 *
 * Purity: the scan is read, never modified; the result is new and flat. No filesystem, process,
 * clock, environment or V8 heap figure is consulted, no parser or decoder is re-implemented, and
 * clock, environment or V8 heap figure is consulted, no parser or decoder is re-implemented, and
 * the same scan yields the same result. One pass over the sections and every section entry,
 * `O(S+E)` with `S` sections and `E` key plus raw-line entries, with a fixed-size group of
 * counters and no input-proportional intermediate array.
 *
 * Not to be confused with `src/text/tables.ts`, which has a private `measure(rows)` that measures
 * **column widths** for the `tables` renderer. Same word, unrelated job; this module never widens a
 * column.
 */

import type { SyntaxAccounting, SyntaxScan } from '../syntax/scanner.js';
import type { SectionKind } from '../syntax/sections.js';

/**
 * §13's totals plus the structural occurrences a line scan settles exactly.
 *
 * Every numeric member is a non-negative integer produced by a length or a count.
 *
 * Safe-integer scope (precondition, documented — not checked at runtime): a consistent
 * `SyntaxScan` produced from input accepted under the default read limits (`maxLines` 2,000,000,
 * `maxLineLength` 4 MiB, §10.2), measured while neither the scan nor its `accounting` is mutated.
 * Inside that scope the counters and the two bounds stay inside `Number.MAX_SAFE_INTEGER` (see
 * the bound docs for the figures). Outside it — larger custom limits, a scan built by hand or
 * without the read limits, an inconsistent `accounting`, or a scan mutated during or after
 * measuring — safe integers are NOT guaranteed, and `measure()` still does not refuse the input.
 */
export interface ResourceCounters {
  /** §13 `lines.total`: every physical line. Taken from `scan.accounting`, never recomputed. */
  readonly totalLines: number;
  /** §13 `sections.total`: every `[…]` header. From `scan.accounting`, never recomputed. */
  readonly totalSections: number;
  /** §13 `keys.total`: every `key=value` line. Taken from `scan.accounting`, never recomputed. */
  readonly totalKeys: number;
  /** §13 `lines.comments`: every `#` line. Taken from `scan.accounting`, never recomputed. */
  readonly totalComments: number;
  /** §13 `lines.blank`: every blank line. Taken from `scan.accounting`, never recomputed. */
  readonly totalBlankLines: number;
  /** §13 `lines.raw`: every raw line, the same set `S_MALFORMED_LINE` reports. */
  readonly totalRawLines: number;
  /** §13 `keys.inUnknownSections`: `key=value` lines in headers this project does not model. */
  readonly unknownSectionKeyOccurrences: number;
  /**
   * Section headers per canonical kind.
   *
   * `Relation` includes the `[Relationship]` spelling, and `unknown` includes every header outside
   * §5's list, including a wrong-case `[entity]`.
   */
  readonly sectionsByKind: Readonly<Record<SectionKind, number>>;
  /**
   * `Field=` lines inside `[Entity]` sections, in every such section, named or not.
   *
   * An occurrence, not a column: whether the line declares a usable field is the decoder's call.
   */
  readonly entityFieldOccurrences: number;
  /**
   * `CommonField=` lines inside `[Manager]` sections, in every such section.
   *
   * An occurrence, not a declaration: it is the largest possible count of them (see the bound).
   */
  readonly managerCommonFieldOccurrences: number;
  /**
   * `Fields1=` lines inside relation sections — `[Relation]` and `[Relationship]` alike.
   *
   * An occurrence, not a column: one line can declare several columns or none.
   */
  readonly relationFields1Occurrences: number;
  /**
   * `Fields2=` lines inside relation sections — `[Relation]` and `[Relationship]` alike.
   *
   * An occurrence, not a column: one line can declare several columns or none.
   */
  readonly relationFields2Occurrences: number;
  /** `UsingCommonColumns=` lines inside `[Entity]` sections, whatever their value says. */
  readonly entityUsingCommonColumnsOccurrences: number;
  /** UTF-16 code units of the raw `Fields1` value text, quoting and escapes included. */
  readonly fields1ValueCodeUnits: number;
  /** UTF-16 code units of the raw `Fields2` value text, quoting and escapes included. */
  readonly fields2ValueCodeUnits: number;
}

/**
 * Upper bound on the common columns every entity's effective list can adopt, with its two factors.
 *
 * An entity composes the document's decoded `CommonField` declarations when its
 * `UsingCommonColumns` resolves to `1`, and nothing otherwise, so the total across all entities is
 * at most `[Entity] section count × decoded declaration count`. The scan cannot decode, so the
 * second factor is replaced by the number of `CommonField=` lines, which is at least as large:
 * an occurrence that fails to decode only shrinks the real count.
 *
 * **Precondition (documented, not enforced): a consistent scan from input accepted under the
 * default read limits** (`maxLines` 2,000,000, `maxLineLength` 4 MiB, §10.2). Both factors are then
 * at most `2·10⁶` and the product is at most `4·10¹²` — three orders below
 * `Number.MAX_SAFE_INTEGER`. Tighter custom limits may also qualify, but arbitrary `Limits`
 * overrides, hand-built scans and mutated scans carry no guarantee (see `ResourceCounters`).
 * Because this is an *upper* bound, the product is deliberately **not** clamped:
 * `Math.min(MAX_SAFE_INTEGER, …)` would silently turn an over-estimate into an under-estimate —
 * and past the safe-integer range a product can lose precision and round *down*, so the lack of
 * clamping preserves the bound only inside the range above. `measure()` does not verify the
 * precondition at runtime; a future admission check must establish the integer range and the
 * scan's provenance before comparing (U3 design).
 */
export interface ComposedColumnsUpperBound {
  /** `[Entity]` sections the scan holds: each one composes a list, with or without a `PName`. */
  readonly entitySections: number;
  /** `CommonField=` lines in `[Manager]` sections: at least the declarations that can decode. */
  readonly managerCommonFieldOccurrences: number;
  /** The product of the two factors above, unclamped (safe only inside the precondition above). */
  readonly upperBound: number;
}

/** Conservative bounds derived from the counters; each is an over-estimate by construction inside the documented safe-integer scope. */
export interface ResourceBounds {
  /** Upper bound on the common columns all entities together can adopt. */
  readonly composedColumnsUpperBound: ComposedColumnsUpperBound;
  /**
   * Upper bound on the `Fields1`/`Fields2` slots the relation stage can list, both sides together.
   *
   * A Complex value of raw length `L` holds at most `L + 1` comma-separated slots (each separator
   * is one character of the raw text), summed over every such line in every relation section. The
   * sum is an over-estimate on purpose: it counts every occurrence, while the stage keeps one list
   * per key and may drop a trailing blank slot.
   */
  readonly relationColumnSlotsUpperBound: number;
}

/** One deterministic measurement of one scan. */
export interface ResourceMeasure {
  readonly counters: ResourceCounters;
  readonly bounds: ResourceBounds;
  /** The scan's §13 object, the same reference: the `total*` counters above are its fields.
   * TypeScript `readonly` is not a runtime freeze — a caller that mutates the scan during or after
   * measuring leaves the documented scope. No copy or deep freeze is added. */
  readonly accounting: SyntaxAccounting;
}

/**
 * Measure one scan.
 *
 * Returns a new record; the scan, its sections and its entries are only read. See the module
 * comment for why every figure here is a structural fact or a documented upper bound.
 */
export function measure(scan: SyntaxScan): ResourceMeasure {
  const sectionsByKind: Record<SectionKind, number> = {
    Manager: 0,
    Entity: 0,
    Relation: 0,
    View: 0,
    Subtype: 0,
    Shape: 0,
    Line: 0,
    Comment: 0,
    unknown: 0,
  };

  let entityFieldOccurrences = 0;
  let managerCommonFieldOccurrences = 0;
  let relationFields1Occurrences = 0;
  let relationFields2Occurrences = 0;
  let entityUsingCommonColumnsOccurrences = 0;
  let fields1ValueCodeUnits = 0;
  let fields2ValueCodeUnits = 0;

  for (const section of scan.sections) {
    sectionsByKind[section.kind] += 1;

    if (section.kind === 'Entity') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        // Exact key text: a ` Field` or `Field ` line is a different key, exactly as the registry
        // reads it, and is preserved as an unknown key rather than counted here.
        if (entry.key === 'Field') entityFieldOccurrences += 1;
        else if (entry.key === 'UsingCommonColumns') entityUsingCommonColumnsOccurrences += 1;
      }
    } else if (section.kind === 'Manager') {
      for (const entry of section.entries) {
        if (entry.kind === 'key' && entry.key === 'CommonField') managerCommonFieldOccurrences += 1;
      }
    } else if (section.kind === 'Relation') {
      for (const entry of section.entries) {
        if (entry.kind !== 'key') continue;
        if (entry.key === 'Fields1') {
          relationFields1Occurrences += 1;
          fields1ValueCodeUnits += entry.value.length;
        } else if (entry.key === 'Fields2') {
          relationFields2Occurrences += 1;
          fields2ValueCodeUnits += entry.value.length;
        }
      }
    }
  }

  const entitySections = sectionsByKind.Entity;

  return {
    counters: {
      totalLines: scan.accounting.lines.total,
      totalSections: scan.accounting.sections.total,
      totalKeys: scan.accounting.keys.total,
      totalComments: scan.accounting.lines.comments,
      totalBlankLines: scan.accounting.lines.blank,
      totalRawLines: scan.accounting.lines.raw,
      unknownSectionKeyOccurrences: scan.accounting.keys.inUnknownSections,
      sectionsByKind,
      entityFieldOccurrences,
      managerCommonFieldOccurrences,
      relationFields1Occurrences,
      relationFields2Occurrences,
      entityUsingCommonColumnsOccurrences,
      fields1ValueCodeUnits,
      fields2ValueCodeUnits,
    },
    bounds: {
      composedColumnsUpperBound: {
        entitySections,
        managerCommonFieldOccurrences,
        upperBound: entitySections * managerCommonFieldOccurrences,
      },
      // Σ(raw length + 1) over every `Fields1`/`Fields2` occurrence = Σ length + Σ 1.
      relationColumnSlotsUpperBound:
        fields1ValueCodeUnits +
        relationFields1Occurrences +
        fields2ValueCodeUnits +
        relationFields2Occurrences,
    },
    accounting: scan.accounting,
  };
}
