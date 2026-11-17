/**
 * Subtypes (`architecture.md` §4.4, §9.6; `format-coverage.md` F7, D6, K11, U11).
 *
 * `[Subtype]` has five keys and **no membership key at all** (K11), so the only honest answer to
 * "which entities belong to this subtype?" is `unsupported`. These tests pin what that forbids and
 * what it still requires:
 *
 * - **No member list exists in the shape.** There is no `entities` or `members` member, so a
 *   consumer cannot read a list that was never stated, and an empty array cannot claim "none".
 * - **Nothing is inferred** — not from the subtype's name, not from its `Position` overlapping an
 *   entity's, not from declaration order (A14, D6).
 * - **The object's own keys are still read**, and a token that does not decode stays distinguishable
 *   from an absent key: `SharedMode`/`CompleteCategory` are untyped in the specification and are
 *   never coerced, `ZOrder` goes through the same strict integer rule as everything else (R19).
 *
 * One `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` per subtype is emitted in `partial.ts`; the counts here are
 * multiset assertions (test-strategy §7 T2).
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { subtypesOf } from '../src/semantic/subtypes.js';
import type { SubtypeDeclaration } from '../src/semantic/subtypes.js';
import { semanticsOf } from './helpers/classified.js';
import { assertCodes } from './helpers/assert-codes.js';

const MANAGER = '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n';

/** One `[Manager]` plus one `[Subtype]` with the given body lines. */
function subtype(body: string): string {
  return `${MANAGER}[Subtype]\n${body}`;
}

/** Subtypes of an inline document. */
function subtypesOfText(text: string): readonly SubtypeDeclaration[] {
  return subtypesOf(classify(scanSource({ text, format: 21 }))).subtypes;
}

/** The bounded semantics of an inline document. */
function semanticsOfText(text: string) {
  return derivePartialSemantics(classify(scanSource({ text, format: 21 })));
}

describe('membership is unsupported, never empty (§9.6, F7, D6)', () => {
  it('reports the subtype of sem-05 with the documented reason', () => {
    const semantics = semanticsOf('sem-05');
    const entry = semantics.subtypes[0];

    expect(semantics.subtypes).toHaveLength(1);
    expect(entry).toMatchObject({
      sectionIndex: 3,
      pname: 'unknown_membership',
      headerRaw: '[Subtype]',
    });
    expect(entry?.membership).toEqual({
      status: 'unsupported',
      reason: 'no-membership-key-in-v2.21',
    });
    // Two anchors, two claims (R31). `span` is the finding anchor — the most specific line the
    // file has, the `PName` line — while `headerSpan` is the line `headerRaw` was actually read
    // from. Text and its provenance travel together, so a consumer that quotes the header cannot
    // be handed a span pointing somewhere else (§4.2, §12 rule 4).
    expect(entry?.span).toEqual({ sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 });
    expect(entry?.headerSpan).toEqual({ sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 });
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_UNSUPPORTED_SUBTYPE_MEMBERSHIP'],
    );
    expect(semantics.diagnostics[0]?.severity).toBe('info');
    expect(semantics.diagnostics[0]?.construct).toBe('Subtype');
    expect(semantics.diagnostics[0]?.span?.keyLine).toBe(12);
  });

  it('has no member list at all, so no entity can be guessed', () => {
    const entry = semanticsOf('sem-05').subtypes[0];

    expect(entry === undefined ? null : Object.keys(entry.membership)).toEqual([
      'status',
      'reason',
    ]);
    for (const absent of ['entities', 'members', 'entityNames', 'memberNames']) {
      expect(entry === undefined ? null : absent in entry.membership, absent).toBe(false);
    }
  });

  it('does not turn a neighbouring entity into a member', () => {
    const semantics = semanticsOf('sem-05');

    // The fixture declares one entity and one subtype, both on "Main"; proximity is not membership.
    expect(semantics.identities.map((identity) => [identity.kind, identity.pname])).toEqual([
      ['Entity', 'subtype_member'],
      ['Subtype', 'unknown_membership'],
    ]);
    expect(semantics.subtypes[0]?.membership.status).toBe('unsupported');
  });
});

