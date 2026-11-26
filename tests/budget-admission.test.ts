/**
 * `admit(measure, budget)` — the admission gate (F4, U5-ADMIT1).
 *
 * Eight axes, and nothing about the pipeline: `src/pipeline.ts` is exercised by its own tests and
 * no `E_LIMIT_BUDGET` diagnostic, envelope or exit code is asserted here.
 *
 * 1. **defaults** — the ceilings this build applies are written out from the unit's specification
 *    (2²⁷, 2¹⁹, 2²² and the four pre-scan counts) and pinned exactly, so a silent change fails
 *    here rather than in a golden;
 *    the table and each profile object are also frozen at runtime, not only `as const`;
 * 2. **profiles** — `tables` carries no Σ`L²` member at all, so its absence is asserted structurally
 *    (`in`-checks, a forged extra member, and an observation that would be invalid if it were read)
 *    rather than through a comparison against `Number.MAX_SAFE_INTEGER`; the discriminant is also a
 *    runtime value, so an unknown, empty, mistyped or missing profile throws instead of becoming
 *    the `tables` arm;
 * 3. **the boundary is a comparison** — `observed <= ceiling` admits and `observed > ceiling` refuses,
 *    exactly at the ceiling too, on both counters and on both profiles;
 * 4. **order** — on the envelope profile Σ`L²` is decided first, so a document over both reports the
 *    relation value proxy; both observations are proved comparable before either is compared;
 * 5. **contract violations throw** — an observation that is not a non-negative safe integer and a
 *    ceiling that is not a positive safe integer raise `ResourceAdmissionError`, never a refusal, and
 *    nothing is clamped, rounded or saturated into a comparable number;
 * 6. **the error carries no input** — the message is fixed per fault, names only the counter, and
 *    repeats neither the observation nor the ceiling;
 * 7. **purity** — a deeply frozen measurement and budget are admitted, the inputs are not written to,
 *    and the same pair always gives the same answer;
 * 8. **the pre-scan shape** — `admitShape()` applies the same comparison and the same budget
 *    validation to the two figures `measureSourceShape()` counts before the scan, refusing `Field=`
 *    occurrences before content lines and proving both figures before comparing either.
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
  admitShape,
  DEFAULT_RESOURCE_BUDGETS,
  ResourceAdmissionError,
  withResourceBudget,
} from '../src/budget/index.js';
import type { SourceShape } from '../src/syntax/index.js';

/** Σ`L²` ceiling for `inspect`/`validate`: 2²⁷, from the unit's specification. */
const ENVELOPE_RELATION_CEILING = 134_217_728;
/** Composed-column ceiling for `inspect`/`validate`: 2¹⁹. */
const ENVELOPE_COMPOSED_CEILING = 524_288;
/** Composed-column ceiling for `tables`: 2²² — four times the envelope profile's, no Σ`L²` cap. */
const TABLES_COMPOSED_CEILING = 4_194_304;
/** `Field=` occurrences ceiling for `inspect`/`validate`: 200,000, from the U5-ADMIT2 spec. */
const ENVELOPE_ENTITY_FIELD_CEILING = 200_000;
/** Content-line ceiling for `inspect`/`validate`: 400,000. */
const ENVELOPE_CONTENT_CEILING = 400_000;
/** `Field=` occurrences ceiling for `tables`: 500,000 — the projection builds no envelope. */
const TABLES_ENTITY_FIELD_CEILING = 500_000;
/** Content-line ceiling for `tables`: 1,000,000. */
const TABLES_CONTENT_CEILING = 1_000_000;

const ENVELOPE_BUDGET: EnvelopeResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: ENVELOPE_RELATION_CEILING,
  composedColumnsUpperBound: ENVELOPE_COMPOSED_CEILING,
  entityFieldOccurrences: ENVELOPE_ENTITY_FIELD_CEILING,
  contentLineOccurrences: ENVELOPE_CONTENT_CEILING,
};

