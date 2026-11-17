/**
 * Page resolution (`architecture.md` §9.3, P9, P11, F5).
 *
 * The assertions below come from the specification's own wording: `PageInfo` is a four-element value
 * (P11), page names are unique *without* case (P11), and a placement's page reference matches them
 * case-insensitively (`基本構造`'s sample declares `PageInfo="Main"` and places a relation on
 * `"MAIN"`, P9). Nothing here reads a coordinate or a layout: those are presentation (`§P11`
 * "not planned").
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { pagesOf } from '../src/semantic/pages.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { semanticsOf } from './helpers/classified.js';

/** Page findings of an inline document. */
function pagesOfText(text: string) {
  return pagesOf(classify(scanSource({ text, format: 21 })));
}

describe('PageInfo is the documented four-element value (P11)', () => {
  it('reads name, display mode, paper size and background (fmt-01)', () => {
    const result = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4Landscape","$FFFFFF"\n[Entity]\nPName="e"\nPosition="Main",1,1\n',
    );
    const page = result.pages[0];

    expect(result.pages).toHaveLength(1);
    expect(page).toMatchObject({
      name: 'Main',
      displayMode: 3,
      paperSize: 'A4Landscape',
      background: '$FFFFFF',
      elementsSeen: 4,
      shape: 'documented',
    });
    expect(page?.span.keyLine).toBe(2);
    // The whole value is kept, including the elements that were interpreted.
    expect(page?.raw).toBe('"Main",3,"A4Landscape","$FFFFFF"');
  });

  it('keeps a non-integer display mode as null without dropping the declaration', () => {
    const page = pagesOfText('[Manager]\nPageInfo="Main",many,"A4","$FFFFFF"\n').pages[0];

    expect(page?.displayMode).toBeNull();
    expect(page?.paperSize).toBe('A4');
    expect(page?.rawElements[1]?.raw).toBe('many');
  });

  it('marks a declaration that is not four elements, keeping every element', () => {
    const page = pagesOfText('[Manager]\nPageInfo="Main",3,"A4Landscape","$FFFFFF","extra"\n')
      .pages[0];

    expect(page?.shape).toBe('unexpected-element-count');
    expect(page?.elementsSeen).toBe(5);
    expect(page?.rawElements).toHaveLength(5);
  });

  it('retains duplicate declarations without merging them (P11)', () => {
    const result = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\nPageInfo="main",2,"A3","$000000"\n',
    );

    expect(result.pages).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.declarations.map((page) => page.name)).toEqual(['Main', 'main']);
  });
});

