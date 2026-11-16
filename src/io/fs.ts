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

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

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

/** An open input, read-only. */
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
  /** Release the handle. Idempotent. */
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

/** The only production implementation: `fs.open(path, 'r')`, never `'r+'`. */
export const nodeFileSystem: FileSystem = {
  open(path: string): SourceHandle {
    const descriptor = openSync(path, 'r');
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
