/**
 * Bounded, read-only input (`architecture.md` §10.1, §10.2).
 *
 * The sequence is fixed by the document: `open(path, 'r')` → fstat → bounded read up to
 * `maxBytes` → fstat again. Nothing is written, renamed or truncated.
 *
 * Failure discipline (R12), because a `SourceHandle` can fail at every step:
 *
 * - **File conditions are typed results.** An `open`, `stat`, `read` or `close` that the
 *   platform refuses becomes `ok: false` with an `E_IO` diagnostic; a caller never sees an
 *   exception and never sees a partial buffer (§10.2 "no partial-success mode").
 * - **Seam contract breaches throw.** `readExactly` still throws when the seam hands back more
 *   bytes than it was asked for: that is a defect in the seam, not a condition of the file, and
 *   turning it into `E_IO` would blame the input for a programming error. The handle is released
 *   before the throw escapes.
 * - **A failing `close` never masks the primary outcome.** The handle is released exactly once
 *   per opened handle on every path, the close is never retried, and a close failure is reported
 *   *next to* the primary result instead of replacing it.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { emit } from '../diagnostics/diagnostic.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { boundedDetail } from '../diagnostics/diagnostic.js';
import type { FileSystem, SourceHandle } from './fs.js';
import { nodeFileSystem } from './fs.js';
import type { Limits } from './limits.js';
import { withLimits } from './limits.js';

/** Bytes read per `read` call. Bounds the scratch space, not the file. */
export const READ_CHUNK_BYTES = 64 * 1024;

/** A successfully read input. Decoding happens in `decode/`. */
export interface ReadSource {
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  /** SHA-256 of the bytes, lowercase hex (`architecture.md` §10.1, A18). */
  readonly sha256: string;
}

export type ReadOutcome =
  | { readonly ok: true; readonly source: ReadSource }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface ReadOptions {
  /** Per-call limit overrides; never a global (`architecture.md` §10.2, TBD-O3). */
  readonly limits?: Partial<Limits>;
  /** The read boundary; defaults to the real filesystem. */
  readonly fileSystem?: FileSystem;
}

/** Which handle operation failed. `open` failures keep their pre-R12 detail shape. */
type SeamOperation = 'stat' | 'read' | 'close';

/** Result of one seam call: the value, or the error that escaped it. */
type SeamCall<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/** Bytes read from the handle, or why they are not there. */
type ReadBytes =
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: 'short' }
  | { readonly ok: false; readonly reason: 'io'; readonly error: unknown };

/**
 * Run one seam call and capture its failure instead of letting it escape.
 *
 * Narrow by construction: it wraps a single `stat`/`read`/`close`/`open` call and nothing else,
 * so no exception from this module's own logic can be mistaken for an I/O condition.
 */
