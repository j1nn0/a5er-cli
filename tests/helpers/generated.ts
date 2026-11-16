/**
 * Deterministic builders for the `generated` fixture class (test-strategy §4).
 *
 * Generated fixtures are never committed: `.gitignore` keeps the directory empty and
 * `.gitattributes` marks it binary. Every builder is a pure function of its arguments —
 * the only knob is the seed — and the caller materialises the bytes into a temp
 * directory, so a builder can never write into the repository.
 *
 * Sizes come from the documented defaults in `architecture.md` §10.2; there is no
 * hidden tuning constant here that a test could drift against. Limits are *breached*
 * by exactly one byte (or one line) so the fixture is the boundary case, not a random
 * oversized file.
 *
 * These builders produce input; they do not parse it. Nothing here asserts parser
 * behaviour, because no parser exists yet.
 */

/** A file a builder wants written, with the name the test should give it. */
export interface BuiltFile {
  readonly name: string;
  readonly bytes: Buffer;
}

/** `architecture.md` §10.2 limit defaults. */
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_LINES = 2_000_000;
export const MAX_LINE_LENGTH = 4 * 1024 * 1024;

/** hst-03's single line: 1 MiB, a quarter of the line-length limit. */
export const SINGLE_LINE_BYTES = 1024 * 1024;

/** res-01's read cap: far below the file size, so a capped read must truncate. */
export const TRUNCATED_READ_CAP_BYTES = 4 * 1024;

/** fuzz-01: test-strategy §12 fixes the mutant count; the seed is the only knob. */
export const FUZZ_SEED = 0x5eed_1234;
export const FUZZ_MUTANTS = 200;

/** A UTF-8 byte-order mark, the spec-preferred form (P2). */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Build `count` bytes of `fill`, as text, so the result stays decodable. */
function fill(character: string, count: number): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`fill count must be a non-negative integer, got ${String(count)}`);
  }
  return character.repeat(count);
}

/**
 * hst-03 — one 1 MiB line inside an otherwise ordinary document.
 *
 * The long line is a `Comment` value, so the file is a *valid* document that happens
 * to sit a quarter of the way to `maxLineLength`: it must parse, not trip a limit.
 */
export function buildSingleLongLine(): Buffer {
  const open = 'Comment="';
  const close = '"';
  const padding = SINGLE_LINE_BYTES - open.length - close.length;
  const body = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
    '[Entity]',
    'PName="long_line"',
    `${open}${fill('x', padding)}${close}`,
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
    'Position="Main",10,10',
    '',
  ].join('\n');
  return Buffer.concat([BOM, Buffer.from(body, 'utf8')]);
}

/**
 * res-01 — a document larger than a bounded read cap.
 *
 * `readCapped` is what a reader does with `maxBytes`: it stops at the cap, so the
 * caller can see `bytesRead < size` and must report truncation instead of a partial
 * schema. The file itself is well-formed; only the cap makes it short.
 */
export function buildTruncatedRead(): Buffer {
  const padding = TRUNCATED_READ_CAP_BYTES + 4096;
  const body = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
    '[Entity]',
    'PName="truncated_read"',
    `Comment="${fill('y', padding)}"`,
    'Position="Main",10,10',
    '',
  ].join('\n');
  return Buffer.concat([BOM, Buffer.from(body, 'utf8')]);
}

/**
 * res-03 — three files, each one byte or one line past a documented limit.
 *
 * One file per limit so the expectation for each is unambiguous; a single file
 * breaching several limits could not say which check fired.
 */
