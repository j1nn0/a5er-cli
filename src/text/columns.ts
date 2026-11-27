/**
 * `text/columns.ts` — the `a5er columns --format text` renderer.
 *
 * **Layout.** A status note, an object note, one table when there are rows, then the short notes:
 * the column totals (or why they are incomplete), the `UsingCommonColumns` fact, collisions and the
 * diagnostics summary. Notes start with `#`, the header starts with `N`, and a row starts with a
 * number, so the three line classes can never be confused — the same rule `tables` follows.
 *
 * **The table.** `N` is 1-based, `PNAME` and `LNAME` are rendered through `renderNamePieces` (quoted
 * and escaped where the escape set requires it, never truncated), `SRC` is `D` for a declared column
 * and `C` for a composed one, and `COLL` is `!` when the name collides, `-` otherwise. Names wider than
 * the alignment cap are written in full and the row simply
 * stops being aligned; padding never grows with a name, which is what keeps one 200,001-character
 * name from costing hundreds of millions of cells.
 *
 * **What an incomplete answer says.** A view has no rows at all — its record has no list — and the
 * note states the reason. An entity whose `UsingCommonColumns` could not be decided shows its
 * declared columns and says that common-derived columns are not fully known; the visible count is
 * never presented as the entity's total.
 *
 * No I/O, no terminal width, no locale.
 */

import type {
  JsonColumnsEnvelope,
  JsonColumnsResult,
  JsonColumnsViewResult,
  JsonColumnCollision,
  JsonDiagnostic,
  JsonEntityColumns,
} from '../json/index.js';
import { NOTE_PREFIX } from '../view/tables.js';
import { chunkPieces } from './chunks.js';
import { renderNamePieces, renderedNameWidth } from './escape.js';
import { PNAME_ALIGN_CAP } from './tables.js';
import { displayWidth } from './width.js';

/** Two spaces separate every column, the same separator the tables renderer uses. */
const COLUMN_SEPARATOR = '  ';

/** The header cells, in column order. */
const HEADER = {
  n: 'N',
  pname: 'PNAME',
  lname: 'LNAME',
  src: 'SRC',
  coll: 'COLL',
} as const;

/** The one reason a partial entity's common contribution is missing. */
const PARTIAL_REASON: Readonly<Record<'using-common-columns-unrecognised', string>> = {
  'using-common-columns-unrecognised':
    'UsingCommonColumns is neither 1 nor 0, so common columns are not composed',
};

/** The view reasons, worded like the `tables` notes so the two commands read the same. */
const VIEW_REASON: Readonly<Record<JsonColumnsViewResult['columns']['reason'], string>> = {
  'view-columns-not-stored': 'a view does not store its columns',
  'view-columns-named-from-query':
    'a view names its columns from its query (LNameByComment=1) and does not store them',
};

/** One table row: a column of the selected entity, in list order. */
interface ColumnRow {
  readonly n: number;
  readonly pname: string;
  readonly lname: string;
  readonly source: 'declared' | 'common';
  readonly collision: boolean;
}

