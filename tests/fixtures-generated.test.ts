/**
 * Content and builder assertions for the `generated` fixture class.
 *
 * A generated fixture has no committed file: `helpers/generated.ts` builds its bytes from
 * a fixed seed and documented limits, and this file proves three things about each one —
 * that the builder is deterministic, that it writes only into the temp directory it is
 * given, and that the built document satisfies the registry entry (counts, spans, facts)
 * exactly as a committed fixture does.
 *
 * The parser does not exist yet, so nothing here asserts how the tool would react to these
 * bytes. A limit breach is asserted as "the builder produced a file past the limit", not as
 * "the reader reported `E_LIMIT_*`" (test-strategy §7 T8, §12).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { evaluateFact, parseText } from './helpers/fixture-text.js';
import {
  FUZZ_MUTANTS,
  FUZZ_SEED,
  GENERATED_BUILDERS,
  GENERATED_IDS,
  MAX_BYTES,
  MAX_LINE_LENGTH,
  MAX_LINES,
  SINGLE_LINE_BYTES,
  CAPPED_READ_LIMIT_BYTES,
  buildFuzzMutants,
} from './helpers/generated.js';
import { stage } from './helpers/stage.js';

/** The registry entry for `id`, or a failure naming the missing entry. */
function specFor(id: string): FixtureSpec {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return spec;
}

/** Longest line length in bytes, counting the trailing fragment as a line. */
function longestLineBytes(bytes: Buffer): number {
  const lines = bytes.toString('utf8').split(/\r\n|\n|\r/);
  return lines.reduce((longest, line) => Math.max(longest, Buffer.byteLength(line, 'utf8')), 0);
}

/** Run a builder into a fresh temp directory and return the written paths. */
function materialise(
  id: string,
  build: () => readonly { readonly name: string; readonly bytes: Buffer }[],
): { directory: string; paths: readonly string[] } {
  const directory = mkdtempSync(join(tmpdir(), `a5er-generated-${id}-`));
  const paths = build().map((file) => {
    const path = join(directory, file.name);
    writeFileSync(path, file.bytes);
    return path;
  });
  return { directory, paths };
}

