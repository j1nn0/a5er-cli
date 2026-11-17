/**
 * `validate/` — the integration layer: one status, one diagnostic sequence, one set of counts
 * (`architecture.md` §3 "Validate", §11, §12 rules 1/2/7, §13; `test-strategy.md` §8).
 *
 * **Why this module is here and not in `semantic/`.** §3's stage table gives `Validate` its own
 * contract — "emit diagnostics with severities and spans; must not re-parse, repair or rewrite the
 * file" — and §18 stage 5 is named `validate`. `semantic/` owns resolution and reconciles nothing
 * above itself; folding the collector into it would blur the boundary §3 draws between "resolve"
 * and "validate", and the layer also spans the decode, syntax and schema families, not just `V_`.
 * So there is one place for it: this file.
 *
 * **What this module is not.** It is not a second parser and not a second taxonomy. Every
 * diagnostic is passed through exactly as the stage that raised it produced it — same code, same
 * severity, same fixed message, same bounded details, same span, same count, duplicates included.
 * The only things decided here are the order they appear in, the status their severities imply, the
 * exit codes the commands will return, and the reconciliation of the counters §13 requires.
 * Nothing is re-derived from text and no `V_` code is invented.
 *
 * **Status is a function of severity alone** (§12 rule 1, `test-strategy.md` §8): any `fatal`
 * makes it `failed`, else any `error` or `warning` makes it `degraded`, else `ok`. `info`-only is
 * `ok` — that is why fmt-01 is `ok` with a `V_VIEW_COLUMNS_UNKNOWN` and txt-04 is `ok` with two
 * unknown keys.
 *
 * **One sequence, ordered by the file** (§12 rule 7). Primary key is `span.startLine`; a
 * diagnostic with no span is about the whole input and sorts before line 1, the same `?? 0`
 * convention `semantic/partial.ts` uses. Same-line ties break on the fixed stage order
 * decode → syntax → schema → semantic, then on the code string compared by UTF-16 code unit (not
 * `localeCompare`, which would depend on the environment). Sorting is stable, so two diagnostics
 * that agree on all three keys keep the stage order they were produced in.
 *
 * **Fatal means no schema evidence.** A rejected read cannot have been scanned or classified, so
 * the input type has no slots for those stages and a `failed` result carries `completeness: null`
 * and an empty `unsupported`: the type says "nothing was parsed", so no caller can print a partial
 * diagram from a fatal input (§10.2, §14 row 11).
 *
 * **Completeness is reconciled, not asserted** (§13, §12 rule 2). The counters come from the two
 * stages that already derived them — the scan's line ledger and the classification's section/key
 * partition — and this layer checks the arithmetic identity between them instead of counting again.
 * §13 is explicit that a second bookkeeping path is the failure mode to avoid, so nothing here
 * increments a counter: it compares the two derivations, recomputes the unknown-section count from
 * the stored sections, and refuses to return a result whose remainder is not zero.
 *
 * **Unsupported is evidence, not a judgement** (§13, §12 rule 7). The list holds the retained
 * `RawEntry` records (unknown sections, unknown keys, continuation lines) plus the two unmodelled
 * constructs §13 names that have no `RawEntry`: a `Position` whose shape the documents do not
 * state, and a `Subtype` whose membership key does not exist in v2.21. Each record keeps the raw
 * text and the span it came from, and each is a projection of a record that already exists in the
 * classification or the semantics — no line is claimed twice, and the line ledger above stays a
 * partition of physical lines only.
 *
 * Two observations this unit records rather than fixes, both pinned by an assertion in
 * `tests/validate-integration.test.ts`: `RetentionKind` declares `'unsupported-construct'`, but no
 * code path produces it — an unsupported `Position` shape lives in `section.decoded.positions`
 * instead, so it would be invisible if this layer did not project it; and `Classification.problems`
 * (invalid numeric tokens) is deliberately **not** folded into `unsupported`, because §13 does not
 * list it and §11 assigns it no code. Those records stay in the classification the caller already
 * holds, and neither they nor any other indeterminate marker (`indeterminateKeys`,
 * `indeterminateColumnLists`, `indeterminateViewNames`, `ambiguousEntities`) is upgraded to a
 * diagnostic or downgraded to a resolved fact here.
 *
 * Pure: no filesystem, no clock, no environment, no stdout, no `process.exit`. The exit codes are
 * data. Serialisation, snapshots and the commands themselves are later stages (§18 stages 6–7).
 */

