/**
 * imm-01 — input immutability (test-strategy §11, gate G-7, §14 row 14).
 *
 * §11 defines four invariants per invocation: the staged file's sha256, size and
 * `mtimeMs` are unchanged, the file can be opened read-only (asserted on POSIX by making
 * it unwritable), and no sibling temp file appears in the directory.
 *
 * What exists today is the *fixture* half of that harness: staging and reading a fixture
 * must satisfy all four. The CLI half — every command against every text fixture — is
 * skipped with a TODO until the commands exist (architecture §18 stage 5); this unit does
 * not stub them, because a stub would report a green sweep over commands that do nothing.
 *
 * Vitest runs suites serially by default, which is what §9 requires for imm-01; nothing here
 * opts into concurrency.
 */

import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './helpers/fixture-registry.js';
import { sha256File, stage } from './helpers/stage.js';

/** §11: the read-only check is POSIX-only, because `chmod` is a no-op on Windows. */
const READ_ONLY_CHECK = process.platform !== 'win32';

/** Every committed text fixture: the synthetic class, staged under its real extension. */
const TEXT_FIXTURES = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');

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

  // TODO(PHASE2-imm-01): un-skip when `inspect`, `tables`, `relations`, `validate` and
  // `search` exist. The body reuses the four checks above per invocation against a staged
  // copy of every text fixture; §11 also requires `inspect` to be the read-only writer-free
  // path, which is why the sweep runs serially.
  it.skip('TODO(PHASE2-imm-01) leaves every text fixture untouched across every command', () => {
    // No commands exist yet (architecture §18 stage 5), and stubbing them would assert
    // immutability of a no-op. The harness above is the part that can be proven now.
  });
});
