/**
 * `src/io/stdout.ts` — the writer's state machine (`docs/proposals/human-cli.md` §7.2, §7.3).
 *
 * Every case is deterministic: `ControlledWritable` is an `EventEmitter` fake whose `write()`
 * returns a value the test chose, whose callbacks are held until the test calls `complete(i, error)`,
 * and whose `'error'`/`'drain'`/`'close'` events the test emits itself. There is no `setTimeout`, no
 * wall-clock delay and no fake timer, so each event order is chosen and each expectation is exact.
 *
 * A hang is detected without a timer: the test records when the promise resolved, lets the pending
 * reactions run with one `setImmediate`, and then asserts that it has resolved.
 *
 * The cases are §7.3's R-3 to R-23 including the extra R-7b and R-20b, plus the compile-time
 * assignment checks of §7.2 (`OutputStream` accepts `process.stdout`, a `Writable` and this fake, and
 * rejects an object without `errored`).
 *
 * `D` below is §7.3's diagnostic line. Unless stated otherwise: two stdout chunks `A` and `B`, one
 * stderr line `[D]`, `readCode` 0, and every `write()` returns `true`.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { OutputStream } from '../src/io/stdout.js';
import { writeOutput } from '../src/io/stdout.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { tablesDiagnosticLines } from '../src/text/index.js';
import type { Integration } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';

/** §7.3's diagnostic line. */
const D =
  'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n';

/** The two outcome lines and the two generation-failure lines of §7.2. */
const CANNOT_WRITE = (code: string): string => `a5er: error: cannot write to stdout (${code})\n`;
const EARLY_CLOSE = 'a5er: error: stdout closed before the output was complete\n';
const GENERATION_FAILED =
  'a5er: error: internal error while generating output; the output is incomplete\n';
const DIAGNOSTICS_FAILED =
  'a5er: error: internal error while generating diagnostics; the diagnostics are incomplete\n';

