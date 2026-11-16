/**
 * Basic typed values (`architecture.md` §4.2, §5, §7.1; `format-coverage.md` P5, K4, K8).
 *
 * Five types, and only five, because these are the ones the specification actually defines:
 *
 * | Type | Encoding | Rule |
 * |---|---|---|
 * | `string` | quoted, **no escaping** | remove one surrounding quote pair, change nothing else |
 * | `escaped` | quoted, `\Q` `\q` `\\` `\t` `\n` | remove the quotes, then apply the escape table |
 * | `boolean` | `1` / `0` | anything else is an invalid value, never a truthy guess (K8) |
 * | `integer` | strict decimal | no float, no hex, no exponent; must be a JS safe integer |
 * | `complex` | comma-separated, quote-aware | tokenised by `syntax/complex.ts`, **not** decoded |
 *
 * Three invariants hold for every decoded value, and they are the reason `Value<T>` exists
 * rather than a bare primitive (§4.2):
 *
 * - `value` is the interpretation and `raw` is the exact source text — the two never collapse;
 * - `origin` says whether the file declared it or the spec supplied a default;
 * - `span` points at the line the token came from, so no value is anonymous.
 *
 * **Nothing is coerced.** A `boolean` that is neither `1` nor `0`, and an `integer` that is not
 * a safe decimal integer, produce an `InvalidValue` carrying the reason, the raw text and the
 * span. There is no diagnostic code for a bad token in §11's closed enum and inventing one is
 * out of scope, so the invalid outcome is a typed record instead of a silent default: it cannot
 * be mistaken for data, and the validator stage can turn it into a diagnostic once a code is
 * agreed.
 *
 * Complex values are **tokenised here and positionally decoded elsewhere**. What this module
 * returns is the element list plus `trailingElementsOmitted`; `field.ts`, `indexinfo.ts` and
 * `position.ts` turn those elements into columns, indexes and geometry by the section they appeared
 * in (§7.2, P7, P8, P11). Tokenising once, in one place, is what keeps `S_COMPLEX_UNTERMINATED_QUOTE`
 * reported exactly once per value.
 */

import { splitComplex } from '../syntax/complex.js';
import type { ComplexPart } from '../syntax/complex.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';

/** The five basic types of §5's `KeySpec`. */
export type ValueType = 'string' | 'escaped' | 'boolean' | 'integer' | 'complex';

/** §4.2: where a value came from. `inferred` belongs to the resolver, not this stage. */
export type Origin = 'declared' | 'defaulted';

/** §4.2: every interpreted value carries its origin, its raw text and its span. */
export interface Value<T> {
  readonly value: T;
  readonly origin: Origin;
  /** Exact source text of the value; `''` when `origin !== 'declared'`. */
  readonly raw: string;
  /** The key line the token sat on; `null` only for a defaulted value. */
  readonly span: Span | null;
}

/** A Complex value after tokenisation: elements and the omitted-tail flag (§7.1). */
export interface ComplexValue {
  readonly parts: readonly ComplexPart[];
  readonly trailingElementsOmitted: boolean;
}

/** What a basic type can decode to. `unknown` is never `any` (L1). */
export type DecodedValue = string | number | boolean | ComplexValue;

export type InvalidReason = 'not-a-boolean' | 'not-an-integer' | 'integer-out-of-range';

/** A declared token the type could not decode. Traceable, never silently coerced. */
export interface InvalidValue {
  readonly reason: InvalidReason;
  /** The token exactly as written. */
  readonly raw: string;
  readonly span: Span;
}

export type DecodeOutcome =
  | {
      readonly ok: true;
      readonly value: Value<DecodedValue>;
      /** Diagnostics about the value itself, e.g. an unterminated quote in a Complex value. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly invalid: InvalidValue;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Remove **one** pair of surrounding double quotes, and nothing else.
 *
 * The format quotes scalar strings (`PName="users"`), so the interpreter's value excludes the
 * quotes while `raw` keeps them (§4.2's own example). An unterminated quote is left alone:
 * repairing it would be invented data, and `raw` is what a consumer falls back to.
 */
export function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

/** `\Q` → `"`, `\q` → `'`, `\\` → `\`, `\t` → TAB, `\n` → LF; anything else survives as written. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['Q', '"'],
  ['q', "'"],
  ['\\', '\\'],
  ['t', '\t'],
  ['n', '\n'],
]);

/**
 * Apply the escape table of §7.1 / P5, in one left-to-right pass.
 *
 * One pass, not repeated replacement: `\\Q` is a backslash followed by `Q`, so it must decode to
 * `\Q` and never to `\"`. An unknown escape such as `\x` keeps both characters — the spec defines
 * only five sequences, and dropping a backslash we do not understand would corrupt the value.
 */
export function unescapeEscaped(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      result += char;
      continue;
    }
    const replacement = ESCAPES.get(next);
    if (replacement === undefined) {
      result += char + next;
      index += 1;
      continue;
    }
    result += replacement;
    index += 1;
  }
  return result;
}

