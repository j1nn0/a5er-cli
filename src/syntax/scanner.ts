/**
 * The line scanner (`architecture.md` §3 "Syntax parse", §4.1, §4.4, §6, §7.3, §13).
 *
 * One pass over the decoded text turns physical lines into the lossless facts the rest of the
 * pipeline is built on. Six rules decide everything here:
 *
 * 1. **Nothing is discarded.** Every line ends up as a section header, a key, a comment, a
 *    blank-line position, or a raw line. `accounting.dropped` is the arithmetic remainder of
 *    that partition and must be `0` (§13) — it is computed from the records, never asserted.
 * 2. **Nothing is overwritten.** Duplicate keys and repeated sections are separate records in
 *    file order (`P4`, `U6`; txt-05, txt-06). "Last wins" is a resolution rule, not a scan rule.
 * 3. **Nothing is joined.** A line inside a section that is not a header, key, comment or blank
 *    is a raw line: §7.3 makes it `multiline-value` evidence **and** `S_MALFORMED_LINE`, and it
 *    is never appended to the preceding value (val-08's broken `Query`).
 * 4. **Nothing is inferred.** Key names and values are taken verbatim around the *first* `=`
 *    (val-10: `TableInnerOption` values contain `=`), and section names are matched
 *    case-sensitively from the shared list (txt-07).
 * 5. **Every record carries a span.** `sectionIndex` is 1-based over headers with `0` for the
 *    region before the first header; `startLine`/`endLine`/`keyLine` are 1-based lines (§4.1).
 * 6. **Only this stage's codes are raised here.** `S_UNKNOWN_SECTION`, `S_MALFORMED_LINE` and
 *    `S_HEADER_UNKNOWN_FORMAT` are decided by lines alone; `S_UNKNOWN_KEY`, `S_LEGACY_KEY`,
 *    `S_DUPLICATE_KEY` and `S_FIELD_*` need the section-scoped registry (§5) and are raised
 *    there. Emitting one of those from a line scan would be a guess, not a finding.
 *
 * What this stage deliberately does **not** do: decode a `Value` (§4.2), split a Complex value
 * (`complex.ts` does that, without unescaping), interpret a key, or resolve anything.
 */

import { parseHeader } from '../decode/header.js';
import { headerNameOf } from '../decode/sections.js';
import { emitSyntax } from '../diagnostics/diagnostic.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';
import { splitLines } from './lines.js';
import type { SourceLine } from './lines.js';
import { sectionKindOf } from './sections.js';
import type { SectionKind } from './sections.js';

/** The `FORMAT` declaration and the §6 classification that follows from it. */
export interface FormatFact {
  /** `# A5:ER FORMAT:<n>` as a number, or `null` when absent or not numeric (§8.1). */
  readonly declared: number | null;
  /**
   * `false` for absent, `20` and anything above `21` (§6).
   *
   * This is only the *known/unknown* answer. Which decoders a known value enables — canonical
   * for `21`, legacy for `19` and below, both for absent — is the F2 profile, and it is derived
   * by the section-scoped registry stage from `declared`, not guessed here.
   */
  readonly known: boolean;
}

/** A `key=value` line, split on the first `=` only. */
export interface KeyRecord {
  readonly kind: 'key';
  /** Key text exactly as written, including any whitespace around it. */
  readonly key: string;
  /** Value text exactly as written: everything after the first `=`, no unquoting, no unescape. */
  readonly value: string;
  /** The whole line, verbatim. */
  readonly raw: string;
  readonly span: Span;
}

/**
 * A line that is not a section header, a key, a comment or blank (§7.3).
 *
 * It is kept verbatim and reported, never attached to, or joined with, the preceding value. The
 * model stage turns it into an `unsupported` `multiline-value` entry; the raw text and the span
 * it needs are already here.
 */
export interface RawLineRecord {
  readonly kind: 'raw-line';
  /** The whole line, verbatim. */
  readonly raw: string;
  readonly span: Span;
}

/** One entry of a section, in file order. */
export type SectionEntry = KeyRecord | RawLineRecord;

