/**
 * `tests/cli-tables-io.test.ts` — `a5er tables` against real pipes
 * (`docs/proposals/human-cli.md` §7.3 R-1, R-1j, R-2, R-2f, R-4, R-11, R-C).
 *
 * These cases spawn `node dist/cli.js` with real pipes and check only what a real pipe can promise.
 * They **never assume that `EPIPE` is observed**: depending on timing and the platform the child may
 * finish writing into the pipe buffer before the reader goes away. A destroyed reader therefore
 * asserts the *contract* — exit `0`, no signal, empty stderr, and a received-byte count inside
 * `[1, full length]` (or exactly `0` for the case that destroys the reader before any data).
 *
 * Every spawned child carries its **own 20 s limit** and is killed when it fires, so a hung child
 * fails its own case with a message instead of waiting for the suite timeout. The limit is on the
 * child, not on `it`, and the timer is cleared on every exit path.
 *
 * `<big>` is a generated synthetic document — 4,000 entities with a 200-character CJK `LName`, about
 * 600 UTF-8 bytes per row — written to a `mkdtemp` directory and removed in `finally`. Inputs are
 * synthetic and never committed.
 *
 * **The expectations are not the product's output.** The txt-01 JSON expectation is composed from
 * the committed golden's shared members plus the hand-derived `result` of
 * `tests/helpers/tables-expectations.ts`, in the §5.3 key order; the txt-01 text expectation is the
 * hand-authored block of `tests/helpers/tables-text-expectations.ts`. Only the generated `<big>`
 * documents use the B-5 reference, which §7.3 R-11 permits.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { JsonEnvelope } from '../src/json/index.js';
import { serialize } from '../src/json/index.js';
import { strictReplacer } from '../src/json/serialize.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { toTablesEnvelope } from '../src/view/tables.js';
import { PACKAGE_VERSION, VERSION_PLACEHOLDER } from './helpers/package-version.js';
import { stage } from './helpers/stage.js';
import { TABLE_EXPECTATIONS } from './helpers/tables-expectations.js';
import { decodeRendered, TXT_01 } from './helpers/tables-text-expectations.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The per-child limit §7.3 gives every spawned case: 20 s, enforced here and not by `it`. */
const CHILD_TIMEOUT_MS = 20_000;

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
  timeoutMs: number = CHILD_TIMEOUT_MS,
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'buffer',
        timeout: timeoutMs,
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

/** What one destroyed-reader probe observed. */
interface DestroyedReaderResult {
  /** The exit code, or `null` when the child died from a signal. */
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Bytes the reader received before it went away. */
  readonly received: number;
  readonly stderr: string;
  /** True when the reader was destroyed *in response to* the first `data` chunk (R-1, R-1j). */
  readonly destroyedAfterFirstChunk: boolean;
  /** True when this probe's own 20 s limit fired and the child was killed. */
  readonly timedOut: boolean;
}

/**
 * Spawn the CLI and destroy its stdout reader after the first `data` chunk, or before any.
 *
 * The 20 s limit belongs to this probe: on expiry the child is killed and the result says so, which
 * makes a hang a failed case with a message rather than a suite timeout. The timer is cleared on
 * every exit path, and a child that ends abnormally is still cleaned up.
 */
function withDestroyedReader(
  args: readonly string[],
  when: 'after-first-chunk' | 'immediately',
): Promise<DestroyedReaderResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TZ: 'UTC', LANG: 'C' },
    });
    let received = 0;
    let stderr = '';
    let destroyed = false;
    let destroyedAfterFirstChunk = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, so a child stuck in a write cannot outlive its own limit.
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);

    /** Resolve once, clearing the timer, so a late event cannot double-settle. */
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        received,
        stderr,
        destroyedAfterFirstChunk,
        timedOut,
      });
    };

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
          destroyedAfterFirstChunk = true;
          child.stdout.destroy();
        }
      });
    }

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
  });
}

/**
 * The contract every "the reader left" case shares (§7.3 R-1, R-1j, R-2).
 *
 * `received` chooses the byte expectation: `'some'` for a reader that consumed the first chunk,
 * `'none'` for one destroyed before any data. Nothing here assumes `EPIPE` was observed — only that
 * the process survived and reported a normal exit.
 */
