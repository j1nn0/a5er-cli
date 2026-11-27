/**
 * `text/relations.ts` — the `a5er relations --format text` renderer.
 *
 * **Layout.** A status note, a count note, one table when the file declares relations, the endpoint
 * legend and the diagnostics summary. Notes start with `#` and the header row starts with `IDX`, so
 * the two line classes can never be confused — the same rule `tables` and `columns` follow.
 *
 * **The table.** One row per relation, in file order:
 *
 * | Column | What it is |
 * |---|---|
 * | `IDX` | the relation's `sectionIndex` |
 * | `SEC` | the header without its brackets: `Relation`, or `Relationship` for the alias |
 * | `NAME` | the relation's own `PName`, `-` when it declares none |
 * | `EP1`/`EP2` | the declared endpoint name and how it resolved, with the candidate count when ambiguous |
 * | `C1`/`C2` | the declared slot count of `Fields1`/`Fields2`, `unknown` when the key is absent |
 * | `CARD1`/`CARD2` | the declared `Cardinarity1`/`Cardinarity2` string, `-` when absent |
 * | `ALIGN` | `true`, `false`, or `unknown` when a side's list is absent |
 *
 * `C1`/`C2` count empty slots, so `"a,,b"` is three. They are never `0` for a list the file does not
 * carry: `unknown` is not zero, and a present-but-empty list is `0`.
 *
 * **Widths stay bounded.** Every cell that carries file text is rendered through
 * `renderNamePieces` (quoted and escaped where the escape set requires it, never truncated) and
 * contributes to a column's width only while it fits the alignment cap, so one long name cannot
 * make the padding grow with the file. A wider cell is written in full and the row simply stops
 * being aligned.
 *
 * No I/O, no terminal width, no locale.
 */

import type {
  JsonDiagnostic,
  JsonRelationsEndpoint,
  JsonRelationsEnvelope,
  JsonRelationsRow,
} from '../json/index.js';
import { NOTE_PREFIX } from '../view/tables.js';
import { chunkPieces } from './chunks.js';
import { renderNamePieces, renderedNameWidth } from './escape.js';
import { PNAME_ALIGN_CAP } from './tables.js';
import { displayWidth } from './width.js';

/** Two spaces separate every column, the same separator the other renderers use. */
const COLUMN_SEPARATOR = '  ';

/** The cell text for a fact the file does not state. Never `0`, never `false`. */
const UNKNOWN = 'unknown';

/** The header row, in column order. */
const HEADER: readonly Cell[] = [
  'IDX',
  'SEC',
  'NAME',
  'EP1',
  'EP2',
  'C1',
  'C2',
  'CARD1',
  'CARD2',
  'ALIGN',
].map((text) => plainCell(text));

/** One piece of a cell: file text (escaped and capped) or a constant this renderer owns. */
type CellPart =
  | { readonly file: true; readonly text: string | null }
  | { readonly file: false; readonly text: string };

/** One cell: its pieces and the edge it is aligned to. */
interface Cell {
  readonly parts: readonly CellPart[];
  readonly align: 'left' | 'right';
}

/** A cell of fixed text or a number this renderer formatted. */
function plainCell(text: string, align: 'left' | 'right' = 'left'): Cell {
  return { parts: [{ file: false, text }], align };
}

/**
 * A cell of file text; `null` renders as `-`, `''` as `""` and a bare `-` as `"-"`, the conventions
 * `tables` already uses, so a missing value can never be read as a name.
 */
function fileCell(text: string | null, align: 'left' | 'right' = 'left'): Cell {
  return { parts: [{ file: true, text }], align };
}

/** `[Relation]` as `Relation`: the header the section actually carried, without its brackets. */
function shortHeader(header: string): string {
  return header.startsWith('[') && header.endsWith(']') ? header.slice(1, -1) : header;
}

/** The declared slot count, or `unknown` when the key is absent. `0` stays `0`. */
function countCell(count: number | null): Cell {
  return plainCell(count === null ? UNKNOWN : String(count), 'right');
}

/**
 * One endpoint: the declared name, then how it resolved.
 *
 * The status is this renderer's own text, so it is never escaped with the name; an ambiguous
 * endpoint carries its candidate count, which is this tool's figure and the only explanation the
 * text format gives for a name that matched more than one entity.
 */