/**
 * A `#`-prefixed line, anywhere in the file (§7.4).
 *
 * `span.sectionIndex` is the section whose extent physically contains the line (`0` before the
 * first header). §7.4's attachment — free-standing, or attached to a section — is the model
 * stage's decision, made from this line number and the section spans; the scan does not
 * pre-empt it.
 */
export interface CommentRecord {
  /** The whole line, verbatim, including the leading `#`. */
  readonly raw: string;
  readonly span: Span;
}

/** One `[…]` header and everything it owns. */
export interface SectionScan {
  /** 1-based ordinal over the file's headers — the `sectionIndex` its records carry. */
  readonly index: number;
  /** Header name: brackets removed, surrounding whitespace trimmed, inner text verbatim. */
  readonly name: string;
  /** Canonical kind; `'unknown'` for a header this project does not model (§5). */
  readonly kind: SectionKind;
  /** The header line exactly as written, padding included (`  [Entity] ` in txt-08). */
  readonly headerRaw: string;
  /** The header line alone: `startLine === endLine === keyLine` (§4.1). */
  readonly headerSpan: Span;
  /**
   * The section's extent: its header line through the line before the next header, or through
   * the last line of the file.
   *
   * Every line after the first header therefore belongs to exactly one section, which is what
   * makes the §13 reconciliation checkable line by line; the header line is also `keyLine`.
   */
  readonly span: Span;
  /** Keys and raw lines in file order; duplicates are separate entries. */
  readonly entries: readonly SectionEntry[];
}

/** The region before the first header: `sectionIndex` `0` (§4.1). */
export interface HeaderRegion {
  /**
   * `key=value` lines seen before any header.
   *
   * A well-formed file has none — a key belongs to a section — so they are kept as records
   * rather than dropped. They have no registry to consult, so the registry stage will report
   * them as unknown keys; this stage invents neither a section nor a diagnostic for them.
   */
  readonly keyLines: readonly KeyRecord[];
  /** Raw lines seen before any header, reported as `S_MALFORMED_LINE` like any other. */
  readonly rawLines: readonly RawLineRecord[];
}

/** `architecture.md` §13, resolved over the records this scan actually produced. */
export interface SyntaxAccounting {
  /** The line partition: the five kinds sum to `total`. */
  readonly lines: {
    readonly total: number;
    readonly sectionHeaders: number;
    readonly keys: number;
    readonly comments: number;
    readonly blank: number;
    readonly raw: number;
  };
  readonly sections: {
    readonly total: number;
    readonly recognised: number;
    readonly unknown: number;
  };
  /**
   * Key totals.
   *
   * `keys.total` is every `key=value` line in the file (§13). The split is by *section*, which
   * a line scan can see; the §13 `parsed`/`preservedRaw` split additionally needs the key
   * registry, so it belongs to the registry stage — a key with no registry entry is preserved
   * even inside a recognised section (txt-04's `MysteryKey`).
   */
  readonly keys: {
    readonly total: number;
    readonly inRecognisedSections: number;
    readonly inUnknownSections: number;
    /** Keys before the first header: no section, so neither side of the split applies. */
    readonly beforeFirstSection: number;
  };
  /** §13 remainder: everything counted minus everything accounted for. Must be `0`. */
  readonly dropped: number;
}

/** The whole scan: lossless facts, and the diagnostics this stage alone can justify. */
export interface SyntaxScan {
  readonly format: FormatFact;
  readonly header: HeaderRegion;
  /** Every header in file order, unknown sections included. */
  readonly sections: readonly SectionScan[];
  /** Every `#` line in file order, wherever it sits (§7.4). */
  readonly comments: readonly CommentRecord[];
  /** Line numbers of blank lines, in order. They are whitespace, never data (§7.4). */
  readonly blankLines: readonly number[];
  /** Every physical line with its terminator, so the input can be reconstructed exactly. */
  readonly lines: readonly SourceLine[];
  readonly accounting: SyntaxAccounting;
  /** Ordered by the line each one is about (§12 rule 7). */
  readonly diagnostics: readonly Diagnostic[];
}

