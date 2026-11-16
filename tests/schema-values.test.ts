/**
 * `schema/values.ts` — the five basic types (`architecture.md` §4.2, §5, §7.1; P5, K4, K8).
 *
 * Two things are asserted here and nothing else:
 *
 * 1. **The escape table is applied exactly once, in one pass.** `\Q` becomes a quote, `\\Q` does
 *    not, and an unknown escape survives as two characters. Getting this wrong corrupts every
 *    comment that contains a quote, which is why P5 is byte-verified.
 * 2. **Nothing is coerced.** A token that is not a `1`/`0` boolean or a strict decimal integer comes
 *    back as an invalid *record* carrying the reason, the raw text and the span — never as `false`,
 *    `0` or a null that reads like data.
 *
 * Fixtures supply the values the specification actually writes (val-01's five escapes, val-02's
 * quoted comma, val-10's `=` inside a value); inline strings cover the combinations a file does not
 * need to repeat.
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import {
  decodeBoolean,
  decodeInteger,
  decodeValue,
  defaultValue,
  unescapeEscaped,
  unquote,
} from '../src/schema/values.js';
import { classify } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { SyntaxScan } from '../src/syntax/scanner.js';
import type { Span } from '../src/model/span.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

const SPAN: Span = { sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 };

function scanFixture(id: string): SyntaxScan {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  const staged = stage(id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    return scanSource(outcome.source);
  } finally {
    staged.cleanup();
  }
}

/** The value of the one key named `key`, as classified (not as scanned). */
function decodedValue(id: string, key: string): unknown {
  const classification = classify(scanFixture(id));
  const group = classification.keys.find((candidate) => candidate.spec.key === key);
  const occurrence = group?.occurrences[0];
  if (occurrence === undefined) throw new Error(`${id} has no ${key}`);
  if (!occurrence.decoded.ok) throw new Error(`${id} ${key} did not decode`);
  return occurrence.decoded.value;
}

describe('String — quoted, and never unescaped (§7.1, P5)', () => {
  it('removes one surrounding quote pair and nothing else', () => {
    expect(unquote('"users"')).toBe('users');
    expect(unquote('""')).toBe('');
    expect(unquote('users')).toBe('users');
    expect(unquote('"users')).toBe('"users');
    expect(unquote('"')).toBe('"');
    expect(unquote('"a\\Qb"')).toBe('a\\Qb');
  });

  it('decodes a fixture value with its raw text still adjacent (§4.2)', () => {
    expect(decodedValue('fmt-01', 'PName')).toEqual({
      value: 'users',
      origin: 'declared',
      raw: '"users"',
      span: { sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 },
    });
  });

  it('leaves a value containing `=` intact (val-10)', () => {
    const value = decodedValue('val-10', 'TableInnerOption');
    expect(value).toMatchObject({
      value: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      raw: '"ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"',
    });
  });

  it('keeps a broken String value verbatim and does not repair it (val-08)', () => {
    // `Query` is typed `String`; the line break is scan-level evidence, not a value to fix up.
    expect(decodedValue('val-08', 'Query')).toMatchObject({
      value: '"SELECT id',
      origin: 'declared',
    });
  });
});

describe('EscapedString — the §7.1 escape table, applied once', () => {
  it('maps all five sequences', () => {
    expect(unescapeEscaped('\\Q')).toBe('"');
    expect(unescapeEscaped('\\q')).toBe("'");
    expect(unescapeEscaped('\\\\')).toBe('\\');
    expect(unescapeEscaped('\\t')).toBe('\t');
    expect(unescapeEscaped('\\n')).toBe('\n');
  });

  it('applies each sequence exactly once, left to right', () => {
    // `\\Q` is a backslash then a Q: it must survive as `\Q`, not become a quote.
    expect(unescapeEscaped('\\\\Q')).toBe('\\Q');
    expect(unescapeEscaped('a\\\\Qb')).toBe('a\\Qb');
  });

  it('keeps an unknown escape as both characters', () => {
    expect(unescapeEscaped('a\\zb')).toBe('a\\zb');
    expect(unescapeEscaped('\\"')).toBe('\\"');
    expect(unescapeEscaped('trailing\\')).toBe('trailing\\');
  });

  it('decodes the fixture that carries all five (val-01)', () => {
    // The file writes 引用\Qと\\と\qと\tと\nです inside quotes; the value is the same text decoded.
    expect(decodedValue('val-01', 'Comment')).toEqual({
      value: '引用"と\\と\'と\tと\nです',
      origin: 'declared',
      raw: '"引用\\Qと\\\\と\\qと\\tと\\nです"',
      span: { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 },
    });
  });

  it('does not unescape a String key that looks escaped', () => {
    // The type, not the spelling, decides: `Query` is `String`, so a `\Q` in it stays two chars.
    expect(decodedValue('fmt-01', 'Query')).toMatchObject({
      value: 'SELECT * FROM users WHERE active = 1',
    });
  });
});