function endpointCell(endpoint: JsonRelationsEndpoint | null): Cell {
  if (endpoint === null) return plainCell('-');
  const status =
    endpoint.status === 'ambiguous'
      ? `ambiguous (${String(endpoint.candidates)} candidates)`
      : endpoint.status;
  return {
    parts: [
      { file: true, text: endpoint.declared },
      { file: false, text: ` ${status}` },
    ],
    align: 'left',
  };
}

/** One row's cells, in header order. */
function rowCells(row: JsonRelationsRow): readonly Cell[] {
  return [
    plainCell(String(row.sectionIndex), 'right'),
    fileCell(shortHeader(row.sectionHeader)),
    fileCell(row.pname),
    endpointCell(row.from),
    endpointCell(row.to),
    countCell(row.fields1Count),
    countCell(row.fields2Count),
    fileCell(row.cardinarity1),
    fileCell(row.cardinarity2),
    plainCell(row.columnsAligned === null ? UNKNOWN : String(row.columnsAligned)),
  ];
}

/** The display width of one cell, before any padding. */
function cellWidth(cell: Cell): number {
  let width = 0;
  for (const part of cell.parts) {
    width += part.file ? renderedNameWidth(part.text) : displayWidth(part.text);
  }
  return width;
}

/**
 * Pass 1: the widths, as numbers.
 *
 * A cell wider than the alignment cap contributes nothing, so the padding never grows with file
 * text; the cell itself is still written in full.
 */
function measure(widths: number[], cells: readonly Cell[]): void {
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const current = widths[index];
    if (cell === undefined || current === undefined) continue;
    const width = cellWidth(cell);
    if (width > PNAME_ALIGN_CAP) continue;
    if (width > current) widths[index] = width;
  }
}

/** One cell: its padding on the side it is aligned to, then its pieces (the last cell is bare). */
function* cellPieces(cell: Cell, width: number, last: boolean): Generator<string, void, undefined> {
  const own = cellWidth(cell);
  const pad = last || own > PNAME_ALIGN_CAP ? 0 : width - own;
  if (cell.align === 'right' && pad > 0) yield ' '.repeat(pad);
  for (const part of cell.parts) {
    if (part.file) yield* renderNamePieces(part.text);
    else yield part.text;
  }
  if (cell.align !== 'right' && pad > 0) yield ' '.repeat(pad);
}

/** Emit one line of the table. */
function* linePieces(
  cells: readonly Cell[],
  widths: readonly number[],
): Generator<string, void, undefined> {
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell === undefined) continue;
    if (index > 0) yield COLUMN_SEPARATOR;
    yield* cellPieces(cell, widths[index] ?? 0, index === cells.length - 1);
  }
  yield '\n';
}

/** The endpoint legend, the one thing the `EP1`/`EP2` cells cannot explain in a few words. */
const ENDPOINT_NOTE =
  `${NOTE_PREFIX} endpoint: the declared name, then resolved, dangling, or ` +
  `ambiguous (N candidates)\n`;

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
function* textPieces(envelope: JsonRelationsEnvelope): Generator<string, void, undefined> {
  yield `${NOTE_PREFIX} status: ${envelope.status}\n`;

  const result = envelope.result;
  if (result === null) {
    yield `${NOTE_PREFIX} relations: none (status failed)\n`;
  } else {
    yield `${NOTE_PREFIX} relations: ${String(result.length)}\n`;
    if (result.length > 0) {
      const rows = result.map((row) => rowCells(row));
      // The header is measured first, so a short table still has a header as wide as its cells.
      const widths = HEADER.map((cell) => cellWidth(cell));
      for (const row of rows) measure(widths, row);
      yield* linePieces(HEADER, widths);
      for (const row of rows) yield* linePieces(row, widths);
    }
    yield ENDPOINT_NOTE;
  }

  yield diagnosticsNote(envelope.diagnostics);
}

/**
 * Render a relations document as text (`--format text`, the default).
 *
 * The iterable is lazy: the widths are measured when the caller pulls the first chunk and each line
 * is produced on demand, so nothing is built ahead of the writer.
 */
export function renderRelationsText(envelope: JsonRelationsEnvelope): Iterable<string> {
  return chunkPieces(textPieces(envelope));
}