export function buildLimitBreaches(): readonly BuiltFile[] {
  const head = Buffer.from('# A5:ER FORMAT:21\n', 'utf8');
  return [
    {
      name: 'res-03-max-bytes.a5er',
      bytes: Buffer.concat([head, Buffer.from(fill('A', MAX_BYTES + 1 - head.length), 'utf8')]),
    },
    {
      name: 'res-03-max-lines.a5er',
      // n newlines are n terminated (empty) lines, so this is one line past the limit;
      // splitting on the terminator yields n + 1 entries, the last one empty.
      bytes: Buffer.from(fill('\n', MAX_LINES + 1), 'utf8'),
    },
    {
      name: 'res-03-max-line-length.a5er',
      bytes: Buffer.from(fill('B', MAX_LINE_LENGTH + 1), 'utf8'),
    },
  ];
}

/**
 * hst-06 — three inputs that must not be mistaken for a diagram.
 *
 * Empty, whitespace-only and section-free are different inputs; §14 row 16 requires
 * three distinct outcomes, so they are three files rather than one.
 */
export function buildEmptyFamily(): readonly BuiltFile[] {
  return [
    { name: 'hst-06-empty.a5er', bytes: Buffer.alloc(0) },
    { name: 'hst-06-whitespace.a5er', bytes: Buffer.from(' \n\t\r\n  \n', 'utf8') },
    {
      name: 'hst-06-no-sections.a5er',
      bytes: Buffer.from('# A5:ER FORMAT:21\n\n# a comment, and no section header\n', 'utf8'),
    },
  ];
}

/** Builders that need nothing but a destination, keyed by catalog ID. */
export const GENERATED_BUILDERS: Readonly<Record<string, () => readonly BuiltFile[]>> = {
  'hst-03': () => [{ name: 'hst-03-single-long-line.a5er', bytes: buildSingleLongLine() }],
  'hst-06': buildEmptyFamily,
  'res-01': () => [{ name: 'res-01-capped-read.a5er', bytes: buildTruncatedRead() }],
  'res-03': buildLimitBreaches,
};

/**
 * fuzz-01 — seeded mutations of a committed fixture.
 *
 * fuzz-01 is not in `GENERATED_BUILDERS` because its source bytes are staged from
 * `fmt-01` rather than built, which is what keeps the mutant family tied to a real
 * fixture (test-strategy §12).
 */
export const FUZZ_ID = 'fuzz-01';

/** Every catalog ID whose bytes come from this module. */
export const GENERATED_IDS: readonly string[] = [...Object.keys(GENERATED_BUILDERS), FUZZ_ID];

/** One mutant: where it changed, how wide, and the bytes it changed to. */
export interface Mutant {
  readonly index: number;
  readonly kind: 'byte' | 'range';
  readonly start: number;
  readonly width: number;
  readonly bytes: Buffer;
}

/**
 * The only PRNG in the fixture suite: a 32-bit mulberry32, seeded and pure.
 *
 * test-strategy §9 requires a single seeded generator whose seed is printed on
 * failure; every mutant carries the seed so a failing assertion can name it.
 */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Apply `FUZZ_MUTANTS` seeded mutations to `source`: a single byte or a small run of
 * two to eight bytes, never both, never zero. The returned buffers are copies — the
 * caller's `source` is never mutated, which is what lets the fuzz floor also assert
 * fixture immutability.
 */
export function buildFuzzMutants(source: Buffer, seed: number = FUZZ_SEED): readonly Mutant[] {
  if (source.length === 0) throw new Error('cannot fuzz empty input');
  const random = prng(seed);
  const mutants: Mutant[] = [];
  for (let index = 0; index < FUZZ_MUTANTS; index += 1) {
    const start = Math.floor(random() * source.length);
    const range = index % 2 === 0 ? 1 : 2 + Math.floor(random() * 7);
    const width = Math.min(range, source.length - start);
    const bytes = Buffer.from(source);
    // Pick a replacement that differs from the original at every position it writes.
    const replacement = (source[start] ?? 0) + 1 + Math.floor(random() * 255);
    for (let offset = 0; offset < width; offset += 1) {
      bytes[start + offset] = (replacement + offset) % 256;
    }
    mutants.push({ index, kind: width === 1 ? 'byte' : 'range', start, width, bytes });
  }
  return mutants;
}
