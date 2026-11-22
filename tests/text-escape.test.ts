/**
 * `src/text/escape.ts` — the frozen escape set, the name rules and the round trip
 * (`docs/proposals/human-cli.md` §4.4, §7.4 S-1 to S-3).
 *
 * The ranges below are transcribed from §4.4.2, not imported from the module: this file has to
 * fail when the implementation drifts from the specification. Three properties are pinned:
 *
 * 1. **Every escape-set code point is escaped** and every neighbour is not (`S-1`), including U+0000,
 *    LF, CR, ESC, DEL, the C1 controls, the bidi controls, the noncharacters, U+10FFFF, the tag
 *    characters and lone surrogates;
 * 2. **No escape-set code point survives, and the value round-trips**, for all 1,114,112 code points
 *    (`S-2`) — CR and LF cannot reach a name through the current scanner, so their escaping and
 *    round trip are proven here rather than through a document;
 * 3. **The absent/quoted/bare mapping is unambiguous** (`S-3`): `null` renders as `-` and a name
 *    that is exactly `-` renders as `"-"`, so the two can never be confused.
 *
 * The sweeps collect their failures and assert once at the end: an `expect` per code point would
 * spend the whole test budget on matcher overhead. No real `.a5er` file is involved, and nothing
 * here is generated from the renderer's output.
 */

import { describe, expect, it } from 'vitest';
import { isEscapedCodePoint, renderNamePieces, renderedNameWidth } from '../src/text/escape.js';
import { decodeRendered, renderName } from './helpers/tables-text-expectations.js';
import { displayWidth } from '../src/text/width.js';

/** §4.4.2's escape set as inclusive ranges. */
const ESCAPE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f], // C0 controls, including NUL, BEL, BS, TAB, LF, CR and ESC
  [0x007f, 0x009f], // DEL and C1 controls, including U+009B CSI and U+0085 NEL
  [0x00ad, 0x00ad], // soft hyphen
  [0x061c, 0x061c], // Arabic letter mark
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x2028, 0x202e], // line/paragraph separator, bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, isolates, deprecated format controls
  [0xd800, 0xdfff], // lone surrogates
  [0xfdd0, 0xfdef], // noncharacters
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xfff9, 0xfffb], // interlinear annotation controls
  [0xe0000, 0xe007f], // tag characters
];

/** U+xFFFE and U+xFFFF for every plane x, as §4.4.2 lists them. */
function noncharacters(): number[] {
  const codePoints: number[] = [];
  for (let plane = 0; plane <= 0x10; plane += 1) {
    codePoints.push(plane * 0x1_0000 + 0xfffe, plane * 0x1_0000 + 0xffff);
  }
  return codePoints;
}

/** True when `rendered` carries the `\u{…}` form at all. */
function hasEscapeForm(rendered: string): boolean {
  return rendered.includes('\\u{');
}

/**
 * §4.4.2 as a predicate: the listed ranges, plus U+xFFFE/U+xFFFF in every plane.
 *
 * Used for the neighbours of a range: a neighbour is usually unescaped, but the noncharacter rule
 * covers U+xFFFE and U+xFFFF in *every* plane, so U+DFFFF (just below the tag block) is escaped
 * and U+E0080 is not.
 */
function specEscaped(codePoint: number): boolean {
  for (const [start, end] of ESCAPE_RANGES) {
    if (codePoint >= start && codePoint <= end) return true;
  }
  return (codePoint & 0xfffe) === 0xfffe;
}

/** `\u{XXXX}` for `codePoint`: uppercase, at least four digits, no `U+` (§4.4.1). */
function expectedEscape(codePoint: number): string {
  return `\\u{${codePoint.toString(16).toUpperCase().padStart(4, '0')}}`;
}

/** One code point as a string, lone surrogates included. */
function oneCodePoint(codePoint: number): string {
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return String.fromCharCode(codePoint);
  return String.fromCodePoint(codePoint);
}

