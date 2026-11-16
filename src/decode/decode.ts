/**
 * Strict decoding (`architecture.md` §8.1, §8.2, §8.3, §8.4).
 *
 * Two rules decide everything here:
 *
 * - **There is no lossy path** (L3). Every candidate uses `TextDecoder(codec, { fatal: true })`
 *   and a result containing U+FFFD is rejected even when the decoder does not throw. If no
 *   candidate succeeds the input is `E_UNDECODABLE`; lossy text is never emitted.
 * - **The bytes win over the header.** The declaration is a hint; both values are reported so a
 *   consumer can see the disagreement (`D_ENCODING_MISMATCH`), and the decoder is never re-run
 *   blindly after a successful decode.
 *
 * Candidate order: a BOM pins the codec outright (no chain — a BOM is evidence, not a hint);
 * otherwise the ASCII header hint goes first, then the fixed list of §8.2.
 *
 * Not implemented: §8.1's "NUL density heuristic" for a UTF-16 file with **no BOM**. The
 * document gives a threshold we cannot read unambiguously ("odd-byte NUL ≥ 85 % printable"),
 * and every guard we could pick would be invented. Such a file therefore decodes as UTF-8
 * (valid bytes, NULs preserved) instead of being decoded as UTF-16. Recorded as an open item
 * rather than guessed at; every fixture that needs UTF-16 carries a BOM (enc-05).
 *
 * Ambiguity is real and is *not* papered over: pure ASCII decodes successfully under all four
 * codecs, so a strict success alone never proves which one wrote the bytes. Priority is what
 * resolves it, and the reason is §8.4's first row: UTF-8 with or without a BOM is the
 * spec-preferred form (P2), and UTF-8 is an ASCII superset, so reading ASCII as UTF-8 is the
 * only order that cannot turn a legacy file into mojibake. A file that is genuinely Shift_JIS
 * therefore has to be declared or contain non-ASCII bytes — which is exactly what enc-03 covers.
 */

import { emit } from '../diagnostics/diagnostic.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Limits } from '../io/limits.js';
import { withLimits } from '../io/limits.js';
import type { Codec } from './bom.js';
import { CANDIDATE_ORDER, sniffBom } from './bom.js';
import { parseHeader, peekHeader } from './header.js';

/** Encoding facts reported alongside the decoded text (§4.2, §8.4). */
export interface EncodingInfo {
  /** Codec that decoded the bytes strictly. */
  readonly detected: Codec;
  /** Whether the input began with a byte-order mark. */
  readonly bom: boolean;
  /** `ENCODING:` token exactly as declared in the (decoded) header, or `null`. */
  readonly declared: string | null;
  /** True when the declaration names a different codec than the one that decoded. */
  readonly mismatch: boolean;
}

export interface DecodedText {
  readonly text: string;
  readonly encoding: EncodingInfo;
  /** `FORMAT:` declaration, for the F2 gate in the syntax stage (§6). */
  readonly format: number | null;
  /** Decode-stage diagnostics: `D_BOM_MISSING`, `D_ENCODING_ASSUMED`, `D_ENCODING_MISMATCH`. */
  readonly diagnostics: readonly Diagnostic[];
}

export type DecodeOutcome =
  | { readonly ok: true; readonly decoded: DecodedText }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface DecodeOptions {
  /** Per-call overrides; `maxLines` and `maxLineLength` are checked here, on text. */
  readonly limits?: Partial<Limits>;
}

/** Does a decoder for `codec` exist in this build? (§8.3) */
export function isCodecAvailable(codec: Codec): boolean {
  try {
    new TextDecoder(codec, { fatal: true });
    return true;
  } catch {
    // The only failure mode is a build without full ICU; the caller turns it into
    // `E_CODEC_UNAVAILABLE`, so the boolean is the whole signal this function owes.
    return false;
  }
}

/**
 * Decode `bytes` strictly, or report why no codec could.
 *
 * The returned text is exactly what the file said: no trimming, no newline rewriting, no
 * replacement characters. Line endings reach the syntax stage untouched (hst-05).
 */
export function decodeBytes(bytes: Uint8Array, options: DecodeOptions = {}): DecodeOutcome {
  const limits = withLimits(options.limits);

  const bom = sniffBom(bytes);
  const payload = bytes.subarray(bom.length);

  // §8.3: probe before decoding, so a build without the legacy codec refuses instead of
  // silently mis-decoding. Only the legacy codec can be absent in practice.
  const unavailable = CANDIDATE_ORDER.filter((codec) => !isCodecAvailable(codec));
  if (unavailable.length > 0) {
    return {
      ok: false,
      diagnostics: [
        emit('E_CODEC_UNAVAILABLE', {
          details: { codecs: unavailable.join(',') },
          construct: 'Source',
        }),
      ],
    };
  }

  const hint = peekHeader(payload);
  const candidates = candidateList(bom.codec, hint.encoding);

  const rejected: Codec[] = [];
  for (const codec of candidates) {
    const text = tryDecode(payload, codec);
    if (text === null) {
      // Rejected strictly: either the decoder threw, or the result contained U+FFFD. Both are
      // recorded in the failure detail below rather than swallowed.
      rejected.push(codec);
      continue;
    }

    return finish(text, codec, bom.codec !== null, limits);
  }

  return {
    ok: false,
    diagnostics: [
      emit('E_UNDECODABLE', {
        details: {
          sizeBytes: payload.byteLength,
          tried: rejected.join(','),
          bom: bom.codec !== null,
        },
        construct: 'Source',
      }),
    ],
  };
}

