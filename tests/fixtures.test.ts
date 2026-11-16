/**
 * Fixture infrastructure tracking test.
 *
 * Guards the wiring U-2 depends on: the three fixture directories, the typed
 * registry, and the staging helper's byte fidelity and cleanup. It is written to
 * pass with an empty catalog, so adding the 14 fixtures cannot "fix" a broken
 * test by accident — it only adds data to a contract already under test.
 *
 * Rules exercised here come from docs/test-strategy.md §3.4–§3.6 and §10.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURES, validateRegistry } from './helpers/fixture-registry.js';
import {
  BYTES_DIR,
  FIXTURES_ROOT,
  GENERATED_DIR,
  SYNTHETIC_DIR,
  SYNTHETIC_SUFFIX,
  isInsideFixtures,
  listSyntheticFixtures,
  sha256File,
  stage,
  stageSource,
} from './helpers/stage.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Relative `git check-ignore` answer; throws on any status other than 0/1. */
function isIgnoredByGit(relativePath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relativePath], {
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

function gitLines(args: readonly string[]): string[] {
  const output = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** A buffer that exercises every byte hazard staging must survive. */
function hazardousBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
    Buffer.from('# A5:ER FORMAT:21\r\n', 'utf8'),
    Buffer.from('[Comment]\r\n', 'utf8'),
    Buffer.from('Text="日本語のメモ"\r\n', 'utf8'),
    Buffer.from([0x83, 0x65, 0x83, 0x58]), // Shift_JIS bytes, invalid as UTF-8
  ]);
}

describe('fixture directories', () => {
  it('exist and are tracked through a .gitkeep', () => {
    for (const directory of [SYNTHETIC_DIR, BYTES_DIR, GENERATED_DIR]) {
      expect(statSync(directory).isDirectory()).toBe(true);
      expect(existsSync(join(directory, '.gitkeep'))).toBe(true);
    }
  });
});

describe('fixture registry', () => {
  it('has no validation problems', () => {
    expect(validateRegistry(FIXTURES)).toEqual([]);
  });

  it('uses unique IDs', () => {
    const ids = FIXTURES.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists exactly the synthetic fixtures that are on disk', () => {
    const fromRegistry = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic')
      .map((spec) => spec.file.slice(0, -SYNTHETIC_SUFFIX.length))
      .sort();

    expect(listSyntheticFixtures()).toEqual(fromRegistry);
  });
});

describe('fixture staging', () => {
  it('treats a target on a different root as outside the fixtures tree', () => {
    // The staging directory lives under the OS temp dir, which on Windows is
    // usually a different drive than the checkout (D: for the repository, C:
    // for the temp dir). `path.relative()` then returns the absolute target
    // instead of a `..` path, and that can never mean "inside".
    const outside = join(tmpdir(), 'a5er-fixture-probe', 'case.a5er');
    expect(isInsideFixtures(outside)).toBe(false);

    // Same rule, expressed with win32 semantics so it holds on every runner.
    const crossDrive = win32.relative('D:\\repo\\tests\\fixtures', 'C:\\Temp\\case.a5er');
    expect(win32.isAbsolute(crossDrive)).toBe(true);

    // A real fixture path is still classified as inside.
    expect(isInsideFixtures(join(FIXTURES_ROOT, 'synthetic', 'case.a5er.txt'))).toBe(true);
  });

  it('rejects IDs that would escape the fixture directory', () => {
    expect(() => stage('../escape')).toThrow(/unsafe fixture id/);
    expect(() => stage('nested/id')).toThrow(/unsafe fixture id/);
    expect(() => stage('.hidden')).toThrow(/unsafe fixture id/);
  });

  it('preserves bytes exactly, including BOM, CRLF, Japanese text and invalid UTF-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a5er-src-'));
    try {
      const source = join(dir, 'enc-check.a5er.txt');
      const bytes = hazardousBytes();
      writeFileSync(source, bytes);

      const staged = stageSource(source, { verifyBytes: true });
      try {
        expect(readFileSync(staged.path).equals(bytes)).toBe(true);
        expect(staged.sha256).toBe(sha256File(source));
        expect(staged.sizeBytes).toBe(bytes.byteLength);
        expect(staged.path.endsWith('.a5er')).toBe(true);
      } finally {
        staged.cleanup();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stages outside the fixtures tree and removes its directory on cleanup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a5er-src-'));
    try {
      const source = join(dir, 'sem-check.a5er.txt');
      writeFileSync(source, Buffer.from('PName="users"\n', 'utf8'));

      const staged = stageSource(source);
      expect(isInsideFixtures(staged.path)).toBe(false);
      expect(existsSync(staged.path)).toBe(true);

      staged.cleanup();
      expect(existsSync(staged.path)).toBe(false);
      expect(() => {
        staged.cleanup();
      }).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the source file untouched (hash, size and mtime)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a5er-src-'));
    try {
      const source = join(dir, 'imm-check.a5er.txt');
      writeFileSync(source, hazardousBytes());

      const before = {
        sha: sha256File(source),
        size: statSync(source).size,
        mtime: statSync(source).mtimeMs,
      };

      const staged = stageSource(source, { verifyBytes: true });
      staged.cleanup();

      expect(sha256File(source)).toBe(before.sha);
      expect(statSync(source).size).toBe(before.size);
      expect(statSync(source).mtimeMs).toBe(before.mtime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixture ignore policy', () => {
  it('ignores *.a5er anywhere in the fixtures tree', () => {
    expect(isIgnoredByGit('tests/fixtures/synthetic/case.a5er')).toBe(true);
    expect(isIgnoredByGit('tests/fixtures/bytes/case.a5er')).toBe(true);
  });

  it('does not ignore the committed *.a5er.txt form', () => {
    expect(isIgnoredByGit('tests/fixtures/synthetic/case.a5er.txt')).toBe(false);
  });

  it('tracks no file with a .a5er extension', () => {
    expect(gitLines(['ls-files', '*.a5er'])).toEqual([]);
  });
});

describe('fixture access rule', () => {
  it('no test file reads tests/fixtures/** directly', () => {
    // Built from parts so this guard does not match its own source text.
    const tree = ['tests', 'fixtures'].join('/');
    const needles = [
      `readFileSync('${tree}`,
      `readFileSync("${tree}`,
      `readFileSync(\`${tree}`,
      `readFileSync(join('${tree}`,
    ];

    const offenders = readdirSync(TESTS_DIR, { recursive: true })
      .map((entry) => String(entry))
      .filter((entry) => entry.endsWith('.test.ts'))
      .filter((entry) => {
        const text = readFileSync(join(TESTS_DIR, entry), 'utf8');
        return needles.some((needle) => text.includes(needle));
      });

    expect(offenders).toEqual([]);
  });
});