/** What the scanner needs: decoded text with its EOLs intact, plus the declared FORMAT. */
export interface ScanInput {
  /** `DecodedSource.text` — no trimming, no newline rewriting (§8.2). */
  readonly text: string;
  /** `DecodedSource.format`, parsed authoritatively from the decoded text in `decode/`. */
  readonly format: number | null;
}

/** `FORMAT:20` is the hole in the documented version map (`format-coverage.md` K2). */
const FORMAT_HOLE = 20;

/** Highest FORMAT this build knows: `21` (`format-coverage.md` §2). */
const FORMAT_MAX = 21;

/** §6: absent, `20` and anything above `21` are unknown; everything else is known. */
function isKnownFormat(declared: number | null): boolean {
  if (declared === null) return false;
  if (declared === FORMAT_HOLE) return false;
  return declared <= FORMAT_MAX;
}

/** A single-line span, used for every construct that occupies exactly one line. */
function lineSpan(sectionIndex: number, line: number): Span {
  return { sectionIndex, startLine: line, endLine: line, keyLine: line };
}

/** What a single line turned out to be. */
type Classified =
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'blank' }
  | { readonly kind: 'comment' }
  | KeyRecord
  | RawLineRecord;

/**
 * Classify one physical line.
 *
 * The order *is* the classification: header, blank, comment, key, raw. A header-shaped line is
 * checked first so `[a=b]` stays a header rather than becoming a key (§10.4's greedy outer
 * pair), and a `#` line is a comment even when it contains `=` (P1: `#` lines are comments
 * anywhere). A line whose first `=` is at position 0 has an empty key name and is not a
 * `key=value` line at all — it becomes a raw line.
 */
function classify(line: SourceLine, sectionIndex: number): Classified {
  const name = headerNameOf(line.text);
  if (name !== null) return { kind: 'header', name };
  // Whitespace-only, using the same test `decode/load.ts` applies to the whole input. This is
  // the §7.4 question ("is this line blank?"), which is not the §7.1 padding rule of complex.ts.
  if (line.text.trim() === '') return { kind: 'blank' };
  if (line.text.startsWith('#')) return { kind: 'comment' };

  const equals = line.text.indexOf('=');
  if (equals > 0) {
    return {
      kind: 'key',
      key: line.text.slice(0, equals),
      value: line.text.slice(equals + 1),
      raw: line.text,
      span: lineSpan(sectionIndex, line.number),
    };
  }

  // No `=` at all: §7.3's continuation line, kept verbatim and never joined to what came before.
  return { kind: 'raw-line', raw: line.text, span: lineSpan(sectionIndex, line.number) };
}

/** A section while its extent is still open: the next header decides where it ends. */
interface SectionDraft {
  readonly index: number;
  readonly name: string;
  readonly kind: SectionKind;
  readonly headerRaw: string;
  readonly headerLine: number;
  readonly entries: SectionEntry[];
  endLine: number;
}

/** Count the key entries of a section, for the `S_UNKNOWN_SECTION` detail (§12). */
function countKeys(entries: readonly SectionEntry[]): number {
  return entries.filter((entry) => entry.kind === 'key').length;
}

/**
 * Scan the decoded text into lossless syntax facts.
 *
 * Pure: no filesystem, no clock, no environment — the input is a string and a number, and the
 * output depends only on them, so two runs on one document are identical.
 */
