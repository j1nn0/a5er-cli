/**
 * `tests/tables-command.test.ts` — the Phase A guard (`docs/proposals/human-cli.md` §7.2 item 10,
 * §7.3 R-20 and R-20b).
 *
 * `runTablesCommand` is the one place a defect in the pipeline can be caught before any output
 * exists: `load`, `scan`, `classify`, `derivePartialSemantics` or `integrate()` throwing is an
 * internal error, not a finding about the file. The `pipeline` seam is what lets a test inject that
 * throw without a broken document.
 *
 * Both cases run the real command with a deterministic stderr fake — no timers, no real pipes — and
 * assert the promise settles, because a hang here would be a process that never exits.
 *
 * The writer's own state machine is covered by `tests/io-stdout.test.ts`; this file is only the
 * Phase A guard and what R-20b adds to it (a stderr write that fails by callback alone).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OutputStream } from '../src/io/stdout.js';
import { OUTPUT_GENERATION_FAILED_LINE } from '../src/io/stdout.js';
import { runTablesCommand } from '../src/tables-command.js';
import type { IntegrationInput } from '../src/validate/index.js';
import { stage } from './helpers/stage.js';

/** The line the guard must write, byte for byte (§7.2's table). */
const INTERNAL_ERROR =
  'a5er: error: internal error while generating output; the output is incomplete\n';

/** The message the injected defect carries; it must never reach stderr. */
const SECRET = '/secret/path: file text';

/**
 * A minimal deterministic stream.
 *
 * `write()` records the chunk and holds the callback until the test calls `complete(i, error?)`;
 * `errored`/`destroyed` are plain fields so a case can start from the "already closed" state.
 */
class FakeStream {
  readonly chunks: string[] = [];
  readonly #callbacks: ((error?: Error | null) => void)[] = [];
  #returns = true;
  errored: Error | null = null;
  destroyed = false;

  /** Make the next `write()` return `false` (backpressure). */
  backpressure(): void {
    this.#returns = false;
  }

  write(chunk: string, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(chunk);
    this.#callbacks.push(callback);
    return this.#returns;
  }

  /** Call every held callback successfully; a duplicate call is ignored by the writer. */
  completeAll(): void {
    for (const callback of this.#callbacks) callback();
  }

  /** Call the `index`-th write's callback. */
  complete(index: number, error?: Error): void {
    const callback = this.#callbacks[index];
    if (callback === undefined) throw new Error(`no callback at ${String(index)}`);
    callback(error ?? null);
  }

  once(): unknown {
    return undefined;
  }

  on(): unknown {
    return undefined;
  }

  off(): unknown {
    return undefined;
  }
}

/** The fake satisfies the writer's structural type without a cast. */
function asOutputStream(stream: FakeStream): OutputStream {
  return stream;
}

/** Let every pending promise reaction run, without a timer. */
async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** A pipeline that always throws, standing in for a defect in Phase A. */
function throwingPipeline(): IntegrationInput {
  throw new Error(SECRET);
}

describe('runTablesCommand — the Phase A guard (§7.2 item 10, R-20)', () => {
  it('writes nothing to stdout and exits 70 with only the internal-error line', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();

    const code = await runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
    });

    expect(code).toBe(70);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join('')).toBe(INTERNAL_ERROR);
    expect(INTERNAL_ERROR).toBe(OUTPUT_GENERATION_FAILED_LINE);
    // The exception is caught and discarded: no message, no path, no stack trace.
    expect(stderr.chunks.join('')).not.toContain('/secret/path');
    expect(stderr.chunks.join('')).not.toContain('file text');
    expect(stderr.chunks.join('')).not.toContain('Error');
  });

  it('does the same for the JSON format, since the guard runs before the format matters', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();

    const code = await runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'json',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
    });

    expect(code).toBe(70);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join('')).toBe(INTERNAL_ERROR);
  });

  it('still exits 70 when stderr is already closed', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    stderr.destroyed = true;

    const code = await runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
    });

    expect(code).toBe(70);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual([]);
  });
});

