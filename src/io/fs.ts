/**
 * The read boundary (`architecture.md` §10.1).
 *
 * One interface (`FileSystem`) plus one handle type (`SourceHandle`), injected through a single
 * option on `readSource`. The production implementation is `nodeFileSystem`; tests inject a
 * fake to reach two states a real file cannot be made to produce deterministically — a short
 * read (`E_TRUNCATED_INPUT`) and a file that changes between the two stats
 * (`E_FILE_CHANGED_DURING_READ`) — without a timing race or a special code path.
 *
 * The seam is deliberately smaller than `node:fs`: open for reading, stat, positional read,
 * close. There is no write, truncate, rename or unlink, so no caller can grow one.
 */

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

/** The parts of `fstat` the reader compares (`architecture.md` §10.1). */
export interface SourceStat {
  readonly sizeBytes: number;
  /** Millisecond mtime; the reader compares it before and after the read. */
  readonly mtimeMs: number;
  /** Inode number, when the platform has one; `0` where it does not. */
  readonly ino: number;
  /** False for a directory, socket, device or FIFO (`E_NOT_A_FILE`). */
  readonly isRegularFile: boolean;
}

/**
 * An open input, read-only.
 *
 * Contract (R12): any method may throw, and the reader treats a throw as a *file condition* —
 * an `E_IO` diagnostic, never an escaping exception — except for `read` returning more bytes
 * than requested, which is a breach of this contract rather than a property of the input.
 * A `close` that throws is not retried: the descriptor state is unknown after it.
 */
export interface SourceHandle {
  /** Current stat. Called twice by the reader: before and after the read. */
  stat(): SourceStat;
  /**
   * Read up to `length` bytes starting at `position`.
   *
   * A result shorter than requested means the input ended before the size it declared; the
   * reader reports `E_TRUNCATED_INPUT` rather than returning a short buffer.
   */
  read(position: number, length: number): Buffer;
  /** Release the handle. Called at most once per handle; idempotent is still expected. */
  close(): void;
}

/** How the reader reaches a path. */
export interface FileSystem {
  /**
   * Open `path` for reading only.
   *
   * Throws a `NodeJS.ErrnoException` when the platform refuses (`ENOENT`, `EACCES`, `EISDIR`,
   * …); `readSource` maps it to `E_IO` and records the errno in `details`.
   */
  open(path: string): SourceHandle;
}

/**
 * Read-only, and non-blocking wherever the platform has `O_NONBLOCK`.
 *
 * The reader refuses a non-regular file, but only after opening it: `open(path, 'r')` on a
 * writer-less FIFO waits for a writer, so the refusal is never reached and the command hangs.
 * `O_NONBLOCK` makes that open return at once on POSIX and is documented to have no effect on a
 * regular file, which is the only kind of input that is then read. Windows exports no
 * `O_NONBLOCK` constant, so it keeps the plain `'r'` flag string.
 */
const READ_ONLY_FLAGS: string | number =
  typeof constants.O_NONBLOCK === 'number' ? constants.O_RDONLY | constants.O_NONBLOCK : 'r';

/** The only production implementation: `READ_ONLY_FLAGS`, never `'r+'`. */
export const nodeFileSystem: FileSystem = {
  open(path: string): SourceHandle {
    const descriptor = openSync(path, READ_ONLY_FLAGS);
    let closed = false;

    return {
      stat(): SourceStat {
        const stat = fstatSync(descriptor);
        return {
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          ino: Number(stat.ino),
          isRegularFile: stat.isFile(),
        };
      },
      read(position: number, length: number): Buffer {
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = readSync(descriptor, buffer, 0, length, position);
        return buffer.subarray(0, bytesRead);
      },
      close(): void {
        if (closed) return;
        closed = true;
        closeSync(descriptor);
      },
    };
  },
};