export function scanSource(input: ScanInput): SyntaxScan {
  const lines = splitLines(input.text);
  const comments: CommentRecord[] = [];
  const blankLines: number[] = [];
  const headerKeyLines: KeyRecord[] = [];
  const headerRawLines: RawLineRecord[] = [];
  const drafts: SectionDraft[] = [];

  let current: SectionDraft | null = null;

  for (const line of lines) {
    const sectionIndex = current === null ? 0 : current.index;
    const classified = classify(line, sectionIndex);

    switch (classified.kind) {
      case 'header': {
        // A new section starts here, so the previous one ends on the line before this one.
        if (current !== null) current.endLine = line.number - 1;
        const draft: SectionDraft = {
          index: drafts.length + 1,
          name: classified.name,
          kind: sectionKindOf(classified.name),
          headerRaw: line.text,
          headerLine: line.number,
          entries: [],
          endLine: line.number,
        };
        drafts.push(draft);
        current = draft;
        break;
      }
      case 'blank': {
        blankLines.push(line.number);
        break;
      }
      case 'comment': {
        comments.push({ raw: line.text, span: lineSpan(sectionIndex, line.number) });
        break;
      }
      case 'key': {
        if (current === null) headerKeyLines.push(classified);
        else current.entries.push(classified);
        break;
      }
      case 'raw-line': {
        if (current === null) headerRawLines.push(classified);
        else current.entries.push(classified);
        break;
      }
    }
  }

  // The last section owns every line to the end of the file.
  if (current !== null) current.endLine = lines.length;

  const sections: SectionScan[] = drafts.map((draft) => ({
    index: draft.index,
    name: draft.name,
    kind: draft.kind,
    headerRaw: draft.headerRaw,
    headerSpan: lineSpan(draft.index, draft.headerLine),
    span: {
      sectionIndex: draft.index,
      startLine: draft.headerLine,
      endLine: draft.endLine,
      keyLine: draft.headerLine,
    },
    entries: draft.entries,
  }));

  const records: CoverageInput = {
    lines,
    sections,
    comments,
    blankLines,
    header: { keyLines: headerKeyLines, rawLines: headerRawLines },
  };

  return {
    format: { declared: input.format, known: isKnownFormat(input.format) },
    header: records.header,
    sections,
    comments,
    blankLines,
    lines,
    accounting: deriveAccounting(records),
    diagnostics: buildDiagnostics(input.format, records),
  };
}

/** The records the coverage derivation and the diagnostics read. */
export interface CoverageInput {
  /** Every physical line of the document, in order. */
  readonly lines: readonly SourceLine[];
  readonly sections: readonly SectionScan[];
  readonly comments: readonly CommentRecord[];
  readonly blankLines: readonly number[];
  readonly header: HeaderRegion;
}

/**
 * The ways a scan can fail to account for its own lines.
 *
 * Every rule here describes a defect in this module's own bookkeeping — the scanner is the only
 * producer of these records. A violation is therefore never a statement about the input file.
 */
export type CoverageRule =
  | 'line-number-broken'
  | 'section-ordinal-broken'
  | 'section-extent-broken'
  | 'bad-section-index'
  | 'header-region-misuse'
  | 'uncovered-line'
  | 'double-covered-line';

/** One line the derivation could not account for, and why. Never contains file content. */
export interface CoverageViolation {
  readonly rule: CoverageRule;
  readonly line: number;
  readonly detail: string;
}

/** Thrown when a scan does not account for its own lines. Never silent, never input-triggered. */
export class CoverageError extends Error {
  readonly violations: readonly CoverageViolation[];

  constructor(violations: readonly CoverageViolation[]) {
    super(`scan coverage does not reconcile: ${violations.map((v) => v.rule).join(', ')}`);
    this.name = 'CoverageError';
    this.violations = violations;
  }
}

/**
 * The `#` line that declares a numeric FORMAT, or `null` when there is none.
 *
 * The declaration is located by running `decode/header.ts`'s own parser over the header-region
 * comment lines, not by re-typing its pattern: one definition of "this is a FORMAT declaration",
 * and the line the diagnostic points at is exactly the line whose value the parser used (the last
 * one wins, as it does there). A declaration whose value is not numeric cannot be located this
 * way — the parser reports `format: null` for it — so it falls back to the absent policy below.
 */
function formatDeclarationLine(input: CoverageInput): number | null {
  const firstHeaderLine = input.sections[0]?.headerSpan.keyLine ?? Number.POSITIVE_INFINITY;
  let found: number | null = null;
  for (const comment of input.comments) {
    if (comment.span.keyLine >= firstHeaderLine) continue;
    if (parseHeader(comment.raw).format !== null) found = comment.span.keyLine;
  }
  return found;
}