describe('runTablesCommand — R-20b, the guard when stderr fails too', () => {
  it('finishes after a stderr callback error alone, with no drain, error or close event', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    stderr.backpressure();
    let settled = false;

    const done = runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
    }).then((code) => {
      settled = true;
      return code;
    });

    // The guard's one line is written, the `false` return holds it, and the failing callback is the
    // only signal the writer ever gets: `'drain'` never arrives.
    await flush();
    expect(stderr.chunks).toHaveLength(1);
    expect(settled).toBe(false);

    stderr.complete(0, Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }));

    await flush();
    expect(settled).toBe(true);
    await expect(done).resolves.toBe(70);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toHaveLength(1);
  });
});

describe('runTablesCommand — the Phase A code reaches the CLI before the first write (§7.2 item 1)', () => {
  it('reports the read code before any stdout byte, and only once', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const seen: { code: number; writesSoFar: number }[] = [];
    const staged = stage('fmt-01');

    try {
      const pending = runTablesCommand({
        path: staged.path,
        format: 'text',
        stdout: asOutputStream(stdout),
        stderr: asOutputStream(stderr),
        onPhaseACode: (phaseA) => {
          // The whole point of §7.2 item 1: at this moment nothing has been written yet.
          seen.push({ code: phaseA, writesSoFar: stdout.chunks.length });
        },
      });
      await flush();
      stdout.completeAll();
      await flush();
      stderr.completeAll();
      const code = await pending;

      expect(code).toBe(0);
      expect(seen).toEqual([{ code: 0, writesSoFar: 0 }]);
      expect(stdout.chunks.length).toBeGreaterThan(0);
    } finally {
      staged.cleanup();
    }
  }, 60_000);

  it('reports 1 for a fatal read, still before the first write', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const seen: { code: number; writesSoFar: number }[] = [];
    const directory = mkdtempSync(join(tmpdir(), 'a5er-phase-a-'));
    try {
      const path = join(directory, 'empty.a5er');
      writeFileSync(path, '');

      const pending = runTablesCommand({
        path,
        format: 'text',
        stdout: asOutputStream(stdout),
        stderr: asOutputStream(stderr),
        onPhaseACode: (phaseA) => {
          seen.push({ code: phaseA, writesSoFar: stdout.chunks.length });
        },
      });
      await flush();
      stdout.completeAll();
      await flush();
      stderr.completeAll();
      const code = await pending;

      expect(code).toBe(1);
      expect(seen).toEqual([{ code: 1, writesSoFar: 0 }]);
      // The failed shape is still written, and the fatal line reaches stderr.
      expect(stdout.chunks.join('')).toContain('# status: failed');
      expect(stderr.chunks.join('')).toBe('a5er: fatal: E_EMPTY_INPUT: The input is empty\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('reports 70 when the Phase A guard fires, and writes nothing to stdout', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const seen: number[] = [];

    const pending = runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
      onPhaseACode: (phaseA) => {
        seen.push(phaseA);
      },
    });
    await flush();
    stderr.completeAll();
    const code = await pending;

    expect(code).toBe(70);
    expect(seen).toEqual([70]);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join('')).toBe(OUTPUT_GENERATION_FAILED_LINE);
  });
});

describe('runTablesCommand — a throw from integrate() inside Phase A (R-20 boundary)', () => {
  it('treats an integrate() throw as a generation failure: 70, empty stdout, one line', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const seen: number[] = [];

    // R-20 names the `integrate` step explicitly. `pipeline` returns a value whose shape makes
    // `integrate()` throw inside Phase A's guard: `{}` has no `load`, so it fails the moment the
    // integration reads it. This is the boundary the pipeline seam exists for.
    const pending = runTablesCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: () => ({}) as IntegrationInput,
      onPhaseACode: (phaseA) => {
        seen.push(phaseA);
      },
    });
    await flush();
    stderr.completeAll();
    const code = await pending;

    expect(code).toBe(70);
    expect(seen).toEqual([70]);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join('')).toBe(OUTPUT_GENERATION_FAILED_LINE);
    // The TypeError's message is a runtime detail and never reaches the stream.
    expect(stderr.chunks.join('')).not.toContain('Cannot read properties');
  });
});
