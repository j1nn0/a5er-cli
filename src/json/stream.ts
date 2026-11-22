/**
 * `json/stream.ts` — the bounded JSON encoder for `a5er tables --format json`
 * (`docs/proposals/human-cli.md` §5.10).
 *
 * **Why not `toJsonString`.** That is one `JSON.stringify` of the whole envelope, and a tables
 * envelope carries the same `unsupported` and `diagnostics` lists as `inspect`: the largest input
 * the reader accepts produces a document past V8's maximum string length. `encodeJson` walks the
 * document and yields chunks instead, so the memory the output costs is one chunk.
 *
 * **What it promises.** For every document `serialize()` and `buildTablesEnvelope()` can produce —
 * plain objects and arrays whose leaves are strings, finite numbers, booleans and `null` — the
 * concatenated chunks equal `JSON.stringify(document, strictReplacer) + "\n"`, byte for byte, and
 * every chunk is under 262,144 code units. The traversal is `JSON.stringify`'s own: `Object.keys`
 * order for objects (integer keys ascending first, then insertion order), index order for arrays,
 * and `strictReplacer.call(holder, key, value)` for every value.
 *
 * **What it refuses.** Nothing outside that scope is accepted, so nothing outside it needs to be
 * equivalent: an object whose prototype is not `Object.prototype`/`null`, an array whose prototype
 * is not `Array.prototype`, anything with a `toJSON` member, an accessor property among the keys,
 * and every value `strictReplacer` already rejects. Each is a `TypeError`, which the writer reports
 * as a generation failure; the alternative would be to print something `JSON.stringify` would not.
 *
 * **Strings are sliced, never split.** A string (or a key) is written as `"`, then slices of at
 * most 16,384 code units escaped as `JSON.stringify(slice).slice(1, -1)`, then `"`. A cut never
 * separates a surrogate pair, so each slice escapes exactly as that part of the whole string would
 * and the concatenation is `JSON.stringify`'s bytes. The same protection guards the chunk buffer:
 * Node encodes each `write()` separately, so a split pair would reach the reader as two U+FFFD.
 *
 * **Temporaries are not bounded.** `strictReplacer` builds its error context — `` ` at key ${…}` ` —
 * on every call, so each value costs one temporary string proportional to its key (§5.10). Product
 * keys are fixed short names; only the generalized tests of §8.4 use a 40,001-code-unit key.
 *
 * `toJsonString`, `serialize()` and the `inspect`/`validate` bytes deliberately do not change:
 * `strictReplacer` gains an `export` and no behaviour (§5.8, S-3).
 */

import type { JsonTablesEnvelope } from './envelope.js';
import { strictReplacer } from './serialize.js';

/** At most this many code units per escaped string slice (§5.10). */
const STRING_SLICE_CODE_UNITS = 16_384;

/** Pieces are flushed once the buffer holds this many code units. */
export const CHUNK_FLUSH_UNITS = 65_536;

/** No chunk reaches this many code units; the bound the tests assert (§7.7 B-3). */
export const CHUNK_LIMIT_UNITS = 262_144;

/** True for a UTF-16 high surrogate. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** True for a UTF-16 low surrogate. */
function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Read a property the way `JSON.stringify` does, from an object or an array holder. */
function readProperty(holder: object, key: string): unknown {
  return (holder as Record<string, unknown>)[key];
}

/**
 * One string, escaped exactly as `JSON.stringify` escapes it, in bounded slices.
 *
 * The cut moves back one code unit rather than separate a high surrogate from its low surrogate, so
 * a pair is never split across two `JSON.stringify` calls — which is what makes the concatenation
 * equal to stringifying the whole value.
 */
function* stringPieces(value: string): Generator<string, void, undefined> {
  yield '"';
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + STRING_SLICE_CODE_UNITS, value.length);
    if (
      end < value.length &&
      end - start > 1 &&
      isHighSurrogate(value.charCodeAt(end - 1)) &&
      isLowSurrogate(value.charCodeAt(end))
    ) {
      end -= 1;
    }
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

/** Refuse an object `JSON.stringify` would treat differently from a plain record (§5.10). */
function assertPlainObject(value: object): void {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      'cannot serialise an object whose prototype is not Object.prototype or null',
    );
  }
  if ('toJSON' in value) {
    throw new TypeError('cannot serialise an object with a toJSON member');
  }
}

