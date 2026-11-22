/**
 * `tests/cli-tables-immutability.test.ts` — `tables` never writes anything
 * (`docs/proposals/human-cli.md` §7.8, `architecture.md` §10.4).
 *
 * Two properties, both over the real CLI:
 *
 * 1. **The input is untouched.** For every staged synthetic fixture, `tables` (text) and
 *    `tables --format json` leave the staged file's sha256, size and mtime exactly as they were.
 *    The copy is disposable (`tests/helpers/stage.ts`), so a failure never reaches the repository.
 * 2. **Nothing is created.** Run with the working directory set to an empty temp directory, the
 *    command creates no file, temp file or cache there, and makes no network call.
 *
 * `tests/immutability.test.ts` is not modified: it covers `inspect`/`validate`, and this file is the
 * `tables` counterpart §7.8 asks for.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';
import { sha256File } from './helpers/stage.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** Every synthetic fixture, by catalog ID. */
const SYNTHETIC_IDS: readonly string[] = FIXTURES.filter(
  (spec) => spec.fixtureClass === 'synthetic',
).map((spec) => spec.id);

/** Run the built CLI to completion in `cwd`. */
function runCli(args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd, encoding: 'utf8', timeout: 20_000, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
      (error) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve(code);
      },
    );
  });
}

/** The three facts §7.8 pins: content, size and modification time. */
function snapshotOf(path: string): { sha256: string; size: number; mtimeMs: number } {
  const stat = statSync(path);
  return { sha256: sha256File(path), size: stat.size, mtimeMs: stat.mtimeMs };
}

describe('a5er tables — the input file is never modified (§7.8)', () => {
  it('leaves every staged fixture byte-, size- and mtime-identical in both formats', async () => {
    const failures: string[] = [];

    for (const id of SYNTHETIC_IDS) {
      const staged = stage(id);
      try {
        const before = snapshotOf(staged.path);
        const textCode = await runCli(['tables', staged.path], tmpdir());
        const afterText = snapshotOf(staged.path);
        const jsonCode = await runCli(['tables', '--format', 'json', staged.path], tmpdir());
        const afterJson = snapshotOf(staged.path);

        // A `failed` read exits 1; anything else is an internal error and worth failing on.
        if (textCode !== 0 && textCode !== 1) failures.push(`${id}: text exit ${String(textCode)}`);
        if (jsonCode !== 0 && jsonCode !== 1) failures.push(`${id}: json exit ${String(jsonCode)}`);

        if (JSON.stringify(before) !== JSON.stringify(afterText)) {
          failures.push(`${id}: text changed the input`);
        }
        if (JSON.stringify(before) !== JSON.stringify(afterJson)) {
          failures.push(`${id}: json changed the input`);
        }
      } finally {
        staged.cleanup();
      }
    }

    expect(failures).toEqual([]);
  }, 180_000);
});

describe('a5er tables — nothing is written anywhere (§7.8)', () => {
  it('creates no file in an empty working directory', async () => {
    const staged = stage('txt-01');
    const cwd = mkdtempSync(join(tmpdir(), 'a5er-imm-cwd-'));
    try {
      expect(await runCli(['tables', staged.path], cwd)).toBe(0);
      expect(await runCli(['tables', '--format', 'json', staged.path], cwd)).toBe(0);

      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      staged.cleanup();
    }
  }, 60_000);
});
