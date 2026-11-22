/**
 * `tests/cli-large-diagnostics.test.ts` — a document whose findings and attributes are counted in
 * the hundreds of thousands (F4-B1a).
 *
 * The envelope factory and the registry accumulate diagnostics with `push(...arr)` in four places.
 * A spread passes every element as one argument, so the accumulators that collect a whole section's
 * findings — `decodeSection`'s result into `classify`'s list, and `jsonAttributes` into
 * `jsonManagerAttributes` — overflowed the stack at roughly 10^5 entries instead of emitting them.
 * The two cases below build such a document and pin the whole observable contract of the run: exit
 * `0`, empty stderr, one parseable envelope, the exact diagnostic count, and the file order of the
 * spans. Pre-fix both runs died with `RangeError: Maximum call stack size exceeded` and wrote no
 * envelope at all, so a case that passes here is the regression guard.
 *
 * Every input is synthetic and generated here; nothing is committed and no fixture is involved.
 *
 * **No wall-clock assertion and no stack-size flag.** The cases are slow by construction (one is a
 * 10 MB document with 200,000 findings), so each spawned child carries its own limit and is killed
 * when it fires. The limit exists to turn a hang into a failed case with a message, not to assert
 * how fast the tool is.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonEnvelope } from '../src/json/index.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The per-child limit these cases give themselves; a fired limit fails the case, not the suite. */
const CHILD_TIMEOUT_MS = 120_000;

/** The vitest limit for one case, above the child's, so the child's message wins. */
const CASE_TIMEOUT_MS = 180_000;

/** `Field` elements this build defines (§7.2); one more than this is `S_FIELD_TOO_MANY_ELEMENTS`. */
const FIELD_MAX_ELEMENTS = 10;

/** Findings per case: enough to pass the argument limit of a spread by a wide margin. */
const CASES = 200_000;

/** The header every generated document carries, so only the case's own findings are counted. */
const HEADER = ['# A5:ER FORMAT:21', '# A5:ER ENCODING:UTF8', ''];

/** The `[Manager]` block a document needs before its first object (`PageInfo` is required). */
const MANAGER = ['[Manager]', 'PageInfo="Main",3,"A4Landscape","$FFFFFF"', ''];

