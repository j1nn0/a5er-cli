/**
 * `tests/pipeline-admission.test.ts` — the admission gate wired into the one pipeline
 * (F4 U5-ADMIT1; `architecture.md` §10.5, §11, §12).
 *
 * `tests/budget-admission.test.ts` decides *what* `admit()` and `admitShape()` answer for hand-built
 * numbers. This file decides that the answers are **wired**: that the pipeline counts the document
 * before it scans it and measures it after, refuses either gate on the refusal arm of
 * `IntegrationInput`, and that the refusal reaches the envelope, the exit policy and stderr
 * unchanged.
 *
 * Eleven axes:
 *
 * 1. **the refusal arm** — `{ load: { ok: false, … } }` and nothing else: one `E_LIMIT_BUDGET`,
 *    the limits the read applied, no `scan`, no `classification`, no `semantics`;
 * 2. **the numbers in the details** — `observed` equals a figure derived by hand from the fixture's
 *    own text, which is what proves the scan ran and the measurement came from the file rather
 *    than from a constant;
 * 3. **the envelope and the exit policy** — `failed`, `source`/`schema`/`completeness` `null`,
 *    `unsupported` empty, `limits.truncated` false, one machine-readable document, exit `1`;
 * 4. **`tables`** — the same refusal through `runTablesCommand` on its own profile: the failed
 *    tables document, one fatal line, exit `1`, and the Phase A guard still taking `70` for an
 *    internal error;
 * 5. **precedence** — a read that already failed is returned with its own fatal, never measured
 *    and never re-labeled as a budget refusal;
 * 6. **internal errors** — `ResourceMeasureError` and `ResourceAdmissionError` leave the pipeline
 *    as exceptions; neither is converted into a refusal, and a budget the pipeline cannot apply
 *    stops it at construction rather than on the first document;
 * 7. **admitted documents are unchanged** — the envelope of a loaded fixture is identical to the
 *    composition the pipeline replaced, for every status this suite can produce.
 * 8. **order** — the one composition loads, gates on the pre-scan shape, scans, measures, decides
 *    and only then classifies;
 * 9. **the seven default ceilings** — pinned with pure `admit()`/`admitShape()` calls, at each
 *    ceiling and one past;
 * 10. **the production wiring** — the built `dist/cli.js`, run on one over-budget document, refuses
 *    it on `inspect` and `validate` and admits it on `tables`, so each call site really builds its
 *    pipeline from its own profile instead of agreeing by convention;
 * 11. **the pre-scan gate** — `measureSourceShape`/`admitShape` run between the read and the scan,
 *    so a Field- or content-heavy document is refused on the pre-scan counter before the scan
 *    allocates its records, a decode fatal still wins, and the refusal reaches the same envelope,
 *    fatal line, tables formats and exit `1` as a post-scan one.
 *
 * The ceilings this build ships sit far above every committed fixture (at most 277 and 2), so every
 * refusal below is produced by passing a **small budget to `createPipeline(budget)`** — the one
 * argument the function takes, which the CLI and `a5er tables` fill from this build's defaults. No
 * test here generates JSON at size or relies on the environment: the fixtures are committed
 * synthetic ones staged as disposable copies, and the files written by hand are small — a few bytes
 * for the read failures no committed fixture can produce, and one eleven-kilobyte document whose
 * single relation value crosses the shipped envelope Σ`L²` ceiling, for axis 10.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceBudget, ResourceMeasure } from '../src/budget/index.js';
import {
  admit,
  admitShape,
  DEFAULT_RESOURCE_BUDGETS,
  ResourceAdmissionError,
  ResourceMeasureError,
} from '../src/budget/index.js';
import { loadSource } from '../src/decode/load.js';
import { DEFAULT_LIMITS } from '../src/io/limits.js';
import type { OutputStream } from '../src/io/stdout.js';
import { OUTPUT_GENERATION_FAILED_LINE } from '../src/io/stdout.js';
import { serialize, toJsonString } from '../src/json/index.js';
import { createPipeline } from '../src/pipeline.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import type { SourceShape } from '../src/syntax/index.js';
import { runTablesCommand } from '../src/tables-command.js';
import { tablesDiagnosticLines } from '../src/text/index.js';
import type { IntegrationInput, RejectedInput } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';
import { stage } from './helpers/stage.js';
/**
 * `scanSource` is **wrapped, not replaced**: the wrapper delegates to the real scan, and its call
 * count is the runtime proof that a pre-scan refusal never reaches the scan. Every other export of
 * the barrel — the shape walk included — is the real module.
 */
vi.mock('../src/syntax/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/syntax/index.js')>();
  return { ...actual, scanSource: vi.fn(actual.scanSource) };
});

/** §11's message for the code, written out from the taxonomy, never read from the module. */
const BUDGET_MESSAGE = 'The input would need more work than the processing budget allows';

/** §12's stderr format, authored: `a5er: <severity>: <code>: <message>`, no span on a fatal refusal. */
const BUDGET_LINE = `a5er: fatal: E_LIMIT_BUDGET: ${BUDGET_MESSAGE}\n`;

/**
 * `fmt-01`'s measured Σ`L²`: its single relation maps `Fields1="id"` (4 code units) and
 * `Fields2="user_id"` (9), so 4² + 9² = 97. Counted from the fixture's text, not from `measure()`.
 */
const FMT01_SQUARES = 4 ** 2 + 9 ** 2;

/**
 * `sem-07`'s composed-column bound: two `[Entity]` sections times one `CommonField=` line in
 * `[Manager]`, so 2 × 1 = 2. Again from the fixture's text.
 */
const SEM07_COMPOSED = 2 * 1;

/**
 * A pre-scan ceiling far above any document these tests build.
 *
 * Every budget below exists to make one *post-scan* counter refuse, so the pre-scan gate has to
 * admit the document first: these two figures are that "let it through" setting, not the subject of
 * any assertion here.
 */
const PERMISSIVE_SHAPE = 1_000_000;