describe("the subtype's own keys are read, never coerced (P13, R19)", () => {
  it('keeps SharedMode, CompleteCategory, Position and ZOrder of sem-05', () => {
    const entry = semanticsOf('sem-05').subtypes[0];

    // Both untyped keys are strings in the specification, so they stay text.
    expect(entry?.sharedMode).toMatchObject({ value: '0', raw: '0', token: 'declared' });
    expect(entry?.completeCategory).toMatchObject({ value: '0', raw: '0', token: 'declared' });
    expect(entry?.zOrder).toMatchObject({ value: 1, raw: '1', token: 'declared' });
    expect(entry?.positions).toHaveLength(1);
    expect(entry?.positions[0]?.span.keyLine).toBe(15);
    expect(entry?.unknownEntries).toEqual([]);
  });

  it('keeps a quoted SharedMode as text, not as the number 0', () => {
    const entry = subtypesOfText(
      subtype('PName="s"\nSharedMode="0"\nCompleteCategory="all"\nPosition="M",1,1\n'),
    )[0];

    expect(entry?.sharedMode).toEqual({
      value: '0',
      raw: '"0"',
      span: expect.objectContaining({ keyLine: 5 }),
      token: 'declared',
    });
    expect(entry?.completeCategory.value).toBe('all');
  });

  it('distinguishes an absent key from a token that did not decode', () => {
    const absent = subtypesOfText(subtype('PName="s"\nPosition="M",1,1\n'))[0];
    const broken = subtypesOfText(subtype('PName="s"\nZOrder=1.5\nPosition="M",1,1\n'))[0];

    // Absent: nothing in the file, so no raw and no span either.
    expect(absent?.zOrder).toEqual({ value: null, raw: null, span: null, token: 'absent' });
    expect(absent?.sharedMode.token).toBe('absent');
    expect(absent?.completeCategory.token).toBe('absent');
    // Broken: the value is unknown *and* the token is preserved, so it cannot pass for missing.
    expect(broken?.zOrder).toEqual({
      value: null,
      raw: '1.5',
      span: expect.objectContaining({ keyLine: 5 }),
      token: 'unrecognised',
    });
    // `1.5` is not an ordinal, an integer or a Z-order value: R19's rule, not `Number()`.
    expect(broken?.zOrder.value).toBeNull();
  });

  it('rejects an unsafe integer rather than rounding it', () => {
    const entry = subtypesOfText(
      subtype('PName="s"\nZOrder=9007199254740993\nPosition="M",1,1\n'),
    )[0];

    expect(entry?.zOrder.value).toBeNull();
    expect(entry?.zOrder.token).toBe('unrecognised');
    expect(entry?.zOrder.raw).toBe('9007199254740993');
  });

  it('keeps every repeated Position and the last scalar occurrence (§4.2, P11)', () => {
    const entry = subtypesOfText(
      subtype(
        'PName="s"\nCompleteCategory=1\nCompleteCategory=2\n' +
          'Position="M",1,1\nPosition="M",2,2\nPosition="M",3,3\n',
      ),
    )[0];

    expect(entry?.positions.map((position) => position.span.keyLine)).toEqual([7, 8, 9]);
    expect(entry?.completeCategory).toMatchObject({
      value: '2',
      span: expect.objectContaining({ keyLine: 6 }),
    });
  });
});

describe('adversarial subtypes (§14 row 15, K11)', () => {
  it('keeps a subtype that declares no PName, reporting on its header', () => {
    const text = subtype('SharedMode=1\nPosition="M",1,1\n');
    const semantics = semanticsOfText(text);
    const entry = semantics.subtypes[0];

    expect(entry?.pname).toBeNull();
    expect(entry?.pnameSpans).toEqual([]);
    // Without a `PName` the two anchors coincide: the header is both the most specific line the
    // file has and the line `headerRaw` came from.
    expect(entry?.span).toEqual({ sectionIndex: 2, startLine: 3, endLine: 3, keyLine: 3 });
    expect(entry?.headerSpan).toEqual({ sectionIndex: 2, startLine: 3, endLine: 3, keyLine: 3 });
    expect(entry?.membership.status).toBe('unsupported');
    // The absent name is the required-key finding; membership is still its own finding.
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_MISSING_REQUIRED_KEY', 'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP'],
    );
  });

  it('keeps unknown keys of a subtype as raw entries with their spans', () => {
    const semantics = semanticsOfText(subtype('PName="s"\nSomeFutureKey=1\nPosition="M",1,1\n'));
    const entry = semantics.subtypes[0];

    expect(entry?.unknownEntries).toHaveLength(1);
    expect(entry?.unknownEntries[0]).toMatchObject({
      kind: 'unknown-key',
      key: 'SomeFutureKey',
      raw: 'SomeFutureKey=1',
      span: expect.objectContaining({ keyLine: 5 }),
    });
    // The unknown key is reported by the registry stage, and the membership finding is not lost.
    expect(semantics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
    );
  });

  it('keeps both subtypes when two declare the same PName', () => {
    const semantics = semanticsOfText(
      subtype('PName="dup"\nPosition="M",1,1\n') + '[Subtype]\nPName="dup"\nPosition="M",2,2\n',
    );

    expect(semantics.subtypes.map((entry) => entry.pname)).toEqual(['dup', 'dup']);
    expect(semantics.subtypes.map((entry) => entry.sectionIndex)).toEqual([2, 3]);
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      [
        'V_DUPLICATE_OBJECT_NAME',
        'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
        'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
      ],
    );
  });

  it('emits exactly one code for each subtype', () => {
    for (const count of [0, 1, 2, 3]) {
      const body = Array.from(
        { length: count },
        (_, index) => `[Subtype]\nPName="s${String(index)}"\nPosition="M",1,1\n`,
      ).join('');
      const semantics = semanticsOfText(`${MANAGER}${body}`);

      expect(semantics.subtypes).toHaveLength(count);
      expect(
        semantics.diagnostics.filter(
          (diagnostic) => diagnostic.code === 'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
        ),
      ).toHaveLength(count);
      const indexes = semantics.subtypes.map((entry) => entry.sectionIndex);
      expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    }
  });

  it('leaves an entity-only document with no subtype finding at all', () => {
    const semantics = semanticsOfText(
      `${MANAGER}[Entity]\nPName="e"\nField="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n`,
    );

    expect(semantics.subtypes).toEqual([]);
    expect(semantics.diagnostics).toEqual([]);
  });
});