function expectSurvivedDestroyedReader(
  observed: DestroyedReaderResult,
  options: { readonly fullBytes: number; readonly received: 'some' | 'none' },
): void {
  expect(observed.timedOut).toBe(false);
  expect(observed.signal).toBeNull();
  expect(observed.code).toBe(0);
  expect(observed.stderr).toBe('');

  if (options.received === 'some') {
    expect(observed.received).toBeGreaterThan(0);
    expect(observed.received).toBeLessThanOrEqual(options.fullBytes);
    expect(observed.destroyedAfterFirstChunk).toBe(true);
  } else {
    expect(observed.received).toBe(0);
    expect(observed.destroyedAfterFirstChunk).toBe(false);
  }
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

      expectSurvivedDestroyedReader(observed, {
        fullBytes: full.stdout.byteLength,
        received: 'some',
      });
    });
  }, 120_000);

  it('R-1j: the same contract holds for --format json', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const full = await runToFile(['tables', '--format', 'json', path]);
      const observed = await withDestroyedReader(
        ['tables', '--format', 'json', path],
        'after-first-chunk',
      );

      // The same shared contract as R-1: some bytes, never more than the whole document, no signal,
      // exit 0, empty stderr, and the reader really was destroyed after the first chunk.
      expectSurvivedDestroyedReader(observed, {
        fullBytes: full.stdout.byteLength,
        received: 'some',
      });
    });
  }, 120_000);

  it('R-2: stdout destroyed before any data still exits 0, with 0 bytes received', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const full = await runToFile(['tables', path]);
      const observed = await withDestroyedReader(['tables', path], 'immediately');

      // Distinct from R-1: the reader never consumed a byte, so `received` is exactly 0.
      expectSurvivedDestroyedReader(observed, {
        fullBytes: full.stdout.byteLength,
        received: 'none',
      });
    });
  }, 120_000);

  it('R-2f: the same on an empty file keeps the read’s code and its fatal line', async () => {
    await withDocument('', 'empty.a5er', async (path) => {
      const observed = await withDestroyedReader(['tables', path], 'immediately');

      expect(observed.timedOut).toBe(false);
      expect(observed.signal).toBeNull();
      expect(observed.code).toBe(1);
      expect(observed.received).toBe(0);
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
          { timeout: CHILD_TIMEOUT_MS, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
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

  it('R-11: a full read of txt-01 equals the hand-authored text and JSON', async () => {
    const staged = stage('txt-01');
    try {
      const text = await runToFile(['tables', staged.path]);
      const json = await runToFile(['tables', '--format', 'json', staged.path]);

      expect(text.code).toBe(0);
      expect(text.stdout.toString('utf8')).toBe(`${TXT_01}\n`);

      // The JSON expectation is composed from the committed golden's shared members and the
      // hand-derived `result` — never from `serialize()`/`toTablesEnvelope()` (§8.5, R-11).
      expect(json.code).toBe(0);
      // Raw bytes, not a decoded string: the comparison must fail on an encoding slip, a stray
      // CRLF or a missing final LF, not survive one via UTF-8 replacement characters.
      expect(Buffer.compare(json.stdout, Buffer.from(expectedTxt01Json(staged.path), 'utf8'))).toBe(
        0,
      );
    } finally {
      staged.cleanup();
    }
  }, 120_000);

  it('R-11: a full read of <big> equals the redirected output, row for row', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path, directory) => {
      const piped = await runToFile(['tables', path]);
      expect(piped.code).toBe(0);
      expect(piped.stderr).toBe('');

      // 3-B: the same document, written to a file by a shell redirection, must be the same bytes as
      // the fully received pipe.
      const filePath = join(directory, 'big.text');
      await new Promise<void>((resolve, reject) => {
        execFile(
          'sh',
          ['-c', `"${process.execPath}" "${CLI_PATH}" tables "$1" > "$2"`, 'sh', path, filePath],
          { timeout: CHILD_TIMEOUT_MS, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
          (error) => {
            if (error === null) resolve();
            else reject(error);
          },
        );
      });
      const redirected = readFileSync(filePath);
      expect(Buffer.compare(redirected, piped.stdout)).toBe(0);

      // Every row, in order, with its own physical name and the full logical name: nothing missing,
      // nothing duplicated, nothing truncated.
      const text = piped.stdout.toString('utf8');
      expect(text.endsWith('\n')).toBe(true);

      const lines = text.slice(0, -1).split('\n');
      const rowLines = lines.filter((line) => /^[ 0-9]/.test(line));
      expect(rowLines).toHaveLength(4_000);

      for (const [index, line] of rowLines.entries()) {
        const cells = line.split(/\s{2,}/).filter((cell) => cell !== '');
        // SECTION, LINE, KIND, DECLARED, COMMON, EFFECTIVE, PNAME, LNAME
        expect(cells).toHaveLength(8);
        expect(decodeRendered(cells[6] ?? '')).toBe(`big_${index}`);
        expect(decodeRendered(cells[7] ?? '')).toBe(BIG_LABEL);
      }

      // The status note comes first, the header second, then the rows; the four trailing notes
      // follow the last row in their fixed order, and the file ends there.
      expect(lines[0]).toBe('# status: ok');
      expect(lines[1]?.startsWith('SECTION')).toBe(true);

      let lastRow = -1;
      for (const [index, line] of lines.entries()) {
        if (/^[ 0-9]/.test(line)) lastRow = index;
      }
      expect(lastRow).toBe(1 + 4_000);
      const notes = lines.slice(lastRow + 1);
      // The generated document carries no BOM, so exactly one info diagnostic is reported, and its
      // group line follows the summary — five note lines in total, in the fixed order.
      expect(notes).toHaveLength(5);
      expect(notes[0]).toContain(
        '# objects: 4000 (entity 4000, view 0, subtype 0); listed 4000, omitted 0',
      );
      expect(notes[1]).toBe('# unsupported: 0');
      expect(notes[2]).toMatch(/^# diagnostics: 1 \(fatal 0, error 0, warning 0, info 1\)$/);
      expect(notes[3]).toBe(
        '#   info D_BOM_MISSING: The input has no byte-order mark; UTF-8 without one is tolerated (file)',
      );
      // The completeness note is pinned in full, derived from the generated document itself: the
      // 5-line preamble and 4,000 blocks of 6 lines give 5 + 6·4000 − 1 = 24,004 lines, `[Manager]`
      // plus one `[Entity]` per object give 1 + 4000 = 4,001 sections, and `PageInfo` plus four keys
      // per entity give 1 + 4·4000 = 16,001 keys. None is preserved raw, unknown or dropped.
      expect(notes[4]).toBe(
        '# completeness: sections 4001 (parsed 4001, preservedRaw 0, unknown 0); keys 16001 (parsed 16001, preservedRaw 0); lines 24004 (accounted 24004, dropped 0); dropped 0',
      );

      // JSON: the encoder's bytes equal `JSON.stringify` of the same document (B-5, permitted for a
      // generated document).
      const json = await runToFile(['tables', '--format', 'json', path]);
      expect(json.code).toBe(0);
      expect(json.stdout.toString('utf8')).toBe(`${expectedTablesJson(path)}\n`);
    });
  }, 120_000);
});

/**
 * The txt-01 tables JSON, composed from two authored sources (§7.3 R-11, §8.5).
 *
 * The shared members come from the committed golden — the same envelope `inspect` prints, authored
 * independently of the serializer — with `command` set to `tables` and `source.path` set to the
 * staged path. The `result` comes from `TABLE_EXPECTATIONS['txt-01']`, derived from the fixture's
 * own text, expanded by §5.3's key order and §5.4's rules: `objectIndex` is the position in
 * `schema.objects`, the span is the object's one-line anchor, and a complete entity's `collisions`
 * is `0` because the fixture declares no common field.
 */
function expectedTxt01Json(path: string): string {
  const golden = readGolden('txt-01');
  const expected = TABLE_EXPECTATIONS['txt-01'];
  if (expected === undefined) throw new Error('txt-01 has no hand-derived expectation');
  if (golden.source === null || golden.completeness === null) {
    throw new Error('txt-01 golden has no source or completeness');
  }

  const tables = expected.rows.map((row, objectIndex) => ({
    objectIndex,
    sectionIndex: row.sectionIndex,
    span: {
      sectionIndex: row.sectionIndex,
      startLine: row.line,
      endLine: row.line,
      keyLine: row.line,
    },
    kind: row.kind,
    pname: row.pname,
    lname: row.lname,
    columns: {
      status: row.declared === null ? 'unknown' : 'complete',
      reason: row.reason,
      declared: row.declared,
      common: row.common,
      effective: row.effective,
      collisions: row.declared === null ? null : 0,
    },
  }));

  // §5.3's key order, spelled out: no spread of the golden, so a stray `schema` cannot ride along.
  const document = {
    contractVersion: golden.contractVersion,
    tool: golden.tool,
    command: 'tables',
    status: golden.status,
    source: { ...golden.source, path },
    limits: golden.limits,
    result: {
      objects: expected.rows.length + expected.subtypes.length,
      tables,
      omitted: { subtypes: { count: expected.subtypes.length, sectionIndexes: expected.subtypes } },
    },
    unsupported: golden.unsupported,
    diagnostics: golden.diagnostics,
    completeness: golden.completeness,
  };

  return `${JSON.stringify(document)}\n`;
}

/** Read one committed golden and expand its single placeholder, as the golden tests do. */
function readGolden(id: string): JsonEnvelope {
  const raw = readFileSync(
    new URL(`./fixtures/json-goldens/${id}.expected.json`, import.meta.url),
    'utf8',
  );
  const parsed = JSON.parse(raw) as JsonEnvelope;
  const tool = parsed.tool as { name: string; version: string };
  if (tool.version !== VERSION_PLACEHOLDER) {
    throw new Error(`${id}: tool.version is ${JSON.stringify(tool.version)}, not the placeholder`);
  }
  tool.version = PACKAGE_VERSION;
  return parsed;
}

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
  it('records the exit code, stderr and EPIPE fact of today’s inspect, pinning no platform result', async () => {
    await withDocument(bigDocument(4_000), 'big.a5er', async (path) => {
      const observed = await withDestroyedReader(['inspect', path], 'after-first-chunk');

      // R-C is an observation, so the probe reports what it saw instead of comparing it with a
      // pinned value: `inspect` keeps its single synchronous write and may exit 0 or 1, may print an
      // EPIPE stack trace or may finish into the pipe buffer, and neither outcome is a failure here.
      const record = {
        exit: observed.code,
        signal: observed.signal,
        stderrBytes: Buffer.byteLength(observed.stderr, 'utf8'),
        stderrHasEpipe: observed.stderr.includes('EPIPE'),
        receivedBytes: observed.received,
        timedOut: observed.timedOut,
      };
      // eslint-disable-next-line no-console -- the record is the deliverable of R-C (§7.3)
      console.info('[R-C] inspect | reader destroyed:', JSON.stringify(record));

      // Only the probe's own integrity is asserted: it ran, and the child ended with a code.
      expect(record.timedOut).toBe(false);
      expect(typeof record.exit).toBe('number');
      expect(record.stderrBytes).toBeGreaterThanOrEqual(0);
    });
  }, 120_000);
});

