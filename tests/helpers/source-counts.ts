/**
 * A deliberately small, independent reader for the *physical* facts of a fixture
 * (`architecture.md` §4.1, §7.4, §10.4, §13).
 *
 * **Independence is the point.** This file imports nothing from `src/`: no parser, no scanner, no
 * registry, no serializer. It re-derives the counts a golden claims from the fixture's own bytes,
 * using only the rules the documentation states, so a golden can never be its own witness. The
 * five documented rules it applies, in the order the syntax stage applies them:
 *
 * 1. **Physical lines** (§4.1, U4). A line break is `\r\n`, `\n` or a bare `\r`, and a **trailing**
 *    terminator does not create an extra empty line (R17): `"a\n"` is one line. A one-pass scan,
 *    not a `split`, because `"a\r\nb"` must not become three lines and because
 *    `String.prototype.split` yields a phantom entry for a final newline — the exact off-by-one
 *    this guard exists to catch (`tests/helpers/fixture-text.ts` uses that split for span bounds
 *    only, so it cannot supply a physical count).
 * 2. **Header** (§10.4). `^\s*\[(.+)\]\s*$`: the outer pair is greedy, so `[[Entity]]` has the
 *    name `[Entity]`, and a character after the closing bracket (`[Entity]x`) is not a header at
 *    all. The nine recognised names are case-sensitive (the format defines no case rule), so
 *    `[entity]` is an *unknown* header.
 * 3. **Blank** (§7.4): `line.trim() === ''`.
 * 4. **Comment** (§7.4): `line.startsWith('#')`.
 * 5. **Key** (§5, §7): the first `=` is at index > 0, so a line beginning with `=` is a raw line,
 *    not a key with an empty name.
 *
 * Anything left is a **raw line** (a continuation, a malformed construct, a stray bracket line).
 *
 * **What this reader cannot derive, and must not pretend to.** Deciding whether a key is *known*
 * needs the per-section key registry (`src/schema/registry.ts`), so `keys.parsed` and
 * `keys.preservedRaw` are outside this boundary and are compared by no assertion here. What is
 * derivable is `keys.total`, the count of key lines in the whole file — which is also why the
 * byte fixtures are countable at all: key counting is a source fact, not a decode-stage one.
 */

/** The nine section names of §10.4, spelled as the format spells them. */
export const RECOGNISED_HEADERS: readonly string[] = [
  'Manager',
  'Entity',
  'Relation',
  'Relationship',
  'View',
  'Subtype',
  'Shape',
  'Line',
  'Comment',
];

/** What one physical line turned out to be. */
export type RecordKind = 'header' | 'blank' | 'comment' | 'key' | 'raw';

/** One physical line, classified. Nothing is dropped: every line yields exactly one record. */
export interface SourceRecord {
  /** 1-based physical line, the unit every span counts in (§4.1). */
  readonly line: number;
  readonly kind: RecordKind;
  /** The line exactly as decoded, without its terminator. */
  readonly text: string;
  /** The header's name (§10.4), or `null` for every other kind. */
  readonly headerName: string | null;
  /** True only for a header whose name is one of the nine documented ones. */
  readonly recognisedHeader: boolean;
  /** The key text before the first `=`, or `null` for every other kind. */
  readonly key: string | null;
}

/** The physical facts of one document, aggregated from its records. */
export interface SourceCounts {
  /** Every physical line (§4.1): the last line has no terminator and is still a line. */
  readonly lines: number;
  readonly records: readonly SourceRecord[];
  readonly headers: number;
  /** Headers whose name is one of the nine. */
  readonly recognised: number;
  /** Headers whose name is not one of the nine: `preservedRaw` in §13's partition. */
  readonly unknown: number;
  /** Every `key=value` line in the file, header region included. */
  readonly keys: number;
  readonly blank: number;
  readonly comments: number;
  readonly raw: number;
  /** `headers + keys + comments + blank + raw`: the five kinds must claim every line. */
  readonly accounted: number;
}

/** The `completeness` members this reader is entitled to judge (never `keys.parsed`). */
export interface DerivableCompleteness {
  readonly sections: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
    readonly unknown: number;
  };
  readonly keys: {
    readonly total: number;
  };
  readonly lines: {
    readonly total: number;
    readonly accounted: number;
    readonly dropped: number;
  };
}

const HEADER = /^\s*\[(.+)\]\s*$/;

