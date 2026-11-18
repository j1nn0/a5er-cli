/**
 * Stage 7 Unit A — `inspect` and `validate` end to end (`architecture.md` §11, §12;
 * `test-strategy.md` §2 L4/L5, §10, §14 stage 7).
 *
 * Every assertion spawns the built `dist/cli.js`, so what is tested is the shipped artefact: the
 * exit code the process really returns, the bytes each stream really receives, and nothing about
 * how `main()` reached them.
 *
 * What this file pins, and only this:
 *
 * 1. the help/version/no-argument contract, and that the help names the two commands that exist
 *    and none of the ones that do not;
 * 2. command-line misuse — unknown option, unknown command, missing/extra/empty operand, an
 *    unsupported `--format` value — all exit 2 with stdout left completely empty;
 * 3. one envelope per invocation, ten fields in emission order, one trailing newline, and never
 *    prose on stdout;
 * 4. the §12 exit table: 0 for a non-failed `inspect` (`degraded` included) and for a `validate`
 *    without an `error`; 1 for a failed read, which still emits its envelope; 3 for `validate`
 *    with an `error` — the sem-08/sem-09 split (`inspect` 0, `validate` 3);
 * 5. stderr as prose: one line per `fatal`/`error` diagnostic, and nothing for `warning`/`info`.
 *
 * Fixtures are staged with the committed synthetic catalog or written from the committed byte
 * modules; no real `.a5er` export is ever read, logged or quoted (`test-strategy.md` §3.7, §3.8).
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';
import { DEFAULT_LIMITS } from '../src/io/limits.js';
import type { JsonEnvelope } from '../src/json/index.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import { stage } from './helpers/stage.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** §12's envelope fields, in the order `serialize` constructs them (construction = emission). */
const ENVELOPE_KEYS = [
  'contractVersion',
  'tool',
  'command',
  'status',
  'source',
  'limits',
  'schema',
  'unsupported',
  'diagnostics',
  'completeness',
] as const;

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the built CLI in a child process with a fixed environment so the run is
 * deterministic and offline (no network, no inherited locale or timezone).
 */
function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code: error.code, stdout, stderr });
      },
    );
  });
}

/**
 * Parse the one envelope stdout must carry, asserting the framing §12 requires.
 *
 * A prose line mixed into stdout, a second document, or a missing final newline all fail here,
 * which is the point: the stream has to be exactly one JSON document, not a superset of one.
 */
function envelopeOf(stdout: string): JsonEnvelope {
  expect(stdout.endsWith('\n')).toBe(true);
  expect(stdout.slice(0, -1)).not.toContain('\n');
  expect(stdout).not.toContain('a5er: ');

  const parsed: unknown = JSON.parse(stdout);
  expect(Object.keys(parsed as object)).toEqual([...ENVELOPE_KEYS]);
  return parsed as JsonEnvelope;
}