/** One ceiling below `fmt-01`'s Σ`L²`, with the composed bound and both pre-scan counts permissive. */
const ENVELOPE_BELOW_FMT01: ResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: FMT01_SQUARES - 1,
  composedColumnsUpperBound: 1,
  entityFieldOccurrences: PERMISSIVE_SHAPE,
  contentLineOccurrences: PERMISSIVE_SHAPE,
};

/** The same document's Σ`L²` fits; one ceiling below `sem-07`'s composed bound does not. */
const ENVELOPE_BELOW_SEM07: ResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: 1_000,
  composedColumnsUpperBound: SEM07_COMPOSED - 1,
  entityFieldOccurrences: PERMISSIVE_SHAPE,
  contentLineOccurrences: PERMISSIVE_SHAPE,
};

/** `tables` has no Σ`L²` ceiling, so the same document is refused on the composed bound alone. */
const TABLES_BELOW_SEM07: ResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: SEM07_COMPOSED - 1,
  entityFieldOccurrences: PERMISSIVE_SHAPE,
  contentLineOccurrences: PERMISSIVE_SHAPE,
};

/** `tables` admits `fmt-01`: its composed bound is 0 and Σ`L²` is not a tables ceiling. */
const TABLES_OVER_FMT01: ResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: 1,
  entityFieldOccurrences: PERMISSIVE_SHAPE,
  contentLineOccurrences: PERMISSIVE_SHAPE,
};

/** The ten envelope members, in §12's order; the refusal adds none and reorders none. */
const ENVELOPE_KEYS = [
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
];

/** The tables document's ten members (`docs/proposals/human-cli.md` §5), in emission order. */
const TABLES_KEYS = [
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
];

const PIPELINE_SOURCE = fileURLToPath(new URL('../src/pipeline.ts', import.meta.url));

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * The one document this file writes at size: a relation value `12_000` code units long, quoted.
 *
 * Σ`L²` counts the raw value text — quotes included — so this value alone measures `12_002² =
 * 144_048_004`, past the shipped envelope ceiling of `134_217_728` and far inside `maxBytes`. The
 * document holds no `[Entity]` section, so its composed bound is `0`, and the `tables` profile —
 * which caps that bound and nothing else — admits it. That difference is what lets axis 10 tell the
 * two wirings apart from outside the process: an `inspect` wired to the tables budget would admit
 * this file, and a `tables` wired to the envelope budget would refuse it.
 */
const OVER_ENVELOPE_FIELDS1 = `"${'a'.repeat(12_000)}"`;

/** The document's other relation value: `"id"`, four code units, so `4² = 16`. */
const OVER_ENVELOPE_FIELDS2 = '"id"';

/** Σ`L²` over both relation values, added up from the two literals authored above. */
const OVER_ENVELOPE_SQUARES = OVER_ENVELOPE_FIELDS1.length ** 2 + OVER_ENVELOPE_FIELDS2.length ** 2;

/** The document itself: a header the reader recognises, one `[Relation]` section, eleven kilobytes. */
function overEnvelopeDocument(): string {
  return [
    '# A5:ER FORMAT:21',
    '# A5:ER ENCODING:UTF8',
    '',
    '[Relation]',
    'Entity1="a"',
    'Entity2="b"',
    `Fields1=${OVER_ENVELOPE_FIELDS1}`,
    `Fields2=${OVER_ENVELOPE_FIELDS2}`,
    '',
  ].join('\n');
}

/** One staged committed fixture, removed whatever the test does. */
function staged<T>(id: string, use: (path: string) => T): T {
  const file = stage(id);
  try {
    return use(file.path);
  } finally {
    file.cleanup();
  }
}

