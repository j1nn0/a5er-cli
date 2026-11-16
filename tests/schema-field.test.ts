/**
 * `schema/field.ts` — positional `Field` decoding (`architecture.md` §7.2, F4;
 * `format-coverage.md` P7, K3, K9).
 *
 * Every expectation below is read off the fixture line it names, not off the decoder: the element
 * counts are counted in the file, the escapes are the ones P5 defines, and the arity diagnostics are
 * the ones §7.2/§11 state. The important non-assertions are as deliberate as the assertions — no
 * `primaryKey` is expected anywhere, because キー順 is *declared* here and only *synthesised* into a
 * key by the resolver (`§9.2`).
 */

import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import { decodePosition } from '../src/schema/position.js';
import type { Classification } from '../src/schema/registry.js';
import type { DecodedField } from '../src/schema/field.js';
import { scanSource } from '../src/syntax/scanner.js';
import { splitComplex } from '../src/syntax/complex.js';
import type { Span } from '../src/model/span.js';
import { assertCodes } from './helpers/assert-codes.js';
import { stage } from './helpers/stage.js';

const CLASSIFICATIONS = new Map<string, Classification>();

function classificationOf(id: string): Classification {
  const cached = CLASSIFICATIONS.get(id);
  if (cached !== undefined) return cached;
  const staged = stage(id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    const classification = classify(scanSource(outcome.source));
    CLASSIFICATIONS.set(id, classification);
    return classification;
  } finally {
    staged.cleanup();
  }
}

/** Every decoded `Field` of a fixture, in file order across its `[Entity]` sections. */
function fieldsOf(id: string): DecodedField[] {
  return classificationOf(id).sections.flatMap((section) => section.decoded.fields);
}

/** The one `Field` at `line`. */
function fieldAt(id: string, line: number): DecodedField {
  const found = fieldsOf(id).find((field) => field.span.keyLine === line);
  if (found === undefined) throw new Error(`${id} has no Field at line ${String(line)}`);
  return found;
}

describe('a ten-element Field decodes every documented element (fmt-01)', () => {
  const field = fieldAt('fmt-01', 11);

  it('reads the elements by position, with their declared text', () => {
    expect(field.elementsSeen).toBe(10);
    expect(field.logicalName.value).toBe('ユーザーID');
    expect(field.physicalName.value).toBe('id');
    expect(field.dataType.value).toBe('Serial');
    expect(field.notNull?.value).toBe(true);
    expect(field.notNullToken).toBe('not-null');
    expect(field.keyOrder?.value).toBe(0);
    expect(field.keyOrderToken).toBe('ordinal');
    expect(field.defaultValue.value).toBe('');
    expect(field.comment.value).toBe('主キー');
    expect(field.color?.value).toBe('$FFFFFFFF');
    expect(field.option.value).toBe('');
    expect(field.additionalOption.value).toBe('');
    expect(field.additionalOption.raw).toBe('""');
  });

  it('keeps value and raw apart, and every element on the key line', () => {
    // The declared text keeps the quotes the tokeniser stripped from the value (§7.1, §4.2).
    expect(field.physicalName.raw).toBe('"id"');
    expect(field.physicalName.value).toBe('id');
    expect(field.color?.raw).toBe('$FFFFFFFF');
    // Every element inherits the key's span (§7.2's "one key line, one span").
    for (const element of [
      field.logicalName,
      field.physicalName,
      field.dataType,
      field.notNull,
      field.defaultValue,
      field.comment,
      field.color,
      field.option,
      field.additionalOption,
    ]) {
      expect(element?.span).toEqual({
        sectionIndex: 2,
        startLine: 11,
        endLine: 11,
        keyLine: 11,
      });
      expect(element?.origin).toBe('declared');
    }
  });

  it('does not synthesise a primary key from キー順', () => {
    // The ordinal is declared; assembling `primaryKey` is resolution (`origin: 'inferred'`, §9.2).
    expect(field.keyOrder?.value).toBe(0);
    expect(field.keyOrder?.origin).toBe('declared');
    expect('primaryKey' in field).toBe(false);
  });
});

