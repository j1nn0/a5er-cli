/**
 * Required keys (`architecture.md` §9, §11 `V_MISSING_REQUIRED_KEY`; `format-coverage.md` P6, P7,
 * P11).
 *
 * `KeySpec.required` is the only source of "required" in this project — the registry records what
 * the specification marks 必須, and this module reports when one of those keys never appears. No
 * default is invented for a missing key: `RelationType1`'s documented default of `1` is exactly the
 * case `format-coverage.md` K6 says to follow 必須 on, and §6's closing rule forbids reading a
 * value the file does not contain.
 *
 * **Granularity — one finding per subject, not per key.** A section that omits three required keys
 * yields one finding listing the three; a column that omits its colour yields one finding of its
 * own. That is the granularity the committed catalog expects (txt-09's empty `[Relation]` omits
 * seven required keys and the catalog records a single `V_MISSING_REQUIRED_KEY`), and it keeps the
 * diagnostic count stable when a file becomes emptier without becoming a different kind of defect.
 *
 * **Scope — `[Manager]` is one settings block, objects are one section each.** `PageInfo` is a
 * document-level requirement ("at least 1 page"), and 3B-1 already established that a repeated
 * `[Manager]` shares one document scope for its scalars. Judging it per section would report an
 * error for every repeated `[Manager]` that only carries `ProjectName` — a false finding on a file
 * that does declare pages. So the `[Manager]` requirements are evaluated over the union of its
 * sections and reported on the first one. Every other section is one object and is judged alone.
 *
 * **Severity is part of the finding.** §11 types this code "warning or error", with identity and
 * `PageInfo` as errors, so the finding carries the severity the report has to use.
 */

import type { Span } from '../model/span.js';
import type { Classification, ClassifiedSection } from '../schema/registry.js';
import { REGISTRY } from '../schema/registry.js';
import type { SectionKind } from '../syntax/sections.js';

/** The keys whose absence §11 calls an error rather than a warning. */
const ERROR_KEYS: ReadonlySet<string> = new Set(['PName', 'PageInfo']);

/** One subject that is missing at least one key the specification requires. */
export interface MissingRequiredKeys {
  /** `section` for a whole section; `column` for one `Field` inside it. */
  readonly subject: 'section' | 'column';
  readonly sectionIndex: number;
  readonly sectionKind: SectionKind;
  /** The absent key names, in registry order (or `['color']` for a column). */
  readonly keys: readonly string[];
  /** §11: `error` when the absent set includes an identity key or `PageInfo`, else `warning`. */
  readonly severity: 'warning' | 'error';
  /**
   * Where the finding points.
   *
   * The object's `PName` line when it declares one — that is the line the reader looks at to see
   * which object is incomplete (sem-10) — and the section header when it does not (sem-09's
   * `[Manager]`, txt-09's empty `[Relation]`). A column finding points at its `Field` line (val-05).
   */
  readonly span: Span;
  /** The column's physical name when `subject === 'column'`; `null` otherwise. */
  readonly column: string | null;
}

/**
 * The span a section-level finding points at: the identity line, or the header line when there is
 * none. Both are single-line spans, so the finding names one line rather than a region.
 */
function reportSpanOf(section: ClassifiedSection): Span {
  // `SectionScan.span.keyLine` is the header line by contract (`syntax/scanner.ts`), and the
  // classified section keeps that span verbatim; a finding points at the line, not at the region.
  let span: Span = {
    sectionIndex: section.index,
    startLine: section.span.keyLine,
    endLine: section.span.keyLine,
    keyLine: section.span.keyLine,
  };
  for (const entry of section.entries) {
    if (entry.kind !== 'parsed' || entry.occurrence.spec.key !== 'PName') continue;
    if (entry.occurrence.span !== null) span = entry.occurrence.span;
  }
  return span;
}

/** The key names a section actually declared, whether it decoded or was preserved raw. */
function declaredKeys(section: ClassifiedSection): Set<string> {
  const declared = new Set<string>();
  for (const entry of section.entries) {
    if (entry.kind === 'parsed') declared.add(entry.occurrence.spec.key);
    else if (entry.entry.key !== null) declared.add(entry.entry.key);
  }
  return declared;
}

/**
 * Every required key that is absent, grouped by the subject that is missing it.
 *
 * Pure: reads the classification and the registry, returns new findings.
 */
export function missingRequiredKeysOf(classification: Classification): MissingRequiredKeys[] {
  const findings: MissingRequiredKeys[] = [];

  // `[Manager]` is one document-wide settings block that may be split over repeated sections.
  const managers = classification.sections.filter((section) => section.kind === 'Manager');
  if (managers.length > 0) {
    const declared = new Set<string>();
    for (const manager of managers) {
      for (const key of declaredKeys(manager)) declared.add(key);
    }
    const absent = REGISTRY.Manager.filter((spec) => spec.required && !declared.has(spec.key)).map(
      (spec) => spec.key,
    );
    const first = managers[0];
    if (absent.length > 0 && first !== undefined) {
      findings.push({
        subject: 'section',
        sectionIndex: first.index,
        sectionKind: 'Manager',
        keys: absent,
        severity: absent.some((key) => ERROR_KEYS.has(key)) ? 'error' : 'warning',
        span: reportSpanOf(first),
        column: null,
      });
    }
  }

  for (const section of classification.sections) {
    // An unknown section has no registry, so "required" has no meaning there (§5).
    if (section.kind === 'unknown' || section.kind === 'Manager') continue;
    const declared = declaredKeys(section);
    const absent = REGISTRY[section.kind]
      .filter((spec) => spec.required && !declared.has(spec.key))
      .map((spec) => spec.key);
    if (absent.length === 0) continue;

    findings.push({
      subject: 'section',
      sectionIndex: section.index,
      sectionKind: section.kind,
      keys: absent,
      severity: absent.some((key) => ERROR_KEYS.has(key)) ? 'error' : 'warning',
      span: reportSpanOf(section),
      column: null,
    });
  }

  // A `Field` with fewer than eight elements has no colour slot at all (§7.2). The syntax stage has
  // already warned about the arity; this is the semantic half of the same defect, on the same span.
  for (const section of classification.sections) {
    for (const field of section.decoded.fields) {
      if (field.color !== null) continue;
      findings.push({
        subject: 'column',
        sectionIndex: section.index,
        sectionKind: section.kind,
        keys: ['color'],
        severity: 'warning',
        span: field.span,
        column: field.physicalName.value,
      });
    }
  }

  return findings;
}
