/**
 * The three review findings of unit 3B-1, each pinned so it cannot come back:
 *
 * - **R15 — coverage is derived, not accumulated.** `verifyCoverage` walks the stored records and
 *   demands that every source line be claimed by exactly one of them, that a section's ordinal
 *   match its position, and that no record claim a `sectionIndex` that names no section. The
 *   mutation tests below delete and duplicate records out of a real scan: a checker that stopped
 *   checking would pass them, which is why they assert the specific rule and the line.
 * - **R16 — `S_HEADER_UNKNOWN_FORMAT` points at the declaration.** The actual `# A5:ER FORMAT:`
 *   line when there is a numeric one, wherever it sits in the header region; line 1 as the
 *   documented policy when there is not.
 * - **R17 — a trailing terminator adds no line.** `decode`'s `maxLines` count and
 *   `syntax/lines.ts` must agree on every terminator combination, because two definitions of
 *   "line" is exactly the drift R15 exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { decodeBytes } from '../src/decode/decode.js';
import {
  CoverageError,
  deriveAccounting,
  scanSource,
  verifyCoverage,
} from '../src/syntax/scanner.js';
import type { CoverageInput } from '../src/syntax/scanner.js';
import { splitLines } from '../src/syntax/lines.js';
import type { SectionEntry } from '../src/syntax/scanner.js';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';
import { loadSource } from '../src/decode/load.js';

/** A small document with every line kind, so a mutation has something to break. */
const SAMPLE = ['# header', '[Entity]', 'PName="a"', '', '# inside', 'Field="x"', 'broken'].join(
  '\n',
);

function sampleInput(): CoverageInput {
  const scan = scanSource({ text: SAMPLE, format: 21 });
  return {
    lines: scan.lines,
    sections: scan.sections,
    comments: scan.comments,
    blankLines: scan.blankLines,
    header: scan.header,
  };
}

describe('R15 — coverage is derived from the records', () => {
  it('reconciles a scan that is internally consistent', () => {
    const scan = scanSource({ text: SAMPLE, format: 21 });

    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.accounting.dropped).toBe(0);
    expect(scan.accounting.lines).toEqual({
      total: 7,
      sectionHeaders: 1,
      keys: 2,
      comments: 2,
      blank: 1,
      raw: 1,
    });
  });

  it('reconciles every committed fixture and never needs a hand-written zero', () => {
    for (const spec of FIXTURES.filter((entry) => entry.fixtureClass === 'synthetic')) {
      const staged = stage(spec.id);
      try {
        const outcome = loadSource(staged.path);
        if (!outcome.ok) throw new Error(`${spec.id} did not load`);
        const scan = scanSource(outcome.source);

        expect(verifyCoverage(scan), spec.id).toEqual([]);
        expect(scan.accounting.dropped, spec.id).toBe(0);
        // The partition is stated with this fixture's own numbers, not as "dropped === 0".
        const { total, sectionHeaders, keys, comments, blank, raw } = scan.accounting.lines;
        expect(sectionHeaders + keys + comments + blank + raw, spec.id).toBe(total);
      } finally {
        staged.cleanup();
      }
    }
  });

  it('detects a line whose record was dropped', () => {
    const input = sampleInput();
    const section = input.sections[0];
    if (section === undefined) throw new Error('sample has no section');
    /** The sample's section without one of its two entries. */
    const broken: CoverageInput = {
      ...input,
      sections: [{ ...section, entries: section.entries.slice(1) }],
    };

    const violations = verifyCoverage(broken);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'uncovered-line', line: 3 });
    expect(() => deriveAccounting(broken)).toThrow(CoverageError);
  });

  it('detects a line that two records both claim', () => {
    const input = sampleInput();
    // Line 3 is a key; adding it to the blank ledger claims it twice.
    const broken: CoverageInput = { ...input, blankLines: [...input.blankLines, 3] };

    const violations = verifyCoverage(broken);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'double-covered-line', line: 3 });
    expect(violations[0]?.detail).toContain('key');
    expect(violations[0]?.detail).toContain('blank line');
    expect(() => deriveAccounting(broken)).toThrow(CoverageError);
  });

  it('detects a sectionIndex that names no section', () => {
    const input = sampleInput();
    const section = input.sections[0];
    const entry = section?.entries[0];
    if (section === undefined || entry === undefined) throw new Error('sample is empty');
    const moved: SectionEntry = { ...entry, span: { ...entry.span, sectionIndex: 7 } };
    const broken: CoverageInput = {
      ...input,
      sections: [{ ...section, entries: [moved, ...section.entries.slice(1)] }],
    };

    assertCodes(
      verifyCoverage(broken).map((violation) => violation.rule),
      ['bad-section-index'],
    );
  });

  it('detects the header region being claimed after the first header', () => {
    const input = sampleInput();
    const comment = input.comments[1];
    if (comment === undefined) throw new Error('sample has one in-section comment');
    // Line 5's comment is inside the section; claiming sectionIndex 0 would be the misuse.
    const moved = { ...comment, span: { ...comment.span, sectionIndex: 0 } };
    const broken: CoverageInput = {
      ...input,
      comments: [input.comments[0] as typeof comment, moved],
    };

    assertCodes(
      verifyCoverage(broken).map((violation) => violation.rule),
      ['header-region-misuse'],
    );
  });

  it('detects a section whose ordinal does not match its position', () => {
    const input = sampleInput();
    const section = input.sections[0];
    if (section === undefined) throw new Error('sample has no section');
    const broken: CoverageInput = { ...input, sections: [{ ...section, index: 2 }] };

    const rules = verifyCoverage(broken).map((violation) => violation.rule);
    expect(rules).toContain('section-ordinal-broken');
    expect(() => deriveAccounting(broken)).toThrow(CoverageError);
  });

  it('detects a line record whose number does not follow the text', () => {
    const input = sampleInput();
    const first = input.lines[0];
    if (first === undefined) throw new Error('sample has no lines');
    const broken: CoverageInput = {
      ...input,
      lines: [{ ...first, number: 2 }, ...input.lines.slice(1)],
    };

    // The line is still covered by its comment; what breaks is the numbering contract itself.
    assertCodes(
      verifyCoverage(broken).map((violation) => violation.rule),
      ['line-number-broken'],
    );
  });

  it('detects a record pointing past the end of the document', () => {
    const input = sampleInput();
    const last = input.lines.at(-1);
    if (last === undefined) throw new Error('sample has no lines');
    // One line fewer than the records describe: the final record now points outside the file.
    const broken: CoverageInput = { ...input, lines: input.lines.slice(0, -1) };

    // Two independent rules fire, which is the point: the extent and the reference both break.
    assertCodes(
      verifyCoverage(broken).map((violation) => violation.rule),
      ['line-number-broken', 'section-extent-broken'],
    );
    expect(() => deriveAccounting(broken)).toThrow(CoverageError);
  });

  it('throws a typed error that carries the violations', () => {
    const input = sampleInput();
    const broken: CoverageInput = { ...input, comments: input.comments.slice(1) };

    try {
      deriveAccounting(broken);
      throw new Error('expected CoverageError');
    } catch (error) {
      expect(error).toBeInstanceOf(CoverageError);
      if (!(error instanceof CoverageError)) throw error;
      expect(error.violations[0]?.rule).toBe('uncovered-line');
      expect(error.message).toContain('uncovered-line');
    }
  });
});

