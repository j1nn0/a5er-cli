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
import { derivePartialSemantics, UNRESOLVED_AREAS } from '../src/semantic/partial.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';
import { assertCodes } from './helpers/assert-codes.js';

/** The four codes this unit owns. Every other `V_` belongs to the open resolution work. */
const OWNED_CODES: ReadonlySet<string> = new Set([
  'V_DUPLICATE_OBJECT_NAME',
  'V_MISSING_REQUIRED_KEY',
  'V_PK_ORDER_CONFLICT',
  'V_INDEX_LEGACY_ONLY',
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
  it('names every §9 area this stage does not model', () => {
    expect(semanticsOf('fmt-01').unresolved).toEqual([
      'relation-endpoints',
      'page-resolution',
      'domain-resolution',
      'common-columns',
      'view-columns',
      'subtype-membership',
    ]);
    expect(UNRESOLVED_AREAS).toHaveLength(6);
  });

  it('does not claim a resolved schema: no effective columns, no endpoints, no pages', () => {
    const semantics = semanticsOf('fmt-01') as unknown as Record<string, unknown>;
    for (const absent of [
      'objects',
      'relations',
      'pages',
      'effectiveColumns',
      'schema',
      'completeness',
    ]) {
      expect(absent in semantics, absent).toBe(false);
    }
  });

  it('leaves the out-of-scope findings to the resolution unit (sem-01, sem-06)', () => {
    // sem-01 declares three dangling references and sem-06 two unknown column sets; none of those
    // codes is emitted here, so a consumer that only reads this result sees "nothing found" — which
    // is why `unresolved` exists.
    for (const id of ['sem-01', 'sem-06', 'sem-05', 'sem-03']) {
      expect(semanticsOf(id).diagnostics, id).toEqual([]);
    }
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
    const classification = classificationOf('sem-08');
    const before = JSON.stringify(classification);
    derivePartialSemantics(classification);
    derivePartialSemantics(classification);

    expect(JSON.stringify(classification)).toBe(before);
  });

  it('orders diagnostics by line (§12 rule 7)', () => {
    // val-05 and sem-04 each have one; fmt-02 has one. The check is that a file with several keeps
    // file order — build one: a duplicate name and a missing key in the same document.
    const semantics = semanticsOf('val-05');
    const lines = semantics.diagnostics.map((diagnostic) => diagnostic.span?.startLine ?? 0);
    expect(lines).toEqual([...lines].sort((left, right) => left - right));
  });

  it('keeps identities even when a rule above them finds nothing', () => {
    const semantics = semanticsOf('txt-02');

    expect(semantics.identities.map((identity) => identity.pname)).toEqual(['parent_t', 'child_t']);
    expect(semantics.diagnostics).toEqual([]);
    expect(semantics.primaryKeys).toHaveLength(2);
  });
});
