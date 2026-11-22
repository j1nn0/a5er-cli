/**
 * `text/escape.ts` — the frozen escape set, the quoting rules for names, and the two encoders
 * (`docs/proposals/human-cli.md` §3.5, §4.4, §7.4).
 *
 * **Why a fixed table.** The escape set must not be built from `\p{…}` property escapes or `Intl`:
 * those follow the runtime's Unicode version, and Node 24 and 26 can differ (`v24.22.3` reports
 * Unicode `17.0`, ICU `78.3`). A hand-written table gives the same bytes on both (§4.4.2).
 *
 * **Two encoders, two jobs.**
 *
 * - `quoteArg` is for a user-supplied **argv token** in a misuse message: the argument is untrusted
 *   and the result must still be a valid JSON string literal, so it starts from `JSON.stringify`
 *   and only replaces what that leaves raw. Its escapes are `\uXXXX`, lowercase, as JSON writes
 *   them (§3.5, S-6).
 * - `renderNamePieces` is for a **name column** of the text table: it decides bare, quoted or
 *   absent, and inside quotes it writes `\u{XXXX}` with uppercase hexadecimal — the form §4.4.1
 *   freezes, and the one the round-trip test decodes.
 *
 * **Nothing is built whole.** A name is rendered as a sequence of pieces, and the measurement never
 * builds the escaped text at all: `renderedNameWidth` walks the code points and adds the width the
 * escape *would* have. That is what keeps a 400,000-character name from turning into one string
 * (§4.10).
 *
 * No import, no clock, no locale, no `node:` module.
 */

import { codePointWidth } from './width.js';

/** At most this many code points per rendered slice (§4.10). */
const NAME_SLICE_CODE_POINTS = 16_384;

/** `"` and `\`, the two characters a quoted name must escape to stay unambiguous (§4.4.1). */
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * The frozen escape set of §4.4.2: code points that can move the cursor, start a control sequence
 * or are otherwise invisible.
 *
 * Combining marks, variation selectors, private-use code points and emoji are deliberately absent:
 * they cannot move the cursor, and escaping them would make a Japanese name unreadable.
 */
export function isEscapedCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // C0 controls, including NUL, BEL, BS, TAB, LF, CR and ESC
    (codePoint >= 0x7f && codePoint <= 0x9f) || // DEL and C1 controls, including CSI
    codePoint === 0x00ad || // soft hyphen
    codePoint === 0x061c || // Arabic letter mark
    codePoint === 0x180e || // Mongolian vowel separator
    (codePoint >= 0x200b && codePoint <= 0x200f) || // ZWSP, ZWNJ, ZWJ, LRM, RLM
    (codePoint >= 0x2028 && codePoint <= 0x202e) || // line/paragraph separators, bidi embeddings
    (codePoint >= 0x2060 && codePoint <= 0x206f) || // word joiner, invisible operators, isolates
    (codePoint >= 0xd800 && codePoint <= 0xdfff) || // lone surrogates
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || // noncharacters
    codePoint === 0xfeff || // BOM / zero-width no-break space
    (codePoint >= 0xfff9 && codePoint <= 0xfffb) || // interlinear annotation controls
    (codePoint & 0xfffe) === 0xfffe || // U+xFFFE and U+xFFFF in every plane
    (codePoint >= 0xe0000 && codePoint <= 0xe007f) // tag characters
  );
}

/**
 * The whitespace that forces quoting (§4.4.3), so a name with a space still parses as one cell.
 *
 * These stay literal inside the quotes; none of them is in the escape set, so nothing is doubled.
 */