/** Refuse an array `JSON.stringify` would treat differently from a plain list (§5.10). */
function assertPlainArray(value: object): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('cannot serialise an array whose prototype is not Array.prototype');
  }
  if ('toJSON' in value) {
    throw new TypeError('cannot serialise an array with a toJSON member');
  }
}

/** Refuse a property whose read would run a getter that `JSON.stringify` would have called. */
function assertDataProperty(value: object, key: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`cannot serialise an accessor property at key ${JSON.stringify(key)}`);
  }
}

/** One array: `[`, its elements in index order, `]` (§5.10). */
function* arrayPieces(value: unknown[]): Generator<string, void, undefined> {
  assertPlainArray(value);

  yield '[';
  for (let index = 0; index < value.length; index += 1) {
    if (index > 0) yield ',';
    // A hole reads as `undefined` here, and `strictReplacer` rejects it, as it would for
    // `JSON.stringify` with the same replacer.
    yield* valuePieces(value, String(index));
  }
  yield ']';
}

/** One plain object: `{`, its `Object.keys` order, `}` (§5.10). */
function* objectPieces(value: object): Generator<string, void, undefined> {
  assertPlainObject(value);

  yield '{';
  let first = true;
  for (const key of Object.keys(value)) {
    assertDataProperty(value, key);
    if (!first) yield ',';
    first = false;
    yield* stringPieces(key);
    yield ':';
    yield* valuePieces(value, key);
  }
  yield '}';
}

/**
 * One value, replacer first, then by type (§5.10).
 *
 * `strictReplacer` is called exactly as `JSON.stringify` calls its replacer — `holder` is the
 * containing object and `key` is the property name, the array index as a string, or `''` for the
 * root — so an out-of-scope leaf throws the same `TypeError` with the same message.
 */
function* valuePieces(holder: object, key: string): Generator<string, void, undefined> {
  const value = strictReplacer.call(holder, key, readProperty(holder, key));

  if (value === null) {
    yield 'null';
    return;
  }

  switch (typeof value) {
    case 'string':
      yield* stringPieces(value);
      return;
    case 'number':
      // `strictReplacer` already refused a non-finite number; `-0` becomes `0`, as in JSON.
      yield JSON.stringify(value);
      return;
    case 'boolean':
      yield value ? 'true' : 'false';
      return;
    case 'object':
      if (Array.isArray(value)) {
        yield* arrayPieces(value);
        return;
      }
      yield* objectPieces(value);
      return;
    default:
      // Unreachable: `strictReplacer` throws for every other type before this point.
      throw new TypeError('cannot serialise a value of an unsupported type');
  }
}

/** Buffer pieces into chunks of at least `CHUNK_FLUSH_UNITS` and always under `CHUNK_LIMIT_UNITS`. */
function* buffered(source: Iterable<string>): Generator<string, void, undefined> {
  let buffer = '';

  for (const piece of source) {
    let rest = piece;
    while (rest !== '') {
      // `buffer` is always below the flush threshold here, so there is room to take something.
      const room = CHUNK_LIMIT_UNITS - 1 - buffer.length;
      if (rest.length <= room) {
        buffer += rest;
        rest = '';
      } else {
        let cut = room;
        // Move back one unit rather than separate a high surrogate from its low surrogate.
        const before = rest.charCodeAt(cut - 1);
        const after = rest.charCodeAt(cut);
        if (isHighSurrogate(before) && isLowSurrogate(after)) cut -= 1;
        buffer += rest.slice(0, cut);
        rest = rest.slice(cut);
      }
      if (buffer.length >= CHUNK_FLUSH_UNITS) {
        yield buffer;
        buffer = '';
      }
    }
  }

  if (buffer !== '') yield buffer;
}

/** Every piece of the document, ending with the one newline the command writes (§3.6). */
function* documentPieces(document: JsonTablesEnvelope): Generator<string, void, undefined> {
  // The root holder is `{ '': document }`, which is what `JSON.stringify` hands its replacer.
  const root: Record<string, unknown> = { '': document };
  yield* valuePieces(root, '');
  yield '\n';
}

/**
 * Encode a tables document as bounded JSON chunks (§5.10).
 *
 * The iterable is lazy: each `next()` buffers one chunk and returns it. The last chunk ends with
 * `\n`, so the whole stream is one JSON document plus the newline that ends it.
 */
export function encodeJson(document: JsonTablesEnvelope): Iterable<string> {
  return buffered(documentPieces(document));
}
