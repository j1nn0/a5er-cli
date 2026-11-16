/**
 * The composition of `io/` and `decode/`: one call from a path to decodable source.
 *
 * Layering: `io/` produces bytes, `decode/` owns the text contract, so the two are joined here,
 * at the decode boundary, rather than inside either module. The syntax stage consumes
 * `DecodedSource` and never touches a byte array or a `TextDecoder`.
 *
 * The order of the checks is the order of the document:
 *
 * 1. read within `maxBytes` (§10.1) — `io/`
 * 2. empty input (§10.4) — `io/` sees `size === 0` before any read
 * 3. BOM sniff, **then** the binary probe (§8.1 before §10.4): UTF-16 is mostly NUL bytes and
 *    must not be called binary
 * 4. strict decode plus the text limits (§8.2, §10.2)
 * 5. whitespace-only input is empty (§10.4)
 * 6. zero recognised section headers (§10.4)
 *
 * Every step returns a typed failure; there is no path that returns partial text.
 */

import { emit } from '../diagnostics/diagnostic.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { looksBinary } from '../io/binary.js';
import type { FileSystem } from '../io/fs.js';
import { readSource } from '../io/read.js';
import type { Limits } from '../io/limits.js';
import { sniffBom } from './bom.js';
import { decodeBytes } from './decode.js';
import type { DecodeOptions, EncodingInfo } from './decode.js';
import { hasRecognisedSection } from './sections.js';

/** The decoded, classified input the syntax stage consumes. */
export interface DecodedSource {
  /** Decoded text, exactly as written: no trimming, no newline rewriting (§8.2, T9). */
  readonly text: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly encoding: EncodingInfo;
  /** `FORMAT:` declaration; the F2 gate decides what it means (§6). */
  readonly format: number | null;
  /** Decode-stage diagnostics, informative only: a failure never reaches this type. */
  readonly diagnostics: readonly Diagnostic[];
}

export type LoadOutcome =
  | { readonly ok: true; readonly source: DecodedSource }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface LoadOptions {
  readonly limits?: Partial<Limits>;
  /** The read boundary; tests inject a fake for short reads and unstable files. */
  readonly fileSystem?: FileSystem;
}

/**
 * Read, decode and classify `path`.
 *
 * `E_UNRECOGNIZED_DOCUMENT` is decided here from the decoded text. The detection helper
 * (`decode/sections.ts`) is the real one; what is *not* yet real is the section *model* — the
 * syntax stage will scan once and reuse its own result, so this check may move into it. It is
 * kept here because the code exists in the taxonomy and the guard has to run before anything
 * can report an empty-but-healthy document.
 */
export function loadSource(path: string, options: LoadOptions = {}): LoadOutcome {
  const read = readSource(path, options);
  if (!read.ok) return { ok: false, diagnostics: read.diagnostics };

  const { bytes, sizeBytes, sha256 } = read.source;

  // BOM first: §8.1's order exists so the binary probe cannot reject UTF-16 as binary.
  const bom = sniffBom(bytes);
  if (bom.codec === null && looksBinary(bytes)) {
    return {
      ok: false,
      diagnostics: [
        emit('E_BINARY_INPUT', {
          details: { sizeBytes, windowBytes: Math.min(4096, sizeBytes) },
          construct: 'Source',
        }),
      ],
    };
  }

  // `exactOptionalPropertyTypes` keeps "absent" and "undefined" distinct, so the override is
  // only forwarded when the caller actually passed one.
  const decodeOptions: DecodeOptions =
    options.limits === undefined ? {} : { limits: options.limits };
  const decoded = decodeBytes(bytes, decodeOptions);
  if (!decoded.ok) return { ok: false, diagnostics: decoded.diagnostics };

  const { text, encoding, format, diagnostics } = decoded.decoded;

  // Whitespace-only is empty: no section, no key, no content after trimming (§10.4).
  if (text.trim() === '') {
    return {
      ok: false,
      diagnostics: [emit('E_EMPTY_INPUT', { details: { sizeBytes }, construct: 'Source' })],
    };
  }

  if (!hasRecognisedSection(text)) {
    return {
      ok: false,
      diagnostics: [
        emit('E_UNRECOGNIZED_DOCUMENT', {
          details: { sizeBytes, headers: 0 },
          construct: 'Document',
        }),
      ],
    };
  }

  return { ok: true, source: { text, sizeBytes, sha256, encoding, format, diagnostics } };
}
