/**
 * `src/json/stream.ts` — the bounded JSON encoder (`docs/proposals/human-cli.md` §5.10, §8.4).
 *
 * Every case compares the concatenated chunks with `JSON.stringify(document, strictReplacer) + '\n'`
 * — the definition §5.10 gives — and checks the chunk bound. The expected bytes therefore come from
 * the language built-in, not from this encoder.
 *
 * The cases cover the four claims the encoder makes:
 *
 * 1. **Traversal** — `Object.keys` order (integer keys ascending, then insertion order), array index
 *    order, and the replacer called with `JSON.stringify`'s own holder and key.
 * 2. **Strings** — keys and values escaped exactly as `JSON.stringify` escapes them, in slices of at
 *    most 16,384 code units, with a cut that never separates a surrogate pair.
 * 3. **Rejections** — anything `JSON.stringify` would treat differently is a `TypeError`, so a
 *    document outside §5.10's scope can never produce plausible-looking bytes.
 * 4. **Chunks** — every chunk is under the 262,144-code-unit bound, the boundary never splits a
 *    pair, and the last one ends with the newline the command writes.
 *
 * The encoder's declared parameter is the product type; the generalized cases below cast once, in
 * `encode`, because §5.10 fixes the behaviour for any in-scope document, not only for a tables one.
 */

import { describe, expect, it } from 'vitest';
import type { JsonTablesEnvelope } from '../src/json/index.js';
import { encodeJson } from '../src/json/index.js';
import { strictReplacer } from '../src/json/serialize.js';
import { CHUNK_LIMIT_UNITS } from '../src/json/stream.js';

/** The chunk bound of §5.10, written out rather than taken from the module under test. */
const SPEC_CHUNK_LIMIT = 262_144;

/** Encode any in-scope document: the cast is the one place a generalized case leaves the product type. */
function encode(document: unknown): string[] {
  return [...encodeJson(document as JsonTablesEnvelope)];
}

/** Every chunk under the bound, no boundary inside a surrogate pair, newline-terminated (§5.10). */
function expectChunksBounded(chunks: readonly string[]): void {
  expect(chunks.length).toBeGreaterThan(0);

  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThan(SPEC_CHUNK_LIMIT);

    const last = chunk.charCodeAt(chunk.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff, `chunk ${index} ends inside a pair`).toBe(false);

    if (index > 0) {
      const first = chunk.charCodeAt(0);
      expect(first >= 0xdc00 && first <= 0xdfff, `chunk ${index} starts inside a pair`).toBe(false);
    }
  }

  expect(chunks.at(-1)?.endsWith('\n')).toBe(true);
}

/** The spec's equivalence, plus the chunk bound, for one document. */
function expectEquivalent(document: unknown): string {
  const chunks = encode(document);
  const text = chunks.join('');

  expect(text).toBe(`${JSON.stringify(document, strictReplacer)}\n`);
  expectChunksBounded(chunks);
  return text;
}

/** A one-member document around `value`, so a leaf case stays readable. */
function wrapped(value: unknown): unknown {
  return { value };
}

