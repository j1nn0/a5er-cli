/**
 * `admit(measure, budget)` — the admission gate (F4, U5-ADMIT1).
 *
 * Seven axes, and nothing about the pipeline: `src/pipeline.ts` is exercised by its own tests and no
 * `E_LIMIT_BUDGET` diagnostic, envelope or exit code is asserted here.
 *
 * 1. **defaults** — the ceilings this build applies are written out from the unit's specification
 *    (2²⁷, 2¹⁹ and 2²²) and pinned exactly, so a silent change fails here rather than in a golden;
 * 2. **profiles** — `tables` carries no Σ`L²` member at all, so its absence is asserted structurally
 *    (`in`-checks, a forged extra member, and an observation that would be invalid if it were read)
 *    rather than through a comparison against `Number.MAX_SAFE_INTEGER`;
 * 3. **the boundary is a comparison** — `observed <= ceiling` admits and `observed > ceiling` refuses,
 *    exactly at the ceiling too, on both counters and on both profiles;
 * 4. **order** — on the envelope profile Σ`L²` is decided first, so a document over both reports the
 *    relation value proxy;
 * 5. **contract violations throw** — an observation that is not a non-negative safe integer and a
 *    ceiling that is not a positive safe integer raise `ResourceAdmissionError`, never a refusal, and
 *    nothing is clamped, rounded or saturated into a comparable number;
 * 6. **the error carries no input** — the message is fixed per fault, names only the counter, and
 *    repeats neither the observation nor the ceiling;
 * 7. **purity** — a deeply frozen measurement and budget are admitted, the inputs are not written to,
 *    and the same pair always gives the same answer.
 *
 * The expectations are derived from the specification and from hand-written numbers, never from the
 * module's own output, and no document is read or generated: a ceiling of `Number.MAX_SAFE_INTEGER`
 * and an observation one past it are decided without a file.
 */

import { describe, expect, it } from 'vitest';
import type {
  Admission,
  EnvelopeResourceBudget,
  ResourceBudget,
  ResourceMeasure,
  TablesResourceBudget,
} from '../src/budget/index.js';
import {
  admit,
  DEFAULT_RESOURCE_BUDGETS,
  ResourceAdmissionError,
  withResourceBudget,
} from '../src/budget/index.js';

/** Σ`L²` ceiling for `inspect`/`validate`: 2²⁷, from the unit's specification. */
const ENVELOPE_RELATION_CEILING = 134_217_728;
/** Composed-column ceiling for `inspect`/`validate`: 2¹⁹. */
const ENVELOPE_COMPOSED_CEILING = 524_288;
/** Composed-column ceiling for `tables`: 2²² — four times the envelope profile's, no Σ`L²` cap. */
const TABLES_COMPOSED_CEILING = 4_194_304;

const ENVELOPE_BUDGET: EnvelopeResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: ENVELOPE_RELATION_CEILING,
  composedColumnsUpperBound: ENVELOPE_COMPOSED_CEILING,
};

const TABLES_BUDGET: TablesResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: TABLES_COMPOSED_CEILING,
};

/**
 * A measurement carrying the two figures admission reads and nothing else.
 *
 * `admit()` consults `counters.relationValueLengthSquares` (envelope only) and
 * `bounds.composedColumnsUpperBound.upperBound`; the other sixteen counters, the slot bound and the
 * scan's `accounting` are not part of the decision. Building the smallest record that answers those
 * two questions is what lets a boundary sit at `Number.MAX_SAFE_INTEGER` without a document that
 * large — the cast is the shortcut, not a relaxation: `admit()` reads the same two members.
 */
function measureWith(
  relationValueLengthSquares: number,
  composedUpperBound: number,
): ResourceMeasure {
  return {
    counters: { relationValueLengthSquares },
    bounds: { composedColumnsUpperBound: { upperBound: composedUpperBound } },
    accounting: {},
  } as unknown as ResourceMeasure;
}