/**
 * Diagnostics this stage can justify, in the order the file mentions them (§12 rule 7).
 *
 * `S_HEADER_UNKNOWN_FORMAT` comes first because it is about the header, which precedes every
 * section, and it points at the **actual** declaration line when the file carries a numeric one
 * (fmt-04's `FORMAT:20` is line 1, a file that puts the comment after a licence block is whatever
 * line that is). When no declaration can be located, the policy is to point at line 1,
 * `sectionIndex` 0: that is the first position at which a declaration would have been read, it is
 * a real line of the file, and §12's example envelope shows exactly this span. A document with no
 * lines at all has no position to point at and gets no header diagnostic — it never reaches this
 * stage (`E_EMPTY_INPUT` fires first), but the pure function stays honest.
 */
function buildDiagnostics(declared: number | null, input: CoverageInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!isKnownFormat(declared) && input.lines.length > 0) {
    diagnostics.push(
      emitSyntax('S_HEADER_UNKNOWN_FORMAT', {
        details: { declared },
        span: lineSpan(0, formatDeclarationLine(input) ?? 1),
        construct: 'Header',
      }),
    );
  }

  for (const record of input.header.rawLines) {
    diagnostics.push(emitSyntax('S_MALFORMED_LINE', { span: record.span, construct: 'Line' }));
  }

  for (const section of input.sections) {
    if (section.kind === 'unknown') {
      diagnostics.push(
        emitSyntax('S_UNKNOWN_SECTION', {
          // Untrusted text lives in `details` only, bounded by `emit` (§11 rule 1).
          details: { section: section.headerRaw, keys: countKeys(section.entries) },
          span: section.span,
          construct: 'Section',
        }),
      );
    }
    for (const entry of section.entries) {
      if (entry.kind !== 'raw-line') continue;
      diagnostics.push(emitSyntax('S_MALFORMED_LINE', { span: entry.span, construct: 'Line' }));
    }
  }

  return diagnostics;
}

/**
 * The section each `sectionIndex` resolves to, the first declaration winning, for `O(1)` lookups.
 *
 * This answers `sections.find((section) => section.index === wanted)` once instead of at every
 * comment, whose cost was the whole section list per comment. It is a memo of *that* predicate, so
 * it has to keep that predicate's two edge rules:
 *
 * - **First wins.** `find` returns the first match in file order, so an input that gives two
 *   sections one `index` — only a deliberately broken one can — resolves to the earlier section and
 *   its extent, never to a later one's.
 * - **`NaN` is not a key.** `Map` compares keys with SameValueZero, which holds `NaN` equal to
 *   itself, while `===` does not. Registering a `NaN` index would invent an owner that `find` could
 *   never have returned and quietly swallow a "names no section" violation. Every other number
 *   agrees between the two comparisons, `+0`/`-0` included, so no other value is filtered.
 */
function sectionOwnerIndex(sections: readonly SectionScan[]): Map<number, SectionScan> {
  const owners = new Map<number, SectionScan>();
  for (const section of sections) {
    if (Number.isNaN(section.index)) continue;
    if (owners.has(section.index)) continue;
    owners.set(section.index, section);
  }
  return owners;
}

/**
 * Check that every line of the document is claimed by exactly one record.
 *
 * This is §13's guarantee expressed as a property of the data rather than of the code that built
 * it: the records are walked *after* the fact, so a line the scan forgot, a line two records both
 * claim, and a `sectionIndex` that names no section all become visible. It is exported because a
 * test must be able to hand it a deliberately broken structure — that is the only way to know the
 * checker still checks anything.
 *
 * Cost. Every loop here is one pass over its own collection — the line numbering, the section
 * validation (header, entries, continuity), the header-region records, the comments, the blank
 * positions, the claim sweep and the claim map — so with `L` physical lines, `S` sections, `E`
 * section entries, `H` header-region records, `C` comments and `B` blank lines the check is
 * `O(L + S + E + H + C + B)` in time. The one step that was not is a comment's owner: it used to be
 * `sections.find(...)`, a full scan per comment (`O(S*C)` — quadratic in a comment-heavy file, and
 * beyond repair by any later gate, because the time is already spent when the gate sees the
 * result). `sectionOwnerIndex()` builds that answer once per call in `O(S)`, so each lookup becomes
 * one average-`O(1)` probe: `O(S + C)` for the step and `O(S)` extra memory. Nothing else moved;
 * the index is a statement about cost, not a relaxation of the check.
 */