/** The table's fixed widths and the two capped name widths. */
interface ColumnWidths {
  readonly n: number;
  readonly pname: number;
  readonly lname: number;
  readonly src: number;
  readonly coll: number;
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
 * The rows of a result: the effective list, which carries the calculated collision flags in both complete and partial states.
 *
 * A view contributes none — its record has no list — and the notes below say why.
 */
function rowsOf(result: JsonColumnsResult | null): ColumnRow[] {
  if (result === null || result.kind === 'view') return [];
  const columns: JsonEntityColumns = result.columns;
  const list = columns.columns;
  return list.map((column, index) => ({
    n: index + 1,
    pname: column.pname,
    lname: column.logicalName,
    source: column.source,
    collision: column.collision,
  }));
}

/**
 * Pass 1: the widths, as numbers. Only the two name columns take file text, so only they can need
 * the cap; a name past it contributes nothing to the width.
 */
function measure(rows: readonly ColumnRow[]): ColumnWidths {
  let n = displayWidth(HEADER.n);
  let pname = displayWidth(HEADER.pname);
  let lname = displayWidth(HEADER.lname);

  for (const row of rows) {
    n = Math.max(n, displayWidth(String(row.n)));
    const pnameWidth = renderedNameWidth(row.pname);
    const lnameWidth = renderedNameWidth(row.lname);
    if (pnameWidth <= PNAME_ALIGN_CAP) pname = Math.max(pname, pnameWidth);
    if (lnameWidth <= PNAME_ALIGN_CAP) lname = Math.max(lname, lnameWidth);
  }

  return { n, pname, lname, src: displayWidth(HEADER.src), coll: displayWidth(HEADER.coll) };
}

/** Emit one name cell and the padding after it, without ever building the padded name. */
function* nameCellPieces(value: string, width: number): Generator<string, void, undefined> {
  const nameWidth = renderedNameWidth(value);
  yield* renderNamePieces(value);
  if (nameWidth <= PNAME_ALIGN_CAP) yield ' '.repeat(width - nameWidth);
}

/** The header line, aligned like the rows. */
function* headerPieces(widths: ColumnWidths): Generator<string, void, undefined> {
  yield padLeft(HEADER.n, widths.n);
  yield COLUMN_SEPARATOR;
  yield padRight(HEADER.pname, widths.pname);
  yield COLUMN_SEPARATOR;
  yield padRight(HEADER.lname, widths.lname);
  yield COLUMN_SEPARATOR;
  yield padRight(HEADER.src, widths.src);
  yield COLUMN_SEPARATOR;
  yield HEADER.coll;
  yield '\n';
}

/** One row: the 1-based position, the two names, the source letter and the collision marker. */
function* rowPieces(row: ColumnRow, widths: ColumnWidths): Generator<string, void, undefined> {
  yield padLeft(String(row.n), widths.n);
  yield COLUMN_SEPARATOR;
  yield* nameCellPieces(row.pname, widths.pname);
  yield COLUMN_SEPARATOR;
  yield* nameCellPieces(row.lname, widths.lname);
  yield COLUMN_SEPARATOR;
  yield padRight(row.source === 'declared' ? 'D' : 'C', widths.src);
  yield COLUMN_SEPARATOR;
  yield row.collision ? '!' : '-';
  yield '\n';
}

/** `1 (declared)` / `1 (defaulted; the key is absent)` / `0 (declared)` / `unrecognised`. */
function usingCommonColumnsText(columns: JsonEntityColumns): string {
  const fact = columns.usingCommonColumns;
  if (fact.token === 'unrecognised') return 'unrecognised';
  if (fact.token === 'absent') return '1 (defaulted; the key is absent)';
  return `${String(fact.value ?? 0)} (declared)`;
}

/** The object note: kind, escaped name, and where it was declared. */
function* objectNotePieces(result: JsonColumnsResult): Generator<string, void, undefined> {
  yield `${NOTE_PREFIX} object: ${result.kind} `;
  yield* renderNamePieces(result.pname);
  yield ` (section ${String(result.sectionIndex)}, line ${String(result.span.startLine)})\n`;
}

/** One collision record: the repeated name (escaped) and the lines that declared it. */
function* collisionPieces(collision: JsonColumnCollision): Generator<string, void, undefined> {
  yield `${NOTE_PREFIX}   `;
  yield* renderNamePieces(collision.pname);
  yield ' at lines ';
  let first = true;
  for (const span of collision.spans) {
    if (!first) yield ', ';
    first = false;
    yield String(span.startLine);
  }
  yield '\n';
}

/** The diagnostics summary, one line; fatal and error lines are already on stderr. */
function diagnosticsNote(diagnostics: readonly JsonDiagnostic[]): string {
  const perSeverity: Record<JsonDiagnostic['severity'], number> = {
    fatal: 0,
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const diagnostic of diagnostics) perSeverity[diagnostic.severity] += 1;
  return (
    `${NOTE_PREFIX} diagnostics: ${String(diagnostics.length)} (fatal ${String(perSeverity.fatal)}, ` +
    `error ${String(perSeverity.error)}, warning ${String(perSeverity.warning)}, ` +
    `info ${String(perSeverity.info)})\n`
  );
}

/** Every line of the document, as pieces. */
function* textPieces(envelope: JsonColumnsEnvelope): Generator<string, void, undefined> {
  const result = envelope.result;
  const rows = rowsOf(result);
  const widths = measure(rows);

  yield `${NOTE_PREFIX} status: ${envelope.status}\n`;
  if (result === null) {
    yield `${NOTE_PREFIX} object: none (status failed)\n`;
  } else {
    yield* objectNotePieces(result);
    if (rows.length > 0) {
      yield* headerPieces(widths);
      for (const row of rows) yield* rowPieces(row, widths);
    }
  }

  if (result !== null && result.kind === 'entity') {
    const columns = result.columns;
    if (columns.status === 'complete') {
      yield `${NOTE_PREFIX} columns: ${String(columns.columns.length)} (declared ${String(columns.declared.length)}, common ${String(columns.common.length)})\n`;
    } else {
      const visible = columns.declared.length;
      yield `${NOTE_PREFIX} columns shown: ${String(visible)} declared; common-derived columns are not fully known\n`;
      yield `${NOTE_PREFIX} note: ${PARTIAL_REASON[columns.reason]}\n`;
    }
    yield `${NOTE_PREFIX} using common columns: ${usingCommonColumnsText(columns)}\n`;
    if (columns.collisions.length > 0) {
      yield `${NOTE_PREFIX} collisions: ${String(columns.collisions.length)}\n`;
      for (const collision of columns.collisions) yield* collisionPieces(collision);
    }
  }

  if (result !== null && result.kind === 'view') {
    yield `${NOTE_PREFIX} note: ${VIEW_REASON[result.columns.reason]}\n`;
  }

  yield diagnosticsNote(envelope.diagnostics);
}

/**
 * Render a columns document as text (`--format text`, the default).
 *
 * The iterable is lazy: the widths are measured when the caller pulls the first chunk and each line
 * is produced on demand, so nothing is built ahead of the writer.
 */
export function renderColumnsText(envelope: JsonColumnsEnvelope): Iterable<string> {
  return chunkPieces(textPieces(envelope));
}