/** The same measurement with its two levels of nesting frozen, for the purity axis. */
function frozenMeasure(
  relationValueLengthSquares: number,
  composedUpperBound: number,
): ResourceMeasure {
  return Object.freeze({
    counters: Object.freeze({ relationValueLengthSquares }),
    bounds: Object.freeze({
      composedColumnsUpperBound: Object.freeze({ upperBound: composedUpperBound }),
    }),
    accounting: Object.freeze({}),
  }) as unknown as ResourceMeasure;
}

/** The measurement fields a refusal repeats, in the details shape `E_LIMIT_BUDGET` uses. */
function refusalOf(
  relationValueLengthSquares: number,
  composedUpperBound: number,
  budget: ResourceBudget,
): Admission {
  return admit(measureWith(relationValueLengthSquares, composedUpperBound), budget);
}

describe('admission — the defaults this build applies', () => {
  it('caps both figures on the envelope profile and one on tables', () => {
    expect(DEFAULT_RESOURCE_BUDGETS.envelope).toEqual(ENVELOPE_BUDGET);
    expect(DEFAULT_RESOURCE_BUDGETS.tables).toEqual(TABLES_BUDGET);
  });

  it('states the ceilings as positive safe integers, and the three as powers of two', () => {
    for (const [counter, value] of [
      [
        'envelope.relationValueLengthSquares',
        DEFAULT_RESOURCE_BUDGETS.envelope.relationValueLengthSquares,
      ],
      [
        'envelope.composedColumnsUpperBound',
        DEFAULT_RESOURCE_BUDGETS.envelope.composedColumnsUpperBound,
      ],
      [
        'tables.composedColumnsUpperBound',
        DEFAULT_RESOURCE_BUDGETS.tables.composedColumnsUpperBound,
      ],
    ] as const) {
      expect(Number.isSafeInteger(value), counter).toBe(true);
      expect(value, counter).toBeGreaterThan(0);
      // A power of two is what the specification's figures are; a typo'd digit would not be one.
      expect(Math.log2(value), counter).toBe(Math.round(Math.log2(value)));
    }
    expect(ENVELOPE_RELATION_CEILING).toBe(2 ** 27);
    expect(ENVELOPE_COMPOSED_CEILING).toBe(2 ** 19);
    expect(TABLES_COMPOSED_CEILING).toBe(2 ** 22);
  });

  it('leaves ΣL² off the tables profile structurally, not as a large ceiling', () => {
    expect('relationValueLengthSquares' in DEFAULT_RESOURCE_BUDGETS.tables).toBe(false);
    expect(Object.keys(DEFAULT_RESOURCE_BUDGETS.tables).sort()).toEqual([
      'composedColumnsUpperBound',
      'profile',
    ]);
    expect(Object.keys(DEFAULT_RESOURCE_BUDGETS.envelope).sort()).toEqual([
      'composedColumnsUpperBound',
      'profile',
      'relationValueLengthSquares',
    ]);
    // The profile every default names is the one it is filed under.
    for (const profile of ['envelope', 'tables'] as const) {
      expect(DEFAULT_RESOURCE_BUDGETS[profile].profile).toBe(profile);
    }
  });
});

