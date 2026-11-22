/**
 * `text/tables.ts` — the `--format text` renderer (`docs/proposals/human-cli.md` §4, §4.10).
 *
 * **Two passes, no whole output.** Pass 1 walks the rows and keeps numbers only: the fixed column
 * widths and, per row, the display width of the *rendered* `PNAME`, computed arithmetically. The
 * escaped text of a name is never built to measure it. Pass 2 emits every line as a sequence of
 * pieces — fixed cells, padding, name pieces, `\n` — and `chunkPieces` is the only place that
 * accumulates. A name is emitted in slices of at most 16,384 code points, a note's list is emitted
 * item by item from a list of indexes, and nothing joins a row, a note line or the output.
 *
 * **Layout (§4.1).** A status note, the table (header only when a row exists), the notes in their
 * fixed order, and no blank lines. A row's first column is a right-aligned number, so a note is
 * the only line class that starts with `#`, the header is the only one that starts with `S`, and
 * the three can never be confused.
 *
 * **The alignment cap (§4.3).** `PNAME` is padded to `W = max(5, max{wᵢ ≤ 48})`. A longer name is
 * written in full and followed by exactly two spaces: alignment is relaxed for that row alone, and
 * nothing is truncated. That is what keeps one 200,001-character name from costing hundreds of
 * millions of padding cells, while every ordinary row stays aligned.
 *
 * **The counts (§4.5).** `unknown` is the only placeholder, and it is never `0`: a partial entity
 * and a view do not know their common and effective counts, so they say so, and the notes below say
 * why. The distinction is the point of the table.
 *
 * **What is never printed (§4.8, §4.9, §7.8).** `details`, `Query`, `Comment`, `raw` text and the
 * path. The two name columns are the only file-derived text, and both are escaped before they are
 * written. Diagnostic `message` is table text and still goes through `escapeText` as defence in
 * depth.
 *
 * No I/O, no clock, no locale, no `node:` module.
 */

import type {
  JsonCompleteness,
  JsonDiagnostic,
  JsonTableColumns,
  JsonTableRow,
  JsonTablesEnvelope,
  JsonTablesResult,
  JsonUnsupported,
} from '../json/index.js';
import { NOTE_PREFIX } from '../view/tables.js';
import { chunkPieces } from './chunks.js';
import { escapeText, renderedNameWidth, renderNamePieces } from './escape.js';
import { displayWidth } from './width.js';

/**
 * `PNAME` never widens the table past this many display cells (§4.3).
 *
 * A constant, not an option: `tables` takes no display options, and the terminal width is never
 * read. 48 covers the classic Oracle 30-byte limit and most names below PostgreSQL's 63 and
 * MySQL's 64, while keeping `LNAME` inside a common 120-to-132-column terminal.
 */
export const PNAME_ALIGN_CAP = 48;

/** Two spaces separate every column (§4.3). */
const COLUMN_SEPARATOR = '  ';

/** The one placeholder a count column may hold; a number is always a known count (§4.5). */
const UNKNOWN = 'unknown';

/** The header cells, in column order (§4.3). */
const HEADER = {
  section: 'SECTION',
  line: 'LINE',
  kind: 'KIND',
  declared: 'DECLARED',
  common: 'COMMON',
  effective: 'EFFECTIVE',
  pname: 'PNAME',
  lname: 'LNAME',
} as const;

/** Every reason a count column can be `unknown` for; `null` is a composed, complete entity. */
type ColumnReason = NonNullable<JsonTableColumns['reason']>;

/**
 * The note text for each `unknown` reason; the key set is the union, so a new reason is a compile
 * error rather than a silent fallback (§4.8).
 */
const UNKNOWN_NOTE_TEXT: Readonly<Record<ColumnReason, string>> = {
  'view-columns-not-stored': 'a view does not store its columns',
  'view-columns-named-from-query':
    'a view names its columns from its query (LNameByComment=1) and does not store them',
  'using-common-columns-unrecognised':
    'UsingCommonColumns is neither 1 nor 0, so common columns are not composed',
};

/**
 * The order the `unknown` notes are printed in: `ViewColumnReason`'s definition order, then the
 * partial-entity reason. Fixed by reason, not by row order (§4.8).
 */
const UNKNOWN_NOTE_ORDER: readonly ColumnReason[] = [
  'view-columns-not-stored',
  'view-columns-named-from-query',
  'using-common-columns-unrecognised',
];

