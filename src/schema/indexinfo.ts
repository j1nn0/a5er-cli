/**
 * `IndexInfo`, and the legacy `Index`/`IndexOption` it replaced (`architecture.md` §6, F2;
 * `format-coverage.md` P8, U7, D5/L6).
 *
 * ## The canonical spelling — documented, four elements
 *
 * `IndexInfo = "インデックス名",ユニークフラグ,"カラムリスト","インデックスオプション"`
 *
 * - ユニークフラグ is `0` non-unique, `1` unique, `2` unique constraint (P8). All three are
 *   documented, so the enum below has three values and nothing is inferred beyond them.
 * - カラムリスト is a **comma-separated list inside one quoted element**. That is the whole reason
 *   F3 exists: `"user_name,birthday"` is one token and two columns (val-02), and a naive
 *   `split(',')` on the raw value would produce three elements and a broken index.
 * - インデックスオプション is DDL text, kept verbatim and never parsed.
 *
 * ## The legacy spelling — observed, not documented (U7)
 *
 * A `FORMAT:19` file writes `Index=<name>=<flag>,<col>,<col>` and an `IndexOption`. The shape is
 * *observable* (`fmt-02`, `sem-04`, `[aux v2.20]`), not specified: the v2.21 document only says to
 * ignore those keys. So the decoder recognises the observed shape and marks it as such, and a
 * payload that does not match keeps its raw text with `shape: 'unrecognised'` — no fields are
 * invented for a grammar nobody wrote down.
 *
 * ## The F2 gate — interpretation, never erasure
 *
 * Both spellings are decoded in **every** profile (§6's closing sentence); the profile only decides
 * which one is `primary` and which is `compatibility`. That is the downstream difference the
 * profiles are for, and it is what the R18 table asserts.
 */

import type { Span } from '../model/span.js';
import type { FormatProfile } from './profiles.js';
import type { ComplexValue, Value } from './values.js';
import { elementAt, emptyDefault, unescapeEscaped } from './values.js';

/** The documented ユニークフラグ values (P8). */
export type Uniqueness = 'non-unique' | 'unique' | 'unique-constraint';

/** How an index record relates to the profile it was read under (§6). */
export type IndexRole = 'primary' | 'compatibility';

/** One decoded canonical `IndexInfo` (P8). */
export interface DecodedIndexInfo {
  /** インデックス名, escapes applied. */
  readonly name: Value<string>;
  /** ユニークフラグ, or `null` when the token is not one of `0`/`1`/`2`. */
  readonly uniqueness: Value<Uniqueness> | null;
  /** The declared flag text, so an unexpected value stays visible next to the `null`. */
  readonly uniquenessToken: string | null;
  /** Ordered column names, split from the single quoted list (never from the raw value). */
  readonly columns: readonly Value<string>[];
  /** インデックスオプション: DDL text, verbatim. */
  readonly option: Value<string>;
  /** Elements the writer emitted (the documented shape has 4). */
  readonly elementsSeen: number;
  /** The whole value text as written. */
  readonly raw: string;
  readonly span: Span;
}

/**
 * One decoded legacy `Index` (U7).
 *
 * `shape` is the honest part: `observed` means the payload matched
 * `<name>=<flag>,<cols…>`, `unrecognised` means it did not and only `payload` is claimed.
 */
export interface DecodedLegacyIndex {
  readonly shape: 'observed' | 'unrecognised';
  /** The name before the first `=`, or `null` for an unrecognised payload. */
  readonly name: Value<string> | null;
  /** The flag element, or `null` when it is absent or not one of `0`/`1`/`2`. */
  readonly uniqueness: Value<Uniqueness> | null;
  readonly columns: readonly Value<string>[];
  /** The payload exactly as written, always present. */
  readonly payload: Value<string>;
  readonly raw: string;
  readonly span: Span;
}

/**
 * A legacy `IndexOption`.
 *
 * Its payload is not documented anywhere (U7), so nothing is decoded: the record exists so the data
 * is addressable rather than dropped.
 */
export interface DecodedIndexOption {
  readonly shape: 'undocumented';
  readonly payload: Value<string>;
  readonly raw: string;
  readonly span: Span;
}

/** Every index record of one section, with the role the profile gives each spelling. */
export interface DecodedIndexes {
  readonly canonical: readonly (DecodedIndexInfo & { readonly role: IndexRole })[];
  readonly legacy: readonly (DecodedLegacyIndex & { readonly role: IndexRole })[];
  readonly legacyOptions: readonly (DecodedIndexOption & { readonly role: IndexRole })[];
  /**
   * The spelling this profile treats as the index source (§6): `legacy` for everything except
   * `21`, `canonical` for `21`.
   *
   * It is the *profile's* preference, not a statement about what the file contains — a `FORMAT:21`
   * file with only a legacy `Index` still has `primarySource: 'canonical'`, and the validator is
   * what reports that the only index data is legacy (`V_INDEX_LEGACY_ONLY`, §6).
   */
  readonly primarySource: 'canonical' | 'legacy';
}

