/**
 * `io/stdout.ts` — the output writer for `a5er tables` (`docs/proposals/human-cli.md` §7.2).
 *
 * **The shape.** stdout is pulled lazily and written chunk by chunk; the writer then settles and
 * only afterwards speaks on stderr. It resolves with the command's exit code and never calls
 * `process.exit()`: on POSIX a pipe write is asynchronous, so exiting early could cut off output
 * that is still queued.
 *
 * **One terminal state, once.** Writing starts in `writing` and leaves it exactly once — accepted,
 * closed, write-failed, early-close or generation-failed. The first event that decides a terminal
 * state wins; every later callback, `'error'`, `'close'` or `'drain'` is ignored. That is what keeps
 * duplicate and delayed notifications (the same failure usually arrives two or three times) from
 * changing the outcome, the stderr text or the exit code.
 *
 * **Backpressure is released by terminal transitions too.** When `write()` returns `false` the
 * writer waits for `'drain'` *or* any terminal state, so a `'close'`, an `'error'` or an error
 * callback releases a pending wait at once. A hang is never resolved by a timer.
 *
 * **stderr never blocks the exit.** Its failures are recorded in one idempotent `stopped` flag —
 * set by an `'error'`, a `'close'`, an error callback or a synchronous throw — and everything after
 * that is dropped silently: there is nowhere left to report a failure. Crucially, an error
 * *callback* alone sets the flag and releases a pending `'drain'` wait even when no event follows;
 * a *successful* callback does not release it. That asymmetry is the bug this unit exists to keep
 * out (§7.2 item 8, R-19, R-21).
 *
 * **Exit codes.** A stdout write failure or an early close gives `74`; an output-generation failure
 * or a throwing stderr source gives `70`; accepted and closed keep the read's code (`0` or `1`).
 * `74` outranks `70`, so a broken pipe is never reported as an internal error. "Accepted" means
 * accepted by Node, not delivered: after `closed`, `failed` or `generation-failed`, stdout may hold
 * any prefix and must be discarded.
 *
 * **No `node:` import.** The streams are a structural type, so `process.stdout`, a plain
 * `Writable` and a test fake all satisfy it without a cast, and the state machine is exercised with
 * deterministic fakes (§7.3). The stderr chunk buffer duplicates the bound of `src/text/chunks.ts`
 * rather than importing it: §6 keeps `io/` free of `text/`.
 */

/** Every stream member `writeOutput` uses, and nothing else (§7.2). */
export interface OutputStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  /** `Writable.errored`: the error a destroyed stream was destroyed with, or `null`. */
  readonly errored: Error | null;
  /** `Writable.destroyed`: the "already closed" state. */
  readonly destroyed: boolean;
}

/** What one `writeOutput` call needs (§7.2). */
export interface WriteOutputOptions {
  /** Lazy: Phase B of §2 runs inside `next()`, so nothing is generated before it is written. */
  readonly stdoutChunks: () => Iterable<string>;
  /** Lazy: `tablesDiagnosticLines(integration)`, pulled one line per `next()`. */
  readonly stderrLines: () => Iterable<string>;
  /** `process.stdout` in the CLI, a deterministic fake in tests. */
  readonly stdout: OutputStream;
  /** `process.stderr` in the CLI, a deterministic fake in tests. */
  readonly stderr: OutputStream;
  /** `integrate(input).exitPolicy.inspect`: the code a successful write keeps. */
  readonly readCode: 0 | 1;
}

/** The code `writeOutput` resolves with (§3.7). */
export type WriteOutcome = 0 | 1 | 70 | 74;

/** The stdout outcome: `writing` until exactly one terminal state is reached (§7.2). */
type StdoutState =
  | 'writing'
  | 'accepted'
  | 'closed'
  | 'write-failed'
  | 'early-close'
  | 'generation-failed';

/** stderr chunks flush at this many code units, like the renderers (§7.2 item 8). */
const STDERR_FLUSH_UNITS = 65_536;

/** No stderr chunk reaches this many code units; the same bound as every other one (§7.7 B-3). */
const STDERR_LIMIT_UNITS = 262_144;

/**
 * The four outcome lines of §7.2's table.
 *
 * Exported so the Phase A guard of `src/tables-command.ts` writes the same bytes; none of them
 * carries an exception message, a stack trace, file text or a path.
 */
export const CANNOT_WRITE_PREFIX = 'a5er: error: cannot write to stdout (';
export const EARLY_CLOSE_LINE = 'a5er: error: stdout closed before the output was complete\n';
export const OUTPUT_GENERATION_FAILED_LINE =
  'a5er: error: internal error while generating output; the output is incomplete\n';
