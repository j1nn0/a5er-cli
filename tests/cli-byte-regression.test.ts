/**
 * `tests/cli-byte-regression.test.ts` — the 88-run byte fence for `inspect` and `validate`
 * (`docs/proposals/human-cli.md` §8.5, §5.8, K-2, G-1).
 *
 * For every fixture with committed bytes (39 synthetic + 5 byte fixtures) and both commands, this
 * file spawns the built CLI and compares **raw UTF-8 bytes** with an expectation built from the
 * committed golden — never from `serialize()`, `toJsonString` or the CLI's output.
 *
 * **How the expected stdout is built.** The goldens are pretty-printed and carry
 * `<package-version>`; the CLI prints one compact line. So the golden is parsed, `tool.version` is
 * replaced with the manifest version (`tests/helpers/package-version.ts`, so no version is
 * hard-coded), `command` is set to the command under test (every golden is an `inspect` envelope),
 * and `source.path` is set to the staged path — the only scrubbed member. Then
 * `Buffer.from(JSON.stringify(e) + '\n', 'utf8')`, using the language built-in on the parsed
 * golden.
 *
 * **How the expected stderr and exit codes are derived.** From the hand-written table in
 * `tests/helpers/cli-expectations.ts`, which states each fixture's stderr bytes and both exit codes
 * as literals, authored from the fixture's recorded `fatal`/`error` diagnostics and
 * `architecture.md` §12's exit rules. Nothing here transforms a golden or product output into an
 * expectation at run time. The `inspect` code is also cross-checked against the registry's authored
 * `exitCode`.
 *
 * **Capture** uses `execFile(..., { encoding: 'buffer' })`, so stdout and stderr are compared as
 * bytes (`Buffer.compare`), not decoded strings — an encoding mistake cannot hide behind a decode.
 *
 * Fixtures are staged as disposable copies; byte fixtures are written from their modules into a
 * `mkdtemp` directory. No real `.a5er` export is read, and nothing under `tests/fixtures/` is
 * written.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonEnvelope } from '../src/json/index.js';
import type { CliExpectation } from './helpers/cli-expectations.js';
import { CLI_EXPECTATIONS } from './helpers/cli-expectations.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { PACKAGE_VERSION, VERSION_PLACEHOLDER } from './helpers/package-version.js';
import { stage } from './helpers/stage.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/json-goldens/', import.meta.url));

/** The five committed byte fixtures, as their modules export them. */
const BYTE_FIXTURES: Readonly<Record<string, Uint8Array>> = {
  'enc-03': enc03.BYTES,
  'enc-04': enc04.BYTES,
  'enc-05': enc05.BYTES,
  'hst-02': hst02.BYTES,
  'hst-05': hst05.BYTES,
};

/** Every fixture with committed bytes: 39 synthetic + 5 bytes. */
const GOLDEN_CASES: readonly FixtureSpec[] = FIXTURES.filter(
  (spec) => spec.fixtureClass === 'synthetic' || spec.fixtureClass === 'bytes',
);

interface Staged {
  readonly path: string;
  cleanup(): void;
}

