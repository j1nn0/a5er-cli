/**
 * Physical lines of the decoded text (`architecture.md` §4.1, U4).
 *
 * The format defines no line endings at all, so a line break is `\r\n`, `\n` or a bare `\r`,
 * and which one a line had is a fact the scanner keeps: `hst-05` mixes all three in one file
 * and the line numbers must survive it.
 *
 * Two properties make the output lossless, which is what the rest of the stage relies on:
 *
 * - `text` is the line exactly as it appeared — no trimming, no normalisation;
 * - `ending` is the terminator that followed it, or `''` for a final line without one.
 *
 * Therefore `lines.map((line) => line.text + line.ending).join('')` is the input string,
 * character for character. A file that ends with a newline does **not** gain a phantom empty
 * line: the terminator is recorded on the line it closes, which is the same convention as
 * `wc -l` and is what keeps "one record per source line" honest (§13).
 */

/** The terminator a line was followed by; `''` for a last line with none. */
export type LineEnding = '\r\n' | '\n' | '\r' | '';

export interface SourceLine {
  /** 1-based; the unit every `Span` in this project counts in (§4.1). */
  readonly number: number;
  /** Line content without its terminator, verbatim. */
  readonly text: string;
  /** Terminator as it appeared in the decoded text. */
  readonly ending: LineEnding;
}

/**
 * Split `text` into physical lines, recording each terminator (§4.1, U4).
 *
 * A one-pass scan, not a regex split: `\r\n` must stay one ending rather than becoming an
 * empty line between two, and the result must not allocate a phantom line for the trailing
 * newline that most editors add.
 */
export function splitLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\r' && char !== '\n') continue;

    const ending: LineEnding =
      char === '\r' && text[index + 1] === '\n' ? '\r\n' : char === '\r' ? '\r' : '\n';
    lines.push({ number, text: text.slice(start, index), ending });
    number += 1;
    if (ending === '\r\n') index += 1;
    start = index + 1;
  }

  // A final line without a terminator is still a line; a file that ended with one is complete.
  if (start < text.length) lines.push({ number, text: text.slice(start), ending: '' });
  return lines;
}