describe('element counts the specification allows (§7.2, K3)', () => {
  it('accepts 9 elements without a word: the spec’s own sample shape (val-03)', () => {
    const classification = classificationOf('val-03');
    const field = fieldAt('val-03', 5);

    expect(field.elementsSeen).toBe(9);
    expect(field.color?.value).toBe('$FFFFFFFF');
    expect(field.option.value).toBe('');
    // Element 10 was not written, so its value is *defaulted*, not declared-empty.
    expect(field.additionalOption).toMatchObject({ value: '', origin: 'defaulted', raw: '' });
    expect(field.additionalOption.span).toBeNull();
    expect(classification.diagnostics).toEqual([]);
  });

  it('accepts 8 elements: the last slot is simply not written (synthetic edge)', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="eight"\nField="L","p","Integer","",0,"","",$FFFFFFFF\n',
      format: 21,
    });
    const classification = classify(scan);
    const field = classification.sections[0]?.decoded.fields[0];

    expect(field?.elementsSeen).toBe(8);
    expect(field?.color?.value).toBe('$FFFFFFFF');
    expect(field?.option).toMatchObject({ value: '', origin: 'defaulted' });
    expect(classification.diagnostics).toEqual([]);
  });

  it('reports a missing colour and keeps it null instead of inventing one (val-05)', () => {
    const classification = classificationOf('val-05');
    const field = fieldAt('val-05', 5);

    expect(field.elementsSeen).toBe(7);
    // `色` is required (§P7): the seventh element ends the value, so element 8 is absent.
    expect(field.color).toBeNull();
    expect(field.comment.value).toBe('コメント');
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_FIELD_TOO_FEW_ELEMENTS'],
    );
    expect(classification.diagnostics[0]?.severity).toBe('warning');
    expect(classification.diagnostics[0]?.details).toEqual({ elements: 7, required: 8 });
    expect(classification.diagnostics[0]?.span).toEqual({
      sectionIndex: 1,
      startLine: 5,
      endLine: 5,
      keyLine: 5,
    });
  });

  it('extends an 11-element Field into additionalOption and reports the excess (val-04)', () => {
    const classification = classificationOf('val-04');
    const field = fieldAt('val-04', 8);

    expect(field.elementsSeen).toBe(11);
    // Element 9 is the (empty) オプション slot; elements 10 and 11 are the declared tail, kept
    // whole and never truncated (§7.2), with raw and value kept apart.
    expect(field.option.value).toBe('');
    expect(field.additionalOption.value).toBe('オプション,追加事項');
    expect(field.additionalOption.raw).toBe('"オプション","追加事項"');
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_FIELD_TOO_MANY_ELEMENTS'],
    );
    expect(classification.diagnostics[0]?.details).toEqual({ elements: 11, defined: 10 });
  });

  it('keeps a far-future tail addressable beyond eleven elements', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="long"\nField="L","p","Integer","",0,"","",$FFFFFFFF,"","a","b","c"\n',
      format: 21,
    });
    const classification = classify(scan);
    const field = classification.sections[0]?.decoded.fields[0];

    // Elements 10, 11 and 12 are the tail: three values, not a dropped remainder.
    expect(field?.elementsSeen).toBe(12);
    expect(field?.additionalOption.value).toBe('a,b,c');
    expect(field?.additionalOption.raw).toBe('"a","b","c"');
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_FIELD_TOO_MANY_ELEMENTS'],
    );
    expect(classification.completeness.keys).toEqual({ total: 2, parsed: 2, preservedRaw: 0 });
  });
});

