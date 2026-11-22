/**
 * `tests/cli-tables-differential.test.ts` — the shipped CLI against the oracle, byte for byte
 * (`docs/proposals/human-cli.md` §2, §5.5, §8.4).
 *
 * **What it pins.** `a5er tables` used to be `toTablesEnvelope(serialize(input, …))`: the inspect
 * envelope, projected afterwards. It now builds the document from the stage results and one
 * `Integration` of them, with no inspect envelope in between. This file is the runtime proof that
 * the change is unobservable: for every registered fixture and for the shapes only a generated
 * document reaches, the CLI's stdout bytes are compared with the bytes the oracle would have
 * produced for the same staged file — both formats, no tolerance.
 *
 * **Why bytes, and not a parsed document.** `encodeJson` is `JSON.stringify`'s traversal, so
 * identical bytes mean identical key order, identical escaping, identical number spelling and the
 * same single trailing `\n`. A decoded comparison would hide all three; `Buffer.compare` hides
 * nothing, and a stray CRLF or a missing final LF cannot survive as U+FFFD.
 *
 * **What the expectations are derived from.** The oracle runs in this process over the same staged
 * copy, so nothing is copied from a golden and no golden changes. The stderr expectation is §3.6's
 * documented format (`a5er: <severity>: <code>: <message>[ (line <n>)]`) applied to the document's
 * own diagnostics, and the key lists are §5.3's, both written out in the test rather than read back
 * from the encoder.
 *
 * Fixtures are staged as disposable copies and removed in `finally`; the generated documents are
 * written to a `mkdtemp` directory and removed the same way.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { JsonTablesEnvelope } from '../src/json/index.js';
import { encodeJson, serialize } from '../src/json/index.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { renderTablesText } from '../src/text/index.js';
import {
  TABLE_COLUMNS_KEYS,
  TABLE_ROW_KEYS,
  TABLE_SPAN_KEYS,
  TABLES_ENVELOPE_KEYS,
  TABLES_OMITTED_KEYS,
  TABLES_OMITTED_SUBTYPES_KEYS,
  TABLES_RESULT_KEYS,
  toTablesEnvelope,
} from '../src/view/tables.js';
import type { IntegrationInput } from '../src/validate/index.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';

/** The built CLI, spawned so the bytes are the shipped artefact's. */
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** Generous for a batch of spawns on a slow runner; each spawn is one small file. */
const BATCH_TIMEOUT_MS = 300_000;

/** The five byte fixtures, as modules, so the two rejected reads reach the CLI too. */
const BYTE_FIXTURES = [enc03, enc04, enc05, hst02, hst05] as const;

/** The four stages over a path — the composition `src/cli.ts` runs before either document. */
function inputOf(path: string): IntegrationInput {
  const load = loadSource(path);
  if (!load.ok) return { load };
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

/** The document the pre-plan-B command produced: the inspect envelope, projected afterwards. */
function oracleDocumentOf(path: string): JsonTablesEnvelope {
  return toTablesEnvelope(serialize(inputOf(path), { command: 'inspect', path }));
}

/** The oracle's stdout for one format, as the bytes the CLI must reproduce. */
function expectedStdout(document: JsonTablesEnvelope, format: 'json' | 'text'): Buffer {
  const chunks = format === 'json' ? encodeJson(document) : renderTablesText(document);
  return Buffer.from([...chunks].join(''), 'utf8');
}

/**
 * The stderr bytes §3.6 requires for a document.
 *
 * One line per `fatal` or `error` diagnostic, in the document's own order; `warning` and `info`
 * never reach stderr. The format is the document's, not the renderer's: the test states it from
 * §3.6 so a renderer that stopped printing a code, a severity or a line number fails here.
 */
function expectedStderr(document: JsonTablesEnvelope): Buffer {
  const lines = document.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'fatal' || diagnostic.severity === 'error')
    .map((diagnostic) => {
      const where = diagnostic.span === null ? '' : ` (line ${String(diagnostic.span.startLine)})`;
      return `a5er: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}${where}\n`;
    });
  return Buffer.from(lines.join(''), 'utf8');
}