export function verifyCoverage(input: CoverageInput): readonly CoverageViolation[] {
  const violations: CoverageViolation[] = [];
  const claims = new Map<number, string[]>();
  const claim = (line: number, what: string): void => {
    const existing = claims.get(line);
    if (existing === undefined) claims.set(line, [what]);
    else existing.push(what);
  };

  const total = input.lines.length;

  for (const [index, line] of input.lines.entries()) {
    if (line.number !== index + 1) {
      violations.push({
        rule: 'line-number-broken',
        line: index + 1,
        detail: `recorded as line ${String(line.number)}`,
      });
    }
  }

  const firstHeaderLine = input.sections[0]?.headerSpan.keyLine ?? Number.POSITIVE_INFINITY;

  for (const [index, section] of input.sections.entries()) {
    const ordinal = index + 1;
    const headerLine = section.headerSpan.keyLine;

    if (section.index !== ordinal) {
      violations.push({
        rule: 'section-ordinal-broken',
        line: headerLine,
        detail: `section ${String(section.index)} sits at position ${String(ordinal)}`,
      });
    }
    if (
      section.headerSpan.sectionIndex !== section.index ||
      section.span.sectionIndex !== section.index
    ) {
      violations.push({
        rule: 'bad-section-index',
        line: headerLine,
        detail: `section ${String(section.index)} carries another sectionIndex`,
      });
    }
    if (
      section.headerSpan.startLine !== headerLine ||
      section.headerSpan.endLine !== headerLine ||
      section.span.startLine !== headerLine ||
      section.span.keyLine !== headerLine ||
      section.span.endLine < headerLine
    ) {
      violations.push({
        rule: 'section-extent-broken',
        line: headerLine,
        detail: `section ${String(section.index)} has inconsistent extent`,
      });
    }
    const previous = index === 0 ? undefined : input.sections[index - 1];
    if (previous !== undefined && section.span.startLine !== previous.span.endLine + 1) {
      violations.push({
        rule: 'section-extent-broken',
        line: headerLine,
        detail: `section ${String(section.index)} does not continue the previous one`,
      });
    }

    claim(headerLine, `section ${String(ordinal)} header`);

    for (const entry of section.entries) {
      const line = entry.span.keyLine;
      if (entry.span.sectionIndex !== section.index) {
        violations.push({
          rule: 'bad-section-index',
          line,
          detail: `${entry.kind} of section ${String(section.index)} claims ${String(entry.span.sectionIndex)}`,
        });
      }
      if (line < section.span.startLine || line > section.span.endLine) {
        violations.push({
          rule: 'section-extent-broken',
          line,
          detail: `${entry.kind} lies outside section ${String(section.index)}`,
        });
      }
      if (entry.span.startLine !== line || entry.span.endLine !== line) {
        violations.push({
          rule: 'section-extent-broken',
          line,
          detail: `${entry.kind} spans more than one line`,
        });
      }
      claim(line, `section ${String(ordinal)} ${entry.kind}`);
    }
  }

  const last = input.sections.at(-1);
  if (last !== undefined && last.span.endLine !== total) {
    violations.push({
      rule: 'section-extent-broken',
      line: last.span.endLine,
      detail: 'last section does not reach the last line',
    });
  }

  for (const record of [...input.header.keyLines, ...input.header.rawLines]) {
    if (record.span.sectionIndex !== 0) {
      violations.push({
        rule: 'bad-section-index',
        line: record.span.keyLine,
        detail: `${record.kind} in the header region claims ${String(record.span.sectionIndex)}`,
      });
    }
    if (record.span.keyLine >= firstHeaderLine) {
      violations.push({
        rule: 'header-region-misuse',
        line: record.span.keyLine,
        detail: `${record.kind} claims the header region after the first header`,
      });
    }
    claim(record.span.keyLine, `header ${record.kind}`);
  }

  // Built once for the loop below: one probe per comment instead of one section scan per comment.
  const sectionOwners = sectionOwnerIndex(input.sections);

  for (const comment of input.comments) {
    const line = comment.span.keyLine;
    if (comment.span.sectionIndex === 0) {
      if (line >= firstHeaderLine) {
        violations.push({
          rule: 'header-region-misuse',
          line,
          detail: 'comment claims the header region after the first header',
        });
      }
    } else {
      const owner = sectionOwners.get(comment.span.sectionIndex);
      if (owner === undefined) {
        violations.push({
          rule: 'bad-section-index',
          line,
          detail: `comment claims section ${String(comment.span.sectionIndex)}`,
        });
      } else if (line < owner.span.startLine || line > owner.span.endLine) {
        violations.push({
          rule: 'bad-section-index',
          line,
          detail: `comment claims section ${String(comment.span.sectionIndex)} but sits outside it`,
        });
      }
    }
    claim(line, 'comment');
  }

  for (const line of input.blankLines) claim(line, 'blank line');

  // Iterate the document's line numbers, not the records' own numbering: a record whose
  // `number` was corrupted must leave its real line uncovered (and its new one double-claimed)
  // instead of hiding both behind a self-consistent loop.
  for (let line = 1; line <= total; line += 1) {
    const owners = claims.get(line) ?? [];
    if (owners.length === 0) {
      violations.push({ rule: 'uncovered-line', line, detail: 'no record claims this line' });
      continue;
    }
    if (owners.length > 1) {
      violations.push({ rule: 'double-covered-line', line, detail: owners.join(' + ') });
    }
  }

  for (const [line, owners] of claims) {
    if (line < 1 || line > total) {
      violations.push({
        rule: 'line-number-broken',
        line,
        detail: `${String(owners.length)} record(s) point outside the document`,
      });
    }
  }

  return violations;
}

