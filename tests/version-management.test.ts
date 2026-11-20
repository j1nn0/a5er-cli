import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PACKAGE_VERSION, VERSION_PLACEHOLDER } from './helpers/package-version.js';

/**
 * The version tooling as a gate — one source of truth, one checker, one guarded bump.
 *
 * `release:check` is run against this checkout: the invariant (manifest version format, `VERSION` and
 * `TOOL_VERSION` equality, the golden placeholder, `CONTRACT_VERSION` independence, and no hardcoded
 * package version left in `src/` or `tests/`) is defined once in `scripts/lib/version.mjs`, so this test
 * runs that implementation instead of restating it and `pnpm test` fails on drift without a second CI
 * step.
 *
 * `release:prepare` is run against throwaway roots built by `makeRoot()` and reached through
 * `A5ER_RELEASE_ROOT`, so a bump — including every failure path — is exercised without touching this
 * checkout. Each case asserts the bytes that must survive as well as the exit status: a refusal that
 * modified a file would be the very bug these tests exist for.
 *
 * The golden sweep in `json-goldens.test.ts` is the other half: it compares the envelope against each
 * golden with `tool.version` expanded to the manifest version, which is what catches a `TOOL_VERSION`
 * that no longer matches `package.json`. `json-contract.test.ts` pins the same constants from the
 * library side.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHECKER = fileURLToPath(new URL('../scripts/release-check.mjs', import.meta.url));
const PREPARER = fileURLToPath(new URL('../scripts/release-prepare.mjs', import.meta.url));

/**
 * The version this checkout prepares from, and the next patch. Both are derived rather than written
 * out: `release:check` rejects a test file that spells the current version, and a test that hardcoded
 * the next one would block that release in turn.
 */
const CURRENT = PACKAGE_VERSION;
const [major = 0, minor = 0, patch = 0] = CURRENT.split('.').map((part) => Number(part));
const NEXT = `${major}.${minor}.${patch + 1}`;

/** The smallest tree the version scripts accept: three version surfaces and one golden. */
const BASE_FILES: Readonly<Record<string, string>> = {
  'package.json': `{\n  "name": "@j1nn0/a5er-cli",\n  "version": "${CURRENT}"\n}\n`,
  'src/index.ts': `export const VERSION = '${CURRENT}';\n`,
  'src/json/envelope.ts': `export const TOOL_VERSION = '${CURRENT}';\n\nexport const CONTRACT_VERSION = '0.1.0';\n`,
  'tests/fixtures/json-goldens/one.expected.json': `{\n  "contractVersion": "0.1.0",\n  "tool": {\n    "name": "@j1nn0/a5er-cli",\n    "version": "${VERSION_PLACEHOLDER}"\n  }\n}\n`,
};

const roots: string[] = [];

function makeRoot(overrides: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'a5er-prepare-'));
  roots.push(root);
  for (const [relativePath, text] of Object.entries({ ...BASE_FILES, ...overrides })) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Every file under `root`, keyed by repository-relative path. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path).split('\\').join('/')] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return files;
}

