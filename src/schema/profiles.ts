/**
 * FORMAT profiles (`architecture.md` §6, F2; `format-coverage.md` P1, K2).
 *
 * A profile decides **interpretation**, never acceptance (§6's closing sentence): every key in
 * every profile is preserved, and the profile only says which reading the decoder is entitled
 * to prefer. Two things change with the declaration:
 *
 * - `known` — whether the number is one this build knows: `19` and `21` are, `20` is the hole in
 *   the documented map (K2), anything above `21` is from the future, and absence is no evidence
 *   (U1). This is §6's `S_HEADER_UNKNOWN_FORMAT` gate, already decided by the scanner.
 * - `legacy` — whether the file predates (or does not declare) the 2.21 canonical spellings, so
 *   the legacy view is the *primary* one: `Index`/`IndexOption` are the index source rather than
 *   a compatibility leftover (D5, L6).
 *
 * Two fields of §6's sketch are deliberately **not** reproduced here, and the reason is the same
 * for both — the document does not define them for every profile:
 *
 * - `legacyIndex: boolean // decode Index/IndexOption` is `true` in *every* row of §6's policy
 *   table (a 2.21 file may still carry the compat keys), so as a per-profile switch it decides
 *   nothing. `legacy` is the field that actually differs.
 * - `fontSize: 'int' | 'float'` is only derivable for `21` (Float) and `< 21` (Integer, §6/F1).
 *   The spec states nothing for an absent or `99` declaration, and picking one would be the
 *   invention §6 itself forbids. It belongs to the `Field` decoder that needs it (3B-2), which can
 *   read `declared` and decide there with the value in hand.
 */

import type { FormatFact } from '../syntax/scanner.js';

/** The interpretation switches implied by one `FORMAT:` declaration (§6). */
export interface FormatProfile {
  /** The declaration as written, or `null` when absent or not numeric. */
  readonly declared: number | null;
  /** §6: `false` for absent, `20` (K2) and anything above `21`. */
  readonly known: boolean;
  /**
   * The legacy-era view: `Index`/`IndexOption` are the primary index source.
   *
   * `true` for `19`, `20`, absent and anything above `21`; `false` for `21`. `20` is treated as
   * `< 21` because the number is a hole and being permissive loses nothing (K2); an absent or
   * future declaration says nothing, so both readings stay available (U1).
   */
  readonly legacy: boolean;
}

/** Highest FORMAT this build knows: `21` (`format-coverage.md` §2). */
const FORMAT_MAX = 21;

/**
 * Derive the profile from the scanner's `FormatFact`.
 *
 * `known` is taken from the fact rather than recomputed: one definition of "is this FORMAT known"
 * lives in `syntax/scanner.ts`, and a second would be free to drift.
 */
export function profileOf(format: FormatFact): FormatProfile {
  const { declared } = format;
  return {
    declared,
    known: format.known,
    legacy: declared === null || declared < FORMAT_MAX,
  };
}
