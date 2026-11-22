/**
 * `text/width.ts` — display width per code point (`docs/proposals/human-cli.md` §4.11).
 *
 * **Why a hand-written table.** The table is frozen data, not a measure of the runtime: `\p{…}`
 * property escapes and `Intl` follow the Unicode version and the ICU build, and Node 24 and 26 can
 * differ (`v24.22.3` reports Unicode `17.0`, ICU `78.3`). With this table the padding is the same
 * bytes on every supported runtime, which is what `tables` promises (§3.3).
 *
 * **What a wrong width can cost.** Padding only. The content of a row never depends on it, and
 * because the counts come before the names (§4.3), a width the terminal measures differently can
 * only shift the start of `LNAME` — it can never move a count or a name.
 *
 * **Known limits, stated rather than hidden** (§4.11): East Asian Ambiguous characters (`○`, `①`)
 * count as 1, while a CJK-configured terminal may draw them 2 wide; grapheme clusters are not
 * segmented (a ZWJ is escaped before it can reach here, §4.4.2); a script outside the table is
 * measured as 1.
 *
 * No import, no clock, no locale, no data file.
 */

/** A code point this module can measure: always `0`, `1` or `2` display cells. */
export type DisplayWidth = 0 | 1 | 2;

/**
 * Zero-width code points: combining marks and variation selectors.
 *
 * Checked **before** the wide table, so U+3099–U+309A stays 0 inside the wide kana block (§4.11).
 */
const ZERO_WIDTH: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // combining diacritical marks
  [0x1ab0, 0x1aff], // combining diacritical marks extended
  [0x1dc0, 0x1dff], // combining diacritical marks supplement
  [0x20d0, 0x20ff], // combining diacritical marks for symbols
  [0x3099, 0x309a], // combining (voiced sound) marks
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // combining half marks
  [0xe0100, 0xe01ef], // variation selectors supplement
];

/** Two-cell code points: CJK, Hangul, full-width forms and the emoji blocks of §4.11. */
const DOUBLE_WIDTH: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compatibility Jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi syllables and radicals
  [0xa960, 0xa97f], // Hangul Jamo extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // full-width forms
  [0xffe0, 0xffe6], // full-width signs
  [0x1f300, 0x1f64f], // pictographs and emoticons
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
  [0x20000, 0x2fffd], // CJK unified ideographs extension B and beyond
  [0x30000, 0x3fffd], // CJK unified ideographs extension G and beyond
];

/** True when `codePoint` lies inside one of `ranges`. */
function inRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const range of ranges) {
    if (codePoint >= range[0] && codePoint <= range[1]) return true;
  }
  return false;
}

/** The display width of one code point: the width-0 table first, then the wide table (§4.11). */
export function codePointWidth(codePoint: number): DisplayWidth {
  if (inRanges(codePoint, ZERO_WIDTH)) return 0;
  if (inRanges(codePoint, DOUBLE_WIDTH)) return 2;
  return 1;
}

/**
 * The display width of `text`, summed code point by code point.
 *
 * The caller passes **escaped** text: `tables` measures the rendered name, so an escaped control
 * is measured as the `\u{XXXX}` text it became, not as the code point it was (§4.10).
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    width += codePointWidth(codePoint);
  }
  return width;
}