/* ── B-1, B-2 and N-1…N-3: the bounded-output cases of §7.7 ─────────────────────────────────── */

/** B-1's long name: 200,001 characters, which no terminal width could ever hold. */
const B1_LONG_NAME = 'p'.repeat(200_001);

/** A document with one very long `PName` and `count` short-named entities after it. */
function longNameDocument(longName: string, count: number): string {
  const lines = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
  ];
  lines.push(
    '[Entity]',
    `PName="${longName}"`,
    'UsingCommonColumns=0',
    'Position="Main",10,10',
    '',
  );
  for (let index = 0; index < count; index += 1) {
    lines.push(
      '[Entity]',
      `PName="t${String(index).padStart(4, '0')}"`,
      'UsingCommonColumns=0',
      'Position="Main",20,20',
      '',
    );
  }
  return lines.join('\n');
}

/** One entity with `count` unknown keys, for N-1. */
function unknownKeyDocument(count: number): { text: string; keyLines: number[] } {
  const lines = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
    '[Entity]',
    'PName="wide"',
    'UsingCommonColumns=0',
  ];
  const keyLines: number[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(`Unknown${index}=1`);
    keyLines.push(lines.length);
  }
  lines.push('Position="Main",10,10', '');
  return { text: lines.join('\n'), keyLines };
}

