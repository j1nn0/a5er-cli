/**
 * `tests/cli-relations.test.ts` — `a5er relations`, end to end.
 *
 * One command, two formats, and the report in between. The cases are the ones this command exists
 * for: a relation whose endpoints resolve, a composite key's slot counts, a dangling endpoint, an
 * ambiguous one with its candidate count, an endpoint and a column list the section does not carry,
 * a present-but-empty list against an absent one, the `[Relationship]` alias, the three-valued
 * alignment column, a document with no relations at all, the escaping and the alignment cap, the
 * document's key order, and the failure paths every command with its own writer has (fatal read,
 * budget refusal, Phase A defect, Phase B defect, write failure).
 *
 * Documents are the committed synthetic fixtures where one reaches the case, and small synthetic
 * files written to a `mkdtemp` directory otherwise; committed fixtures are staged, never written to.
 * No test generates a large input, and none runs a shipped ceiling: the budget case injects a small
 * one through the command's own seam.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_BUDGETS } from '../src/budget/index.js';
import { CANNOT_WRITE_PREFIX, OUTPUT_GENERATION_FAILED_LINE } from '../src/io/stdout.js';
import type { OutputStream } from '../src/io/stdout.js';
import type { JsonRelationsEnvelope } from '../src/json/index.js';
import { createPipeline } from '../src/pipeline.js';
import { runRelationsCommand } from '../src/relations-command.js';
import type { IntegrationInput } from '../src/validate/index.js';
import { isLoadedInput } from '../src/validate/index.js';
import {
  RELATION_ENDPOINT_KEYS,
  RELATION_ROW_KEYS,
  RELATIONS_ENVELOPE_KEYS,
} from '../src/view/relations.js';
import { stage } from './helpers/stage.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the built CLI with a fixed environment. */
function runCli(args: readonly string[]): Promise<CliResult> {
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
        resolve({
          code,
          stdout: Buffer.from(stdout).toString('utf8'),
          stderr: Buffer.from(stderr).toString('utf8'),
        });
      },
    );
  });
}

