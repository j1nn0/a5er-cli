/**
 * Byte-order-mark sniffing (`architecture.md` §8.1).
 *
 * This runs **before** the binary probe in the composition step: UTF-16 text is largely NUL
 * bytes, so a density test first would reject every UTF-16LE file as binary.
 */

/** Codecs this project decodes with, in the priority order of §8.1/§8.2. */
export type Codec = 'utf-8' | 'shift_jis' | 'utf-16le' | 'utf-16be';

/** Fixed candidate order, applied after any hint (§8.2: "then by a fixed list"). */
export const CANDIDATE_ORDER: readonly Codec[] = ['utf-8', 'shift_jis', 'utf-16le', 'utf-16be'];

export interface BomDetection {
  /** Codec the BOM names, or `null` when the input carries none. */
  readonly codec: Codec | null;
  /** Bytes the BOM occupies; `0` when there is none. */
  readonly length: number;
}

export const NO_BOM: BomDetection = { codec: null, length: 0 };

/**
 * Identify a leading BOM.
 *
 * UTF-32 BOMs (`FF FE 00 00` / `00 00 FE FF`) are deliberately not handled: the format documents
 * neither, and guessing one would decode UTF-16LE text as UTF-32. A UTF-16LE BOM followed by a
 * NUL is therefore read as UTF-16LE, which is what §8.1 specifies.
 */
export function sniffBom(bytes: Uint8Array): BomDetection {
  const [b0, b1, b2] = [bytes[0], bytes[1], bytes[2]];

  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { codec: 'utf-8', length: 3 };
  if (b0 === 0xff && b1 === 0xfe) return { codec: 'utf-16le', length: 2 };
  if (b0 === 0xfe && b1 === 0xff) return { codec: 'utf-16be', length: 2 };

  return NO_BOM;
}