/** An envelope's diagnostics as `CODE:severity`, in emission order. */
function severityPairsOf(envelope: JsonEnvelope): string[] {
  return envelope.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}`);
}

/** Stage a committed synthetic fixture, run `probe` against its staged path, always clean up. */
async function withStaged<T>(id: string, probe: (path: string) => Promise<T>): Promise<T> {
  const staged = stage(id);
  try {
    return await probe(staged.path);
  } finally {
    staged.cleanup();
  }
}

/** Write committed bytes to a throwaway `.a5er` path, run `probe`, always clean up. */
async function withBytes<T>(bytes: Uint8Array, probe: (path: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-cli-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, bytes);
    return await probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run `probe` against a path that does not exist, inside a throwaway directory. */
async function withMissingPath<T>(probe: (path: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-cli-'));
  try {
    return await probe(join(directory, 'absent.a5er'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('a5er cli — help, version and usage', () => {
  it('prints help on stdout for --help and exits 0', async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--version');
    expect(result.stdout).toContain('inspect');
    expect(result.stdout).toContain('validate');
    expect(result.stdout).toContain('--format json');
    expect(result.stdout).toContain('Exit codes:');
  });

  it('names only the commands that exist', async () => {
    const result = await runCli(['--help']);

    for (const absent of ['tables', 'relations', 'search', 'export']) {
      expect(result.stdout).not.toContain(absent);
    }
  });

  it('prints the same help for -h', async () => {
    const long = await runCli(['--help']);
    const short = await runCli(['-h']);

    expect(short.code).toBe(0);
    expect(short.stdout).toBe(long.stdout);
  });

  it('prints the version on stdout for --version and exits 0', async () => {
    const result = await runCli(['--version']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('prints the version for -v', async () => {
    const result = await runCli(['-v']);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('prints help when invoked with no arguments', async () => {
    const result = await runCli([]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('rejects an unknown option with exit 2 and usage on stderr', async () => {
    const result = await runCli(['--nope']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('unknown option "--nope"');
    expect(result.stderr).toContain('Usage:');
  });

  it('rejects an unknown option even when --help is present', async () => {
    const result = await runCli(['--help', '--nope']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--nope');
  });

  it('quotes untrusted arguments instead of interpolating them raw', async () => {
    const result = await runCli(['--bad\ncontrol']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('"--bad\\ncontrol"');
  });

  it('ships a shebang so the bin entry installs as an executable', () => {
    const source = readFileSync(CLI_PATH, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});

describe('a5er cli — command-line misuse leaves stdout empty', () => {
  /** Every misuse arm returns 2, writes no stdout, and explains itself on stderr. */
  async function expectMisuse(args: readonly string[], expected: string): Promise<void> {
    const result = await runCli(args);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(expected);
    expect(result.stderr).toContain('Usage:');
  }

  it('rejects a command this build does not implement', async () => {
    await expectMisuse(['tables', '/tmp/never-read.a5er'], 'unknown command "tables"');
  });

  it('rejects a missing file operand', async () => {
    await expectMisuse(['inspect'], 'missing the file operand for inspect');
  });

  it('rejects more than one file operand', async () => {
    await expectMisuse(['inspect', 'a.a5er', 'b.a5er'], 'extra operand "b.a5er"');
  });

  it('rejects an empty file operand', async () => {
    await expectMisuse(['inspect', ''], 'the file operand is empty');
  });

  it('rejects an unsupported --format value', async () => {
    await expectMisuse(
      ['inspect', '--format', 'yaml', '/tmp/never-read.a5er'],
      'unsupported --format value "yaml"',
    );
  });

  it('rejects --format without a value', async () => {
    await expectMisuse(['inspect', '--format'], '--format requires a value');
  });

  it('rejects a badly spelled option even when the command looks valid', async () => {
    await expectMisuse(['inspect', '--formt', 'json', '/tmp/never-read.a5er'], 'unknown option');
  });
});

describe('a5er cli — inspect and validate streams and exit codes', () => {
  it('inspects a healthy file: one envelope on stdout, nothing on stderr, exit 0', async () => {
    await withStaged('fmt-01', async (path) => {
      const result = await runCli(['inspect', path]);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');

      const envelope = envelopeOf(result.stdout);
      expect(envelope.command).toBe('inspect');
      expect(envelope.status).toBe('ok');
      // The operand is echoed, never resolved (§12 `source.path`).
      expect(envelope.source?.path).toBe(path);
      // The read ran under the documented defaults, which is what omitting `limits` claims.
      expect(envelope.limits.maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
      expect(severityPairsOf(envelope)).toEqual(['V_VIEW_COLUMNS_UNKNOWN:info']);
    });
  });

  it('validates a healthy file: the same envelope, exit 0, nothing on stderr', async () => {
    await withStaged('fmt-01', async (path) => {
      const inspected = await runCli(['inspect', path]);
      const validated = await runCli(['validate', path]);

      expect(validated.code).toBe(0);
      expect(validated.stderr).toBe('');

      const envelope = envelopeOf(validated.stdout);
      expect(envelope.command).toBe('validate');
      expect(envelope.status).toBe('ok');
      expect(envelope.source?.path).toBe(path);

      // Only `command` differs: the same input serializes to the same facts.
      const inspectedEnvelope = envelopeOf(inspected.stdout);
      expect({ ...envelope, command: 'inspect' }).toEqual(inspectedEnvelope);
    });
  });

  it('accepts --format json before, between and after the operands', async () => {
    await withStaged('fmt-01', async (path) => {
      const baseline = await runCli(['inspect', path]);

      const variants: readonly (readonly string[])[] = [
        ['--format', 'json', 'inspect', path],
        ['inspect', '--format', 'json', path],
        ['inspect', path, '--format', 'json'],
      ];

      for (const args of variants) {
        const result = await runCli(args);
        expect(result.code).toBe(baseline.code);
        expect(result.stderr).toBe(baseline.stderr);
        expect(result.stdout).toBe(baseline.stdout);
      }
    });
  });

  it('puts the ten envelope fields in emission order with one trailing newline', async () => {
    await withStaged('fmt-01', async (path) => {
      const result = await runCli(['validate', path]);

      expect(result.code).toBe(0);
      expect(result.stdout.endsWith('}\n')).toBe(true);
      expect(result.stdout.match(/\n/g)).toHaveLength(1);

      const parsed: unknown = JSON.parse(result.stdout);
      expect(Object.keys(parsed as object)).toEqual([...ENVELOPE_KEYS]);
    });
  });

  it('keeps inspect at 0 while validate returns 3 for sem-08', async () => {
    await withStaged('sem-08', async (path) => {
      const inspected = await runCli(['inspect', path]);
      const validated = await runCli(['validate', path]);

      expect(inspected.code).toBe(0);
      expect(validated.code).toBe(3);

      const inspectedEnvelope = envelopeOf(inspected.stdout);
      const validatedEnvelope = envelopeOf(validated.stdout);
      expect(inspectedEnvelope.status).toBe('degraded');
      expect(validatedEnvelope.status).toBe('degraded');
      expect(severityPairsOf(validatedEnvelope)).toEqual([
        'V_DUPLICATE_OBJECT_NAME:error',
        'V_VIEW_COLUMNS_UNKNOWN:info',
      ]);

      // The error is prose on stderr in both runs; the exit code is what separates them.
      const prose = /^a5er: error: V_DUPLICATE_OBJECT_NAME: .+ \(line \d+\)\n$/;
      expect(inspected.stderr).toMatch(prose);
      expect(validated.stderr).toBe(inspected.stderr);
    });
  });

  it('keeps inspect at 0 while validate returns 3 for sem-09', async () => {
    await withStaged('sem-09', async (path) => {
      const inspected = await runCli(['inspect', path]);
      const validated = await runCli(['validate', path]);

      expect(inspected.code).toBe(0);
      expect(validated.code).toBe(3);
      expect(severityPairsOf(envelopeOf(validated.stdout))).toEqual([
        'V_MISSING_REQUIRED_KEY:error',
      ]);
      expect(validated.stderr).toMatch(/^a5er: error: V_MISSING_REQUIRED_KEY: .+\n$/);
    });
  });

  it('treats a warning-only degraded document as success for validate', async () => {
    await withStaged('val-09', async (path) => {
      const result = await runCli(['validate', path]);

      // §11's exit column: `error` is the validate trigger, `warning` is not.
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');

      const envelope = envelopeOf(result.stdout);
      expect(envelope.status).toBe('degraded');
      expect(severityPairsOf(envelope)).toEqual(['V_PK_ORDER_CONFLICT:warning']);
    });
  });

  it('emits the failed envelope and exits 1 for an unreadable path', async () => {
    await withMissingPath(async (path) => {
      for (const command of ['inspect', 'validate']) {
        const result = await runCli([command, path]);

        expect(result.code).toBe(1);

        const envelope = envelopeOf(result.stdout);
        expect(envelope.command).toBe(command);
        expect(envelope.status).toBe('failed');
        // A rejected read has no source, no schema and no counts (§12, §14 row 11).
        expect(envelope.source).toBeNull();
        expect(envelope.schema).toBeNull();
        expect(envelope.completeness).toBeNull();
        // A failed read is never a truncation: nothing partial leaves the reader.
        expect(envelope.limits.truncated).toBe(false);
        expect(severityPairsOf(envelope)).toEqual(['E_IO:fatal']);

        expect(result.stderr).toBe('a5er: fatal: E_IO: The input could not be read\n');
      }
    });
  });

  it('reports an undecodable input as E_UNDECODABLE with exit 1 and no schema', async () => {
    await withBytes(enc04.BYTES, async (path) => {
      const result = await runCli(['inspect', path]);

      expect(result.code).toBe(1);

      const envelope = envelopeOf(result.stdout);
      expect(envelope.status).toBe('failed');
      expect(envelope.source).toBeNull();
      expect(severityPairsOf(envelope)).toEqual(['E_UNDECODABLE:fatal']);
      expect(result.stderr).toBe(
        'a5er: fatal: E_UNDECODABLE: No supported encoding decodes the input without loss\n',
      );
    });
  });
});