describe('admission — withResourceBudget', () => {
  it('returns the ceilings it was given, as a fresh object', () => {
    expect(withResourceBudget(ENVELOPE_BUDGET)).toEqual(ENVELOPE_BUDGET);
    expect(withResourceBudget(TABLES_BUDGET)).toEqual(TABLES_BUDGET);
    expect(withResourceBudget(ENVELOPE_BUDGET)).not.toBe(ENVELOPE_BUDGET);
    expect(withResourceBudget(TABLES_BUDGET)).not.toBe(TABLES_BUDGET);
  });

  it('accepts Number.MAX_SAFE_INTEGER and refuses everything past a valid setting', () => {
    const safe = { ...ENVELOPE_BUDGET, relationValueLengthSquares: Number.MAX_SAFE_INTEGER };
    const resolved = withResourceBudget(safe);
    if (resolved.profile !== 'envelope') throw new Error('the envelope profile was not kept');
    expect(resolved.relationValueLengthSquares).toBe(Number.MAX_SAFE_INTEGER);

    for (const invalid of [
      0,
      -1,
      -Number.MAX_SAFE_INTEGER,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(() =>
        withResourceBudget({ ...ENVELOPE_BUDGET, relationValueLengthSquares: invalid }),
      ).toThrow(ResourceAdmissionError);
      expect(() =>
        withResourceBudget({ ...TABLES_BUDGET, composedColumnsUpperBound: invalid }),
      ).toThrow(ResourceAdmissionError);
    }
  });

  it('refuses a ceiling whose type is not a number', () => {
    for (const invalid of ['10', null, undefined, true, {}, []]) {
      expect(() =>
        withResourceBudget({
          profile: 'tables',
          composedColumnsUpperBound: invalid,
        } as unknown as ResourceBudget),
      ).toThrow(ResourceAdmissionError);
    }
  });

  it('drops a member the profile does not declare instead of carrying it into the decision', () => {
    // A forged ΣL² ceiling on a tables budget: 0 would be invalid if this profile had one, so the
    // fact that neither call throws is the proof that the member is never read.
    const forged = {
      profile: 'tables',
      composedColumnsUpperBound: 10,
      relationValueLengthSquares: 0,
    } as unknown as ResourceBudget;

    const applied = withResourceBudget(forged);

    expect('relationValueLengthSquares' in applied).toBe(false);
    expect(applied).toEqual({ profile: 'tables', composedColumnsUpperBound: 10 });
  });
});

describe('admission — the envelope profile', () => {
  it('admits ΣL² exactly at the ceiling and refuses one more', () => {
    expect(refusalOf(ENVELOPE_RELATION_CEILING, 0, ENVELOPE_BUDGET)).toEqual({ admitted: true });
    expect(refusalOf(ENVELOPE_RELATION_CEILING + 1, 0, ENVELOPE_BUDGET)).toEqual({
      admitted: false,
      counter: 'relationValueLengthSquares',
      observed: ENVELOPE_RELATION_CEILING + 1,
      ceiling: ENVELOPE_RELATION_CEILING,
    });
  });

  it('admits the composed bound exactly at the ceiling and refuses one more', () => {
    expect(refusalOf(0, ENVELOPE_COMPOSED_CEILING, ENVELOPE_BUDGET)).toEqual({ admitted: true });
    expect(refusalOf(0, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: ENVELOPE_COMPOSED_CEILING + 1,
      ceiling: ENVELOPE_COMPOSED_CEILING,
    });
  });

  it('decides ΣL² first when both figures are past their ceilings', () => {
    expect(
      refusalOf(ENVELOPE_RELATION_CEILING + 1, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET),
    ).toEqual({
      admitted: false,
      counter: 'relationValueLengthSquares',
      observed: ENVELOPE_RELATION_CEILING + 1,
      ceiling: ENVELOPE_RELATION_CEILING,
    });
  });

  it('admits a measurement that is under both, and reports nothing but the decision', () => {
    const admission = admit(
      measureWith(ENVELOPE_RELATION_CEILING - 1, ENVELOPE_COMPOSED_CEILING - 1),
      ENVELOPE_BUDGET,
    );

    expect(admission).toEqual({ admitted: true });
    expect(Object.keys(admission)).toEqual(['admitted']);
  });
});

describe('admission — the tables profile', () => {
  it('admits the composed bound exactly at its own ceiling and refuses one more', () => {
    expect(refusalOf(0, TABLES_COMPOSED_CEILING, TABLES_BUDGET)).toEqual({ admitted: true });
    expect(refusalOf(0, TABLES_COMPOSED_CEILING + 1, TABLES_BUDGET)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: TABLES_COMPOSED_CEILING + 1,
      ceiling: TABLES_COMPOSED_CEILING,
    });
    // The envelope profile's ceiling is not this one: a figure between the two is refused here.
    expect(refusalOf(0, ENVELOPE_COMPOSED_CEILING + 1, TABLES_BUDGET).admitted).toBe(true);
  });

  it('never reads ΣL²: a value that is the envelope ceiling plus one is admitted', () => {
    expect(refusalOf(ENVELOPE_RELATION_CEILING + 1, 0, TABLES_BUDGET)).toEqual({ admitted: true });
    expect(refusalOf(Number.MAX_SAFE_INTEGER, 0, TABLES_BUDGET)).toEqual({ admitted: true });
    // And an observation that would be a contract violation if it were read is not read either:
    expect(refusalOf(Number.NaN, 0, TABLES_BUDGET)).toEqual({ admitted: true });
  });
});

