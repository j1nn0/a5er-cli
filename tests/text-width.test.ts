/**
 * `src/text/width.ts` — the frozen display-width table (`docs/proposals/human-cli.md` §4.11, W-1).
 *
 * The ranges below are transcribed from §4.11, not from the module: this file must fail if the
 * implementation's table drifts from the specification, which a test that imported the module's own
 * range list could not detect. Each range is checked at its start, its middle and its end, and one
 * code point just outside each end is checked against the width §4.11 gives it — which is not
 * always 1, because the wide ranges are adjacent (U+3040 is 1 but U+3400 starts the next wide
 * block, and U+FE10 follows the zero-width variation selectors).
 *
 * No clock, no locale, no data file: the widths are a frozen table so that Node 24 and 26 print the
 * same padding (§7.6).
 */

import { describe, expect, it } from 'vitest';
import { codePointWidth, displayWidth } from '../src/text/width.js';

/** §4.11's width-0 ranges, with the width just below and just above each one. */
const ZERO_RANGES: readonly (readonly [number, number, number, number])[] = [
  // [start, end, width below start, width above end]
  [0x0300, 0x036f, 1, 1], // combining diacritical marks
  [0x1ab0, 0x1aff, 1, 1], // combining diacritical marks extended
  [0x1dc0, 0x1dff, 1, 1], // combining diacritical marks supplement
  [0x20d0, 0x20ff, 1, 1], // combining diacritical marks for symbols
  [0x3099, 0x309a, 2, 2], // combining voiced sound marks, inside the wide kana block
  [0xfe00, 0xfe0f, 1, 2], // variation selectors, then the wide vertical forms
  [0xfe20, 0xfe2f, 1, 2], // combining half marks, then the wide CJK compatibility forms
  [0xe0100, 0xe01ef, 1, 1], // variation selectors supplement
];

/** §4.11's width-2 ranges, with the width just below and just above each one. */
const DOUBLE_RANGES: readonly (readonly [number, number, number, number])[] = [
  [0x1100, 0x115f, 1, 1], // Hangul Jamo initial consonants
  [0x2e80, 0x303e, 1, 1], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff, 1, 2], // Hiragana through CJK compatibility, then extension A
  [0x3400, 0x4dbf, 2, 1], // CJK unified ideographs extension A
  [0x4e00, 0x9fff, 1, 2], // CJK unified ideographs, then Yi
  [0xa000, 0xa4cf, 2, 1], // Yi syllables and radicals, just above the ideographs
  [0xa960, 0xa97f, 1, 1], // Hangul Jamo extended-A
  [0xac00, 0xd7a3, 1, 1], // Hangul syllables
  [0xf900, 0xfaff, 1, 1], // CJK compatibility ideographs
  [0xfe10, 0xfe19, 0, 1], // vertical forms, just above the zero-width variation selectors
  [0xfe30, 0xfe6f, 0, 1], // CJK compatibility forms, just above the combining half marks
  [0xff00, 0xff60, 1, 1], // full-width forms; U+FF61 is half-width katakana
  [0xffe0, 0xffe6, 1, 1], // full-width signs
  [0x1f300, 0x1f64f, 1, 1], // pictographs and emoticons
  [0x1f900, 0x1f9ff, 1, 1], // supplemental symbols and pictographs
  [0x20000, 0x2fffd, 1, 1], // CJK extension B and beyond
  [0x30000, 0x3fffd, 1, 1], // CJK extension G and beyond
];

describe('text/width — the frozen table of §4.11', () => {
  it('measures every zero-width range at its start, middle and end', () => {
    for (const [start, end] of ZERO_RANGES) {
      expect(codePointWidth(start)).toBe(0);
      expect(codePointWidth(end)).toBe(0);
      expect(codePointWidth(Math.trunc((start + end) / 2))).toBe(0);
    }
  });

  it('measures every double-width range at its start, middle and end', () => {
    for (const [start, end] of DOUBLE_RANGES) {
      expect(codePointWidth(start)).toBe(2);
      expect(codePointWidth(end)).toBe(2);
      expect(codePointWidth(Math.trunc((start + end) / 2))).toBe(2);
    }
  });

  it('measures the code points just outside each range as §4.11 says', () => {
    for (const [start, , below] of ZERO_RANGES) {
      expect(codePointWidth(start - 1)).toBe(below);
    }
    for (const [, end, , above] of ZERO_RANGES) {
      expect(codePointWidth(end + 1)).toBe(above);
    }
    for (const [start, , below] of DOUBLE_RANGES) {
      expect(codePointWidth(start - 1)).toBe(below);
    }
    for (const [, end, , above] of DOUBLE_RANGES) {
      expect(codePointWidth(end + 1)).toBe(above);
    }
  });

  it('takes the width-0 table first, so U+3099–U+309A stays 0 inside the wide kana block', () => {
    expect(codePointWidth(0x3041)).toBe(2); // wide, just below the combining marks
    expect(codePointWidth(0x3099)).toBe(0);
    expect(codePointWidth(0x309a)).toBe(0);
    expect(codePointWidth(0x309b)).toBe(2); // wide again, just above them
  });

  it('keeps half-width katakana at 1 and full-width forms at 2', () => {
    expect(codePointWidth(0xff61)).toBe(1); // half-width ideographic full stop
    expect(codePointWidth(0xff9f)).toBe(1); // half-width semi-voiced sound mark
    expect(codePointWidth(0xff00)).toBe(2);
    expect(codePointWidth(0xff60)).toBe(2);
  });

  it('counts U+3000 as 2 and U+1F600 as 2', () => {
    expect(codePointWidth(0x3000)).toBe(2);
    expect(codePointWidth(0x1f600)).toBe(2);
  });

  it('counts East Asian Ambiguous characters as 1, as §4.11 states', () => {
    expect(codePointWidth(0x25cb)).toBe(1); // ○
    expect(codePointWidth(0x2460)).toBe(1); // ①
  });
});

describe('text/width — displayWidth', () => {
  it('sums the code points of a mixed string', () => {
    // 'ASCII'(5×1) + '顧客'(2×2) + 'e' + U+0301 (0) + emoji (2)
    expect(displayWidth('ASCII顧客e\u0301\u{1f600}')).toBe(5 + 4 + 1 + 0 + 2);
  });

  it('measures the empty string as 0 and an ASCII string by its length', () => {
    expect(displayWidth('')).toBe(0);
    expect(displayWidth('unknown')).toBe(7);
  });

  it('iterates by code point, so an astral character is one cell pair', () => {
    expect(displayWidth('\u{1f300}')).toBe(2);
    expect('\u{1f300}'.length).toBe(2); // two code units, one code point
  });

  it('counts a lone surrogate as one cell', () => {
    expect(displayWidth('\ud800')).toBe(1);
    expect(displayWidth('\udc00')).toBe(1);
  });
});
