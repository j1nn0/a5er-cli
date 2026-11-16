/**
 * Bounded, read-only input (`architecture.md` §10.1, §10.2).
 *
 * The sequence is fixed by the document: `open(path, 'r')` → fstat → bounded read up to
 * `maxBytes` → fstat again. The handle is closed on every path, including the failing ones, and
 * nothing is written, renamed or truncated.
 *
 * Failure is a typed value, never an exception and never a partial result: a caller that gets
 * `ok: false` has no bytes to accidentally use (§10.2 "no partial-success mode").
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

/** OS errno of a failing open, when the platform supplies one. */
function errnoOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
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
 * bytes describe a stable file.
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

  try {
    const before = handle.stat();
    if (!before.isRegularFile) {
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

    const bytes = readExactly(handle, before.sizeBytes);
    if (bytes === null) {
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

    const after = handle.stat();
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
        bytes,
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  } finally {
    handle.close();
  }
}

/**
 * Read exactly `sizeBytes` from the handle, or return `null` when the input ended early.
 *
 * The buffer is sized from the stat rather than from the cap, so a 2 KiB fixture costs 2 KiB.
 * Chunks keep a single `read` call bounded even on a very large input.
 */
function readExactly(handle: SourceHandle, sizeBytes: number): Buffer | null {
  const buffer = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;

  while (offset < sizeBytes) {
    const wanted = Math.min(READ_CHUNK_BYTES, sizeBytes - offset);
    const chunk = handle.read(offset, wanted);
    if (chunk.byteLength === 0) return null;
    if (chunk.byteLength > wanted) {
      // The seam promised at most `wanted` bytes. Copying the excess would truncate it
      // silently and produce a buffer that still hashes consistently — refuse instead.
      throw new Error(
        `read returned ${String(chunk.byteLength)} bytes for a ${String(wanted)}-byte request`,
      );
    }
    chunk.copy(buffer, offset);
    offset += chunk.byteLength;
  }

  return buffer;
}