/** The exit code §3.7 gives a document: a failed read is `1`, every other status is `0`. */
function expectedExitCode(document: JsonTablesEnvelope): number {
  return document.status === 'failed' ? 1 : 0;
}

interface CliBytes {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

/** Run the built CLI and hand back raw bytes, not decoded text. */
function runCliBytes(args: readonly string[]): Promise<CliBytes> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'buffer',
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, TZ: 'UTC', LANG: 'C' },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
      },
    );
  });
}

/** Every §5.3 key list, read back from the CLI's own stdout. */
function keyOrderProblems(stdout: Buffer): string[] {
  const problems: string[] = [];
  const parsed = JSON.parse(stdout.toString('utf8')) as Record<string, unknown>;
  const same = (actual: readonly string[], expected: readonly string[], what: string): void => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${what}: ${actual.join(',')} != ${expected.join(',')}`);
    }
  };

  same(Object.keys(parsed), TABLES_ENVELOPE_KEYS, 'envelope');
  const result = parsed['result'];
  if (result === null) return problems;

  const shape = result as Record<string, unknown>;
  same(Object.keys(shape), TABLES_RESULT_KEYS, 'result');
  same(Object.keys(shape['omitted'] as object), TABLES_OMITTED_KEYS, 'omitted');
  same(
    Object.keys((shape['omitted'] as Record<string, object>)['subtypes'] as object),
    TABLES_OMITTED_SUBTYPES_KEYS,
    'omitted.subtypes',
  );
  for (const row of shape['tables'] as readonly Record<string, unknown>[]) {
    same(Object.keys(row), TABLE_ROW_KEYS, `row ${String(row['sectionIndex'])}`);
    same(
      Object.keys(row['span'] as object),
      TABLE_SPAN_KEYS,
      `row ${String(row['sectionIndex'])}.span`,
    );
    same(
      Object.keys(row['columns'] as object),
      TABLE_COLUMNS_KEYS,
      `row ${String(row['sectionIndex'])}.columns`,
    );
  }
  return problems;
}

/**
 * Compare one staged path: both formats, both streams, the exit code and the key order.
 *
 * `id` names the case in a failure; `label` is what the paths belong to (a fixture ID or a shape).
 */
async function compareCli(label: string, path: string, failures: string[]): Promise<void> {
  const document = oracleDocumentOf(path);
  const expectedJson = expectedStdout(document, 'json');
  const expectedText = expectedStdout(document, 'text');
  const expectedErr = expectedStderr(document);
  const expectedCode = expectedExitCode(document);

  const runs = [
    { format: 'json' as const, args: ['tables', '--format', 'json', path], stdout: expectedJson },
    { format: 'text' as const, args: ['tables', path], stdout: expectedText },
    // The default is text; the explicit flag must produce the identical bytes.
    { format: 'text' as const, args: ['tables', '--format', 'text', path], stdout: expectedText },
  ];

  for (const run of runs) {
    const result = await runCliBytes(run.args);
    if (result.code !== expectedCode) {
      failures.push(
        `${label} [${run.format}]: exit ${String(result.code)} != ${String(expectedCode)}`,
      );
    }
    if (Buffer.compare(result.stdout, run.stdout) !== 0) {
      failures.push(`${label} [${run.format}]: stdout bytes differ from the oracle`);
    }
    if (Buffer.compare(result.stderr, expectedErr) !== 0) {
      failures.push(`${label} [${run.format}]: stderr bytes differ from §3.6`);
    }
    // §5.3's key order is a fact about the JSON document only.
    if (run.format === 'json') {
      failures.push(...keyOrderProblems(result.stdout).map((problem) => `${label}: ${problem}`));
    }
  }
}

describe('a5er tables — the CLI reproduces the oracle byte for byte', () => {
  it(
    'matches on every synthetic fixture, both formats',
    async () => {
      const failures: string[] = [];

      for (const spec of FIXTURES) {
        if (spec.fixtureClass !== 'synthetic') continue;
        const staged = stage(spec.id);
        try {
          await compareCli(spec.id, staged.path, failures);
        } finally {
          staged.cleanup();
        }
      }

      expect(failures).toEqual([]);
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    'matches on every byte fixture, the two rejected reads included',
    async () => {
      const failures: string[] = [];
      const directory = mkdtempSync(join(tmpdir(), 'a5er-differential-'));

      try {
        for (const fixture of BYTE_FIXTURES) {
          const path = join(directory, `${fixture.ID}.a5er`);
          writeFileSync(path, fixture.BYTES);
          await compareCli(fixture.ID, path, failures);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }

      expect(failures).toEqual([]);
    },
    BATCH_TIMEOUT_MS,
  );
});

/* ── the shapes no committed fixture reaches (§8.6) ────────────────────────────────────────── */

/** A generated document, with the facts the case exists to state. */
interface GeneratedCase {
  readonly name: string;
  readonly path: string;
  readonly lines: readonly string[];
  /** Assertions about the document the CLI emitted, beyond byte identity. */
  readonly facts: (document: JsonTablesEnvelope) => void;
}

/**
 * The shapes only a written document can have, each a case `cli-tables-cases.test.ts` covers for
 * the text renderer and this file covers for the bytes.
 *
 * The first three are order and name edge cases; the rest are the column arms and the two evidence
 * families (`Shape`/`Line`/`Comment`, an unsupported `Position`). Every fact is derived from the
 * specification — §4.5, §4.9, §9.4, §13 — not from an earlier run.
 */
function generatedCases(): GeneratedCase[] {
  const header = [
    '\ufeff# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
  ];

  return [
    {
      name: 'declaration-order-swap',
      path: 'subtype-view-entity.a5er',
      lines: [
        ...header,
        '',
        '[Subtype]',
        'PName="s_first"',
        'Position="Main",10,10',
        '',
        '[View]',
        'PName="v_second"',
        'Query="SELECT 1"',
        'Position="Main",20,20',
        '',
        '[Entity]',
        'PName="e_third"',
        'UsingCommonColumns=0',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",30,30',
      ],
      facts: (document) => {
        const result = document.result;
        if (result === null) throw new Error('no result');
        // §4.9: the subtype is object 0 and gets no row, so the rows are 1 and 2 — not 0 and 1.
        expect(result.objects).toBe(3);
        expect(result.tables.map((row) => row.objectIndex)).toEqual([1, 2]);
        expect(result.tables.map((row) => row.kind)).toEqual(['view', 'entity']);
        expect(result.tables.map((row) => row.sectionIndex)).toEqual([3, 4]);
        expect(result.omitted.subtypes).toEqual({ count: 1, sectionIndexes: [2] });
      },
    },
    {
      name: 'names-absent-and-empty',
      path: 'unnamed.a5er',
      lines: [
        ...header,
        '',
        '[Entity]',
        'LName="名前のない表"',
        'UsingCommonColumns=0',
        'Position="Main",10,10',
        '',
        '[Entity]',
        'PName=""',
        'UsingCommonColumns=0',
        'Position="Main",20,20',
      ],
      facts: (document) => {
        const rows = document.result?.tables ?? [];
        // Absent is `null`; a declared empty name stays `''` (§5.3, §4.7).
        expect(rows.map((row) => row.pname)).toEqual([null, '']);
        expect(rows.map((row) => row.lname)).toEqual(['名前のない表', null]);
      },
    },
    {
      name: 'unterminated-name-kept-whole',
      path: 'unterminated-name.a5er',
      lines: [
        ...header,
        '',
        '[Entity]',
        'PName="good"',
        'PName="bad',
        'UsingCommonColumns=0',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10',
      ],
      facts: (document) => {
        const row = document.result?.tables[0];
        // Last-wins (§4.2): the terminal `PName` is the answer, and a value the quoting rules cannot
        // close is kept as the text it is — `"bad`, not dropped and not repaired. The earlier
        // readable name is never resurrected in its place (R26); the duplication is reported as a
        // diagnostic, and the span still reports the most specific line the section has.
        expect(row?.pname).toBe('"bad');
        expect(row?.span.startLine).toBe(8);
        expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          'S_DUPLICATE_KEY',
        );
      },
    },
    {
      name: 'partial-entity',
      path: 'partial-entity.a5er',
      lines: [
        ...header,
        'CommonField="作成日時","created_at","Timestamp",,,,"",$FFFFFFFF',
        '',
        '[Entity]',
        'PName="partial_one"',
        'UsingCommonColumns=2',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10',
      ],
      facts: (document) => {
        expect(document.result?.tables[0]?.columns).toEqual({
          status: 'partial',
          reason: 'using-common-columns-unrecognised',
          declared: 1,
          common: null,
          effective: null,
          collisions: null,
        });
      },
    },
    {
      name: 'common-column-collision',
      path: 'collision.a5er',
      lines: [
        ...header,
        'CommonField="共通","shared_name","String",,,,"",$FFFFFFFF',
        '',
        '[Entity]',
        'PName="collides"',
        'UsingCommonColumns=1',
        'Field="A","shared_name","String",,,,"",$FFFFFFFF,"",""',
        'Field="B","b","String",,,,"",$FFFFFFFF,"",""',
        'Position="Main",10,10',
      ],
      facts: (document) => {
        // §9.4: the composed list is declared then common, and a repeated physical name is
        // counted once per occurrence, with `collisions` reporting the repeat.
        expect(document.result?.tables[0]?.columns).toEqual({
          status: 'complete',
          reason: null,
          declared: 2,
          common: 1,
          effective: 3,
          collisions: 1,
        });
      },
    },
    {
      name: 'shape-line-comment-sections',
      path: 'unmodelled.a5er',
      lines: [
        ...header,
        '',
        '[Shape]',
        'PName="shape_1"',
        'ShapeType="Rectangle"',
        'Position="Main",10,10',
        '',
        '[Line]',
        'PName="line_1"',
        'Position="Main",20,20',
        '',
        '[Comment]',
        'PName="note_1"',
        'Position="Main",30,30',
        'Width=10',
        'Height=5',
      ],
      facts: (document) => {
        // §4.5: these three kinds are recognised but have no collection, so their declarations are
        // evidence, not rows (§13). None of them is an object.
        expect(document.result).toEqual({
          objects: 0,
          tables: [],
          omitted: { subtypes: { count: 0, sectionIndexes: [] } },
        });
        const kinds = new Set(document.unsupported.map((record) => record.sectionKind));
        for (const kind of ['Shape', 'Line', 'Comment'] as const) {
          expect(kinds.has(kind), kind).toBe(true);
        }
        const reasons = new Set(document.unsupported.map((record) => record.reason));
        // §13's evidence reasons: the section and its keys are outside the resolved model, and a
        // `Position` on these three kinds has no documented shape at all (§4.1.3).
        expect([...reasons].sort()).toEqual([
          'key-not-in-resolved-model',
          'section-not-in-resolved-model',
          'shape-not-documented',
        ]);
      },
    },
    {
      name: 'unsupported-position',
      path: 'unsupported-position.a5er',
      lines: [
        ...header,
        '',
        '[Entity]',
        'PName="four_elements"',
        'UsingCommonColumns=0',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10,5',
      ],
      facts: (document) => {
        // §P11 allows 3 or 5 elements; a 4-element position is an unsupported record, not a guess.
        const unsupported = document.unsupported.filter(
          (record) => record.kind === 'unsupported-position',
        );
        expect(unsupported).toHaveLength(1);
        expect(unsupported[0]?.reason).toBe('unexpected-element-count');
        expect(unsupported[0]?.span.sectionIndex).toBe(2);
      },
    },
  ];
}

describe('a5er tables — the generated shapes, byte for byte', () => {
  it(
    'reproduces the oracle for every shape only a written document has',
    async () => {
      const cases = generatedCases();
      const failures: string[] = [];
      const directory = mkdtempSync(join(tmpdir(), 'a5er-differential-shapes-'));

      try {
        for (const generated of cases) {
          const path = join(directory, generated.path);
          writeFileSync(path, generated.lines.join('\n'), 'utf8');

          await compareCli(generated.name, path, failures);

          // The case is only worth its name if it states its own fact: assert it on the oracle, whose
          // bytes the CLI has just matched, so the fact and the bytes cannot drift apart.
          const document = oracleDocumentOf(path);
          try {
            generated.facts(document);
          } catch (error) {
            failures.push(`${generated.name}: ${String(error)}`);
          }
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }

      expect(failures).toEqual([]);
    },
    BATCH_TIMEOUT_MS,
  );
});
