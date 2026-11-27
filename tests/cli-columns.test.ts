/**
 * `tests/cli-columns.test.ts` — `a5er columns`, end to end.
 *
 * One command, two formats, and the selection rule in between. The cases are the ones this command
 * exists for: an entity's effective list in order with declared/composed sources and collision
 * flags, a view that has no columns to list, an entity whose common-column opt-in cannot be decided,
 * the three selection failures (missing, duplicated, subtype), and the failure paths every command
 * with its own writer has (fatal read, budget refusal, generation defect, write failure).
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
import { runColumnsCommand } from '../src/columns-command.js';
import { CANNOT_WRITE_PREFIX, OUTPUT_GENERATION_FAILED_LINE } from '../src/io/stdout.js';
import type { OutputStream } from '../src/io/stdout.js';
import type { JsonColumnsEnvelope } from '../src/json/index.js';
import { createPipeline } from '../src/pipeline.js';
import type { IntegrationInput } from '../src/validate/index.js';
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
  const directory = mkdtempSync(join(tmpdir(), 'a5er-columns-'));
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

/** One entity with two declared fields and no common columns. */
const PLAIN_DOCUMENT = [
  ...HEADER,
  '',
  '[Entity]',
  'PName="t"',
  'LName="Things"',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
  'Field="Name","name","Varchar(100)","NOT NULL",1,"","",$FFFFFFFF,""',
  'Position="Main",10,10',
];

/**
 * The same document with a common field, an entity that adopts it (and collides on `id`), an entity
 * whose opt-in is undecidable, a view, a subtype and one name declared twice.
 */
const MIXED_DOCUMENT = [
  ...HEADER,
  'CommonField="共通ID","id","Integer","NOT NULL","0","","","$FFFFFFFF"',
  '',
  '[Entity]',
  'PName="with_common"',
  'UsingCommonColumns=1',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
  'Field="名前","name","Varchar(100)","NOT NULL",1,"","",$FFFFFFFF,""',
  'Position="Main",10,10',
  '',
  '[Entity]',
  'PName="partial_one"',
  'UsingCommonColumns=2',
  'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
  'Position="Main",20,20',
  '',
  '[View]',
  'PName="v1"',
  'Query="select 1"',
  'Position="Main",30,30',
  '',
  '[Subtype]',
  'PName="s1"',
  'SharedMode=0',
  '',
  '[Entity]',
  'PName="same"',
  'Field="A","a","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
  'Position="Main",40,40',
  '',
  '[View]',
  'PName="same"',
  'Query="select 2"',
  'Position="Main",50,50',
];

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

describe('a5er columns — text', () => {
  it('prints the declared list of one entity, its totals and the reviewed notes', async () => {
    await withDocument(PLAIN_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 't']);

      // `id` (2 cells) and `name` (4) widen PNAME to its 5-cell header; LNAME is `ID`/`Name`, so
      // the two name columns are 5 cells wide and each row is 1 + 2 + 5 + 2 + 5 + 2 + 3 + 2 + 4.
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(
        [
          '# status: ok',
          '# object: entity t (section 2, line 7)',
          'N  PNAME  LNAME  SRC  COLL',
          '1  id     ID     D    -',
          '2  name   Name   D    -',
          '# columns: 2 (declared 2, common 0)',
          '# using common columns: 1 (defaulted; the key is absent)',
          '# diagnostics: 0 (fatal 0, error 0, warning 0, info 0)',
          '',
        ].join('\n'),
      );
    });
  });

  it('marks composed columns C, flags a collision, and states the declared opt-in', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 'with_common']);

      expect(result.code).toBe(0);
      // LNAME widens to `共通ID` (6 cells), so `ID` and `名前` are padded to that width.
      expect(result.stdout).toContain('1  id     ID      D    !');
      expect(result.stdout).toContain('2  name   名前    D    -');
      expect(result.stdout).toContain('3  id     共通ID  C    !');
      expect(result.stdout).toContain('# columns: 3 (declared 2, common 1)');
      expect(result.stdout).toContain('# using common columns: 1 (declared)');
      expect(result.stdout).toContain('# collisions: 1');
      // The repeated physical name and both lines that declare it, in effective order: the
      // entity's `Field` line, then the `CommonField` line it was composed from.
      expect(result.stdout).toContain('#   id at lines 10, 5');
    });
  });

  it('shows declared columns for an undecidable opt-in and never calls the visible count complete', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 'partial_one']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('1  id     ID     D    -');
      expect(result.stdout).toContain(
        '# columns shown: 1 declared; common-derived columns are not fully known',
      );
      expect(result.stdout).toContain(
        '# note: UsingCommonColumns is neither 1 nor 0, so common columns are not composed',
      );
      // The complete-total line would claim a total the file does not support.
      expect(result.stdout).not.toContain('# columns: ');
    });
  });

  it('lists no rows for a view and says why the columns are unknown', async () => {
    await withFixture('fmt-01', async (path) => {
      const result = await runCli(['columns', path, 'active_users']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('# object: view active_users (section 5, line 35)');
      expect(result.stdout).toContain('# note: a view does not store its columns');
      expect(result.stdout).not.toContain('PNAME');
    });
  });
});

