/**
 * `Field` — the positional column value (`architecture.md` §7.2, F4; `format-coverage.md` P7).
 *
 * `Field` is the only key whose shape the specification states element by element:
 *
 * | # | Meaning | Type | Required |
 * |---|---|---|---|
 * | 1 | 論理名 — logical name | quoted string | |
 * | 2 | 物理名 — physical name | quoted string | |
 * | 3 | データ型 — a type, a user domain or an `@` system domain | quoted string | |
 * | 4 | `NOT NULL` or empty | literal / empty | |
 * | 5 | キー順 — a **0-based** PK ordinal, or empty | bare integer | |
 * | 6 | デフォルト値 | expression, quoted or empty | |
 * | 7 | コメント | quoted, escaped | |
 * | 8 | 色 | colour token | **yes** |
 * | 9 | オプション — appended to the column DDL | quoted string | |
 * | 10 | 追加オプション — `DISABLE`, and a future comma-separated tail | quoted string | |
 *
 * What this module decides, and what it deliberately does not:
 *
 * - **Positional with tail defaults (F4).** 8, 9 and 10+ elements are all accepted; a slot the
 *   writer did not emit comes back as `origin: 'defaulted'` with empty raw, so a consumer can tell
 *   "not written" from "written empty". The specification's own 9-element sample (K3) is a legal
 *   shape, not a defect.
 * - **Element 8 is required.** When the value has fewer than 8 elements, `color` is `null` and
 *   `S_FIELD_TOO_FEW_ELEMENTS` is reported for the key's span (§7.2). The colour is *not* defaulted
 *   and *not* invented — a null plus a warning is the honest representation. An element 8 that is
 *   present but empty is data (the writer did emit the slot), not a missing element, so it does not
 *   trigger the arity warning; whether an empty colour is acceptable is a validation question.
 * - **Eleven or more elements are extended, never truncated.** Element 10 keeps its meaning and
 *   every element after it is appended to `additionalOption` as the declared comma-joined tail, with
 *   `S_FIELD_TOO_MANY_ELEMENTS` reported (§7.2: "more than 10 extends `additionalOption` … never a
 *   rejection").
 * - **キー順 is kept as declared.** Element 5 is the declared PK ordinal. Inferring a primary key
 *   from it is *synthesis* (`§9.2`, `origin: 'inferred'`) and belongs to the resolver, so this
 *   module neither sorts nor assembles a key.
 * - **Escapes are applied, once.** Elements are quoted Complex elements, so the `\Q` `\q` `\\` `\t`
 *   `\n` table of §7.1 / P5 applies to their text. The tokeniser has already run (it is the only
 *   place `splitComplex` is called, so an unterminated quote is reported exactly once); this module
 *   consumes its output and never re-splits.
 * - **No `ResolvedColumn`.** §7.2's sketch returns one, but that type belongs to the resolved model
 *   (§4.7) and carries resolved types, constraints and effective columns. What is produced here is
 *   the typed column *as declared*, which is what the resolver will consume.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { emitSyntax } from '../diagnostics/diagnostic.js';
import type { Span } from '../model/span.js';
import { elementAt, emptyDefault, partRaw, unescapeEscaped } from './values.js';
import type { ComplexValue, Value } from './values.js';

/** Element 8 (色) is required, so a value with fewer elements cannot describe a column (§7.2). */
export const FIELD_MIN_ELEMENTS = 8;

/** The format defines ten elements; more are accepted and extended (§7.2). */
export const FIELD_MAX_ELEMENTS = 10;

/** `NOT NULL` element: the literal, or empty. */
export type NotNullToken = 'not-null' | 'nullable' | 'unrecognised';

/** One `Field` value, decoded positionally. */
export interface DecodedField {
  /** How many elements the writer emitted, before any defaulting (U15: answerable from output). */
  readonly elementsSeen: number;
  /** 論理名 (element 1), escapes applied. */
  readonly logicalName: Value<string>;
  /** 物理名 (element 2), escapes applied. */
  readonly physicalName: Value<string>;
  /**
   * データ型 (element 3), verbatim after unescaping.
   *
   * Not resolved: a real type, a user domain name and an `@`-system domain are all just text at
   * this stage (§P7, P12).
   */
  readonly dataType: Value<string>;
  /** Element 4 as the literal it has to be; `unrecognised` keeps a foreign token traceable. */
  readonly notNull: Value<boolean>;
  /** How element 4 was written, so `notNull === false` is not ambiguous. */
  readonly notNullToken: NotNullToken;
  /** キー順 (element 5) as the declared ordinal, or `null` when the slot is empty or unrecognised. */
  readonly keyOrder: Value<number> | null;
  /** How element 5 was written, so a null ordinal is never ambiguous. */
  readonly keyOrderToken: KeyOrderToken;
  /** デフォルト値 (element 6): an expression, never evaluated. */
  readonly defaultValue: Value<string>;
  /** コメント (element 7), escapes applied. */
  readonly comment: Value<string>;
  /** 色 (element 8), or `null` when it is missing — never invented (§7.2). */
  readonly color: Value<string> | null;
  /** オプション (element 9): DDL text, not interpreted. */
  readonly option: Value<string>;
  /** 追加オプション (element 10) plus any declared tail, comma-joined and kept verbatim. */
  readonly additionalOption: Value<string>;
  /** The whole value text as written. */
  readonly raw: string;
  readonly span: Span;
}

