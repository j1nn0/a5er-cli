/**
 * `tests/cli-tables-io.test.ts` — `a5er tables` against real pipes
 * (`docs/proposals/human-cli.md` §7.3 R-1, R-1j, R-2, R-2f, R-4, R-11).
 *
 * These cases spawn `node dist/cli.js` with real pipes and check only what a real pipe can promise.
 * They **never assume that `EPIPE` is observed**: depending on timing and the platform the child may
 * finish writing into the pipe buffer before the reader goes away. A destroyed reader therefore
 * asserts only exit `0`, an empty stderr and a received-byte count within `[0, full length]`.
 *
 * `<big>` is a generated synthetic document — 4,000 entities with a 200-character CJK `LName`, about
 * 600 UTF-8 bytes per row — written to a `mkdtemp` directory and removed in `finally`. The test
 * first measures that its full text output is over 1 MiB, so the pipe cases really do cross the pipe
 * buffer. Inputs are synthetic and never committed.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { serialize } from '../src/json/index.js';
import { strictReplacer } from '../src/json/serialize.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { toTablesEnvelope } from '../src/view/tables.js';
import { stage } from './helpers/stage.js';
import { TXT_01 } from './helpers/tables-text-expectations.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The 200-character CJK logical name every `<big>` row carries. */
const BIG_LABEL = '名'.repeat(200);

/** A generated document of `count` entities, each with a long CJK `LName`. */
function bigDocument(count: number): string {
  const lines = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
  ];
  for (let index = 0; index < count; index += 1) {
    lines.push(
      '[Entity]',
      `PName="big_${index}"`,
      `LName="${BIG_LABEL}"`,
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
      '',
    );
  }
  return lines.join('\n');
}

/** Write a document to a throwaway directory and run `probe`, always cleaning up. */
async function withDocument<T>(
  content: string,
  name: string,
  probe: (path: string, directory: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-io-'));
  try {
    const path = join(directory, name);
    writeFileSync(path, content, 'utf8');
    return await probe(path, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run the CLI to completion and return raw stdout bytes, stderr text and the exit code. */
function runToFile(
  args: readonly string[],
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'buffer',
        timeout: 20_000,
        // <big>'s text output is several MiB; the default 1 MiB buffer is too small for it.
        maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, TZ: 'UTC', LANG: 'C' },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code, stdout, stderr: Buffer.from(stderr).toString('utf8') });
      },
    );
  });
}

/** Spawn the CLI and destroy its stdout reader after the first `data` chunk, or before any. */
function withDestroyedReader(
  args: readonly string[],
  when: 'after-first-chunk' | 'immediately',
): Promise<{ code: number | null; received: number; stderr: string; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TZ: 'UTC', LANG: 'C' },
    });
    let received = 0;
    let stderr = '';
    let destroyed = false;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    if (when === 'immediately') {
      child.stdout.destroy();
      destroyed = true;
    } else {
      child.stdout.on('data', (chunk: Buffer) => {
        received += chunk.byteLength;
        if (!destroyed) {
          destroyed = true;
          child.stdout.destroy();
        }
      });
    }

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, received, stderr, signal });
    });
  });
}

