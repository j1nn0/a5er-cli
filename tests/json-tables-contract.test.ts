/**
 * `tests/json-tables-contract.test.ts` — the tables JSON document and the streaming encoder
 * (`docs/proposals/human-cli.md` §5.1–§5.9, §5.10, §8.4).
 *
 * What this file pins:
 *
 * 1. **Key sets, in order, at every level** — envelope, `result`, every row, every row `span`,
 *    every `columns`, `omitted` and `omitted.subtypes` — read back from the encoder's own bytes, so
 *    a key that `toTablesEnvelope` forgot (or spread in from the inspect envelope) shows up here.
 * 2. **`schema`/`result` exclusivity at run time** — the type system forbids assigning the wrong
 *    key, and this file checks the emitted documents have neither of the forbidden ones.
 * 3. **Status and null correlation** for the arms: `ok` (txt-01), `degraded` (sem-08), `failed` (an
 *    empty input), plus the zero-row, subtype-only and partial shapes.
 * 4. **K-4 / G-3** — the eight shared members equal the inspect envelope's, deeply and byte for
 *    byte, and `result` is the projection of the same `schema`.
 * 5. **B-5 equivalence** — `[...encodeJson(d)].join('')` equals `JSON.stringify(d, strictReplacer) +
 *    '\n'` for every stageable synthetic fixture, every byte fixture and every generated document.
 * 6. **§5.10's reachability argument** — no key a product document emits is long, so the
 *    temporary-string caveat cannot be reached from a file.
 *
 * Fixtures are staged as disposable copies; byte and generated fixtures are written to a `mkdtemp`
 * directory and removed in `finally`. No real `.a5er` export is read, and no expectation here comes
 * from the encoder: the expected bytes are `JSON.stringify`'s, and the key lists are §5.3's.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { JsonEnvelope, JsonTablesEnvelope } from '../src/json/index.js';
import {
  CONTRACT_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
  encodeJson,
  serialize,
} from '../src/json/index.js';
import { strictReplacer } from '../src/json/serialize.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import { toTablesEnvelope } from '../src/view/tables.js';
import {
  TABLE_COLUMNS_KEYS,
  TABLE_ROW_KEYS,
  TABLE_SPAN_KEYS,
  TABLES_ENVELOPE_KEYS,
  TABLES_OMITTED_KEYS,
  TABLES_OMITTED_SUBTYPES_KEYS,
  TABLES_RESULT_KEYS,
  projectTables,
} from '../src/view/tables.js';
import { GENERATED_BUILDERS } from './helpers/generated.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';
import { TABLE_EXPECTATIONS } from './helpers/tables-expectations.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';

/** §12's inspect/validate fields, in the order `serialize` constructs them. */
const INSPECT_KEYS = [
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

/** The built CLI, spawned so the contract is checked on the shipped artefact. */
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** §5.10's chunk bound, written out rather than taken from the module under test. */
const SPEC_CHUNK_LIMIT = 262_144;

/** The five byte fixtures, as modules, so every one of them reaches the encoder. */
const BYTE_FIXTURES = [enc03, enc04, enc05, hst02, hst05] as const;

/** The real four stages over a path — the same composition `src/cli.ts` runs. */
function envelopeOf(path: string): JsonEnvelope {
  const load = loadSource(path);
  if (!load.ok) return serialize({ load }, { command: 'inspect', path });
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return serialize(
    { load, scan, classification, semantics: derivePartialSemantics(classification) },
    { command: 'inspect', path },
  );
}

/** The encoded chunks of a tables document, in order. */
function chunksOf(document: JsonTablesEnvelope): string[] {
  return [...encodeJson(document)];
}

/** The encoded document as one string (a test may join what it is checking). */
function jsonOf(document: JsonTablesEnvelope): string {
  return chunksOf(document).join('');
}

/** The inspect envelope as one deterministic JSON string, for the absence and byte checks. */
function inspectJson(envelope: JsonEnvelope): string {
  return JSON.stringify(envelope, strictReplacer);
}

/** Every object key of a parsed document, at any depth. */
function keysAtAnyDepth(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysAtAnyDepth(item, into);
    return into;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.push(key);
      keysAtAnyDepth(child, into);
    }
  }
  return into;
}

