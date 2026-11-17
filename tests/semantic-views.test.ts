/**
 * Views (`architecture.md` §4.3, §4.5, §9.6, P6, P10, P13; `format-coverage.md` F6, K4).
 *
 * A view has no `Field` (P6), so its columns cannot be read out of the file — and the shape has to
 * say that rather than hand back an empty list. The tests below pin the three things that go wrong
 * when a reader is optimistic:
 *
 * 1. **`columns: []` never appears.** `effectiveColumns` has no `columns` member at all, so "this
 *    view has zero columns" is not expressible; every view is `unknown` with a reason.
 * 2. **`Query` is one `String`, untouched.** Not trimmed, not re-escaped, not split on `;`, and a
 *    value broken across two physical lines is **not** joined (P13, U12, `val-08`).
 * 3. **`LNameByComment` moves the reason, not the fact.** `1` selects
 *    `view-columns-named-from-query`; `0`, an absent key and an unusable token leave
 *    `view-columns-not-stored`. v2.21 states no default for the key, so absent stays absent.
 *
 * One `V_VIEW_COLUMNS_UNKNOWN` per view is emitted in `partial.ts`; every count here is a multiset
 * assertion, because "at least one" would let a second emission hide (test-strategy §7 T2).
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { scanSource } from '../src/syntax/scanner.js';
import { classifyType, domainsOf } from '../src/semantic/domains.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { viewsOf } from '../src/semantic/views.js';
import type { ViewDeclaration } from '../src/semantic/views.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';
import { assertCodes } from './helpers/assert-codes.js';

const MANAGER = '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n';

/** One `[Manager]` plus one `[View]` with the given body lines. */
function view(body: string): string {
  return `${MANAGER}[View]\n${body}`;
}

/** Views of an inline document. */
function viewsOfText(text: string): readonly ViewDeclaration[] {
  return viewsOf(classify(scanSource({ text, format: 21 }))).views;
}

/** Every semantic diagnostic code of one inline document, in file order. */
function codesOfText(text: string): string[] {
  const classification = classify(scanSource({ text, format: 21 }));
  return derivePartialSemantics(classification).diagnostics.map((diagnostic) => diagnostic.code);
}