describe('R16 — the FORMAT diagnostic points at the declaration', () => {
  it('spans the FORMAT line itself, not line 1, when comments precede it', () => {
    const scan = scanSource({
      text: '# generated by a tool\n# A5:ER FORMAT:20\n\n[Entity]\nPName="x"\n',
      format: 20,
    });

    expect(scan.diagnostics[0]?.span).toEqual({
      sectionIndex: 0,
      startLine: 2,
      endLine: 2,
      keyLine: 2,
    });
  });

  it('spans the declaration after blank lines too', () => {
    const scan = scanSource({
      text: '# one\n\n# two\n\n# A5:ER FORMAT:99\n[Entity]\nPName="x"\n',
      format: 99,
    });

    expect(scan.diagnostics[0]?.span?.keyLine).toBe(5);
  });

  it('uses the last declaration, which is the one the parser used', () => {
    const scan = scanSource({
      text: '# A5:ER FORMAT:20\n# A5:ER FORMAT:99\n[Entity]\nPName="x"\n',
      format: 99,
    });

    expect(scan.diagnostics[0]?.details).toEqual({ declared: 99 });
    expect(scan.diagnostics[0]?.span?.keyLine).toBe(2);
  });

  it('falls back to line 1 when the declaration is absent, and says so once', () => {
    const scan = scanSource({ text: '# just a comment\n[Entity]\nPName="x"\n', format: null });

    expect(scan.diagnostics[0]?.span).toEqual({
      sectionIndex: 0,
      startLine: 1,
      endLine: 1,
      keyLine: 1,
    });
    assertCodes(
      scan.diagnostics.map((diagnostic) => diagnostic.code),
      ['S_HEADER_UNKNOWN_FORMAT'],
    );
  });

  it('applies the line-1 policy to a document that starts with a section', () => {
    // There is no header region at all; the policy still points at a real line (§12's example).
    const scan = scanSource({ text: '[Entity]\nPName="x"\n', format: null });

    expect(scan.header.keyLines).toEqual([]);
    expect(scan.diagnostics[0]?.span).toEqual({
      sectionIndex: 0,
      startLine: 1,
      endLine: 1,
      keyLine: 1,
    });
  });

  it('cannot locate a non-numeric declaration, so it uses the documented policy', () => {
    // `parseHeader` reports `format: null` for `FORMAT:abc`, so there is no numeric line to find.
    const scan = scanSource({ text: '# A5:ER FORMAT:abc\n[Entity]\nPName="x"\n', format: null });

    expect(scan.diagnostics[0]?.details).toEqual({ declared: null });
    expect(scan.diagnostics[0]?.span?.keyLine).toBe(1);
  });

  it('keeps the header diagnostic first, before every section finding (§12 rule 7)', () => {
    const scan = scanSource({ text: '[Memo]\nNote="x"\n', format: 20 });

    expect(scan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'S_HEADER_UNKNOWN_FORMAT',
      'S_UNKNOWN_SECTION',
    ]);
  });

  it('points at line 1 in the fixtures whose declaration is line 1 (fmt-04, fmt-05)', () => {
    for (const [id, declared] of [
      ['fmt-04', 20],
      ['fmt-05', 99],
    ] as const) {
      const spec = FIXTURES.find((candidate) => candidate.id === id);
      if (spec === undefined) throw new Error(`${id} is not registered`);
      const staged = stage(spec.id);
      try {
        const outcome = loadSource(staged.path);
        if (!outcome.ok) throw new Error(`${id} did not load`);
        const scan = scanSource(outcome.source);

        // The committed fixture declares FORMAT on line 1; the span follows the file, not a rule.
        expect(scan.diagnostics[0]?.details, id).toEqual({ declared });
        expect(scan.diagnostics[0]?.span, id).toEqual({
          sectionIndex: 0,
          startLine: 1,
          endLine: 1,
          keyLine: 1,
        });
      } finally {
        staged.cleanup();
      }
    }
  });
});

