/**
 * `text/chunks.ts` — the chunk buffer shared by every renderer (`docs/proposals/human-cli.md`
 * §4.10, §7.7 B-3).
 *
 * **What it is for.** Nothing above it ever joins a whole output, note line or name into one
 * string: the renderers yield pieces in the order they are written, and this generator is the only
 * place that accumulates. It flushes once the buffer holds `CHUNK_FLUSH_UNITS` code units, and it
 * cuts a piece that would reach `CHUNK_LIMIT_UNITS`, so the memory the output costs is one chunk,
 * whatever the input size.
 *
 * **Surrogate pairs never split.** A chunk boundary that fell between a high surrogate and the low
 * surrogate that follows it would do more than display wrong: Node encodes each `write()` string to
 * UTF-8 separately, so the pair would become two U+FFFD on the wire. The cut is moved back one code
 * unit when it would land inside a pair. Lone surrogates cannot reach a boundary raw — they are in
 * the escape set, so they are rendered as `\u{XXXX}` text (§4.4.2).
 *
 * No import, no clock, no `node:` module.
 */

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

/**
 * Buffer `pieces` into chunks of at least `CHUNK_FLUSH_UNITS` and always under `CHUNK_LIMIT_UNITS`
 * code units, never splitting a surrogate pair.
 *
 * The last chunk is whatever is left, which is the only chunk allowed to be short. An empty input
 * yields nothing.
 */
export function* chunkPieces(pieces: Iterable<string>): Generator<string, void, undefined> {
  let buffer = '';

  for (const piece of pieces) {
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
