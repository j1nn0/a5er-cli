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
import type {
  CommentRecord,
  CoverageInput,
  CoverageViolation,
  SectionScan,
} from '../src/syntax/scanner.js';
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

/**
 * F4-B2-C — a comment's owner comes from an index, and the verdict is the one a scan produced.
 *
 * `verifyCoverage` used to find a comment's section with `sections.find((section) => section.index
 * === comment.span.sectionIndex)`; it now takes the owner from one `Map` built per call. The lookup
 * is the only thing that changed, so these blocks pin the three rules the index has to reproduce
 * from `find` — first-wins, `NaN` never registered as a key, every other number equal — and then the
 * whole verdict, rule/line/detail, for the broken structures a scan cannot produce but the checker
 * must still judge. Expected values are read off the rule each case breaks, never off the output.
 *
 * The last block is the counterweight: it counts how often the section list is read and demands the
 * count does not move when the comment count does, so a per-comment scan cannot come back. It is a
 * call count, not a clock: no test in this file has a time threshold.
 */

/** Two sections with a header-area comment, one comment inside each section, and a key in each. */
const TWO_SECTIONS = [
  '# top',
  '[Entity]',
  'PName="a"',
  '# one',
  '[Entity]',
  'PName="b"',
  '# two',
].join('\n');

/** `TWO_SECTIONS` as a `CoverageInput`: seven lines, section extents 2..4 and 5..7. */
function twoSectionInput(): CoverageInput {
  const scan = scanSource({ text: TWO_SECTIONS, format: 21 });
  return {
    lines: scan.lines,
    sections: scan.sections,
    comments: scan.comments,
    blankLines: scan.blankLines,
    header: scan.header,
  };
}

/** `TWO_SECTIONS`' two sections, failing loudly when the text stops producing two. */
function twoSections(input: CoverageInput): readonly [SectionScan, SectionScan] {
  const [first, second] = input.sections;
  if (first === undefined || second === undefined) throw new Error('expected two sections');
  return [first, second];
}

/** A comment record on one line, the shape `scanSource` produces. */
function commentAt(raw: string, line: number, sectionIndex: number): CommentRecord {
  return { raw, span: { sectionIndex, startLine: line, endLine: line, keyLine: line } };
}

/** The input's comments with the one on `line` re-claiming `sectionIndex`. */
function reclaimComment(input: CoverageInput, line: number, sectionIndex: number): CoverageInput {
  return {
    ...input,
    comments: input.comments.map((comment) =>
      comment.span.keyLine === line
        ? { ...comment, span: { ...comment.span, sectionIndex } }
        : comment,
    ),
  };
}

/** The input's comments with the one on `from` moved onto `to`, keeping its `sectionIndex`. */
function relocateComment(input: CoverageInput, from: number, to: number): CoverageInput {
  return {
    ...input,
    comments: input.comments.map((comment) =>
      comment.span.keyLine === from
        ? { ...comment, span: { ...comment.span, startLine: to, endLine: to, keyLine: to } }
        : comment,
    ),
  };
}

/** A section moved to another `index`: its header span, extent and entries move with it. */
function reindexedSection(section: SectionScan, index: number): SectionScan {
  return {
    ...section,
    index,
    headerSpan: { ...section.headerSpan, sectionIndex: index },
    span: { ...section.span, sectionIndex: index },
    entries: section.entries.map((entry) => ({
      ...entry,
      span: { ...entry.span, sectionIndex: index },
    })),
  };
}

/** A scan of `sections` sections, each with one key and `commentsPerSection` comments inside it. */
function manySectionsInput(sections: number, commentsPerSection: number): CoverageInput {
  const text = ['# A5:ER FORMAT:21'];
  for (let index = 1; index <= sections; index += 1) {
    text.push('[Entity]', `PName="E${String(index)}"`);
    for (let comment = 1; comment <= commentsPerSection; comment += 1) {
      text.push(`# section ${String(index)} comment ${String(comment)}`);
    }
  }
  const scan = scanSource({ text: text.join('\n'), format: 21 });
  return {
    lines: scan.lines,
    sections: scan.sections,
    comments: scan.comments,
    blankLines: scan.blankLines,
    header: scan.header,
  };
}

/**
 * `verifyCoverage`'s verdict for `input`, plus how often the section list was read by position.
 *
 * A proxy counts positional reads — the only way a `find` sees the list, and the way `entries()`,
 * `at()` and the index build see it — so the count stands in for the number of section visits one
 * comment costs, without a clock. `length`, `entries` and `at` themselves are not counted.
 */
