/**
 * Fixture staging — copies a committed fixture to a throwaway directory under
 * its real `.a5er` extension, byte for byte.
 *
 * Rules it enforces (docs/test-strategy.md §3.5):
 * - bytes are copied with `copyFileSync`, never decoded and re-encoded;
 * - the staged path is always outside `tests/fixtures/`, so a test can never
 *   write back into the repository;
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
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to `tests/fixtures/`. */
export const FIXTURES_ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Committed, text-shaped fixtures staged to `.a5er` at run time. */
export const SYNTHETIC_DIR = join(FIXTURES_ROOT, 'synthetic');

/** Committed byte-shaped fixtures, exported as bytes rather than staged. */
export const BYTES_DIR = join(FIXTURES_ROOT, 'bytes');

/** Test-time generators for size and fuzz cases. */
export const GENERATED_DIR = join(FIXTURES_ROOT, 'generated');

/** Suffix a catalog ID is stored under inside `synthetic/`. */
export const SYNTHETIC_SUFFIX = '.a5er.txt';

/** Extension the code under test must see. */
export const STAGED_EXTENSION = '.a5er';

export interface StageOptions {
  /** Compare source and staged bytes and throw on any difference. */
  readonly verifyBytes?: boolean;
  /** Parent directory for the staging directory; defaults to `os.tmpdir()`. */
  readonly root?: string;
}

export interface StagedFile {
  /** Catalog ID or file stem the fixture was staged under. */
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
  return (
    rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.includes(`..${sep}`)
  );
}

/** SHA-256 of a file's bytes, lowercase hex. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** List committed synthetic fixtures as IDs (file names without `.a5er.txt`). */
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
 */
export function stageSource(sourcePath: string, options: StageOptions = {}): StagedFile {
  if (!existsSync(sourcePath)) {
    throw new Error(`fixture source not found: ${sourcePath}`);
  }
  // Staging may read from the fixtures tree; it must never write into it (checked below).
  if (!statSync(sourcePath).isFile()) {
    throw new Error(`fixture source is not a file: ${sourcePath}`);
  }

  const id = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1).replace(SYNTHETIC_SUFFIX, '');
  assertSafeId(id);

  const sourceBytes = readFileSync(sourcePath);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');

  const directory = mkdtempSync(join(options.root ?? tmpdir(), 'a5er-fixture-'));
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

/**
 * Stage a committed synthetic fixture by catalog ID (`fmt-01` or the full file
 * name). This is the only supported way to read fixture bytes.
 */
export function stage(id: string, options: StageOptions = {}): StagedFile {
  const file = id.endsWith(SYNTHETIC_SUFFIX) ? id : `${id}${SYNTHETIC_SUFFIX}`;
  assertSafeId(file.replace(SYNTHETIC_SUFFIX, ''));
  return stageSource(join(SYNTHETIC_DIR, file), options);
}