/** `count` entities with no `PName`, each raising one `V_MISSING_REQUIRED_KEY`, for N-2. */
function missingNameDocument(count: number): string {
  const lines = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
  ];
  for (let index = 0; index < count; index += 1) {
    lines.push('[Entity]', 'LName="名前なし"', 'UsingCommonColumns=0', 'Position="Main",10,10', '');
  }
  return lines.join('\n');
}

/** `count` views, each one section, for N-3. */
function manyViewsDocument(count: number): string {
  const lines = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
  ];
  for (let index = 0; index < count; index += 1) {
    lines.push('[View]', `PName="v${String(index).padStart(5, '0')}"`, 'Position="Main",10,10', '');
  }
  return lines.join('\n');
}

/** The row lines of a text listing. */
function rowLinesOf(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /^[ 0-9]/.test(line));
}

describe('a5er tables — bounded output (§7.7 B-1, B-2)', () => {
  it('B-1: a 200,001-character name is written whole, inside one megabyte and one child limit', async () => {
    await withDocument(longNameDocument(B1_LONG_NAME, 3_999), 'b1.a5er', async (path) => {
      const text = await runToFile(['tables', path], 20_000);
      expect(text.code).toBe(0);
      expect(text.stderr).toBe('');
      // The whole listing stays under 1 MiB: the 48-cell cap, not the name, decides the padding.
      expect(text.stdout.byteLength).toBeLessThan(1_048_576);

      const stdout = text.stdout.toString('utf8');
      const rows = rowLinesOf(stdout);
      expect(rows).toHaveLength(4_000);

      // The long row holds the entire name, then exactly two spaces, then `LNAME`.
      const longRow = rows[0] ?? '';
      expect(longRow).toContain(B1_LONG_NAME);
      expect(longRow.endsWith(`${B1_LONG_NAME}  -`)).toBe(true);

      // Every other row is aligned at `W = 5`: its `PNAME` cell is exactly the five-character name.
      const shortRows = rows.slice(1);
      const widths = new Set<number>();
      for (const [index, line] of shortRows.entries()) {
        const cells = line.split(/\s{2,}/).filter((cell) => cell !== '');
        expect(cells[6]).toBe(`t${String(index).padStart(4, '0')}`);
        widths.add(line.indexOf('  ', 52));
      }
      expect([...widths]).toHaveLength(1);

      // JSON: the projected name equals the value `inspect` interpreted from the same bytes.
      const json = await runToFile(['tables', '--format', 'json', path], 20_000);
      const inspect = await runToFile(['inspect', path], 20_000);
      const tablesDocument = JSON.parse(json.stdout.toString('utf8')) as {
        result: { tables: { pname: string | null }[] };
      };
      const inspectDocument = JSON.parse(inspect.stdout.toString('utf8')) as {
        schema: { objects: { pname: { value: string } | null }[] };
      };
      expect(tablesDocument.result.tables[0]?.pname).toBe(B1_LONG_NAME);
      expect(tablesDocument.result.tables[0]?.pname).toBe(
        inspectDocument.schema.objects[0]?.pname?.value,
      );
    });
  }, 120_000);

  it('B-2: 400,000 escapes expand in full and still decode to the value', async () => {
    const escapes = '\u001b'.repeat(400_000);
    await withDocument(longNameDocument(escapes, 3_999), 'b2.a5er', async (path) => {
      const text = await runToFile(['tables', path], 20_000);
      expect(text.code).toBe(0);
      expect(text.stderr).toBe('');

      const stdout = text.stdout.toString('utf8');
      const longRow = rowLinesOf(stdout)[0] ?? '';
      const escaped = `"${'\\u{001B}'.repeat(400_000)}"`;

      // `"` + 400,000 × `\u{001B}` + `"` is 3,200,002 code units (§7.7 B-2).
      expect(escaped.length).toBe(3_200_002);
      expect(longRow.endsWith(`${escaped}  -`)).toBe(true);
      // And the rendering is reversible (§4.4.1): the raw value comes back.
      expect(decodeRendered(escaped)).toBe(escapes);

      const json = await runToFile(['tables', '--format', 'json', path], 20_000);
      const inspect = await runToFile(['inspect', path], 20_000);
      const tablesDocument = JSON.parse(json.stdout.toString('utf8')) as {
        result: { tables: { pname: string | null }[] };
      };
      const inspectDocument = JSON.parse(inspect.stdout.toString('utf8')) as {
        schema: { objects: { pname: { value: string } | null }[] };
      };
      expect(tablesDocument.result.tables[0]?.pname).toBe(escapes);
      expect(tablesDocument.result.tables[0]?.pname).toBe(
        inspectDocument.schema.objects[0]?.pname?.value,
      );
    });
  }, 120_000);
});

