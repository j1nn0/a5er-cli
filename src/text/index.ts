/**
 * `text/` — the human-readable renderer for `a5er tables` (`docs/proposals/human-cli.md` §4, §6).
 *
 * Five pieces, each with one job:
 *
 * - `escape.ts` — the frozen escape set, the quote/bare/absent decision for a name, the two
 *   encoders (`quoteArg` for argv tokens, `\u{XXXX}` for names) and the width of a rendered name;
 * - `width.ts` — the frozen display-width table, hand-written so the padding does not follow the
 *   runtime's Unicode version;
 * - `chunks.ts` — the only place output accumulates: bounded chunks that never split a surrogate
 *   pair;
 * - `tables.ts` — the two-pass renderer: measure widths, then emit pieces.
 *
 * - `diagnostics.ts` — stderr's one line per `fatal`/`error` diagnostic, lazily, for the writer.
 *
 * **Dependencies point one way** (§6): `text → json` (types) and `validate` (types), plus the note
 * prefix that `view/tables.ts` owns so the JSON and text halves cannot drift. No stage's code is
 * imported, so the renderer cannot parse or re-decide anything: it formats a document that already
 * exists.
 *
 * **Nothing here reads the environment.** No terminal width, no `COLUMNS`, no `TERM`, no colour, no
 * locale and no clock: the same envelope renders to the same bytes on a TTY, a pipe and a file
 * (§3.3).
 */

export {
  escapeText,
  isEscapedCodePoint,
  isQuotingWhitespace,
  quoteArg,
  renderNamePieces,
  renderedNameWidth,
} from './escape.js';
export { CHUNK_FLUSH_UNITS, CHUNK_LIMIT_UNITS, chunkPieces } from './chunks.js';
export { codePointWidth, displayWidth } from './width.js';
export type { DisplayWidth } from './width.js';
export { PNAME_ALIGN_CAP, renderTablesText } from './tables.js';
export { tablesDiagnosticLines } from './diagnostics.js';