describe('json/stream — traversal order (§5.10)', () => {
  it('uses Object.keys order, integer keys ascending, then insertion order', () => {
    const document = { b: 1, 2: 2, 1: 3, '01': 4, '4294967295': 5, a: 6 };

    // Object.keys gives `1, 2, b, 01, 4294967295, a`: array-index keys ascend first, the rest keep
    // insertion order, and `01`/`4294967295` are ordinary keys.
    expect(Object.keys(document)).toEqual(['1', '2', 'b', '01', '4294967295', 'a']);
    expect(expectEquivalent(document)).toBe('{"1":3,"2":2,"b":1,"01":4,"4294967295":5,"a":6}\n');
  });

  it('uses index order for arrays and keeps nested arrays and objects nested', () => {
    expect(expectEquivalent({ a: [1, [2, 3], { b: [] }], c: {} })).toBe(
      '{"a":[1,[2,3],{"b":[]}],"c":{}}\n',
    );
  });

  it('names the holder key in the replacer error, as JSON.stringify would', () => {
    // `strictReplacer` builds its message from the key it was called with, so the three call shapes
    // of §5.10 are observable: `''` at the root, the property name, and the index as a string.
    const rootMessage = (() => {
      try {
        encode(undefined);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    const memberMessage = (() => {
      try {
        encode({ a: { b: undefined } });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    const indexMessage = (() => {
      try {
        const sparse: unknown[] = [1, 2];
        sparse.length = 4;
        sparse[3] = 4;
        encode({ a: sparse });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(rootMessage).toBe('cannot serialise undefined at key ""');
    expect(memberMessage).toBe('cannot serialise undefined at key "b"');
    expect(indexMessage).toBe('cannot serialise undefined at key "2"');
    // The same document with the hole filled encodes normally.
    expect(expectEquivalent({ a: [1, 2, 3, 4] })).toBe('{"a":[1,2,3,4]}\n');
  });
});

describe('json/stream — key escaping (§5.10)', () => {
  it('escapes quotes, backslashes, controls and lone surrogates in keys', () => {
    const document = {
      'a"b': 1,
      'c\\d': 2,
      'e\nf': 3,
      'g\u0001h': 4,
      'i\ud800j': 5,
      'k\udc00l': 6,
    };

    const text = expectEquivalent(document);

    expect(text).toContain('"a\\"b"');
    expect(text).toContain('"c\\\\d"');
    expect(text).toContain('"e\\nf"');
    expect(text).toContain('"g\\u0001h"');
    expect(text).toContain('"i\\ud800j"');
    expect(text).toContain('"k\\udc00l"');
  });

  it('slices a 40,001-code-unit key without changing its bytes', () => {
    // A generalized case: no product input produces such a key (§5.10). Only the output chunks are
    // bound-checked; the temporary string `strictReplacer` builds is expected to be that size.
    const key = 'k'.repeat(40_001);
    const document = { [key]: 1 };

    const text = expectEquivalent(document);

    expect(text).toBe(`{"${key}":1}\n`);
    // A value-only check would miss a key split; the escaped key round-trips through JSON.
    const parsed: unknown = JSON.parse(text.slice(0, -1));
    expect(Object.keys(parsed as object)).toEqual([key]);
  });
});

describe('json/stream — string slicing and surrogate pairs (§5.10, B-4)', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['a pair straddling code unit 16,384', `${'a'.repeat(16_383)}\u{1f600}b`],
    ['a lone high surrogate at code unit 16,383', `${'a'.repeat(16_383)}\ud800abc`],
    ['a lone high surrogate as the last code unit', `${'a'.repeat(20_000)}\ud800`],
    ['a lone low surrogate at code unit 16,384', `${'a'.repeat(16_384)}\udc00x`],
    ['a pair at code unit 65,535', `${'a'.repeat(65_535)}\u{1f600}z`],
    ['a run of astral characters', '\u{1f600}'.repeat(20_000)],
    ['the empty string', ''],
  ];

  for (const [label, value] of cases) {
    it(`round-trips ${label}`, () => {
      const text = expectEquivalent(wrapped(value));

      // No replacement character appears, and the decoded value is the original.
      expect(text).not.toContain('\ufffd');
      const parsed: unknown = JSON.parse(text.slice(0, -1));
      expect((parsed as { value: string }).value).toBe(value);
    });
  }

  it('produces the same UTF-8 bytes whether the chunks are encoded one by one or all at once', () => {
    const value = `${'a'.repeat(65_535)}\u{1f600}${'b'.repeat(20_000)}\ud800`;
    const chunks = encode(wrapped(value));

    const perChunk = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'utf8')));
    const whole = Buffer.from(chunks.join(''), 'utf8');

    expect(Buffer.compare(perChunk, whole)).toBe(0);
    expect(perChunk.toString('utf8')).not.toContain('\ufffd');
  });

  it('keeps a long string in several chunks, none of them over the bound', () => {
    const chunks = encode(wrapped('x'.repeat(200_000)));

    expect(chunks.length).toBeGreaterThan(1);
    expectChunksBounded(chunks);
  });
});

describe('json/stream — other values (§5.10)', () => {
  it('writes numbers, booleans and null as JSON.stringify does', () => {
    expect(expectEquivalent({ value: [0, -0, 1.5, 1e21, true, false, null] })).toBe(
      '{"value":[0,0,1.5,1e+21,true,false,null]}\n',
    );
  });

  it('keeps a null member distinguishable from an absent one', () => {
    expect(expectEquivalent({ a: null, b: {}, c: [] })).toBe('{"a":null,"b":{},"c":[]}\n');
  });
});

/** An array with one hole at index 1: `[1, <hole>]`, built without a sparse literal. */
function withHole(): unknown[] {
  const array: unknown[] = [1];
  array.length = 2;
  return array;
}

describe('json/stream — rejections (§5.10)', () => {
  /** Iterating is what runs the encoder, so the rejection is asserted through the iteration. */
  function expectRejected(label: string, document: unknown): void {
    expect(() => encode(document), label).toThrow(TypeError);
  }

  it('rejects a document whose values are outside the scope', () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ['undefined member', { a: undefined }],
      ['function member', { a: () => 1 }],
      ['symbol member', { a: Symbol('s') }],
      ['bigint member', { a: 1n }],
      ['NaN', { a: NaN }],
      ['Infinity', { a: Infinity }],
      ['-Infinity', { a: -Infinity }],
      ['array hole', { a: withHole() }],
      ['undefined root', undefined],
      ['undefined array member', [1, undefined]],
    ];

    for (const [label, document] of cases) expectRejected(label, document);
  });

  it('rejects objects and arrays JSON.stringify would treat differently', () => {
    class Instance {
      readonly a = 1;
    }
    const withAccessor: Record<string, unknown> = {};
    Object.defineProperty(withAccessor, 'a', {
      get: () => 1,
      enumerable: true,
      configurable: true,
    });

    const cases: readonly (readonly [string, unknown])[] = [
      ['accessor property', { a: withAccessor }],
      ['own toJSON', { a: { toJSON: () => 1 } }],
      ['inherited toJSON', { a: Object.create({ toJSON: () => 1 }) as object }],
      ['Date', { a: new Date(0) }],
      ['Map', { a: new Map() }],
      ['Set', { a: new Set() }],
      ['boxed Number', { a: new Number(1) }],
      ['class instance', { a: new Instance() }],
      ['typed array', { a: new Uint8Array([1]) }],
      ['array with toJSON', { a: Object.assign([1], { toJSON: () => 1 }) }],
    ];

    for (const [label, document] of cases) expectRejected(label, document);
  });

  it('accepts an object with a null prototype, which JSON.stringify serialises the same way', () => {
    const document = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });

    expect(expectEquivalent({ value: document })).toBe('{"value":{"a":1}}\n');
  });
});

describe('json/stream — chunks are lazy and bounded (§5.10)', () => {
  it('yields one bounded chunk per next()', () => {
    const document = { value: 'y'.repeat(300_000) };
    const iterator = encodeJson(document as unknown as JsonTablesEnvelope)[Symbol.iterator]();

    const first = iterator.next();
    expect(first.done).toBe(false);
    expect((first.value ?? '').length).toBeLessThan(SPEC_CHUNK_LIMIT);
    expect((first.value ?? '').length).toBeGreaterThanOrEqual(CHUNK_LIMIT_UNITS / 5);
  });

  it('writes one line plus the newline, and JSON.parse accepts the whole stream', () => {
    const text = expectEquivalent({ a: [1, { b: 'c' }] });

    expect(text.endsWith('\n')).toBe(true);
    expect(text.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(text)).toEqual({ a: [1, { b: 'c' }] });
  });
});