describe('element meaning (§P7)', () => {
  it('treats an empty キー順 as “not part of the key”, not as 0 (fmt-01 second column)', () => {
    const field = fieldAt('fmt-01', 12);

    expect(field.keyOrder).toBeNull();
    expect(field.keyOrderToken).toBe('empty');
    expect(field.color?.value).toBe('$FFFFFFFF');
  });

  it('keeps a composite key’s declared ordinals in declaration order (val-06)', () => {
    const fields = fieldsOf('val-06');

    expect(fields).toHaveLength(3);
    expect(fields.map((field) => field.keyOrder?.value)).toEqual([0, 1, 2]);
    expect(fields.map((field) => field.physicalName.value)).toEqual([
      'user_id',
      'group_id',
      'role',
    ]);
    // The third column is nullable: `""` in element 4 is a declared empty, not a missing element.
    expect(fields[2]?.notNull?.value).toBe(false);
    expect(fields[2]?.notNullToken).toBe('nullable');
    expect(fields[2]?.notNull?.raw).toBe('""');
    expect(fields[2]?.notNullRaw).toBe('""');
  });

  it('keeps a gapped ordinal as declared and does not repair it (val-09)', () => {
    // 0 and 2: `V_PK_ORDER_CONFLICT` is the validator's finding, not this stage's.
    expect(fieldsOf('val-09').map((field) => field.keyOrder?.value)).toEqual([0, 2]);
  });

  it('applies the escape table to the comment element (val-01, P5)', () => {
    const field = fieldAt('val-01', 6);

    expect(field.comment.value).toBe('コメント"付き');
    expect(field.comment.raw).toBe('"コメント\\Q付き"');
    expect(field.physicalName.value).toBe('phys');
  });

  it('keeps colour tokens verbatim, including the ambiguous lengths (val-07, K10)', () => {
    // K10: the channel order and the length are unresolved, so the token is stored, not normalised.
    expect(fieldsOf('val-07').map((field) => field.color?.value)).toEqual([
      '$FFFFFFFF',
      '$0000FF',
      '$1234567',
    ]);
  });

  it('keeps a broken ninth element as the option, verbatim (val-11)', () => {
    const field = fieldAt('val-11', 8);

    expect(field.elementsSeen).toBe(9);
    expect(field.color?.value).toBe('$FFFFFFFF');
    // The unterminated remainder is one element, quote included; the tokeniser reported it once.
    expect(field.option.value).toBe('"オプション未終端');
    expect(field.additionalOption.origin).toBe('defaulted');
  });
});

describe('Field decoding is wired into the classification without disturbing it', () => {
  it('counts every Field line as parsed and reconciles the document (val-04)', () => {
    const classification = classificationOf('val-04');

    expect(classification.completeness).toEqual({
      sections: { total: 2, parsed: 2, preservedRaw: 0 },
      keys: { total: 4, parsed: 4, preservedRaw: 0 },
      dropped: 0,
    });
    expect(classification.problems).toEqual([]);
  });

  it('produces one Field per Field line, in file order (sem-03)', () => {
    const classification = classificationOf('sem-03');
    const entities = classification.sections.filter((section) => section.kind === 'Entity');

    expect(entities.length).toBeGreaterThan(0);
    for (const entity of entities) {
      const fieldLines = entity.entries.filter(
        (entry) => entry.kind === 'parsed' && entry.occurrence.spec.key === 'Field',
      );
      expect(entity.decoded.fields).toHaveLength(fieldLines.length);
    }
  });

  it('does not decode a Field-shaped value outside [Entity]', () => {
    // `Field` is not a [View] key (`§P6`): such a line is preserved raw and never typed.
    const scan = scanSource({ text: '[View]\nPName="v"\nField="a","b"\n', format: 21 });
    const classification = classify(scan);
    const view = classification.sections[0];

    expect(view?.decoded.fields).toEqual([]);
    assertCodes(
      classification.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_UNKNOWN_KEY'],
    );
  });
});

