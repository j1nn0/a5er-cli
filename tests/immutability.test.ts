/**
 * imm-01 — input immutability (test-strategy §11, gate G-7, §14 row 14).
 *
 * §11 defines four invariants per invocation:
 *
 * 1. `sha256(stagedFile)` unchanged;
 * 2. `stat.size` and `stat.mtimeMs` unchanged;
 * 3. the file was opened read-only — asserted on POSIX by making the staged copy `chmod 0o444`
 *    before the baseline, so a write attempt fails loudly instead of succeeding quietly;
 * 4. no sibling temp file appears in the staging directory (`readdir` before/after).
 *
 * Two halves, both proven here now that stage 7 ships `inspect` and `validate`:
 *
 * - the *fixture* half: staging and reading a fixture satisfy all four;
 * - the *command* half: every shipped command, spawned for real against every committed synthetic
 *   fixture, satisfies all four — and still returns the exit code and status the catalog states.
 *
 * The sweep's oracle is deliberately narrow: the catalog's `status`/`exitCode`, the envelope's own
 * severities (§12's table), one JSON envelope on stdout and prose only on stderr. It does **not**
 * compare the envelope to a JSON golden and does not re-derive the diagnostic multiset — those
 * oracles live in `json-goldens.test.ts` and `validate-integration.test.ts`, and a second one here
 * would only mean two places to rot.
 *
 * The negative probes at the bottom mutate a staged copy's bytes, its `mtimeMs` and its directory
 * and require the guard to notice each one: a check that cannot fail is not a check.
 *
 * Windows: `chmod` is a no-op, so (3) cannot be asserted there; (1), (2) and (4) are asserted on
 * every platform, as §11 requires.
 *
 * Vitest runs suites serially by default and nothing here opts into concurrency, which is what
 * imm-01 needs: two invocations racing over one staging directory would prove nothing.
 */

import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonEnvelope } from '../src/json/index.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { sha256File, stage } from './helpers/stage.js';

/** §11: the read-only check is POSIX-only, because `chmod` is a no-op on Windows. */
const READ_ONLY_CHECK = process.platform !== 'win32';

/** Every committed text fixture: the synthetic class, staged under its real extension. */
const TEXT_FIXTURES = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');

/** The two commands this build ships; §11 sweeps every one of them, and there is no third. */
const SHIPPED_COMMANDS = ['inspect', 'validate'] as const;

/** Integer seconds, so a probe can put `mtimeMs` back exactly on every filesystem. */
const PINNED_SECONDS = 1_700_000_000;

/** The built CLI: the sweep spawns the shipped artefact, not the module (§2 L4/L5). */
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** §11's observables for one staged file, captured as one comparable value. */
interface FileSnapshot {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** Names in the staging directory; the staged copy is expected to be the only one. */
  readonly siblings: readonly string[];
}

function snapshotOf(path: string): FileSnapshot {
  const stats = statSync(path);
  return {
    sha256: sha256File(path),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    siblings: readdirSync(dirname(path)).sort(),
  };
}

/** Assert all four invariants of one snapshot pair, field by field for a readable failure. */
function expectUnchanged(before: FileSnapshot, after: FileSnapshot, label: string): void {
  expect(after.sha256, `${label}: sha256`).toBe(before.sha256);
  expect(after.size, `${label}: size`).toBe(before.size);
  expect(after.mtimeMs, `${label}: mtimeMs`).toBe(before.mtimeMs);
  expect(after.siblings, `${label}: siblings`).toEqual(before.siblings);
}

/**
 * Run the built CLI in a child process with a fixed environment so the run is
 * deterministic and offline (no network, no inherited locale or timezone).
 *
 * The same harness `tests/cli.test.ts` uses; it stays local so this file owns no shared state
 * with the stream-contract suite.
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

/** Parse the one envelope stdout may carry: a second document or a prose line fails here. */
function envelopeOf(stdout: string, label: string): JsonEnvelope {
  expect(stdout.endsWith('\n'), `${label}: stdout ends with a newline`).toBe(true);
  expect(stdout.slice(0, -1), `${label}: stdout is one line`).not.toContain('\n');

  const parsed: unknown = JSON.parse(stdout);
  expect(typeof parsed, `${label}: stdout is a JSON object`).toBe('object');
  return parsed as JsonEnvelope;
}