/**
 * Split decoded text into physical lines, recording each one without its terminator.
 *
 * The rule is §4.1's: `\r\n` is one break, a bare `\r` is one, `\n` is one, and a terminator that
 * ends the text closes the line it follows instead of opening a new one (R17).
 */
export function physicalLines(
  text: string,
): readonly { readonly line: number; readonly text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let start = 0;
  let index = 0;
  let number = 1;
  while (index < text.length) {
    const char = text[index];
    if (char !== '\r' && char !== '\n') {
      index += 1;
      continue;
    }
    lines.push({ line: number, text: text.slice(start, index) });
    number += 1;
    index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
    start = index;
  }
  // No phantom line for a trailing terminator: only real content opens one (R17).
  if (start < text.length) lines.push({ line: number, text: text.slice(start) });
  return lines;
}

/** Classify one line by the documented precedence: header, blank, comment, key, raw. */
function classify(line: number, text: string): SourceRecord {
  const headerName = HEADER.exec(text)?.[1];
  if (headerName !== undefined) {
    return {
      line,
      kind: 'header',
      text,
      headerName,
      recognisedHeader: RECOGNISED_HEADERS.includes(headerName),
      key: null,
    };
  }
  if (text.trim() === '') {
    return { line, kind: 'blank', text, headerName: null, recognisedHeader: false, key: null };
  }
  if (text.startsWith('#')) {
    return { line, kind: 'comment', text, headerName: null, recognisedHeader: false, key: null };
  }
  const equals = text.indexOf('=');
  if (equals > 0) {
    return {
      line,
      kind: 'key',
      text,
      headerName: null,
      recognisedHeader: false,
      key: text.slice(0, equals),
    };
  }
  return { line, kind: 'raw', text, headerName: null, recognisedHeader: false, key: null };
}

/** Derive every physical count of one decoded document. */
export function countSource(text: string): SourceCounts {
  const records = physicalLines(text).map((line) => classify(line.line, line.text));
  const count = (kind: RecordKind): number =>
    records.filter((record) => record.kind === kind).length;
  const headers = records.filter((record) => record.kind === 'header');
  const recognised = headers.filter((record) => record.recognisedHeader).length;
  const keys = count('key');
  const comments = count('comment');
  const blank = count('blank');
  const raw = count('raw');
  return {
    lines: records.length,
    records,
    headers: headers.length,
    recognised,
    unknown: headers.length - recognised,
    keys,
    blank,
    comments,
    raw,
    accounted: headers.length + keys + comments + blank + raw,
  };
}

/** The standard-library codecs the committed fixtures use, and nothing else. */
export type FixtureCodec = 'utf-8' | 'utf-16le' | 'shift_jis';

/**
 * Decode bytes strictly, using the same standard-library primitive the fixture facts already use.
 *
 * `TextDecoder` with `fatal: true` throws instead of substituting U+FFFD, so a fixture that is not
 * valid in its codec fails loudly here rather than yielding a plausible-looking text. A leading
 * BOM is dropped by the decoder for UTF-8 and UTF-16LE, which is exactly what §8 permits.
 */
export function decodeBytes(bytes: Uint8Array, codec: FixtureCodec): string {
  return new TextDecoder(codec, { fatal: true }).decode(bytes);
}

/**
 * Compare the derived counts with what an envelope claims, and describe every difference.
 *
 * A list rather than assertions, for two reasons: a mismatch is reported on every field at once
 * instead of on the first one, and a test can corrupt a copy deliberately and prove the guard
 * notices. The eight fields are exactly those this reader derives — `keys.parsed` and
 * `keys.preservedRaw` are absent by design (they need the key registry).
 */
export function compareCounts(
  counts: SourceCounts,
  expected: DerivableCompleteness,
  label: string,
): readonly string[] {
  const mismatches: string[] = [];
  const check = (field: string, derived: number, claimed: number): void => {
    if (derived !== claimed)
      mismatches.push(`${label}: ${field} source=${derived} envelope=${claimed}`);
  };
  check('sections.total', counts.headers, expected.sections.total);
  check('sections.parsed', counts.recognised, expected.sections.parsed);
  check('sections.preservedRaw', counts.unknown, expected.sections.preservedRaw);
  check('sections.unknown', counts.unknown, expected.sections.unknown);
  check('keys.total', counts.keys, expected.keys.total);
  check('lines.total', counts.lines, expected.lines.total);
  check('lines.accounted', counts.accounted, expected.lines.accounted);
  check('lines.dropped', counts.lines - counts.accounted, expected.lines.dropped);
  return mismatches;
}
