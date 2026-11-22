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
 * The writer's own state machine is covered by `tests/io-stdout.test.ts`. What this file adds is
 * the Phase A guard and R-20b's failing stderr; what it now also pins is *what Phase B reads*,
 * through the same seam: a `LoadedIntegrationInput` whose section decoding traps `fields` and
 * `indexes` renders for `tables` and trips for `inspect` (`docs/proposals/human-cli.md` §2, §5.5).
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
import type { LoadedIntegrationInput } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';
import { loadSource } from '../src/decode/load.js';
import { encodeJson, serialize } from '../src/json/index.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { renderTablesText } from '../src/text/index.js';
import { buildTablesEnvelope, toTablesEnvelope } from '../src/view/tables.js';
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

/* ── what Phase B reads: the stage results, never the schema-side decoding (§2, §5.5) ─────── */

/**
 * The four real stages over a staged path — the same composition `src/cli.ts` runs.
 *
 * The trap below is applied *after* this, so Phase A is the real one; the path is only ever read
 * by the test, and the staged copy is removed by its owner.
 */
function loadedInputOf(path: string): LoadedIntegrationInput {
  const load = loadSource(path);
  if (!load.ok) throw new Error(`${path} did not load`);
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

/** How often the trap below was consulted, and whether it fired. */
interface TrapCounts {
  blocked: number;
  positions: number;
}

/**
 * Wrap every section's `decoded` so that reading `fields` or `indexes` throws.
 *
 * This is the structural statement of plan B: `integrate()` reads only `decoded.positions`
 * (`validate/index.ts`), so Phase A still runs, and a Phase B that reached for the column list or
 * the index data would fail loudly. The wrapper is on the **input graph only** — no value that
 * lands in the output document is proxied — so `encodeJson`'s accessor-property rule is not in
 * play. Every other property is forwarded untouched.
 */
function trapDecoding(input: LoadedIntegrationInput, counts: TrapCounts): LoadedIntegrationInput {
  const sections = input.classification.sections.map((section) => ({
    ...section,
    decoded: new Proxy(section.decoded, {
      get(target, property, receiver): unknown {
        if (property === 'fields' || property === 'indexes') {
          counts.blocked += 1;
          throw new Error(`Phase B read decoded.${String(property)}`);
        }
        if (property === 'positions') counts.positions += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }),
  }));

  return { ...input, classification: { ...input.classification, sections } };
}

/**
 * A deterministic stream that completes every `write()` at once.
 *
 * The cases below never exercise backpressure, so a callback that returns immediately is the
 * shortest faithful model; `FakeStream` stays for the cases that control completion by hand.
 */
class InstantStream {
  readonly chunks: string[] = [];
  errored: Error | null = null;
  destroyed = false;

  write(chunk: string, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(chunk);
    callback();
    return true;
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

describe('runTablesCommand — Phase B reads the stage results, not the inspect envelope (§2, §5.5)', () => {
  it('renders both formats with decoded.fields and decoded.indexes trapped', async () => {
    const staged = stage('sem-05');
    try {
      const input = loadedInputOf(staged.path);
      // The expectation is the oracle's own bytes, taken before any wrapper exists.
      const oracle = toTablesEnvelope(serialize(input, { command: 'inspect', path: staged.path }));
      const expectedJson = [...encodeJson(oracle)].join('');
      const expectedText = [...renderTablesText(oracle)].join('');

      const counts: TrapCounts = { blocked: 0, positions: 0 };
      const trapped = trapDecoding(input, counts);

      // The wrapper is live and Phase A tolerates it: `integrate()` reads positions only.
      expect(() => integrate(trapped)).not.toThrow();
      expect(counts.positions).toBeGreaterThan(0);
      expect(counts.blocked).toBe(0);

      const phases: (0 | 1 | 70)[] = [];
      const jsonOut = new InstantStream();
      const jsonErr = new InstantStream();
      const jsonCode = await runTablesCommand({
        path: staged.path,
        format: 'json',
        stdout: jsonOut,
        stderr: jsonErr,
        pipeline: () => trapped,
        onPhaseACode: (code) => phases.push(code),
      });

      expect(jsonCode).toBe(0);
      expect(jsonOut.chunks.join('')).toBe(expectedJson);
      expect(jsonErr.chunks).toEqual([]);
      expect(counts.blocked).toBe(0);

      const textOut = new InstantStream();
      const textErr = new InstantStream();
      const textCode = await runTablesCommand({
        path: staged.path,
        format: 'text',
        stdout: textOut,
        stderr: textErr,
        pipeline: () => trapped,
        onPhaseACode: (code) => phases.push(code),
      });

      expect(textCode).toBe(0);
      expect(textOut.chunks.join('')).toBe(expectedText);
      expect(textErr.chunks).toEqual([]);
      expect(counts.blocked).toBe(0);

      // One `integrate()` per invocation, by construction: the hook fires once per run.
      expect(phases).toEqual([0, 0]);
    } finally {
      staged.cleanup();
    }
  });

  it('negative control: the same trapped input trips inside serialize()', () => {
    const staged = stage('sem-05');
    try {
      const input = loadedInputOf(staged.path);
      const counts: TrapCounts = { blocked: 0, positions: 0 };
      const trapped = trapDecoding(input, counts);

      // The inspect path builds the schema, so it reads the column list — the trap is sensitive.
      expect(() => serialize(trapped, { command: 'inspect', path: staged.path })).toThrow(
        'Phase B read decoded.fields',
      );
      expect(counts.blocked).toBeGreaterThan(0);

      // The builder states the same document without that read.
      expect(() =>
        buildTablesEnvelope(trapped, integrate(trapped), { path: staged.path }),
      ).not.toThrow();
    } finally {
      staged.cleanup();
    }
  });

  it('turns a missing semantic record into a generation failure, as the oracle did', async () => {
    const staged = stage('sem-05');
    try {
      const input = loadedInputOf(staged.path);
      // sem-05's entity is section 2; without its composition record neither document can be built.
      const broken: LoadedIntegrationInput = {
        ...input,
        semantics: {
          ...input.semantics,
          entityColumns: input.semantics.entityColumns.filter(
            (record) => record.sectionIndex !== 2,
          ),
        },
      };

      // Phase A still integrates: the defect is Phase B's, which is the point of the case.
      expect(() => integrate(broken)).not.toThrow();

      for (const format of ['json', 'text'] as const) {
        const stdout = new InstantStream();
        const stderr = new InstantStream();
        const code = await runTablesCommand({
          path: staged.path,
          format,
          stdout,
          stderr,
          pipeline: () => broken,
        });

        expect(code, format).toBe(70);
        expect(stdout.chunks, format).toEqual([]);
        expect(stderr.chunks.join(''), format).toBe(OUTPUT_GENERATION_FAILED_LINE);
      }

      // The same defect, the same message, in the command that has always had it.
      const message =
        'json envelope: effective columns for section 2 is missing from the semantics';
      expect(() => serialize(broken, { command: 'inspect', path: staged.path })).toThrow(message);
      expect(() => buildTablesEnvelope(broken, integrate(broken), { path: staged.path })).toThrow(
        message,
      );
    } finally {
      staged.cleanup();
    }
  });
});