describe('a5er columns — json', () => {
  it('emits the shared ten members and this command’s result in order', async () => {
    await withDocument(PLAIN_DOCUMENT, async (path) => {
      const result = await runCli(['columns', '--format', 'json', path, 't']);
      const document = JSON.parse(result.stdout) as JsonColumnsEnvelope;

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(Object.keys(document)).toEqual([
        'contractVersion',
        'tool',
        'command',
        'status',
        'source',
        'limits',
        'result',
        'unsupported',
        'diagnostics',
        'completeness',
      ]);
      expect(document.command).toBe('columns');
      expect(document.contractVersion).toBe('0.1.0');
      expect(document.status).toBe('ok');

      const payload = document.result;
      if (payload === null) throw new Error('a non-failed document must carry a result');
      expect(Object.keys(payload)).toEqual([
        'kind',
        'sectionIndex',
        'span',
        'pname',
        'lname',
        'columns',
      ]);
      expect(payload.kind).toBe('entity');
      expect(payload.pname).toBe('t');
      expect(payload.lname).toBe('Things');
      expect(Object.keys(payload.columns)).toEqual([
        'status',
        'columns',
        'declared',
        'common',
        'collisions',
        'usingCommonColumns',
      ]);
      if (payload.columns.status !== 'complete') throw new Error('t must be complete');
      expect(payload.columns.columns.map((column) => column.pname)).toEqual(['id', 'name']);
      expect(payload.columns.columns.map((column) => column.source)).toEqual([
        'declared',
        'declared',
      ]);
      expect(payload.columns.columns[0]?.span).toEqual({
        sectionIndex: 2,
        startLine: 9,
        endLine: 9,
        keyLine: 9,
      });
      expect(payload.columns.usingCommonColumns).toEqual({
        value: 1,
        origin: 'defaulted',
        raw: '',
        span: null,
        token: 'absent',
      });
    });
  });

  it('keeps the effective order, both sources, the collision record and its flags', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const document = JSON.parse(
        (await runCli(['columns', '--format', 'json', path, 'with_common'])).stdout,
      ) as JsonColumnsEnvelope;

      const payload = document.result;
      if (payload === null || payload.kind !== 'entity') throw new Error('expected an entity');
      if (payload.columns.status !== 'complete') throw new Error('expected a complete list');
      expect(payload.columns.columns.map((column) => [column.pname, column.source])).toEqual([
        ['id', 'declared'],
        ['name', 'declared'],
        ['id', 'common'],
      ]);
      expect(payload.columns.columns.map((column) => column.collision)).toEqual([
        true,
        false,
        true,
      ]);
      expect(payload.columns.declared).toHaveLength(2);
      expect(payload.columns.common).toHaveLength(1);
      expect(payload.columns.collisions).toEqual([
        {
          sectionIndex: 2,
          object: 'with_common',
          pname: 'id',
          spans: [
            { sectionIndex: 2, startLine: 10, endLine: 10, keyLine: 10 },
            { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 },
          ],
        },
      ]);
      expect(payload.columns.usingCommonColumns).toMatchObject({
        value: 1,
        origin: 'declared',
        raw: '1',
        token: 'one',
      });
    });
  });

  it('marks an undecidable opt-in partial and keeps the visible list labelled', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const document = JSON.parse(
        (await runCli(['columns', '--format', 'json', path, 'partial_one'])).stdout,
      ) as JsonColumnsEnvelope;

      const payload = document.result;
      if (payload === null || payload.kind !== 'entity') throw new Error('expected an entity');
      expect(payload.columns).toMatchObject({
        status: 'partial',
        unknown: 'common-fields-not-enumerated',
        reason: 'using-common-columns-unrecognised',
      });
      expect(payload.columns.declared.map((column) => column.pname)).toEqual(['id']);
      expect(payload.columns.usingCommonColumns).toMatchObject({
        value: null,
        origin: 'declared',
        raw: '2',
        token: 'unrecognised',
      });
    });
  });

  it('keeps a view unknown with its reason and no list member at all', async () => {
    await withFixture('fmt-01', async (path) => {
      const document = JSON.parse(
        (await runCli(['columns', '--format', 'json', path, 'active_users'])).stdout,
      ) as JsonColumnsEnvelope;

      const payload = document.result;
      if (payload === null) throw new Error('a non-failed document must carry a result');
      expect(payload.kind).toBe('view');
      expect(payload.columns).toEqual({
        status: 'unknown',
        reason: 'view-columns-not-stored',
      });
      // No empty list may stand in for "not stored".
      expect('columns' in payload.columns).toBe(false);
    });
  });

  it('escapes a name with a quote or a control character, in both formats', async () => {
    // A `String` value is unquoted but not unescaped, so the quote is written literally and a TAB
    // is a literal tab in the file; both must be escaped on the way out.
    const document = [
      ...HEADER,
      '',
      '[Entity]',
      'PName="a"b"',
      'Field="tab\there","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      'Position="Main",10,10',
    ];

    await withDocument(document, async (path) => {
      const result = await runCli(['columns', '--format', 'json', path, 'a"b']);
      const parsed = JSON.parse(result.stdout) as JsonColumnsEnvelope;

      expect(result.code).toBe(0);
      const payload = parsed.result;
      if (payload === null || payload.kind !== 'entity') throw new Error('expected an entity');
      // The decoded name is what the selection matched and what the document reports.
      expect(payload.pname).toBe('a"b');
      if (payload.columns.status !== 'complete') throw new Error('expected a complete list');
      expect(payload.columns.columns.map((column) => column.logicalName)).toEqual(['tab\there']);

      const text = await runCli(['columns', path, 'a"b']);
      expect(text.code).toBe(0);
      expect(text.stdout).toContain('"a\\"b"');
      expect(text.stdout).toContain('"tab\\u{0009}here"');
      // The escaped form is the only form on the stream: no raw TAB.
      expect(text.stdout).not.toContain('\t');
    });
  });
});