/** An error with a `code`, the shape `errorCode()` reads. */
function codedError(code: string): Error {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

/** What one `write()` call does: return a value, throw, or emit an `'error'` from inside. */
interface WriteBehaviour {
  readonly returns?: boolean;
  readonly throws?: Error;
  readonly emitsError?: Error;
}

/**
 * §7.3's controlled fake.
 *
 * `write()` records the chunk and holds the callback. The test decides the return value per call,
 * completes callbacks in the order it wants, and emits events itself. `errored` and `destroyed` are
 * plain mutable fields so a case can set the "already closed" state before any write.
 */
class ControlledWritable extends EventEmitter implements OutputStream {
  readonly chunks: string[] = [];
  readonly #callbacks: ((error?: Error | null) => void)[] = [];
  readonly #behaviours: WriteBehaviour[] = [];
  #default: WriteBehaviour = { returns: true };
  errored: Error | null = null;
  destroyed = false;

  /** Record the chunk, hold the callback, and do whatever the test chose for this call. */
  write(chunk: string, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(chunk);
    const index = this.#callbacks.length;
    this.#callbacks.push(callback);
    const behaviour = this.#behaviours[index] ?? this.#default;

    if (behaviour.emitsError !== undefined) this.emit('error', behaviour.emitsError);
    if (behaviour.throws !== undefined) throw behaviour.throws;
    return behaviour.returns ?? true;
  }

  /** Choose what the next write(s) do, in order; anything past the list uses `#default`. */
  behave(...behaviours: readonly WriteBehaviour[]): void {
    this.#behaviours.push(...behaviours);
  }

  /** Call the `index`-th write's callback, optionally with an error. */
  complete(index: number, error?: Error): void {
    const callback = this.#callbacks[index];
    if (callback === undefined) throw new Error(`no callback at ${String(index)}`);
    callback(error ?? null);
  }

  /** How many callbacks are still outstanding. */
  get outstanding(): number {
    return this.#callbacks.length;
  }
}

/** Let every pending promise reaction run, without a timer. */
async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** One running invocation plus the knobs to drive it. */
interface Harness {
  readonly stdout: ControlledWritable;
  readonly stderr: ControlledWritable;
  readonly done: Promise<number>;
}

/** Start `writeOutput` with the §7.3 default input, overridable per case. */
function start(
  overrides: {
    readonly stdoutChunks?: () => Iterable<string>;
    readonly stderrLines?: () => Iterable<string>;
    readonly readCode?: 0 | 1;
    readonly stdout?: ControlledWritable;
    readonly stderr?: ControlledWritable;
  } = {},
): Harness {
  const stdout = overrides.stdout ?? new ControlledWritable();
  const stderr = overrides.stderr ?? new ControlledWritable();
  const done = writeOutput({
    stdoutChunks: overrides.stdoutChunks ?? (() => ['A', 'B']),
    stderrLines: overrides.stderrLines ?? (() => [D]),
    stdout,
    stderr,
    readCode: overrides.readCode ?? 0,
  });
  return { stdout, stderr, done };
}

/** Record whether a promise already resolved, without waiting for it. */
function tracking(promise: Promise<number>): {
  readonly done: Promise<number>;
  resolved(): boolean;
} {
  let resolved = false;
  const done = promise.then((code) => {
    resolved = true;
    return code;
  });
  return { done, resolved: () => resolved };
}

/** A generator that yields the given chunks and then throws, for R-15. */
function* throwingChunks(message: string): Generator<string, void, undefined> {
  yield 'A';
  throw new Error(message);
}

/** A generator that yields `D` and then throws, for R-17 and R-22. */
function* throwingLines(): Generator<string, void, undefined> {
  yield D;
  throw new Error('/secret/path: file text');
}

/** `n` diagnostic lines, for R-19. */
function manyLines(count: number): string[] {
  return Array.from({ length: count }, () => D);
}

describe('OutputStream — structural assignments (§7.2)', () => {
  it('accepts process.stdout, a Writable subclass and the fake, and rejects a missing errored', () => {
    // The three assignments of §7.2 are compile-time checks; `pnpm typecheck` is what runs them.
    const fromProcess: OutputStream = process.stdout;
    const fromStderr: OutputStream = process.stderr;
    const fromWritable: OutputStream = new Writable({ write: (): void => {} });
    const fromFake: OutputStream = new ControlledWritable();
    void fromProcess;
    void fromStderr;
    void fromWritable;
    void fromFake;

    const withoutErrored = {
      write: (): boolean => true,
      once: (): unknown => undefined,
      on: (): unknown => undefined,
      off: (): unknown => undefined,
      destroyed: false,
    };
    // @ts-expect-error an object without `errored` is not an OutputStream
    const rejected: OutputStream = withoutErrored;
    void rejected;
  });
});

describe('writer — the accepted path (§7.3 R-18)', () => {
  it('accepts once the iterator is done and every callback has been called', async () => {
    const harness = start();

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(0);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });

  it('keeps a failed read’s code when stdout is accepted', async () => {
    const harness = start({ readCode: 1 });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(1);
  });
});

describe('writer — stdout write errors (§7.3 R-3, R-9)', () => {
  for (const [code, expected] of [
    ['EIO', 'EIO'],
    ['ENOSPC', 'ENOSPC'],
    ['EBADF', 'EBADF'],
  ] as const) {
    it(`reports ${code} as 74 with the code and nothing else`, async () => {
      const harness = start();

      harness.stdout.complete(0, codedError(code));
      harness.stdout.complete(1);

      await expect(harness.done).resolves.toBe(74);
      expect(harness.stdout.chunks).toEqual(['A', 'B']);
      expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE(expected)}`);
    });
  }

  it('reports an error with no code as UNKNOWN', async () => {
    const harness = start();

    harness.stdout.complete(0, new Error('no code here'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('UNKNOWN')}`);
    // Neither the message nor a stack trace ever reaches stderr.
    expect(harness.stderr.chunks.join('')).not.toContain('no code here');
  });

  it('treats a synchronous throw from write() as a write failure and stops writing (R-9)', async () => {
    const stdout = new ControlledWritable();
    stdout.behave({ throws: codedError('ERR_STREAM_DESTROYED') });
    const harness = start({ stdout });

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('ERR_STREAM_DESTROYED')}`);
  });
});

describe('writer — closed readers (§7.3 R-3e)', () => {
  it('treats an EPIPE callback as a closed reader and keeps the read code', async () => {
    const harness = start();

    harness.stdout.complete(0, codedError('EPIPE'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(0);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });

  it('treats an EPIPE error event after backpressure as a closed reader', async () => {
    const stdout = new ControlledWritable();
    stdout.behave({ returns: false });
    const harness = start({ stdout });

    await flush();
    expect(harness.stdout.chunks).toEqual(['A']);

    stdout.errored = codedError('EPIPE');
    stdout.emit('error', codedError('EPIPE'));
    stdout.emit('close');

    await expect(harness.done).resolves.toBe(0);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });

  it('classifies a close whose errored is EPIPE as a closed reader', async () => {
    const stdout = new ControlledWritable();
    stdout.behave({ returns: false });
    const harness = start({ stdout });

    await flush();
    stdout.errored = codedError('EPIPE');
    stdout.emit('close');

    await expect(harness.done).resolves.toBe(0);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });
});

describe('writer — delayed, duplicated and late notifications (§7.3 R-5, R-6, R-8, R-14)', () => {
  it('records a callback error that arrives after the iterator is done (R-5)', async () => {
    const harness = start();

    harness.stdout.complete(0);
    await flush();
    harness.stdout.complete(1, codedError('EIO'));

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('EIO')}`);
  });

  it('writes the diagnostic line first and exactly one outcome line (R-6)', async () => {
    const harness = start();

    harness.stdout.complete(0);
    harness.stdout.complete(1, codedError('EIO'));

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('EIO')}`);
    // Two stderr writes: the buffered diagnostic line, then the outcome line.
    expect(harness.stderr.chunks).toHaveLength(2);
  });

  it('lets the first notification of a duplicated failure win (R-8, order 1)', async () => {
    const harness = start();

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.emit('error', codedError('EIO'));
    harness.stdout.emit('error', codedError('ENOSPC'));
    harness.stdout.emit('close');
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    const stderr = harness.stderr.chunks.join('');
    expect(stderr).toBe(`${D}${CANNOT_WRITE('EIO')}`);
    expect(stderr.match(/cannot write to stdout/g)).toHaveLength(1);
  });

  it('lets an error event before the callback win (R-8, order 2)', async () => {
    const harness = start();

    harness.stdout.emit('error', codedError('EIO'));
    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    const stderr = harness.stderr.chunks.join('');
    expect(stderr).toBe(`${D}${CANNOT_WRITE('EIO')}`);
    expect(stderr.match(/cannot write to stdout/g)).toHaveLength(1);
  });

  it('ignores events after the accepted state and never leaves an unhandled error (R-14)', async () => {
    const harness = start();

    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await expect(harness.done).resolves.toBe(0);

    // The listeners stay attached, so these are handled and ignored.
    expect(() => {
      harness.stdout.emit('error', codedError('EIO'));
      harness.stdout.emit('close');
    }).not.toThrow();
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });
});

describe('writer — backpressure (§7.3 R-10, R-12, R-13)', () => {
  it('waits for drain before writing the next chunk (R-10)', async () => {
    const stdout = new ControlledWritable();
    stdout.behave({ returns: false });
    const harness = start({ stdout });

    await flush();
    expect(harness.stdout.chunks).toEqual(['A']);

    stdout.complete(0);
    await flush();
    expect(harness.stdout.chunks).toEqual(['A']);

    stdout.emit('drain');
    await flush();
    expect(harness.stdout.chunks).toEqual(['A', 'B']);

    stdout.complete(1);
    await expect(harness.done).resolves.toBe(0);
    expect(harness.stderr.chunks.join('')).toBe(D);
  });

  it('releases a drain wait on an early close and reports 74 (R-12)', async () => {
    const stdout = new ControlledWritable();
    stdout.behave({ returns: false });
    const harness = start({ stdout });
    const track = tracking(harness.done);

    await flush();
    stdout.complete(0);
    stdout.emit('close');

    await flush();
    expect(track.resolved()).toBe(true);
    await expect(track.done).resolves.toBe(74);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${EARLY_CLOSE}`);
  });

  it('reports an early close while a callback is outstanding and ignores it late (R-13)', async () => {
    const harness = start();

    harness.stdout.complete(0);
    await flush();
    harness.stdout.emit('close');
    await flush();
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${EARLY_CLOSE}`);
  });
});

describe('writer — generation failures (§7.3 R-15, R-16, R-17)', () => {
  it('reports a throw from next() as 70 and never prints the message (R-15)', async () => {
    const harness = start({ stdoutChunks: () => throwingChunks('/secret/path: file text') });

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${GENERATION_FAILED}`);
    expect(harness.stderr.chunks.join('')).not.toContain('/secret/path');
    expect(harness.stderr.chunks.join('')).not.toContain('file text');
  });

  it('reports a throw from the iterator factory as 70 with no write (R-16)', async () => {
    const harness = start({
      stdoutChunks: () => {
        throw new Error('cannot even start');
      },
    });

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stdout.chunks).toEqual([]);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${GENERATION_FAILED}`);
  });

  it('reports a throwing stderr source as 70 while stdout stays accepted (R-17)', async () => {
    const harness = start({ stderrLines: () => throwingLines() });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${DIAGNOSTICS_FAILED}`);
  });

  it('reports a throw from the stderr factory as 70', async () => {
    const harness = start({
      stderrLines: () => {
        throw new Error('no lines');
      },
    });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stderr.chunks.join('')).toBe(DIAGNOSTICS_FAILED);
  });
});