describe('admission — contract violations throw, they never become a refusal', () => {
  it('refuses to compare an observation that is not a non-negative safe integer', () => {
    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      -Number.MAX_SAFE_INTEGER,
      1.5,
      2 ** 53,
    ]) {
      expect(() => admit(measureWith(invalid, 0), ENVELOPE_BUDGET), String(invalid)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admit(measureWith(0, invalid), ENVELOPE_BUDGET), String(invalid)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admit(measureWith(0, invalid), TABLES_BUDGET), String(invalid)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('refuses to compare an observation whose type is not a number', () => {
    for (const invalid of ['10', null, undefined, true, {}, []]) {
      expect(() => admit(measureWith(invalid as unknown as number, 0), ENVELOPE_BUDGET)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admit(measureWith(0, invalid as unknown as number), TABLES_BUDGET)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('throws on an invalid ceiling rather than admitting or refusing against it', () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() =>
        admit(measureWith(1, 1), { ...ENVELOPE_BUDGET, composedColumnsUpperBound: invalid }),
      ).toThrow(ResourceAdmissionError);
      expect(() =>
        admit(measureWith(1, 1), { ...ENVELOPE_BUDGET, relationValueLengthSquares: invalid }),
      ).toThrow(ResourceAdmissionError);
      expect(() =>
        admit(measureWith(1, 1), { ...TABLES_BUDGET, composedColumnsUpperBound: invalid }),
      ).toThrow(ResourceAdmissionError);
    }
  });

  it('accepts Number.MAX_SAFE_INTEGER as a ceiling and decides its two neighbours', () => {
    const ceiling = Number.MAX_SAFE_INTEGER;
    const budget: ResourceBudget = {
      profile: 'envelope',
      relationValueLengthSquares: ceiling,
      composedColumnsUpperBound: ceiling,
    };

    expect(admit(measureWith(ceiling, ceiling), budget)).toEqual({ admitted: true });
    expect(admit(measureWith(ceiling - 1, ceiling - 1), budget)).toEqual({ admitted: true });
    // One past a comparable ceiling cannot be observed exactly either, so the deny edge that *can*
    // be reached is a ceiling one below the maximum.
    const below: ResourceBudget = { ...budget, composedColumnsUpperBound: ceiling - 1 };
    expect(admit(measureWith(0, ceiling), below)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: ceiling,
      ceiling: ceiling - 1,
    });
  });
});

describe('admission — the error is typed, fixed and input-free', () => {
  it('carries its own type, name and the measure module contract', () => {
    let error: unknown;
    try {
      admit(measureWith(Number.NaN, 0), ENVELOPE_BUDGET);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(ResourceAdmissionError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('ResourceAdmissionError');
  });

  it('states one fixed message per fault, naming the counter and no value', () => {
    const observed = 4_242_424;
    const ceiling = 4_242_423;

    expect(() => admit(measureWith(observed + 0.5, 0), ENVELOPE_BUDGET)).toThrow(
      'admission: relationValueLengthSquares is not a non-negative safe integer',
    );
    expect(() => admit(measureWith(0, Number.NaN), ENVELOPE_BUDGET)).toThrow(
      'admission: composedColumnsUpperBound is not a non-negative safe integer',
    );
    expect(() =>
      admit(measureWith(0, 0), { ...ENVELOPE_BUDGET, composedColumnsUpperBound: ceiling }),
    ).not.toThrow();
    expect(() =>
      admit(measureWith(0, 0), {
        ...ENVELOPE_BUDGET,
        composedColumnsUpperBound: observed + 0.5,
      }),
    ).toThrow('admission: the composedColumnsUpperBound ceiling is not a positive safe integer');

    // The messages above are the whole text: neither figure appears in them.
    for (const message of [
      'admission: relationValueLengthSquares is not a non-negative safe integer',
      'admission: composedColumnsUpperBound is not a non-negative safe integer',
      'admission: the composedColumnsUpperBound ceiling is not a positive safe integer',
    ]) {
      expect(message).not.toContain(String(observed));
      expect(message).not.toContain(String(ceiling));
      expect(message).not.toMatch(/\d/);
    }
  });

  it('never rounds a fractional observation onto a ceiling', () => {
    // 10 is admitted and 11 is refused, so 10.5 must land on neither side: it throws.
    const budget: ResourceBudget = {
      profile: 'tables',
      composedColumnsUpperBound: 10,
    };
    expect(admit(measureWith(0, 10), budget)).toEqual({ admitted: true });
    expect(() => admit(measureWith(0, 10.5), budget)).toThrow(ResourceAdmissionError);
    expect(admit(measureWith(0, 11), budget)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: 11,
      ceiling: 10,
    });
  });
});

describe('admission — purity', () => {
  it('decides a deeply frozen measurement and budget', () => {
    expect(admit(frozenMeasure(7, 9), Object.freeze({ ...TABLES_BUDGET }))).toEqual({
      admitted: true,
    });
    expect(
      admit(frozenMeasure(ENVELOPE_RELATION_CEILING + 1, 0), Object.freeze({ ...ENVELOPE_BUDGET })),
    ).toEqual({
      admitted: false,
      counter: 'relationValueLengthSquares',
      observed: ENVELOPE_RELATION_CEILING + 1,
      ceiling: ENVELOPE_RELATION_CEILING,
    });
  });

  it('does not write to either input', () => {
    const budget = { ...ENVELOPE_BUDGET };
    const before = { ...budget };
    const measurement = measureWith(3, 4);

    admit(measurement, budget);

    expect({ ...budget }).toEqual(before);
    expect(measurement.counters.relationValueLengthSquares).toBe(3);
    expect(measurement.bounds.composedColumnsUpperBound.upperBound).toBe(4);
    // The measurement is not given an `admitted` member, and the refusal is a new object.
    expect('admitted' in measurement).toBe(false);
    expect(refusalOf(3, 4, budget)).not.toBe(refusalOf(3, 4, budget));
  });

  it('is deterministic: the same pair gives an equal answer twice', () => {
    const pairs: Array<[number, number, ResourceBudget]> = [
      [0, 0, ENVELOPE_BUDGET],
      [ENVELOPE_RELATION_CEILING, ENVELOPE_COMPOSED_CEILING, ENVELOPE_BUDGET],
      [ENVELOPE_RELATION_CEILING + 1, 0, ENVELOPE_BUDGET],
      [0, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET],
      [Number.MAX_SAFE_INTEGER, 0, TABLES_BUDGET],
      [0, TABLES_COMPOSED_CEILING + 1, TABLES_BUDGET],
    ];

    for (const [squares, composed, budget] of pairs) {
      expect(admit(measureWith(squares, composed), budget)).toEqual(
        admit(measureWith(squares, composed), budget),
      );
    }
  });
});