describe('a5er columns — selection', () => {
  it('refuses a name that matches nothing, in both formats, with nothing on stdout', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const text = await runCli(['columns', path, 'nope']);
      const json = await runCli(['columns', '--format', 'json', path, 'nope']);

      for (const result of [text, json]) {
        expect(result.code).toBe(4);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('a5er: error: no object is named "nope"\n');
      }
    });
  });

  it('is case-sensitive: a differently cased name is a different object', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 'With_Common']);

      expect(result.code).toBe(4);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('a5er: error: no object is named "With_Common"\n');
    });
  });

  it('refuses an ambiguous name and cites every candidate in document order', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 'same']);

      expect(result.code).toBe(4);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'a5er: error: 2 objects are named "same"; candidates are sections 6, 7\n',
      );
    });
  });

  it('refuses a subtype, naming the section it was declared in', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 's1']);

      expect(result.code).toBe(4);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'a5er: error: "s1" is a subtype (section 5); a subtype declares no columns\n',
      );
    });
  });

  it('escapes the operand in the refusal line instead of printing it raw', async () => {
    await withDocument(MIXED_DOCUMENT, async (path) => {
      const result = await runCli(['columns', path, 'a"b\\c']);

      expect(result.code).toBe(4);
      expect(result.stderr).toBe('a5er: error: no object is named "a\\"b\\\\c"\n');
    });
  });
});

