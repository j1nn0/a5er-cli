/**
 * The Complex value splitter (`architecture.md` §7.1, F3, P5).
 *
 * Highest-risk component in the format: it sits on the path of every comment, logical name and
 * `Field`, and one wrong rule corrupts rows silently. The rules, each traceable to `値の
 * フォーマット` and byte-verified in P5:
 *
 * | Rule | What breaks without it |
 * |---|---|
 * | `,` separates only outside double quotes | `"user_name,birthday"` splits into two columns |
 * | Escapes are `\\` `\Q` `\q` `\t` `\n`; an unknown escape passes through as `\x` | `\Q` read as a quote corrupts every comment containing one |
 * | Whitespace outside quotes is padding; inside quotes nothing is trimmed | the official `…,"user_name", ""` sample gains a leading space in a column name |
 * | Unquoted values are taken verbatim | `String` fields are "no escaping" by spec; unescaping them invents data |
 * | An element may be empty or quoted-empty | the キー順 gap becomes a parse failure |
 * | An unterminated quote yields a diagnostic and the raw remainder as one element | silent truncation |
 *
 * **Tokenisation, not unescaping.** This module never interprets an escape: `value` keeps the
 * sequences the file wrote and `hadEscape` says whether to look. Decoding `EscapedString` and
 * `String` is the next stage's job (3B), and keeping the two apart is what stops `\Q` from
 * turning into a quote at the wrong moment.
 *
 * Nothing here is CSV: the format writes a quote inside a value as `\Q`, never as `""`, so
 * doubling is not an escape and is not treated as one.
 */

import { emitSyntax } from '../diagnostics/diagnostic.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';

/** One element of a Complex value. */
export interface ComplexPart {
  /**
   * Element text without its own quoting and without the padding around it.
   *
   * For a quoted element this is the text between the quotes, exactly as written — escapes
   * included, nothing trimmed. For an unquoted element it is the element verbatim, with the
   * spaces and tabs that separated it from its neighbours removed.
   */
  readonly value: string;
  /** True when the element was written as a quoted string. */
  readonly quoted: boolean;
  /**
   * True when the element contains a backslash.
   *
   * Deliberately "contains a backslash" rather than "contains a known escape": a known escape
   * is a reason to unescape, but an *unknown* one has to be looked at too (`\x` passes through
   * as itself), and reporting the superset cannot make a consumer skip work it needs to do.
   */
  readonly hadEscape: boolean;
}

/** The result of splitting one Complex value (§7.1). */
export interface ComplexParts {
  readonly parts: readonly ComplexPart[];
  /**
   * True when the value ends with a separator, i.e. its last slot was left blank instead of
   * being written out.
   *
   * A bare trailing `,` declares nothing; `""` does declare an empty element. The distinction
   * matters to §7.2's element count and is therefore recorded instead of guessed at.
   */
  readonly trailingElementsOmitted: boolean;
  /** Diagnostics about the value itself; only the unterminated quote exists at this level. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Characters an escape may introduce (§7.1's escape table). */
const ESCAPE_INTRODUCERS = new Set(['\\', 'Q', 'q', 't', 'n']);

/** Padding the format uses around elements: spaces and tabs, never inside quotes (§7.1). */
const PADDING = /[ \t]/;

/** True when the character at `index` is padding. */
function isPadding(text: string, index: number): boolean {
  const char = text[index];
  return char !== undefined && PADDING.test(char);
}

/**
 * Index of the quote that closes the one at `open`, or `-1`.
 *
 * Escape-aware for the four escapes that contain a backslash-consumable pair, because `\\` is
 * two characters of *data*: `"a\\"` is the value `a\\`, not the value `a\` followed by a stray
 * quote. An unknown escape such as `\"` is **not** treated as escaped — only `\Q` writes a
 * quote inside a value (§7.1) — so the `"` after a lone `\` closes the string.
 */
function findClosingQuote(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      if (next !== undefined && ESCAPE_INTRODUCERS.has(next)) index += 1;
      continue;
    }
    if (char === '"') return index;
  }
  return -1;
}

/** One element's slice of the raw value, before quoting is resolved. */
interface Slice {
  readonly start: number;
  readonly end: number;
}

/**
 * Split the raw value into element slices on the commas that are outside quotes.
 *
 * Comma detection is a single pass with an `inQuotes` flag; a comma after an unterminated
 * opening quote is inside the string by definition, which is what keeps §7.1's "raw remainder
 * as one element" true.
 */
function slice(raw: string): { slices: Slice[]; unterminated: boolean } {
  const slices: Slice[] = [];
  let start = 0;
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inQuotes) {
      if (char === '\\') {
        const next = raw[index + 1];
        if (next !== undefined && ESCAPE_INTRODUCERS.has(next)) index += 1;
        continue;
      }
      if (char === '"') inQuotes = false;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      slices.push({ start, end: index });
      start = index + 1;
    }
  }

  slices.push({ start, end: raw.length });
  return { slices, unterminated: inQuotes };
}

/** Resolve one slice: strip outside padding, then decide whether it was quoted. */
function readPart(raw: string, sliceRange: Slice): ComplexPart {
  let { start, end } = sliceRange;
  while (start < end && isPadding(raw, start)) start += 1;
  while (end > start && isPadding(raw, end - 1)) end -= 1;

  if (start === end) return { value: '', quoted: false, hadEscape: false };

  if (raw[start] === '"') {
    const close = findClosingQuote(raw, start);
    // Quoted only when the closing quote is the last thing in the element: text after it is
    // not produced by the writer, so the element is kept verbatim as an unquoted value rather
    // than silently dropping the excess.
    if (close === end - 1) {
      const value = raw.slice(start + 1, close);
      return { value, quoted: true, hadEscape: value.includes('\\') };
    }
  }

  const value = raw.slice(start, end);
  return { value, quoted: false, hadEscape: value.includes('\\') };
}

/**
 * Split one Complex value into its elements (`architecture.md` §7.1).
 *
 * `span` is optional and exists so the caller can point the diagnostic at the entry the value
 * belongs to; without it the diagnostic carries `span: null` rather than a fabricated position
 * (§4.1: no invented spans). Escapes are recorded, never applied — 3B owns `EscapedString`.
 */
export function splitComplex(raw: string, span: Span | null = null): ComplexParts {
  const { slices, unterminated } = slice(raw);
  const parts = slices.map((range) => readPart(raw, range));

  const diagnostics: Diagnostic[] = [];
  if (unterminated) {
    diagnostics.push(
      emitSyntax('S_COMPLEX_UNTERMINATED_QUOTE', {
        span,
        construct: 'Complex',
      }),
    );
  }

  const last = parts.at(-1);
  const trailingElementsOmitted =
    parts.length > 1 && last !== undefined && last.value === '' && !last.quoted;

  return { parts, trailingElementsOmitted, diagnostics };
}
