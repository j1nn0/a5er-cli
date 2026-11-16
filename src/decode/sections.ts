/**
 * Recognised section headers (`architecture.md` §10.4).
 *
 * The rule this implements is exactly one line of the document: a document with **zero** of the
 * nine known headers is `E_UNRECOGNIZED_DOCUMENT` — the guard against reporting an arbitrary
 * JSON or PowerShell file as an empty-but-healthy ER diagram.
 *
 * Temporary home: the full section scan (order, spans, aliases, unknown sections) belongs to
 * `src/syntax/` in stage 3. What lives here is the *detection* the io/decode stage needs, and
 * nothing more — it recognises headers and returns them; it does not model them.
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
 * Every header-looking line, trimmed, in file order.
 *
 * Names are returned verbatim: `[Memo]` and `[entity]` are headers too, they are simply not
 * recognised. The caller decides what an unknown name means.
 */
export function scanSectionHeaders(text: string): string[] {
  const headers: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const match = HEADER_PATTERN.exec(line);
    if (match?.[1] !== undefined) headers.push(match[1]);
  }
  return headers;
}

/** True when at least one header names a section this project models (§10.4). */
export function hasRecognisedSection(text: string): boolean {
  return scanSectionHeaders(text).some((name) =>
    (RECOGNISED_SECTIONS as readonly string[]).includes(name),
  );
}