export const DIAGNOSTICS_GENERATION_FAILED_LINE =
  'a5er: error: internal error while generating diagnostics; the diagnostics are incomplete\n';

/** True for a UTF-16 high surrogate. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** True for a UTF-16 low surrogate. */
function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** True when `error` is a broken pipe — the only "the reader went away" signal (§7.2). */
function isBrokenPipe(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EPIPE'
  );
}

/**
 * The `<CODE>` of an outcome line: `error.code` when it is `[A-Z0-9_]+`, `UNKNOWN` otherwise.
 *
 * A code, never the message: the message can hold file text or a path.
 */
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  }
  return 'UNKNOWN';
}

/**
 * Buffer stderr lines into chunks of at least `STDERR_FLUSH_UNITS` and always under the limit.
 *
 * The source is pulled one line at a time, and a throw from it ends the stream *after* the lines
 * already buffered are yielded, which is what makes R-17's order (`D`, then the failure line) hold.
 * A cut never separates a surrogate pair.
 */
function* bufferedLines(
  lines: Iterable<string>,
  onThrow: () => void,
): Generator<string, void, undefined> {
  const iterator = lines[Symbol.iterator]();
  let buffer = '';

  for (;;) {
    let step: IteratorResult<string>;
    try {
      step = iterator.next();
    } catch {
      onThrow();
      break;
    }
    if (step.done === true) break;

    buffer += step.value;
    while (buffer.length > STDERR_LIMIT_UNITS - 1) {
      let cut = STDERR_LIMIT_UNITS - 1;
      if (isHighSurrogate(buffer.charCodeAt(cut - 1)) && isLowSurrogate(buffer.charCodeAt(cut))) {
        cut -= 1;
      }
      yield buffer.slice(0, cut);
      buffer = buffer.slice(cut);
    }
    if (buffer.length >= STDERR_FLUSH_UNITS) {
      yield buffer;
      buffer = '';
    }
  }

  if (buffer !== '') yield buffer;
}

/**
 * Write a `tables` invocation's stdout, settle it, then speak on stderr, and resolve with the exit
 * code (§7.2, §3.7).
 *
 * Phase A (load, scan, classify, semantics, `integrate()`) belongs to the caller: its guard is
 * `runTablesCommand`'s, and a throw there never reaches this function.
 */
