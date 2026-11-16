/**
 * `syntax/complex.ts` — the Complex value splitter (`architecture.md` §7.1, F3, P5).
 *
 * Level L1 in `docs/test-strategy.md` §2 exists for exactly this: the highest-risk component is
 * tested exhaustively in process, without building a file for every escape combination. The
 * fixtures supply the shapes the specification actually writes; the inline cases cover the
 * combinations a committed file does not need to repeat.
 *
 * Every assertion here is a **tokenisation** fact — element text, quoting, whether an escape is
 * present. No assertion expects an escape to be applied: that is 3B's job, and keeping the two
 * apart is what stops `\Q` from becoming a quote at the wrong time.
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { splitComplex } from '../src/syntax/complex.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { SyntaxScan } from '../src/syntax/scanner.js';
import type { Span } from '../src/model/span.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

function scanFixture(id: string): SyntaxScan {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not a registered fixture`);
  const staged = stage(id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    return scanSource(outcome.source);
  } finally {
    staged.cleanup();
  }
}

/** The value of the `key` occurrence at `line`, verbatim. */
function valueAt(scan: SyntaxScan, line: number): string {
  const key = scan.sections
    .flatMap((section) => section.entries)
    .find((entry) => entry.kind === 'key' && entry.span.keyLine === line);
  if (key === undefined || key.kind !== 'key') throw new Error(`no key at line ${String(line)}`);
  return key.value;
}

/** The span of the key at `line`; what a caller passes to `splitComplex` for the diagnostic. */
function spanAt(scan: SyntaxScan, line: number): Span {
  const key = scan.sections
    .flatMap((section) => section.entries)
    .find((entry) => entry.kind === 'key' && entry.span.keyLine === line);
  if (key === undefined) throw new Error(`no key at line ${String(line)}`);
  return key.span;
}

const span: Span = { sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 };

describe('commas separate only outside quotes (§7.1, F3)', () => {
  it('keeps a quoted column list as one element (val-02 IndexInfo)', () => {
    const scan = scanFixture('val-02');
    const parts = splitComplex(valueAt(scan, 7));

    expect(parts.parts.map((part) => part.value)).toEqual([
      'users_ix1',
      '1',
      'user_name,birthday',
      '',
    ]);
    expect(parts.parts[2]).toEqual({ value: 'user_name,birthday', quoted: true, hadEscape: false });
    expect(parts.diagnostics).toEqual([]);
  });

  it('keeps a quoted composite foreign key as one element (txt-03)', () => {
    const scan = scanFixture('txt-03');

    expect(splitComplex(valueAt(scan, 21)).parts).toEqual([
      { value: 'a,b', quoted: true, hadEscape: false },
    ]);
    expect(splitComplex(valueAt(scan, 22)).parts).toEqual([
      { value: 'x,y', quoted: true, hadEscape: false },
    ]);
  });

  it('still splits unquoted commas', () => {
    expect(splitComplex('a,b,c').parts.map((part) => part.value)).toEqual(['a', 'b', 'c']);
    expect(splitComplex('a,b,c').parts.every((part) => !part.quoted)).toBe(true);
  });

  it('is not CSV: doubled quotes are not an escape and are never collapsed', () => {
    // The format writes a quote inside a value as `\Q`, so `""` inside an element is not a
    // doubling rule. The element is kept verbatim rather than silently rewritten.
    const parts = splitComplex('"a""b"');

    expect(parts.parts).toHaveLength(1);
    expect(parts.parts[0]).toEqual({ value: '"a""b"', quoted: false, hadEscape: false });

    expect(splitComplex('"a",""').parts).toEqual([
      { value: 'a', quoted: true, hadEscape: false },
      { value: '', quoted: true, hadEscape: false },
    ]);
  });
});

describe('padding is outside-quote only (§7.1)', () => {
  it('strips the space before a quoted-empty element, not inside it', () => {
    // The official sample ends `…,"user_name", ""`: the space is padding, the value is empty.
    const parts = splitComplex('"users_ix1",1,"id,email", ""');

    expect(parts.parts[3]).toEqual({ value: '', quoted: true, hadEscape: false });
  });

  it('strips padding around an unquoted element', () => {
    expect(splitComplex(' "a" ,\t2\t').parts).toEqual([
      { value: 'a', quoted: true, hadEscape: false },
      { value: '2', quoted: false, hadEscape: false },
    ]);
  });

  it('never trims inside quotes', () => {
    expect(splitComplex('"  a  "').parts).toEqual([
      { value: '  a  ', quoted: true, hadEscape: false },
    ]);
  });
});

describe('elements may be empty or quoted-empty (§7.1)', () => {
  it('keeps an empty slot exactly where it was', () => {
    const parts = splitComplex('"ユーザーID","id",0,,,""');

    expect(parts.parts.map((part) => part.value)).toEqual(['ユーザーID', 'id', '0', '', '', '']);
    expect(parts.parts.map((part) => part.quoted)).toEqual([true, true, false, false, false, true]);
  });

  it('splits an empty value into one empty element', () => {
    expect(splitComplex('').parts).toEqual([{ value: '', quoted: false, hadEscape: false }]);
    expect(splitComplex('').trailingElementsOmitted).toBe(false);
  });

  it('flags a value whose last slot was left blank instead of written out', () => {
    // A bare trailing `,` declares nothing; `""` does declare an empty element (§7.2 arity).
    const omitted = splitComplex('"a",1,');
    expect(omitted.parts).toHaveLength(3);
    expect(omitted.trailingElementsOmitted).toBe(true);

    expect(splitComplex('"a",1,""').trailingElementsOmitted).toBe(false);
    expect(splitComplex('"a",1').trailingElementsOmitted).toBe(false);
  });
});

