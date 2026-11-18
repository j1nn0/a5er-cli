/**
 * Catalog-wide gates: G-3 (every non-fatal code is exercised) and G-8 (fixture integrity).
 *
 * These are the two gates test-strategy §10 assigns to `catalog.test.ts`. Both are
 * cross-checks that no single fixture test can make:
 *
 * - G-3 reads the diagnostic taxonomy out of `docs/architecture.md` §11 and requires every
 *   **non-fatal** code to appear in at least one fixture's expected multiset. Fatal codes
 *   are exempt: `E_IO`, `E_NOT_A_FILE`, `E_CODEC_UNAVAILABLE` and
 *   `E_FILE_CHANGED_DURING_READ` cannot be caused by fixture bytes at all.
 * - G-8 walks the catalog in both directions: every registered ID has exactly one
 *   materialisation (a committed tracked file, a builder, or a declared harness), and
 *   every committed fixture file on disk has exactly one registry entry.
 *
 * The taxonomy is parsed from the document rather than duplicated as a constant: a code
 * added to `architecture.md` without a fixture fails here, which is the point of the gate.
 * `DiagnosticCode` now exists in `src/diagnostics/diagnostic.ts` (stage 5 closed the semantic
 * family), but the gate still reads §11: it filters on the *severity class* in the second cell,
 * which the union does not carry, and the document stays the source a code must reach first.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCodes } from './helpers/assert-codes.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { GENERATED_BUILDERS, GENERATED_IDS } from './helpers/generated.js';
import { BYTES_DIR, GENERATED_DIR, SYNTHETIC_DIR } from './helpers/stage.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARCHITECTURE = fileURLToPath(new URL('../docs/architecture.md', import.meta.url));

/** §4 of the test strategy: 51 catalog rows, one entry each. */
const CATALOG_SIZE = 51;

/** One row of the §11 diagnostic table: one or more codes sharing a severity. */
interface TaxonomyRow {
  readonly codes: readonly string[];
  readonly severity: string;
}

/**
 * Read the diagnostic taxonomy from `architecture.md` §11.
 *
 * The table's first cell holds one or more backticked code names, the second a severity
 * word; the table ends at the first line that is not a row. Anything else throws, because
 * a silently empty taxonomy would make G-3 pass for the wrong reason.
 */
function readTaxonomy(): readonly TaxonomyRow[] {
  const text = readFileSync(ARCHITECTURE, 'utf8');
  const header = '| Code | Severity | Meaning |';
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex < 0) throw new Error('architecture §11 diagnostic table not found');

  const rows: TaxonomyRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').map((cell) => cell.trim());
    const codes = [...(cells[1] ?? '').matchAll(/`([A-Z][A-Z0-9_]+)`/g)]
      .map((match) => match[1])
      .filter((code): code is string => code !== undefined);
    if (codes.length === 0) continue;
    rows.push({ codes, severity: cells[2] ?? '' });
  }
  if (rows.length === 0) throw new Error('architecture §11 diagnostic table is empty');
  return rows;
}

/** Run `git` in the repository and return trimmed non-empty lines. */
function gitLines(args: readonly string[]): string[] {
  const output = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * True when `.gitignore` claims the path; any status but 0/1 is re-thrown.
 *
 * `--no-index` is load-bearing: without it `git check-ignore` does not judge a tracked path
 * at all, so a tracked-but-ignored fixture would read as "not ignored" and the gate would
 * pass for the wrong reason.
 */
function isIgnored(relativePath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', '--', relativePath], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch (error: unknown) {
    const status = (error as { status?: number | null }).status;
    if (status === 1) return false;
    throw error;
  }
}

/** Committed fixture files on disk for a class directory, dotfiles excluded. */
function committedFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .sort();
}

/** Paths of every tracked `.a5er` file that the catalog does not list, sorted. */
function unregisteredA5er(tracked: readonly string[], expected: readonly string[]): string[] {
  const allowed = new Set(expected);
  return tracked.filter((path) => !allowed.has(path)).sort();
}