describe('a view states its columns as unknown, never as empty (§9.6, P10)', () => {
  it('reports both views of sem-06 with the reason their flag selects', () => {
    const views = semanticsOf('sem-06').views;

    expect(views).toHaveLength(2);
    expect(views.map((entry) => entry.pname)).toEqual(['view_with_lname', 'plain_view']);
    expect(views.map((entry) => entry.effectiveColumns)).toEqual([
      { status: 'unknown', reason: 'view-columns-named-from-query' },
      { status: 'unknown', reason: 'view-columns-not-stored' },
    ]);
    // The flag itself is kept with its provenance, so the reason is auditable.
    expect(views[0]?.lnameByComment).toEqual({
      value: true,
      origin: 'declared',
      raw: '1',
      span: expect.objectContaining({ keyLine: 9 }),
      token: 'one',
    });
    // A plain view declares no flag: no value is assumed, because v2.21 states no default.
    expect(views[1]?.lnameByComment).toEqual({
      value: null,
      origin: 'absent',
      raw: '',
      span: null,
      token: 'absent',
    });
    expect(views.map((entry) => entry.sectionIndex)).toEqual([2, 3]);
    expect(views.map((entry) => entry.span.keyLine)).toEqual([7, 13]);
  });

  it('has no `columns` member at all, so an empty list cannot be read as a fact', () => {
    const entry = semanticsOf('sem-06').views[0];

    expect(entry === undefined ? null : Object.keys(entry.effectiveColumns)).toEqual([
      'status',
      'reason',
    ]);
    expect(entry === undefined ? null : 'columns' in entry.effectiveColumns).toBe(false);
    // The view stores no `Field` line either, which is why its columns cannot be enumerated (P6).
    expect(classificationOf('sem-06').sections[2]?.decoded.fields).toEqual([]);
  });

  it('keeps every view of a multi-view document and its query verbatim (txt-01)', () => {
    const views = semanticsOf('txt-01').views;

    expect(views.map((entry) => entry.pname)).toEqual(['active_users', 'order_summary']);
    expect(views.map((entry) => entry.query)).toEqual([
      'SELECT * FROM users WHERE email IS NOT NULL',
      'SELECT user_id, COUNT(*) FROM orders GROUP BY user_id',
    ]);
    expect(views.map((entry) => entry.effectiveColumns.reason)).toEqual([
      'view-columns-not-stored',
      'view-columns-not-stored',
    ]);
    // One placement each: a placement is not a column and not an extra view (§P11).
    expect(views.map((entry) => entry.positions.length)).toEqual([1, 1]);
  });

  it('reports the single view of the baseline document (fmt-01)', () => {
    const semantics = semanticsOf('fmt-01');
    const entry = semantics.views[0];

    expect(semantics.views).toHaveLength(1);
    expect(entry?.pname).toBe('active_users');
    expect(entry?.query).toBe('SELECT * FROM users WHERE active = 1');
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_VIEW_COLUMNS_UNKNOWN'],
    );
    expect(semantics.diagnostics[0]?.severity).toBe('info');
    expect(semantics.diagnostics[0]?.construct).toBe('View');
    // The finding points at the view's own `PName` line — the most specific line it has.
    expect(semantics.diagnostics[0]?.span?.keyLine).toBe(entry?.span.keyLine);
    expect(entry?.span.keyLine).toBeGreaterThan(1);
  });

  it('keeps the view beside a colliding entity name (sem-08)', () => {
    const semantics = semanticsOf('sem-08');

    expect(semantics.views.map((entry) => entry.pname)).toEqual(['twin']);
    // The identity collision is an error and the unknown columns an info: neither replaces the
    // other, and the view is not dropped when its name is taken (§4.3, L2).
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_DUPLICATE_OBJECT_NAME', 'V_VIEW_COLUMNS_UNKNOWN'],
    );
    // Both findings name the view's `PName` line: the later declaration of the shared name is the
    // view, and it is also the object whose columns are unknown.
    expect(semantics.diagnostics.map((diagnostic) => diagnostic.span?.keyLine)).toEqual([
      semantics.views[0]?.span.keyLine,
      semantics.views[0]?.span.keyLine,
    ]);
  });
});

describe('Query is one String, kept whole (P13, U12)', () => {
  it('decodes quotes away and touches nothing else', () => {
    const entry = viewsOfText(
      view('PName="v"\nQuery="  SELECT a, b  FROM t WHERE x = \\Qq\\Q "\nPosition="M",1,1\n'),
    )[0];

    // No trimming, no escape processing, no splitting: `String` means the text between the quotes.
    expect(entry?.query).toBe('  SELECT a, b  FROM t WHERE x = \\Qq\\Q ');
    expect(entry?.queryRaw).toBe('"  SELECT a, b  FROM t WHERE x = \\Qq\\Q "');
    expect(entry?.querySpan).toEqual(expect.objectContaining({ keyLine: 5 }));
  });

  it('does not join a value broken across two physical lines (val-08)', () => {
    const semantics = semanticsOf('val-08');

    // The token never closed, so nothing was unquoted: the value is the file's text, unchanged.
    expect(semantics.views[0]?.queryRaw).toBe('"SELECT id');
    expect(semantics.views[0]?.query).toBe('"SELECT id');
    // The continuation line is its own malformed line; the view still reports unknown columns.
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_VIEW_COLUMNS_UNKNOWN'],
    );
    expect(semantics.views[0]?.effectiveColumns.reason).toBe('view-columns-not-stored');
  });

  it('keeps a semicolon-joined query as one value', () => {
    const entry = viewsOfText(view('PName="v"\nQuery="SELECT 1; SELECT 2"\nPosition="M",1,1\n'))[0];

    expect(entry?.query).toBe('SELECT 1; SELECT 2');
  });

  it('reports a view that declares no query at all', () => {
    const entry = viewsOfText(view('PName="v"\nPosition="M",1,1\n'))[0];

    expect(entry?.query).toBeNull();
    expect(entry?.queryRaw).toBeNull();
    expect(entry?.querySpan).toBeNull();
    // No query and no columns are two different absences; the column state does not become empty.
    expect(entry?.effectiveColumns).toEqual({
      status: 'unknown',
      reason: 'view-columns-not-stored',
    });
  });
});