describe('generated fixture builders', () => {
  it('covers exactly the generated entries in the registry', () => {
    const fromRegistry = FIXTURES.filter((spec) => spec.fixtureClass === 'generated')
      .map((spec) => spec.id)
      .sort();
    expect([...GENERATED_IDS].sort()).toEqual(fromRegistry);
  });

  for (const [id, build] of Object.entries(GENERATED_BUILDERS)) {
    describe(`${id}`, () => {
      const spec = specFor(id);

      it('is deterministic: two builds are byte-identical', () => {
        const first = build();
        const second = build();
        expect(first.map((file) => file.name)).toEqual(second.map((file) => file.name));
        for (const [index, file] of first.entries()) {
          expect(second[index]?.bytes.equals(file.bytes), `${id}: ${file.name}`).toBe(true);
        }
      });

      it('writes only inside the directory it is given', () => {
        const { directory, paths } = materialise(id, build);
        try {
          const built = build();
          expect(paths).toHaveLength(built.length);
          for (const [index, path] of paths.entries()) {
            expect(path.startsWith(directory)).toBe(true);
            // The file on disk is exactly the buffer, so nothing was written elsewhere.
            const bytes = built[index]?.bytes;
            if (bytes === undefined) throw new Error(`${id}: missing buffer ${String(index)}`);
            expect(statSync(path).size, path).toBe(bytes.byteLength);
            expect(readFileSync(path).equals(bytes), path).toBe(true);
          }
          expect(readdirSync(directory)).toHaveLength(built.length);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      it('satisfies the registry counts, spans and source facts', () => {
        const files = build();
        const first = files[0];
        if (first === undefined) throw new Error(`${id}: the builder produced no file`);
        const parsed = parseText(first.bytes);
        const { counts, spans } = spec.expectation;

        if (counts.sections.total > 0 || counts.keys.total > 0) {
          expect(parsed.sectionLines.length, `${id}: sections`).toBe(counts.sections.total);
          expect(parsed.keyLines.length, `${id}: keys`).toBe(counts.keys.total);
        }
        for (const span of spans) {
          expect(span.endLine).toBeGreaterThanOrEqual(span.startLine);
          expect(parsed.lines.length).toBeGreaterThanOrEqual(span.endLine);
        }

        for (const fact of spec.expectation.sourceFacts) {
          // A family fact describes every member; the rest are read from the first member.
          if (fact.path === 'generated.fileCount') {
            expect(files.length, `${id}: ${fact.path}`).toBe(fact.equals);
            continue;
          }
          const document = fact.path.startsWith('bytes.') ? null : parsed;
          evaluateFact(spec, document, first.bytes, fact);
        }
      });
    });
  }
});

describe('hst-03 — one long line', () => {
  it('is exactly 1 MiB on its longest line and stays under maxLineLength', () => {
    const files = GENERATED_BUILDERS['hst-03']?.() ?? [];
    const first = files[0];
    if (first === undefined) throw new Error('hst-03 built no file');
    expect(longestLineBytes(first.bytes)).toBe(SINGLE_LINE_BYTES);
    expect(longestLineBytes(first.bytes)).toBeLessThan(MAX_LINE_LENGTH);
  });
});

describe('res-01 — a read stopped by the limit', () => {
  it('is larger than maxBytes, so the limit fires rather than a short read', () => {
    const files = GENERATED_BUILDERS['res-01']?.() ?? [];
    const first = files[0];
    if (first === undefined) throw new Error('res-01 built no file');
    // `E_LIMIT_BYTES` is real only if the file is bigger than the limit the reader applies.
    expect(first.bytes.byteLength).toBeGreaterThan(CAPPED_READ_LIMIT_BYTES);

    const capped = first.bytes.subarray(0, CAPPED_READ_LIMIT_BYTES);
    expect(capped.byteLength).toBe(CAPPED_READ_LIMIT_BYTES);
    expect(capped.byteLength).toBeLessThan(first.bytes.byteLength);

    // The fixture has no seam, so it can never be the short-read case: that is res-02,
    // whose expectation is `E_TRUNCATED_INPUT` and whose bytes do not exist.
    expect(specFor('res-01').expectation.codes).toEqual(['E_LIMIT_BYTES']);
    expect(specFor('res-02').expectation.codes).toEqual(['E_TRUNCATED_INPUT']);
  });
});

describe('res-03 — one breach per document', () => {
  it('breaches maxBytes, maxLines and maxLineLength by one', () => {
    const files = GENERATED_BUILDERS['res-03']?.() ?? [];
    expect(files.map((file) => file.name)).toEqual([
      'res-03-max-bytes.a5er',
      'res-03-max-lines.a5er',
      'res-03-max-line-length.a5er',
    ]);

    const [bytesFile, linesFile, lineFile] = files;
    if (bytesFile === undefined || linesFile === undefined || lineFile === undefined) {
      throw new Error('res-03 built fewer than three files');
    }
    expect(bytesFile.bytes.byteLength).toBe(MAX_BYTES + 1);

    const lines = linesFile.bytes.toString('utf8').split(/\r\n|\n|\r/);
    expect(lines.length).toBeGreaterThan(MAX_LINES);
    expect(linesFile.bytes.byteLength).toBeLessThanOrEqual(MAX_LINES + 1);

    expect(longestLineBytes(lineFile.bytes)).toBe(MAX_LINE_LENGTH + 1);
  });
});

describe('hst-06 — three inputs that are not diagrams', () => {
  it('has exactly one empty, one whitespace-only and one section-free file', () => {
    const files = GENERATED_BUILDERS['hst-06']?.() ?? [];
    expect(files).toHaveLength(3);

    const [empty, whitespace, noSections] = files;
    if (empty === undefined || whitespace === undefined || noSections === undefined) {
      throw new Error('hst-06 built fewer than three files');
    }
    expect(empty.bytes.byteLength).toBe(0);
    expect(whitespace.bytes.toString('utf8').trim()).toBe('');
    expect(whitespace.bytes.byteLength).toBeGreaterThan(0);
    const sections = noSections.bytes
      .toString('utf8')
      .split(/\r\n|\n|\r/)
      .filter((line) => /^\s*\[.+\]\s*$/.test(line));
    expect(sections).toEqual([]);
    expect(noSections.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('fuzz-01 — seeded mutations of fmt-01', () => {
  it('is reproducible from its seed and different under another seed', () => {
    const staged = stage('fmt-01');
    try {
      const source = readFileSync(staged.path);
      const first = buildFuzzMutants(source);
      const second = buildFuzzMutants(source);
      expect(first).toHaveLength(FUZZ_MUTANTS);
      // The registry entry and the builder must agree on the family size.
      const spec = specFor('fuzz-01');
      expect(spec.expectation.sourceFacts, 'fuzz-01').toEqual([
        { path: 'generated.fileCount', equals: FUZZ_MUTANTS },
      ]);
      expect(first.map((mutant) => mutant.bytes.toString('hex'))).toEqual(
        second.map((mutant) => mutant.bytes.toString('hex')),
      );

      const other = buildFuzzMutants(source, FUZZ_SEED + 1);
      const differing = other.filter(
        (mutant, index) => !mutant.bytes.equals(first[index]?.bytes ?? Buffer.alloc(0)),
      );
      expect(differing.length).toBeGreaterThan(0);
    } finally {
      staged.cleanup();
    }
  });

  it('mutates one byte or a short run, and never the source', () => {
    const staged = stage('fmt-01');
    try {
      const source = readFileSync(staged.path);
      const original = Buffer.from(source);
      const mutants = buildFuzzMutants(source);

      for (const mutant of mutants) {
        const label = `${FUZZ_ID_LABEL} seed=${String(FUZZ_SEED)} mutant=${String(mutant.index)}`;
        // A mutant is a copy of the whole document: same length, same shape.
        expect(mutant.bytes.byteLength, label).toBe(source.byteLength);
        expect(mutant.width, label).toBeGreaterThanOrEqual(1);
        expect(mutant.width, label).toBeLessThanOrEqual(8);
        expect(mutant.kind, label).toBe(mutant.width === 1 ? 'byte' : 'range');

        // Everything outside the mutated window is the source byte for byte.
        const window = mutant.bytes.subarray(mutant.start, mutant.start + mutant.width);
        const outside = Buffer.concat([
          mutant.bytes.subarray(0, mutant.start),
          mutant.bytes.subarray(mutant.start + mutant.width),
        ]);
        const expectedOutside = Buffer.concat([
          source.subarray(0, mutant.start),
          source.subarray(mutant.start + mutant.width),
        ]);
        expect(outside.equals(expectedOutside), label).toBe(true);
        // And the window itself really did change.
        expect(
          window.equals(source.subarray(mutant.start, mutant.start + mutant.width)),
          label,
        ).toBe(false);
      }

      // The source buffer is untouched: fuzzing never edits the fixture it reads.
      expect(source.equals(original)).toBe(true);
      expect(readFileSync(staged.path).equals(original)).toBe(true);
    } finally {
      staged.cleanup();
    }
  });
});

/** Label prefix for fuzz assertions, so a failure prints the seed (test-strategy §9). */
const FUZZ_ID_LABEL = 'fuzz-01';
