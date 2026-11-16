/**
 * Header peek and parse (`architecture.md` §8.1, P1/F2).
 *
 * The two header comments are `# A5:ER FORMAT:<n>` and `# A5:ER ENCODING:<enc>`. They are
 * **hints**, and they are read twice:
 *
 * 1. `peekHeader` scans the first 8 KiB of the *bytes* as ASCII, before the encoding is known.
 *    Its result does **not** order the candidates: since R11 the order is fixed (a BOM pins the
 *    codec, otherwise UTF-8 first), so a pre-decode reading decides nothing. It is kept for
 *    byte-level callers; the pipeline uses `parseHeader` alone (§8.1).
 * 2. `parseHeader` runs the same pattern over the *decoded* text, and that reading is
 *    authoritative (§8.1: "re-parsed from the decoded text as authoritative").
 *
 * An unknown FORMAT (`20`, `99`, absent) is not a decode failure: this module reports what was
 * declared and the F2 gate in the syntax stage decides what it means.
 */

/** Bytes of the byte stream inspected by the ASCII peek (§8.1: "the first 8 KiB"). */
export const HEADER_PEEK_BYTES = 8 * 1024;

/** The header comment pattern from §8.1, anchored per line. */
const HEADER_PATTERN = /^#\s*A5:ER\s*(FORMAT|ENCODING)\s*:\s*(\S+)$/gm;

export interface HeaderHint {
  /** `FORMAT:<n>` as a number, or `null` when absent or not numeric. */
  readonly format: number | null;
  /** `ENCODING:<token>` verbatim, or `null` when absent. */
  readonly encoding: string | null;
}

export const NO_HEADER: HeaderHint = { format: null, encoding: null };

/**
 * ASCII peek over the first 8 KiB of the raw bytes.
 *
 * `latin1` maps bytes 1:1 to code points, so an ASCII header survives any single-byte encoding
 * and a UTF-16LE header simply does not match — which is why the decoded parse below is the
 * authoritative one.
 */
export function peekHeader(bytes: Uint8Array): HeaderHint {
  const window = Buffer.from(bytes.subarray(0, HEADER_PEEK_BYTES));
  return matchHeader(window.toString('latin1'));
}

/** Authoritative header parse over decoded text (§8.1). */
export function parseHeader(text: string): HeaderHint {
  return matchHeader(text);
}

function matchHeader(source: string): HeaderHint {
  let format: number | null = null;
  let encoding: string | null = null;

  for (const match of source.matchAll(HEADER_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;

    if (name === 'FORMAT') {
      // A non-numeric FORMAT is "declared but not a version"; the F2 gate reports it later.
      if (/^\d+$/.test(value)) format = Number(value);
    } else {
      encoding = value;
    }
  }

  return { format, encoding };
}