function sectionListReads(input: CoverageInput): {
  readonly violations: readonly CoverageViolation[];
  readonly reads: number;
} {
  let reads = 0;
  const counted: SectionScan[] = new Proxy(input.sections.slice(), {
    get(target, property, receiver) {
      if (typeof property === 'string' && property !== '' && Number.isInteger(Number(property))) {
        reads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { violations: verifyCoverage({ ...input, sections: counted }), reads };
}

describe('F4-B2-C — the index reconciles real scans unchanged', () => {
  it('reconciles a document with no comment at all', () => {
    const scan = scanSource({ text: '[Entity]\nPName="a"\n', format: 21 });

    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.accounting.lines).toEqual({
      total: 2,
      sectionHeaders: 1,
      keys: 1,
      comments: 0,
      blank: 0,
      raw: 0,
    });
  });

  it('reconciles a document with no section', () => {
    // No header, so the header region is the whole file and every comment claims it legitimately.
    const scan = scanSource({ text: '# note\nkey=value\n', format: 21 });

    expect(scan.sections).toEqual([]);
    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.accounting.keys.beforeFirstSection).toBe(1);
  });

  it('reconciles a comment in the header area', () => {
    const scan = scanSource({ text: '# top\n[Entity]\nPName="a"\n', format: 21 });

    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.comments.map((comment) => comment.span.sectionIndex)).toEqual([0]);
  });

  it('reconciles one section with a comment on its last line', () => {
    const scan = scanSource({ text: '[Entity]\nPName="a"\n# tail\n', format: 21 });

    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.sections[0]?.span.endLine).toBe(3);
  });

  it('reconciles two sections, each comment inside its own extent', () => {
    const input = twoSectionInput();

    expect(verifyCoverage(input)).toEqual([]);
    expect(input.sections.map((section) => section.span)).toEqual([
      { sectionIndex: 1, startLine: 2, endLine: 4, keyLine: 2 },
      { sectionIndex: 2, startLine: 5, endLine: 7, keyLine: 5 },
    ]);
  });

  it('reconciles trailing blank lines', () => {
    const scan = scanSource({ text: '[Entity]\nPName="a"\n\n\n', format: 21 });

    expect(verifyCoverage(scan)).toEqual([]);
    expect(scan.accounting.lines).toEqual({
      total: 4,
      sectionHeaders: 1,
      keys: 1,
      comments: 0,
      blank: 2,
      raw: 0,
    });
  });

  it('reconciles many sections and many comments without losing a claim', () => {
    const input = manySectionsInput(24, 3);
    const accounting = deriveAccounting(input);

    expect(verifyCoverage(input)).toEqual([]);
    expect(accounting.dropped).toBe(0);
    expect(accounting.lines.sectionHeaders).toBe(24);
    // One comment in the header area plus three inside each of the 24 sections.
    expect(accounting.lines.comments).toBe(1 + 24 * 3);
    const { total, sectionHeaders, keys, comments, blank, raw } = accounting.lines;
    expect(sectionHeaders + keys + comments + blank + raw).toBe(total);
  });

  it('accounts for all 39 synthetic fixtures and puts their comments through the index', () => {
    const synthetic = FIXTURES.filter((entry) => entry.fixtureClass === 'synthetic');
    expect(synthetic).toHaveLength(39);

    let comments = 0;
    for (const spec of synthetic) {
      const staged = stage(spec.id);
      try {
        const outcome = loadSource(staged.path);
        if (!outcome.ok) throw new Error(`${spec.id} did not load`);
        const scan = scanSource(outcome.source);

        expect(verifyCoverage(scan), spec.id).toEqual([]);
        expect(scan.accounting.dropped, spec.id).toBe(0);
        comments += scan.comments.length;
      } finally {
        staged.cleanup();
      }
    }
    // The loop above only exercises the index path if the committed files carry comments.
    expect(comments).toBeGreaterThan(0);
  });
});