/** The three documented flag values, and nothing else (P8). */
function readUniqueness(token: string): Uniqueness | null {
  switch (token) {
    case '0':
      return 'non-unique';
    case '1':
      return 'unique';
    case '2':
      return 'unique-constraint';
    default:
      return null;
  }
}

/** Split the one quoted column list into its declared names; escapes apply to each name. */
function splitColumns(list: string, span: Span): Value<string>[] {
  if (list === '') return [];
  return list.split(',').map((name) => ({
    value: unescapeEscaped(name),
    origin: 'declared' as const,
    raw: name,
    span,
  }));
}

/**
 * Decode one canonical `IndexInfo`.
 *
 * Missing elements keep the `Field` convention: `null` where a required slot is absent, an empty
 * defaulted value where the documented tail is simply not written. No `S_` code is raised here —
 * §11 defines arity warnings for `Field`, not for `IndexInfo`, and inventing one would be a new
 * contract.
 */
export function decodeIndexInfo(parts: ComplexValue, span: Span, raw: string): DecodedIndexInfo {
  const name = elementAt(parts.parts, 0, span);
  const flag = elementAt(parts.parts, 1, span);
  const list = elementAt(parts.parts, 2, span);
  const option = elementAt(parts.parts, 3, span);
  const uniqueness = flag === null ? null : readUniqueness(flag.value);

  return {
    name: name === null ? emptyDefault() : { ...name, value: unescapeEscaped(name.value) },
    uniqueness:
      uniqueness === null || flag === null
        ? null
        : { value: uniqueness, origin: 'declared', raw: flag.raw, span },
    uniquenessToken: flag?.value ?? null,
    columns: splitColumns(list?.value ?? '', span),
    option: option === null ? emptyDefault() : { ...option, value: unescapeEscaped(option.value) },
    elementsSeen: parts.parts.length,
    raw,
    span,
  };
}

/**
 * Decode one legacy `Index` value (`<name>=<flag>,<cols…>`, observed shape).
 *
 * The payload is split on the **first** `=` only — the same rule the scanner applies to a key line,
 * and for the same reason: a name may contain anything the writer allowed. Everything that does not
 * match the observed grammar is reported as `unrecognised` with the payload intact.
 */
export function decodeLegacyIndex(raw: string, span: Span): DecodedLegacyIndex {
  const payload: Value<string> = { value: raw, origin: 'declared', raw, span };
  const equals = raw.indexOf('=');
  if (equals <= 0)
    return { shape: 'unrecognised', name: null, uniqueness: null, columns: [], payload, raw, span };

  const name: Value<string> = {
    value: unescapeEscaped(raw.slice(0, equals)),
    origin: 'declared',
    raw: raw.slice(0, equals),
    span,
  };
  const [flag = '', ...columns] = raw.slice(equals + 1).split(',');
  const uniqueness = readUniqueness(flag);

  return {
    shape: 'observed',
    name,
    uniqueness:
      uniqueness === null ? null : { value: uniqueness, origin: 'declared', raw: flag, span },
    columns: splitColumns(columns.join(','), span),
    payload,
    raw,
    span,
  };
}

/** Keep one `IndexOption` addressable without pretending its grammar is known (U7). */
export function decodeIndexOption(raw: string, span: Span): DecodedIndexOption {
  return {
    shape: 'undocumented',
    payload: { value: raw, origin: 'declared', raw, span },
    raw,
    span,
  };
}

/**
 * Assemble a section's index data and label each spelling with the role the profile gives it.
 *
 * `primarySource` is the profile's answer to "which index source is primary" — `legacy` for every
 * profile except `21`, where the canonical spelling is (`§6`, R18). It is *not* a decision about
 * which records exist: both lists keep whatever the file wrote.
 */
export function indexesOf(
  canonical: readonly DecodedIndexInfo[],
  legacy: readonly DecodedLegacyIndex[],
  legacyOptions: readonly DecodedIndexOption[],
  profile: FormatProfile,
): DecodedIndexes {
  const canonicalRole: IndexRole = profile.legacy ? 'compatibility' : 'primary';
  const legacyRole: IndexRole = profile.legacy ? 'primary' : 'compatibility';

  return {
    canonical: canonical.map((index) => ({ ...index, role: canonicalRole })),
    legacy: legacy.map((index) => ({ ...index, role: legacyRole })),
    legacyOptions: legacyOptions.map((option) => ({ ...option, role: legacyRole })),
    primarySource: profile.legacy ? 'legacy' : 'canonical',
  };
}
