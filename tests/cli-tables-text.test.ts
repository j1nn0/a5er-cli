/**
 * `tests/cli-tables-text.test.ts` — `a5er tables` text output through the real CLI
 * (`docs/proposals/human-cli.md` §4, §8.3, §3.3).
 *
 * Each case runs the built `dist/cli.js` on a staged fixture and compares **the whole stdout** with
 * the hand-authored expectation of `tests/helpers/tables-text-expectations.ts` — derived from the
 * fixture text and §4's rules, never from a run — and checks stderr and the exit code exactly.
 *
 * Covered here:
 *
 * - the eight fixtures of §8.3 (txt-01, sem-05, sem-08, sem-09, txt-04, val-08, hst-04, fmt-01), the
 *   last one being the CRLF fixture;
 * - an empty file (`failed`, exit `1`, the fatal line on stderr);
 * - the default format: `tables f`, `tables --format text f` and `tables f --format text` give the
 *   same bytes;
 * - TTY independence (§3.3): `COLUMNS`, `TERM`, `FORCE_COLOR` and `LANG` change nothing.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FAILED_EMPTY,
  FMT_01,
  HST_04,
  SEM_05,
  SEM_08,
  SEM_09,
  TXT_01,
  TXT_04,
  VAL_08,
} from './helpers/tables-text-expectations.js';
import { stage } from './helpers/stage.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the built CLI with a fixed environment, as `tests/cli.test.ts` does. */
function runCli(
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', ...extraEnv },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** Stage a committed fixture, probe its path, and always clean up. */
function withFixture<T>(id: string, probe: (path: string) => Promise<T>): Promise<T> {
  const staged = stage(id);
  return probe(staged.path).finally(() => {
    staged.cleanup();
  });
}

/**
 * The eight §8.3 fixtures: the hand-authored stdout and the exact stderr.
 *
 * stderr carries one line per `fatal`/`error` finding and nothing else (§3.6), so only sem-08 (a
 * duplicate name) and sem-09 (a missing required key) have one; val-08's malformed line is a
 * `warning` and hst-04's findings are `info`/`warning`, which never reach stderr.
 */
const DUPLICATE_LINE =
  'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n';
const MISSING_KEY_LINE =
  'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n';

const TEXT_CASES: readonly (readonly [string, string, string])[] = [
  ['txt-01', TXT_01, ''],
  ['sem-05', SEM_05, ''],
  ['sem-08', SEM_08, DUPLICATE_LINE],
  ['sem-09', SEM_09, MISSING_KEY_LINE],
  ['txt-04', TXT_04, ''],
  ['val-08', VAL_08, ''],
  ['hst-04', HST_04, ''],
  ['fmt-01', FMT_01, ''],
];

describe('a5er tables — text output, byte for byte (§8.3)', () => {
  for (const [id, expected, expectedStderr] of TEXT_CASES) {
    it(`renders ${id} exactly as §4 prescribes`, async () => {
      await withFixture(id, async (path) => {
        const result = await runCli(['tables', path]);

        expect(result.stdout).toBe(`${expected}\n`);
        expect(result.stderr).toBe(expectedStderr);
        // A `degraded` read is still a successful listing (§3.7).
        expect(result.code).toBe(0);
      });
    });
  }

  it('renders an empty input as the failed shape and exits 1', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-text-cli-'));
    try {
      const path = join(directory, 'empty.a5er');
      writeFileSync(path, '');

      const result = await runCli(['tables', path]);

      expect(result.stdout).toBe(`${FAILED_EMPTY}\n`);
      expect(result.code).toBe(1);
      expect(result.stderr).toBe('a5er: fatal: E_EMPTY_INPUT: The input is empty\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the output one LF-terminated line per record, with no CR and no blank line', async () => {
    await withFixture('txt-01', async (path) => {
      const result = await runCli(['tables', path]);
      const lines = result.stdout.slice(0, -1).split('\n');

      expect(result.stdout.endsWith('\n')).toBe(true);
      expect(result.stdout).not.toContain('\r');
      expect(result.stdout).not.toContain('\t');
      for (const line of lines) {
        expect(line).not.toBe('');
        expect(line).not.toMatch(/\s$/);
        expect(line).toMatch(/^(# .*|SECTION .*|[ 0-9].*)$/);
      }
    });
  });
});

describe('a5er tables — the text format is the default (§3.1, §3.3)', () => {
  it('gives the same bytes for the three spellings', async () => {
    await withFixture('fmt-01', async (path) => {
      const bare = await runCli(['tables', path]);
      const explicit = await runCli(['tables', '--format', 'text', path]);
      const trailing = await runCli(['tables', path, '--format', 'text']);

      expect(explicit.stdout).toBe(bare.stdout);
      expect(trailing.stdout).toBe(bare.stdout);
      expect(explicit.code).toBe(bare.code);
      expect(trailing.code).toBe(bare.code);
      expect(bare.stdout).toBe(`${FMT_01}\n`);
    });
  });

  it('does not depend on COLUMNS, TERM, FORCE_COLOR or LANG', async () => {
    await withFixture('txt-01', async (path) => {
      const baseline = await runCli(['tables', path]);
      const hostile = await runCli(['tables', path], {
        COLUMNS: '20',
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        LANG: 'ja_JP.UTF-8',
        LC_ALL: 'ja_JP.UTF-8',
      });

      expect(hostile.stdout).toBe(baseline.stdout);
      expect(hostile.stderr).toBe(baseline.stderr);
      expect(hostile.code).toBe(baseline.code);
    });
  });
});