/** Repository-relative paths of the catalogued synthetic fixtures, sorted. */
function syntheticPaths(): string[] {
  return FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic')
    .map((spec) => `tests/fixtures/synthetic/${spec.file}`)
    .sort();
}

/** Registry entries whose bytes are a committed file. */
function committedSpecs(): readonly FixtureSpec[] {
  return FIXTURES.filter(
    (spec) => spec.fixtureClass === 'synthetic' || spec.fixtureClass === 'bytes',
  );
}

describe('catalog — G-8 fixture integrity', () => {
  it('registers every §4 row exactly once', () => {
    const ids = FIXTURES.map((spec) => spec.id);
    expect(ids).toHaveLength(CATALOG_SIZE);
    expect(new Set(ids).size).toBe(ids.length);
    // Every id appears in exactly one materialisation class.
    for (const spec of FIXTURES) {
      expect(spec.file.trim(), spec.id).not.toBe('');
    }
  });

  it('has one materialisation per entry and none unaccounted for', () => {
    for (const spec of FIXTURES) {
      switch (spec.fixtureClass) {
        case 'synthetic':
        case 'bytes':
          expect(existsSync(join(fixtureDirectory(spec), spec.file)), spec.id).toBe(true);
          break;
        case 'generated':
          expect(
            GENERATED_BUILDERS[spec.id] !== undefined || GENERATED_IDS.includes(spec.id),
            spec.id,
          ).toBe(true);
          break;
        case 'injected':
        case 'catalog-wide':
          // A harness, not a file: nothing may exist at the virtual name.
          expect(
            existsSync(join(SYNTHETIC_DIR, spec.file)) || existsSync(join(BYTES_DIR, spec.file)),
            spec.id,
          ).toBe(false);
          break;
      }
    }
  });

  it('tracks every committed fixture and leaves none ignored', () => {
    const tracked = new Set(gitLines(['ls-files', '--', 'tests/fixtures']));
    for (const spec of committedSpecs()) {
      const relativePath = `tests/fixtures/${spec.fixtureClass}/${spec.file}`;
      expect(tracked.has(relativePath), `${spec.id}: ${relativePath} is not tracked`).toBe(true);
      expect(isIgnored(relativePath), `${spec.id}: ${relativePath} is ignored`).toBe(false);
    }
  });

  it('has no committed fixture file without an entry', () => {
    for (const directory of [SYNTHETIC_DIR, BYTES_DIR]) {
      const registered = new Set(
        committedSpecs()
          .filter((spec) => fixtureDirectory(spec) === directory)
          .map((spec) => spec.file),
      );
      const unregistered = committedFiles(directory).filter((name) => !registered.has(name));
      expect(unregistered, directory).toEqual([]);
    }
  });

  it('keeps the generated directory free of committed bytes', () => {
    // Builders write to tmpdir; anything here would be an unregistered fixture.
    expect(committedFiles(GENERATED_DIR)).toEqual([]);
    expect(gitLines(['ls-files', '--', 'tests/fixtures/generated'])).toEqual([
      'tests/fixtures/generated/.gitkeep',
    ]);
  });

  it('tracks exactly the catalogued synthetic fixtures as `.a5er` (G-9)', () => {
    // The `.gitignore` allowlist names the same paths one by one; a tracked `.a5er` that the
    // catalog does not list is a diagram nobody reviewed, not a fixture to accommodate.
    const tracked = gitLines(['ls-files', '*.a5er']).sort();
    expect(tracked).toHaveLength(syntheticPaths().length);
    expect(unregisteredA5er(tracked, syntheticPaths())).toEqual([]);
    expect(tracked).toEqual(syntheticPaths());
  });

  it('rejects a tracked `.a5er` that the catalog does not list (G-9, pure)', () => {
    // Pure on purpose: no file is created and nothing is staged, so no real diagram is at risk.
    const probe = 'tests/fixtures/synthetic/zzz-unregistered.a5er';
    const tracked = [...syntheticPaths(), probe];
    expect(unregisteredA5er(tracked, syntheticPaths())).toEqual([probe]);
    expect(tracked).not.toEqual(syntheticPaths());
  });

  it('allowlists only the catalogued paths, not the directory (G-9)', () => {
    for (const path of syntheticPaths()) expect(isIgnored(path), path).toBe(false);
    for (const path of [
      'unlisted.a5er',
      'docs/unlisted.a5er',
      'tests/fixtures/unlisted.a5er',
      'tests/fixtures/synthetic/zzz-unregistered.a5er',
      'tests/fixtures/synthetic/nested/zzz-unregistered.a5er',
    ]) {
      expect(isIgnored(path), path).toBe(true);
    }
  });

  it('has a builder for every generated entry and an entry for every builder', () => {
    const fromRegistry = FIXTURES.filter((spec) => spec.fixtureClass === 'generated')
      .map((spec) => spec.id)
      .sort();
    expect([...GENERATED_IDS].sort()).toEqual(fromRegistry);
  });
});