describe('the tokeniser’s omitted-tail flag survives into this use (§7.1)', () => {
  it('distinguishes a trailing comma from an explicit quoted-empty element', () => {
    const explicit = splitComplex('"L","p","Integer","",0,"","",$FFFFFFFF,""');
    const omitted = splitComplex('"L","p","Integer","",0,"","",$FFFFFFFF,');

    expect(explicit.parts).toHaveLength(9);
    expect(explicit.trailingElementsOmitted).toBe(false);
    expect(omitted.parts).toHaveLength(9);
    expect(omitted.trailingElementsOmitted).toBe(true);
    // Field arity is decided by the element count (§7.2), so both are nine-element values — the
    // flag stays available for a consumer that wants to know how the last slot was written.
    expect(explicit.parts[8]?.quoted).toBe(true);
    expect(omitted.parts[8]?.quoted).toBe(false);
  });

  it('decodes a value with a trailing comma without inventing a tenth element', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nField="L","p","Integer","",0,"","",$FFFFFFFF,\n',
      format: 21,
    });
    const classification = classify(scan);
    const field = classification.sections[0]?.decoded.fields[0];

    expect(field?.elementsSeen).toBe(9);
    expect(field?.option.value).toBe('');
    expect(field?.additionalOption.origin).toBe('defaulted');
    expect(classification.diagnostics).toEqual([]);
  });
});

describe('the decoder never invents elements', () => {
  it('decodes the same value the tokeniser produced, element for element', () => {
    const scan = scanSource({
      text: '[Entity]\nPName="x"\nField="L","p","Integer","",0,"","",$FFFFFFFF,"opt"\n',
      format: 21,
    });
    const key = scan.sections[0]?.entries.find(
      (entry) => entry.kind === 'key' && entry.key === 'Field',
    );
    if (key === undefined || key.kind !== 'key') throw new Error('no Field line');
    const span: Span = { sectionIndex: 1, startLine: 3, endLine: 3, keyLine: 3 };
    const parts = splitComplex(key.value, span);
    const classification = classify(scan);
    const field = classification.sections[0]?.decoded.fields[0];

    expect(field?.elementsSeen).toBe(parts.parts.length);
    expect(parts.trailingElementsOmitted).toBe(false);
    expect(field?.option.value).toBe('opt');
    expect(field?.additionalOption.origin).toBe('defaulted');
  });
});

// ── R19–R21 regressions ────────────────────────────────────────────────────

/** Build a one-entity document whose single `Field` is `value`, and decode it. */
function fieldOf(value: string): DecodedField {
  const scan = scanSource({ text: `[Entity]\nPName="r"\nField=${value}\n`, format: 21 });
  const field = classify(scan).sections[0]?.decoded.fields[0];
  if (field === undefined) throw new Error(`no Field decoded for ${value}`);
  return field;
}

/** A ten-element Field value with `ordinal` in element 5. */
function withOrdinal(ordinal: string): string {
  return `"L","p","Integer","",${ordinal},"","",$FFFFFFFF,"",""`;
}