describe('text/escape — every escape-set code point is escaped (S-1)', () => {
  it('escapes every code point of every range, and decodes it back', () => {
    const failures: string[] = [];

    for (const [start, end] of ESCAPE_RANGES) {
      for (let codePoint = start; codePoint <= end; codePoint += 1) {
        const value = oneCodePoint(codePoint);
        const rendered = renderName(value);
        const expected = `"${expectedEscape(codePoint)}"`;

        if (rendered !== expected) {
          failures.push(`U+${codePoint.toString(16)}: ${JSON.stringify(rendered)}`);
        } else if (decodeRendered(rendered) !== value) {
          failures.push(`U+${codePoint.toString(16)}: no round trip`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('escapes U+xFFFE and U+xFFFF in every plane', () => {
    for (const codePoint of noncharacters()) {
      const value = oneCodePoint(codePoint);
      expect(renderName(value)).toBe(`"${expectedEscape(codePoint)}"`);
      expect(decodeRendered(renderName(value))).toBe(value);
    }
  });

  it('escapes U+E0001 and U+E0041 as their own escapes, never as a raw pair', () => {
    expect(renderName('\u{e0001}')).toBe('"\\u{E0001}"');
    expect(renderName('\u{e0041}')).toBe('"\\u{E0041}"');
  });

  it('names the code points S-1 lists explicitly', () => {
    const inside: readonly number[] = [
      0x0000, 0x000a, 0x000d, 0x001b, 0x007f, 0x0085, 0x009b, 0x009f, 0x202e, 0x2066, 0x2067,
      0x2068, 0x2069, 0xfeff, 0xfffe, 0x10ffff, 0xe0001, 0xd800, 0xdc00,
    ];
    for (const codePoint of inside) {
      expect(isEscapedCodePoint(codePoint)).toBe(true);
      expect(renderName(oneCodePoint(codePoint))).toBe(`"${expectedEscape(codePoint)}"`);
    }

    // U+00A0 is whitespace, not a control: quoted, and staying literal inside the quotes.
    expect(isEscapedCodePoint(0x00a0)).toBe(false);
    expect(renderName('\u00a0')).toBe('"\u00a0"');
  });

  it('escapes exactly the neighbours the specification escapes', () => {
    const failures: string[] = [];

    for (const [start, end] of ESCAPE_RANGES) {
      for (const outside of [start - 1, end + 1]) {
        if (outside < 0 || outside > 0x10ffff) continue;
        const value = oneCodePoint(outside);
        const rendered = renderName(value);
        const expected = specEscaped(outside);

        if (hasEscapeForm(rendered) !== expected) {
          failures.push(`U+${outside.toString(16)}: escaped=${!expected}`);
        } else if (decodeRendered(rendered) !== value) {
          failures.push(`U+${outside.toString(16)}: no round trip`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('text/escape — the whole code space round-trips (S-2)', () => {
  it('escapes nothing it should not, and decodes back, for all 1,114,112 code points', () => {
    const failures: string[] = [];

    for (let codePoint = 0; codePoint <= 0x10_ffff; codePoint += 1) {
      const value = oneCodePoint(codePoint);
      const rendered = renderName(value);

      let survived = false;
      for (const character of rendered) {
        const renderedCodePoint = character.codePointAt(0);
        if (renderedCodePoint !== undefined && isEscapedCodePoint(renderedCodePoint)) {
          survived = true;
          break;
        }
      }

      if (survived) failures.push(`U+${codePoint.toString(16)}: escaped code point survived`);
      else if (decodeRendered(rendered) !== value) {
        failures.push(`U+${codePoint.toString(16)}: no round trip`);
      }
      if (failures.length > 8) break;
    }

    expect(failures).toEqual([]);
  });

  it('escapes CR, LF and CRLF and decodes them back', () => {
    expect(renderName('\r')).toBe('"\\u{000D}"');
    expect(renderName('\n')).toBe('"\\u{000A}"');
    expect(renderName('\r\n')).toBe('"\\u{000D}\\u{000A}"');

    for (const value of ['a\rb', 'a\nb', 'a\r\nb']) {
      const rendered = renderName(value);
      expect(decodeRendered(rendered)).toBe(value);
      expect(rendered.startsWith('"') && rendered.endsWith('"')).toBe(true);
    }
  });
});

describe('text/escape — absent, quoted and bare names (S-3)', () => {
  it('maps the ambiguous values to the distinct renderings of §4.4.1', () => {
    expect(renderName(null)).toBe('-');
    expect(renderName('')).toBe('""');
    expect(renderName('-')).toBe('"-"');
    expect(renderName('a"b')).toBe('"a\\"b"');
    expect(renderName('a\\b')).toBe('"a\\\\b"');
    expect(renderName('a b')).toBe('"a b"');
    expect(renderName('顧客\u3000一覧')).toBe('"顧客\u3000一覧"');
  });

  it('decodes every one of those renderings back to its own value', () => {
    const values: readonly (string | null)[] = [
      null,
      '',
      '-',
      'a"b',
      'a\\b',
      'a b',
      '顧客\u3000一覧',
    ];
    for (const value of values) expect(decodeRendered(renderName(value))).toBe(value);

    // A missing value and the name `-` never decode to the same thing.
    expect(decodeRendered('-')).toBeNull();
    expect(decodeRendered('"-"')).toBe('-');
  });

  it('leaves a name without whitespace, quote, backslash or controls bare', () => {
    for (const value of ['users', 'audit_log', 'UTF8', 'f(g)', 'a,b', '0', '151', '名前', 'a-b']) {
      expect(renderName(value)).toBe(value);
      expect(decodeRendered(value)).toBe(value);
    }
  });

  it('keeps a backslash in a name as two characters and escapes it inside the quotes', () => {
    // `schema/values.ts` does not process escapes, so `\Q` in a PName is two characters.
    expect(renderName('\\Q')).toBe('"\\\\Q"');
    expect(decodeRendered(renderName('\\Q'))).toBe('\\Q');
  });

  it('does not normalise, fold case or trim', () => {
    expect(renderName('e\u0301')).toBe('e\u0301'); // NFC would be U+00E9
    expect(renderName('Users')).toBe('Users');
    expect(renderName(' pad ')).toBe('" pad "');
    expect(decodeRendered(renderName(' pad '))).toBe(' pad ');
  });
});

describe('text/escape — rendered width and rendered text agree', () => {
  it('computes the width of a rendered cell without building it', () => {
    const values: readonly (string | null)[] = [
      null,
      '',
      '-',
      'users',
      '顧客一覧',
      'a b',
      'a"b',
      'a\\b',
      'evil\u001b[2J\u202etxt.exe',
      '\u{1f600}\u{1f600}',
      'e\u0301',
      '\ud800',
    ];

    for (const value of values) {
      expect(renderedNameWidth(value)).toBe(displayWidth(renderName(value)));
    }
  });

  it('slices a name into pieces without splitting a surrogate pair', () => {
    const value = '\u{1f600}'.repeat(20_000);
    let pieces = 0;
    for (const piece of renderNamePieces(value)) {
      pieces += 1;
      const first = piece.charCodeAt(0);
      const last = piece.charCodeAt(piece.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(pieces).toBeGreaterThan(1);
    expect(decodeRendered(renderName(value))).toBe(value);
  });
});