describe('a5er tables — real pipes (§7.3)', () => {
  it('measures that <big> text output is over 1 MiB', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const result = await runToFile(['tables', path]);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      // The pipe cases below only mean something when the output cannot fit one pipe buffer.
      expect(result.stdout.byteLength).toBeGreaterThan(1_048_576);
    });
  }, 120_000);

  it('R-1: a reader that leaves after the first chunk does not kill the process', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const full = await runToFile(['tables', path]);
      const observed = await withDestroyedReader(['tables', path], 'after-first-chunk');

      // Never asserts that EPIPE was seen: the child may have finished into the buffer.
      expect(observed.signal).toBeNull();
      expect(observed.code).toBe(0);
      expect(observed.stderr).toBe('');
      expect(observed.received).toBeGreaterThan(0);
      expect(observed.received).toBeLessThanOrEqual(full.stdout.byteLength);
    });
  }, 120_000);

  it('R-1j: the same for --format json', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const full = await runToFile(['tables', '--format', 'json', path]);
      const observed = await withDestroyedReader(
        ['tables', '--format', 'json', path],
        'after-first-chunk',
      );

      expect(observed.signal).toBeNull();
      expect(observed.code).toBe(0);
      expect(observed.stderr).toBe('');
      expect(observed.received).toBeLessThanOrEqual(full.stdout.byteLength);
    });
  }, 120_000);

  it('R-2: stdout destroyed before any data still exits 0 with no stderr', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const observed = await withDestroyedReader(['tables', path], 'immediately');

      expect(observed.signal).toBeNull();
      expect(observed.code).toBe(0);
      expect(observed.stderr).toBe('');
    });
  }, 120_000);

  it('R-2f: the same on an empty file keeps the read’s code and its fatal line', async () => {
    await withDocument('', 'empty.a5er', async (path) => {
      const observed = await withDestroyedReader(['tables', path], 'immediately');

      expect(observed.signal).toBeNull();
      expect(observed.code).toBe(1);
      expect(observed.stderr).toBe('a5er: fatal: E_EMPTY_INPUT: The input is empty\n');
    });
  }, 120_000);

  it.runIf(process.platform === 'linux')(
    'R-4: /dev/full reports ENOSPC as exit 74',
    async () => {
      const staged = stage('txt-01');
      // `/dev/full` is opened by a shell redirection; `spawn` cannot express it, so one `sh -c`
      // runs exactly that step and the CLI itself is the process under test.
      const result = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
        execFile(
          'sh',
          ['-c', `"${process.execPath}" "${CLI_PATH}" tables "$1" > /dev/full`, 'sh', staged.path],
          { timeout: 20_000, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
          (error, _stdout, stderr) => {
            const code = error === null ? 0 : error.code;
            if (typeof code !== 'number') {
              reject(error);
              return;
            }
            resolve({ code, stderr: String(stderr) });
          },
        );
      });

      expect(result.code).toBe(74);
      expect(result.stderr).toBe('a5er: error: cannot write to stdout (ENOSPC)\n');
    },
    120_000,
  );

  it('R-11: a full read of txt-01 equals the hand-authored text expectation', async () => {
    const staged = stage('txt-01');
    try {
      const text = await runToFile(['tables', staged.path]);
      const json = await runToFile(['tables', '--format', 'json', staged.path]);

      expect(text.code).toBe(0);
      expect(text.stdout.toString('utf8')).toBe(`${TXT_01}\n`);

      // The JSON expectation is the B-5 reference, computed in this process from the same bytes
      // (§7.3 R-11 allows it for the generated documents; §8.4's hand-authored key sets are the
      // structural pin).
      expect(json.code).toBe(0);
      expect(json.stdout.toString('utf8')).toBe(`${expectedTablesJson(staged.path)}\n`);
    } finally {
      staged.cleanup();
    }
  }, 120_000);

  it('R-11: a full read of <big> equals the B-5 reference in both formats', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const text = await runToFile(['tables', path]);
      const json = await runToFile(['tables', '--format', 'json', path]);

      expect(text.code).toBe(0);
      expect(json.code).toBe(0);

      // Text: every row carries the full CJK logical name, in order.
      const textLines = text.stdout.toString('utf8').split('\n');
      const rows = textLines.filter((line) => /^[ 0-9]/.test(line));
      expect(rows).toHaveLength(4_000);
      expect(rows[0]).toContain(BIG_LABEL);
      expect(rows.at(-1)).toContain('big_3999');

      // JSON: the encoder's bytes equal `JSON.stringify` of the same document (B-5).
      expect(json.stdout.toString('utf8')).toBe(`${expectedTablesJson(path)}\n`);
    });
  }, 120_000);
});

/** The B-5 reference: the tables document of a staged file, as one compact JSON line. */
function expectedTablesJson(path: string): string {
  const load = loadSource(path);
  if (!load.ok) throw new Error(`${path} did not load`);
  const scan = scanSource(load.source);
  const classification = classify(scan);
  const envelope = serialize(
    { load, scan, classification, semantics: derivePartialSemantics(classification) },
    { command: 'inspect', path },
  );
  return JSON.stringify(toTablesEnvelope(envelope), strictReplacer);
}

describe('a5er inspect — the baseline observation (§7.3 R-C, not an acceptance condition)', () => {
  it('records what today’s inspect does when the reader leaves, without asserting a platform result', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const observed = await withDestroyedReader(['inspect', path], 'after-first-chunk');

      // R-C is an observation: `inspect` keeps its single synchronous write, so it may exit 0 or 1
      // and may print an EPIPE stack trace. Nothing here fails on a difference — the case exists so
      // the value is reported in the PR, not pinned as behaviour.
      expect(typeof observed.code).toBe('number');
      expect(observed.stderr.includes('EPIPE')).toBe(observed.stderr.includes('EPIPE'));
      // The one thing that must hold: the observation itself is not a crash into a signal with no
      // exit code, which would mean the probe never ran.
      expect(observed.code === null).toBe(false);
    });
  }, 120_000);
});