/** Stage a committed synthetic fixture, probe it, and always clean up. */
function withFixture<T>(id: string, probe: (path: string) => T): T {
  const staged = stage(id);
  try {
    return probe(staged.path);
  } finally {
    staged.cleanup();
  }
}

/** Write files to a throwaway directory, probe every path, and always clean up. */
function withFiles<T>(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  probe: (paths: readonly string[]) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-json-'));
  try {
    const paths = files.map((file) => {
      const path = join(directory, file.name);
      writeFileSync(path, file.bytes);
      return path;
    });
    return probe(paths);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Write one document to a throwaway `.a5er` path, probe it, and always clean up. */
function withDocument<T>(content: string, probe: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-json-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, content, 'utf8');
    return probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The tables document of a path, parsed back from its own encoded bytes. */
function parsedTablesOf(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(jsonOf(toTablesEnvelope(envelopeOf(path))));
  return parsed as Record<string, unknown>;
}

describe('tables JSON — the §5.3 key sets, from the emitted bytes', () => {
  for (const id of ['txt-01', 'sem-08', 'sem-09']) {
    it(`emits every level of ${id} with exactly the §5.3 keys`, () => {
      withFixture(id, (path) => {
        const parsed = parsedTablesOf(path);

        expect(Object.keys(parsed)).toEqual([...TABLES_ENVELOPE_KEYS]);
        expect(Object.keys(parsed['tool'] as object)).toEqual(['name', 'version']);
        expect(Object.keys(parsed['source'] as object)).toEqual([
          'path',
          'sizeBytes',
          'sha256',
          'encoding',
          'format',
        ]);
        expect(Object.keys(parsed['limits'] as object)).toEqual(['maxBytes', 'truncated']);

        const result = parsed['result'] as Record<string, unknown>;
        expect(Object.keys(result)).toEqual([...TABLES_RESULT_KEYS]);
        expect(Object.keys(result['omitted'] as object)).toEqual([...TABLES_OMITTED_KEYS]);

        const subtypes = (result['omitted'] as Record<string, object>)['subtypes'] as object;
        expect(Object.keys(subtypes)).toEqual([...TABLES_OMITTED_SUBTYPES_KEYS]);

        for (const row of result['tables'] as readonly Record<string, unknown>[]) {
          expect(Object.keys(row)).toEqual([...TABLE_ROW_KEYS]);
          expect(Object.keys(row['span'] as object)).toEqual([...TABLE_SPAN_KEYS]);
          expect(Object.keys(row['columns'] as object)).toEqual([...TABLE_COLUMNS_KEYS]);
        }

        expect(parsed['command']).toBe('tables');
        expect(parsed['contractVersion']).toBe(CONTRACT_VERSION);
      });
    });
  }

  it('has no schema key at any level, and the inspect document has no result key', () => {
    withFixture('txt-01', (path) => {
      const tables = parsedTablesOf(path);
      const inspect = JSON.parse(inspectJson(envelopeOf(path))) as Record<string, unknown>;

      expect(Object.keys(tables)).not.toContain('schema');
      expect(keysAtAnyDepth(tables)).not.toContain('schema');
      expect(Object.keys(inspect)).toEqual([...INSPECT_KEYS]);
      expect(Object.keys(inspect)).not.toContain('result');
      expect(keysAtAnyDepth(inspect)).not.toContain('result');
    });
  });

  it('does not share a span object with the inspect envelope', () => {
    withFixture('sem-05', (path) => {
      const envelope = envelopeOf(path);
      const document = toTablesEnvelope(envelope);
      const row = document.result?.tables[0];

      // §5.3: the row's span is a copy of the object's four members, not the object's own span.
      expect(Object.keys(row?.span ?? {})).toEqual([...TABLE_SPAN_KEYS]);
      expect(row?.span).not.toBe(envelope.schema?.objects[0]?.span);
      expect(row?.span).toEqual(
        envelope.schema?.objects[0]?.span === undefined
          ? null
          : {
              sectionIndex: envelope.schema.objects[0]?.span.sectionIndex,
              startLine: envelope.schema.objects[0]?.span.startLine,
              endLine: envelope.schema.objects[0]?.span.endLine,
              keyLine: envelope.schema.objects[0]?.span.keyLine,
            },
      );
    });
  });
});

describe('tables JSON — status arms and their nulls (§5.6)', () => {
  it('emits the failed arm with source, result and completeness null', () => {
    withDocument('', (path) => {
      const parsed = parsedTablesOf(path);

      expect(parsed['status']).toBe('failed');
      expect(parsed['source']).toBeNull();
      expect(parsed['result']).toBeNull();
      expect(parsed['completeness']).toBeNull();
      expect(parsed['unsupported']).toEqual([]);
      expect((parsed['diagnostics'] as readonly Record<string, unknown>[])[0]?.['code']).toBe(
        'E_EMPTY_INPUT',
      );
      expect(Object.keys(parsed)).toEqual([...TABLES_ENVELOPE_KEYS]);
    });
  });

  it('emits the degraded arm with a result, a source and completeness', () => {
    withFixture('sem-08', (path) => {
      const parsed = parsedTablesOf(path);

      expect(parsed['status']).toBe('degraded');
      expect(parsed['source']).not.toBeNull();
      expect(parsed['result']).not.toBeNull();
      expect(parsed['completeness']).not.toBeNull();
    });
  });

  it('emits zero rows for a file with no objects, and no rows but a count for subtypes', () => {
    withFixture('sem-09', (path) => {
      const result = parsedTablesOf(path)['result'] as Record<string, unknown>;

      expect(result['objects']).toBe(0);
      expect(result['tables']).toEqual([]);
      expect(result['omitted']).toEqual({ subtypes: { count: 0, sectionIndexes: [] } });
    });

    withFixture('sem-05', (path) => {
      const result = parsedTablesOf(path)['result'] as Record<string, unknown>;

      expect(result['objects']).toBe(2);
      expect(result['tables']).toHaveLength(1);
      expect(result['omitted']).toEqual({ subtypes: { count: 1, sectionIndexes: [3] } });
    });
  });

  it('emits the partial arm for a document whose composition was withheld (§4.5)', () => {
    const document = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      'CommonField="作成日時","created_at","Timestamp",,,,"",$FFFFFFFF',
      '',
      '[Entity]',
      'PName="partial_one"',
      'UsingCommonColumns=2',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
    ].join('\n');

    withDocument(document, (path) => {
      const result = parsedTablesOf(path)['result'] as Record<string, unknown>;
      const row = (result['tables'] as readonly Record<string, unknown>[])[0];

      expect(row?.['columns']).toEqual({
        status: 'partial',
        reason: 'using-common-columns-unrecognised',
        declared: 1,
        common: null,
        effective: null,
        collisions: null,
      });
      expect(row?.['pname']).toBe('partial_one');
    });
  });

  it('emits unsupported evidence and both diagnostic lists verbatim', () => {
    withFixture('txt-04', (path) => {
      const envelope = envelopeOf(path);
      const parsed = parsedTablesOf(path);

      expect(parsed['unsupported']).toEqual(
        JSON.parse(JSON.stringify(envelope.unsupported, strictReplacer)) as unknown,
      );
      expect(parsed['diagnostics']).toEqual(
        JSON.parse(JSON.stringify(envelope.diagnostics, strictReplacer)) as unknown,
      );
      expect(parsed['unsupported'] as readonly unknown[]).toHaveLength(4);
      expect(parsed['status']).toBe('ok');
    });
  });
});

describe('tables JSON — the shared members and the projection (§5.5, K-4, G-3)', () => {
  it('deep-equals the inspect envelope without command and payload', () => {
    for (const id of ['txt-01', 'sem-08', 'val-08', 'hst-04', 'sem-09']) {
      withFixture(id, (path) => {
        const inspect = envelopeOf(path);
        const tables = toTablesEnvelope(inspect);

        const { command: inspectCommand, schema, ...inspectRest } = inspect;
        const { command: tablesCommand, result, ...tablesRest } = tables;

        expect(inspectCommand).toBe('inspect');
        expect(tablesCommand).toBe('tables');
        expect(schema !== null).toBe(result !== null);
        expect(tablesRest).toEqual(inspectRest);

        // Every shared member serialises to the same bytes too, one at a time (§5.5).
        for (const key of [
          'contractVersion',
          'tool',
          'status',
          'source',
          'limits',
          'unsupported',
          'diagnostics',
          'completeness',
        ] as const) {
          expect(JSON.stringify(tables[key], strictReplacer), `${id}.${key}`).toBe(
            JSON.stringify(inspect[key], strictReplacer),
          );
        }
      });
    }
  });

  it('projects the same schema with the settled projection', () => {
    for (const id of ['txt-01', 'sem-05', 'sem-07']) {
      withFixture(id, (path) => {
        const inspect = envelopeOf(path);
        const tables = toTablesEnvelope(inspect);
        if (inspect.schema === null || tables.result === null) {
          throw new Error(`${id} produced no schema`);
        }

        expect(tables.result).toEqual(projectTables(inspect.schema));
        expect(tables.result.objects).toBe(inspect.schema.objects.length);
        expect(tables.result.tables.length + tables.result.omitted.subtypes.count).toBe(
          tables.result.objects,
        );
      });
    }
  });

  it('keeps contractVersion at 0.1.0 for both commands (§5.9)', () => {
    withFixture('txt-01', (path) => {
      const inspect = envelopeOf(path);
      const tables = toTablesEnvelope(inspect);

      expect(CONTRACT_VERSION).toBe('0.1.0');
      expect(inspect.contractVersion).toBe('0.1.0');
      expect(tables.contractVersion).toBe('0.1.0');
    });
  });
});

describe('tables JSON — B-5 equivalence over every fixture', () => {
  it('matches JSON.stringify with strictReplacer for every stageable synthetic fixture', () => {
    for (const spec of FIXTURES) {
      if (spec.fixtureClass !== 'synthetic') continue;
      withFixture(spec.id, (path) => {
        const document = toTablesEnvelope(envelopeOf(path));
        const text = jsonOf(document);

        expect(text, spec.id).toBe(`${JSON.stringify(document, strictReplacer)}\n`);
        expect(text.slice(0, -1), spec.id).not.toContain('\n');
        // One document per invocation: the stream parses as one value plus the newline.
        expect(() => JSON.parse(text), spec.id).not.toThrow();
      });
    }
  });

  it('matches JSON.stringify for every byte fixture', () => {
    withFiles(
      BYTE_FIXTURES.map((fixture) => ({ name: `${fixture.ID}.a5er`, bytes: fixture.BYTES })),
      (paths) => {
        for (const [index, path] of paths.entries()) {
          const document = toTablesEnvelope(envelopeOf(path));

          expect(jsonOf(document), BYTE_FIXTURES[index]?.ID).toBe(
            `${JSON.stringify(document, strictReplacer)}\n`,
          );
        }
      },
    );
  });

  it('matches JSON.stringify for every generated document', () => {
    for (const [id, build] of Object.entries(GENERATED_BUILDERS)) {
      withFiles(build(), (paths) => {
        for (const path of paths) {
          const document = toTablesEnvelope(envelopeOf(path));

          expect(jsonOf(document), `${id}:${path}`).toBe(
            `${JSON.stringify(document, strictReplacer)}\n`,
          );
        }
      });
    }
  });

  it('keeps every chunk under the bound and never splits a surrogate pair', () => {
    for (const id of ['txt-01', 'hst-04', 'sem-08', 'sem-09']) {
      withFixture(id, (path) => {
        const chunks = chunksOf(toTablesEnvelope(envelopeOf(path)));

        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) {
          expect(chunk.length).toBeGreaterThan(0);
          expect(chunk.length).toBeLessThan(SPEC_CHUNK_LIMIT);
          const first = chunk.charCodeAt(0);
          const last = chunk.charCodeAt(chunk.length - 1);
          expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
          expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
        }
        expect(chunks.at(-1)?.endsWith('\n')).toBe(true);
      });
    }
  });
});