/** Write one document, run `probe` over its path, and always clean up. */
async function withDocument<T>(
  lines: readonly string[],
  probe: (path: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-relations-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, lines.join('\n'), 'utf8');
    return await probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A committed synthetic fixture, staged as a disposable copy, removed whatever the test does. */
async function withFixture<T>(id: string, probe: (path: string) => Promise<T>): Promise<T> {
  const staged = stage(id);
  try {
    return await probe(staged.path);
  } finally {
    staged.cleanup();
  }
}

/** The header every small document needs: a BOM, a known format and one manager page. */
const HEADER = [
  '\ufeff# A5:ER FORMAT:21',
  '',
  '[Manager]',
  'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
];

/** The payload keys of `[Relation]` every document below has to carry to be complete. */
const RELATION_TAIL = [
  'RelationType1=2',
  'RelationType2=4',
  'Cardinarity1="P"',
  'Cardinarity2="Z"',
  'Position="Main",0,400,400,400,R,R,""',
];

/** One entity with the two columns the relations below map. */
function entitySection(name: string): string[] {
  return [
    '[Entity]',
    `PName="${name}"`,
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
    'Field="UserID","user_id","Integer","NOT NULL",1,"","",$FFFFFFFF,""',
    'Position="Main",10,10',
  ];
}

/** One relation with everything `[Relation]` requires, and the two sides given. */
function relationSection(
  name: string | null,
  entity1: string,
  entity2: string,
  fields1: string,
  fields2: string,
): string[] {
  return [
    '[Relation]',
    ...(name === null ? [] : [`PName="${name}"`]),
    `Entity1="${entity1}"`,
    `Entity2="${entity2}"`,
    `Fields1=${fields1}`,
    `Fields2=${fields2}`,
    ...RELATION_TAIL,
  ];
}

/** A clean document: two entities and one relation whose endpoints both resolve. */
const RESOLVED_DOCUMENT = [
  ...HEADER,
  '',
  ...entitySection('users'),
  '',
  ...entitySection('orders'),
  '',
  ...relationSection('r_users_orders', 'users', 'orders', '"id"', '"user_id"'),
];

/** The same bytes as text: one header row, one relation row, the legend and the diagnostics sum. */
const RESOLVED_TEXT = [
  '# status: ok',
  '# relations: 1',
  'IDX  SEC       NAME            EP1             EP2              C1  C2  CARD1  CARD2  ALIGN',
  '  4  Relation  r_users_orders  users resolved  orders resolved   1   1  P      Z      true',
  '# endpoint: the declared name, then resolved, dangling, or ambiguous (N candidates)',
  '# diagnostics: 0 (fatal 0, error 0, warning 0, info 0)',
  '',
].join('\n');

/** A deterministic stream for the command-level cases: every write succeeds. */
class FakeStream {
  readonly chunks: string[] = [];

  write(chunk: string, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(chunk);
    callback();
    return true;
  }

  once(): unknown {
    return undefined;
  }

  on(): unknown {
    return undefined;
  }

  off(): unknown {
    return undefined;
  }

  readonly errored: Error | null = null;
  readonly destroyed = false;
}

/** The fake satisfies the writer's structural type without a cast. */
function asOutputStream(stream: FakeStream): OutputStream {
  return stream;
}

/** A stream whose first write fails by callback: the writer's `74` outcome. */
function failingStream(): OutputStream {
  return {
    write(_chunk: string, callback: (error?: Error | null) => void): boolean {
      callback(new Error('EIO'));
      return true;
    },
    once(): unknown {
      return undefined;
    },
    on(): unknown {
      return undefined;
    },
    off(): unknown {
      return undefined;
    },
    errored: null,
    destroyed: false,
  };
}

/** A pipeline that always throws, standing in for a Phase A defect. */
function throwingPipeline(): IntegrationInput {
  throw new Error('/secret/path: file text');
}

/** The parsed document of one `--format json` run. */
function parseDocument(stdout: string): JsonRelationsEnvelope {
  return JSON.parse(stdout) as JsonRelationsEnvelope;
}

describe('a5er relations — text', () => {
  it('prints one row per relation with its endpoints, counts, cardinality and alignment', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      const result = await runCli(['relations', path]);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(RESOLVED_TEXT);
    });
  });

  it('keeps the three-valued alignment column, and a mismatch is a finding, not a failure', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('a'),
      '',
      ...relationSection('same', 'a', 'a', '"id"', '"user_id"'),
      '',
      ...relationSection('differs', 'a', 'a', '"id,user_id"', '"user_id"'),
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      // The status is severity-derived, and a count mismatch is a warning, not a failure.
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('# status: degraded');
      expect(result.stdout).toContain(
        '  3  Relation  same     a resolved  a resolved   1   1  P      Z      true',
      );
      expect(result.stdout).toContain(
        '  4  Relation  differs  a resolved  a resolved   2   1  P      Z      false',
      );
      expect(parsed.result?.map((row) => row.columnsAligned)).toEqual([true, false]);
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'V_FIELD_COUNT_MISMATCH',
      ]);
      expect(result.stdout).toContain('# diagnostics: 1 (fatal 0, error 0, warning 1, info 0)');
      // A warning finding is not repeated as prose: stderr stays empty for it.
      expect(result.stderr).toBe('');
    });
  });
});

describe('a5er relations — slot counts', () => {
  it('counts every slot of a composite key, including an empty one', async () => {
    // The committed composite fixture declares `Fields1="a,b"` and `Fields2="x,y"`.
    await withFixture('txt-03', async (path) => {
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);
      const row = parsed.result?.[0];

      expect(parsed.status).toBe('ok');
      expect(row?.fields1Count).toBe(2);
      expect(row?.fields2Count).toBe(2);
      expect(row?.columnsAligned).toBe(true);
    });
  });

  it('distinguishes a present-but-empty list from an absent one', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('a'),
      '',
      ...relationSection('empty', 'a', 'a', '""', '"user_id"'),
      '',
      ...relationSection('trailing', 'a', 'a', '"id,"', '"user_id"'),
      '',
      ...relationSection('absent', 'a', 'a', '"id"', '"user_id"').filter(
        (line) => !line.startsWith('Fields2='),
      ),
    ];

    await withDocument(document, async (path) => {
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);
      const rows = parsed.result ?? [];

      // `""` and `"id,"` are lists the file carries: one and two slots. The absent `Fields2` is
      // not a zero-length list — the answer is unknown, and so is the alignment.
      expect(rows.map((row) => row.fields1Count)).toEqual([1, 2, 1]);
      expect(rows[2]?.fields2Count).toBeNull();
      expect(rows[2]?.columnsAligned).toBeNull();
      expect(rows[0]?.columnsAligned).toBe(true);

      const text = await runCli(['relations', path]);
      expect(text.code).toBe(0);
      expect(text.stdout).toContain(
        '  5  Relation  absent    a resolved  a resolved   1  unknown  P      Z      unknown',
      );
      expect(text.stdout).toContain('# diagnostics: 2 (fatal 0, error 0, warning 2, info 0)');
    });
  });
});

