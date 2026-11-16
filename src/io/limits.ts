/**
 * Input limits (`architecture.md` §10.2).
 *
 * Defaults are the documented ones and are overridable **per call**, never through a global:
 * a test that lowers `maxBytes` must not be able to affect another test's read.
 *
 * `maxBytes` is enforced by `io/` (it is a byte count). `maxLines` and `maxLineLength` are
 * counts of decoded text, so `decode/` enforces them the moment text exists — before any
 * consumer can see a truncated line.
 */
export interface Limits {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxLineLength: number;
}

/** `architecture.md` §10.2 defaults (TBD-O3 tracks a final decision; these are the values). */
export const DEFAULT_LIMITS: Limits = {
  maxBytes: 64 * 1024 * 1024,
  maxLines: 2_000_000,
  maxLineLength: 4 * 1024 * 1024,
};

/**
 * Resolve per-call overrides into a complete `Limits`.
 *
 * Throws on a non-positive or non-integer value: a limit of `0` or `1.5` would silently change
 * what the tool accepts, and every override here comes from code, not from the input file.
 */
export function withLimits(overrides: Partial<Limits> | undefined = undefined): Limits {
  const limits: Limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`limit ${name} must be a positive integer, got ${String(value)}`);
    }
  }
  return limits;
}