describe('tables JSON — what §5.10 cannot be reached with', () => {
  it('emits no key longer than a few dozen code units, from any fixture', () => {
    // §5.10's reachability argument: every key is a contract name or an array index, so the one
    // temporary string `strictReplacer` builds per value stays small for product input. Only the
    // generalized cases of `json-stream.test.ts` reach the long-key path.
    for (const id of ['txt-01', 'txt-04', 'hst-04', 'val-08', 'sem-07']) {
      withFixture(id, (path) => {
        const parsed: unknown = parsedTablesOf(path);
        for (const key of keysAtAnyDepth(parsed)) {
          expect(key.length, `${id}: ${key}`).toBeLessThanOrEqual(64);
        }
      });
    }
  });

  it('splits a 5,000-row document into several chunks, still byte-equal', () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => ({
      objectIndex: index,
      sectionIndex: 2,
      span: { sectionIndex: 2, startLine: 1, endLine: 1, keyLine: 1 },
      kind: 'entity' as const,
      pname: `table_${index}`,
      lname: null,
      columns: {
        status: 'complete' as const,
        reason: null,
        declared: 1,
        common: 0,
        effective: 1,
        collisions: 0,
      },
    }));

    // A hand-built document: the encoder only ever sees the document, not the pipeline.
    const document: JsonTablesEnvelope = {
      contractVersion: CONTRACT_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      command: 'tables',
      status: 'ok',
      source: {
        path: '/tmp/generated.a5er',
        sizeBytes: 0,
        sha256: '0'.repeat(64),
        encoding: { detected: 'utf-8', bom: false, declared: null, mismatch: false },
        format: { declared: 21, effective: 21, known: true },
      },
      limits: { maxBytes: 67_108_864, truncated: false },
      result: {
        objects: rows.length,
        tables: rows,
        omitted: { subtypes: { count: 0, sectionIndexes: [] } },
      },
      unsupported: [],
      diagnostics: [],
      completeness: {
        sections: { total: 1, parsed: 1, preservedRaw: 0, unknown: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
        lines: { total: 1, accounted: 1, dropped: 0 },
        dropped: 0,
      },
    };

    const chunks = [...encodeJson(document)];
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThan(SPEC_CHUNK_LIMIT);
    expect(chunks.join('')).toBe(`${JSON.stringify(document, strictReplacer)}\n`);
  });
});