describe('F4-B2-C — first-wins over a duplicated section index', () => {
  it('owns a shared index by the first section and its extent', () => {
    const input = twoSectionInput();
    const [first, second] = twoSections(input);
    // Two sections carry index 1 — a structure only a broken input has — and their extents differ:
    // the first owns 2..4, the second 5..7. Both comments name 1, so the first section owns both:
    // line 4 lies inside its extent and must produce nothing, line 7 lies outside it.
    const reclaimed = reclaimComment(reclaimComment(input, 4, first.index), 7, first.index);
    const broken: CoverageInput = {
      ...reclaimed,
      sections: [first, { ...second, index: first.index }],
    };
    // The two extents really are different, which is what makes the choice visible: the first owns
    // 2..4 and the second 5..7, so "inside the owner" and "outside the other section" disagree.
    expect([first.span.startLine, first.span.endLine]).toEqual([2, 4]);
    expect([second.span.startLine, second.span.endLine]).toEqual([5, 7]);

    const expected: readonly CoverageViolation[] = [
      { rule: 'section-ordinal-broken', line: 5, detail: 'section 1 sits at position 2' },
      { rule: 'bad-section-index', line: 5, detail: 'section 1 carries another sectionIndex' },
      { rule: 'bad-section-index', line: 6, detail: 'key of section 1 claims 2' },
      {
        rule: 'bad-section-index',
        line: 7,
        detail: 'comment claims section 1 but sits outside it',
      },
    ];
    expect(verifyCoverage(broken)).toEqual(expected);

    try {
      deriveAccounting(broken);
      throw new Error('expected CoverageError');
    } catch (error) {
      expect(error).toBeInstanceOf(CoverageError);
      if (!(error instanceof CoverageError)) throw error;
      expect(error.violations).toEqual(expected);
      expect(error.message).toBe(
        'scan coverage does not reconcile: section-ordinal-broken, bad-section-index, bad-section-index, bad-section-index',
      );
    }
  });

  it('leaves the sections around a duplicated index reachable by their own index', () => {
    const text = [
      '# top',
      '[Entity]',
      'PName="a"',
      '# one',
      '[Entity]',
      'PName="b"',
      '# two',
      '[Entity]',
      'PName="c"',
      '# three',
    ].join('\n');
    const scan = scanSource({ text, format: 21 });
    const [first, second, third] = scan.sections;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three sections');
    }

    // Section 2 is relabelled to section 1, so nothing carries 2 any more; section 3 stays reachable.
    const relabelled: CoverageInput = {
      lines: scan.lines,
      sections: [first, { ...second, index: first.index }, third],
      comments: scan.comments,
      blankLines: scan.blankLines,
      header: scan.header,
    };

    expect(verifyCoverage(relabelled)).toEqual([
      { rule: 'section-ordinal-broken', line: 5, detail: 'section 1 sits at position 2' },
      { rule: 'bad-section-index', line: 5, detail: 'section 1 carries another sectionIndex' },
      { rule: 'bad-section-index', line: 6, detail: 'key of section 1 claims 2' },
      { rule: 'bad-section-index', line: 7, detail: 'comment claims section 2' },
    ]);
  });
});

describe('F4-B2-C — SameValueZero keeps every `===` verdict', () => {
  it('never registers a NaN index, so a comment claiming NaN names no section', () => {
    const input = twoSectionInput();
    const [first, second] = twoSections(input);
    // The section claims NaN while its own records keep the index they were scanned with. A `Map`
    // would answer `get(NaN)` if NaN were a key, but `===` never matched it, so nothing may own it.
    const broken: CoverageInput = {
      ...reclaimComment(input, 4, Number.NaN),
      sections: [{ ...first, index: Number.NaN }, second],
    };

    expect(verifyCoverage(broken)).toEqual([
      { rule: 'section-ordinal-broken', line: 2, detail: 'section NaN sits at position 1' },
      { rule: 'bad-section-index', line: 2, detail: 'section NaN carries another sectionIndex' },
      { rule: 'bad-section-index', line: 3, detail: 'key of section NaN claims 1' },
      { rule: 'bad-section-index', line: 4, detail: 'comment claims section NaN' },
    ]);
  });

  it('treats a comment that claims -0 exactly as one that claims 0', () => {
    const input = twoSectionInput();
    const afterHeader: readonly CoverageViolation[] = [
      {
        rule: 'header-region-misuse',
        line: 4,
        detail: 'comment claims the header region after the first header',
      },
    ];

    // `===` holds `-0` equal to `0`, so the header-region branch runs for both signs and neither
    // reaches the index; the two spellings must therefore stay indistinguishable.
    expect(verifyCoverage(reclaimComment(input, 4, 0))).toEqual(afterHeader);
    expect(verifyCoverage(reclaimComment(input, 4, -0))).toEqual(afterHeader);
    expect(verifyCoverage(reclaimComment(input, 1, 0))).toEqual([]);
    expect(verifyCoverage(reclaimComment(input, 1, -0))).toEqual([]);
  });

  for (const claimed of [Number.POSITIVE_INFINITY, 1.5]) {
    it(`resolves a comment claiming ${String(claimed)} to the section carrying that index`, () => {
      const input = twoSectionInput();
      const [first, second] = twoSections(input);
      // The section's index, header, extent and entries all say `claimed`, and the comment's line 4
      // is inside that extent: the index keeps the value, so the comment adds no finding.
      const broken: CoverageInput = {
        ...reclaimComment(input, 4, claimed),
        sections: [reindexedSection(first, claimed), second],
      };

      expect(verifyCoverage(broken)).toEqual([
        {
          rule: 'section-ordinal-broken',
          line: 2,
          detail: `section ${String(claimed)} sits at position 1`,
        },
      ]);
    });
  }
});

