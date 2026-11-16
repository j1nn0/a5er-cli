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
 * for both — the document does not define them for every profile. The two omissions are
 * *contractual*, not incidental: anything that reads a profile in this codebase may rely on the
 * equivalence stated below, and must not add a second copy of either rule.
 *
 * - `legacyIndex: boolean // decode Index/IndexOption` is `true` in *every* row of §6's policy
 *   table (a 2.21 file may still carry the compat keys; the spec tells readers to ignore them, and
 *   3B-1's decision is to decode them anyway). As a per-profile switch it therefore decides
 *   nothing, and it is **equivalent to the constant `true`**: every profile decodes both index
 *   spellings. What actually differs is which source is *primary*, and that is `legacy` — the
 *   index decoder labels each decoded record `role: 'primary' | 'compatibility'` from it.
 * - `fontSize: 'int' | 'float'` is only derivable for `21` (Float) and `< 21` (Integer, §6/F1).
 *   The spec states nothing for an absent or `99` declaration, so a `'int' | 'float'` field would
 *   have to invent one of the two. It is **equivalent to reading `declared` directly**, which is
 *   what the `Field` decoder does: it needs no `fontSize` value in this unit (the element is kept
 *   as its declared text), and when a later unit needs the distinction it can compare `declared`
 *   against `21` at the point of use, with the value in hand.
 *
 * Neither omission is a licence to drop data: a profile changes interpretation only, so both
 * index spellings are decoded and every key is preserved in every profile (§6's closing
 * sentence).
 *
 * **R18:** `legacy` follows §6 exactly — `99` behaves like an absent declaration, so it is a
 * legacy profile. Before the fix, `99` fell through the `declared < 21` test and was treated as
 * canonical, which is the one row of §6's table it contradicted.
 *
 * **Assumption (not spec):** for an absent or future declaration §6 says *both* decoders are
 * active and stops there, so it does not say which source is primary. This module keeps the legacy
 * view primary for those rows: a file that declares no version is at least as likely to predate the
 * canonical spelling, and choosing canonical would be the more aggressive reading — the same
 * reasoning §6 gives for treating `20` as `< 21`. Both spellings are decoded either way, so the
 * choice costs nothing but the `role` label (K2, U1).
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
   * `false` for exactly one declaration — `21`, the canonical spelling's own version — and `true`
   * for everything else: `19` and every other `< 21`, `20` (the hole in the map, treated as
   * `< 21`, K2), **`99`** (explicitly "as absent", U1) and an absent declaration. The rule is
   * §6's table, not "less than 21": a future declaration says nothing, so it inherits the
   * permissive legacy reading rather than being guessed as canonical (R18).
   *
   * Both spellings are decoded in every profile; this flag only says which one is primary.
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
    // §6: 21 is the only canonical declaration. Absent, 19, 20 and 99 are all legacy-era (U1, K2).
    legacy: declared !== FORMAT_MAX,
  };
}