/* ── the same key sets on the real CLI's stdout (§8.4, first two bullets) ──────────────────── */

/** Run the built CLI and return its stdout text, stderr text and exit code. */
function runCliRaw(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { encoding: 'utf8', timeout: 20_000, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
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

describe('tables JSON — the real CLI emits the §5.3 key sets (§8.4)', () => {
  it('emits the ok, degraded and failed arms with the right keys and no schema', async () => {
    const cases: readonly (readonly [string, 'ok' | 'degraded' | 'failed'])[] = [
      ['txt-01', 'ok'],
      ['sem-08', 'degraded'],
    ];

    for (const [id, status] of cases) {
      const staged = stage(id);
      try {
        const result = await runCliRaw(['tables', '--format', 'json', staged.path]);
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

        expect(result.code, id).toBe(0);
        expect(result.stderr, id).toBe(
          status === 'degraded'
            ? 'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n'
            : '',
        );
        expect(parsed['status']).toBe(status);
        expect(Object.keys(parsed)).toEqual([...TABLES_ENVELOPE_KEYS]);
        expect(parsed['command']).toBe('tables');
        expect(keysAtAnyDepth(parsed)).not.toContain('schema');

        const rowList = (parsed['result'] as Record<string, unknown>)['tables'] as readonly Record<
          string,
          unknown
        >[];
        for (const row of rowList) {
          expect(Object.keys(row)).toEqual([...TABLE_ROW_KEYS]);
          expect(Object.keys(row['columns'] as object)).toEqual([...TABLE_COLUMNS_KEYS]);
        }
        // One line plus the newline that ends it (§3.6).
        expect(result.stdout.endsWith('\n')).toBe(true);
        expect(result.stdout.slice(0, -1)).not.toContain('\n');
      } finally {
        staged.cleanup();
      }
    }
  });

  it('emits the failed arm for an empty input with the three nulls', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-cli-json-'));
    try {
      const path = join(directory, 'empty.a5er');
      writeFileSync(path, '');
      const result = await runCliRaw(['tables', '--format', 'json', path]);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

      expect(result.code).toBe(1);
      expect(result.stderr).toBe('a5er: fatal: E_EMPTY_INPUT: The input is empty\n');
      expect(parsed['status']).toBe('failed');
      expect(parsed['source']).toBeNull();
      expect(parsed['result']).toBeNull();
      expect(parsed['completeness']).toBeNull();
      expect(Object.keys(parsed)).toEqual([...TABLES_ENVELOPE_KEYS]);
      expect(keysAtAnyDepth(parsed)).not.toContain('schema');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps inspect and validate free of a result key (§8.4)', async () => {
    const staged = stage('txt-01');
    try {
      for (const command of ['inspect', 'validate']) {
        const result = await runCliRaw([command, staged.path]);
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

        expect(Object.keys(parsed), command).toEqual([...INSPECT_KEYS]);
        expect(keysAtAnyDepth(parsed), command).not.toContain('result');
      }
    } finally {
      staged.cleanup();
    }
  });
});

/* ── §8.4's "Result" bullet: the projection against the hand-derived table of §8.1 ──────────── */

describe('tables JSON — the result equals the §8.1 table derived from the fixture text', () => {
  /** The projected shape compared against the hand-derived row. */
  function comparableRows(path: string): unknown[] {
    const result = toTablesEnvelope(envelopeOf(path)).result;
    if (result === null) return [];
    return result.tables.map((table) => ({
      sectionIndex: table.sectionIndex,
      line: table.span.startLine,
      kind: table.kind,
      pname: table.pname,
      lname: table.lname,
      declared: table.columns.declared,
      common: table.columns.common,
      effective: table.columns.effective,
      reason: table.columns.reason,
    }));
  }

  /** Compare one fixture and record a failure by name instead of throwing out of the loop. */
  function check(id: string, path: string, failures: string[]): void {
    const expected = TABLE_EXPECTATIONS[id];
    if (expected === undefined) {
      failures.push(`${id}: no hand-derived expectation`);
      return;
    }

    const result = toTablesEnvelope(envelopeOf(path)).result;
    if (result === null) {
      if (expected.rows.length > 0) failures.push(`${id}: expected rows, got null`);
      return;
    }

    if (JSON.stringify(comparableRows(path)) !== JSON.stringify(expected.rows)) {
      failures.push(`${id}: rows differ`);
    }
    if (
      JSON.stringify(result.omitted.subtypes.sectionIndexes) !== JSON.stringify(expected.subtypes)
    ) {
      failures.push(`${id}: omitted subtypes differ`);
    }
    if (result.objects !== expected.rows.length + expected.subtypes.length) {
      failures.push(`${id}: objects ${String(result.objects)}`);
    }
  }

  it('matches every synthetic fixture, in row order, with its omitted subtypes', () => {
    const failures: string[] = [];

    for (const spec of FIXTURES) {
      if (spec.fixtureClass !== 'synthetic') continue;
      const staged = stage(spec.id);
      try {
        check(spec.id, staged.path, failures);
      } finally {
        staged.cleanup();
      }
    }

    expect(failures).toEqual([]);
  }, 120_000);

  it('matches every byte fixture, including the two rejected reads', () => {
    const failures: string[] = [];

    withFiles(
      BYTE_FIXTURES.map((fixture) => ({ name: `${fixture.ID}.a5er`, bytes: fixture.BYTES })),
      (paths) => {
        for (const [index, path] of paths.entries()) {
          const id = BYTE_FIXTURES[index]?.ID;
          if (id === undefined) continue;
          check(id, path, failures);
        }
      },
    );

    expect(failures).toEqual([]);
  }, 120_000);
});

/* ── K-4 on all 44 fixtures, through the real CLI (§5.5, §8.4) ─────────────────────────────── */

describe('tables JSON — K-4 on every fixture through the real CLI (§5.5)', () => {
  /** The eight members both shapes share, in §5.3 order. */
  const SHARED = [
    'contractVersion',
    'tool',
    'status',
    'source',
    'limits',
    'unsupported',
    'diagnostics',
    'completeness',
  ] as const;

  /**
   * Compare one fixture's two runs.
   *
   * Both documents are the CLI's own stdout, so this is the runtime proof that `tables` reports the
   * same shared members as `inspect` for the same bytes — deeply, and byte for byte per member.
   */
  async function compareShared(id: string, path: string, failures: string[]): Promise<void> {
    const inspect = await runCliRaw(['inspect', path]);
    const tables = await runCliRaw(['tables', '--format', 'json', path]);

    if (inspect.code !== tables.code && !(inspect.code === 0 && tables.code === 0)) {
      failures.push(`${id}: exit ${String(inspect.code)} vs ${String(tables.code)}`);
      return;
    }

    const inspectDocument = JSON.parse(inspect.stdout) as Record<string, unknown>;
    const tablesDocument = JSON.parse(tables.stdout) as Record<string, unknown>;

    if (tablesDocument['command'] !== 'tables') failures.push(`${id}: command`);
    if (inspectDocument['command'] !== 'inspect') failures.push(`${id}: inspect command`);
    if ('schema' in tablesDocument) failures.push(`${id}: schema key present`);
    if ('result' in inspectDocument) failures.push(`${id}: result key present`);

    for (const key of SHARED) {
      if (JSON.stringify(tablesDocument[key]) !== JSON.stringify(inspectDocument[key])) {
        failures.push(`${id}: ${key} differs`);
      }
    }

    // §5.6's null rules, from the CLI's own bytes.
    const failed = tablesDocument['status'] === 'failed';
    const nulls = [
      tablesDocument['source'] === null,
      tablesDocument['result'] === null,
      tablesDocument['completeness'] === null,
    ];
    if (failed && !nulls.every(Boolean)) failures.push(`${id}: failed arm has a non-null member`);
    if (!failed && nulls.some(Boolean)) failures.push(`${id}: read arm has a null member`);
  }

  it('matches for all 39 synthetic fixtures', async () => {
    const failures: string[] = [];

    for (const spec of FIXTURES) {
      if (spec.fixtureClass !== 'synthetic') continue;
      const staged = stage(spec.id);
      try {
        await compareShared(spec.id, staged.path, failures);
      } finally {
        staged.cleanup();
      }
    }

    expect(failures).toEqual([]);
  }, 300_000);

  it('matches for all 5 byte fixtures, the two rejected reads included', async () => {
    const failures: string[] = [];
    const directory = mkdtempSync(join(tmpdir(), 'a5er-k4-'));

    try {
      for (const fixture of BYTE_FIXTURES) {
        const path = join(directory, `${fixture.ID}.a5er`);
        writeFileSync(path, fixture.BYTES);
        await compareShared(fixture.ID, path, failures);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    expect(failures).toEqual([]);
  }, 300_000);
});
