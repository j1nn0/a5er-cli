/**
 * The binary probe (`architecture.md` §10.4).
 *
 * A file with **more than 10 % NUL bytes in its first 4 KiB** is binary: `E_BINARY_INPUT`,
 * fatal, no decode attempt. The threshold is strict (`>`), and the window is fixed at 4 KiB —
 * both numbers come from the document, not from a heuristic we tuned.
 *
 * This module only measures bytes. `decode/` calls it *after* the BOM check on purpose: a
 * UTF-16LE file is full of NUL bytes and must not be rejected as binary.
 */

/** Bytes inspected by the probe (§10.4: "the first 4 KiB"). */
export const BINARY_WINDOW_BYTES = 4096;

/** Density above which the input is binary (§10.4: "more than 10 %"). */
export const NUL_DENSITY_THRESHOLD = 0.1;

/** Share of NUL bytes in the window, `0` for an empty input. */
export function nulDensity(bytes: Uint8Array): number {
  const window = bytes.subarray(0, BINARY_WINDOW_BYTES);
  if (window.length === 0) return 0;

  let nuls = 0;
  for (const byte of window) {
    if (byte === 0) nuls += 1;
  }
  return nuls / window.length;
}

/**
 * True when the input must be treated as binary.
 *
 * Strictly greater than the threshold: a file at exactly 10 % NUL is still text, which keeps
 * the boundary testable at `threshold ± 1 byte`.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  return nulDensity(bytes) > NUL_DENSITY_THRESHOLD;
}