import type { LoadOutcome } from '../decode/load.js';
import type { Diagnostic, Severity } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';
import type { Classification, RawEntry, RetentionKind } from '../schema/registry.js';
import type { PartialSemantics } from '../semantic/partial.js';
import type { SyntaxScan } from '../syntax/scanner.js';
import type { SectionKind } from '../syntax/sections.js';

/** §12 rule 1's three states, decided from severities alone (`test-strategy.md` §8). */
export type IntegrationStatus = 'ok' | 'degraded' | 'failed';

/**
 * The exit code each command must use for this result.
 *
 * Data, not behaviour: no command runs in this stage (§18 stage 7), and a test compares the numbers
 * instead of spawning a process. `inspect` is non-zero only for a fatal input, because
 * `architecture.md` §12 rule 1 makes a `degraded` envelope a successful inspection; `validate`
 * returns `3` when a validation `error` exists (§11's Exit column, TBD-O7, `test-strategy.md` §14
 * stage 5: sem-08 and sem-09 exit 3 under `validate` and 0 under `inspect`).
 */
export interface ExitPolicy {
  readonly inspect: 0 | 1;
  readonly validate: 0 | 1 | 3;
}

/** §13's section partition: every header is either modelled or preserved raw. */
export interface SectionCounts {
  readonly total: number;
  /** Headers whose section kind this build models. */
  readonly parsed: number;
  /** Headers kept as `unknown-section` evidence. */
  readonly preservedRaw: number;
  /** `preservedRaw` seen from the stored sections instead of the counter (they must agree). */
  readonly unknown: number;
}

/** §13's key partition: every `key=value` line is either parsed or preserved raw. */
export interface KeyCounts {
  readonly total: number;
  readonly parsed: number;
  readonly preservedRaw: number;
}

/** §13's line ledger: the five record kinds must sum to the physical line count. */
export interface LineLedger {
  readonly total: number;
  readonly accounted: number;
  readonly dropped: number;
}

/** The counters §13 requires, as this layer reconciled them. */
export interface IntegrationCompleteness {
  readonly sections: SectionCounts;
  readonly keys: KeyCounts;
  readonly lines: LineLedger;
  /** Arithmetic remainder of all three partitions; `0` by reconciliation (§12 rule 2). */
  readonly dropped: number;
}

/**
 * The vocabulary of the `unsupported` list.
 *
 * The four `RetentionKind` members are §4.3's; the other two are §13's unmodelled constructs that
 * the classification does not keep as a `RawEntry`. They are evidence kinds, never diagnostics:
 * no severity, no code, and no new `V_*`.
 */
export type UnsupportedKind = RetentionKind | 'unsupported-position' | 'subtype-membership';

/** §13/§12 rule 7 evidence: one construct that was read and deliberately not modelled. */
export interface UnsupportedEvidence {
  readonly kind: UnsupportedKind;
  readonly sectionKind: SectionKind;
  /** Header text exactly as written; `''` for the region before the first header. */
  readonly sectionHeader: string;
  /** Key text exactly as written; `null` when the record is not about a `key=value` line. */
  readonly key: string | null;
  /** The original text this record is about: a line, a header, or a value. Never a paraphrase. */
  readonly raw: string;
  readonly span: Span;
  /** Stable machine reason, e.g. `no-registry-entry`; never file text. */
  readonly reason: string;
}

/** The parts both outcomes share. */
interface IntegrationBase {
  /** One ordered sequence spanning the decode, syntax, schema and semantic stages. */
  readonly diagnostics: readonly Diagnostic[];
  readonly exitPolicy: ExitPolicy;
}

/** A read that produced a document: counts and evidence exist. */
export interface CompletedIntegration extends IntegrationBase {
  readonly status: 'ok' | 'degraded';
  readonly completeness: IntegrationCompleteness;
  readonly unsupported: readonly UnsupportedEvidence[];
}

/**
 * A rejected read (§11 fatal family).
 *
 * `completeness` is `null` and `unsupported` is empty on purpose: there is no scan and no
 * classification, so inventing counts would be the "partial diagram" §14 row 11 forbids.
 */
export interface FailedIntegration extends IntegrationBase {
  readonly status: 'failed';
  readonly completeness: null;
  readonly unsupported: readonly [];
}

export type Integration = CompletedIntegration | FailedIntegration;