/** The fixed-column widths and the one width the cap bounds (§4.3). */
interface ColumnWidths {
  readonly section: number;
  readonly line: number;
  readonly kind: number;
  readonly declared: number;
  readonly common: number;
  readonly effective: number;
  readonly pname: number;
}

/** A count cell: the number, or `unknown` — never `0` for something the file does not say. */
function countCell(count: number | null): string {
  return count === null ? UNKNOWN : String(count);
}

/** Pad on the left to `width` display cells (right-aligned cells and their header). */
function padLeft(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? ' '.repeat(pad) + text : text;
}

/** Pad on the right to `width` display cells (left-aligned cells and their header). */
function padRight(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

/**
 * Pass 1: the widths, as numbers (§4.3, §4.10).
 *
 * Every fixed column is as wide as its header or its widest cell — those cells are numbers,
 * `unknown`, `entity` or `view`, so the width is bounded by the digits of the largest count, line
 * or section. `PNAME` is the only width whose input is file text, so it is the only one the cap
 * bounds: a name wider than the cap cannot widen the column.
 */
function measure(rows: readonly JsonTableRow[]): ColumnWidths {
  let section = displayWidth(HEADER.section);
  let line = displayWidth(HEADER.line);
  let kind = displayWidth(HEADER.kind);
  let declared = displayWidth(HEADER.declared);
  let common = displayWidth(HEADER.common);
  let effective = displayWidth(HEADER.effective);
  let pname = displayWidth(HEADER.pname);

  for (const row of rows) {
    section = Math.max(section, displayWidth(String(row.sectionIndex)));
    line = Math.max(line, displayWidth(String(row.span.startLine)));
    kind = Math.max(kind, displayWidth(row.kind));
    declared = Math.max(declared, displayWidth(countCell(row.columns.declared)));
    common = Math.max(common, displayWidth(countCell(row.columns.common)));
    effective = Math.max(effective, displayWidth(countCell(row.columns.effective)));
    const rowNameWidth = renderedNameWidth(row.pname);
    if (rowNameWidth <= PNAME_ALIGN_CAP) pname = Math.max(pname, rowNameWidth);
  }

  return { section, line, kind, declared, common, effective, pname };
}

/** The header line, aligned like the rows so every cell sits over its column (§4.3). */
function* headerPieces(widths: ColumnWidths): Generator<string, void, undefined> {
  yield padLeft(HEADER.section, widths.section);
  yield COLUMN_SEPARATOR;
  yield padLeft(HEADER.line, widths.line);
  yield COLUMN_SEPARATOR;
  yield padRight(HEADER.kind, widths.kind);
  yield COLUMN_SEPARATOR;
  yield padLeft(HEADER.declared, widths.declared);
  yield COLUMN_SEPARATOR;
  yield padLeft(HEADER.common, widths.common);
  yield COLUMN_SEPARATOR;
  yield padLeft(HEADER.effective, widths.effective);
  yield COLUMN_SEPARATOR;
  yield padRight(HEADER.pname, widths.pname);
  yield COLUMN_SEPARATOR;
  yield HEADER.lname;
  yield '\n';
}

/**
 * One row (§4.2–§4.4).
 *
 * The names are emitted as pieces, so the padding is the only part whose size depends on a width —
 * and it is bounded by the cap. `LNAME` is the last column, so it gets no trailing padding and no
 * line ends in whitespace.
 */
function* rowPieces(row: JsonTableRow, widths: ColumnWidths): Generator<string, void, undefined> {
  yield padLeft(String(row.sectionIndex), widths.section);
  yield COLUMN_SEPARATOR;
  yield padLeft(String(row.span.startLine), widths.line);
  yield COLUMN_SEPARATOR;
  yield padRight(row.kind, widths.kind);
  yield COLUMN_SEPARATOR;
  yield padLeft(countCell(row.columns.declared), widths.declared);
  yield COLUMN_SEPARATOR;
  yield padLeft(countCell(row.columns.common), widths.common);
  yield COLUMN_SEPARATOR;
  yield padLeft(countCell(row.columns.effective), widths.effective);
  yield COLUMN_SEPARATOR;

  const nameWidth = renderedNameWidth(row.pname);
  yield* renderNamePieces(row.pname);
  if (nameWidth <= PNAME_ALIGN_CAP) {
    yield ' '.repeat(widths.pname - nameWidth);
  }
  yield COLUMN_SEPARATOR;
  yield* renderNamePieces(row.lname);
  yield '\n';
}

/**
 * `(<sections>)`: `section A` for one, `sections A, B, …` for more, in file order (§4.8).
 *
 * Emitted item by item, never joined: 30,000 sections give a long line, not a long string.
 */
function* sectionListPieces(sectionIndexes: readonly number[]): Generator<string, void, undefined> {
  yield sectionIndexes.length === 1 ? 'section ' : 'sections ';
  let first = true;
  for (const sectionIndex of sectionIndexes) {
    if (!first) yield ', ';
    first = false;
    yield String(sectionIndex);
  }
}

/** The objects note: every kind counted, and `listed`/`omitted` stating the split (§4.8, §4.9). */
function objectsNote(result: JsonTablesResult | null): string {
  if (result === null) return `${NOTE_PREFIX} objects: none (status failed)\n`;

  let entities = 0;
  for (const row of result.tables) {
    if (row.kind === 'entity') entities += 1;
  }
  const views = result.tables.length - entities;
  const subtypes = result.omitted.subtypes.count;
  return `${NOTE_PREFIX} objects: ${result.objects} (entity ${entities}, view ${views}, subtype ${subtypes}); listed ${result.tables.length}, omitted ${subtypes}\n`;
}

/** The omitted note: a subtype is counted and cited, never listed (§4.7). */
function* omittedNotePieces(result: JsonTablesResult): Generator<string, void, undefined> {
  const subtypes = result.omitted.subtypes;
  if (subtypes.count === 0) return;

  yield `${NOTE_PREFIX} omitted: subtypes are not listed (`;
  yield* sectionListPieces(subtypes.sectionIndexes);
  yield "); 'a5er inspect' reports them\n";
}

/** One note per `unknown` reason present, in the frozen reason order (§4.8). */
function* unknownNotePieces(rows: readonly JsonTableRow[]): Generator<string, void, undefined> {
  for (const reason of UNKNOWN_NOTE_ORDER) {
    const sectionIndexes: number[] = [];
    for (const row of rows) {
      if (row.columns.reason === reason) sectionIndexes.push(row.sectionIndex);
    }
    if (sectionIndexes.length === 0) continue;

    yield `${NOTE_PREFIX} unknown: ${UNKNOWN_NOTE_TEXT[reason]} (`;
    yield* sectionListPieces(sectionIndexes);
    yield ')\n';
  }
}

/** The effective note: a repeat in the effective list is counted once per occurrence (§4.5). */
function* effectiveNotePieces(rows: readonly JsonTableRow[]): Generator<string, void, undefined> {
  const sectionIndexes: number[] = [];
  for (const row of rows) {
    const collisions = row.columns.collisions;
    if (collisions !== null && collisions > 0) sectionIndexes.push(row.sectionIndex);
  }
  if (sectionIndexes.length === 0) return;

  yield `${NOTE_PREFIX} effective: a physical column name repeats in the effective list and is counted once per occurrence (`;
  yield* sectionListPieces(sectionIndexes);
  yield ')\n';
}

/** The unsupported note: a count per kind, `0` included, kinds in first-appearance order (§4.8). */
function* unsupportedNotePieces(
  unsupported: readonly JsonUnsupported[],
): Generator<string, void, undefined> {
  if (unsupported.length === 0) {
    yield `${NOTE_PREFIX} unsupported: 0\n`;
    return;
  }

  yield `${NOTE_PREFIX} unsupported: ${unsupported.length} (`;
  // Kinds in order of first appearance, with their counts; the list is bounded by the vocabulary.
  const kinds: string[] = [];
  const counts: number[] = [];
  for (const record of unsupported) {
    const at = kinds.indexOf(record.kind);
    if (at === -1) {
      kinds.push(record.kind);
      counts.push(1);
    } else {
      counts[at] = (counts[at] ?? 0) + 1;
    }
  }

  let first = true;
  for (const [index, kind] of kinds.entries()) {
    if (!first) yield ', ';
    first = false;
    yield kind;
    yield ' ';
    yield String(counts[index] ?? 0);
  }
  yield '); kept verbatim, not interpreted\n';
}

/** One diagnostic group: fixed prefix, then one location per diagnostic in envelope order (§4.8). */
function* diagnosticGroupPieces(
  group: {
    readonly severity: JsonDiagnostic['severity'];
    readonly code: string;
    readonly message: string;
    readonly indexes: readonly number[];
  },
  diagnostics: readonly JsonDiagnostic[],
): Generator<string, void, undefined> {
  yield `${NOTE_PREFIX}   ${group.severity} ${group.code}: ${escapeText(group.message)} (`;

  let first = true;
  for (const index of group.indexes) {
    if (!first) yield ', ';
    first = false;
    const diagnostic = diagnostics[index];
    if (diagnostic === undefined) continue;
    // `details` is file text and is never printed; a line number is the whole location (§4.8).
    yield diagnostic.span === null ? 'file' : `line ${diagnostic.span.startLine}`;
  }
  yield ')\n';
}

/** The diagnostics summary and one group line per `(severity, code)` (§4.8). */
function* diagnosticsNotePieces(
  diagnostics: readonly JsonDiagnostic[],
): Generator<string, void, undefined> {
  const perSeverity: Record<JsonDiagnostic['severity'], number> = {
    fatal: 0,
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const diagnostic of diagnostics) perSeverity[diagnostic.severity] += 1;

  yield `${NOTE_PREFIX} diagnostics: ${diagnostics.length} (fatal ${perSeverity.fatal}, error ${perSeverity.error}, warning ${perSeverity.warning}, info ${perSeverity.info})\n`;

  // Grouped by `(severity, code)` in order of first appearance, then emitted from index lists.
  const groups: {
    severity: JsonDiagnostic['severity'];
    code: string;
    message: string;
    indexes: number[];
  }[] = [];
  for (const [index, diagnostic] of diagnostics.entries()) {
    let group = groups.find(
      (candidate) =>
        candidate.severity === diagnostic.severity && candidate.code === diagnostic.code,
    );
    if (group === undefined) {
      group = {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        indexes: [],
      };
      groups.push(group);
    }
    group.indexes.push(index);
  }

  for (const group of groups) yield* diagnosticGroupPieces(group, diagnostics);
}

/** The completeness note, and the warning when lines are unaccounted for (§4.8, §4.9). */
function* completenessNotePieces(
  completeness: JsonCompleteness | null,
): Generator<string, void, undefined> {
  if (completeness === null) {
    yield `${NOTE_PREFIX} completeness: none (status failed)\n`;
    return;
  }

  const { sections, keys, lines } = completeness;
  yield `${NOTE_PREFIX} completeness: sections ${sections.total} (parsed ${sections.parsed}, preservedRaw ${sections.preservedRaw}, unknown ${sections.unknown})`;
  yield `; keys ${keys.total} (parsed ${keys.parsed}, preservedRaw ${keys.preservedRaw})`;
  yield `; lines ${lines.total} (accounted ${lines.accounted}, dropped ${lines.dropped})`;
  yield `; dropped ${completeness.dropped}\n`;

  if (completeness.dropped !== 0) {
    yield `${NOTE_PREFIX} warning: completeness.dropped is ${completeness.dropped}; some lines are not accounted for\n`;
  }
}

/** Pass 2: every line, as pieces, in the layout of §4.1. */
function* textPieces(
  envelope: JsonTablesEnvelope,
  widths: ColumnWidths,
): Generator<string, void, undefined> {
  const result = envelope.result;
  const rows = result === null ? [] : result.tables;

  yield `${NOTE_PREFIX} status: ${envelope.status}\n`;
  if (rows.length > 0) yield* headerPieces(widths);
  for (const row of rows) yield* rowPieces(row, widths);

  yield objectsNote(result);
  if (result !== null) yield* omittedNotePieces(result);
  yield* unknownNotePieces(rows);
  yield* effectiveNotePieces(rows);
  yield* unsupportedNotePieces(envelope.unsupported);
  yield* diagnosticsNotePieces(envelope.diagnostics);
  yield* completenessNotePieces(envelope.completeness);
}

/**
 * Render a tables document as text (`--format text`, the default).
 *
 * The iterable is lazy: pass 1 (widths) runs when this function is called, and each chunk is
 * produced when the consumer pulls it. The bytes depend on the envelope alone — no terminal, no
 * environment, no locale (§3.3).
 */
export function renderTablesText(envelope: JsonTablesEnvelope): Iterable<string> {
  const result = envelope.result;
  const rows = result === null ? [] : result.tables;
  const widths = measure(rows);
  return chunkPieces(textPieces(envelope, widths));
}
