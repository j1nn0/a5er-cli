/**
 * `io/` — bounded read-only input (`architecture.md` §10.1, §10.2).
 *
 * Every case here is a state the document names: a missing path, a directory, an input past the
 * byte cap, a short read, and a file that changes between the two stats. Two of those cannot be
 * produced from a real file deterministically, so they use the injected read boundary — the same
 * production code path, with a handle that reports what a racing file would.
 *
 * Assertions are on values: the exact diagnostic code, the exact `details`, the exact byte count
 * and hash. "It did not throw" is never the assertion.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINARY_WINDOW_BYTES,
  NUL_DENSITY_THRESHOLD,
  looksBinary,
  nulDensity,
} from '../src/io/binary.js';
import type { FileSystem, SourceHandle, SourceStat } from '../src/io/fs.js';
import { DEFAULT_LIMITS, withLimits } from '../src/io/limits.js';
import { READ_CHUNK_BYTES, readSource } from '../src/io/read.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { assertCodes } from './helpers/assert-codes.js';
import { sha256File, stage } from './helpers/stage.js';

/** Temporary directory that is removed even when the test throws. */
function withTempDir<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-io-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function codesOf(outcome: { ok: boolean; diagnostics?: readonly { code: string }[] }): string[] {
  return (outcome.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

/** A stat every fake starts from: a regular, stable file. */
function stat(sizeBytes: number, overrides: Partial<SourceStat> = {}): SourceStat {
  return { sizeBytes, mtimeMs: 1_700_000_000_000, ino: 42, isRegularFile: true, ...overrides };
}

interface FakeOptions {
  readonly stats: readonly SourceStat[];
  /** Bytes each `read` call returns, in order; a short or empty entry ends the input early. */
  readonly chunks: readonly Buffer[];
}

/** Handle recording how often it was read and closed. */
interface FakeHandle {
  readonly handle: SourceHandle;
  readonly reads: number[];
  readonly closes: () => number;
}

function fakeHandle(options: FakeOptions): FakeHandle {
  const reads: number[] = [];
  let closeCount = 0;
  let statIndex = 0;

  const handle: SourceHandle = {
    stat(): SourceStat {
      const value = options.stats[Math.min(statIndex, options.stats.length - 1)];
      statIndex += 1;
      if (value === undefined) throw new Error('fake handle has no stat');
      return value;
    },
    read(position: number, _length: number): Buffer {
      reads.push(position);
      return options.chunks[reads.length - 1] ?? Buffer.alloc(0);
    },
    close(): void {
      closeCount += 1;
    },
  };

  return { handle, reads, closes: () => closeCount };
}

function fakeFileSystem(fake: FakeHandle): FileSystem {
  return { open: () => fake.handle };
}

describe('readSource — the happy path', () => {
  it('returns the staged bytes, their size and their sha256', () => {
    const staged = stage('fmt-01');
    try {
      const outcome = readSource(staged.path);
      if (!outcome.ok) throw new Error(`read failed: ${codesOf(outcome).join(',')}`);

      const onDisk = readFileSync(staged.path);
      expect(outcome.source.bytes.equals(onDisk)).toBe(true);
      expect(outcome.source.sizeBytes).toBe(statSync(staged.path).size);
      // Two independent hashes: one from staging, one from this read.
      expect(outcome.source.sha256).toBe(staged.sha256);
      expect(outcome.source.sha256).toBe(sha256File(staged.path));
      expect(outcome.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      staged.cleanup();
    }
  });

  it('reads in chunks, so a large input never lands in one call', () => {
    withTempDir((directory) => {
      const size = READ_CHUNK_BYTES * 2 + 7;
      const path = join(directory, 'chunked.a5er');
      writeFileSync(path, Buffer.alloc(size, 0x41));

      const outcome = readSource(path);
      if (!outcome.ok) throw new Error('read failed');
      expect(outcome.source.sizeBytes).toBe(size);
      // The buffer is sized from the stat, not from the cap: no 64 MiB allocation for 7 bytes.
      expect(outcome.source.bytes.byteLength).toBe(size);
    });
  });
});

describe('readSource — refusals', () => {
  it('reports a missing path as E_IO with its errno', () => {
    withTempDir((directory) => {
      const path = join(directory, 'absent.a5er');
      const outcome = readSource(path);

      expect(outcome.ok).toBe(false);
      assertCodes(codesOf(outcome), ['E_IO']);
      const [diagnostic] = outcome.ok ? [] : outcome.diagnostics;
      expect(diagnostic?.severity).toBe('fatal');
      expect(diagnostic?.details['errno']).toBe('ENOENT');
      expect(diagnostic?.details['path']).toBe(path);
    });
  });

  it('bounds a long path in details rather than echoing it whole', () => {
    withTempDir((directory) => {
      const longName = `${'x'.repeat(400)}.a5er`;
      const outcome = readSource(join(directory, longName));

      expect(outcome.ok).toBe(false);
      const detail = outcome.ok ? '' : outcome.diagnostics[0]?.details['path'];
      expect(typeof detail).toBe('string');
      expect(String(detail).length).toBeLessThanOrEqual(200);
    });
  });

  it('reports a directory as E_NOT_A_FILE', () => {
    withTempDir((directory) => {
      const outcome = readSource(directory);
      expect(outcome.ok).toBe(false);
      assertCodes(codesOf(outcome), ['E_NOT_A_FILE']);
      expect(outcome.ok ? '' : outcome.diagnostics[0]?.details['path']).toBe(directory);
    });
  });

  it('reports a non-regular handle as E_NOT_A_FILE without reading it', () => {
    // The same contract as the real directory above, pinned without depending on how a
    // platform opens a directory: whatever the OS does, a non-regular file is refused.
    const fake = fakeHandle({ stats: [stat(0, { isRegularFile: false })], chunks: [] });
    const outcome = readSource('a-fifo-or-device', { fileSystem: fakeFileSystem(fake) });

    expect(outcome.ok).toBe(false);
    assertCodes(codesOf(outcome), ['E_NOT_A_FILE']);
    expect(fake.reads).toEqual([]);
    expect(fake.closes()).toBe(1);
  });
  it('reports a zero-byte file as E_EMPTY_INPUT and never reads it', () => {
    withTempDir((directory) => {
      const path = join(directory, 'empty.a5er');
      writeFileSync(path, '');
      const outcome = readSource(path);

      expect(outcome.ok).toBe(false);
      assertCodes(codesOf(outcome), ['E_EMPTY_INPUT']);
      expect(outcome.ok ? null : outcome.diagnostics[0]?.details['sizeBytes']).toBe(0);
    });
  });
});

describe('readSource — the byte cap', () => {
  it('accepts exactly maxBytes and rejects maxBytes + 1', () => {
    withTempDir((directory) => {
      const exact = join(directory, 'exact.a5er');
      const over = join(directory, 'over.a5er');
      writeFileSync(exact, Buffer.alloc(1024, 0x41));
      writeFileSync(over, Buffer.alloc(1025, 0x41));

      const accepted = readSource(exact, { limits: { maxBytes: 1024 } });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.source.sizeBytes).toBe(1024);

      const rejected = readSource(over, { limits: { maxBytes: 1024 } });
      expect(rejected.ok).toBe(false);
      assertCodes(codesOf(rejected), ['E_LIMIT_BYTES']);
      const details = rejected.ok ? {} : (rejected.diagnostics[0]?.details ?? {});
      expect(details).toEqual({ sizeBytes: 1025, maxBytes: 1024 });
    });
  });

  it('rejects above the cap without reading a single byte', () => {
    const fake = fakeHandle({ stats: [stat(8)], chunks: [Buffer.from('12345678')] });
    const outcome = readSource('ignored', {
      limits: { maxBytes: 1024 * 1024 },
      fileSystem: fakeFileSystem(fake),
    });

    // The stat says 8 bytes, which is under the cap, so this one *is* read.
    expect(outcome.ok).toBe(true);

    const bigFake = fakeHandle({ stats: [stat(4096)], chunks: [Buffer.alloc(4096, 0x41)] });
    const big = readSource('ignored', {
      limits: { maxBytes: 1024 },
      fileSystem: fakeFileSystem(bigFake),
    });
    expect(big.ok).toBe(false);
    assertCodes(codesOf(big), ['E_LIMIT_BYTES']);
    // Constant memory on breach: the file was rejected from its stat, never read.
    expect(bigFake.reads).toEqual([]);
  });
});

describe('readSource — the injected read boundary', () => {
  it('reports a short read as E_TRUNCATED_INPUT, the code res-02 expects', () => {
    // The handle declares 100 bytes but ends after 40: an IO seam returning fewer bytes than
    // `fstat` promised. No timing race, no special production branch.
    const fake = fakeHandle({
      stats: [stat(100), stat(100)],
      chunks: [Buffer.alloc(40, 0x41), Buffer.alloc(0)],
    });
    const outcome = readSource('injected-short-read', { fileSystem: fakeFileSystem(fake) });

    expect(outcome.ok).toBe(false);
    const res02 = FIXTURES.find((spec) => spec.id === 'res-02');
    if (res02 === undefined) throw new Error('res-02 is not registered');
    // The observed codes are exactly what the catalog row for res-02 says.
    assertCodes(codesOf(outcome), res02.expectation.codes, 'res-02');
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['declaredSizeBytes']).toBe(100);
    expect(fake.closes()).toBe(1);
  });

  it('reports an mtime change between the two stats as E_FILE_CHANGED_DURING_READ', () => {
    const fake = fakeHandle({
      stats: [stat(4), stat(4, { mtimeMs: 1_700_000_000_001 })],
      chunks: [Buffer.from('abcd')],
    });
    const outcome = readSource('changed-mtime', { fileSystem: fakeFileSystem(fake) });

    expect(outcome.ok).toBe(false);
    assertCodes(codesOf(outcome), ['E_FILE_CHANGED_DURING_READ']);
    expect(outcome.ok ? {} : outcome.diagnostics[0]?.details).toEqual({
      sizeBytesBefore: 4,
      sizeBytesAfter: 4,
      mtimeChanged: true,
      inodeChanged: false,
    });
  });

  it('reports a size change between the two stats as E_FILE_CHANGED_DURING_READ', () => {
    const fake = fakeHandle({ stats: [stat(4), stat(5)], chunks: [Buffer.from('abcd')] });
    const outcome = readSource('changed-size', { fileSystem: fakeFileSystem(fake) });

    expect(outcome.ok).toBe(false);
    assertCodes(codesOf(outcome), ['E_FILE_CHANGED_DURING_READ']);
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['sizeBytesAfter']).toBe(5);
  });

  it('reports an inode change between the two stats as E_FILE_CHANGED_DURING_READ', () => {
    // A rename over the path keeps size and mtime but swaps the inode (§10.1).
    const fake = fakeHandle({
      stats: [stat(4), stat(4, { ino: 43 })],
      chunks: [Buffer.from('abcd')],
    });
    const outcome = readSource('changed-inode', { fileSystem: fakeFileSystem(fake) });

    expect(outcome.ok).toBe(false);
    assertCodes(codesOf(outcome), ['E_FILE_CHANGED_DURING_READ']);
    expect(outcome.ok ? {} : outcome.diagnostics[0]?.details['inodeChanged']).toBe(true);
  });

  it('surfaces a refused open as E_IO without a handle to close', () => {
    const refusing: FileSystem = {
      open(): SourceHandle {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    };
    const outcome = readSource('denied', { fileSystem: refusing });

    expect(outcome.ok).toBe(false);
    assertCodes(codesOf(outcome), ['E_IO']);
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['errno']).toBe('EACCES');
  });

  it('closes the handle exactly once on every path', () => {
    const cases: readonly { readonly name: string; readonly fake: FakeHandle }[] = [
      {
        name: 'success',
        fake: fakeHandle({ stats: [stat(4), stat(4)], chunks: [Buffer.from('abcd')] }),
      },
      {
        name: 'not a file',
        fake: fakeHandle({ stats: [stat(0, { isRegularFile: false })], chunks: [] }),
      },
      { name: 'empty', fake: fakeHandle({ stats: [stat(0)], chunks: [] }) },
      {
        name: 'limit',
        fake: fakeHandle({ stats: [stat(4096)], chunks: [Buffer.alloc(4096)] }),
      },
      {
        name: 'truncated',
        fake: fakeHandle({ stats: [stat(9)], chunks: [Buffer.alloc(3)] }),
      },
      {
        name: 'changed',
        fake: fakeHandle({ stats: [stat(4), stat(5)], chunks: [Buffer.from('abcd')] }),
      },
    ];

    for (const entry of cases) {
      readSource('definitely-not-a-real-path', {
        limits: { maxBytes: 1024 },
        fileSystem: fakeFileSystem(entry.fake),
      });
      expect(entry.fake.closes(), `${entry.name}: handle closed once`).toBe(1);
    }
  });
});