describe('a5er relations — endpoint resolution', () => {
  it('reports a dangling endpoint and leaves the column unverified', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('users'),
      '',
      ...relationSection('r_ghost', 'users', 'ghost_table', '"id"', '"id"'),
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('ghost_table dangling');
      // A dangling endpoint is a warning, so stderr stays empty; the envelope carries the codes.
      expect(result.stderr).toBe('');
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'V_DANGLING_ENTITY',
        'V_DANGLING_COLUMN',
      ]);
      expect(parsed.result?.[0]?.to).toEqual({
        declared: 'ghost_table',
        status: 'dangling',
        candidates: 0,
        resolvedEntity: null,
      });
    });
  });

  it('reports an ambiguous endpoint with its candidate count and no diagnostic', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('dup'),
      '',
      ...entitySection('dup'),
      '',
      ...relationSection('r_dup', 'dup', 'dup', '"id"', '"id"'),
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('dup ambiguous (2 candidates)');
      expect(parsed.result?.[0]?.from).toEqual({
        declared: 'dup',
        status: 'ambiguous',
        candidates: 2,
        resolvedEntity: null,
      });
      // An ambiguous name is answered by `candidates`; the code set is the duplicate-name finding
      // alone, and no diagnostic was invented for the endpoint.
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'V_DUPLICATE_OBJECT_NAME',
      ]);
    });
  });

  it('reports a missing endpoint key as a missing record, never as a dangling name', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('users'),
      '',
      ...relationSection('r_half', 'users', 'users', '"id"', '"user_id"').filter(
        (line) => !line.startsWith('Entity2=') && !line.startsWith('Fields2='),
      ),
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);
      const row = parsed.result?.[0];

      expect(result.code).toBe(0);
      expect(row?.to).toBeNull();
      expect(row?.fields2Count).toBeNull();
      expect(row?.columnsAligned).toBeNull();
      expect(result.stdout).toContain('# diagnostics: 1 (fatal 0, error 0, warning 1, info 0)');
      // The absent keys are a required-key finding, not a dangling name and not a zero-length list.
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'V_MISSING_REQUIRED_KEY',
      ]);
      expect(result.stderr).toBe('');
    });
  });
});

describe('a5er relations — the alias and the empty document', () => {
  it('keeps [Relationship] as written, and lists both sections of the alias fixture', async () => {
    // `txt-02` declares one `[Relation]` and one `[Relationship]`: two sections, two relations.
    await withFixture('txt-02', async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);
      const rows = parsed.result ?? [];

      expect(result.code).toBe(0);
      expect(rows.map((row) => row.sectionHeader)).toEqual(['[Relation]', '[Relationship]']);
      expect(rows.map((row) => row.sectionIndex)).toEqual([4, 5]);
      expect(result.stdout).toContain('Relationship');
      // Both sides of each relation resolve, and both map one column.
      expect(rows.map((row) => row.columnsAligned)).toEqual([true, true]);
    });
  });

  it('answers a document with no relations with an empty list, not a missing one', async () => {
    const document = [...HEADER, '', ...entitySection('users')];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      expect(result.code).toBe(0);
      expect(parsed.status).toBe('ok');
      expect(parsed.result).toEqual([]);
      expect(result.stdout).toContain('# relations: 0');
      // No table at all: there is no row to print, and the header alone would be noise.
      expect(result.stdout).not.toContain('IDX');
    });
  });
});

describe('a5er relations — escaping and the alignment cap', () => {
  it('escapes a quoted name and a control character, and no raw TAB reaches the stream', async () => {
    const document = [
      ...HEADER,
      '',
      '[Entity]',
      'PName="tab\there"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      'Position="Main",10,10',
      '',
      ...relationSection('a"b', 'tab\there', 'tab\there', '"id"', '"id"'),
    ];

    await withDocument(document, async (path) => {
      const text = await runCli(['relations', path]);
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      expect(text.code).toBe(0);
      expect(text.stdout).toContain('"a\\"b"');
      expect(text.stdout).toContain('"tab\\u{0009}here" resolved');
      expect(text.stdout).not.toContain('\t');
      // The document keeps the decoded spellings; only the renderer escapes.
      expect(parsed.result?.[0]?.pname).toBe('a"b');
      expect(parsed.result?.[0]?.from?.declared).toBe('tab\there');
    });
  });

  it('writes a name past the alignment cap in full and never pads to its width', async () => {
    const longName = 'n'.repeat(60);
    const document = [
      ...HEADER,
      '',
      ...entitySection('users'),
      '',
      ...relationSection('a', 'users', 'users', '"id"', '"id"'),
      '',
      ...relationSection(longName, 'users', 'users', '"id"', '"id"'),
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['relations', path]);

      expect(result.code).toBe(0);
      // The short row sets the column width, so the header is a plain `NAME` cell.
      expect(result.stdout).toContain('NAME  EP1');
      // The long name is written in full and the next cell follows at the two-space separator.
      expect(result.stdout).toContain(`${longName}  users resolved`);
    });
  });
});