/**
 * Resolve §13's counters from the stored records, or refuse.
 *
 * Every counter is derived by walking `sections`, `comments`, `blankLines` and `lines`; none is
 * taken from a counter that the classification pass happened to increment, because two bookkeeping
 * paths are exactly how a line silently stops being counted. `dropped` is the remainder of the line
 * partition, so it moves when the records and the lines disagree — while `dropped: 0` written by
 * hand would never move at all (§13).
 *
 * `CoverageError` is thrown rather than returned: an inconsistent scan is a defect in this module,
 * and a caller must not be able to render it as a healthy document.
 */
export function deriveAccounting(input: CoverageInput): SyntaxAccounting {
  const violations = verifyCoverage(input);
  if (violations.length > 0) throw new CoverageError(violations);

  const total = input.lines.length;
  const sectionHeaders = input.sections.length;
  const comments = input.comments.length;
  const blank = input.blankLines.length;

  let keys = input.header.keyLines.length;
  let raw = input.header.rawLines.length;
  let inRecognisedSections = 0;
  let inUnknownSections = 0;

  for (const section of input.sections) {
    let sectionKeys = 0;
    for (const entry of section.entries) {
      if (entry.kind === 'key') sectionKeys += 1;
      else raw += 1;
    }
    keys += sectionKeys;
    if (section.kind === 'unknown') inUnknownSections += sectionKeys;
    else inRecognisedSections += sectionKeys;
  }

  const recognised = input.sections.filter((section) => section.kind !== 'unknown').length;
  const beforeFirstSection = input.header.keyLines.length;
  const accounted = sectionHeaders + keys + comments + blank + raw;

  return {
    lines: { total, sectionHeaders, keys, comments, blank, raw },
    sections: { total: sectionHeaders, recognised, unknown: sectionHeaders - recognised },
    keys: { total: keys, inRecognisedSections, inUnknownSections, beforeFirstSection },
    dropped: total - accounted,
  };
}