describe('catalog — G-3 diagnostic coverage', () => {
  it('reads a non-trivial non-fatal taxonomy from architecture §11', () => {
    const nonFatal = readTaxonomy()
      .filter((row) => row.severity !== 'fatal')
      .flatMap((row) => row.codes);
    // A parse that silently matched nothing would make the coverage gate vacuous.
    expect(nonFatal.length).toBeGreaterThanOrEqual(20);
    expect(nonFatal).toContain('S_UNKNOWN_KEY');
    expect(nonFatal).toContain('V_MISSING_REQUIRED_KEY');
  });

  it('exercises every non-fatal code in the taxonomy', () => {
    const nonFatal = readTaxonomy()
      .filter((row) => row.severity !== 'fatal')
      .flatMap((row) => row.codes);
    const covered = new Set(
      FIXTURES.flatMap((spec) => [
        ...spec.expectation.codes,
        ...(spec.expectation.files ?? []).flatMap((file) => file.codes),
      ]),
    );
    const missing = [...new Set(nonFatal)].filter((code) => !covered.has(code)).sort();
    expect(missing, 'non-fatal codes with no fixture').toEqual([]);
  });

  it('states a family expectation per file, not as one union', () => {
    // R7: res-03 and hst-06 are one catalog ID over several documents. Each document gets
    // its own status, exit code and multiset, and the family itself declares no codes —
    // a union here would be a shape no single file can produce.
    for (const id of ['res-03', 'hst-06']) {
      const spec = FIXTURES.find((candidate) => candidate.id === id);
      if (spec === undefined) throw new Error(`${id} is not registered`);
      const members = spec.expectation.files;
      if (members === undefined) throw new Error(`${id} declares no per-file expectation`);

      assertCodes(spec.expectation.codes, [], id);
      const built = GENERATED_BUILDERS[id]?.() ?? [];
      expect(members.map((member) => member.file).sort()).toEqual(
        built.map((file) => file.name).sort(),
      );
      for (const member of members) {
        expect(member.codes.length, `${id}/${member.file}`).toBeGreaterThan(0);
      }
    }

    // One limit code per file, matched by name: the mapping is the expectation.
    const res03 = FIXTURES.find((candidate) => candidate.id === 'res-03');
    const expected = new Map([
      ['res-03-max-bytes.a5er', ['E_LIMIT_BYTES']],
      ['res-03-max-lines.a5er', ['E_LIMIT_LINES']],
      ['res-03-max-line-length.a5er', ['E_LIMIT_LINE_LENGTH']],
    ]);
    for (const member of res03?.expectation.files ?? []) {
      assertCodes(member.codes, expected.get(member.file) ?? [], `res-03/${member.file}`);
    }
  });

  it('fails assertCodes when one occurrence is missing or extra', () => {
    expect(() => {
      assertCodes(['A', 'B', 'B'], ['A', 'B', 'B']);
    }).not.toThrow();
    expect(() => {
      assertCodes(['A', 'B'], ['A', 'B', 'B']);
    }).toThrow();
    expect(() => {
      assertCodes(['A', 'A', 'B'], ['A', 'B']);
    }).toThrow();
  });
});

/** The directory a committed fixture class lives in. */
function fixtureDirectory(spec: FixtureSpec): string {
  return spec.fixtureClass === 'bytes' ? BYTES_DIR : SYNTHETIC_DIR;
}