describe('readSource — immutability (imm-01)', () => {
  it('leaves the source file and its directory untouched', () => {
    const staged = stage('fmt-01', { verifyBytes: true });
    try {
      const before = {
        sha256: sha256File(staged.path),
        size: statSync(staged.path).size,
        mtimeMs: statSync(staged.path).mtimeMs,
        siblings: readdirSync(dirname(staged.sourcePath)).sort(),
      };

      const outcome = readSource(staged.path);
      expect(outcome.ok).toBe(true);

      expect(sha256File(staged.path)).toBe(before.sha256);
      expect(statSync(staged.path).size).toBe(before.size);
      expect(statSync(staged.path).mtimeMs).toBe(before.mtimeMs);
      // Reading never creates a sibling: no temp file, no copy (§10.1).
      expect(readdirSync(dirname(staged.sourcePath)).sort()).toEqual(before.siblings);
    } finally {
      staged.cleanup();
    }
  });
});

describe('the binary probe', () => {
  it('treats exactly the threshold as text and one more NUL as binary', () => {
    // A 10-byte window makes 10 % exactly representable: 1 NUL is not binary, 2 NULs are.
    const atThreshold = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const overThreshold = Buffer.from([0, 0, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(nulDensity(atThreshold)).toBe(NUL_DENSITY_THRESHOLD);
    expect(looksBinary(atThreshold)).toBe(false);
    expect(looksBinary(overThreshold)).toBe(true);
  });

  it('measures density, not presence', () => {
    // hst-01's shape: a single NUL deep inside a 200-byte ASCII file.
    const single = Buffer.concat([
      Buffer.alloc(100, 0x41),
      Buffer.from([0]),
      Buffer.alloc(99, 0x41),
    ]);
    expect(nulDensity(single)).toBeCloseTo(1 / 200, 10);
    expect(looksBinary(single)).toBe(false);
  });

  it('looks only at the first 4 KiB', () => {
    const late = Buffer.concat([
      Buffer.alloc(BINARY_WINDOW_BYTES, 0x41),
      Buffer.alloc(BINARY_WINDOW_BYTES, 0x00),
    ]);
    expect(looksBinary(late)).toBe(false);
    expect(nulDensity(Buffer.alloc(0))).toBe(0);
  });
});

describe('limits', () => {
  it('defaults to the documented values', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxBytes: 64 * 1024 * 1024,
      maxLines: 2_000_000,
      maxLineLength: 4 * 1024 * 1024,
    });
    expect(withLimits()).toEqual(DEFAULT_LIMITS);
  });

  it('refuses a limit that would silently change what is accepted', () => {
    expect(() => withLimits({ maxBytes: 0 })).toThrow(/limit maxBytes must be a positive integer/);
    expect(() => withLimits({ maxLines: 1.5 })).toThrow(
      /limit maxLines must be a positive integer/,
    );
  });
});
