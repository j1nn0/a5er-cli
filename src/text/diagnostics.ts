/**
 * `text/diagnostics.ts` — the lazy stderr source for `a5er tables`
 * (`docs/proposals/human-cli.md` §3.6, §6).
 *
 * **What it is.** One `fatal` or `error` line per `next()`, in the integration's own order, with the
 * bytes `inspect` already prints: `a5er: <severity>: <code>: <message>`, then ` (line <n>)` when the
 * diagnostic has a span. `warning` and `info` never reach stderr — in text mode they are summarised
 * in the notes and in JSON the envelope holds them.
 *
 * **Why a generator.** `inspect` builds its stderr as one string in `renderDiagnostics()`, which is
 * unchanged. `tables` may have 30,000 such lines, so it yields them one at a time and the writer
 * chunks them (§7.2 item 8). The bytes are the same either way; `tests/text-diagnostics.test.ts`
 * pins the format and P1's CLI test compares the two runs byte for byte.
 *
 * `details` is file text and is never printed; the message is fixed table text, and the span
 * contributes its line number only — the same rule `renderDiagnostics()` follows.
 *
 * Imports `src/validate/` types only: no stage is run and nothing is decided here.
 */

import type { Integration } from '../validate/index.js';

/**
 * One line per diagnostic that can decide a non-zero exit, in the integration's order.
 *
 * Lazy: the caller pulls a line at a time, so nothing is built before it is written.
 */
export function* tablesDiagnosticLines(
  integration: Integration,
): Generator<string, void, undefined> {
  for (const diagnostic of integration.diagnostics) {
    if (diagnostic.severity !== 'fatal' && diagnostic.severity !== 'error') continue;
    const where = diagnostic.span === null ? '' : ` (line ${diagnostic.span.startLine})`;
    yield `a5er: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}${where}\n`;
  }
}