describe('page references resolve case-insensitively, verbatim (P9, F5)', () => {
  it('resolves "MAIN" to the declared "Main" and keeps the spelling (sem-02)', () => {
    const semantics = semanticsOf('sem-02');
    const reference = semantics.pageReferences[0];

    expect(reference).toMatchObject({
      declared: 'MAIN',
      status: 'resolved',
      resolvedPage: 'Main',
    });
    expect(reference?.span.keyLine).toBe(9);
    // Nothing was rewritten and nothing was reported: the match is the documented one.
    expect(semantics.diagnostics).toEqual([]);
  });

  it('reports a placement on a page nobody declared (sem-01)', () => {
    const semantics = semanticsOf('sem-01');
    const dangling = semantics.pageReferences.filter((entry) => entry.status === 'dangling');

    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({ declared: 'GhostPage', resolvedPage: null });
    expect(dangling[0]?.span.keyLine).toBe(21);

    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_DANGLING_ENTITY', 'V_DANGLING_COLUMN', 'V_DANGLING_PAGE'],
    );
    const page = semantics.diagnostics.find((diagnostic) => diagnostic.code === 'V_DANGLING_PAGE');
    expect(page?.severity).toBe('warning');
    expect(page?.details).toEqual({ page: 'GhostPage', section: 'Relation' });
  });

  it('resolves every placement of a two-page document (txt-01)', () => {
    const semantics = semanticsOf('txt-01');

    expect(semantics.pages.map((page) => page.name)).toEqual(['Main', 'Detail']);
    expect(semantics.pageReferences).toHaveLength(6);
    expect(semantics.pageReferences.every((entry) => entry.status === 'resolved')).toBe(true);
    // Every reference resolves, so page resolution itself has nothing to report. The document's
    // info findings are about its views (§9.6), which this file does not judge.
    expect(
      semantics.diagnostics.filter((diagnostic) => diagnostic.code === 'V_DANGLING_PAGE'),
    ).toEqual([]);
  });

  it('treats a case-variant duplicate as ambiguous rather than binding one of them', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\nPageInfo="main",2,"A3","$000000"\n' +
        '[Entity]\nPName="e"\nPosition="MAIN",1,1\n',
    );

    expect(semantics.duplicates).toHaveLength(1);
    expect(semantics.references[0]?.status).toBe('ambiguous');
    expect(semantics.references[0]?.resolvedPage).toBeNull();
    // Ambiguity is retained evidence, not a dangling reference: nothing is reported as missing.
    expect(semantics.danglingReferences).toEqual([]);
  });

  it('does not resolve a reference to an unnamed declaration', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="",3,"A4","$FFFFFF"\n[Entity]\nPName="e"\nPosition="Main",1,1\n',
    );

    expect(semantics.pages).toHaveLength(1);
    expect(semantics.references[0]?.status).toBe('dangling');
  });

  it('keeps an unsupported Position shape out of the page index', () => {
    // `[Shape]`'s Position grammar is not documented, so it is not interpreted as a page reference.
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\n[Shape]\nPName="s"\nPosition="Main",1,1\n',
    );

    expect(semantics.references).toEqual([]);
    expect(semantics.danglingReferences).toEqual([]);
  });

  it('reports one dangling reference per placement', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\n[Entity]\nPName="e"\n' +
        'Position="Nowhere",1,1\nPosition="Elsewhere",2,2\n',
    );

    expect(semantics.danglingReferences.map((entry) => entry.declared)).toEqual([
      'Nowhere',
      'Elsewhere',
    ]);
  });
});
describe('reference metadata travels with the decision (stage 6-B unit 3)', () => {
  it('keeps the raw token and the resolved declaration’s own line', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\n[Entity]\nPName="e"\nPosition="main",1,1\n',
    );
    const reference = semantics.references[0];
    expect(reference).toMatchObject({
      declared: 'main',
      // The token as the file wrote it, quotes included — the declared spelling is not pasted in.
      raw: '"main"',
      status: 'resolved',
      resolvedPage: 'Main',
      resolvedSpan: semantics.pages[0]?.span,
      candidates: [],
    });
  });
  it('carries every matching declaration on an ambiguous reference, and no target', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\nPageInfo="main",2,"A3","$000000"\n' +
        '[Entity]\nPName="e"\nPosition="MAIN",1,1\n',
    );
    const reference = semantics.references[0];
    expect(reference?.status).toBe('ambiguous');
    expect(reference?.resolvedPage).toBeNull();
    expect(reference?.resolvedSpan).toBeNull();
    // File order, every declaration, each with its own spelling and line — the same records
    // `duplicates` groups, so neither list can name a member the other does not.
    expect(
      reference?.candidates.map((candidate) => [candidate.name, candidate.span.keyLine]),
    ).toEqual([
      ['Main', 2],
      ['main', 3],
    ]);
    expect(reference?.candidates).toEqual(
      semantics.duplicates[0]?.declarations.map((page) => ({ name: page.name, span: page.span })),
    );
  });
  it('keeps an unmatched token verbatim with no target and no candidate', () => {
    const semantics = pagesOfText(
      '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\n[Entity]\nPName="e"\nPosition="Ghost",1,1\n',
    );
    const reference = semantics.references[0];
    expect(reference).toMatchObject({
      declared: 'Ghost',
      raw: '"Ghost"',
      status: 'dangling',
      resolvedPage: null,
      resolvedSpan: null,
      candidates: [],
    });
    // The metadata changes nothing about what is reported.
    expect(semantics.danglingReferences).toEqual([reference]);
  });
});