/** The successful arm of `loadSource`: a decoded document the later stages consumed. */
export type LoadedInput = Extract<LoadOutcome, { readonly ok: true }>;

/** The rejected arm of `loadSource`: fatal diagnostics and nothing else. */
export type RejectedInput = Extract<LoadOutcome, { readonly ok: false }>;

/**
 * What the layer consumes: the four stage results, or the one that stopped the pipeline.
 *
 * The union is the fatal rule in the type system — a rejected load has no slots for `scan`,
 * `classification` or `semantics`, so a caller cannot hand this layer a fatal outcome plus a
 * schema and ask it to reconcile a document that was never parsed.
 */
/** A read that produced a document: every later stage ran, so all four slots are filled. */
export interface LoadedIntegrationInput {
  readonly load: LoadedInput;
  readonly scan: SyntaxScan;
  readonly classification: Classification;
  readonly semantics: PartialSemantics;
}

/** A read that was rejected: there is no scan, no classification and no semantics. */
export interface RejectedIntegrationInput {
  readonly load: RejectedInput;
}

export type IntegrationInput = LoadedIntegrationInput | RejectedIntegrationInput;

/** True for the arm that carries stage results; the one check that narrows `IntegrationInput`. */
export function isLoadedInput(input: IntegrationInput): input is LoadedIntegrationInput {
  return input.load.ok;
}

/** One internal inconsistency this layer refuses to report as a result. */
export type IntegrationRule =
  | 'section-total-mismatch'
  | 'key-total-mismatch'
  | 'section-partition'
  | 'key-partition'
  | 'section-unknown-mismatch'
  | 'line-partition'
  | 'dropped-nonzero'
  | 'fatal-outside-load'
  | 'failure-without-fatal';

export interface IntegrationViolation {
  readonly rule: IntegrationRule;
  readonly detail: string;
}

/**
 * Thrown when the stages disagree with each other or the caller breaks the input contract.
 *
 * Same policy as `CoverageError` and `CompletenessError`: an inconsistent integration is a defect
 * in this tool, not a property of the file, so it is a typed throw and never a diagnostic — a file
 * must not be able to make the tool report its own bug as a validation failure (§11 rule 1, §13).
 */
export class IntegrationError extends Error {
  readonly violations: readonly IntegrationViolation[];

  constructor(violations: readonly IntegrationViolation[]) {
    super(`integration does not reconcile: ${violations.map((entry) => entry.rule).join(', ')}`);
    this.name = 'IntegrationError';
    this.violations = violations;
  }
}

/** §12 rule 7's tie-break order for diagnostics that share a line. */
const STAGE_RANK = { decode: 0, syntax: 1, schema: 2, semantic: 3 } as const;

type StageName = keyof typeof STAGE_RANK;

/** One diagnostic with the stage that raised it, kept only long enough to sort. */
interface StagedDiagnostic {
  readonly stage: StageName;
  readonly diagnostic: Diagnostic;
}

/** UTF-16 code-unit comparison: deterministic everywhere, unlike `localeCompare` (§9 TZ/locale). */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** A diagnostic without a span is about the whole input, so it precedes line 1 (`?? 0`). */
function lineOf(diagnostic: Diagnostic): number {
  return diagnostic.span?.startLine ?? 0;
}

function hasSeverity(diagnostics: readonly Diagnostic[], severity: Severity): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === severity);
}

/**
 * Concatenate the stages, then order by line, stage and code (§12 rule 7).
 *
 * The per-stage arrays are line-ordered already, but the concatenation is not: txt-04's
 * `S_UNKNOWN_SECTION` (line 9, syntax) is produced before two `S_UNKNOWN_KEY` records (lines 5 and
 * 6, schema), so a plain concatenation would read 9, 5, 6. Nothing is dropped or merged on the way
 * through — two occurrences of one code stay two entries.
 */
function orderedDiagnostics(
  stages: readonly { readonly stage: StageName; readonly diagnostics: readonly Diagnostic[] }[],
): readonly Diagnostic[] {
  const staged: StagedDiagnostic[] = [];
  for (const { stage, diagnostics } of stages) {
    for (const diagnostic of diagnostics) staged.push({ stage, diagnostic });
  }

  staged.sort(
    (left, right) =>
      lineOf(left.diagnostic) - lineOf(right.diagnostic) ||
      STAGE_RANK[left.stage] - STAGE_RANK[right.stage] ||
      compareText(left.diagnostic.code, right.diagnostic.code),
  );

  return staged.map((entry) => entry.diagnostic);
}