export interface FieldDecode {
  readonly field: DecodedField;
  readonly diagnostics: readonly Diagnostic[];
}

/** Element text with the §7.1 escape table applied (quoted Complex elements are escaped). */
function text(element: Value<string> | null): Value<string> {
  if (element === null) return emptyDefault();
  return { ...element, value: unescapeEscaped(element.value) };
}

/** Element 4: `NOT NULL` is a literal, not a boolean the writer computes. */
function readNotNull(element: Value<string> | null): {
  value: Value<boolean>;
  token: NotNullToken;
} {
  if (element === null) {
    return {
      value: { value: false, origin: 'defaulted', raw: '', span: null },
      token: 'nullable',
    };
  }
  if (element.value === 'NOT NULL') {
    return {
      value: { value: true, origin: 'declared', raw: element.raw, span: element.span },
      token: 'not-null',
    };
  }
  if (element.value === '') {
    return {
      value: { value: false, origin: 'declared', raw: element.raw, span: element.span },
      token: 'nullable',
    };
  }
  // A token that is neither the literal nor empty is not coerced to `false`: it is kept verbatim
  // and flagged as unrecognised, so a consumer never reads an invention as data.
  return {
    value: { value: false, origin: 'declared', raw: element.raw, span: element.span },
    token: 'unrecognised',
  };
}

/** How element 5 was written; `unrecognised` keeps a foreign token visible instead of dropping it. */
export type KeyOrderToken = 'ordinal' | 'empty' | 'unrecognised';

/** Element 5: a `0`-based ordinal or empty (`§P8`); anything else is kept as unrecognised. */
function readKeyOrder(element: Value<string> | null): {
  value: Value<number> | null;
  token: KeyOrderToken;
} {
  if (element === null || element.value === '') return { value: null, token: 'empty' };
  if (!/^(?:0|[1-9]\d*)$/.test(element.value)) return { value: null, token: 'unrecognised' };
  return { value: { ...element, value: Number(element.value) }, token: 'ordinal' };
}

/**
 * Decode one `Field` value.
 *
 * `parts` is the tokeniser's output for this value and `raw` is the value text as written, so the
 * two can never disagree; the caller passes the key's span and every element inherits it (§7.2's
 * "one key line, one span").
 */
export function decodeField(parts: ComplexValue, span: Span, raw: string): FieldDecode {
  const elements = parts.parts;
  const elementsSeen = elements.length;
  const diagnostics: Diagnostic[] = [];

  if (elementsSeen < FIELD_MIN_ELEMENTS) {
    diagnostics.push(
      emitSyntax('S_FIELD_TOO_FEW_ELEMENTS', {
        details: { elements: elementsSeen, required: FIELD_MIN_ELEMENTS },
        span,
        construct: 'Field',
      }),
    );
  }
  if (elementsSeen > FIELD_MAX_ELEMENTS) {
    diagnostics.push(
      emitSyntax('S_FIELD_TOO_MANY_ELEMENTS', {
        details: { elements: elementsSeen, defined: FIELD_MAX_ELEMENTS },
        span,
        construct: 'Field',
      }),
    );
  }

  const element = (index: number): Value<string> | null => elementAt(elements, index, span);
  const notNull = readNotNull(element(3));
  const keyOrder = readKeyOrder(element(4));

  // Element 10 keeps its meaning; the remainder is the declared tail, comma-joined, never dropped.
  // `raw` is the tail as written (quotes restored), `value` is its unescaped text: the two are
  // different things whenever the writer quoted or escaped anything, and merging them would put
  // the quote characters into the value a consumer reads.
  const tail = elements.slice(FIELD_MAX_ELEMENTS - 1);
  const additionalOption: Value<string> =
    tail.length === 0
      ? emptyDefault()
      : {
          value: tail.map((part) => unescapeEscaped(part.value)).join(','),
          origin: 'declared',
          raw: tail.map(partRaw).join(','),
          span,
        };

  const field: DecodedField = {
    elementsSeen,
    logicalName: text(element(0)),
    physicalName: text(element(1)),
    dataType: text(element(2)),
    notNull: notNull.value,
    notNullToken: notNull.token,
    keyOrder: keyOrder.value,
    keyOrderToken: keyOrder.token,
    defaultValue: text(element(5)),
    comment: text(element(6)),
    color: element(7) === null ? null : text(element(7)),
    option: text(element(8)),
    additionalOption,
    raw,
    span,
  };

  return { field, diagnostics };
}