describe('a5er tables — 30,000-scale notes and stderr (§7.7 N-1, N-2, N-3)', () => {
  it('N-1: 30,000 unknown keys list every line, in order, and the counts agree', async () => {
    const { text: document, keyLines } = unknownKeyDocument(30_000);
    await withDocument(document, 'n1.a5er', async (path) => {
      const result = await runToFile(['tables', path], 60_000);
      expect(result.code).toBe(0);

      const stdout = result.stdout.toString('utf8');
      const expectedLine = `#   info S_UNKNOWN_KEY: A key this section does not define was preserved verbatim (${keyLines
        .map((line) => `line ${String(line)}`)
        .join(', ')})`;
      expect(stdout).toContain(expectedLine);
      expect(stdout).toContain(
        '# unsupported: 30000 (unknown-key 30000); kept verbatim, not interpreted',
      );
      expect(stdout).toContain('# diagnostics: 30001 (fatal 0, error 0, warning 0, info 30001)');

      const json = await runToFile(['tables', '--format', 'json', path], 60_000);
      const tablesDocument = JSON.parse(json.stdout.toString('utf8')) as {
        unsupported: { kind: string }[];
        diagnostics: { code: string }[];
      };
      expect(
        tablesDocument.unsupported.filter((record) => record.kind === 'unknown-key'),
      ).toHaveLength(30_000);
      expect(
        tablesDocument.diagnostics.filter((diagnostic) => diagnostic.code === 'S_UNKNOWN_KEY'),
      ).toHaveLength(30_000);
      // The B-5 reference: the encoder's bytes are `JSON.stringify`'s.
      expect(json.stdout.toString('utf8')).toBe(`${expectedTablesJson(path)}\n`);
    });
  }, 120_000);

  it('N-2: 30,000 missing PNames give byte-identical stderr to inspect', async () => {
    await withDocument(missingNameDocument(30_000), 'n2.a5er', async (path) => {
      const tables = await runToFile(['tables', path], 60_000);
      const inspect = await runToFile(['inspect', path], 60_000);

      expect(tables.code).toBe(0);
      expect(inspect.code).toBe(0);
      // One `error` line per entity, and the same bytes `inspect` writes (§3.6, §8.5).
      expect(
        Buffer.compare(Buffer.from(tables.stderr, 'utf8'), Buffer.from(inspect.stderr, 'utf8')),
      ).toBe(0);
      expect(tables.stderr.split('\n').filter((line) => line !== '')).toHaveLength(30_000);

      // The text group line lists 30,000 locations; the notes stay bounded and complete.
      const stdout = tables.stdout.toString('utf8');
      // 30,000 errors plus the one `D_BOM_MISSING` info the generated document earns.
      expect(stdout).toContain('# diagnostics: 30001 (fatal 0, error 30000, warning 0, info 1)');
      const groupLine = stdout
        .split('\n')
        .find((line) => line.startsWith('#   error V_MISSING_REQUIRED_KEY:'));
      expect(groupLine?.match(/line \d+/g)).toHaveLength(30_000);
    });
  }, 120_000);

  it('N-3: 30,000 views list 30,000 sections in the unknown note', async () => {
    await withDocument(manyViewsDocument(30_000), 'n3.a5er', async (path) => {
      const result = await runToFile(['tables', path], 60_000);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');

      const stdout = result.stdout.toString('utf8');
      // Section 1 is `[Manager]`; the views are sections 2..30,001 in file order.
      const sections = Array.from({ length: 30_000 }, (_, index) => index + 2);
      expect(stdout).toContain(
        `# unknown: a view does not store its columns (sections ${sections.join(', ')})`,
      );
      expect(stdout).toContain(
        '# objects: 30000 (entity 0, view 30000, subtype 0); listed 30000, omitted 0',
      );
      expect(rowLinesOf(stdout)).toHaveLength(30_000);
    });
  }, 120_000);
});