/**
 * The exit policy for a finished sequence (§11's Exit column, TBD-O7).
 *
 * Fatal first: a rejected input returns `1` for both commands even if it somehow also carried an
 * `error`. `error` is the `validate` trigger, `warning` is not — conflating the two would make
 * every degraded fixture exit 3.
 */
function exitPolicyOf(diagnostics: readonly Diagnostic[]): ExitPolicy {
  if (hasSeverity(diagnostics, 'fatal')) return { inspect: 1, validate: 1 };
  if (hasSeverity(diagnostics, 'error')) return { inspect: 0, validate: 3 };
  return { inspect: 0, validate: 0 };
}

/**
 * Check the two independent derivations against each other and return the reconciled counters.
 *
 * Nothing is counted a third time (§13): `scan.accounting` measured the lines, the classification
 * measured the sections and keys, and this function only proves that the two agree and that each
 * partition closes. The unknown-section count is the one value read back from the stored sections,
 * so a classification that stopped marking a header `unknown` would break the reconciliation
 * instead of quietly changing `preservedRaw`.
 */
function reconcile(scan: SyntaxScan, classification: Classification): IntegrationCompleteness {
  const violations: IntegrationViolation[] = [];

  const accounted =
    scan.accounting.lines.sectionHeaders +
    scan.accounting.lines.keys +
    scan.accounting.lines.comments +
    scan.accounting.lines.blank +
    scan.accounting.lines.raw;
  const ledger: LineLedger = {
    total: scan.accounting.lines.total,
    accounted,
    dropped: scan.accounting.lines.total - accounted,
  };

  const counted = classification.completeness;
  const sections = {
    total: counted.sections.total,
    parsed: counted.sections.parsed,
    preservedRaw: counted.sections.preservedRaw,
  };
  const keys = {
    total: counted.keys.total,
    parsed: counted.keys.parsed,
    preservedRaw: counted.keys.preservedRaw,
  };
  const unknownSections = classification.sections.filter(
    (section) => section.kind === 'unknown',
  ).length;

  if (sections.total !== scan.accounting.sections.total) {
    violations.push({
      rule: 'section-total-mismatch',
      detail: `classified ${String(sections.total)}, scanned ${String(scan.accounting.sections.total)}`,
    });
  }
  if (keys.total !== scan.accounting.keys.total) {
    violations.push({
      rule: 'key-total-mismatch',
      detail: `classified ${String(keys.total)}, scanned ${String(scan.accounting.keys.total)}`,
    });
  }
  if (sections.parsed + sections.preservedRaw !== sections.total) {
    violations.push({
      rule: 'section-partition',
      detail: `${String(sections.parsed)} + ${String(sections.preservedRaw)} != ${String(sections.total)}`,
    });
  }
  if (keys.parsed + keys.preservedRaw !== keys.total) {
    violations.push({
      rule: 'key-partition',
      detail: `${String(keys.parsed)} + ${String(keys.preservedRaw)} != ${String(keys.total)}`,
    });
  }
  if (unknownSections !== sections.preservedRaw) {
    violations.push({
      rule: 'section-unknown-mismatch',
      detail: `${String(unknownSections)} unknown section(s), ${String(sections.preservedRaw)} preserved`,
    });
  }
  if (scan.accounting.dropped !== ledger.dropped) {
    violations.push({
      rule: 'line-partition',
      detail: `scanner remainder ${String(scan.accounting.dropped)}, ledger remainder ${String(ledger.dropped)}`,
    });
  }

  const dropped =
    sections.total -
    (sections.parsed + sections.preservedRaw) +
    (keys.total - (keys.parsed + keys.preservedRaw)) +
    ledger.dropped;
  if (dropped !== 0) {
    violations.push({ rule: 'dropped-nonzero', detail: `remainder ${String(dropped)}` });
  }

  if (violations.length > 0) throw new IntegrationError(violations);

  return {
    sections: { ...sections, unknown: unknownSections },
    keys,
    lines: ledger,
    dropped,
  };
}

/** A §4.3 retention record, projected onto the §12 `unsupported` entry shape unchanged. */
function retainedEvidence(entry: RawEntry): UnsupportedEvidence {
  return {
    kind: entry.kind,
    sectionKind: entry.sectionKind,
    sectionHeader: entry.sectionHeader,
    key: entry.key,
    raw: entry.raw,
    span: entry.span,
    reason: entry.reason,
  };
}