describe('escapes are recorded, never applied (§7.1, P5)', () => {
  it('keeps every sequence of the escape table verbatim (val-01)', () => {
    const scan = scanFixture('val-01');
    const parts = splitComplex(valueAt(scan, 5));

    expect(parts.parts).toEqual([
      { value: '引用\\Qと\\\\と\\qと\\tと\\nです', quoted: true, hadEscape: true },
    ]);
  });

  it('keeps an escaped comment inside a Field element (val-01)', () => {
    const scan = scanFixture('val-01');
    const parts = splitComplex(valueAt(scan, 6));

    expect(parts.parts).toHaveLength(9);
    expect(parts.parts[6]).toEqual({ value: 'コメント\\Q付き', quoted: true, hadEscape: true });
    // The elements around it are untouched, so a quote escape cannot swallow a separator.
    expect(parts.parts[7]).toEqual({ value: '$FFFFFFFF', quoted: false, hadEscape: false });
  });

  it('passes an unknown escape through as itself', () => {
    expect(splitComplex('"a\\zb"').parts[0]).toEqual({
      value: 'a\\zb',
      quoted: true,
      hadEscape: true,
    });
  });

  it('treats \\\\ as data, so the quote after it still closes the element', () => {
    const parts = splitComplex('"a\\\\",b');

    expect(parts.parts).toEqual([
      { value: 'a\\\\', quoted: true, hadEscape: true },
      { value: 'b', quoted: false, hadEscape: false },
    ]);
  });

  it('reports hadEscape from a backslash anywhere in the element', () => {
    expect(splitComplex('a\\Qb').parts[0]).toEqual({
      value: 'a\\Qb',
      quoted: false,
      hadEscape: true,
    });
    expect(splitComplex('plain').parts[0]?.hadEscape).toBe(false);
  });
});

describe('an unterminated quote keeps the raw remainder (val-11, §7.1)', () => {
  it('yields the nine elements the catalog counts, with the remainder as the last one', () => {
    const scan = scanFixture('val-11');
    const parts = splitComplex(valueAt(scan, 8), spanAt(scan, 8));

    expect(parts.parts).toHaveLength(9);
    expect(parts.parts[8]).toEqual({
      // The unclosed opening quote is part of the element: nothing was removed to make it tidy.
      value: '"オプション未終端',
      quoted: false,
      hadEscape: false,
    });
    expect(parts.trailingElementsOmitted).toBe(false);
  });

  it('reports one warning on the entry the value belongs to', () => {
    const scan = scanFixture('val-11');
    const parts = splitComplex(valueAt(scan, 8), spanAt(scan, 8));

    assertCodes(
      parts.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_COMPLEX_UNTERMINATED_QUOTE'],
    );
    const [warning] = parts.diagnostics;
    expect(warning?.severity).toBe('warning');
    expect(warning?.span).toEqual({ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 });
    expect(warning?.construct).toBe('Complex');
    // The code the catalog expects for this fixture, and nothing else from the line scan.
    expect(scan.diagnostics).toEqual([]);
  });

  it('invents no position when the caller has no span', () => {
    const parts = splitComplex('"a', span);

    expect(parts.diagnostics[0]?.span).toEqual(span);
    expect(splitComplex('"a').diagnostics[0]?.span).toBeNull();
  });

  it('keeps a comma inside an unterminated quote in the same element', () => {
    const parts = splitComplex('1,"a,b');

    expect(parts.parts.map((part) => part.value)).toEqual(['1', '"a,b']);
    assertCodes(
      parts.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_COMPLEX_UNTERMINATED_QUOTE'],
    );
  });
});

describe('the shapes the fixtures write', () => {
  it('gives ten elements for a ten-element Field (fmt-01)', () => {
    const scan = scanFixture('fmt-01');
    const parts = splitComplex(valueAt(scan, 11));

    expect(parts.parts).toHaveLength(10);
    expect(parts.parts.map((part) => part.value)).toEqual([
      'ユーザーID',
      'id',
      'Serial',
      'NOT NULL',
      '0',
      '',
      '主キー',
      '$FFFFFFFF',
      '',
      '',
    ]);
    expect(parts.parts[8]).toEqual({ value: '', quoted: true, hadEscape: false });
  });

  it('gives three elements for a three-element Position (fmt-01)', () => {
    const scan = scanFixture('fmt-01');
    const parts = splitComplex(valueAt(scan, 14));

    expect(parts.parts.map((part) => part.value)).toEqual(['Main', '1000', '2000']);
  });

  it('gives eight elements for a relation Position, the last quoted-empty (txt-03)', () => {
    const parts = splitComplex(valueAt(scanFixture('txt-03'), 27));

    expect(parts.parts).toHaveLength(8);
    expect(parts.parts[7]).toEqual({ value: '', quoted: true, hadEscape: false });
    expect(parts.trailingElementsOmitted).toBe(false);
  });

  it('reports nothing for any value in the fixtures the catalog expects to be silent', () => {
    for (const id of ['fmt-01', 'txt-01', 'txt-03', 'val-01', 'val-02', 'val-10']) {
      const scan = scanFixture(id);
      const codes = scan.sections
        .flatMap((section) => section.entries)
        .filter((entry) => entry.kind === 'key')
        .flatMap((entry) =>
          splitComplex(entry.kind === 'key' ? entry.value : '').diagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
        );
      expect(codes, id).toEqual([]);
    }
  });
});