describe('Boolean — 1/0 only, never a truthy guess (K8)', () => {
  it('decodes the two defined tokens', () => {
    expect(decodeBoolean('1')).toBe(true);
    expect(decodeBoolean('0')).toBe(false);
  });

  it('rejects everything else', () => {
    for (const raw of ['2', 'true', 'false', '', ' 1', '01', '-1']) {
      expect(decodeBoolean(raw), raw).toBeNull();
    }
  });

  it('decodes a real flag (sem-06)', () => {
    expect(decodedValue('sem-06', 'LNameByComment')).toMatchObject({
      value: true,
      origin: 'declared',
      raw: '1',
    });
  });

  it('reports an invalid token with its reason, raw text and span', () => {
    const outcome = decodeValue('boolean', '2', SPAN);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected an invalid value');
    expect(outcome.invalid).toEqual({ reason: 'not-a-boolean', raw: '2', span: SPAN });
  });
});

describe('Integer — strict decimal, safe range (P8, K8)', () => {
  it('accepts decimal integers', () => {
    expect(decodeInteger('0')).toEqual({ ok: true, value: 0 });
    expect(decodeInteger('2')).toEqual({ ok: true, value: 2 });
    expect(decodeInteger('-7')).toEqual({ ok: true, value: -7 });
    expect(decodeInteger('9007199254740991')).toEqual({ ok: true, value: 9007199254740991 });
  });

  it('rejects floats, hex, exponents, padding and leading zeros', () => {
    for (const raw of ['1.0', '1e3', '0x10', ' 1', '1 ', '007', '', '+1', '0.5']) {
      expect(decodeInteger(raw), raw).toEqual({ ok: false, reason: 'not-an-integer' });
    }
  });

  it('separates "not an integer" from "out of range"', () => {
    expect(decodeInteger('9007199254740992')).toEqual({
      ok: false,
      reason: 'integer-out-of-range',
    });
  });

  it('decodes a fixture ordinal (fmt-01)', () => {
    expect(decodedValue('fmt-01', 'RelationType1')).toMatchObject({ value: 2, raw: '2' });
  });

  it('reports an invalid token instead of coercing it', () => {
    const outcome = decodeValue('integer', '2.5', SPAN);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected an invalid value');
    expect(outcome.invalid.reason).toBe('not-an-integer');
    expect(outcome.invalid.raw).toBe('2.5');
  });
});

describe('Complex — tokenised here, positionally decoded elsewhere (§7.1 vs §7.2)', () => {
  it('splits a quoted column list into one element (val-02)', () => {
    expect(decodedValue('val-02', 'IndexInfo')).toEqual({
      value: {
        parts: [
          { value: 'users_ix1', quoted: true, hadEscape: false },
          { value: '1', quoted: false, hadEscape: false },
          { value: 'user_name,birthday', quoted: true, hadEscape: false },
          { value: '', quoted: true, hadEscape: false },
        ],
        trailingElementsOmitted: false,
      },
      origin: 'declared',
      raw: '"users_ix1",1,"user_name,birthday", ""',
      span: { sectionIndex: 1, startLine: 7, endLine: 7, keyLine: 7 },
    });
  });

  it('carries the unterminated-quote diagnostic at the key span (val-11)', () => {
    const classification = classify(scanFixture('val-11'));
    const group = classification.keys.find((candidate) => candidate.spec.key === 'Field');
    const occurrence = group?.occurrences[0];
    if (occurrence === undefined) throw new Error('val-11 has no Field');

    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_COMPLEX_UNTERMINATED_QUOTE'],
    );
    expect(classification.diagnostics[0]?.span).toEqual(occurrence.span);
    if (!occurrence.decoded.ok) throw new Error('a tokenised value is still a value');
    const parts = occurrence.decoded.value.value;
    if (typeof parts !== 'object' || !('parts' in parts)) throw new Error('expected ComplexValue');
    expect(parts.parts).toHaveLength(9);
    expect(parts.parts[8]).toEqual({
      value: '"オプション未終端',
      quoted: false,
      hadEscape: false,
    });
  });

  it('never applies escapes while tokenising (val-01 Field)', () => {
    const classification = classify(scanFixture('val-01'));
    const group = classification.keys.find((candidate) => candidate.spec.key === 'Field');
    const occurrence = group?.occurrences[0];
    if (occurrence === undefined || !occurrence.decoded.ok) throw new Error('no Field value');
    const parts = occurrence.decoded.value.value;
    if (typeof parts !== 'object' || !('parts' in parts)) throw new Error('expected ComplexValue');
    expect(parts.parts[6]).toEqual({ value: 'コメント\\Q付き', quoted: true, hadEscape: true });
  });
});

describe('defaulted values (§4.2)', () => {
  it('carry no raw text and no span, because the file did not say them', () => {
    expect(defaultValue(1)).toEqual({ value: 1, origin: 'defaulted', raw: '', span: null });
  });
});