/** Order by position for the same reason diagnostics are (§12 rule 7). */
function orderedEvidence(evidence: readonly UnsupportedEvidence[]): readonly UnsupportedEvidence[] {
  return [...evidence].sort(
    (left, right) =>
      left.span.startLine - right.span.startLine ||
      left.span.sectionIndex - right.span.sectionIndex ||
      compareText(left.kind, right.kind) ||
      compareText(left.raw, right.raw) ||
      compareText(left.reason, right.reason),
  );
}

/**
 * The `unsupported` list (§13, §12 rule 7).
 *
 * Three sources, all already stored: the classification's preserved records, the unsupported
 * `Position` shapes hanging off the classified sections, and the subtype membership the semantics
 * declared unsupported. Each is projected, never re-derived, and the three cannot overlap: a
 * retained record is a line the registry could not model, while a `Position` or `PName` line on a
 * view or subtype is a parsed key. `Subtype.unknownEntries` is the same object set as the
 * preserved records, so it is not read again here.
 */
function unsupportedOf(
  classification: Classification,
  semantics: PartialSemantics,
): readonly UnsupportedEvidence[] {
  const evidence: UnsupportedEvidence[] = [];

  for (const entry of classification.preserved) evidence.push(retainedEvidence(entry));

  for (const section of classification.sections) {
    for (const position of section.decoded.positions) {
      if (position.kind !== 'unsupported') continue;
      evidence.push({
        kind: 'unsupported-position',
        sectionKind: section.kind,
        sectionHeader: section.headerRaw,
        key: 'Position',
        raw: position.raw,
        span: position.span,
        reason: position.reason,
      });
    }
  }

  for (const subtype of semantics.subtypes) {
    evidence.push({
      kind: 'subtype-membership',
      sectionKind: 'Subtype',
      sectionHeader: subtype.headerRaw,
      key: null,
      raw: subtype.headerRaw,
      span: subtype.span,
      reason: subtype.membership.reason,
    });
  }

  return orderedEvidence(evidence);
}

/**
 * A rejected input: fatal diagnostics retained verbatim, no counts, no evidence (§11, §14 row 11).
 *
 * The ordering of the fatal diagnostics is the read's own, not this layer's: `loadSource` returns
 * the failure as it detected it, and re-sorting a single-message failure would only obscure it.
 */
function rejected(diagnostics: readonly Diagnostic[]): FailedIntegration {
  const retained = [...diagnostics];
  if (!hasSeverity(retained, 'fatal')) {
    throw new IntegrationError([
      {
        rule: 'failure-without-fatal',
        detail: 'a rejected load carried no fatal diagnostic',
      },
    ]);
  }

  return {
    status: 'failed',
    diagnostics: retained,
    exitPolicy: exitPolicyOf(retained),
    completeness: null,
    unsupported: [],
  };
}

/**
 * Integrate the stage results into one status, one ordered diagnostic sequence, the exit policy,
 * the reconciled counters and the unsupported evidence.
 *
 * Pure and total over its input: the only throws are `IntegrationError`, raised when this tool's
 * own stages disagree with each other, never because of the file's content.
 */
export function integrate(input: IntegrationInput): Integration {
  if (!isLoadedInput(input)) return rejected(input.load.diagnostics);

  const diagnostics = orderedDiagnostics([
    { stage: 'decode', diagnostics: input.load.source.diagnostics },
    { stage: 'syntax', diagnostics: input.scan.diagnostics },
    { stage: 'schema', diagnostics: input.classification.diagnostics },
    { stage: 'semantic', diagnostics: input.semantics.diagnostics },
  ]);

  // A fatal diagnostic on a loaded input is a contract violation: `DecodedSource` cannot exist
  // after a fatal read, so reporting `failed` here would mean `completeness` was fabricated.
  if (hasSeverity(diagnostics, 'fatal')) {
    throw new IntegrationError([
      { rule: 'fatal-outside-load', detail: 'a loaded input carried a fatal diagnostic' },
    ]);
  }

  const status: 'ok' | 'degraded' =
    hasSeverity(diagnostics, 'error') || hasSeverity(diagnostics, 'warning') ? 'degraded' : 'ok';

  return {
    status,
    diagnostics,
    exitPolicy: exitPolicyOf(diagnostics),
    completeness: reconcile(input.scan, input.classification),
    unsupported: unsupportedOf(input.classification, input.semantics),
  };
}