describe('R19 — numbers are decoded exactly, never rounded', () => {
  it('accepts MAX_SAFE_INTEGER and rejects one past it', () => {
    const safe = fieldOf(withOrdinal('9007199254740991'));
    expect(safe.keyOrder?.value).toBe(9007199254740991);
    expect(safe.keyOrderToken).toBe('ordinal');

    const unsafe = fieldOf(withOrdinal('9007199254740993'));
    // The naive `Number()` read would have published 9007199254740992.
    expect(unsafe.keyOrder).toBeNull();
    expect(unsafe.keyOrderToken).toBe('unrecognised');
    expect(unsafe.keyOrderRaw).toBe('9007199254740993');
  });

  it('rejects huge ordinals instead of returning Infinity or a rounded float', () => {
    for (const token of ['9999999999999999999999999999999999999999', '1e30', '1E3']) {
      const field = fieldOf(withOrdinal(token));
      expect(field.keyOrder, token).toBeNull();
      expect(field.keyOrderToken, token).toBe('unrecognised');
      expect(field.keyOrderRaw, token).toBe(token);
      // The declared value is still in the value text, so nothing was lost in the refusal.
      expect(field.raw, token).toContain(token);
    }
  });

  it('rejects malformed and negative ordinals', () => {
    for (const token of ['01', '+1', '1.5', '0x10', '-1', 'one']) {
      const field = fieldOf(withOrdinal(token));
      expect(field.keyOrder, token).toBeNull();
      expect(field.keyOrderToken, token).toBe('unrecognised');
      expect(field.keyOrderRaw, token).toBe(token);
    }
  });

  it('treats outside-quote padding as padding, not as a malformed number (§7.1)', () => {
    // The tokeniser strips it before the decoder runs; the ordinal is `0`, not `" 0"`.
    expect(fieldOf(withOrdinal(' 0 ')).keyOrder?.value).toBe(0);
  });

  it('keeps an empty ordinal distinguishable from an unusable one', () => {
    expect(fieldOf(withOrdinal('')).keyOrderToken).toBe('empty');
    expect(fieldOf(withOrdinal('')).keyOrderRaw).toBe('');
    expect(fieldOf(withOrdinal('nope')).keyOrderToken).toBe('unrecognised');
  });

  it('decodes position numbers exactly and keeps the unsafe token visible', () => {
    const scan = scanSource({
      text:
        '[Entity]\nPName="p"\nPosition="Main",9007199254740991,-9007199254740993\n' +
        'Position="Main",9999999999999999999999999999999999999999,10\n',
      format: 21,
    });
    const positions = classify(scan).sections[0]?.decoded.positions ?? [];
    const first = positions[0];
    const second = positions[1];
    if (first?.kind !== 'object' || second?.kind !== 'object') throw new Error('expected objects');

    expect(first.x?.value).toBe(9007199254740991);
    // An unsafe negative coordinate is refused, with its token still in `rawElements`.
    expect(first.y).toBeNull();
    expect(first.rawElements[2]?.raw).toBe('-9007199254740993');

    expect(second.x).toBeNull();
    expect(second.rawElements[1]?.raw).toBe('9999999999999999999999999999999999999999');
    expect(second.y?.value).toBe(10);
  });

  it('accepts a negative coordinate that fits the exact range', () => {
    const position = decodePositionLiteral('"Main",-7,20');
    if (position.kind !== 'object') throw new Error('expected an object shape');
    expect(position.x?.value).toBe(-7);
  });
});

/** Decode one `Position` value as `[Entity]` would, through the real tokeniser. */
function decodePositionLiteral(value: string) {
  const parts = splitComplex(value, {
    sectionIndex: 1,
    startLine: 3,
    endLine: 3,
    keyLine: 3,
  });
  return decodePosition(
    'Entity',
    { parts: parts.parts, trailingElementsOmitted: parts.trailingElementsOmitted },
    { sectionIndex: 1, startLine: 3, endLine: 3, keyLine: 3 },
    value,
  );
}