const TABLES_BUDGET: TablesResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: TABLES_COMPOSED_CEILING,
  entityFieldOccurrences: TABLES_ENTITY_FIELD_CEILING,
  contentLineOccurrences: TABLES_CONTENT_CEILING,
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

  it('states the ceilings as positive safe integers, the three original ones as powers of two', () => {
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

  it('states the four pre-scan ceilings as positive safe integers, at their approved values', () => {
    // Counts of lines a linear walk visits: round numbers, not powers of two, and pinned to the
    // U5-ADMIT2 specification's values so a silent edit fails here rather than in a golden.
    for (const [counter, value] of [
      ['envelope.entityFieldOccurrences', DEFAULT_RESOURCE_BUDGETS.envelope.entityFieldOccurrences],
      ['envelope.contentLineOccurrences', DEFAULT_RESOURCE_BUDGETS.envelope.contentLineOccurrences],
      ['tables.entityFieldOccurrences', DEFAULT_RESOURCE_BUDGETS.tables.entityFieldOccurrences],
      ['tables.contentLineOccurrences', DEFAULT_RESOURCE_BUDGETS.tables.contentLineOccurrences],
    ] as const) {
      expect(Number.isSafeInteger(value), counter).toBe(true);
      expect(value, counter).toBeGreaterThan(0);
    }
    expect(ENVELOPE_ENTITY_FIELD_CEILING).toBe(200_000);
    expect(ENVELOPE_CONTENT_CEILING).toBe(400_000);
    expect(TABLES_ENTITY_FIELD_CEILING).toBe(500_000);
    expect(TABLES_CONTENT_CEILING).toBe(1_000_000);
  });

  it('leaves ΣL² off the tables profile structurally, not as a large ceiling', () => {
    expect('relationValueLengthSquares' in DEFAULT_RESOURCE_BUDGETS.tables).toBe(false);
    // Four members per profile: the shared pre-scan pair plus the profile's own post-scan figures,
    // seven ceilings in all. The exact member sets are the contract this unit extends.
    expect(Object.keys(DEFAULT_RESOURCE_BUDGETS.tables).sort()).toEqual([
      'composedColumnsUpperBound',
      'contentLineOccurrences',
      'entityFieldOccurrences',
      'profile',
    ]);
    expect(Object.keys(DEFAULT_RESOURCE_BUDGETS.envelope).sort()).toEqual([
      'composedColumnsUpperBound',
      'contentLineOccurrences',
      'entityFieldOccurrences',
      'profile',
      'relationValueLengthSquares',
    ]);
    // The profile every default names is the one it is filed under.
    for (const profile of ['envelope', 'tables'] as const) {
      expect(DEFAULT_RESOURCE_BUDGETS[profile].profile).toBe(profile);
    }
  });

  it('is frozen at runtime, the table and each profile object alike', () => {
    // `as const` is a compile-time claim. The runtime claim is a freeze, so a process that has
    // loaded the module compares against the numbers this file states whatever a caller does.
    expect(Object.isFrozen(DEFAULT_RESOURCE_BUDGETS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RESOURCE_BUDGETS.envelope)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RESOURCE_BUDGETS.tables)).toBe(true);
    expect(Object.isExtensible(DEFAULT_RESOURCE_BUDGETS)).toBe(false);
    expect(Object.isExtensible(DEFAULT_RESOURCE_BUDGETS.envelope)).toBe(false);
    expect(Object.isExtensible(DEFAULT_RESOURCE_BUDGETS.tables)).toBe(false);
  });

  it('cannot be mutated: a write or a delete throws and the numbers stay as they were', () => {
    // Module code is strict, so an assignment to a frozen property is a TypeError rather than a
    // silent no-op — the difference between a caller's ceiling and the shipped one is loud.
    const outer = DEFAULT_RESOURCE_BUDGETS as unknown as Record<string, unknown>;
    const envelope = DEFAULT_RESOURCE_BUDGETS.envelope as unknown as Record<string, unknown>;

    expect(() => {
      outer['envelope'] = { profile: 'envelope', relationValueLengthSquares: 1 };
    }).toThrow(TypeError);
    expect(() => {
      outer['relationships'] = { profile: 'tables', composedColumnsUpperBound: 1 };
    }).toThrow(TypeError);
    expect(() => {
      envelope['relationValueLengthSquares'] = 1;
    }).toThrow(TypeError);
    expect(() => {
      delete envelope['composedColumnsUpperBound'];
    }).toThrow(TypeError);

    // And after every attempt, the same three numbers a decision would read.
    expect(DEFAULT_RESOURCE_BUDGETS.envelope).toEqual(ENVELOPE_BUDGET);
    expect(DEFAULT_RESOURCE_BUDGETS.tables).toEqual(TABLES_BUDGET);
    expect(Object.keys(DEFAULT_RESOURCE_BUDGETS).sort()).toEqual(['envelope', 'tables']);
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
          entityFieldOccurrences: 1,
          contentLineOccurrences: 1,
        } as unknown as ResourceBudget),
      ).toThrow(ResourceAdmissionError);
      // The two pre-scan ceilings are checked by the same rule as the post-scan ones.
      for (const member of ['entityFieldOccurrences', 'contentLineOccurrences'] as const) {
        expect(() =>
          withResourceBudget({
            profile: 'tables',
            composedColumnsUpperBound: 1,
            entityFieldOccurrences: 1,
            contentLineOccurrences: 1,
            [member]: invalid,
          } as unknown as ResourceBudget),
        ).toThrow(ResourceAdmissionError);
      }
    }
  });

  it('drops a member the profile does not declare instead of carrying it into the decision', () => {
    // A forged ΣL² ceiling on a tables budget: 0 would be invalid if this profile had one, so the
    // fact that neither call throws is the proof that the member is never read.
    const forged = {
      profile: 'tables',
      composedColumnsUpperBound: 10,
      entityFieldOccurrences: 20,
      contentLineOccurrences: 30,
      relationValueLengthSquares: 0,
    } as unknown as ResourceBudget;

    const applied = withResourceBudget(forged);

    expect('relationValueLengthSquares' in applied).toBe(false);
    expect(applied).toEqual({
      profile: 'tables',
      composedColumnsUpperBound: 10,
      entityFieldOccurrences: 20,
      contentLineOccurrences: 30,
    });
  });
});
describe('admission — the profile is a runtime value, not only a type', () => {
  it('accepts exactly the two profiles this build applies', () => {
    expect(withResourceBudget(ENVELOPE_BUDGET)).toEqual(ENVELOPE_BUDGET);
    expect(withResourceBudget(TABLES_BUDGET)).toEqual(TABLES_BUDGET);
    expect(admit(measureWith(1, 1), ENVELOPE_BUDGET)).toEqual({ admitted: true });
    expect(admit(measureWith(1, 1), TABLES_BUDGET)).toEqual({ admitted: true });
  });

  it('throws for an unknown, empty, differently cased or non-string profile', () => {
    // Each of these would have been *admitted as `tables`* by an `if (profile === 'envelope') …
    // else` discriminant, so each one is asserted to throw rather than to be decided.
    const profiles: unknown[] = [
      'Envelope',
      'TABLES',
      'ENVELOPE',
      'envelope ',
      'tables\n',
      '',
      'relationships',
      'both',
      0,
      1,
      true,
      null,
      undefined,
      {},
      [],
    ];

    for (const profile of profiles) {
      const budget = {
        profile,
        relationValueLengthSquares: 10,
        composedColumnsUpperBound: 10,
      } as unknown as ResourceBudget;

      expect(() => withResourceBudget(budget), String(profile)).toThrow(ResourceAdmissionError);
      expect(() => admit(measureWith(1, 1), budget), String(profile)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('throws for a budget with no profile member at all, and for a non-object', () => {
    for (const budget of [
      {},
      { composedColumnsUpperBound: 10 },
      { relationValueLengthSquares: 10, composedColumnsUpperBound: 10 },
      null,
      undefined,
      'tables',
      0,
      true,
      [],
    ]) {
      expect(() => withResourceBudget(budget as unknown as ResourceBudget)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admit(measureWith(1, 1), budget as unknown as ResourceBudget)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('states the profile fault in fixed text that repeats no value', () => {
    const message = 'admission: the budget names a profile this build does not apply';
    const budget = {
      profile: 'Envelope',
      composedColumnsUpperBound: 10,
    } as unknown as ResourceBudget;

    let thrown: unknown;
    try {
      withResourceBudget(budget);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ResourceAdmissionError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe(message);
    expect((thrown as Error).name).toBe('ResourceAdmissionError');
    expect(message).not.toContain('Envelope');
    expect(message).not.toMatch(/\d/);
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

  it('orders ΣL² before the composed bound on every combination of the two', () => {
    const overRelationValues = {
      admitted: false,
      counter: 'relationValueLengthSquares',
      observed: ENVELOPE_RELATION_CEILING + 1,
      ceiling: ENVELOPE_RELATION_CEILING,
    };
    const overComposed = {
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: ENVELOPE_COMPOSED_CEILING + 1,
      ceiling: ENVELOPE_COMPOSED_CEILING,
    };

    // ΣL² over, composed within: the relation value proxy.
    expect(
      refusalOf(ENVELOPE_RELATION_CEILING + 1, ENVELOPE_COMPOSED_CEILING, ENVELOPE_BUDGET),
    ).toEqual(overRelationValues);
    // ΣL² within, composed over: the composition bound.
    expect(
      refusalOf(ENVELOPE_RELATION_CEILING, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET),
    ).toEqual(overComposed);
    // Both over: the first counter in this profile's order, never the second.
    expect(
      refusalOf(ENVELOPE_RELATION_CEILING + 1, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET),
    ).toEqual(overRelationValues);
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
  it('proves both envelope observations before it compares either of them', () => {
    // A document over ΣL² whose composed bound is unreadable is a defect in this tool's own
    // measurement, so the answer is neither of the two refusals: it throws.
    expect(() => refusalOf(ENVELOPE_RELATION_CEILING + 1, Number.NaN, ENVELOPE_BUDGET)).toThrow(
      'admission: composedColumnsUpperBound is not a non-negative safe integer',
    );
    expect(() => refusalOf(Number.NaN, ENVELOPE_COMPOSED_CEILING + 1, ENVELOPE_BUDGET)).toThrow(
      'admission: relationValueLengthSquares is not a non-negative safe integer',
    );

    // `tables` reads the composed bound only, so an unreadable ΣL² is not a fault there: the two
    // profiles do not validate each other's counters.
    expect(refusalOf(Number.NaN, TABLES_COMPOSED_CEILING + 1, TABLES_BUDGET)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: TABLES_COMPOSED_CEILING + 1,
      ceiling: TABLES_COMPOSED_CEILING,
    });
    expect(refusalOf(Number.NaN, TABLES_COMPOSED_CEILING, TABLES_BUDGET)).toEqual({
      admitted: true,
    });
  });
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
      entityFieldOccurrences: ceiling,
      contentLineOccurrences: ceiling,
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
      entityFieldOccurrences: 100,
      contentLineOccurrences: 200,
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

// ── the pre-scan shape (U5-ADMIT2) ────────────────────────────────────────

/**
 * A shape carrying the two figures `admitShape()` reads.
 *
 * `lines` is the pre-scan accounting and is not part of the decision; it holds the empty partition
 * so the record is a real `SourceShape` rather than a cast.
 */
function shapeWith(entityFieldOccurrences: number, contentLineOccurrences: number): SourceShape {
  return {
    lines: { total: 0, sectionHeaders: 0, keys: 0, comments: 0, blank: 0, raw: 0 },
    entityFieldOccurrences,
    contentLineOccurrences,
  };
}

describe('admission — the pre-scan shape', () => {
  it('admits each figure exactly at its own profile’s ceiling and refuses one more', () => {
    for (const [budget, entityCeiling, contentCeiling] of [
      [ENVELOPE_BUDGET, ENVELOPE_ENTITY_FIELD_CEILING, ENVELOPE_CONTENT_CEILING],
      [TABLES_BUDGET, TABLES_ENTITY_FIELD_CEILING, TABLES_CONTENT_CEILING],
    ] as const) {
      expect(admitShape(shapeWith(entityCeiling, contentCeiling), budget)).toEqual({
        admitted: true,
      });
      expect(admitShape(shapeWith(entityCeiling + 1, contentCeiling), budget)).toEqual({
        admitted: false,
        counter: 'entityFieldOccurrences',
        observed: entityCeiling + 1,
        ceiling: entityCeiling,
      });
      expect(admitShape(shapeWith(entityCeiling, contentCeiling + 1), budget)).toEqual({
        admitted: false,
        counter: 'contentLineOccurrences',
        observed: contentCeiling + 1,
        ceiling: contentCeiling,
      });
    }
  });

  it('reports the Field occurrences first when both figures are past their ceilings', () => {
    for (const [budget, entityCeiling, contentCeiling] of [
      [ENVELOPE_BUDGET, ENVELOPE_ENTITY_FIELD_CEILING, ENVELOPE_CONTENT_CEILING],
      [TABLES_BUDGET, TABLES_ENTITY_FIELD_CEILING, TABLES_CONTENT_CEILING],
    ] as const) {
      expect(admitShape(shapeWith(entityCeiling + 1, contentCeiling + 1), budget)).toEqual({
        admitted: false,
        counter: 'entityFieldOccurrences',
        observed: entityCeiling + 1,
        ceiling: entityCeiling,
      });
    }
  });

  it('reads each profile’s own ceilings, not the other profile’s', () => {
    // A figure between the two Field ceilings: refused for the envelope, admitted for tables.
    const between = ENVELOPE_ENTITY_FIELD_CEILING + 1;
    expect(between).toBeLessThanOrEqual(TABLES_ENTITY_FIELD_CEILING);
    expect(admitShape(shapeWith(between, 0), ENVELOPE_BUDGET).admitted).toBe(false);
    expect(admitShape(shapeWith(between, 0), TABLES_BUDGET).admitted).toBe(true);
  });

  it('proves both observations before it compares either of them', () => {
    // A shape over the Field ceiling whose content figure is unreadable is a defect in this tool's
    // own walk, so the answer is neither of the two refusals: it throws.
    expect(() =>
      admitShape(shapeWith(ENVELOPE_ENTITY_FIELD_CEILING + 1, Number.NaN), ENVELOPE_BUDGET),
    ).toThrow('admission: contentLineOccurrences is not a non-negative safe integer');
    expect(() => admitShape(shapeWith(Number.NaN, 0), ENVELOPE_BUDGET)).toThrow(
      'admission: entityFieldOccurrences is not a non-negative safe integer',
    );
  });

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
      expect(() => admitShape(shapeWith(invalid, 0), ENVELOPE_BUDGET), String(invalid)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admitShape(shapeWith(0, invalid), TABLES_BUDGET), String(invalid)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('refuses to compare an observation whose type is not a number', () => {
    for (const invalid of ['10', null, undefined, true, {}, []]) {
      expect(() => admitShape(shapeWith(invalid as unknown as number, 0), ENVELOPE_BUDGET)).toThrow(
        ResourceAdmissionError,
      );
      expect(() => admitShape(shapeWith(0, invalid as unknown as number), TABLES_BUDGET)).toThrow(
        ResourceAdmissionError,
      );
    }
  });

  it('throws on an invalid pre-scan ceiling rather than deciding against it', () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      for (const member of ['entityFieldOccurrences', 'contentLineOccurrences'] as const) {
        expect(() =>
          admitShape(shapeWith(1, 1), { ...ENVELOPE_BUDGET, [member]: invalid }),
        ).toThrow(ResourceAdmissionError);
        expect(() => admitShape(shapeWith(1, 1), { ...TABLES_BUDGET, [member]: invalid })).toThrow(
          ResourceAdmissionError,
        );
      }
    }
  });

  it('resolves the budget the same way admit() does, so an unknown profile throws', () => {
    const budget = {
      profile: 'Envelope',
      relationValueLengthSquares: 10,
      composedColumnsUpperBound: 10,
      entityFieldOccurrences: 10,
      contentLineOccurrences: 10,
    } as unknown as ResourceBudget;

    expect(() => admitShape(shapeWith(0, 0), budget)).toThrow(
      'admission: the budget names a profile this build does not apply',
    );
  });

  it('accepts Number.MAX_SAFE_INTEGER as a ceiling and decides its neighbours', () => {
    const ceiling = Number.MAX_SAFE_INTEGER;
    const budget: ResourceBudget = {
      profile: 'envelope',
      relationValueLengthSquares: ceiling,
      composedColumnsUpperBound: ceiling,
      entityFieldOccurrences: ceiling,
      contentLineOccurrences: ceiling,
    };

    expect(admitShape(shapeWith(ceiling, ceiling), budget)).toEqual({ admitted: true });
    // One past a comparable ceiling cannot be observed exactly either, so the deny edge that can be
    // reached is a ceiling one below the maximum.
    const below: ResourceBudget = { ...budget, contentLineOccurrences: ceiling - 1 };
    expect(admitShape(shapeWith(0, ceiling), below)).toEqual({
      admitted: false,
      counter: 'contentLineOccurrences',
      observed: ceiling,
      ceiling: ceiling - 1,
    });
  });

  it('is deterministic and writes to neither input', () => {
    const budget = { ...TABLES_BUDGET };
    const before = { ...budget };
    const shape = shapeWith(TABLES_ENTITY_FIELD_CEILING + 1, 0);
    const lines = { ...shape.lines };

    expect(admitShape(shape, budget)).toEqual(admitShape(shape, budget));
    expect({ ...budget }).toEqual(before);
    expect(shape.entityFieldOccurrences).toBe(TABLES_ENTITY_FIELD_CEILING + 1);
    expect(shape.lines).toEqual(lines);
    expect('admitted' in shape).toBe(false);
  });

  it('states one fixed message per pre-scan fault, naming the counter and no value', () => {
    expect(() => admitShape(shapeWith(Number.NaN, 0), ENVELOPE_BUDGET)).toThrow(
      'admission: entityFieldOccurrences is not a non-negative safe integer',
    );
    expect(() => admitShape(shapeWith(0, Number.NaN), ENVELOPE_BUDGET)).toThrow(
      'admission: contentLineOccurrences is not a non-negative safe integer',
    );
    expect(() =>
      admitShape(shapeWith(0, 0), { ...ENVELOPE_BUDGET, entityFieldOccurrences: 0 }),
    ).toThrow('admission: the entityFieldOccurrences ceiling is not a positive safe integer');
    expect(() =>
      admitShape(shapeWith(0, 0), { ...ENVELOPE_BUDGET, contentLineOccurrences: 0 }),
    ).toThrow('admission: the contentLineOccurrences ceiling is not a positive safe integer');
  });
});
