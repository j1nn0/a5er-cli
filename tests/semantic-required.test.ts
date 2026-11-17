/**
 * Required keys (`architecture.md` §9, §11 `V_MISSING_REQUIRED_KEY`; §5's registry, §7.2, K6).
 *
 * Two things are pinned here, both from the committed catalog rather than from the implementation:
 *
 * - **count** — one finding per subject (section or column), not one per absent key. txt-09's empty
 *   `[Relation]` omits seven required keys and the catalog records a single finding;
 * - **location** — the section's header line for a section, the `Field` line for a column
 *   (sem-09 line 3, sem-10 line 7, txt-09 line 11, val-05 line 5).
 *
 * Severity comes from §11's own wording for this code: "warning or error", error for identity and
 * `PageInfo`.
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { missingRequiredKeysOf } from '../src/semantic/required.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';

/** Required-key findings of an inline document. */
function findingsOfText(text: string) {
  return missingRequiredKeysOf(classify(scanSource({ text, format: 21 })));
}

/**
 * The findings about a section or a column.
 *
 * A document with no `[Manager]` additionally reports the document-level `PageInfo` (R22), which is
 * a different subject; tests that are about a specific section filter it out and the R22 cases
 * assert it directly.
 */
function subjectFindings(text: string) {
  return findingsOfText(text).filter((finding) => finding.subject !== 'document');
}

describe('a missing required key is reported once per subject', () => {
  it('reports PageInfo as an error on the [Manager] header (sem-09)', () => {
    const semantics = semanticsOf('sem-09');
    const findings = semantics.missingRequired;

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      subject: 'section',
      sectionKind: 'Manager',
      keys: ['PageInfo'],
      severity: 'error',
      column: null,
    });
    expect(findings[0]?.span).toEqual({
      sectionIndex: 1,
      startLine: 3,
      endLine: 3,
      keyLine: 3,
    });

    const diagnostic = semantics.diagnostics.find(
      (entry) => entry.code === 'V_MISSING_REQUIRED_KEY',
    );
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.details).toEqual({
      keys: 'PageInfo',
      subject: 'section',
      section: 'Manager',
      column: null,
    });
  });

  it('reports a missing Position as a warning on the [Entity] header (sem-10)', () => {
    const semantics = semanticsOf('sem-10');

    expect(semantics.missingRequired).toHaveLength(1);
    expect(semantics.missingRequired[0]).toMatchObject({
      sectionKind: 'Entity',
      keys: ['Position'],
      severity: 'warning',
    });
    expect(semantics.missingRequired[0]?.span.keyLine).toBe(7);
    expect(
      semantics.diagnostics.find((entry) => entry.code === 'V_MISSING_REQUIRED_KEY')?.severity,
    ).toBe('warning');
  });

  it('collapses seven absent [Relation] keys into one finding (txt-09)', () => {
    const semantics = semanticsOf('txt-09');

    expect(semantics.missingRequired).toHaveLength(1);
    expect(semantics.missingRequired[0]?.keys).toEqual([
      'Entity1',
      'Entity2',
      'Fields1',
      'Fields2',
      'RelationType1',
      'RelationType2',
      'Position',
    ]);
    expect(semantics.missingRequired[0]?.span.keyLine).toBe(11);
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_MISSING_REQUIRED_KEY'],
    );
  });

  it('reports a column without a colour on the Field line (val-05, §7.2)', () => {
    const semantics = semanticsOf('val-05');
    const finding = semantics.missingRequired[0];

    expect(semantics.missingRequired).toHaveLength(1);
    expect(finding).toMatchObject({
      subject: 'column',
      keys: ['color'],
      severity: 'warning',
      column: 'phys_name',
    });
    expect(finding?.span.keyLine).toBe(5);
    // The syntax stage warned about the same span; §7.2 keeps the two layers apart (S_ never V_).
    const arity = classificationOf('val-05').diagnostics.filter((entry) =>
      entry.code.startsWith('S_FIELD'),
    );
    expect(arity).toHaveLength(1);
    expect(arity[0]?.span).toEqual(finding?.span);
  });

  it('says nothing when every required key is present', () => {
    for (const id of ['fmt-01', 'txt-01', 'val-06', 'sem-07', 'sem-11']) {
      expect(semanticsOf(id).missingRequired, id).toEqual([]);
    }
  });
});

describe('scope and granularity', () => {
  it('judges a repeated [Manager] as one document-level block (txt-06)', () => {
    // Both Manager sections declare PageInfo, and the manager's required set is document-wide.
    expect(semanticsOf('txt-06').missingRequired).toEqual([]);
  });

  it('does not invent a default for a required key (K6)', () => {
    // `RelationType1` has a documented default of 1, which K6 says to reject in favour of 必須.
    const findings = subjectFindings('[Relation]\nEntity1="a"\nEntity2="b"\nPosition="M",1,1\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.keys).toEqual(['Fields1', 'Fields2', 'RelationType1', 'RelationType2']);
  });

  it('lists several absent keys of one object in registry order', () => {
    const findings = subjectFindings('[Comment]\nPName="note"\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.keys).toEqual(['Position', 'Width', 'Height']);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('treats a missing identity key as an error, not a warning (synthetic edge)', () => {
    const findings = subjectFindings('[Entity]\nComment="x"\nPosition="M",1,1\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.keys).toEqual(['PName']);
    expect(findings[0]?.severity).toBe('error');
  });

  it('ignores unknown sections, which have no registry to consult (§5)', () => {
    // An unknown section is not a page user either, so the document-level PageInfo finding is
    // absent as well: a memo-only file reports nothing at all.
    expect(findingsOfText('[Memo]\nNote="x"\n')).toEqual([]);
  });
});

describe('R22 — PageInfo is required by the document, not by [Manager]', () => {
  it('reports the absent PageInfo when a file has objects and no [Manager]', () => {
    const findings = findingsOfText('[Entity]\nPName="no_manager"\nPosition="Main",10,10\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      subject: 'document',
      sectionKind: 'Manager',
      keys: ['PageInfo'],
      severity: 'error',
      column: null,
    });
    // There is no manager line to point at, so the finding points at the first section header.
    expect(findings[0]?.span).toEqual({
      sectionIndex: 1,
      startLine: 1,
      endLine: 1,
      keyLine: 1,
    });
  });

  it('reports it once for a document with several page users', () => {
    const findings = findingsOfText(
      '[Entity]\nPName="a"\nPosition="M",1,1\n[View]\nPName="b"\nPosition="M",2,2\n',
    );
    const documentFindings = findings.filter((finding) => finding.subject === 'document');

    expect(documentFindings).toHaveLength(1);
    expect(documentFindings[0]?.keys).toEqual(['PageInfo']);
  });

  it('says nothing when a [Manager] declares its pages, and nothing for a page-free file', () => {
    expect(
      findingsOfText(
        '[Manager]\nPageInfo="Main",3,"A4","$FFFFFF"\n[Entity]\nPName="a"\nPosition="Main",1,1\n',
      ),
    ).toEqual([]);
    // A document that places nothing on a page does not need one.
    expect(findingsOfText('[Memo]\nNote="x"\n')).toEqual([]);
  });

  it('still reports a [Manager] that exists but omits PageInfo (sem-09)', () => {
    const findings = semanticsOf('sem-09').missingRequired;

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('section');
    expect(findings[0]?.keys).toEqual(['PageInfo']);
  });

  it('does not double-report for repeated [Manager] sections (txt-06)', () => {
    expect(semanticsOf('txt-06').missingRequired).toEqual([]);
  });
});