describe('R20 — an undocumented NOT NULL token is not "nullable"', () => {
  it('reads the literal, the empty slot and the omitted slot distinctly', () => {
    const notNull = fieldOf(`"L","p","Integer","NOT NULL",0,"","",$FFFFFFFF,"",""`);
    expect(notNull.notNull?.value).toBe(true);
    expect(notNull.notNullToken).toBe('not-null');
    expect(notNull.notNullRaw).toBe('"NOT NULL"');

    const empty = fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,"",""`);
    expect(empty.notNull?.value).toBe(false);
    expect(empty.notNullToken).toBe('nullable');
    expect(empty.notNull?.origin).toBe('declared');

    // A four-element value stops before element 4: nothing was written, so nothing is claimed.
    const omitted = fieldOf(`"L","p","Integer"`);
    expect(omitted.notNull?.value).toBe(false);
    expect(omitted.notNull?.origin).toBe('defaulted');
    expect(omitted.notNullRaw).toBeNull();
  });

  it('returns a null value for a token the format does not define', () => {
    for (const token of ['"YES"', '"not null"', '"0"', '"NULL"', '"1"']) {
      const field = fieldOf(`"L","p","Integer",${token},0,"","",$FFFFFFFF,"",""`);
      // `notNull?.value` is `undefined`, never `false`: no consumer can read "nullable" from it.
      expect(field.notNull, token).toBeNull();
      expect(field.notNullToken, token).toBe('unrecognised');
      expect(field.notNullRaw, token).toBe(token);
    }
  });

  it('keeps the unrecognised token alongside a decodable rest of the column', () => {
    const field = fieldOf(`"L","p","Integer","YES",0,"","",$FFFFFFFF,"",""`);

    expect(field.notNull).toBeNull();
    expect(field.physicalName.value).toBe('p');
    expect(field.keyOrder?.value).toBe(0);
    expect(field.color?.value).toBe('$FFFFFFFF');
    expect(field.span.keyLine).toBe(3);
  });
});

describe('R21 — an omitted slot is not an explicit empty one', () => {
  it('marks a trailing comma as defaulted and `""` as declared', () => {
    const omitted = fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,`);
    const declared = fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,""`);

    // Nine elements either way: the count is physical, and the flag says how the last was written.
    expect(omitted.elementsSeen).toBe(9);
    expect(declared.elementsSeen).toBe(9);

    expect(omitted.option).toMatchObject({ value: '', origin: 'defaulted', raw: '' });
    expect(omitted.option.span).toBeNull();
    expect(declared.option).toMatchObject({ value: '', origin: 'declared', raw: '""' });
    expect(declared.option.span).toEqual({
      sectionIndex: 1,
      startLine: 3,
      endLine: 3,
      keyLine: 3,
    });
    // Neither value is a diagnostic: an empty option is legal in both spellings.
    expect(
      classify(scanSource({ text: `[Entity]\nPName="r"\nField=${omitted.raw}\n`, format: 21 }))
        .diagnostics,
    ).toEqual([]);
  });

  it('does not count an omitted trailing slot as a declared additionalOption', () => {
    const omittedTail = fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,"","a",`);
    const declaredTail = fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,"","a",""`);

    // 11 physical elements: element 11 is the omitted slot here, written out there.
    expect(omittedTail.elementsSeen).toBe(11);
    expect(omittedTail.additionalOption).toMatchObject({
      value: 'a',
      origin: 'declared',
      raw: '"a"',
    });
    expect(declaredTail.additionalOption).toMatchObject({
      value: 'a,',
      origin: 'declared',
      raw: '"a",""',
    });
  });

  it('still reports a missing colour when the slot is absent, not when it is empty', () => {
    // Seven elements: element 8 is absent → TOO_FEW and no colour.
    const absent = fieldOf(`"L","p","Integer","NOT NULL",0,"","c"`);
    expect(absent.color).toBeNull();
    expect(absent.elementsSeen).toBe(7);

    // Eight elements with a declared empty colour: the slot exists, so arity is satisfied.
    const emptyColor = fieldOf(`"L","p","Integer","NOT NULL",0,"","",""`);
    expect(emptyColor.color).toMatchObject({ value: '', origin: 'declared', raw: '""' });
    expect(emptyColor.elementsSeen).toBe(8);

    const classification = classify(
      scanSource({ text: `[Entity]\nPName="r"\nField=${emptyColor.raw}\n`, format: 21 }),
    );
    expect(classification.diagnostics).toEqual([]);
  });

  it('keeps the tokeniser flag intact for the decoder to read', () => {
    // The tokeniser already distinguishes the two; the field decoder must not flatten them again.
    expect(splitComplex('"a",').trailingElementsOmitted).toBe(true);
    expect(splitComplex('"a",""').trailingElementsOmitted).toBe(false);
    expect(fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,`).option.origin).toBe('defaulted');
    expect(fieldOf(`"L","p","Integer","",0,"","",$FFFFFFFF,""`).option.origin).toBe('declared');
  });
});