/** Write a document to a throwaway directory and run `probe`, always cleaning up. */
async function withDocument<T>(content: string, probe: (path: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-large-'));
  try {
    const path = join(directory, 'large.a5er');
    writeFileSync(path, content, 'utf8');
    return await probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run `a5er inspect` to completion and return its stdout bytes, stderr text and exit code. */
function runInspect(
  path: string,
  timeoutMs: number = CHILD_TIMEOUT_MS,
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, 'inspect', path],
      {
        encoding: 'buffer',
        timeout: timeoutMs,
        // The entity case's envelope measures about 410 MB (200,000 fields, 200,000 findings), so
        // the default 1 MiB is far too small and the sibling suite's 128 MiB is not enough either.
        maxBuffer: 512 * 1024 * 1024,
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

/**
 * One `[Entity]` whose every `Field` declares one element too many.
 *
 * `decodeField` reports exactly one `S_FIELD_TOO_MANY_ELEMENTS` per such line and the line stays a
 * field, so the section's decoding accumulates one finding per line — the array the spread passed
 * to `push`. The rest of the entity is complete, so no other finding is reported and stderr stays
 * empty (only fatal and error-severity findings are written there).
 */
function entityFieldsDocument(count: number): string {
  const lines = [...HEADER, ...MANAGER, '[Entity]', 'PName="e"', 'LName="label"'];
  const elements = Array.from({ length: FIELD_MAX_ELEMENTS + 1 }, (_, index) =>
    String.fromCharCode('a'.charCodeAt(0) + index),
  );
  const field = `Field=${elements.map((element) => `"${element}"`).join(',')}`;
  for (let index = 0; index < count; index += 1) lines.push(field);
  lines.push('Position="Main",10,10', '');
  return lines.join('\n');
}

/**
 * One `[Manager]` that repeats a registered scalar far beyond what a settings block would hold.
 *
 * `ProjectName` is document-scoped and non-repeatable, so every repetition after the first is one
 * `S_DUPLICATE_KEY` warning and every occurrence is kept as an attribute — the list
 * `jsonManagerAttributes` spread into its accumulator. Warnings never reach stderr.
 */
function managerKeysDocument(count: number): string {
  const lines = [...HEADER, '[Manager]', 'PageInfo="Main",3,"A4Landscape","$FFFFFF"'];
  for (let index = 0; index < count; index += 1) lines.push('ProjectName="p"');
  lines.push('');
  return lines.join('\n');
}

/** Run a generated document and return the timeline of what the CLI did. */
async function runDocument(
  content: string,
): Promise<{ code: number; stderr: string; envelope: JsonEnvelope }> {
  return withDocument(content, async (path) => {
    const result = await runInspect(path);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    return {
      code: result.code,
      stderr: result.stderr,
      envelope: JSON.parse(result.stdout.toString('utf8')) as JsonEnvelope,
    };
  });
}

describe('large finding and attribute counts', () => {
  it(
    'reports 200,000 findings of one entity in file order',
    { timeout: CASE_TIMEOUT_MS },
    async () => {
      const { envelope } = await runDocument(entityFieldsDocument(CASES));
      const diagnostics = envelope.diagnostics;

      // One `D_BOM_MISSING` info for the document, then one finding per `Field` line.
      expect(diagnostics).toHaveLength(CASES + 1);
      expect(diagnostics[0]?.code).toBe('D_BOM_MISSING');
      expect(diagnostics[0]?.span).toBeNull();
      expect(diagnostics.slice(1).map((diagnostic) => diagnostic.code)).toEqual(
        Array.from({ length: CASES }, () => 'S_FIELD_TOO_MANY_ELEMENTS'),
      );

      // `[Entity]` is line 7, so its first `Field` is line 10 and the last is `CASES + 9`.
      const lines = diagnostics.slice(1).map((diagnostic) => diagnostic.span?.startLine);
      expect(lines[0]).toBe(10);
      expect(lines.at(-1)).toBe(CASES + 9);
      expect(lines.every((line, index) => line === 10 + index)).toBe(true);

      expect(envelope.status).toBe('degraded');
      expect(envelope.schema?.objects).toHaveLength(1);
    },
  );

  it('keeps 200,000 attributes of one Manager section', { timeout: CASE_TIMEOUT_MS }, async () => {
    const { envelope } = await runDocument(managerKeysDocument(CASES));
    const diagnostics = envelope.diagnostics;

    // One `D_BOM_MISSING` info, then one duplicate finding for every repetition after the first.
    expect(diagnostics).toHaveLength(CASES);
    expect(diagnostics[0]?.code).toBe('D_BOM_MISSING');
    expect(diagnostics[0]?.span).toBeNull();
    expect(diagnostics.slice(1).map((diagnostic) => diagnostic.code)).toEqual(
      Array.from({ length: CASES - 1 }, () => 'S_DUPLICATE_KEY'),
    );

    // `[Manager]` is line 4 and `PageInfo` line 5, so the `ProjectName` lines are 6..`CASES + 5`
    // and the first one that duplicates the earlier value is line 7.
    const lines = diagnostics.slice(1).map((diagnostic) => diagnostic.span?.startLine);
    expect(lines[0]).toBe(7);
    expect(lines.at(-1)).toBe(CASES + 5);
    expect(lines.every((line, index) => line === 7 + index)).toBe(true);

    // Every occurrence is kept, duplicates included: nothing is collapsed into one attribute.
    expect(envelope.schema?.manager.attributes).toHaveLength(CASES);
    expect(envelope.status).toBe('degraded');
    expect(envelope.schema?.objects).toHaveLength(0);
  });
});