describe('a5er relations — json', () => {
  it('emits the shared ten members and this command’s result, in order', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);

      expect(Object.keys(parsed)).toEqual([...RELATIONS_ENVELOPE_KEYS]);
      expect(parsed.contractVersion).toBe('0.1.0');
      expect(parsed.command).toBe('relations');
      expect(parsed.status).toBe('ok');
      expect(parsed.source?.path).toBe(path);
      expect(parsed.completeness).not.toBeNull();
      expect(Object.keys(parsed.result?.[0] ?? {})).toEqual([...RELATION_ROW_KEYS]);
      expect(Object.keys(parsed.result?.[0]?.from ?? {})).toEqual([...RELATION_ENDPOINT_KEYS]);
      expect(parsed.result).toEqual([
        {
          sectionIndex: 4,
          sectionHeader: '[Relation]',
          pname: 'r_users_orders',
          from: { declared: 'users', status: 'resolved', candidates: 1, resolvedEntity: 'users' },
          to: { declared: 'orders', status: 'resolved', candidates: 1, resolvedEntity: 'orders' },
          fields1Count: 1,
          fields2Count: 1,
          relationType1: 2,
          relationType2: 4,
          cardinarity1: 'P',
          cardinarity2: 'Z',
          columnsAligned: true,
        },
      ]);
    });
  });

  it('keeps every unknown as null and never as zero or an empty string', async () => {
    const document = [
      ...HEADER,
      '',
      ...entitySection('users'),
      '',
      ...relationSection(null, 'users', 'users', '"id"', '"user_id"').filter(
        (line) =>
          !line.startsWith('Cardinarity') &&
          !line.startsWith('RelationType') &&
          !line.startsWith('Fields2='),
      ),
    ];

    await withDocument(document, async (path) => {
      const parsed = parseDocument((await runCli(['relations', '--format', 'json', path])).stdout);
      const row = parsed.result?.[0];

      expect(row?.pname).toBeNull();
      expect(row?.fields2Count).toBeNull();
      expect(row?.relationType1).toBeNull();
      expect(row?.relationType2).toBeNull();
      expect(row?.cardinarity1).toBeNull();
      expect(row?.cardinarity2).toBeNull();
      expect(row?.columnsAligned).toBeNull();
      expect(JSON.stringify(row)).not.toContain('undefined');
    });
  });

  it('answers a fatal read with the failed document and exit 1, in both formats', async () => {
    const json = await runCli([
      'relations',
      '--format',
      'json',
      '/tmp/a5er-definitely-missing.a5er',
    ]);
    const document = parseDocument(json.stdout);

    expect(json.code).toBe(1);
    expect(Object.keys(document)).toEqual([...RELATIONS_ENVELOPE_KEYS]);
    expect(document.status).toBe('failed');
    expect(document.source).toBeNull();
    expect(document.result).toBeNull();
    expect(document.completeness).toBeNull();
    expect(json.stderr).toContain('E_IO');

    // The text format keeps the framing of its format: no envelope, a failure note, exit 1.
    const text = await runCli(['relations', '/tmp/a5er-definitely-missing.a5er']);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('# status: failed');
    expect(text.stdout).toContain('# relations: none (status failed)');
    expect(text.stdout).not.toContain('IDX');
  });
});