describe('LNameByComment moves the reason, never the fact (P10)', () => {
  it('selects the query reason on 1 and the stored-none reason on 0', () => {
    const views = viewsOfText(
      view('PName="a"\nLNameByComment=1\nPosition="M",1,1\n') +
        '[View]\nPName="b"\nLNameByComment=0\nPosition="M",1,1\n',
    );

    expect(views.map((entry) => entry.lnameByComment.value)).toEqual([true, false]);
    expect(views.map((entry) => entry.lnameByComment.token)).toEqual(['one', 'zero']);
    expect(views.map((entry) => entry.effectiveColumns.reason)).toEqual([
      'view-columns-named-from-query',
      'view-columns-not-stored',
    ]);
  });

  it('leaves an unusable token indeterminate instead of reading it as 0', () => {
    const views = viewsOfText(view('PName="v"\nLNameByComment=2\nPosition="M",1,1\n'));

    expect(views[0]?.lnameByComment).toEqual({
      value: null,
      origin: 'invalid',
      raw: '2',
      span: expect.objectContaining({ keyLine: 5 }),
      token: 'unrecognised',
    });
    // The reason falls back to the answer that claims less, and the flag stays visible as broken.
    expect(views[0]?.effectiveColumns.reason).toBe('view-columns-not-stored');
    // §11 has no code for an undecodable flag, so the model carries it and nothing is invented.
    assertCodes(codesOfText(view('PName="v"\nLNameByComment=2\nPosition="M",1,1\n')), [
      'V_VIEW_COLUMNS_UNKNOWN',
    ]);
  });

  it('lists a view with a broken flag as indeterminate', () => {
    const semantics = derivePartialSemantics(
      classify(
        scanSource({
          text: view('PName="v"\nLNameByComment=yes\nPosition="M",1,1\n'),
          format: 21,
        }),
      ),
    );

    expect(semantics.views[0]?.lnameByComment.origin).toBe('invalid');
    expect(semantics.views[0]?.lnameByComment.value).toBeNull();
    expect(semantics.views[0]?.lnameByComment.raw).toBe('yes');
    expect(semantics.indeterminateViewNames.map((entry) => entry.pname)).toEqual(['v']);
  });

  it('takes the last occurrence when the flag repeats (§4.2)', () => {
    const views = viewsOfText(
      view('PName="v"\nLNameByComment=1\nLNameByComment=0\nPosition="M",1,1\n'),
    );

    expect(views[0]?.lnameByComment.value).toBe(false);
    expect(views[0]?.lnameByComment.span).toEqual(expect.objectContaining({ keyLine: 6 }));
    expect(views[0]?.effectiveColumns.reason).toBe('view-columns-not-stored');
  });
});

