/**
 * Recognised section headers (`architecture.md` §10.4).
 *
 * The rule this implements is exactly one line of the document: a document with **zero** of the
 * nine known headers is `E_UNRECOGNIZED_DOCUMENT` — the guard against reporting an arbitrary
 * JSON or PowerShell file as an empty-but-healthy ER diagram.
 *
 * This module is the **single** definition of two things: what a header line is, and which
 * names the project models. `src/syntax/` scans the same headers line by line (order, spans,
 * kind) and imports `headerNameOf` and `RECOGNISED_SECTIONS` from here, so the scanner and the
 * document guard can never drift apart. `scanSectionHeaders`/`hasRecognisedSection` stay as the
 * thin detection helpers `decode/load.ts` needs; they do not model anything.
 */

/** The nine section names of §10.4, case-sensitive (the file format defines no case rule). */
export const RECOGNISED_SECTIONS = [
  'Manager',
  'Entity',
  'Relation',
  'Relationship',
  'View',
  'Subtype',
  'Shape',
  'Line',
  'Comment',
] as const;

export type RecognisedSection = (typeof RECOGNISED_SECTIONS)[number];

/**
 * A header line is `[name]` after trimming, with a non-empty name.
 *
 * The match is greedy on the outer pair, so `[[Entity]]` is a header whose name is
 * `[Entity]` — the reading the `hst-04` fixture pins — while `[Entity]x` is not a header at
 * all because a character follows the closing bracket.
 */
const HEADER_PATTERN = /^\s*\[(.+)\]\s*$/;

/**
 * The name of one header line, or `null` when the line is not a header.
 *
 * The name is returned verbatim: `[Memo]` and `[entity]` are headers too, they are simply not
 * recognised. The caller decides what an unknown name means. This is the one place the pattern
 * is applied, so the syntax scanner cannot read a header differently from the guard.
 */
export function headerNameOf(line: string): string | null {
  const match = HEADER_PATTERN.exec(line);
  return match?.[1] ?? null;
}

/** True when `name` is one of the nine headers this project models (§10.4). */
export function isRecognisedSection(name: string): boolean {
  return (RECOGNISED_SECTIONS as readonly string[]).includes(name);
}

/**
 * Every header-looking line, trimmed, in file order.
 *
 * Names are returned verbatim: `[Memo]` and `[entity]` are headers too, they are simply not
 * recognised. The caller decides what an unknown name means.
 */
export function scanSectionHeaders(text: string): string[] {
  const headers: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const name = headerNameOf(line);
    if (name !== null) headers.push(name);
  }
  return headers;
}

/**
 * True when at least one header names a section this project models (§10.4).
 *
 * One forward index walk over the same lines `scanSectionHeaders()` splits out — same lines, same
 * order, same `headerNameOf()` reading — so no array of lines and no whole-text copy is built, and
 * the walk stops at the first recognised header. `\r\n` is one terminator and a lone `\r` or `\n`
 * is one too, which is exactly `/\r\n|\n|\r/`'s alternation.
 *
 * Worst case `O(text.length)`: each code unit is read once, the only substring is the line being
 * tested, and nothing is retained after that line is decided.
 */
export function hasRecognisedSection(text: string): boolean {
  let start = 0;

  while (start < text.length) {
    let end = start;
    while (end < text.length) {
      const unit = text.charCodeAt(end);
      if (unit === 0x0a || unit === 0x0d) break;
      end += 1;
    }

    // The same helper the split-based scan calls, on the same line text: a header is recognised
    // only when both the line and the name agree with what `scanSectionHeaders()` would produce.
    const name = headerNameOf(text.slice(start, end));
    if (name !== null && isRecognisedSection(name)) return true;

    if (end === text.length) return false;
    // CRLF is one boundary; a lone CR or LF is one. Nothing else is a terminator.
    start = text.charCodeAt(end) === 0x0d && text.charCodeAt(end + 1) === 0x0a ? end + 2 : end + 1;
  }

  return false;
}
