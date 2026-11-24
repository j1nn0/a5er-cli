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
 * Throws unless every value is a **positive safe integer**. `0`, `-1` and `1.5` would silently
 * change what the tool accepts. `2**53` is a positive integer, but one past `Number.MAX_SAFE_INTEGER`
 * the value itself no longer counts exactly — the next integer shares its double — so a limit there
 * cannot be compared or reported as the number it names; `Number.isSafeInteger` draws exactly that
 * line and keeps `Number.MAX_SAFE_INTEGER` a valid setting.
 *
 * The bound is **per field**. It makes each value exact, nothing more: no product or sum of two
 * limits is made safe by this check, and no engine limit is raised (§10.3).
 *
 * Fail-closed (§10.2) is a rule about *files*. An override comes from code, not from the input, so
 * a bad setting is a programming error: it throws here, before any byte is read or any text decoded
 * — never clamped, never replaced by the default, never turned into an `E_*` diagnostic.
 */
export function withLimits(overrides: Partial<Limits> | undefined = undefined): Limits {
  const limits: Limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`limit ${name} must be a positive integer, got ${String(value)}`);
    }
  }
  return limits;
}