/** The ordered, de-duplicated candidate list for one input (§8.1/§8.2). */
function candidateList(bomCodec: Codec | null, declared: string | null): readonly Codec[] {
  // A BOM is evidence, not a hint: it pins the codec, and a strict failure means undecodable.
  if (bomCodec !== null) return [bomCodec];

  const hinted = normaliseDeclared(declared);
  const order: Codec[] = hinted === null ? [] : [hinted];
  for (const codec of CANDIDATE_ORDER) {
    if (!order.includes(codec)) order.push(codec);
  }
  return order;
}

/** Strict decode of one candidate, or `null` when it is not lossless. */
function tryDecode(payload: Uint8Array, codec: Codec): string | null {
  let text: string;
  try {
    // The BOM (if any) was sliced off above, so the decoder must not look for another one.
    text = new TextDecoder(codec, { fatal: true, ignoreBOM: true }).decode(payload);
  } catch {
    // A strict decoder throws instead of substituting; the candidate list records the failure.
    return null;
  }

  // §8.2: a decoder that returns U+FFFD is not lossless, whatever it claims about itself.
  return text.includes('\uFFFD') ? null : text;
}

/** Decode the declared `ENCODING:` token into one of our codecs, or `null` when unknown. */
function normaliseDeclared(declared: string | null): Codec | null {
  if (declared === null) return null;

  switch (declared.trim().toLowerCase()) {
    case 'utf8':
    case 'utf-8':
      return 'utf-8';
    case 'sjis':
    case 'shift_jis':
    case 'shift-jis':
    case 'cp932':
      return 'shift_jis';
    case 'utf16le':
    case 'utf-16le':
      return 'utf-16le';
    case 'utf16be':
    case 'utf-16be':
      return 'utf-16be';
    default:
      // An unrecognised token is reported verbatim in `declared`; it is not a mismatch this
      // stage can judge, and inventing one would be spec behaviour we cannot cite.
      return null;
  }
}

/** Build the successful result: text limits, then the §8.4 diagnostics. */
function finish(text: string, detected: Codec, bom: boolean, limits: Limits): DecodeOutcome {
  const lineBreach = checkLineLimits(text, limits);
  if (lineBreach !== null) return { ok: false, diagnostics: [lineBreach] };

  // The decoded text is authoritative; the byte peek only ordered the candidates.
  const header = parseHeader(text);
  const encoding: EncodingInfo = {
    detected,
    bom,
    declared: header.encoding,
    mismatch: isMismatch(header.encoding, detected),
  };

  const diagnostics: Diagnostic[] = [];
  if (detected === 'utf-8' && !bom) {
    // §8.4 row 2: the spec expects a BOM; its absence is tolerated and reported once.
    diagnostics.push(emit('D_BOM_MISSING', { details: { declared: header.encoding } }));
  }
  if (detected !== 'utf-8' && header.encoding === null) {
    // §8.4 row 5: a non-UTF-8 file with no declaration was inferred (enc-05: UTF-16LE BOM).
    diagnostics.push(emit('D_ENCODING_ASSUMED', { details: { detected, bom } }));
  }
  if (encoding.mismatch) {
    // §8.4 rows 3/4: the bytes won, and both values are reported.
    diagnostics.push(
      emit('D_ENCODING_MISMATCH', {
        details: { declared: header.encoding, detected },
        construct: 'Header',
      }),
    );
  }

  return { ok: true, decoded: { text, encoding, format: header.format, diagnostics } };
}

/** True when the declaration names a codec other than the one that decoded the bytes. */
function isMismatch(declared: string | null, detected: Codec): boolean {
  const expected = normaliseDeclared(declared);
  return expected !== null && expected !== detected;
}

/**
 * Enforce the text limits of §10.2.
 *
 * `maxLines` and `maxLineLength` cannot be checked on bytes: a CRLF pair is one line break, and
 * a multi-byte character is one column. They are therefore checked here, on the decoded text,
 * before any consumer sees it — leaving nothing half-parsed behind (§10.2, no partial success).
 *
 * Scanning is index-based rather than `split`, so a 64 MiB single-line file does not allocate a
 * second 64 MiB array just to be rejected.
 */
function checkLineLimits(text: string, limits: Limits): Diagnostic | null {
  let lines = text.length === 0 ? 0 : 1;
  let lineStart = 0;
  let longest = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);

    if (char === 0x0a || char === 0x0d) {
      longest = Math.max(longest, index - lineStart);
      // CRLF is one break, not two: skip the LF that follows a CR.
      if (char === 0x0d && text.charCodeAt(index + 1) === 0x0a) index += 1;
      lineStart = index + 1;
      lines += 1;
    }
  }
  longest = Math.max(longest, text.length - lineStart);

  if (lines > limits.maxLines) {
    return emit('E_LIMIT_LINES', {
      details: { lines, maxLines: limits.maxLines },
      construct: 'Source',
    });
  }
  if (longest > limits.maxLineLength) {
    return emit('E_LIMIT_LINE_LENGTH', {
      details: { maxLineLength: limits.maxLineLength, longestLine: longest },
      construct: 'Source',
    });
  }

  return null;
}