describe('adversarial views (§14 row 15, §9.6)', () => {
  it('keeps a view that declares no PName, reporting on its header', () => {
    const text = view('Query="SELECT 1"\nPosition="M",1,1\n');
    const views = viewsOfText(text);
    const semantics = derivePartialSemantics(classify(scanSource({ text, format: 21 })));

    expect(views).toHaveLength(1);
    expect(views[0]?.pname).toBeNull();
    expect(views[0]?.pnameSpans).toEqual([]);
    // The span falls back to the `[View]` header: a real line, not a fabricated one.
    expect(views[0]?.span).toEqual({ sectionIndex: 2, startLine: 3, endLine: 3, keyLine: 3 });
    expect(views[0]?.effectiveColumns.reason).toBe('view-columns-not-stored');
    // The absent name is the required-key finding; the unknown columns is still its own finding.
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_MISSING_REQUIRED_KEY', 'V_VIEW_COLUMNS_UNKNOWN'],
    );
  });

  it('keeps both views when two declare the same PName', () => {
    const text =
      view('PName="dup"\nPosition="M",1,1\n') + '[View]\nPName="dup"\nPosition="M",2,2\n';
    const semantics = derivePartialSemantics(classify(scanSource({ text, format: 21 })));

    expect(semantics.views.map((entry) => entry.pname)).toEqual(['dup', 'dup']);
    expect(semantics.views.map((entry) => entry.sectionIndex)).toEqual([2, 3]);
    // Two objects kept, one collision reported, and one column finding per view.
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_DUPLICATE_OBJECT_NAME', 'V_VIEW_COLUMNS_UNKNOWN', 'V_VIEW_COLUMNS_UNKNOWN'],
    );
  });

  it('keeps every repeated placement, and placements do not change column knowledge', () => {
    const views = viewsOfText(
      view('PName="v"\nQuery="SELECT 1"\nPosition="M",1,1\nPosition="M",2,2\nPosition="M",3,3\n'),
    );

    expect(views).toHaveLength(1);
    expect(views[0]?.positions).toHaveLength(3);
    expect(views[0]?.positions.map((position) => position.span.keyLine)).toEqual([6, 7, 8]);
    // §9.6: `Position` count is a placement fact, not a column fact.
    expect(views[0]?.effectiveColumns).toEqual({
      status: 'unknown',
      reason: 'view-columns-not-stored',
    });
    expect(codesOfText(view('PName="v"\nPosition="M",1,1\nPosition="M",2,2\n'))).toEqual([
      'V_VIEW_COLUMNS_UNKNOWN',
    ]);
  });

  it('does not treat a `Field` line on a view as a column (P6)', () => {
    const classification = classify(
      scanSource({
        text: view('PName="v"\nField="L","c","Integer","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n'),
        format: 21,
      }),
    );
    const entry = viewsOf(classification).views[0];

    // The key is not registered for `View`, so it is preserved raw with a warning — never decoded
    // into a column list this module could then present as the view's own.
    expect(entry === undefined ? null : 'columns' in entry.effectiveColumns).toBe(false);
    expect(classification.sections[1]?.decoded.fields).toEqual([]);
    expect(entry?.effectiveColumns.reason).toBe('view-columns-not-stored');
  });

  it('does not report a view query as a domain reference (§9.4 stays separate)', () => {
    const classification = classify(
      scanSource({
        text: view('PName="v"\nQuery="SELECT id FROM t"\nPosition="M",1,1\n'),
        format: 21,
      }),
    );

    expect(domainsOf(classification).references).toEqual([]);
    expect(classifyType('SELECT id FROM t', new Map())).toEqual({ kind: 'plain' });
  });
});

describe('one record per view, one code per record (§9.6, §11)', () => {
  const counts: readonly number[] = [0, 1, 2, 3];

  for (const count of counts) {
    it(`emits exactly one code for each of ${String(count)} view(s)`, () => {
      const body = Array.from(
        { length: count },
        (_, index) => `[View]\nPName="v${String(index)}"\nPosition="M",1,1\n`,
      ).join('');
      const text = `${MANAGER}${body}`;
      const classification = classify(scanSource({ text, format: 21 }));
      const semantics = derivePartialSemantics(classification);

      expect(semantics.views).toHaveLength(count);
      expect(
        semantics.diagnostics.filter((diagnostic) => diagnostic.code === 'V_VIEW_COLUMNS_UNKNOWN'),
      ).toHaveLength(count);
      // Stable order: one record per section, in file order (§12 rule 7).
      const indexes = semantics.views.map((entry) => entry.sectionIndex);
      expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    });
  }
});
