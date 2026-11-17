/**
 * The bounded semantic result as a whole (`architecture.md` §9, §11, §12 rule 7, §13).
 *
 * Two things this file is responsible for that the per-rule tests cannot be:
 *
 * 1. **The catalog reconciles.** For every committed synthetic fixture the four codes this unit owns
 *    must be exactly the subset the catalog declares. That is the check that catches a rule that is
 *    too eager — a `V_MISSING_REQUIRED_KEY` on a complete file, or a `V_DUPLICATE_OBJECT_NAME` for
 *    two objects that merely share a column name.
 * 2. **The boundary is explicit.** `unresolved` names the §9 work this stage does not do, so a
 *    consumer cannot read an absent finding as a satisfied one. And the module is pure: deriving
 *    twice gives equal results and leaves the classification untouched.
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import { derivePartialSemantics, UNRESOLVED_AREAS } from '../src/semantic/partial.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';
import { assertCodes } from './helpers/assert-codes.js';

/**
 * The codes this stage owns: every `V_` code `architecture.md` §11 lists. Nothing is left over — the
 * stage emits all eight semantic findings, so the catalog's declared `V_` multiset is the contract.
 */
const OWNED_CODES: ReadonlySet<string> = new Set([
  'V_DUPLICATE_OBJECT_NAME',
  'V_MISSING_REQUIRED_KEY',
  'V_PK_ORDER_CONFLICT',
  'V_INDEX_LEGACY_ONLY',
  'V_DANGLING_ENTITY',
  'V_DANGLING_COLUMN',
  'V_DANGLING_PAGE',
  'V_FIELD_COUNT_MISMATCH',
  'V_VIEW_COLUMNS_UNKNOWN',
  'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
]);

function expectedOwnedCodes(spec: FixtureSpec): string[] {
  return spec.expectation.codes.filter((code) => OWNED_CODES.has(code));
}

const SYNTHETIC = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');

describe('every fixture yields exactly the V_ codes this unit owns', () => {
  for (const spec of SYNTHETIC) {
    it(`${spec.id} — ${spec.file}`, () => {
      const semantics = semanticsOf(spec.id);

      assertCodes(
        semantics.diagnostics.map((diagnostic) => diagnostic.code),
        expectedOwnedCodes(spec),
        `${spec.id} semantic codes`,
      );

      // Nothing outside this unit's four codes can appear here, by construction.
      for (const diagnostic of semantics.diagnostics) {
        expect(OWNED_CODES.has(diagnostic.code), `${spec.id}: ${diagnostic.code}`).toBe(true);
        // Every finding points at a real line of the file.
        expect(diagnostic.span?.startLine ?? 0).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('the boundary is part of the result (§9, §17)', () => {
  it('names every §9 area this stage does not model — none', () => {
    expect(semanticsOf('fmt-01').unresolved).toEqual([]);
    // Each area left the list when it was implemented, and the last two left because the answer
    // is stated per object instead of deferred: a view's columns are `unknown`, a subtype's
    // membership is `unsupported` (P10, K11). An empty list is not a finished product — the header
    // of `partial.ts` says so — it means no §9 area is left unmodelled.
    expect(UNRESOLVED_AREAS).toEqual([]);
    for (const done of [
      'relation-endpoints',
      'page-resolution',
      'domain-resolution',
      'common-columns',
      'view-columns',
      'subtype-membership',
    ]) {
      expect(UNRESOLVED_AREAS).not.toContain(done);
    }
  });

  it('does not claim a resolved schema: no envelope counters', () => {
    const semantics = semanticsOf('fmt-01') as unknown as Record<string, unknown>;
    for (const absent of ['objects', 'effectiveColumns', 'schema', 'completeness']) {
      expect(absent in semantics, absent).toBe(false);
    }
    // What it does expose is the resolution it actually performed.
    expect('relations' in semantics).toBe(true);
    expect('pages' in semantics).toBe(true);
    expect('views' in semantics).toBe(true);
    expect('subtypes' in semantics).toBe(true);
  });

  it('states the still-open findings per object, once each (sem-05, sem-06)', () => {
    // The two areas `unresolved` used to name are now answered by the object itself, so a consumer
    // that only reads this result is told the answer rather than left to infer it.
    const subtype = semanticsOf('sem-05');
    expect(subtype.subtypes).toHaveLength(1);
    expect(subtype.subtypes[0]?.membership).toEqual({
      status: 'unsupported',
      reason: 'no-membership-key-in-v2.21',
    });
    assertCodes(
      subtype.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_UNSUPPORTED_SUBTYPE_MEMBERSHIP'],
    );

    const views = semanticsOf('sem-06');
    expect(views.views.map((view) => view.effectiveColumns)).toEqual([
      { status: 'unknown', reason: 'view-columns-named-from-query' },
      { status: 'unknown', reason: 'view-columns-not-stored' },
    ]);
    assertCodes(
      views.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_VIEW_COLUMNS_UNKNOWN', 'V_VIEW_COLUMNS_UNKNOWN'],
    );
  });
});

describe('the module is pure', () => {
  it('derives the same result twice', () => {
    const classification = classificationOf('val-09');
    const first = derivePartialSemantics(classification);
    const second = derivePartialSemantics(classification);

    expect(second).toEqual(first);
  });

  it('does not mutate the classification it reads', () => {
    // sem-08 carries a `[View]` and sem-05 a `[Subtype]`, so the two modules that read sections
    // rather than `[Manager]` are exercised by the same untouched-before/untouched-after check.
    for (const id of ['sem-08', 'sem-05']) {
      const classification = classificationOf(id);
      const before = JSON.stringify(classification);
      derivePartialSemantics(classification);
      derivePartialSemantics(classification);

      expect(JSON.stringify(classification), id).toBe(before);
    }
  });

  it('orders diagnostics by line (§12 rule 7)', () => {
    // The emitter pushes the view findings and the subtype findings in two separate blocks, so this
    // document is built the wrong way round on purpose: the subtype comes first in the file. Only
    // the sort makes the result correct, and file order is the contract.
    const text =
      '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n' +
      '[Subtype]\nPName="s"\nPosition="M",1,1\n' +
      '[View]\nPName="v"\nPosition="M",1,1\n';
    const semantics = derivePartialSemantics(classify(scanSource({ text, format: 21 })));

    expect(semantics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
      'V_VIEW_COLUMNS_UNKNOWN',
    ]);
    const lines = semantics.diagnostics.map((diagnostic) => diagnostic.span?.startLine ?? 0);
    expect(lines).toEqual([...lines].sort((left, right) => left - right));

    // The same holds for a fixture with one finding, and for a document with several objects.
    for (const id of ['val-05', 'sem-06']) {
      const fixtureLines = semanticsOf(id).diagnostics.map(
        (diagnostic) => diagnostic.span?.startLine ?? 0,
      );
      expect(fixtureLines, id).toEqual([...fixtureLines].sort((left, right) => left - right));
    }
  });

  it('keeps identities even when a rule above them finds nothing', () => {
    const semantics = semanticsOf('txt-02');

    expect(semantics.identities.map((identity) => identity.pname)).toEqual(['parent_t', 'child_t']);
    expect(semantics.diagnostics).toEqual([]);
    expect(semantics.primaryKeys).toHaveLength(2);
  });
});