/** §12's exit table: `1` for a failed read, `3` only for `validate` with an `error` severity. */
function validateExitFor(envelope: JsonEnvelope): number {
  if (envelope.status === 'failed') return 1;
  return envelope.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 3 : 0;
}

/**
 * Assert stderr carries prose only — one line per `fatal`/`error` diagnostic, nothing else.
 *
 * The count comes from the envelope rather than from a hard-coded expectation, so a command that
 * started printing JSON, or a diagnostic that stopped being rendered, fails here.
 */
function expectProseOnly(stderr: string, envelope: JsonEnvelope, label: string): void {
  const loud = envelope.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'fatal' || diagnostic.severity === 'error',
  ).length;
  const lines = stderr === '' ? [] : stderr.slice(0, -1).split('\n');

  expect(stderr === '' || stderr.endsWith('\n'), `${label}: stderr ends a line`).toBe(true);
  expect(lines.length, `${label}: stderr line count`).toBe(loud);
  for (const line of lines) {
    expect(line, `${label}: stderr is prose`).toMatch(/^a5er: (?:fatal|error): [A-Z_]+: /);
  }
}

describe('imm-01 — fixture immutability', () => {
  it('has text fixtures to check', () => {
    // A class filter that silently matched nothing would make the sweep below vacuous.
    expect(TEXT_FIXTURES.length).toBeGreaterThan(0);
  });

  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: staging and reading leave the file untouched`, () => {
      const staged = stage(spec.id, { verifyBytes: true });
      try {
        const before = {
          sha256: staged.sha256,
          size: statSync(staged.path).size,
          mtimeMs: statSync(staged.path).mtimeMs,
        };
        const directory = dirname(staged.path);
        const siblingsBefore = readdirSync(directory).sort();

        // (3) POSIX: no write is possible, so any attempt to rewrite the input fails loudly.
        if (READ_ONLY_CHECK) chmodSync(staged.path, 0o444);
        const read = readFileSync(staged.path);
        expect(read.byteLength).toBe(before.size);

        // (1) sha256, (2) size and mtimeMs are unchanged by a read.
        expect(sha256File(staged.path)).toBe(before.sha256);
        expect(statSync(staged.path).size).toBe(before.size);
        expect(statSync(staged.path).mtimeMs).toBe(before.mtimeMs);

        // (4) nothing else appeared beside it.
        expect(readdirSync(directory).sort()).toEqual(siblingsBefore);
      } finally {
        staged.cleanup();
      }
      expect(existsSync(staged.path)).toBe(false);
    });
  }
});

describe('imm-01 — every shipped command leaves every text fixture untouched', () => {
  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: ${SHIPPED_COMMANDS.join(' and ')} leave the staged copy untouched`, async () => {
      const staged = stage(spec.id, { verifyBytes: true });
      const directory = dirname(staged.path);

      try {
        // (3) first, so the baseline is taken under the conditions the commands run in.
        if (READ_ONLY_CHECK) chmodSync(staged.path, 0o444);
        const before = snapshotOf(staged.path);

        for (const command of SHIPPED_COMMANDS) {
          const label = `${spec.id} ${command}`;
          const result = await runCli([command, staged.path]);

          // §12: the envelope is the oracle for `validate`'s code, the catalog for `inspect`'s.
          const envelope = envelopeOf(result.stdout, label);
          expect(envelope.command, `${label}: envelope command`).toBe(command);
          // Either arm proves the invocation reached *this* staged copy, never nothing at all:
          // a document read echoes the path and the bytes it hashed (§12), a rejected read has no
          // source at all (§14 row 11).
          if (envelope.status === 'failed') {
            expect(envelope.source, `${label}: a failed read has no source`).toBeNull();
          } else {
            expect(envelope.source?.path, `${label}: read the staged path`).toBe(staged.path);
            expect(envelope.source?.sha256, `${label}: read these bytes`).toBe(before.sha256);
          }
          expect(envelope.status, `${label}: status matches the catalog`).toBe(
            spec.expectation.status,
          );
          expect(result.code, `${label}: exit code`).toBe(
            command === 'inspect' ? spec.expectation.exitCode : validateExitFor(envelope),
          );
          expectProseOnly(result.stderr, envelope, label);

          // (1) sha256, (2) size and mtimeMs, (4) siblings — after every single invocation.
          expectUnchanged(before, snapshotOf(staged.path), label);
        }
      } finally {
        staged.cleanup();
      }

      // The harness removes what it created: the file, and the directory it lived in.
      expect(existsSync(staged.path), `${spec.id}: staged file removed`).toBe(false);
      expect(existsSync(directory), `${spec.id}: staging directory removed`).toBe(false);
    });
  }
});