export async function writeOutput(options: WriteOutputOptions): Promise<WriteOutcome> {
  const { stdoutChunks, stderrLines, stdout, stderr, readCode } = options;

  // ── stdout state (§7.2 items 1–6) ──────────────────────────────────────────────────────────
  let state: StdoutState = 'writing';
  /** The error that decided `write-failed`; never printed, only its code. */
  let writeFailure: Error | null = null;
  /** True once the chunk iterator reported `done`. */
  let exhausted = false;
  /** Write callbacks that have not been called yet. */
  let outstanding = 0;
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  /**
   * Read the state through a function.
   *
   * Every transition happens inside a callback, an event handler or a `catch`, so the compiler's
   * control-flow analysis would otherwise still believe `state` is `'writing'` after the loop.
   */
  const currentState = (): StdoutState => state;

  /** Move to the one terminal state, unless one was already reached. */
  const transition = (next: StdoutState): void => {
    if (state !== 'writing') return;
    state = next;
    resolveSettled();
  };

  /** Accepted needs both conditions: the iterator done *and* every callback called. */
  const acceptIfSettled = (): void => {
    if (exhausted && outstanding === 0) transition('accepted');
  };

  /** A callback, `'error'` or synchronous throw: `EPIPE` is a closed reader, anything else fails. */
  const classify = (error: unknown): void => {
    if (isBrokenPipe(error)) {
      transition('closed');
      return;
    }
    writeFailure = error instanceof Error ? error : new Error('unknown write failure');
    transition('write-failed');
  };

  /** A `'close'`: classified by `stdout.errored`, else it closed before the output was complete. */
  const classifyClose = (): void => {
    const errored = stdout.errored;
    if (errored === null) {
      transition('early-close');
      return;
    }
    classify(errored);
  };

  // ── stderr state (§7.2 item 8) ─────────────────────────────────────────────────────────────
  let stderrStopped = false;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  /** One idempotent flag: an error, a close or a failing callback stops stderr for good. */
  const stopStderr = (): void => {
    if (stderrStopped) return;
    stderrStopped = true;
    resolveStopped();
  };

  // ── listeners, before the first write (§7.2 item 2) ────────────────────────────────────────
  // They stay attached until the process exits: a late or repeated event is never unhandled and
  // never prints a stack trace, and a terminal state already reached makes it a no-op.
  stdout.on('error', (error: Error): void => {
    if (state === 'writing') classify(error);
  });
  stdout.on('close', (): void => {
    if (state === 'writing') classifyClose();
  });
  stderr.on('error', (): void => {
    stopStderr();
  });
  stderr.on('close', (): void => {
    stopStderr();
  });

  /** Wait for `'drain'` or a terminal state, and always remove the `'drain'` listener. */
  const waitForDrain = (stream: OutputStream, released: Promise<void>): Promise<void> => {
    let remove = (): void => {};
    const drained = new Promise<void>((resolve) => {
      const onDrain = (): void => {
        stream.off('drain', onDrain);
        resolve();
      };
      remove = (): void => {
        stream.off('drain', onDrain);
      };
      stream.once('drain', onDrain);
    });
    return Promise.race([drained, released]).finally(remove);
  };

  /** Write one stdout chunk and count its callback (§7.2 item 3). */
  const writeChunk = (chunk: string): boolean => {
    let called = false;
    outstanding += 1;
    return stdout.write(chunk, (error?: Error | null): void => {
      // A stream that calls a callback twice must not corrupt the counter.
      if (called) return;
      called = true;
      outstanding -= 1;
      if (state !== 'writing') return;
      if (error !== null && error !== undefined) {
        classify(error);
        return;
      }
      acceptIfSettled();
    });
  };

  // ── pull, write, and honour backpressure (§7.2 items 3–4) ──────────────────────────────────
  let iterator: Iterator<string> | null = null;
  try {
    iterator = stdoutChunks()[Symbol.iterator]();
  } catch {
    transition('generation-failed');
  }

  while (state === 'writing' && iterator !== null) {
    let step: IteratorResult<string>;
    try {
      step = iterator.next();
    } catch {
      // The message is discarded: it can hold file text or a path (§7.2 item 7).
      transition('generation-failed');
      break;
    }

    if (step.done === true) {
      exhausted = true;
      break;
    }

    if (stdout.destroyed) {
      classifyClose();
      break;
    }

    let wrote: boolean;
    try {
      wrote = writeChunk(step.value);
    } catch (error) {
      // `write()` threw synchronously, so this chunk's callback never arrives.
      outstanding -= 1;
      classify(error);
      break;
    }

    if (!wrote && state === 'writing') await waitForDrain(stdout, settled);
  }

  // ── settle (§7.2 item 5) ───────────────────────────────────────────────────────────────────
  acceptIfSettled();
  if (state === 'writing') await settled;

  // ── stderr, in the fixed order of §3.6 and §7.2 item 7 ─────────────────────────────────────
  let diagnosticsThrew = false;

  if (!stderrStopped) {
    /** Write one stderr chunk, honouring `destroyed`/`errored`/stopped and backpressure. */
    const writeStderr = async (chunk: string): Promise<void> => {
      if (stderrStopped) return;
      if (stderr.destroyed || stderr.errored !== null) {
        stopStderr();
        return;
      }
      let wrote: boolean;
      try {
        wrote = stderr.write(chunk, (error?: Error | null): void => {
          if (error !== null && error !== undefined) stopStderr();
        });
      } catch {
        stopStderr();
        return;
      }
      // A *successful* callback does not release this wait; only `'drain'` or `stopped` does.
      if (!wrote) await waitForDrain(stderr, stopped);
    };

    let lines: Iterable<string> | null = null;
    try {
      lines = stderrLines();
    } catch {
      diagnosticsThrew = true;
    }

    if (lines !== null) {
      for (const chunk of bufferedLines(lines, () => {
        diagnosticsThrew = true;
      })) {
        if (stderrStopped) break;
        await writeStderr(chunk);
      }
    }

    // The one outcome line, if the stdout outcome has one.
    if (!stderrStopped) {
      const outcome = currentState();
      if (outcome === 'write-failed') {
        await writeStderr(`${CANNOT_WRITE_PREFIX}${errorCode(writeFailure)})\n`);
      } else if (outcome === 'early-close') {
        await writeStderr(EARLY_CLOSE_LINE);
      } else if (outcome === 'generation-failed') {
        await writeStderr(OUTPUT_GENERATION_FAILED_LINE);
      }
    }

    if (diagnosticsThrew && !stderrStopped) {
      await writeStderr(DIAGNOSTICS_GENERATION_FAILED_LINE);
    }
  }

  // ── the exit code (§7.2 item 9): 74 outranks 70, which outranks the read's code ────────────
  const outcome = currentState();
  if (outcome === 'write-failed' || outcome === 'early-close') return 74;
  if (outcome === 'generation-failed' || diagnosticsThrew) return 70;
  return readCode;
}