/** Stage one fixture: the synthetic helper copies by ID, the byte modules are written as-is. */
function stagedFor(spec: FixtureSpec): Staged {
  if (spec.fixtureClass === 'synthetic') {
    const staged = stage(spec.id);
    return { path: staged.path, cleanup: staged.cleanup };
  }
  const bytes = BYTE_FIXTURES[spec.id];
  if (bytes === undefined) throw new Error(`${spec.id} has no committed bytes`);
  const directory = mkdtempSync(join(tmpdir(), 'a5er-byte-'));
  const path = join(directory, `${spec.id}.a5er`);
  writeFileSync(path, bytes);
  return {
    path,
    cleanup(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * The golden of one fixture, with its one placeholder expanded.
 *
 * Asserts that the placeholder is what the file holds: a golden that hard-coded a version would
 * otherwise compare against itself.
 */
function readGolden(id: string): JsonEnvelope {
  const raw = readFileSync(join(GOLDEN_DIR, `${id}.expected.json`), 'utf8');
  const parsed = JSON.parse(raw) as JsonEnvelope;
  const tool = parsed.tool as { name: string; version: string };
  if (tool.version !== VERSION_PLACEHOLDER) {
    throw new Error(`${id}: tool.version is ${JSON.stringify(tool.version)}, not the placeholder`);
  }
  tool.version = PACKAGE_VERSION;
  return parsed;
}

/** The expected stdout bytes: the golden, re-commanded, re-pathed and compacted. */
function expectedStdout(
  golden: JsonEnvelope,
  command: 'inspect' | 'validate',
  path: string,
): Buffer {
  // A spread keeps the envelope's key order; only `command` and the scrubbed `source.path` move.
  const source = golden.source === null ? null : { ...golden.source, path };
  const document = { ...golden, command, source };
  return Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
}

/**
 * The expected stderr and exit code, read from the hand-written table of `cli-expectations.ts`.
 *
 * No golden and no product output is transformed into an expectation here (§8.5).
 */
function expectationFor(id: string, command: 'inspect' | 'validate'): CliExpectation {
  const entry = CLI_EXPECTATIONS[id];
  if (entry === undefined) throw new Error(`${id}: no hand-written CLI expectation`);
  return entry[command];
}

interface Captured {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

/** Run the built CLI and capture both streams as raw bytes. */
function runCliRaw(args: readonly string[]): Promise<Captured> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { encoding: 'buffer', timeout: 20_000, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('cli byte regression — inspect and validate stay byte-identical (§8.5)', () => {
  it('covers 44 fixtures and both commands', () => {
    expect(GOLDEN_CASES).toHaveLength(44);
    const goldens = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.expected.json'));
    expect(goldens.sort()).toEqual(GOLDEN_CASES.map((spec) => `${spec.id}.expected.json`).sort());
  });

  for (const command of ['inspect', 'validate'] as const) {
    it(`matches the goldens byte for byte for ${command}`, async () => {
      const failures: string[] = [];

      for (const spec of GOLDEN_CASES) {
        const staged = stagedFor(spec);
        try {
          const golden = readGolden(spec.id);
          const result = await runCliRaw([command, staged.path]);
          const expectation = expectationFor(spec.id, command);
          const wantOut = expectedStdout(golden, command, staged.path);
          const wantErr = Buffer.from(expectation.stderr, 'utf8');
          const wantCode = expectation.exitCode;

          if (Buffer.compare(result.stdout, wantOut) !== 0) failures.push(`${spec.id}: stdout`);
          if (Buffer.compare(result.stderr, wantErr) !== 0) failures.push(`${spec.id}: stderr`);
          if (result.code !== wantCode) failures.push(`${spec.id}: exit ${String(result.code)}`);
          // The registry's authored code is the independent cross-check for `inspect`.
          if (command === 'inspect' && result.code !== spec.expectation.exitCode) {
            failures.push(`${spec.id}: registry exit ${String(spec.expectation.exitCode)}`);
          }
        } finally {
          staged.cleanup();
        }
      }

      expect(failures).toEqual([]);
    }, 120_000);
  }

  it('accepts --format json before, between and after the operands, byte-identically', async () => {
    const spec = GOLDEN_CASES.find((candidate) => candidate.id === 'txt-01');
    if (spec === undefined) throw new Error('txt-01 is missing');
    const staged = stagedFor(spec);
    try {
      const golden = readGolden(spec.id);
      const want = expectedStdout(golden, 'inspect', staged.path);

      for (const args of [
        ['--format', 'json', 'inspect', staged.path],
        ['inspect', '--format', 'json', staged.path],
        ['inspect', staged.path, '--format', 'json'],
        ['inspect', '--format', 'json', '--format', 'json', staged.path],
      ]) {
        const result = await runCliRaw(args);
        expect(Buffer.compare(result.stdout, want), args.join(' ')).toBe(0);
        expect(result.code).toBe(0);
      }
    } finally {
      staged.cleanup();
    }
  });
});

describe('cli byte regression — tables stderr equals inspect stderr (§8.5)', () => {
  it('matches for every fixture, in text and in JSON', async () => {
    const failures: string[] = [];

    for (const spec of GOLDEN_CASES) {
      const staged = stagedFor(spec);
      try {
        const inspect = await runCliRaw(['inspect', staged.path]);
        const text = await runCliRaw(['tables', staged.path]);
        const json = await runCliRaw(['tables', '--format', 'json', staged.path]);

        if (Buffer.compare(text.stderr, inspect.stderr) !== 0) failures.push(`${spec.id}: text`);
        if (Buffer.compare(json.stderr, inspect.stderr) !== 0) failures.push(`${spec.id}: json`);
      } finally {
        staged.cleanup();
      }
    }

    expect(failures).toEqual([]);
  }, 180_000);
});