describe('a5er columns — failures and exits', () => {
  it('answers a fatal read with exit 1 and the failed document, before any selection', async () => {
    const result = await runCli([
      'columns',
      '--format',
      'json',
      '/tmp/a5er-definitely-missing.a5er',
      'nope',
    ]);
    const document = JSON.parse(result.stdout) as JsonColumnsEnvelope;

    expect(result.code).toBe(1);
    expect(document.status).toBe('failed');
    expect(document.source).toBeNull();
    expect(document.result).toBeNull();
    expect(document.completeness).toBeNull();
    expect(result.stderr).toContain('E_IO');

    // The text format keeps the framing of its format: no envelope, a failure note, exit 1.
    const text = await runCli(['columns', '/tmp/a5er-definitely-missing.a5er', 'nope']);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('# status: failed');
    expect(text.stdout).toContain('# object: none (status failed)');
    expect(text.stderr).toContain('E_IO');
  });

  it('answers a budget refusal with exit 1 and the injected counter in the details', async () => {
    await withDocument(PLAIN_DOCUMENT, async (path) => {
      const stdout = new FakeStream();
      const stderr = new FakeStream();
      // One ceiling below the document's own content-line count: a real refusal, injected small.
      const pipeline = createPipeline({
        ...DEFAULT_RESOURCE_BUDGETS.tables,
        contentLineOccurrences: 1,
      });

      const code = await runColumnsCommand({
        path,
        name: 't',
        format: 'json',
        stdout: asOutputStream(stdout),
        stderr: asOutputStream(stderr),
        pipeline,
      });
      const document = JSON.parse(stdout.chunks.join('')) as JsonColumnsEnvelope;

      expect(code).toBe(1);
      expect(document.status).toBe('failed');
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

    const code = await runColumnsCommand({
      path: '/tmp/never-read.a5er',
      name: 't',
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

  it('turns a write failure into exit 74 after the read code is reported', async () => {
    await withDocument(PLAIN_DOCUMENT, async (path) => {
      const stderr = new FakeStream();
      const codes: number[] = [];

      const code = await runColumnsCommand({
        path,
        name: 't',
        format: 'text',
        stdout: failingStream(),
        stderr: asOutputStream(stderr),
        onPhaseACode: (phaseCode): void => {
          codes.push(phaseCode);
        },
      });

      expect(code).toBe(74);
      // The read's code was set before the first write; the writer's answer replaces it.
      expect(codes).toEqual([0]);
      expect(stderr.chunks.join('')).toContain(CANNOT_WRITE_PREFIX);
    });
  });

  it('keeps columns’ operand errors at exit 2 with no stdout', async () => {
    const cases: Array<[readonly string[], string]> = [
      [['columns'], 'missing the file operand for columns'],
      [['columns', 'a.a5er'], 'missing the name operand for columns'],
      [
        ['columns', 'a.a5er', 'name', 'extra'],
        'extra operand "extra"; exactly one file and one name are read',
      ],
    ];

    for (const [args, message] of cases) {
      const result = await runCli(args);
      expect(result.code, message).toBe(2);
      expect(result.stdout, message).toBe('');
      expect(result.stderr, message).toContain(`a5er: ${message}`);
      expect(result.stderr, message).toContain('a5er columns [--format text|json] <file> <name>');
    }
  });
});