export function isQuotingWhitespace(codePoint: number): boolean {
  return (
    codePoint === 0x0020 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

/** True when the value has to be quoted: an escape-set code point, whitespace, `"` or `\`. */
function needsQuotes(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (
      codePoint === QUOTE ||
      codePoint === BACKSLASH ||
      isEscapedCodePoint(codePoint) ||
      isQuotingWhitespace(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

/** `\u{XXXX}`: uppercase hexadecimal, at least four digits, no `U+` (§4.4.1). */
function escapedNameText(codePoint: number): string {
  return `\\u{${codePoint.toString(16).toUpperCase().padStart(4, '0')}}`;
}

/** The width of the `\u{XXXX}` text for `codePoint`: its ASCII length, 8 to 10 cells (§4.10). */
function escapedNameWidth(codePoint: number): number {
  // `\u{` + at least four hex digits + `}`.
  return 4 + Math.max(4, codePoint.toString(16).length);
}

/**
 * Replace every escape-set code point with `\u{XXXX}`; never quote (§4.8).
 *
 * For fixed short text only — the diagnostic messages, which are table text and not file content.
 * It is defence in depth: a message cannot move the cursor even if a future one is not ASCII.
 */
export function escapeText(text: string): string {
  if (!needsEscapingOnly(text)) return text;

  let escaped = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    escaped +=
      codePoint !== undefined && isEscapedCodePoint(codePoint)
        ? escapedNameText(codePoint)
        : character;
  }
  return escaped;
}

/** True when `text` holds at least one escape-set code point. */
function needsEscapingOnly(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isEscapedCodePoint(codePoint)) return true;
  }
  return false;
}

/**
 * Quote a user-supplied argv token so that no code point reaches the terminal raw (§3.5).
 *
 * `JSON.stringify` is used instead of string interpolation on purpose: the argument is untrusted
 * input, and the result is always a valid JSON string literal. It escapes C0 controls, `"`, `\`
 * and lone surrogates, but it leaves DEL, the C1 controls (U+009B CSI among them), the bidi
 * controls and the other invisible code points of §4.4.2 raw. One pass over its output replaces
 * every such code point with the `\uXXXX` escape `JSON.stringify` itself uses, lowercase
 * hexadecimal and a surrogate pair above U+FFFF, so the result still parses back to the argument
 * (§3.5, S-6).
 *
 * Printable ASCII is untouched, which is why no misuse message changed when this moved here from
 * `src/cli.ts`: for every printable ASCII argument the bytes are exactly `JSON.stringify`'s.
 */
export function quoteArg(arg: string): string {
  let quoted = '';
  for (const character of JSON.stringify(arg)) {
    const codePoint = character.codePointAt(0);
    quoted +=
      codePoint !== undefined && isEscapedCodePoint(codePoint)
        ? jsonEscapedText(codePoint)
        : character;
  }
  return quoted;
}

/** `\uXXXX` lowercase; a code point above U+FFFF becomes its surrogate pair (JSON's own style). */
function jsonEscapedText(codePoint: number): string {
  if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;

  const offset = codePoint - 0x1_0000;
  const high = 0xd800 + (offset >> 10);
  const low = 0xdc00 + (offset & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
}

/**
 * How `tables` renders a name cell, as the pieces of that cell (§4.4.1, §4.10).
 *
 * `null` is `-`, `''` is `""` and a bare `-` is `"-"`, so a missing value can never be read as the
 * name `-`. Everything else with an escape-set code point, whitespace, `"` or `\` is quoted and
 * escaped; anything else is written as it is, so a name never changes case, width form or
 * normalisation.
 *
 * A quoted name is emitted in slices of at most 16,384 code points (at most 163,840 code units, as
 * one escaped code point is at most ten), so the caller can chunk the stream without ever holding
 * the rendered name. A bare name is sliced the same way.
 */
export function* renderNamePieces(value: string | null): Generator<string, void, undefined> {
  if (value === null) {
    yield '-';
    return;
  }
  if (value === '') {
    yield '""';
    return;
  }
  if (value === '-') {
    yield '"-"';
    return;
  }
  if (!needsQuotes(value)) {
    yield* sliceCodePoints(value);
    return;
  }

  yield '"';
  let pieces = '';
  let codePoints = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      pieces += character;
    } else if (codePoint === QUOTE) {
      pieces += '\\"';
    } else if (codePoint === BACKSLASH) {
      pieces += '\\\\';
    } else if (isEscapedCodePoint(codePoint)) {
      pieces += escapedNameText(codePoint);
    } else {
      pieces += character;
    }
    codePoints += 1;
    if (codePoints >= NAME_SLICE_CODE_POINTS) {
      yield pieces;
      pieces = '';
      codePoints = 0;
    }
  }
  if (pieces !== '') yield pieces;
  yield '"';
}

/** `value` in slices of at most `NAME_SLICE_CODE_POINTS` code points, never splitting a pair. */
function* sliceCodePoints(value: string): Generator<string, void, undefined> {
  let slice = '';
  let codePoints = 0;
  for (const character of value) {
    slice += character;
    codePoints += 1;
    if (codePoints >= NAME_SLICE_CODE_POINTS) {
      yield slice;
      slice = '';
      codePoints = 0;
    }
  }
  if (slice !== '') yield slice;
}

/**
 * The display width of one rendered name cell, computed without building it (§4.10).
 *
 * The arithmetic the renderer uses, not a measurement of the rendered text: a bare name adds its
 * own width, a quoted one adds the two quotes plus `\"`/`\\\\` as two cells each and `\u{XXXX}` as
 * its 8-to-10-cell text. Keep this in step with `renderNamePieces`; the tests compare the two.
 */
export function renderedNameWidth(value: string | null): number {
  if (value === null) return 1;
  if (value === '') return 2;
  if (value === '-') return 3;
  if (!needsQuotes(value)) return nameWidth(value);

  let width = 2; // the two quotes
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      width += 1;
    } else if (codePoint === QUOTE || codePoint === BACKSLASH) {
      width += 2; // `\"` and `\\`
    } else if (isEscapedCodePoint(codePoint)) {
      width += escapedNameWidth(codePoint);
    } else {
      width += codePointWidth(codePoint);
    }
  }
  return width;
}

/** The display width of unquoted text, summed per code point (§4.11). */
function nameWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    width += codePointWidth(codePoint);
  }
  return width;
}
