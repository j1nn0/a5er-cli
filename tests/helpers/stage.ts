/**
 * Fixture staging — copies a committed fixture to a throwaway directory under
 * its real `.a5er` extension, byte for byte.
 *
 * Rules it enforces (docs/test-strategy.md §3.5):
 * - bytes are copied with `copyFileSync`, never decoded and re-encoded;
 * - the staged path is always outside `tests/fixtures/`, so a test can never
 *   write back into the repository;
 * - a fixture is requested by its catalog ID and resolved through the registry, so a
 *   file name is never synthesised from an ID (IDs are not file stems);
 * - `sha256` is the hash of the staged bytes, for immutability assertions;
 * - the temporary directory is removed by an idempotent `cleanup()`.
 *
 * Only `node:fs`, `node:os` and `node:path` are used: no shell, no network, so
 * it behaves the same on Linux, macOS and Windows.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixture-registry.js';

/** Absolute path to `tests/fixtures/`. */
export const FIXTURES_ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Committed, text-shaped fixtures staged to `.a5er` at run time. */
export const SYNTHETIC_DIR = join(FIXTURES_ROOT, 'synthetic');

/** Committed byte-shaped fixtures, exported as bytes rather than staged. */
export const BYTES_DIR = join(FIXTURES_ROOT, 'bytes');

/** Test-time generators for size and fuzz cases. */
export const GENERATED_DIR = join(FIXTURES_ROOT, 'generated');

/** Suffix a catalog ID is stored under inside `synthetic/`. */
export const SYNTHETIC_SUFFIX = '.a5er';

/** Extension the code under test must see. */
export const STAGED_EXTENSION = '.a5er';

export interface StageOptions {
  /** Compare source and staged bytes and throw on any difference. */
  readonly verifyBytes?: boolean;
  /** Parent directory for the staging directory; defaults to `os.tmpdir()`. */
  readonly root?: string;
}

export interface StagedFile {
  /** Catalog ID, or the file stem when staged from a direct path. */
  readonly id: string;
  /** Absolute path of the staged file, with the `.a5er` extension. */
  readonly path: string;
  /** Absolute path of the file that was copied. */
  readonly sourcePath: string;
  /** SHA-256 of the staged bytes (equal to the source hash, checked). */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Remove the staging directory. Safe to call more than once. */
  cleanup(): void;
}

const ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `path` is inside the fixtures tree. */
export function isInsideFixtures(path: string): boolean {
  const rel = relative(FIXTURES_ROOT, path);
  // On Windows, `relative()` between roots on different drives returns the
  // absolute target (e.g. `C:\Users\...` while the repository is on `D:`); the
  // staging directory and the checkout usually sit on different drives there.
  // An absolute result can never describe a path inside the tree.
  if (isAbsolute(rel)) return false;
  return (
    rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.includes(`..${sep}`)
  );
}

/** True when `path` is `tree` itself or inside it — stricter than `isInsideFixtures`. */
function isWithinTree(tree: string, path: string): boolean {
  const rel = relative(tree, path);
  // A cross-drive `relative()` result is absolute and can never describe a child path.
  if (isAbsolute(rel)) return false;
  if (rel === '') return true;
  return !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.includes(`..${sep}`);
}

/**
 * Refuse a staging root that would put the copy inside the fixtures tree (test-strategy §3.5).
 *
 * Checked **before** `mkdtempSync`: copying first and checking the copy would create a
 * directory and a file inside the repository and only then delete them, so a crash or a full
 * disk in that window would leave both behind. The root is checked lexically and, when it
 * exists, through `realpath`, so a symlink from outside the repository that points into
 * `tests/fixtures/` cannot pass the lexical test.
 */
function assertRootIsOutsideFixtures(root: string): void {
  const fixturesReal = realpathSync(FIXTURES_ROOT);
  const candidates = [resolve(root)];
  if (existsSync(root)) candidates.push(realpathSync(root));

  for (const candidate of candidates) {
    if (isWithinTree(fixturesReal, candidate) || isWithinTree(FIXTURES_ROOT, candidate)) {
      throw new Error(`refusing to stage inside the fixtures tree: ${candidate}`);
    }
  }
}

