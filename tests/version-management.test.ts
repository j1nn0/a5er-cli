import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `pnpm release:check` as a gate — the version surfaces have one source of truth and one checker.
 *
 * The invariant is defined in `scripts/lib/version.mjs` (manifest version format, `VERSION` and
 * `TOOL_VERSION` equality, the golden placeholder, `CONTRACT_VERSION` independence, lockfile
 * consistency, and no hardcoded package version left in `src/` or `tests/`). This test runs that one
 * implementation rather than restating it, so `pnpm test` fails on drift without a second CI step and
 * without a second, subtly different copy of the rules.
 *
 * The golden sweep in `json-goldens.test.ts` is the other half: it compares the envelope against each
 * golden with `tool.version` expanded to the manifest version, which is what catches a `TOOL_VERSION`
 * that no longer matches `package.json`. `json-contract.test.ts` pins the same constants from the
 * library side.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHECKER = fileURLToPath(new URL('../scripts/release-check.mjs', import.meta.url));

describe('version management — release:check', () => {
  it('reports a consistent set of version surfaces and exits 0', () => {
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, [CHECKER], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; status?: number };
      throw new Error(
        `release:check exited ${String(failure.status)}:\n${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      );
    }

    expect(stdout).toContain('version check: ok');
    expect(stdout).toContain('golden(s), tool.version "<package-version>"');
    expect(stdout).toContain('CONTRACT_VERSION 0.1.0 (independent of the package version)');
    expect(stdout).toContain('consistent with package.json');
  });
});