function callSeam<T>(run: () => T): SeamCall<T> {
  try {
    return { ok: true, value: run() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

/** OS errno of a failing call, when the platform supplies one. */
function errnoOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * Typed `E_IO` for a failing handle operation.
 *
 * `op` is what separates a `stat`/`read` failure from a `close` one — both are `E_IO`, and
 * without it the diagnostic would not say which promise broke. The errno is a trusted OS token
 * and the path is bounded user input, so neither reaches `code` or `message` (§11 rule 1).
 */
function ioDiagnostic(path: string, op: SeamOperation, error: unknown): Diagnostic {
  return emit('E_IO', {
    details: { path: boundedDetail(path), errno: errnoOf(error), op },
    construct: 'Source',
  });
}

/** The same, as a whole outcome. */
function ioFailure(path: string, op: SeamOperation, error: unknown): ReadOutcome {
  return { ok: false, diagnostics: [ioDiagnostic(path, op, error)] };
}

/**
 * True when `path` currently names a directory.
 *
 * Only consulted after an open failed with an errno a directory can produce, so the normal
 * read path performs no extra stat and no path is followed twice by choice.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    // A stat that races with a deletion answers the only question asked: not a directory.
    return false;
  }
}

/**
 * Read `path` into memory, or explain why it was refused.
 *
 * Order matters and follows §10.1/§10.2: open, reject a non-regular file, reject an input past
 * `maxBytes` **before allocating anything**, read in bounded chunks, then re-stat to prove the
 * bytes describe a stable file. The handle is released exactly once after `inspect` returns,
 * whatever it returned, and once more never.
 */
export function readSource(path: string, options: ReadOptions = {}): ReadOutcome {
  const limits = withLimits(options.limits);
  const fileSystem = options.fileSystem ?? nodeFileSystem;

  let handle: SourceHandle;
  try {
    handle = fileSystem.open(path);
  } catch (error: unknown) {
    const errno = errnoOf(error);
    // Windows refuses to open a directory at all; POSIX opens it and the stat below reports
    // it. Both are the same documented finding (a directory is not an input file), so the
    // Windows refusal is mapped rather than reported as a generic I/O failure.
    if (errno === 'EISDIR' || errno === 'EPERM') {
      if (isDirectory(path)) {
        return {
          ok: false,
          diagnostics: [
            emit('E_NOT_A_FILE', {
              details: { path: boundedDetail(path) },
              construct: 'Source',
            }),
          ],
        };
      }
    }

    // `E_IO` covers every other refusal: missing path, permission, too many open files.
    // The errno is a trusted OS token; the path is bounded user input and never reaches
    // code or message.
    return {
      ok: false,
      diagnostics: [
        emit('E_IO', {
          details: { path: boundedDetail(path), errno },
          construct: 'Source',
        }),
      ],
    };
  }

  let primary: ReadOutcome;
  try {
    primary = inspect(handle, path, limits);
  } catch (error: unknown) {
    // Only `readExactly`'s invariant throws out of `inspect`, and only for a seam that returns
    // more bytes than it was asked for. That is a programming error, not a file condition, so it
    // keeps travelling as an exception — after the handle is released. If the release fails too,
    // both failures are reported: losing either would hide a real defect.
    const closeError = closeOnce(handle);
    if (closeError === null) throw error;
    throw new AggregateError([error, closeError], 'seam contract breach while closing the handle');
  }

  const closeError = closeOnce(handle);
  if (closeError === null) return primary;

  // A failing close is recorded as an additional diagnostic rather than a new result shape:
  // `ok: false` already carries `diagnostics`, so appending there keeps every other type — and
  // every consumer — unchanged while neither failure is lost.
  if (!primary.ok) {
    return {
      ok: false,
      diagnostics: [...primary.diagnostics, ioDiagnostic(path, 'close', closeError)],
    };
  }

  // The bytes arrived, but the handle's state is unknown, so they are not handed out.
  return ioFailure(path, 'close', closeError);
}

/**
 * Release the handle, once. Returns the error the release raised, or `null`.
 *
 * Deliberately not a retry: a `close` that throws leaves the descriptor's state unknown, and a
 * second attempt could close a descriptor number that has since been reused. The handle is
 * treated as released either way.
 */
function closeOnce(handle: SourceHandle): unknown | null {
  const closed = callSeam(() => handle.close());
  return closed.ok ? null : closed.error;
}

/**
 * The body of a read, with every handle operation turned into a typed result.
 *
 * Split out so `readSource` can release the handle in exactly one place, whether the body
 * returned a result or threw a contract breach.
 */
function inspect(handle: SourceHandle, path: string, limits: Limits): ReadOutcome {
  const statted = callSeam(() => handle.stat());
  if (!statted.ok) return ioFailure(path, 'stat', statted.error);
  const before = statted.value;

  if (!before.isRegularFile) {
    return {
      ok: false,
      diagnostics: [
        emit('E_NOT_A_FILE', { details: { path: boundedDetail(path) }, construct: 'Source' }),
      ],
    };
  }

  if (before.sizeBytes === 0) {
    return {
      ok: false,
      diagnostics: [emit('E_EMPTY_INPUT', { details: { sizeBytes: 0 }, construct: 'Source' })],
    };
  }

  // Checked before the allocation: a 100 MiB file costs one fstat, not one buffer.
  if (before.sizeBytes > limits.maxBytes) {
    return {
      ok: false,
      diagnostics: [
        emit('E_LIMIT_BYTES', {
          details: { sizeBytes: before.sizeBytes, maxBytes: limits.maxBytes },
          construct: 'Source',
        }),
      ],
    };
  }

  const read = readExactly(handle, before.sizeBytes);
  if (!read.ok) {
    if (read.reason === 'io') return ioFailure(path, 'read', read.error);
    return {
      ok: false,
      diagnostics: [
        emit('E_TRUNCATED_INPUT', {
          details: { declaredSizeBytes: before.sizeBytes },
          construct: 'Source',
        }),
      ],
    };
  }

  const restatted = callSeam(() => handle.stat());
  // An unreadable re-stat is an I/O failure, not evidence that the file changed: the reader
  // never got a second opinion to compare, so it reports what actually happened.
  if (!restatted.ok) return ioFailure(path, 'stat', restatted.error);
  const after = restatted.value;

  if (
    after.sizeBytes !== before.sizeBytes ||
    after.mtimeMs !== before.mtimeMs ||
    after.ino !== before.ino
  ) {
    return {
      ok: false,
      diagnostics: [
        emit('E_FILE_CHANGED_DURING_READ', {
          details: {
            sizeBytesBefore: before.sizeBytes,
            sizeBytesAfter: after.sizeBytes,
            mtimeChanged: after.mtimeMs !== before.mtimeMs,
            inodeChanged: after.ino !== before.ino,
          },
          construct: 'Source',
        }),
      ],
    };
  }

  return {
    ok: true,
    source: {
      bytes: read.bytes,
      sizeBytes: read.bytes.byteLength,
      sha256: createHash('sha256').update(read.bytes).digest('hex'),
    },
  };
}

/**
 * Read exactly `sizeBytes` from the handle.
 *
 * The buffer is sized from the stat rather than from the cap, so a 2 KiB fixture costs 2 KiB.
 * Chunks keep a single `read` call bounded even on a very large input.
 *
 * A seam failure is returned, and the buffer is dropped with it: no partial read ever leaves
 * this function. A seam that returns **more** than it was asked for is not an I/O condition at
 * all — it breaks the handle contract — so it throws instead of becoming `E_IO`.
 */
function readExactly(handle: SourceHandle, sizeBytes: number): ReadBytes {
  const buffer = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;

  while (offset < sizeBytes) {
    const wanted = Math.min(READ_CHUNK_BYTES, sizeBytes - offset);

    const read = callSeam(() => handle.read(offset, wanted));
    if (!read.ok) return { ok: false, reason: 'io', error: read.error };
    const chunk = read.value;

    if (chunk.byteLength === 0) return { ok: false, reason: 'short' };
    if (chunk.byteLength > wanted) {
      // Contract breach, not a file condition: `Buffer.copy` would silently truncate the excess
      // and the resulting buffer would still hash consistently, so this is refused loudly.
      throw new Error(
        `read returned ${String(chunk.byteLength)} bytes for a ${String(wanted)}-byte request`,
      );
    }

    chunk.copy(buffer, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes: buffer };
}