describe('F4-B2-C — a broken section list still resolves or reports, as before', () => {
  it('reports a comment naming an index no section carries', () => {
    expect(verifyCoverage(reclaimComment(twoSectionInput(), 7, 7))).toEqual([
      { rule: 'bad-section-index', line: 7, detail: 'comment claims section 7' },
    ]);
  });

  it('reports a comment that names a section but sits outside it', () => {
    expect(verifyCoverage(reclaimComment(twoSectionInput(), 7, 1))).toEqual([
      {
        rule: 'bad-section-index',
        line: 7,
        detail: 'comment claims section 1 but sits outside it',
      },
    ]);
  });

  it('resolves through a gap in the ordinals', () => {
    const input = twoSectionInput();
    const [first, second] = twoSections(input);
    // Section 2 is relabelled 3, so the list is 1 and 3 and nothing carries 2.
    const gapped: CoverageInput = { ...input, sections: [first, reindexedSection(second, 3)] };

    expect(verifyCoverage(gapped)).toEqual([
      { rule: 'section-ordinal-broken', line: 5, detail: 'section 3 sits at position 2' },
      { rule: 'bad-section-index', line: 7, detail: 'comment claims section 2' },
    ]);
  });

  it('resolves by index, not by position, when the ordinals are reversed', () => {
    const input = twoSectionInput();
    const [first, second] = twoSections(input);
    // The first section is labelled 2 and the second 1, and their records move with the labels, so
    // the order is the only remaining defect. The comments still name what they named.
    const reversed: CoverageInput = {
      ...input,
      sections: [reindexedSection(first, 2), reindexedSection(second, 1)],
    };

    expect(verifyCoverage(reversed)).toEqual([
      { rule: 'section-ordinal-broken', line: 2, detail: 'section 2 sits at position 1' },
      { rule: 'section-ordinal-broken', line: 5, detail: 'section 1 sits at position 2' },
      {
        rule: 'bad-section-index',
        line: 4,
        detail: 'comment claims section 1 but sits outside it',
      },
      {
        rule: 'bad-section-index',
        line: 7,
        detail: 'comment claims section 2 but sits outside it',
      },
    ]);
  });

  it('reports header-region misuse on the first header line itself', () => {
    const input = twoSectionInput();
    // The header-area comment moved onto line 2, the first header line, still claiming region 0.
    const broken = relocateComment(input, 1, 2);

    expect(verifyCoverage(broken)).toEqual([
      {
        rule: 'header-region-misuse',
        line: 2,
        detail: 'comment claims the header region after the first header',
      },
      { rule: 'uncovered-line', line: 1, detail: 'no record claims this line' },
      { rule: 'double-covered-line', line: 2, detail: 'section 1 header + comment' },
    ]);
  });

  it('reports a comment and a blank line claiming one line, in claim order', () => {
    const input = sampleInput();
    // Line 4 is blank in the sample, so a comment claiming it is a second claim on that line.
    const broken: CoverageInput = {
      ...input,
      comments: [...input.comments, commentAt('# also', 4, 1)],
    };

    expect(verifyCoverage(broken)).toEqual([
      { rule: 'double-covered-line', line: 4, detail: 'comment + blank line' },
    ]);
  });

  it('reports a comment pointing outside the document', () => {
    const input = twoSectionInput();
    // The last section's comment moved past the last line: the reference and the claim both break.
    const broken = relocateComment(input, 7, 9);

    expect(verifyCoverage(broken)).toEqual([
      {
        rule: 'bad-section-index',
        line: 9,
        detail: 'comment claims section 2 but sits outside it',
      },
      { rule: 'uncovered-line', line: 7, detail: 'no record claims this line' },
      { rule: 'line-number-broken', line: 9, detail: '1 record(s) point outside the document' },
    ]);
  });
});

describe('F4-B2-C — the per-comment owner lookup does not scan the section list', () => {
  it('reads the section list as often with six comments per section as with one', () => {
    const few = sectionListReads(manySectionsInput(12, 1));
    const many = sectionListReads(manySectionsInput(12, 6));

    expect(few.violations).toEqual([]);
    expect(many.violations).toEqual([]);
    // Both inputs have the same 12 sections, so a per-comment `find` would move this count with the
    // comment count; the index is built once, so the count is the same for both.
    expect(many.reads).toBe(few.reads);
    // Guard against a harness that reads nothing because the proxy was bypassed.
    expect(few.reads).toBeGreaterThan(0);
  });
});
