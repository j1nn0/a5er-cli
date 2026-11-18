/**
 * F1 — a writer-less FIFO must be refused, not waited on (`architecture.md` §10.1).
 *
 * `open(path, 'r')` on a FIFO waits for a writer, so the `fstat` that refuses a non-regular
 * input is never reached: `inspect` and `validate` hang with no envelope and no exit code. The
 * production reader opens read-only and non-blocking on POSIX, which returns at once and lets
 * the existing `E_NOT_A_FILE` path run. This file pins that outcome and nothing else.
 *
 * A blocked open cannot be observed from an in-process assertion (the test thread would block
 * with it), so each command runs as the built CLI in a child process under an external bound:
 * if the open ever blocks again, the child is killed at `CHILD_TIMEOUT_MS` and the case fails
 * with that as its message. The same runs also pin ordinary reporting — one envelope, exit 1,
 * one `fatal` line on stderr — so the fix cannot trade a hang for a changed contract.
 *
 * FIFOs are POSIX-only, so the suite is gated like the read-only check in
 * `tests/immutability.test.ts`. No real `.a5er` file, catalog fixture or golden is involved.
 */

import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonEnvelope } from '../src/json/index.js';
import { assertCodes } from './helpers/assert-codes.js';

/** The built CLI: the regression lives in the shipped reader, so the artifact is spawned. */
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** External bound for every child; a blocking `open` is killed here, never waited out. */
const CHILD_TIMEOUT_MS = 10_000;

/** Both shipped commands must refuse the same input the same way (§11's exit table). */
const SHIPPED_COMMANDS = ['inspect', 'validate'] as const;

/** `mkfifo` and FIFO special files are POSIX-only. */
const FIFO_SUPPORTED = process.platform !== 'win32';

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the child outlived its bound and had to be killed. */
  readonly timedOut: boolean;
}

/** Temporary directory that is removed, FIFOs and symlinks included, even when a test throws. */
async function withTempDir<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-fifo-'));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Create a FIFO at `path`; a missing `mkfifo` fails the case instead of skipping it. */
function makeFifo(path: string): void {
  const result = spawnSync('mkfifo', [path], { encoding: 'utf8' });
  expect(result.error, `mkfifo could not be run: ${String(result.error)}`).toBeUndefined();
  expect(result.status, `mkfifo failed: ${String(result.stderr)}`).toBe(0);
}

/**
 * Run the built CLI in a child process with a fixed environment so the run is
 * deterministic and offline (no network, no inherited locale or timezone).
 */
function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'utf8',
        timeout: CHILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
          return;
        }
        // The bound fired: the child was killed rather than exiting on its own.
        if (error.killed) {
          resolve({ code: null, stdout, stderr, timedOut: true });
          return;
        }
        if (typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code: error.code, stdout, stderr, timedOut: false });
      },
    );
  });
}

/** The one envelope stdout must carry: exactly one JSON document and one trailing newline. */
function envelopeOf(stdout: string): JsonEnvelope {
  expect(stdout.endsWith('\n')).toBe(true);
  expect(stdout.slice(0, -1)).not.toContain('\n');
  expect(stdout).not.toContain('a5er: ');
  return JSON.parse(stdout) as JsonEnvelope;
}

/**
 * Assert one command's answer for a writer-less FIFO: it returned on its own, exited 1, and
 * reported exactly the one fatal `E_NOT_A_FILE` finding a failed read carries.
 */
async function expectRefused(
  command: (typeof SHIPPED_COMMANDS)[number],
  path: string,
): Promise<void> {
  const result = await runCli([command, path]);

  // The bound is the regression assertion: a reader that waits for a writer is killed here.
  expect(result.timedOut, `${command} blocked opening a writer-less FIFO`).toBe(false);
  expect(result.code, `${command} exit code`).toBe(1);

  const envelope = envelopeOf(result.stdout);
  expect(envelope.command).toBe(command);
  expect(envelope.status).toBe('failed');
  // A rejected read has no source, no schema and no counts (§12, §14 row 11).
  expect(envelope.source).toBeNull();
  expect(envelope.schema).toBeNull();
  expect(envelope.completeness).toBeNull();
  // A failed read is never a truncation: nothing partial leaves the reader.
  expect(envelope.limits.truncated).toBe(false);
  assertCodes(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['E_NOT_A_FILE'],
    `${command} codes`,
  );
  expect(envelope.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['fatal']);

  // stderr is prose for the same finding, and nothing else.
  expect(result.stderr).toBe('a5er: fatal: E_NOT_A_FILE: The input is not a regular file\n');
}

describe('a writer-less FIFO is refused instead of awaited', () => {
  it.skipIf(!FIFO_SUPPORTED)(
    'answers inspect and validate with exit 1 and E_NOT_A_FILE',
    async () => {
      await withTempDir(async (directory) => {
        const fifo = join(directory, 'writerless.a5er');
        makeFifo(fifo);
        // The subject of the test, asserted before the CLI ever sees it.
        expect(statSync(fifo).isFIFO()).toBe(true);

        for (const command of SHIPPED_COMMANDS) {
          await expectRefused(command, fifo);
        }

        // Still a FIFO: the refused open neither replaced nor consumed the input.
        expect(statSync(fifo).isFIFO()).toBe(true);
      });
    },
  );

  it.skipIf(!FIFO_SUPPORTED)('refuses a symlink to a writer-less FIFO the same way', async () => {
    await withTempDir(async (directory) => {
      const fifo = join(directory, 'writerless.a5er');
      const link = join(directory, 'linked.a5er');
      makeFifo(fifo);
      symlinkSync(fifo, link);
      expect(statSync(link).isFIFO()).toBe(true);

      for (const command of SHIPPED_COMMANDS) {
        await expectRefused(command, link);
      }

      expect(statSync(fifo).isFIFO()).toBe(true);
    });
  });
});