/** A directory under the OS temp dir, removed whatever the test does; never inside the repo. */
function withTempFile(name: string, bytes: Uint8Array, use: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-pipeline-'));
  try {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    use(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A temp file written as UTF-8 text and removed afterwards, for an async use that needs it. */
async function inTempFile(
  name: string,
  text: string,
  use: (path: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-pipeline-wire-'));
  try {
    const path = join(directory, name);
    writeFileSync(path, Buffer.from(text, 'utf8'));
    await use(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * One `dist/cli.js` run: the shipped entry point, its exit code and both streams decoded.
 *
 * The production call sites are module-level constants, so the only way to observe which budget
 * each was built with is to run the built CLI: no seam was added for the test.
 */
function runCli(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { encoding: 'utf8', maxBuffer: 1 << 20 },
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

/**
 * The pipeline the CLI and `a5er tables` build, run over one path, narrowed to the refusal arm.
 *
 * A document that is admitted is a failed expectation here, not a silently passing case.
 */
function refused(budget: ResourceBudget, path: string): RejectedInput {
  const input: IntegrationInput = createPipeline(budget)(path);
  if (input.load.ok) throw new Error('the document was admitted');
  return input.load;
}

/**
 * The composition `src/pipeline.ts` replaced, spelled out from the base commit.
 *
 * It is the oracle for axis 7: an admitted document must integrate and serialize exactly as this
 * composes it. Stage results are not re-implemented — they are the same four calls the CLI made
 * before the admission gate existed.
 */
function referenceInput(path: string): IntegrationInput {
  const load = loadSource(path);
  if (!load.ok) return { load };

  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

/** A deterministic stream: it records each chunk and completes every write synchronously. */
function capture(): { stream: OutputStream; chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      write(chunk: string, callback: (error?: Error | null) => void): boolean {
        chunks.push(chunk);
        callback();
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
    },
  };
}

/** The smallest measurement that answers the two figures `admit()` reads (see the unit-1 file). */
function measureWith(
  relationValueLengthSquares: number,
  composedUpperBound: number,
): ResourceMeasure {
  return {
    counters: { relationValueLengthSquares },
    bounds: { composedColumnsUpperBound: { upperBound: composedUpperBound } },
    accounting: {},
  } as unknown as ResourceMeasure;
}

describe('pipeline admission — the refusal arm', () => {
  it('returns a rejected load: one E_LIMIT_BUDGET, the applied limits, no stage results', () => {
    staged('fmt-01', (path) => {
      const input = createPipeline(ENVELOPE_BELOW_FMT01)(path);

      // The union's other arm is not reachable: the refusal replaces the four stage results.
      expect(input.load.ok).toBe(false);
      expect(Object.keys(input)).toEqual(['load']);
      expect('scan' in input).toBe(false);
      expect('classification' in input).toBe(false);
      expect('semantics' in input).toBe(false);

      const load = refused(ENVELOPE_BELOW_FMT01, path);
      expect(Object.keys(load).sort()).toEqual(['diagnostics', 'limits', 'ok']);
      // The limits the read actually applied, not a second resolution and not a placeholder.
      expect(load.limits).toEqual(DEFAULT_LIMITS);
      expect(load.diagnostics).toEqual([
        {
          code: 'E_LIMIT_BUDGET',
          severity: 'fatal',
          message: BUDGET_MESSAGE,
          details: {
            counter: 'relationValueLengthSquares',
            observed: FMT01_SQUARES,
            ceiling: FMT01_SQUARES - 1,
          },
          span: null,
          construct: 'Source',
        },
      ]);
    });
  });

  it('reports the composed bound when that is the ceiling the document passes', () => {
    staged('sem-07', (path) => {
      const load = refused(ENVELOPE_BELOW_SEM07, path);

      expect(load.diagnostics).toHaveLength(1);
      const diagnostic = load.diagnostics[0];
      if (diagnostic === undefined) throw new Error('the refusal carried no diagnostic');
      // ΣL² is 0 here, so the refusal can only come from the composition bound: 2 × 1.
      expect(diagnostic.details).toEqual({
        counter: 'composedColumnsUpperBound',
        observed: SEM07_COMPOSED,
        ceiling: SEM07_COMPOSED - 1,
      });
      expect(diagnostic.code).toBe('E_LIMIT_BUDGET');
      expect(diagnostic.severity).toBe('fatal');
      expect(diagnostic.construct).toBe('Source');
      expect(diagnostic.span).toBeNull();
    });
  });

  it('keeps the details to the counter and two numbers: nothing from the document', () => {
    staged('fmt-01', (path) => {
      const load = refused(ENVELOPE_BELOW_FMT01, path);
      const diagnostic = load.diagnostics[0];
      if (diagnostic === undefined) throw new Error('the refusal carried no diagnostic');

      expect(Object.keys(diagnostic.details).sort()).toEqual(['ceiling', 'counter', 'observed']);
      const values = Object.values(diagnostic.details);
      expect(values.filter((value) => typeof value === 'string')).toEqual([
        'relationValueLengthSquares',
      ]);
      const numbers = values.filter((value): value is number => typeof value === 'number');
      expect(numbers).toHaveLength(2);
      for (const number of numbers) {
        expect(Number.isSafeInteger(number)).toBe(true);
        expect(number).toBeGreaterThanOrEqual(0);
      }
      // No path, key, column or other file text reaches the message or the details.
      expect(diagnostic.message).toBe(BUDGET_MESSAGE);
      expect(JSON.stringify(diagnostic)).not.toContain(path);
      expect(JSON.stringify(diagnostic)).not.toContain('uses');
    });
  });
});

describe('pipeline admission — the envelope and the exit policy', () => {
  it('integrates as failed with exit 1 for inspect and validate', () => {
    staged('fmt-01', (path) => {
      const input = createPipeline(ENVELOPE_BELOW_FMT01)(path);
      const integration = integrate(input);

      expect(integration.status).toBe('failed');
      expect(integration.completeness).toBeNull();
      expect(integration.unsupported).toEqual([]);
      // The CLI reads its exit code from exactly this table, so no case was added for the refusal.
      expect(integration.exitPolicy).toEqual({ inspect: 1, validate: 1 });

      for (const command of ['inspect', 'validate'] as const) {
        const envelope = serialize(input, { command, path });

        expect(Object.keys(envelope)).toEqual(ENVELOPE_KEYS);
        expect(envelope.command).toBe(command);
        expect(envelope.status).toBe('failed');
        expect(envelope.source).toBeNull();
        expect(envelope.schema).toBeNull();
        expect(envelope.completeness).toBeNull();
        expect(envelope.unsupported).toEqual([]);
        expect(envelope.limits).toEqual({ maxBytes: DEFAULT_LIMITS.maxBytes, truncated: false });
        expect(envelope.diagnostics).toEqual([
          {
            code: 'E_LIMIT_BUDGET',
            severity: 'fatal',
            message: BUDGET_MESSAGE,
            details: {
              counter: 'relationValueLengthSquares',
              observed: FMT01_SQUARES,
              ceiling: FMT01_SQUARES - 1,
            },
            span: null,
            construct: 'Source',
          },
        ]);

        // One machine-readable document, with the one trailing newline the CLI adds.
        const text = toJsonString(envelope);
        expect(text).not.toContain('\n');
        expect(JSON.parse(`${text}\n`)).toEqual(envelope);
      }
    });
  });

  it('prints the existing fatal line on stderr, through the renderer tables also uses', () => {
    staged('fmt-01', (path) => {
      const integration = integrate(createPipeline(ENVELOPE_BELOW_FMT01)(path));

      // §12's format for a fatal without a span; the same bytes `renderDiagnostics()` writes for
      // `inspect` and `validate` (`tests/text-diagnostics.test.ts` pins that equivalence).
      expect([...tablesDiagnosticLines(integration)].join('')).toBe(BUDGET_LINE);
      expect(BUDGET_LINE).toBe(
        `a5er: ${integration.diagnostics[0]?.severity}: ${integration.diagnostics[0]?.code}: ` +
          `${integration.diagnostics[0]?.message}\n`,
      );
    });
  });

  it('does not claim truncation, and states no completeness it does not have', () => {
    staged('fmt-01', (path) => {
      const input = createPipeline(ENVELOPE_BELOW_FMT01)(path);
      const envelope = serialize(input, { command: 'inspect', path });

      // A refusal stops the read's *downstream* work; nothing was partially accepted, and the
      // three counters stay absent rather than zero-filled.
      expect(envelope.limits.truncated).toBe(false);
      expect(envelope.completeness).toBeNull();
      expect(envelope.source).toBeNull();
      expect(envelope.schema).toBeNull();
    });
  });
});

describe('pipeline admission — tables', () => {
  it('admits a document the envelope profile refuses, because tables has no ΣL² ceiling', () => {
    staged('fmt-01', (path) => {
      // Same document, same ΣL² = 97; only the profile and its ceilings differ.
      const admitted = createPipeline(TABLES_OVER_FMT01)(path);
      expect(admitted.load.ok).toBe(true);
      expect(integrate(admitted).status).not.toBe('failed');

      const refusedByEnvelope = createPipeline(ENVELOPE_BELOW_FMT01)(path);
      expect(refusedByEnvelope.load.ok).toBe(false);
      expect(integrate(refusedByEnvelope).exitPolicy.inspect).toBe(1);
    });
  });

  it('refuses through runTablesCommand: failed document, one fatal line, exit 1', async () => {
    const file = stage('sem-07');
    try {
      for (const format of ['json', 'text'] as const) {
        const stdout = capture();
        const stderr = capture();
        const phases: (0 | 1 | 70)[] = [];

        const code = await runTablesCommand({
          path: file.path,
          format,
          stdout: stdout.stream,
          stderr: stderr.stream,
          pipeline: createPipeline(TABLES_BELOW_SEM07),
          onPhaseACode: (phaseCode): void => {
            phases.push(phaseCode);
          },
        });

        expect(code, format).toBe(1);
        expect(phases, format).toEqual([1]);
        expect(stderr.chunks.join(''), format).toBe(BUDGET_LINE);

        const written = stdout.chunks.join('');
        if (format === 'text') {
          // No listing at all: the refusal produced no rows and no table header.
          expect(written).toContain('# status: failed\n');
          expect(written).toContain('# objects: none (status failed)\n');
          expect(written).not.toContain('SECTION');
          continue;
        }

        const document = JSON.parse(written) as Record<string, unknown>;
        expect(Object.keys(document)).toEqual(TABLES_KEYS);
        expect(document['command']).toBe('tables');
        expect(document['status']).toBe('failed');
        expect(document['source']).toBeNull();
        expect(document['result']).toBeNull();
        expect(document['completeness']).toBeNull();
        expect(document['unsupported']).toEqual([]);
        expect(document['limits']).toEqual({
          maxBytes: DEFAULT_LIMITS.maxBytes,
          truncated: false,
        });
        expect(document['diagnostics']).toEqual([
          {
            code: 'E_LIMIT_BUDGET',
            severity: 'fatal',
            message: BUDGET_MESSAGE,
            details: {
              counter: 'composedColumnsUpperBound',
              observed: SEM07_COMPOSED,
              ceiling: SEM07_COMPOSED - 1,
            },
            span: null,
            construct: 'Source',
          },
        ]);
      }
    } finally {
      file.cleanup();
    }
  });

  it('documents the same refusal in text mode without diverging from the fatal line', async () => {
    const file = stage('sem-07');
    try {
      const stdout = capture();
      const stderr = capture();

      await runTablesCommand({
        path: file.path,
        format: 'text',
        stdout: stdout.stream,
        stderr: stderr.stream,
        pipeline: createPipeline(TABLES_BELOW_SEM07),
      });

      // The prose carries the code and the fixed message; `details` is never printed as prose.
      const prose = stdout.chunks.join('');
      expect(prose).toContain('E_LIMIT_BUDGET');
      expect(prose).toContain(BUDGET_MESSAGE);
      expect(stderr.chunks.join('')).toBe(BUDGET_LINE);
    } finally {
      file.cleanup();
    }
  });
});

describe('pipeline admission — a failed read keeps precedence', () => {
  it('returns the read failure it already had, never a budget refusal', () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ['empty.a5er', Buffer.alloc(0), 'E_EMPTY_INPUT'],
      ['binary.a5er', Buffer.from([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]), 'E_BINARY_INPUT'],
      ['unrecognised.a5er', Buffer.from('FORMAT: 21\nhello\n', 'utf8'), 'E_UNRECOGNIZED_DOCUMENT'],
    ];

    for (const [name, bytes, code] of cases) {
      withTempFile(name, bytes, (path) => {
        // A ceiling of 1 would refuse anything this pipeline measured, so a refusal here would
        // mean the read failure had been measured first. The pre-scan ceilings are armed the same
        // way: one content line is below anything that decodes.
        const budget: ResourceBudget = {
          profile: 'envelope',
          relationValueLengthSquares: 1,
          composedColumnsUpperBound: 1,
          entityFieldOccurrences: 1,
          contentLineOccurrences: 1,
        };
        const input = createPipeline(budget)(path);

        expect(input.load.ok, name).toBe(false);
        expect(Object.keys(input), name).toEqual(['load']);
        const load = input.load;
        if (load.ok) throw new Error(`${name} was accepted`);
        expect(
          load.diagnostics.map((diagnostic) => diagnostic.code),
          name,
        ).toEqual([code]);
        expect(load.limits, name).toEqual(DEFAULT_LIMITS);
        // The exit policy is the same one the fatal family always had.
        expect(integrate(input).exitPolicy, name).toEqual({ inspect: 1, validate: 1 });
      });
    }
  });
});

describe('pipeline admission — internal errors stay internal', () => {
  it('throws at construction for a ceiling it cannot compare, instead of refusing', () => {
    // A bad ceiling is a caller defect: the pipeline never starts, so no document is refused.
    expect(() =>
      createPipeline({
        profile: 'envelope',
        relationValueLengthSquares: 0,
        composedColumnsUpperBound: 1,
        entityFieldOccurrences: 1,
        contentLineOccurrences: 1,
      }),
    ).toThrow(ResourceAdmissionError);
    expect(() =>
      createPipeline({
        profile: 'tables',
        composedColumnsUpperBound: Number.NaN,
        entityFieldOccurrences: 1,
        contentLineOccurrences: 1,
      }),
    ).toThrow('admission: the composedColumnsUpperBound ceiling is not a positive safe integer');
  });

  it('keeps tables Phase A at exit 70 for both budget-module error classes', async () => {
    const errors = [
      new ResourceMeasureError('bounds.composedColumnsUpperBound.upperBound is not a safe integer'),
      new ResourceAdmissionError('relationValueLengthSquares is not a non-negative safe integer'),
      new ResourceAdmissionError('entityFieldOccurrences is not a non-negative safe integer'),
    ];

    for (const error of errors) {
      const stdout = capture();
      const stderr = capture();
      const phases: (0 | 1 | 70)[] = [];

      const code = await runTablesCommand({
        path: '/tmp/never-read.a5er',
        format: 'json',
        stdout: stdout.stream,
        stderr: stderr.stream,
        pipeline: (): never => {
          throw error;
        },
        onPhaseACode: (phaseCode): void => {
          phases.push(phaseCode);
        },
      });

      expect(code).toBe(70);
      expect(phases).toEqual([70]);
      expect(stdout.chunks).toEqual([]);
      expect(stderr.chunks.join('')).toBe(OUTPUT_GENERATION_FAILED_LINE);
      // The exception is not a finding about a file: no code, no message, no refusal.
      expect(stderr.chunks.join('')).not.toContain('E_LIMIT_BUDGET');
      expect(stderr.chunks.join('')).not.toContain('admission:');
    }
  });
});

describe('pipeline admission — admitted documents are unchanged', () => {
  // Ids whose whole envelope this suite pins, one per status the fixtures can produce: `ok`,
  // `degraded` with `validate` exiting 0, and `degraded` with an `error`-severity finding, the only
  // case where `validate` exits 3 (`architecture.md` §12).
  const CASES: Array<[string, 'ok' | 'degraded', 0 | 3]> = [
    ['fmt-01', 'ok', 0],
    ['val-08', 'degraded', 0],
    ['sem-09', 'degraded', 3],
  ];

  it('produces the same envelope as the composition it replaced', () => {
    for (const [id] of CASES) {
      staged(id, (path) => {
        for (const profile of ['envelope', 'tables'] as const) {
          const pipeline = createPipeline(DEFAULT_RESOURCE_BUDGETS[profile])(path);
          const reference = referenceInput(path);

          expect(pipeline.load.ok, `${id}/${profile}`).toBe(true);
          const integration = integrate(pipeline);
          expect(integration.status, `${id}/${profile}`).not.toBe('failed');
          // No refusal leaks into an accepted document.
          expect(
            integration.diagnostics.filter((diagnostic) => diagnostic.code === 'E_LIMIT_BUDGET'),
            `${id}/${profile}`,
          ).toEqual([]);

          for (const command of ['inspect', 'validate'] as const) {
            expect(serialize(pipeline, { command, path }), `${id}/${profile}/${command}`).toEqual(
              serialize(reference, { command, path }),
            );
          }
        }
      });
    }
  });

  it('leaves the status and both exit codes of each case exactly as they were', () => {
    for (const [id, status, validate] of CASES) {
      staged(id, (path) => {
        const input = createPipeline(DEFAULT_RESOURCE_BUDGETS.envelope)(path);
        const integration = integrate(input);

        expect(integration.status, id).toBe(status);
        // The exit table is derived from severities alone; the gate adds no answer of its own.
        expect(integration.exitPolicy, id).toEqual({ inspect: 0, validate });
        expect(integration.exitPolicy, id).toEqual(integrate(referenceInput(path)).exitPolicy);
      });
    }
  });
});

describe('pipeline admission — order', () => {
  it('loads, gates on the shape, scans, measures, decides, and only then classifies', () => {
    // The one composition is read as text: the gates are pure functions, so "it did not run" leaves
    // no runtime trace on its own (the call counter below covers `scanSource`). What this pins is
    // that the pre-scan deny sits before `scanSource()`, which is the property the gate exists for.
    const source = readFileSync(PIPELINE_SOURCE, 'utf8');
    const load = source.indexOf('const load = loadSource(path)');
    const shape = source.indexOf('measureSourceShape(load.source.text)');
    const shapeAdmit = source.indexOf('admitShape(shape, applied)');
    const shapeDeny = source.indexOf('if (!shapeAdmission.admitted)');
    const scan = source.indexOf('const scan = scanSource(');
    const measureAt = source.indexOf('admit(measure(scan)');
    const deny = source.indexOf('if (!admission.admitted)');
    const classifyAt = source.indexOf('const classification = classify(');

    for (const [label, index] of [
      ['loadSource', load],
      ['measureSourceShape', shape],
      ['admitShape', shapeAdmit],
      ['if (!shapeAdmission.admitted)', shapeDeny],
      ['scanSource', scan],
      ['admit(measure(scan)', measureAt],
      ['if (!admission.admitted)', deny],
      ['classify', classifyAt],
    ] as const) {
      expect(index, label).toBeGreaterThan(-1);
    }
    expect(load).toBeLessThan(shape);
    expect(shape).toBeLessThan(shapeAdmit);
    expect(shapeAdmit).toBeLessThan(shapeDeny);
    expect(shapeDeny).toBeLessThan(scan);
    expect(scan).toBeLessThan(measureAt);
    expect(measureAt).toBeLessThan(deny);
    expect(deny).toBeLessThan(classifyAt);
  });

  it('never scans a document the pre-scan gate refuses, and does scan one it admits', () => {
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      const scanned = vi.mocked(scanSource);

      scanned.mockClear();
      expect(createPipeline(envelopeWithShape(2, 100))(path).load.ok).toBe(false);
      expect(scanned).not.toHaveBeenCalled();

      // The same document and the same pipeline shape, one Field ceiling higher: the scan runs,
      // exactly once, which is what makes the zero above a measurement rather than a dead spy.
      scanned.mockClear();
      expect(createPipeline(envelopeWithShape(3, 100))(path).load.ok).toBe(true);
      expect(scanned).toHaveBeenCalledTimes(1);
    });
  });
});

describe('pipeline admission — the seven default ceilings', () => {
  it('pins all seven, at and one past each, with pure admit() and admitShape() calls', () => {
    // Explicit copies: the pipeline's defaults are these numbers, and a silent change to any of
    // them must fail here as well as in `tests/budget-admission.test.ts`.
    expect(DEFAULT_RESOURCE_BUDGETS.envelope).toEqual({
      profile: 'envelope',
      relationValueLengthSquares: 134_217_728,
      composedColumnsUpperBound: 524_288,
      entityFieldOccurrences: 200_000,
      contentLineOccurrences: 400_000,
    });
    expect(DEFAULT_RESOURCE_BUDGETS.tables).toEqual({
      profile: 'tables',
      composedColumnsUpperBound: 4_194_304,
      entityFieldOccurrences: 500_000,
      contentLineOccurrences: 1_000_000,
    });

    const envelope = DEFAULT_RESOURCE_BUDGETS.envelope;
    const tables = DEFAULT_RESOURCE_BUDGETS.tables;

    expect(admit(measureWith(envelope.relationValueLengthSquares, 0), envelope)).toEqual({
      admitted: true,
    });
    expect(admit(measureWith(envelope.relationValueLengthSquares + 1, 0), envelope)).toEqual({
      admitted: false,
      counter: 'relationValueLengthSquares',
      observed: 134_217_728 + 1,
      ceiling: 134_217_728,
    });

    expect(admit(measureWith(0, envelope.composedColumnsUpperBound), envelope)).toEqual({
      admitted: true,
    });
    expect(admit(measureWith(0, envelope.composedColumnsUpperBound + 1), envelope)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: 524_288 + 1,
      ceiling: 524_288,
    });

    expect(admit(measureWith(0, tables.composedColumnsUpperBound), tables)).toEqual({
      admitted: true,
    });
    expect(admit(measureWith(0, tables.composedColumnsUpperBound + 1), tables)).toEqual({
      admitted: false,
      counter: 'composedColumnsUpperBound',
      observed: 4_194_304 + 1,
      ceiling: 4_194_304,
    });

    // The four pre-scan ceilings, decided by `admitShape()` on the shipped numbers.
    expect(
      admitShape(
        shapeWith(envelope.entityFieldOccurrences, envelope.contentLineOccurrences),
        envelope,
      ),
    ).toEqual({ admitted: true });
    expect(admitShape(shapeWith(envelope.entityFieldOccurrences + 1, 0), envelope)).toEqual({
      admitted: false,
      counter: 'entityFieldOccurrences',
      observed: 200_000 + 1,
      ceiling: 200_000,
    });
    expect(admitShape(shapeWith(0, envelope.contentLineOccurrences + 1), envelope)).toEqual({
      admitted: false,
      counter: 'contentLineOccurrences',
      observed: 400_000 + 1,
      ceiling: 400_000,
    });
    expect(
      admitShape(shapeWith(tables.entityFieldOccurrences, tables.contentLineOccurrences), tables),
    ).toEqual({ admitted: true });
    expect(admitShape(shapeWith(tables.entityFieldOccurrences + 1, 0), tables)).toEqual({
      admitted: false,
      counter: 'entityFieldOccurrences',
      observed: 500_000 + 1,
      ceiling: 500_000,
    });
    expect(admitShape(shapeWith(0, tables.contentLineOccurrences + 1), tables)).toEqual({
      admitted: false,
      counter: 'contentLineOccurrences',
      observed: 1_000_000 + 1,
      ceiling: 1_000_000,
    });
  });

  it('leaves every committed fixture far below all three, so no golden can trip them', () => {
    // The measured maxima over the 39 synthetic fixtures: 277 and 2. Stated so a future fixture
    // that grows towards a ceiling is a visible decision rather than a surprise refusal.
    const FIXTURE_MAX_SQUARES = 277;
    const FIXTURE_MAX_COMPOSED = 2;

    expect(FIXTURE_MAX_SQUARES * 100_000).toBeLessThan(
      DEFAULT_RESOURCE_BUDGETS.envelope.relationValueLengthSquares,
    );
    expect(FIXTURE_MAX_COMPOSED * 100_000).toBeLessThan(
      DEFAULT_RESOURCE_BUDGETS.tables.composedColumnsUpperBound,
    );
  });
});

describe('pipeline admission — one budget, so no profile can disagree with the ceilings', () => {
  it('takes exactly one argument: the budget is the only source of a profile', () => {
    // A second parameter would be a second place to disagree: a profile that decides which counters
    // are compared and a set of ceilings that decides against what. The function's arity is asserted
    // rather than the declaration's text, so re-adding one fails here wherever it is put.
    expect(createPipeline.length).toBe(1);
  });

  it('throws ResourceAdmissionError at construction for a profile it does not apply', () => {
    const unknownProfiles: unknown[] = [
      'Envelope',
      'TABLES',
      'envelope ',
      '',
      'relationships',
      null,
      undefined,
      1,
      {},
      { profile: 'bogus', composedColumnsUpperBound: 10 },
    ];

    for (const profile of unknownProfiles) {
      const budget = {
        profile,
        relationValueLengthSquares: 10,
        composedColumnsUpperBound: 10,
      } as unknown as ResourceBudget;

      expect(() => createPipeline(budget), String(profile)).toThrow(ResourceAdmissionError);
    }
  });

  it('refuses to start a read on an invalid budget: the error is not a load failure', () => {
    // The path does not exist, so a read that had started would come back as a rejected load with
    // its own diagnostic. Construction throws first, which is the point: no file is opened, and the
    // error names no path and no number.
    const missing = join(tmpdir(), 'a5er-never-read-u5-admit1.a5er');
    const budget = {
      profile: 'envelope-tables',
      relationValueLengthSquares: 10,
      composedColumnsUpperBound: 10,
    } as unknown as ResourceBudget;

    let thrown: unknown;
    try {
      createPipeline(budget)(missing);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ResourceAdmissionError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe(
      'admission: the budget names a profile this build does not apply',
    );
    expect((thrown as Error).message).not.toContain(missing);
    expect((thrown as Error).message).not.toMatch(/\d/);
  });
});

describe('pipeline admission — the production wiring', () => {
  it('refuses the over-budget document on inspect and validate: the CLI ships the envelope budget', async () => {
    await inTempFile('over-envelope.a5er', overEnvelopeDocument(), async (path) => {
      for (const command of ['inspect', 'validate'] as const) {
        const result = await runCli([command, path]);

        expect(result.code, command).toBe(1);
        expect(result.stderr, command).toBe(BUDGET_LINE);

        const envelope = JSON.parse(result.stdout) as {
          readonly status: string;
          readonly source: unknown;
          readonly completeness: unknown;
          readonly diagnostics: readonly unknown[];
        };

        expect(envelope.status, command).toBe('failed');
        expect(envelope.source, command).toBeNull();
        expect(envelope.completeness, command).toBeNull();
        // The observed figure is Σ`L²` over the document's own two relation values and the ceiling
        // is the envelope default, written out here: a budget without that ceiling could not report
        // this counter at all.
        expect(envelope.diagnostics, command).toEqual([
          {
            code: 'E_LIMIT_BUDGET',
            severity: 'fatal',
            message: BUDGET_MESSAGE,
            details: {
              counter: 'relationValueLengthSquares',
              observed: OVER_ENVELOPE_SQUARES,
              ceiling: 134_217_728,
            },
            span: null,
            construct: 'Source',
          },
        ]);
        expect(JSON.stringify(envelope), command).not.toContain(path);
      }
    });
  });

  it('admits the same document on tables: the command ships the tables budget', async () => {
    await inTempFile('over-envelope.a5er', overEnvelopeDocument(), async (path) => {
      const result = await runCli(['tables', '--format', 'json', path]);

      // What the minimal relation costs the validator is not this test's subject, so the exit code
      // is asserted as "not the refusal" rather than as a number it does not decide.
      expect(result.code).not.toBe(1);
      expect(result.stderr).not.toContain('E_LIMIT_BUDGET');
      expect(result.stdout).not.toContain('E_LIMIT_BUDGET');

      const document = JSON.parse(result.stdout) as { readonly status: string };
      expect(document.status).not.toBe('failed');
    });
  });
});

// ── the pre-scan gate (U5-ADMIT2) ────────────────────────────────────────

/** `fields` `Field=` lines in one `[Entity]` section, under a header the reader recognises. */
function fieldHeavyDocument(fields: number): string {
  const lines = ['# A5:ER FORMAT:21', '[Entity]'];
  for (let index = 0; index < fields; index += 1) lines.push(`Field="c${index}"`);
  return `${lines.join('\n')}\n`;
}

/** The envelope profile with its shipped post-scan ceilings and the given pre-scan ones. */
function envelopeWithShape(
  entityFieldOccurrences: number,
  contentLineOccurrences: number,
): ResourceBudget {
  return { ...DEFAULT_RESOURCE_BUDGETS.envelope, entityFieldOccurrences, contentLineOccurrences };
}

/** The tables profile with its shipped post-scan ceilings and the given pre-scan ones. */
function tablesWithShape(
  entityFieldOccurrences: number,
  contentLineOccurrences: number,
): ResourceBudget {
  return { ...DEFAULT_RESOURCE_BUDGETS.tables, entityFieldOccurrences, contentLineOccurrences };
}

/**
 * The smallest shape that answers the two figures `admitShape()` reads.
 *
 * `lines` is the pre-scan accounting and is not part of the decision, so it holds the empty
 * partition rather than a cast.
 */
function shapeWith(entityFieldOccurrences: number, contentLineOccurrences: number): SourceShape {
  return {
    lines: { total: 0, sectionHeaders: 0, keys: 0, comments: 0, blank: 0, raw: 0 },
    entityFieldOccurrences,
    contentLineOccurrences,
  };
}

/** The details of the one refusal a pipeline input carries, checked to be a budget refusal. */
function refusalDetails(input: IntegrationInput): unknown {
  if (input.load.ok) throw new Error('the document was admitted');
  const diagnostic = input.load.diagnostics[0];
  if (diagnostic === undefined) throw new Error('the refusal carried no diagnostic');
  expect(diagnostic.code).toBe('E_LIMIT_BUDGET');
  expect(diagnostic.severity).toBe('fatal');
  expect(diagnostic.span).toBeNull();
  expect(diagnostic.construct).toBe('Source');
  return diagnostic.details;
}

describe('pipeline admission — the pre-scan gate', () => {
  it('refuses on the Field count before any stage result exists', () => {
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      const input = createPipeline(envelopeWithShape(2, 100))(path);

      expect(input.load.ok).toBe(false);
      expect(Object.keys(input)).toEqual(['load']);
      expect(refusalDetails(input)).toEqual({
        counter: 'entityFieldOccurrences',
        observed: 3,
        ceiling: 2,
      });

      const load = input.load;
      if (load.ok) throw new Error('the document was admitted');
      // The limits the read applied, and one diagnostic: no scan, no classification, no semantics.
      expect(load.limits).toEqual(DEFAULT_LIMITS);
      expect(load.diagnostics).toHaveLength(1);
    });
  });

  it('refuses on the content-line count when the Field count fits', () => {
    // One header and three `Field=` lines: three Field occurrences and four content lines.
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      expect(refusalDetails(createPipeline(envelopeWithShape(3, 3))(path))).toEqual({
        counter: 'contentLineOccurrences',
        observed: 4,
        ceiling: 3,
      });
    });
  });

  it('reports the Field count first when both pre-scan counts are past their ceilings', () => {
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      expect(refusalDetails(createPipeline(envelopeWithShape(2, 3))(path))).toEqual({
        counter: 'entityFieldOccurrences',
        observed: 3,
        ceiling: 2,
      });
    });
  });

  it('precedes the post-scan gate, and leaves it deciding when the shape fits', () => {
    const text = `${fieldHeavyDocument(3)}[Relation]\nFields1="abc"\n`;
    withTempFile('both.a5er', Buffer.from(text, 'utf8'), (path) => {
      // Σ`L²` is 5² = 25 over the one relation value; the composed bound is 0.
      const overBoth = { ...envelopeWithShape(2, 100), relationValueLengthSquares: 24 };
      expect(refusalDetails(createPipeline(overBoth)(path))).toEqual({
        counter: 'entityFieldOccurrences',
        observed: 3,
        ceiling: 2,
      });

      // The same document with a shape ceiling that admits it: the post-scan gate still decides.
      const shapeFits = { ...envelopeWithShape(3, 100), relationValueLengthSquares: 24 };
      expect(refusalDetails(createPipeline(shapeFits)(path))).toEqual({
        counter: 'relationValueLengthSquares',
        observed: 25,
        ceiling: 24,
      });
    });
  });

  it('admits the same document when both pre-scan ceilings are met', () => {
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      const input = createPipeline(envelopeWithShape(3, 4))(path);

      expect(input.load.ok).toBe(true);
      expect(integrate(input).status).not.toBe('failed');
    });
  });

  it('keeps a decode fatal ahead of a shape refusal the same bytes would also earn', () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ['unrecognised.a5er', Buffer.from('FORMAT: 21\nhello\n', 'utf8'), 'E_UNRECOGNIZED_DOCUMENT'],
      ['binary.a5er', Buffer.from([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]), 'E_BINARY_INPUT'],
    ];

    for (const [name, bytes, code] of cases) {
      withTempFile(name, bytes, (path) => {
        // One content line is the ceiling, so the gate would refuse anything the walk saw at all.
        const input = createPipeline(envelopeWithShape(1, 1))(path);

        expect(input.load.ok, name).toBe(false);
        const load = input.load;
        if (load.ok) throw new Error(`${name} was accepted`);
        expect(
          load.diagnostics.map((diagnostic) => diagnostic.code),
          name,
        ).toEqual([code]);
        expect(JSON.stringify(load.diagnostics), name).not.toContain('E_LIMIT_BUDGET');
      });
    }

    // The same ceilings do refuse a document that reads, so the gate was armed all along.
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(2), 'utf8'), (path) => {
      expect(refusalDetails(createPipeline(envelopeWithShape(1, 1))(path))).toEqual({
        counter: 'entityFieldOccurrences',
        observed: 2,
        ceiling: 1,
      });
    });
  });

  it('integrates a shape refusal as failed with exit 1 and one machine-readable document', () => {
    withTempFile('fields.a5er', Buffer.from(fieldHeavyDocument(3), 'utf8'), (path) => {
      const input = createPipeline(envelopeWithShape(2, 100))(path);
      const integration = integrate(input);

      expect(integration.status).toBe('failed');
      expect(integration.completeness).toBeNull();
      expect(integration.unsupported).toEqual([]);
      expect(integration.exitPolicy).toEqual({ inspect: 1, validate: 1 });
      expect([...tablesDiagnosticLines(integration)].join('')).toBe(BUDGET_LINE);

      for (const command of ['inspect', 'validate'] as const) {
        const envelope = serialize(input, { command, path });

        expect(Object.keys(envelope), command).toEqual(ENVELOPE_KEYS);
        expect(envelope.status, command).toBe('failed');
        expect(envelope.source, command).toBeNull();
        expect(envelope.schema, command).toBeNull();
        expect(envelope.completeness, command).toBeNull();
        expect(envelope.unsupported, command).toEqual([]);
        expect(envelope.limits, command).toEqual({
          maxBytes: DEFAULT_LIMITS.maxBytes,
          truncated: false,
        });
        expect(envelope.diagnostics, command).toEqual([
          {
            code: 'E_LIMIT_BUDGET',
            severity: 'fatal',
            message: BUDGET_MESSAGE,
            details: { counter: 'entityFieldOccurrences', observed: 3, ceiling: 2 },
            span: null,
            construct: 'Source',
          },
        ]);
        expect(toJsonString(envelope), command).not.toContain('\n');
      }
    });
  });

  it('refuses a shape-heavy document through runTablesCommand in both formats', async () => {
    await inTempFile('fields.a5er', fieldHeavyDocument(3), async (path) => {
      for (const format of ['json', 'text'] as const) {
        const stdout = capture();
        const stderr = capture();
        const phases: (0 | 1 | 70)[] = [];

        const code = await runTablesCommand({
          path,
          format,
          stdout: stdout.stream,
          stderr: stderr.stream,
          pipeline: createPipeline(tablesWithShape(2, 100)),
          onPhaseACode: (phaseCode): void => {
            phases.push(phaseCode);
          },
        });

        expect(code, format).toBe(1);
        expect(phases, format).toEqual([1]);
        expect(stderr.chunks.join(''), format).toBe(BUDGET_LINE);

        const written = stdout.chunks.join('');
        if (format === 'text') {
          expect(written, format).toContain('# status: failed\n');
          expect(written, format).toContain('# objects: none (status failed)\n');
          continue;
        }

        const document = JSON.parse(written) as Record<string, unknown>;
        expect(Object.keys(document), format).toEqual(TABLES_KEYS);
        expect(document['status'], format).toBe('failed');
        expect(document['result'], format).toBeNull();
        expect(document['completeness'], format).toBeNull();
        expect(document['unsupported'], format).toEqual([]);
        expect(document['diagnostics'], format).toEqual([
          {
            code: 'E_LIMIT_BUDGET',
            severity: 'fatal',
            message: BUDGET_MESSAGE,
            details: { counter: 'entityFieldOccurrences', observed: 3, ceiling: 2 },
            span: null,
            construct: 'Source',
          },
        ]);
      }
    });
  });

  it('throws at construction for a pre-scan ceiling it cannot compare', () => {
    expect(() =>
      createPipeline({ ...DEFAULT_RESOURCE_BUDGETS.envelope, entityFieldOccurrences: 0 }),
    ).toThrow('admission: the entityFieldOccurrences ceiling is not a positive safe integer');
    expect(() =>
      createPipeline({ ...DEFAULT_RESOURCE_BUDGETS.envelope, contentLineOccurrences: Number.NaN }),
    ).toThrow('admission: the contentLineOccurrences ceiling is not a positive safe integer');

    // A budget that predates the pre-scan ceilings is a caller defect, not a refusal: the pipeline
    // never starts, so no document is ever judged against the missing members.
    expect(() =>
      createPipeline({
        profile: 'envelope',
        relationValueLengthSquares: 1,
        composedColumnsUpperBound: 1,
      } as unknown as ResourceBudget),
    ).toThrow(ResourceAdmissionError);
  });
});