function fileOf(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function versionIn(root: string): unknown {
  return (JSON.parse(fileOf(root, 'package.json')) as { version?: unknown }).version;
}

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runScript(
  script: string,
  args: readonly string[],
  options: { readonly root?: string; readonly env?: Readonly<Record<string, string>> } = {},
): Run {
  const env: Record<string, string | undefined> = { ...process.env, ...options.env };
  delete env['A5ER_RELEASE_ROOT'];
  if (options.root !== undefined) env['A5ER_RELEASE_ROOT'] = options.root;
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function prepare(
  root: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Run {
  return runScript(PREPARER, args, env === undefined ? { root } : { root, env });
}

describe('version management — release:check', () => {
  it('reports a consistent set of version surfaces and exits 0', () => {
    const result = runScript(CHECKER, [], { root: ROOT });
    if (result.status !== 0) {
      throw new Error(
        `release:check exited ${String(result.status)}:\n${result.stdout}${result.stderr}`,
      );
    }

    expect(result.stdout).toContain('version check: ok');
    expect(result.stdout).toContain('golden(s), tool.version "<package-version>"');
    expect(result.stdout).toContain('CONTRACT_VERSION 0.1.0 (independent of the package version)');
    expect(result.stdout).toContain('CONTRACT_VERSION 0.1.0 (independent of the package version)');
    expect(result.stdout).not.toContain('lockfile');
  });

  it('leaves every file untouched when preflight validation fails', () => {
    const root = makeRoot();
    const before = snapshot(root);

    const downgrade = prepare(root, ['0.0.0']);
    expect(downgrade.status).toBe(1);
    expect(downgrade.stderr).toContain(`refusing to move backwards: ${CURRENT} -> 0.0.0`);

    const malformed = prepare(root, ['0.1']);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('not a usable version');
    expect(malformed.stderr).toContain('must be a stable X.Y.Z');

    expect(snapshot(root)).toEqual(before);
  });

  it('restores what it had written when a write fails unexpectedly', () => {
    const root = makeRoot();
    const before = snapshot(root);

    // package.json is written first, so a failure on the next file leaves something to restore.
    const result = prepare(root, [NEXT], { A5ER_RELEASE_FAIL_WRITE: 'src/index.ts' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('writing src/index.ts failed');
    expect(result.stderr).toContain('restored: package.json');
    expect(result.stderr).not.toContain('still modified');
    expect(snapshot(root)).toEqual(before);
  });

  it('restores the failing target when a write partially modifies it', () => {
    const root = makeRoot();
    const before = snapshot(root);

    // The seam stores a truncated prefix before throwing, standing in for a real write that
    // fails after modifying its target. Recovery must notice the difference and restore it.
    const result = prepare(root, [NEXT], { A5ER_RELEASE_FAIL_WRITE: 'src/index.ts:partial' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('writing src/index.ts failed');
    expect(result.stderr).toContain('restored: package.json, src/index.ts');
    expect(result.stderr).not.toContain('still modified');
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses to write anything when the goldens already disagree', () => {
    // A hardcoded number is not the placeholder drift gate's business: it spells neither the
    // current nor the target version, so only the pre-write consistency check can refuse it.
    const root = makeRoot({
      'tests/fixtures/json-goldens/one.expected.json':
        '{\n  "contractVersion": "0.1.0",\n  "tool": {\n    "name": "@j1nn0/a5er-cli",\n    "version": "9.9.9"\n  }\n}\n',
    });
    const before = snapshot(root);

    const result = prepare(root, [NEXT]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the version surfaces already disagree');
    expect(snapshot(root)).toEqual(before);
  });

  it('accepts the largest safe integer and rejects components that would round', () => {
    // Boundary versions are constructed, never spelled out: this file is scanned for hardcoded
    // versions, so a literal large version here would block preparing exactly that version.
    const safeTop = `${Number.MAX_SAFE_INTEGER}.0.0`;
    const justOver = (offset: bigint): string => `${BigInt(Number.MAX_SAFE_INTEGER) + offset}.0.0`;
    const accepted = makeRoot();
    const bumped = prepare(accepted, [safeTop]);
    expect(bumped.status).toBe(0);
    expect(versionIn(accepted)).toBe(safeTop);

    const rejected = makeRoot();
    const rejectedBefore = snapshot(rejected);
    for (const target of [justOver(1n), justOver(2n)]) {
      const result = prepare(rejected, [target]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('safe integer');
      expect(snapshot(rejected)).toEqual(rejectedBefore);
    }

    // 2^53 + 1 has the same double as 2^53, so a numeric comparison alone would read it as
    // an upgrade from the largest safe integer; the range check refuses it before any comparison.
    const atBoundary = makeRoot({
      'package.json': `{\n  "name": "@j1nn0/a5er-cli",\n  "version": "${safeTop}"\n}\n`,
      'src/index.ts': `export const VERSION = '${safeTop}';\n`,
      'src/json/envelope.ts': `export const TOOL_VERSION = '${safeTop}';\n\nexport const CONTRACT_VERSION = '0.1.0';\n`,
    });
    const atBoundaryBefore = snapshot(atBoundary);
    const rounded = prepare(atBoundary, [justOver(1n)]);
    expect(rounded.status).toBe(1);
    expect(rounded.stderr).toContain('safe integer');
    expect(snapshot(atBoundary)).toEqual(atBoundaryBefore);
  });

  it('refuses a bump while another file spells out a version it would stale or collide with', () => {
    const stale = makeRoot({ 'src/other.ts': `export const PINNED = '${CURRENT}';\n` });
    const staleBefore = snapshot(stale);
    const blockedByStale = prepare(stale, [NEXT]);
    expect(blockedByStale.status).toBe(1);
    expect(blockedByStale.stderr).toContain('src/other.ts');
    expect(blockedByStale.stderr).toContain('would leave it stale');
    expect(snapshot(stale)).toEqual(staleBefore);

    const colliding = makeRoot({ 'tests/pinned.test.ts': `export const TARGET = '${NEXT}';\n` });
    const collidingBefore = snapshot(colliding);
    const blockedByTarget = prepare(colliding, [NEXT]);
    expect(blockedByTarget.status).toBe(1);
    expect(blockedByTarget.stderr).toContain('tests/pinned.test.ts');
    expect(blockedByTarget.stderr).toContain('the version being prepared');
    expect(snapshot(colliding)).toEqual(collidingBefore);
  });

  it('rejects commented-out, duplicated and non-literal declarations', () => {
    const commented = makeRoot({
      'src/index.ts': `/*\nexport const VERSION = '${CURRENT}';\n*/\n`,
    });
    const commentedBefore = snapshot(commented);
    const commentedResult = prepare(commented, [NEXT]);
    expect(commentedResult.status).toBe(1);
    expect(commentedResult.stderr).toContain(
      'VERSION is only mentioned inside a comment or string',
    );
    expect(snapshot(commented)).toEqual(commentedBefore);

    const duplicated = makeRoot({
      'src/json/envelope.ts': `export const TOOL_VERSION = '${CURRENT}';\nexport const TOOL_VERSION = '${CURRENT}';\n\nexport const CONTRACT_VERSION = '0.1.0';\n`,
    });
    const duplicatedBefore = snapshot(duplicated);
    const duplicatedResult = prepare(duplicated, [NEXT]);
    expect(duplicatedResult.status).toBe(1);
    expect(duplicatedResult.stderr).toContain('TOOL_VERSION is declared 2 times');
    expect(snapshot(duplicated)).toEqual(duplicatedBefore);

    const computed = makeRoot({
      'src/index.ts': `const BASE = '${CURRENT}';\nexport const VERSION = BASE;\n`,
    });
    const computedBefore = snapshot(computed);
    const computedResult = prepare(computed, [NEXT]);
    expect(computedResult.status).toBe(1);
    expect(computedResult.stderr).toContain('not a plain single-quoted string literal');
    expect(snapshot(computed)).toEqual(computedBefore);

    const missing = makeRoot({ 'src/index.ts': 'const BASE = 1;\n' });
    const missingBefore = snapshot(missing);
    const missingResult = prepare(missing, [NEXT]);
    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toContain('VERSION is not declared');
    expect(snapshot(missing)).toEqual(missingBefore);
  });

  it('ignores a commented-out copy of the declaration and rewrites only the live line', () => {
    const source = `/*\nexport const VERSION = '0.0.9';\n*/\nexport const VERSION = '${CURRENT}';\n`;
    const root = makeRoot({ 'src/index.ts': source });

    const result = prepare(root, [NEXT]);

    expect(result.status).toBe(0);
    expect(fileOf(root, 'src/index.ts')).toBe(
      `/*\nexport const VERSION = '0.0.9';\n*/\nexport const VERSION = '${NEXT}';\n`,
    );
  });

  it('refuses a bump when a carrying file spells the version outside its declaration', () => {
    const pinnedIndex = makeRoot({
      'src/index.ts': `export const VERSION = '${CURRENT}';\nexport const PINNED = '${CURRENT}';\n`,
    });
    const pinnedIndexBefore = snapshot(pinnedIndex);
    const blockedIndex = prepare(pinnedIndex, [NEXT]);
    expect(blockedIndex.status).toBe(1);
    expect(blockedIndex.stderr).toContain('src/index.ts');
    expect(blockedIndex.stderr).toContain('would leave it stale');
    expect(snapshot(pinnedIndex)).toEqual(pinnedIndexBefore);

    const pinnedEnvelope = makeRoot({
      'src/json/envelope.ts': `export const TOOL_VERSION = '${CURRENT}';\nexport const PINNED = '${CURRENT}';\n\nexport const CONTRACT_VERSION = '0.1.0';\n`,
    });
    const pinnedEnvelopeBefore = snapshot(pinnedEnvelope);
    const blockedEnvelope = prepare(pinnedEnvelope, [NEXT]);
    expect(blockedEnvelope.status).toBe(1);
    expect(blockedEnvelope.stderr).toContain('src/json/envelope.ts');
    expect(blockedEnvelope.stderr).toContain('would leave it stale');
    expect(snapshot(pinnedEnvelope)).toEqual(pinnedEnvelopeBefore);

    const future = makeRoot({
      'src/index.ts': `export const VERSION = '${CURRENT}';\n// will become ${NEXT} after review\n`,
    });
    const futureBefore = snapshot(future);
    const blockedFuture = prepare(future, [NEXT]);
    expect(blockedFuture.status).toBe(1);
    expect(blockedFuture.stderr).toContain('src/index.ts');
    expect(blockedFuture.stderr).toContain('the version being prepared');
    expect(snapshot(future)).toEqual(futureBefore);
  });

  it('ignores declaration-like text inside template literals', () => {
    const shadowed = makeRoot({
      'src/index.ts': `const doc = \`\nexport const VERSION = '9.9.9';\n\`;\nexport const VERSION = '${CURRENT}' as const;\n`,
    });
    const shadowedBefore = snapshot(shadowed);
    const shadowedResult = prepare(shadowed, [NEXT]);
    expect(shadowedResult.status).toBe(1);
    expect(shadowedResult.stderr).toContain('not a plain single-quoted string literal');
    expect(snapshot(shadowed)).toEqual(shadowedBefore);

    const duplicated = makeRoot({
      'src/index.ts': `export const VERSION = '${CURRENT}';\nexport const VERSION = '${CURRENT}' as const;\n`,
    });
    const duplicatedBefore = snapshot(duplicated);
    const duplicatedResult = prepare(duplicated, [NEXT]);
    expect(duplicatedResult.status).toBe(1);
    expect(duplicatedResult.stderr).toContain(
      'VERSION has an additional non-plain declaration on line 2',
    );
    expect(snapshot(duplicated)).toEqual(duplicatedBefore);

    // An unsupported duplicate with an unrelated version escapes the drift scan (it spells neither
    // the current nor the target version), so declaration detection itself must reject it.
    const foreign = makeRoot({
      'src/index.ts': `export const VERSION = '${CURRENT}';\nexport const VERSION = '9.9.9' as const;\n`,
    });
    const foreignBefore = snapshot(foreign);
    const foreignResult = prepare(foreign, [NEXT]);
    expect(foreignResult.status).toBe(1);
    expect(foreignResult.stderr).toContain(
      'VERSION has an additional non-plain declaration on line 2',
    );
    expect(snapshot(foreign)).toEqual(foreignBefore);
  });

  it('ignores a template-literal copy of the declaration and rewrites only the live line', () => {
    const source = `const doc = \`\nexport const VERSION = '0.0.9';\n\`;\nexport const VERSION = '${CURRENT}';\n`;
    const root = makeRoot({ 'src/index.ts': source });

    const result = prepare(root, [NEXT]);

    expect(result.status).toBe(0);
    expect(fileOf(root, 'src/index.ts')).toBe(
      `const doc = \`\nexport const VERSION = '0.0.9';\n\`;\nexport const VERSION = '${NEXT}';\n`,
    );

    const nested = `const doc = \`a\${flag ? \`b\nexport const VERSION = '9.9.9';\n\` : 'c'}d\`;\nexport const VERSION = '${CURRENT}';\n`;
    const nestedRoot = makeRoot({ 'src/index.ts': nested });
    const nestedResult = prepare(nestedRoot, [NEXT]);
    expect(nestedResult.status).toBe(0);
    // Only the live line moves; the nested template survives byte-identical.
    expect(fileOf(nestedRoot, 'src/index.ts')).toBe(
      nested.replace(`export const VERSION = '${CURRENT}';`, `export const VERSION = '${NEXT}';`),
    );
  });

  it('prepares a bump once, reports it, and stays idempotent', () => {
    const root = makeRoot();
    const first = prepare(root, [NEXT]);

    expect(first.status).toBe(0);
    const afterFirst = snapshot(root);
    expect(versionIn(root)).toBe(NEXT);
    expect(fileOf(root, 'src/index.ts')).toBe(`export const VERSION = '${NEXT}';\n`);
    expect(fileOf(root, 'src/json/envelope.ts')).toBe(
      `export const TOOL_VERSION = '${NEXT}';\n\nexport const CONTRACT_VERSION = '0.1.0';\n`,
    );
    expect(first.stdout).toContain(`release:prepare: ${CURRENT} -> ${NEXT}`);
    expect(first.stdout).toContain('this command never tags, pushes or publishes');
    expect(first.stdout).not.toContain('tagging, pushing and publishing stay manual');

    const second = prepare(root, [NEXT]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(`already at ${NEXT}; nothing to change`);
    expect(snapshot(root)).toEqual(afterFirst);
  });
});