describe('a5er relations — argv and exits', () => {
  it('accepts text as the default and json on request, and never exits 4', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      for (const args of [
        ['relations', path],
        ['relations', '--format', 'text', path],
        ['--format', 'text', 'relations', path],
        ['relations', '--format', 'json', path],
        ['relations', '--format', 'json', '--format', 'json', path],
      ]) {
        const result = await runCli(args);
        expect(result.code, args.join(' ')).toBe(0);
        expect(result.stdout, args.join(' ')).not.toBe('');
      }
    });
  });

  it('keeps relations’ operand errors at exit 2 with no stdout', async () => {
    const cases: Array<[readonly string[], string]> = [
      [['relations'], 'missing the file operand for relations'],
      [['relations', ''], 'the file operand is empty'],
      [['relations', 'a.a5er', 'extra'], 'extra operand "extra"; exactly one file is read'],
      [
        ['relations', '--format', 'yaml', 'x'],
        'unsupported --format value "yaml"; supported values are text and json',
      ],
    ];

    for (const [args, message] of cases) {
      const result = await runCli(args);
      expect(result.code, message).toBe(2);
      expect(result.stdout, message).toBe('');
      expect(result.stderr, message).toContain(`a5er: ${message}`);
      expect(result.stderr, message).toContain('a5er relations [--format text|json] <file>');
    }
  });
});

describe('a5er relations — failures and exits', () => {
  it('answers a budget refusal with exit 1 and the injected counter in the details', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      const stdout = new FakeStream();
      const stderr = new FakeStream();
      // One ceiling below the document's own content-line count: a real refusal, injected small.
      const pipeline = createPipeline({
        ...DEFAULT_RESOURCE_BUDGETS.tables,
        contentLineOccurrences: 1,
      });

      const code = await runRelationsCommand({
        path,
        format: 'json',
        stdout: asOutputStream(stdout),
        stderr: asOutputStream(stderr),
        pipeline,
      });
      const document = parseDocument(stdout.chunks.join(''));

      expect(code).toBe(1);
      expect(document.status).toBe('failed');
      expect(document.result).toBeNull();
      expect(document.diagnostics).toHaveLength(1);
      expect(document.diagnostics[0]?.details).toMatchObject({
        counter: 'contentLineOccurrences',
      });
      expect(stderr.chunks.join('')).toContain('E_LIMIT_BUDGET');
    });
  });

  it('turns a Phase A defect into exit 70 with nothing on stdout', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const codes: number[] = [];

    const code = await runRelationsCommand({
      path: '/tmp/never-read.a5er',
      format: 'text',
      stdout: asOutputStream(stdout),
      stderr: asOutputStream(stderr),
      pipeline: throwingPipeline,
      onPhaseACode: (phaseCode): void => {
        codes.push(phaseCode);
      },
    });

    expect(code).toBe(70);
    expect(codes).toEqual([70]);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join('')).toBe(OUTPUT_GENERATION_FAILED_LINE);
    expect(stderr.chunks.join('')).not.toContain('/secret/path');
  });

  it('turns a Phase B defect into exit 70, after the read code was reported', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      const base = createPipeline(DEFAULT_RESOURCE_BUDGETS.tables)(path);
      if (!isLoadedInput(base)) throw new Error('the document did not load');

      // `integrate()` reads `diagnostics` and `subtypes`, so Phase A still runs; only the
      // projection reads `relations`, and that read is what the trap refuses.
      const trapped: IntegrationInput = {
        ...base,
        semantics: new Proxy(base.semantics, {
          get(target, property, receiver): unknown {
            if (property === 'relations') throw new Error('/secret/path: file text');
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
      };

      const stdout = new FakeStream();
      const stderr = new FakeStream();
      const codes: number[] = [];

      const code = await runRelationsCommand({
        path,
        format: 'json',
        stdout: asOutputStream(stdout),
        stderr: asOutputStream(stderr),
        pipeline: () => trapped,
        onPhaseACode: (phaseCode): void => {
          codes.push(phaseCode);
        },
      });

      expect(code).toBe(70);
      // The read's code was set before the first write; the writer's answer replaces it.
      expect(codes).toEqual([0]);
      expect(stdout.chunks).toEqual([]);
      expect(stderr.chunks.join('')).toBe(OUTPUT_GENERATION_FAILED_LINE);
    });
  });

  it('turns a write failure into exit 74 after the read code is reported', async () => {
    await withDocument(RESOLVED_DOCUMENT, async (path) => {
      const stderr = new FakeStream();
      const codes: number[] = [];

      const code = await runRelationsCommand({
        path,
        format: 'text',
        stdout: failingStream(),
        stderr: asOutputStream(stderr),
        onPhaseACode: (phaseCode): void => {
          codes.push(phaseCode);
        },
      });

      expect(code).toBe(74);
      expect(codes).toEqual([0]);
      expect(stderr.chunks.join('')).toContain(CANNOT_WRITE_PREFIX);
    });
  });
});