describe('imm-01 — the guard has teeth', () => {
  it('detects a changed byte even when the length stays the same', () => {
    const staged = stage('fmt-01', { verifyBytes: true });
    try {
      const original = readFileSync(staged.path);
      const baseline = snapshotOf(staged.path);

      const mutated = Buffer.from(original);
      const last = mutated.length - 1;
      mutated.writeUInt8(mutated.readUInt8(last) ^ 0xff, last);
      writeFileSync(staged.path, mutated);

      const afterMutation = snapshotOf(staged.path);
      expect(afterMutation.size, 'byte probe: size is unchanged').toBe(baseline.size);
      expect(afterMutation.sha256, 'byte probe: sha256 must differ').not.toBe(baseline.sha256);

      // Putting the bytes back restores the hash exactly, so the guard returns to clean.
      writeFileSync(staged.path, original);
      expect(snapshotOf(staged.path).sha256, 'byte probe: restored').toBe(baseline.sha256);
    } finally {
      staged.cleanup();
    }
  });

  it('detects a changed mtime with the content untouched', () => {
    const staged = stage('fmt-01');
    try {
      // Pinned to whole seconds so the restore below is exact on every filesystem.
      utimesSync(staged.path, PINNED_SECONDS, PINNED_SECONDS);
      const baseline = snapshotOf(staged.path);

      utimesSync(staged.path, PINNED_SECONDS + 60, PINNED_SECONDS + 60);
      const afterMutation = snapshotOf(staged.path);
      expect(afterMutation.sha256, 'mtime probe: content is unchanged').toBe(baseline.sha256);
      expect(afterMutation.mtimeMs, 'mtime probe: mtimeMs must differ').not.toBe(baseline.mtimeMs);

      utimesSync(staged.path, PINNED_SECONDS, PINNED_SECONDS);
      expectUnchanged(baseline, snapshotOf(staged.path), 'mtime probe: restored');
    } finally {
      staged.cleanup();
    }
  });

  it('detects a sibling temp file with the input untouched', () => {
    const staged = stage('fmt-01');
    const sibling = join(dirname(staged.path), 'a5er-imm-probe.tmp');
    try {
      const baseline = snapshotOf(staged.path);

      writeFileSync(sibling, 'probe');
      const afterMutation = snapshotOf(staged.path);
      expect(afterMutation.sha256, 'sibling probe: content is unchanged').toBe(baseline.sha256);
      expect(afterMutation.mtimeMs, 'sibling probe: mtimeMs is unchanged').toBe(baseline.mtimeMs);
      expect(afterMutation.siblings, 'sibling probe: the listing must differ').not.toEqual(
        baseline.siblings,
      );

      rmSync(sibling);
      expectUnchanged(baseline, snapshotOf(staged.path), 'sibling probe: restored');
    } finally {
      staged.cleanup();
    }
  });
});