describe('writer — stderr failures never change the exit code (§7.3 R-3s, R-7)', () => {
  for (const code of ['EPIPE', 'EIO'] as const) {
    it(`stops stderr on an ${code} error and keeps the read code (R-3s)`, async () => {
      const stderr = new ControlledWritable();
      stderr.behave({ returns: true, emitsError: codedError(code) });
      const harness = start({ stderr, readCode: 1 });

      harness.stdout.complete(0);
      harness.stdout.complete(1);

      await expect(harness.done).resolves.toBe(1);
      expect(harness.stdout.chunks).toEqual(['A', 'B']);
      expect(harness.stderr.chunks).toHaveLength(1);
    });
  }

  it('lets a stdout failure win while stderr is dying (R-7)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: true, emitsError: codedError('EIO') });
    const harness = start({ stderr });

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks).toHaveLength(1);
  });
});

describe('writer — stderr backpressure and stops (§7.3 R-19, R-21, R-7b, R-22, R-23, R-20b)', () => {
  it('holds stderr on backpressure until drain and stops on close (R-19)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: false }, { returns: false });
    const harness = start({ stderr, stderrLines: () => manyLines(100_000) });
    const track = tracking(harness.done);

    // stdout settles first (R-18), and only then does stderr start.
    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await flush();

    // The first stderr chunk is written, then the writer waits.
    expect(harness.stderr.chunks).toHaveLength(1);

    // A *successful* callback does not release the wait.
    stderr.complete(0);
    await flush();
    expect(harness.stderr.chunks).toHaveLength(1);

    // `drain` does: the second write happens, and its `false` is answered by a close.
    stderr.emit('drain');
    await flush();
    expect(harness.stderr.chunks).toHaveLength(2);
    stderr.emit('close');
    await flush();

    expect(track.resolved()).toBe(true);
    await expect(track.done).resolves.toBe(0);

    // No write after the close, and every chunk stays under the bound.
    expect(harness.stderr.chunks).toHaveLength(2);
    for (const chunk of harness.stderr.chunks) expect(chunk.length).toBeLessThan(262_144);
    expect(harness.stderr.chunks[0]?.length).toBeGreaterThan(65_535);
    expect(harness.stderr.chunks.join('')).not.toContain('cannot write to stdout');
  });

  it('releases a stderr drain wait on a failing callback alone (R-21, Case A)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: false });
    const harness = start({ stderr });
    const track = tracking(harness.done);

    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await flush();
    expect(harness.stderr.chunks).toHaveLength(1);

    // The callback alone: no `'drain'`, no `'error'`, no `'close'`.
    stderr.complete(0, codedError('ERR_STREAM_DESTROYED'));

    await flush();
    expect(track.resolved()).toBe(true);
    await expect(track.done).resolves.toBe(0);
    expect(harness.stderr.chunks).toHaveLength(1);
  });

  it('keeps the read code of a failed read when stderr dies (R-21, readCode 1)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: false });
    const harness = start({ stderr, readCode: 1 });

    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await flush();
    stderr.complete(0, codedError('ERR_STREAM_DESTROYED'));

    await expect(harness.done).resolves.toBe(1);
    expect(harness.stderr.chunks).toHaveLength(1);
  });

  it('ignores late stderr events after the writer resolved (R-21 variant b)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: false });
    const harness = start({ stderr });

    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await flush();
    stderr.complete(0, codedError('ERR_STREAM_DESTROYED'));
    await expect(harness.done).resolves.toBe(0);

    expect(() => {
      stderr.emit('error', codedError('EPIPE'));
      stderr.emit('close');
    }).not.toThrow();
    expect(harness.stderr.chunks).toHaveLength(1);
  });

  it('lets a stdout failure keep precedence when stderr also fails (R-7b, Case C)', async () => {
    const stderr = new ControlledWritable();
    stderr.behave({ returns: false });
    const harness = start({ stderr });
    const track = tracking(harness.done);

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);
    await flush();
    expect(harness.stderr.chunks).toHaveLength(1);

    stderr.complete(0, codedError('ERR_STREAM_DESTROYED'));
    await flush();

    expect(track.resolved()).toBe(true);
    await expect(track.done).resolves.toBe(74);
    expect(harness.stderr.chunks).toHaveLength(1);
  });

  it('reports 74, not 70, when stdout fails and the stderr source throws (R-22, Case D)', async () => {
    const harness = start({ stderrLines: () => throwingLines() });

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('EIO')}${DIAGNOSTICS_FAILED}`);
  });

  it('writes nothing to stderr that is already destroyed (R-23)', async () => {
    const stderr = new ControlledWritable();
    stderr.destroyed = true;
    const harness = start({ stderr, readCode: 1 });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(1);
    expect(harness.stderr.chunks).toEqual([]);
  });

  it('writes nothing to stderr that already holds an EPIPE (R-23 variant b)', async () => {
    const stderr = new ControlledWritable();
    stderr.errored = codedError('EPIPE');
    const harness = start({ stderr, readCode: 1 });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(1);
    expect(harness.stderr.chunks).toEqual([]);
  });
});

describe('writer — the order of the stderr write (§3.6, §7.2 item 7)', () => {
  it('writes the diagnostic lines, then the outcome line, then the diagnostics-failure line', async () => {
    const harness = start({
      stderrLines: () => throwingLines(),
      readCode: 1,
    });

    harness.stdout.complete(0, codedError('ENOSPC'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    const stderr = harness.stderr.chunks.join('');
    const diagnosticAt = stderr.indexOf(D);
    const outcomeAt = stderr.indexOf(CANNOT_WRITE('ENOSPC'));
    const failureAt = stderr.indexOf(DIAGNOSTICS_FAILED);

    expect(diagnosticAt).toBe(0);
    expect(outcomeAt).toBeGreaterThan(diagnosticAt);
    expect(failureAt).toBeGreaterThan(outcomeAt);
  });

  it('never writes an outcome line for an accepted or closed run', async () => {
    const accepted = start();
    accepted.stdout.complete(0);
    accepted.stdout.complete(1);
    await expect(accepted.done).resolves.toBe(0);
    expect(accepted.stderr.chunks.join('')).toBe(D);

    const closed = start();
    closed.stdout.complete(0, codedError('EPIPE'));
    closed.stdout.complete(1);
    await expect(closed.done).resolves.toBe(0);
    expect(closed.stderr.chunks.join('')).toBe(D);
  });
});

describe('writer — the three stderr-source throw points (§7.2 item 7, MAJOR-1 1-A)', () => {
  /** An iterable whose `[Symbol.iterator]()` throws, for throw point 2. */
  function uniterable(message: string): Iterable<string> {
    return {
      [Symbol.iterator](): Iterator<string> {
        throw new Error(message);
      },
    };
  }

  it('reports a throw from the lines factory as 70 and leaks nothing', async () => {
    const harness = start({
      stderrLines: () => {
        throw new Error('factory: /secret/path');
      },
    });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(DIAGNOSTICS_FAILED);
    expect(harness.stderr.chunks.join('')).not.toContain('/secret/path');
    expect(harness.stderr.chunks.join('')).not.toContain('factory');
  });

  it('reports a throw from [Symbol.iterator]() as 70 without rejecting', async () => {
    const harness = start({ stderrLines: () => uniterable('iterator: /secret/path') });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    // The promise resolves: the acquisition is guarded, so the throw never escapes as a rejection.
    await expect(harness.done).resolves.toBe(70);
    expect(harness.stdout.chunks).toEqual(['A', 'B']);
    expect(harness.stderr.chunks.join('')).toBe(DIAGNOSTICS_FAILED);
    expect(harness.stderr.chunks.join('')).not.toContain('/secret/path');
  });

  it('reports a throw from next() as 70, after the lines already yielded', async () => {
    const harness = start({ stderrLines: () => throwingLines() });

    harness.stdout.complete(0);
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(70);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${DIAGNOSTICS_FAILED}`);
  });

  it('keeps 74 over 70 when stdout failed and the stderr iterator cannot be acquired', async () => {
    const harness = start({ stderrLines: () => uniterable('iterator: /secret/path') });

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${CANNOT_WRITE('EIO')}${DIAGNOSTICS_FAILED}`);
    expect(harness.stderr.chunks.join('')).not.toContain('/secret/path');
  });
});

describe('writer — the first terminal event wins (§7.2 item 6, MAJOR-1 1-B)', () => {
  it('ignores a synchronous write() throw once an earlier error event settled the state', async () => {
    // The error event arrives inside `write()`, settles `write-failed` with EIO, and only then does
    // `write()` throw ENOSPC. The throw must not overwrite the code or the line.
    const stdout = new ControlledWritable();
    stdout.behave({ emitsError: codedError('EIO'), throws: codedError('ENOSPC') });
    const harness = start({ stdout });

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stdout.chunks).toEqual(['A']);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('EIO')}`);
    expect(harness.stderr.chunks.join('')).not.toContain('ENOSPC');
    expect(harness.stderr.chunks.join('').match(/cannot write to stdout/g)).toHaveLength(1);
  });

  it('ignores a different error event after a callback error settled the state', async () => {
    const harness = start();

    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.emit('error', codedError('ENOSPC'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${CANNOT_WRITE('EIO')}`);
    expect(harness.stderr.chunks.join('').match(/cannot write to stdout/g)).toHaveLength(1);
  });

  it('keeps the read code after an EPIPE settled the state, whatever arrives later', async () => {
    const harness = start({ readCode: 1 });

    harness.stdout.complete(0, codedError('EPIPE'));
    harness.stdout.emit('error', codedError('EIO'));
    harness.stdout.emit('close');
    harness.stdout.complete(1);

    // `closed` keeps the read's code and prints no outcome line; the late EIO changes nothing.
    await expect(harness.done).resolves.toBe(1);
    expect(harness.stderr.chunks.join('')).toBe(D);
    expect(harness.stderr.chunks.join('')).not.toContain('cannot write to stdout');
  });

  it('keeps the early-close line when a callback error arrives afterwards', async () => {
    const harness = start();

    harness.stdout.emit('close');
    await flush();
    harness.stdout.complete(0, codedError('EIO'));
    harness.stdout.complete(1);

    await expect(harness.done).resolves.toBe(74);
    expect(harness.stderr.chunks.join('')).toBe(`${D}${EARLY_CLOSE}`);
    expect(harness.stderr.chunks.join('')).not.toContain('cannot write to stdout');
  });

  it('ignores an error event after the accepted state', async () => {
    const harness = start();

    harness.stdout.complete(0);
    harness.stdout.complete(1);
    await expect(harness.done).resolves.toBe(0);

    harness.stdout.emit('error', codedError('EIO'));

    expect(harness.stderr.chunks.join('')).toBe(D);
  });
});

/* ── §7.7 B-3 and N-2: the real stderr source over §7.7's heavy documents ──────────────────── */

/**
 * The third path B-3 names, over the same six inputs the other two files use.
 *
 * `tests/json-stream.test.ts` pins `encodeJson` over §7.7's documents and `tests/text-render.test.ts`
 * pins `renderTablesText` over the same six; this block pins what `tablesDiagnosticLines()` hands to
 * *this* writer. Each case builds one `Integration` from the real four stages, so the lines are the
 * product's and not a stub, and asserts on every chunk the writer wrote: under 262,144 code units,
 * no boundary inside a surrogate pair, and a concatenation that byte-equals the source. Five of the
 * six documents raise no `fatal`/`error` diagnostic at all, so their stderr must be empty — asserted,
 * never assumed.
 *
 * Determinism: every `write()` returns `true`, so the writer never waits for `'drain'`; one
 * `complete()` on stdout settles it and the rest is a microtask chain. No timer, no event is
 * invented, and nothing depends on how the event loop happens to be scheduled.
 */
describe('writer — §7.7 B-3: the six heavy stderr sources', () => {
  /** §7.7's chunk bound, written out rather than taken from the modules under test. */
  const SPEC_CHUNK_LIMIT = 262_144;

  /** §7.7's preamble: the format line and the one `[Manager]` section. */
  function preamble(): string[] {
    return ['# A5:ER FORMAT:21', '', '[Manager]', 'PageInfo="Main",3,"A4Landscape","$FFFFFF"', ''];
  }

  /** One `[Entity]` section. */
  function entity(pname: string, position: string): string[] {
    return ['[Entity]', `PName="${pname}"`, 'UsingCommonColumns=0', position, ''];
  }

  /** B-1: one 200,001-character `PName` and 3,999 short ones. */
  function longNameDocument(): string {
    const lines = preamble();
    lines.push(...entity('p'.repeat(200_001), 'Position="Main",10,10'));
    for (let index = 0; index < 3_999; index += 1) {
      lines.push(...entity(`t${String(index)}`, 'Position="Main",20,20'));
    }
    return lines.join('\n');
  }

  /** B-2: 400,000 escape characters in one `PName` and 3,999 short ones. */
  function escapeDocument(): string {
    const lines = preamble();
    lines.push(...entity('\u001b'.repeat(400_000), 'Position="Main",10,10'));
    for (let index = 0; index < 3_999; index += 1) {
      lines.push(...entity(`t${String(index)}`, 'Position="Main",20,20'));
    }
    return lines.join('\n');
  }

  /** N-1 and its 200,000-key sibling: one entity carrying `count` unknown keys. */
  function unknownKeysDocument(count: number): string {
    const lines = preamble();
    lines.push('[Entity]', 'PName="wide"', 'UsingCommonColumns=0', 'Position="Main",10,10');
    for (let index = 0; index < count; index += 1) lines.push(`Unknown${String(index)}=1`);
    return lines.join('\n');
  }

  /** N-2: 30,000 entities with no `PName`, each one a `V_MISSING_REQUIRED_KEY` error. */
  function missingNameDocument(): string {
    const lines = preamble();
    for (let index = 0; index < 30_000; index += 1) {
      lines.push(
        '[Entity]',
        'LName="名前なし"',
        'UsingCommonColumns=0',
        'Position="Main",10,10',
        '',
      );
    }
    return lines.join('\n');
  }

  /** N-3: 30,000 views, one section each. */
  function viewsDocument(): string {
    const lines = preamble();
    for (let index = 0; index < 30_000; index += 1) {
      lines.push('[View]', `PName="v${String(index)}"`, 'Position="Main",10,10', '');
    }
    return lines.join('\n');
  }

  /** The `Integration` of one generated `.a5er` text: the four real stages, then `integrate()`. */
  function integrationOf(text: string): Integration {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-writer-heavy-'));
    try {
      const path = join(directory, 'heavy.a5er');
      writeFileSync(path, text, 'utf8');
      const load = loadSource(path);
      if (!load.ok) throw new Error('the generated document did not load');
      const scan = scanSource(load.source);
      const classification = classify(scan);
      return integrate({
        load,
        scan,
        classification,
        semantics: derivePartialSemantics(classification),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /**
   * Run the writer with the real diagnostic lines.
   *
   * `stdout` is one fixed chunk — B-3 is about the diagnostics here — and it is completed once, which
   * is all a `true`-returning write needs. The promise must then settle on the read's own code.
   */
  async function runHeavy(integration: Integration): Promise<Harness> {
    const harness = start({
      stdoutChunks: () => ['A'],
      stderrLines: () => tablesDiagnosticLines(integration),
      readCode: integration.exitPolicy.inspect,
    });
    harness.stdout.complete(0);
    await expect(harness.done).resolves.toBe(integration.exitPolicy.inspect);
    return harness;
  }

  /** Every chunk under the bound, and no chunk boundary inside a surrogate pair (§7.7 B-3). */
  function expectStderrChunksBounded(chunks: readonly string[]): void {
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length, `chunk ${String(index)}`).toBeLessThan(SPEC_CHUNK_LIMIT);

      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff, `chunk ${String(index)} start`).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff, `chunk ${String(index)} end`).toBe(false);
    }
  }

  const cases: readonly (readonly [string, () => string])[] = [
    ['B-1', longNameDocument],
    ['B-2', escapeDocument],
    ['N-1', () => unknownKeysDocument(30_000)],
    ['N-2', missingNameDocument],
    ['N-3', viewsDocument],
    ['200,000 unknown keys', () => unknownKeysDocument(200_000)],
  ];

  for (const [label, build] of cases) {
    it(`writes ${label}'s stderr whole and inside the bound`, async () => {
      const integration = integrationOf(build());
      const expected = [...tablesDiagnosticLines(integration)];
      const harness = await runHeavy(integration);

      // stdout settled normally, in one chunk, on the read's own code.
      expect(harness.stdout.chunks).toEqual(['A']);
      // Two independent runs of the generator agree: the source is a pure function of the input.
      expect([...tablesDiagnosticLines(integration)]).toEqual(expected);
      // The writer wrote the source and nothing else: no line lost, none doubled, no reordering.
      expect(harness.stderr.chunks.join('')).toBe(expected.join(''));
      expectStderrChunksBounded(harness.stderr.chunks);

      if (expected.length === 0) {
        // Nothing may be invented for a document whose worst diagnostic is a `warning` or an `info`.
        expect(integration.diagnostics.every((one) => one.severity !== 'fatal')).toBe(true);
        expect(integration.diagnostics.every((one) => one.severity !== 'error')).toBe(true);
        expect(harness.stderr.chunks).toHaveLength(0);
      } else {
        // 30,000 lines of §7.7's size cannot fit one chunk: the bound is exercised, not dodged.
        expect(harness.stderr.chunks.length).toBeGreaterThan(1);
      }
    }, 120_000);
  }

  it('N-2: 30,000 missing `PName`s keep their order, their count and their LF (§7.7 N-2)', async () => {
    const integration = integrationOf(missingNameDocument());

    // Entity k sits on line 6 + 5k of this document, and §3.6 prints `a5er: <severity>: <code>:
    // <message> (line <n>)`, so all 30,000 lines are derived from the input's own layout.
    const text = 'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent';
    const expected = Array.from(
      { length: 30_000 },
      (_, index) => `${text} (line ${String(6 + 5 * index)})\n`,
    );

    // The input must really raise 30,000 `error`s before the writer is asked anything.
    const errors = integration.diagnostics.filter((one) => one.severity === 'error');
    expect(errors).toHaveLength(30_000);
    expect(errors.every((one) => one.code === 'V_MISSING_REQUIRED_KEY')).toBe(true);
    expect([...tablesDiagnosticLines(integration)]).toEqual(expected);

    const harness = await runHeavy(integration);
    const written = harness.stderr.chunks.join('');

    // stdout settles normally, in the one chunk it was given.
    expect(harness.stdout.chunks).toEqual(['A']);

    // Multi-chunk: 30,000 lines cannot fit one chunk, so the bound is exercised, not dodged.
    expect(harness.stderr.chunks.length).toBeGreaterThan(1);
    expectStderrChunksBounded(harness.stderr.chunks);

    // Byte equality pins the order, the absence of duplicates and the trailing LF at once.
    expect(written).toBe(expected.join(''));
    expect(written.split('\n')).toHaveLength(30_001);
  }, 120_000);
});
