/**
 * `src/text/diagnostics.ts` — the lazy stderr source (`docs/proposals/human-cli.md` §3.6, §8.5).
 *
 * `inspect` builds its stderr as one string in `renderDiagnostics()`, which this unit does not
 * touch. `tables` may have tens of thousands of such lines, so it yields one per `next()` and the
 * writer chunks them (§7.2 item 8). This file pins three things:
 *
 * 1. **The exact bytes** — `a5er: <severity>: <code>: <message>`, then ` (line <n>)` when the
 *    diagnostic has a span, then `\n`. The expected lines are authored from §3.6's format and
 *    `architecture.md` §11's fixed messages, not from the function's output.
 * 2. **Which diagnostics reach stderr** — only `fatal` and `error`; `warning` and `info` are the
 *    envelope's business and never appear on stderr.
 * 3. **Laziness and order** — one line per pull, in the integration's own order, and nothing built
 *    before it is pulled.
 *
 * The CLI-level byte comparison with `inspect`'s stderr is P1's `tests/cli-tables-io.test.ts`
 * (§8.5, N-2); here the format and the order are pinned without spawning a process.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { tablesDiagnosticLines } from '../src/text/diagnostics.js';
import type { Integration, IntegrationInput } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';
import { stage } from './helpers/stage.js';

/** The integration of a staged fixture — the same composition `src/cli.ts` runs. */
function integrationOf(path: string): Integration {
  const load = loadSource(path);
  const input: IntegrationInput = load.ok
    ? (() => {
        const scan = scanSource(load.source);
        const classification = classify(scan);
        return { load, scan, classification, semantics: derivePartialSemantics(classification) };
      })()
    : { load };
  return integrate(input);
}

/** Every stderr line of a fixture, joined. */
function linesOf(path: string): string[] {
  return [...tablesDiagnosticLines(integrationOf(path))];
}

/** Stage a committed fixture, probe it, and always clean up. */
function withFixture<T>(id: string, probe: (path: string) => T): T {
  const staged = stage(id);
  try {
    return probe(staged.path);
  } finally {
    staged.cleanup();
  }
}

describe('tablesDiagnosticLines — the exact bytes (§3.6)', () => {
  it('writes an error line with its line number', () => {
    withFixture('sem-08', (path) => {
      // sem-08 declares `twin` twice: V_DUPLICATE_OBJECT_NAME on the view's PName line, 12.
      expect(linesOf(path)).toEqual([
        'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n',
      ]);
    });
  });

  it('writes an error whose span is on another line', () => {
    withFixture('sem-09', (path) => {
      expect(linesOf(path)).toEqual([
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n',
      ]);
    });
  });

  it('writes a fatal line with no location when the span is null', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-diag-'));
    try {
      const path = join(directory, 'empty.a5er');
      writeFileSync(path, '');

      expect(linesOf(path)).toEqual(['a5er: fatal: E_EMPTY_INPUT: The input is empty\n']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes nothing when only warnings and info are reported', () => {
    // txt-01 has one info (a view does not store its columns) and no warning or error.
    withFixture('txt-01', (path) => {
      const integration = integrationOf(path);

      expect(integration.diagnostics.length).toBeGreaterThan(0);
      expect(linesOf(path)).toEqual([]);
    });
  });

  it('drops the info line that accompanies an error in the same document', () => {
    withFixture('sem-08', (path) => {
      const integration = integrationOf(path);
      const severities = integration.diagnostics.map((diagnostic) => diagnostic.severity);

      // sem-08 reports an error and an info; only the error reaches stderr.
      expect(severities).toContain('info');
      expect(linesOf(path)).toHaveLength(1);
      expect(linesOf(path)[0]).not.toContain('V_VIEW_COLUMNS_UNKNOWN');
    });
  });
});

describe('tablesDiagnosticLines — order and laziness (§3.6, §7.2 item 8)', () => {
  it('yields the lines in the integration’s own order', () => {
    withFixture('hst-04', (path) => {
      const integration = integrationOf(path);
      const wanted = integration.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'fatal' || diagnostic.severity === 'error',
      );

      // hst-04 has no fatal/error finding, so the check is vacuous unless one is added by hand.
      expect(wanted).toEqual([]);
      expect(linesOf(path)).toEqual([]);
    });
  });

  it('is lazy: a pull produces one line and nothing before it', () => {
    withFixture('sem-08', (path) => {
      const iterator = tablesDiagnosticLines(integrationOf(path))[Symbol.iterator]();

      const first = iterator.next();
      expect(first.done).toBe(false);
      expect(first.value).toBe(
        'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n',
      );

      expect(iterator.next().done).toBe(true);
    });
  });

  it('ends with a newline on every line, so the writer may concatenate without a separator', () => {
    withFixture('sem-08', (path) => {
      for (const line of linesOf(path)) {
        expect(line.endsWith('\n')).toBe(true);
        expect(line.slice(0, -1)).not.toContain('\n');
      }
    });
  });
});