/** `1` → `true`, `0` → `false`, anything else → `null` (never a truthy guess; K8). */
export function decodeBoolean(raw: string): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

export type IntegerOutcome =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: 'not-an-integer' | 'integer-out-of-range' };

/** Strict decimal integer: optional `-`, digits, no leading zero, no float, hex or exponent. */
const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/;

/**
 * Decode an integer token (`P8`'s ordinals, `RelationType1`'s 0–5, K8's `DecodeDomain`).
 *
 * Two distinct failures, because they mean different things: `not-an-integer` is a token that is
 * not a decimal integer at all, `integer-out-of-range` is one that is but that JavaScript cannot
 * hold exactly (`Number.MAX_SAFE_INTEGER`). Both are reported, neither is rounded.
 */
export function decodeInteger(raw: string): IntegerOutcome {
  if (!INTEGER_PATTERN.test(raw)) return { ok: false, reason: 'not-an-integer' };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'integer-out-of-range' };
  return { ok: true, value };
}

/** Decode one token by its declared type (§5's `KeySpec.type`). */
export function decodeValue(type: ValueType, raw: string, span: Span): DecodeOutcome {
  switch (type) {
    case 'string':
      return {
        ok: true,
        value: { value: unquote(raw), origin: 'declared', raw, span },
        diagnostics: [],
      };
    case 'escaped':
      return {
        ok: true,
        value: { value: unescapeEscaped(unquote(raw)), origin: 'declared', raw, span },
        diagnostics: [],
      };
    case 'boolean': {
      const flag = decodeBoolean(raw);
      if (flag === null) {
        return { ok: false, invalid: { reason: 'not-a-boolean', raw, span }, diagnostics: [] };
      }
      return { ok: true, value: { value: flag, origin: 'declared', raw, span }, diagnostics: [] };
    }
    case 'integer': {
      const decoded = decodeInteger(raw);
      if (!decoded.ok) {
        return {
          ok: false,
          invalid: { reason: decoded.reason, raw, span },
          diagnostics: [],
        };
      }
      return {
        ok: true,
        value: { value: decoded.value, origin: 'declared', raw, span },
        diagnostics: [],
      };
    }
    case 'complex': {
      // Tokenisation only: which elements mean what is per-section (§7.2) and not this stage's.
      const parts = splitComplex(raw, span);
      return {
        ok: true,
        value: {
          value: { parts: parts.parts, trailingElementsOmitted: parts.trailingElementsOmitted },
          origin: 'declared',
          raw,
          span,
        },
        diagnostics: parts.diagnostics,
      };
    }
  }
}

/**
 * The declared text of one Complex element: its quotes restored, its outside padding gone.
 *
 * `ComplexPart.value` is the element *content* (§7.1), so a quoted element loses its delimiters and
 * an unquoted one loses the spaces that separated it. `raw` has to be the token as written, so the
 * quotes are put back from the `quoted` flag. Padding is not restored because §7.1 defines it as
 * padding rather than data — the whole line is still preserved verbatim by the scanner, so nothing
 * is lost by not repeating it here.
 */
export function partRaw(part: ComplexPart): string {
  return part.quoted ? `"${part.value}"` : part.value;
}

/**
 * One positional element as a declared value, or `null` when the value stopped before it.
 *
 * `null` means "the writer did not emit this slot", which is different from an empty element: an
 * empty slot is `""` or nothing between two commas and still occupies its position, while a short
 * value simply has no element there (§7.1's "elements may be empty or quoted-empty"). Callers keep
 * the difference: a missing required element is a defect, an empty one is data.
 */
export function elementAt(
  parts: readonly ComplexPart[],
  index: number,
  span: Span,
): Value<string> | null {
  const part = parts[index];
  if (part === undefined) return null;
  return { value: part.value, origin: 'declared', raw: partRaw(part), span };
}

/** An empty string value that the format's tail defaulting supplies, not the file. */
export function emptyDefault(): Value<string> {
  return { value: '', origin: 'defaulted', raw: '', span: null };
}

/**
 * Wrap a documented default (§4.2 `origin: 'defaulted'`).
 *
 * Raw is empty and the span is `null` on purpose: nothing in the file said this, so a consumer
 * that shows the value can say so instead of pretending it was declared.
 */
export function defaultValue(value: DecodedValue): Value<DecodedValue> {
  return { value, origin: 'defaulted', raw: '', span: null };
}
