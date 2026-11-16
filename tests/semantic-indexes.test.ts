/**
 * Legacy-only index data (`architecture.md` §6 row 6, §11 `V_INDEX_LEGACY_ONLY`; D5, L6, U7).
 *
 * The finding exists because §6 decodes both index spellings: the specification tells readers to
 * ignore `Index`/`IndexOption`, and doing that literally would make every index in an older file
 * disappear. So the legacy data is decoded and, when it is the *only* evidence, reported — with the
 * profile recorded on the finding so a consumer can tell "declared legacy by version" (fmt-02,
 * `FORMAT:19`) from "legacy by compatibility" (sem-04, `FORMAT:21`).
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { legacyOnlyIndexesOf } from '../src/semantic/indexes.js';
import { scanSource } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';

/** Legacy-only findings of an inline document under `format`. */
function findingsOfText(text: string, format: number | null) {
  return legacyOnlyIndexesOf(classify(scanSource({ text, format })));
}

describe('legacy-only index data is reported with its provenance', () => {
  it('reports the FORMAT:19 file that only has Index (fmt-02)', () => {
    const semantics = semanticsOf('fmt-02');
    const finding = semantics.legacyOnlyIndexes[0];

    expect(semantics.legacyOnlyIndexes).toHaveLength(1);
    expect(finding?.object).toBe('legacy_orders');
    expect(finding?.canonicalCount).toBe(0);
    expect(finding?.profile).toMatchObject({ declared: 19, known: true, legacy: true });
    expect(finding?.span).toEqual({
      sectionIndex: 1,
      startLine: 7,
      endLine: 7,
      keyLine: 7,
    });
    // The data itself is kept, decoded and addressable.
    expect(finding?.legacyRecords.map((record) => record.name?.value)).toEqual([
      'legacy_orders_ix1',
    ]);

    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_INDEX_LEGACY_ONLY'],
    );
    expect(semantics.diagnostics[0]?.severity).toBe('warning');
    expect(semantics.diagnostics[0]?.details).toEqual({
      object: 'legacy_orders',
      declared: 19,
      legacyRecords: 1,
    });
  });

  it('reports the FORMAT:21 file whose only index data is legacy (sem-04)', () => {
    const semantics = semanticsOf('sem-04');
    const finding = semantics.legacyOnlyIndexes[0];

    expect(finding?.object).toBe('legacy_orders_21');
    expect(finding?.profile).toMatchObject({ declared: 21, known: true, legacy: false });
    expect(finding?.span.keyLine).toBe(11);
    expect(finding?.legacyRecords[0]?.columns.map((column) => column.value)).toEqual([
      'user_id',
      'created_at',
    ]);
    // Both spellings stay decoded even though the profile prefers the canonical one (§6).
    expect(classificationOf('sem-04').sections[1]?.decoded.indexes.canonical).toEqual([]);
    assertCodes(
      semantics.diagnostics.map((diagnostic) => diagnostic.code),
      ['V_INDEX_LEGACY_ONLY'],
    );
  });

  it('says nothing when canonical data exists alongside the legacy spelling', () => {
    const findings = findingsOfText(
      '[Entity]\nPName="both"\nIndexInfo="ix",1,"id", ""\nIndex=old=0,id\nPosition="M",1,1\n',
      21,
    );

    expect(findings).toEqual([]);
  });

  it('says nothing when there is no legacy data at all', () => {
    for (const id of ['fmt-01', 'val-02', 'fmt-03', 'fmt-05']) {
      expect(semanticsOf(id).legacyOnlyIndexes, id).toEqual([]);
      expect(
        semanticsOf(id).diagnostics.filter(
          (diagnostic) => diagnostic.code === 'V_INDEX_LEGACY_ONLY',
        ),
        id,
      ).toEqual([]);
    }
  });

  it('keeps one finding per object even with Index and IndexOption', () => {
    const findings = findingsOfText(
      '[Entity]\nPName="opts"\nIndex=ix=0,id\nIndexOption="ix","X"\nPosition="M",1,1\n',
      19,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.legacyRecords).toHaveLength(1);
    expect(findings[0]?.object).toBe('opts');
  });

  it('keeps the legacy payload and columns when the shape was only observed (U7)', () => {
    const findings = findingsOfText(
      '[Entity]\nPName="odd"\nIndex=not-a-known-shape\nPosition="M",1,1\n',
      21,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.legacyRecords[0]).toMatchObject({
      shape: 'unrecognised',
      raw: 'not-a-known-shape',
      name: null,
    });
  });
});
