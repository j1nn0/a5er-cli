/**
 * `tests/pipeline-admission.test.ts` — the admission gate wired into the one pipeline
 * (F4 U5-ADMIT1; `architecture.md` §10.5, §11, §12).
 *
 * `tests/budget-admission.test.ts` decides *what* `admit()` answers for hand-built numbers. This
 * file decides that the answer is **wired**: that the pipeline measures the document it just
 * scanned, refuses it on the refusal arm of `IntegrationInput`, and that the refusal reaches the
 * envelope, the exit policy and stderr unchanged.
 *
 * Nine axes:
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
 *    as exceptions; neither is converted into a refusal;
 * 7. **admitted documents are unchanged** — the envelope of a loaded fixture is identical to the
 *    composition the pipeline replaced, for every status this suite can produce.
 * 8. **order** — the one composition scans, measures, decides and only then classifies;
 * 9. **the three default ceilings** — pinned with pure `admit()` calls, at each ceiling and one past.
 *
 * The ceilings this build ships sit far above every committed fixture (at most 277 and 2), so each
 * refusal below is produced by passing a **small budget to `createPipeline(profile, budget)`** —
 * the optional second parameter, which the CLI and `a5er tables` never pass. No test here writes a
 * large document, generates JSON at size or relies on the environment: the fixtures are committed
 * synthetic ones staged as disposable copies, and the two files written by hand are a few bytes
 * each, for the read failures that no committed fixture can produce under the default limits.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BudgetProfile, ResourceBudget, ResourceMeasure } from '../src/budget/index.js';
import {
  admit,
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
import { runTablesCommand } from '../src/tables-command.js';
import { tablesDiagnosticLines } from '../src/text/index.js';
import type { IntegrationInput, RejectedInput } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';
import { stage } from './helpers/stage.js';

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

/** One ceiling below `fmt-01`'s Σ`L²`, with the composed bound left permissive. */
const ENVELOPE_BELOW_FMT01: ResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: FMT01_SQUARES - 1,
  composedColumnsUpperBound: 1,
};

/** The same document's Σ`L²` fits; one ceiling below `sem-07`'s composed bound does not. */
const ENVELOPE_BELOW_SEM07: ResourceBudget = {
  profile: 'envelope',
  relationValueLengthSquares: 1_000,
  composedColumnsUpperBound: SEM07_COMPOSED - 1,
};

/** `tables` has no Σ`L²` ceiling, so the same document is refused on the composed bound alone. */
const TABLES_BELOW_SEM07: ResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: SEM07_COMPOSED - 1,
};

/** `tables` admits `fmt-01`: its composed bound is 0 and Σ`L²` is not a tables ceiling. */
const TABLES_OVER_FMT01: ResourceBudget = {
  profile: 'tables',
  composedColumnsUpperBound: 1,
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

/**
 * The pipeline the CLI and `a5er tables` build, run over one path, narrowed to the refusal arm.
 *
 * A document that is admitted is a failed expectation here, not a silently passing case.
 */
function refused(profile: BudgetProfile, budget: ResourceBudget, path: string): RejectedInput {
  const input: IntegrationInput = createPipeline(profile, budget)(path);
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
      const input = createPipeline('envelope', ENVELOPE_BELOW_FMT01)(path);

      // The union's other arm is not reachable: the refusal replaces the four stage results.
      expect(input.load.ok).toBe(false);
      expect(Object.keys(input)).toEqual(['load']);
      expect('scan' in input).toBe(false);
      expect('classification' in input).toBe(false);
      expect('semantics' in input).toBe(false);

      const load = refused('envelope', ENVELOPE_BELOW_FMT01, path);
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
      const load = refused('envelope', ENVELOPE_BELOW_SEM07, path);

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
      const load = refused('envelope', ENVELOPE_BELOW_FMT01, path);
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
      const input = createPipeline('envelope', ENVELOPE_BELOW_FMT01)(path);
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
      const integration = integrate(createPipeline('envelope', ENVELOPE_BELOW_FMT01)(path));

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
      const input = createPipeline('envelope', ENVELOPE_BELOW_FMT01)(path);
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
      const admitted = createPipeline('tables', TABLES_OVER_FMT01)(path);
      expect(admitted.load.ok).toBe(true);
      expect(integrate(admitted).status).not.toBe('failed');

      const refusedByEnvelope = createPipeline('envelope', ENVELOPE_BELOW_FMT01)(path);
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
          pipeline: createPipeline('tables', TABLES_BELOW_SEM07),
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
        pipeline: createPipeline('tables', TABLES_BELOW_SEM07),
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
        // mean the read failure had been measured first.
        const budget: ResourceBudget = {
          profile: 'envelope',
          relationValueLengthSquares: 1,
          composedColumnsUpperBound: 1,
        };
        const input = createPipeline('envelope', budget)(path);

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
      createPipeline('envelope', {
        profile: 'envelope',
        relationValueLengthSquares: 0,
        composedColumnsUpperBound: 1,
      }),
    ).toThrow(ResourceAdmissionError);
    expect(() =>
      createPipeline('tables', { profile: 'tables', composedColumnsUpperBound: Number.NaN }),
    ).toThrow('admission: the composedColumnsUpperBound ceiling is not a positive safe integer');
  });

  it('keeps tables Phase A at exit 70 for both budget-module error classes', async () => {
    const errors = [
      new ResourceMeasureError('bounds.composedColumnsUpperBound.upperBound is not a safe integer'),
      new ResourceAdmissionError('relationValueLengthSquares is not a non-negative safe integer'),
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
          const pipeline = createPipeline(profile)(path);
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
        const input = createPipeline('envelope')(path);
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
  it('scans, measures, decides, and only then classifies', () => {
    // `classify()` is pure, so "it did not run" leaves no runtime trace: what can be asserted from
    // outside is that the refusal retains no classification (above) and that the call sits after
    // the deny return in the one composition. This pins that order, so a refactor that moved the
    // expensive stage before the decision would fail here.
    const source = readFileSync(PIPELINE_SOURCE, 'utf8');
    const scan = source.indexOf('const scan = scanSource(');
    const measureAt = source.indexOf('admit(measure(scan)');
    const deny = source.indexOf('if (!admission.admitted)');
    const classifyAt = source.indexOf('const classification = classify(');

    for (const [label, index] of [
      ['scanSource', scan],
      ['admit(measure(scan)', measureAt],
      ['if (!admission.admitted)', deny],
      ['classify', classifyAt],
    ] as const) {
      expect(index, label).toBeGreaterThan(-1);
    }
    expect(scan).toBeLessThan(measureAt);
    expect(measureAt).toBeLessThan(deny);
    expect(deny).toBeLessThan(classifyAt);
  });
});

describe('pipeline admission — the three default ceilings', () => {
  it('pins 134217728, 524288 and 4194304 with pure admit() calls, at and one past each', () => {
    // Explicit copies: the pipeline's defaults are these numbers, and a silent change to any of
    // them must fail here as well as in `tests/budget-admission.test.ts`.
    expect(DEFAULT_RESOURCE_BUDGETS.envelope).toEqual({
      profile: 'envelope',
      relationValueLengthSquares: 134_217_728,
      composedColumnsUpperBound: 524_288,
    });
    expect(DEFAULT_RESOURCE_BUDGETS.tables).toEqual({
      profile: 'tables',
      composedColumnsUpperBound: 4_194_304,
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