/** SHA-256 of a file's bytes, lowercase hex. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** List committed synthetic fixtures as IDs (file names without `.a5er`). */
export function listSyntheticFixtures(): string[] {
  return readdirSync(SYNTHETIC_DIR)
    .filter((name) => name.endsWith(SYNTHETIC_SUFFIX))
    .map((name) => name.slice(0, -SYNTHETIC_SUFFIX.length))
    .sort();
}

function assertSafeId(id: string): void {
  if (!ID_SAFE.test(id)) {
    throw new Error(`unsafe fixture id: ${JSON.stringify(id)}`);
  }
}

/**
 * Copy `sourcePath` into a fresh temporary directory as `<id>.a5er`.
 *
 * Throws when the source does not exist or when the copy is not byte-identical
 * to the source — a silent mismatch here would invalidate every fixture test.
 * `id` is explicit so the caller decides the staged file's name; it is never
 * re-derived from the source path.
 */
function stageFile(sourcePath: string, id: string, options: StageOptions = {}): StagedFile {
  if (!existsSync(sourcePath)) {
    throw new Error(`fixture source not found: ${sourcePath}`);
  }
  // Staging may read from the fixtures tree; it must never write into it (checked below).
  if (!statSync(sourcePath).isFile()) {
    throw new Error(`fixture source is not a file: ${sourcePath}`);
  }

  assertSafeId(id);

  const sourceBytes = readFileSync(sourcePath);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');

  const root = options.root ?? tmpdir();
  // R10: the root is validated before `mkdtempSync`, so a rejected root creates nothing.
  assertRootIsOutsideFixtures(root);

  const directory = mkdtempSync(join(root, 'a5er-fixture-'));
  const target = join(directory, `${id}${STAGED_EXTENSION}`);

  try {
    copyFileSync(sourcePath, target);

    if (options.verifyBytes === true) {
      const stagedBytes = readFileSync(target);
      if (!stagedBytes.equals(sourceBytes)) {
        throw new Error(`staged bytes differ from source for ${id}`);
      }
    }

    const stagedBytes = readFileSync(target);
    const stagedHash = createHash('sha256').update(stagedBytes).digest('hex');
    if (stagedHash !== sourceHash) {
      throw new Error(`staged hash ${stagedHash} != source hash ${sourceHash} for ${id}`);
    }

    if (isInsideFixtures(target)) {
      throw new Error(`refusing to stage inside the fixtures tree: ${target}`);
    }

    let cleaned = false;
    return {
      id,
      path: target,
      sourcePath,
      sha256: stagedHash,
      sizeBytes: stagedBytes.byteLength,
      cleanup(): void {
        if (cleaned) return;
        cleaned = true;
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Stage a file by direct path; the staged ID is the file stem without `.a5er`. */
export function stageSource(sourcePath: string, options: StageOptions = {}): StagedFile {
  const id = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1).replace(SYNTHETIC_SUFFIX, '');
  return stageFile(sourcePath, id, options);
}

/**
 * Stage a committed synthetic fixture by catalog ID (`fmt-01`).
 *
 * The ID is resolved through the fixture registry, so the file name comes from
 * `FIXTURES` and is never synthesised from the ID: catalog IDs are not file
 * stems (`fmt-01` is `fmt-01-baseline.a5er`). Byte fixtures are imported as
 * modules by their consumers, so asking to stage one is an error, not a guess.
 */
export function stage(id: string, options: StageOptions = {}): StagedFile {
  // Checked before the lookup, so a traversal attempt always reads as unsafe.
  assertSafeId(id);

  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`unknown fixture id: ${id}`);
  if (spec.fixtureClass !== 'synthetic') {
    throw new Error(`fixture ${id} is a ${spec.fixtureClass} fixture, not stageable by ID`);
  }

  const sourcePath = join(SYNTHETIC_DIR, spec.file);
  if (!isInsideFixtures(sourcePath)) {
    throw new Error(`fixture ${id} resolves outside the fixtures tree: ${sourcePath}`);
  }

  return stageFile(sourcePath, spec.id, options);
}
