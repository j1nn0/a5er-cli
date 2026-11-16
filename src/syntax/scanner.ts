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
  const kinds = { sectionHeaders: 0, keys: 0, comments: 0, blank: 0, raw: 0 };

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
        kinds.sectionHeaders += 1;
        break;
      }
      case 'blank': {
        blankLines.push(line.number);
        kinds.blank += 1;
        break;
      }
      case 'comment': {
        comments.push({ raw: line.text, span: lineSpan(sectionIndex, line.number) });
        kinds.comments += 1;
        break;
      }
      case 'key': {
        kinds.keys += 1;
        if (current === null) headerKeyLines.push(classified);
        else current.entries.push(classified);
        break;
      }
      case 'raw-line': {
        kinds.raw += 1;
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

  return {
    format: { declared: input.format, known: isKnownFormat(input.format) },
    header: { keyLines: headerKeyLines, rawLines: headerRawLines },
    sections,
    comments,
    blankLines,
    lines,
    accounting: account(lines.length, kinds, headerKeyLines, sections),
    diagnostics: buildDiagnostics(input.format, headerRawLines, sections, lines.length > 0),
  };
}

/**
 * Diagnostics this stage can justify, in the order the file mentions them (§12 rule 7).
 *
 * `S_HEADER_UNKNOWN_FORMAT` comes first because it is about the header, which precedes every
 * section; it points at line 1 of the header region, which is where §12's example puts it. A
 * document with no lines at all has no position to point at and gets no header diagnostic — it
 * never reaches this stage (`E_EMPTY_INPUT` fires first), but the pure function stays honest.
 */
function buildDiagnostics(
  declared: number | null,
  headerRawLines: readonly RawLineRecord[],
  sections: readonly SectionScan[],
  hasLines: boolean,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!isKnownFormat(declared) && hasLines) {
    diagnostics.push(
      emitSyntax('S_HEADER_UNKNOWN_FORMAT', {
        details: { declared },
        span: lineSpan(0, 1),
        construct: 'Header',
      }),
    );
  }

  for (const record of headerRawLines) {
    diagnostics.push(emitSyntax('S_MALFORMED_LINE', { span: record.span, construct: 'Line' }));
  }

  for (const section of sections) {
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
 * Resolve §13's counters over the records.
 *
 * `dropped` is the remainder of three partitions — lines, sections, keys — and is therefore
 * `0` only when each of them is complete. Computing it rather than returning a constant is the
 * point (§13): a scan that silently stopped producing a record for some line would move this
 * number, while `dropped: 0` written by hand would not move at all.
 */
function account(
  lineCount: number,
  kinds: {
    readonly sectionHeaders: number;
    readonly keys: number;
    readonly comments: number;
    readonly blank: number;
    readonly raw: number;
  },
  headerKeyLines: readonly KeyRecord[],
  sections: readonly SectionScan[],
): SyntaxAccounting {
  const recognised = sections.filter((section) => section.kind !== 'unknown');
  const unknown = sections.filter((section) => section.kind === 'unknown');
  const inRecognisedSections = recognised.reduce(
    (sum, section) => sum + countKeys(section.entries),
    0,
  );
  const inUnknownSections = unknown.reduce((sum, section) => sum + countKeys(section.entries), 0);
  const beforeFirstSection = headerKeyLines.length;

  const keyTotal = beforeFirstSection + inRecognisedSections + inUnknownSections;
  const accountedLines =
    kinds.sectionHeaders + kinds.keys + kinds.comments + kinds.blank + kinds.raw;
  const accountedSections = recognised.length + unknown.length;
  const accountedKeys = beforeFirstSection + inRecognisedSections + inUnknownSections;

  const dropped =
    lineCount - accountedLines + (sections.length - accountedSections) + (keyTotal - accountedKeys);

  return {
    lines: { total: lineCount, ...kinds },
    sections: {
      total: sections.length,
      recognised: recognised.length,
      unknown: unknown.length,
    },
    keys: {
      total: keyTotal,
      inRecognisedSections,
      inUnknownSections,
      beforeFirstSection,
    },
    dropped,
  };
}