describe('R17 — maxLines counts physical lines exactly as splitLines does', () => {
  const CASES = [
    'a',
    'a\n',
    'a\nb',
    'a\nb\n',
    'a\r\nb',
    'a\r\nb\r\n',
    'a\rb\r',
    'a\r\nb\nc\rd',
    'a\r\nb\nc\rd\n',
    '\n',
    '\r\n',
    '\r',
    'a\n\n',
    'a\r\n\r\n',
    'a\n\nb',
  ];

  for (const text of CASES) {
    it(`agrees on ${JSON.stringify(text)}`, () => {
      const expected = splitLines(text).length;
      const bytes = new TextEncoder().encode(text);

      const accepted = decodeBytes(bytes, { limits: { maxLines: expected } });
      expect(accepted.ok, `maxLines ${String(expected)}`).toBe(true);

      if (expected > 1) {
        const rejected = decodeBytes(bytes, { limits: { maxLines: expected - 1 } });
        expect(rejected.ok, `maxLines ${String(expected - 1)}`).toBe(false);
        assertCodes(
          (rejected.ok ? [] : rejected.diagnostics).map((diagnostic) => diagnostic.code),
          ['E_LIMIT_LINES'],
        );
      }
    });
  }

  it('does not add a line for a trailing terminator', () => {
    // The R17 regression: "a\n" used to count as 2 lines.
    expect(splitLines('a\n')).toHaveLength(1);
    expect(decodeBytes(new TextEncoder().encode('a\n'), { limits: { maxLines: 1 } }).ok).toBe(true);
    expect(decodeBytes(new TextEncoder().encode('a\n\n'), { limits: { maxLines: 1 } }).ok).toBe(
      false,
    );
  });

  it('counts an empty text as zero lines', () => {
    expect(splitLines('')).toHaveLength(0);
    const outcome = decodeBytes(new Uint8Array(), { limits: { maxLines: 1 } });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.decoded.text).toBe('');
  });

  it('still measures maxLineLength in UTF-16 code units (R14)', () => {
    // A surrogate pair is two code units, so one glyph does not fit a limit of 1.
    const glyph = new TextEncoder().encode('😀');
    expect(decodeBytes(glyph, { limits: { maxLineLength: 1 } }).ok).toBe(false);
    expect(decodeBytes(glyph, { limits: { maxLineLength: 2 } }).ok).toBe(true);

    // A BMP Japanese character is one unit, three UTF-8 bytes: the unit is not the byte.
    const japanese = new TextEncoder().encode('テ');
    expect(decodeBytes(japanese, { limits: { maxLineLength: 1 } }).ok).toBe(true);
  });

  it('rejects a document one line over the limit, counting CRLF as one break', () => {
    const text = 'a\r\nb\r\nc';
    expect(splitLines(text)).toHaveLength(3);
    expect(decodeBytes(new TextEncoder().encode(text), { limits: { maxLines: 3 } }).ok).toBe(true);
    expect(decodeBytes(new TextEncoder().encode(text), { limits: { maxLines: 2 } }).ok).toBe(false);
  });
});
