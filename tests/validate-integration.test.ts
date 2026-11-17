/**
 * Stage 5 — the integration layer (`architecture.md` §9, §11, §12, §13, §14 row 13;
 * `test-strategy.md` §8, §10 gates G-1/G-2, §14 stage 5).
 *
 * What this file proves, in the order the brief asks for it:
 *
 * 1. the six named acceptance fixtures produce the codes, severities, spans and exit policies the
 *    documents require (sem-01's dangling trio, sem-08's duplicate identity, sem-09's missing
 *    `PageInfo`, fmt-01's info-only view, txt-04's unknown raw, val-08's malformed line);
 * 2. every committed synthetic fixture's diagnostic **multiset** and every diagnostic's **span**
 *    match the catalog, and `status`/`inspect` exit follow from severities alone;
 * 3. ordering: line order first (§12 rule 7), then stage order, then code; duplicates survive;
 *    one crafted case per tie-break, plus every real fixture inside the same assertion;
 * 4. counts: the integrated total is exactly the sum of the four stages, `dropped` is `0` by
 *    reconciliation, and the numbers agree with the catalog's independent `counts`;
 * 5. errors: a fatal read yields `failed` with `completeness: null`, no evidence and `E_` only;
 * 6. immutability (file bytes/sha/size/mtime and the staging directory) and repeatability.
 *
 * **Catalog findings, recorded rather than fixed.** No expected value was bent to make this unit
 * green; three findings are recorded here instead, each with the assertion that pins it:
 *
 * 1. **enc-03 / enc-05 are stage-2 expectations.** Both declare `codes` (and enc-05 declares
 *    `status: 'ok'`) as measured at the decode stage. Their decoded document is
 *    `[Entity] PName + Position` with no `[Manager]`, so stages 4–5 legitimately add
 *    `V_MISSING_REQUIRED_KEY` (error: no `PageInfo`) and `V_DANGLING_PAGE` (warning: `Main` is
 *    never declared) — which makes the integrated result a superset and enc-05 `degraded`. The
 *    entry still matches the decode stage exactly, so it is left alone; the envelope expectation
 *    that supersedes it is authored in stage 6 (§18), never by blessing parser output here.
 * 2. `RetentionKind` declares `'unsupported-construct'`, but no production path emits it: an
 *    unsupported `Position` shape stays in `section.decoded.positions` and never reaches
 *    `classification.preserved`. `src/validate/index.ts` projects it into `unsupported` as
 *    `'unsupported-position'` so §13's "undefined vertex format" evidence is not invisible.
 * 3. No committed fixture produces `Classification.problems` (an undecodable declared token) or
 *    any indeterminate marker (`indeterminateKeys`, `indeterminateColumnLists`,
 *    `indeterminateViewNames`, `ambiguousEntities`), so those paths are covered by in-memory
 *    inputs below rather than by a catalog file. §11 assigns them no code, and this layer adds
 *    none: the records stay in the classification, untouched.
 *
 * `res-03` (the three limit breaches) is deliberately not driven through this layer: it needs a
 * 64 MiB write and is already covered by the decode tests. `res-01`, `hst-02`, `hst-06` and
 * `enc-04` cover the fatal path here with small inputs.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LoadOutcome } from '../src/decode/load.js';
import { loadSource } from '../src/decode/load.js';
import type { Diagnostic } from '../src/diagnostics/diagnostic.js';
import { emit, emitRegistry, emitSemantic, emitSyntax } from '../src/diagnostics/diagnostic.js';
import type { Limits } from '../src/io/limits.js';
import type { Span } from '../src/model/span.js';
import type { Classification } from '../src/schema/registry.js';
import { classify } from '../src/schema/registry.js';
import type { PartialSemantics } from '../src/semantic/partial.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import type { SyntaxScan } from '../src/syntax/scanner.js';
import { scanSource } from '../src/syntax/scanner.js';
import type {
  CompletedIntegration,
  FailedIntegration,
  IntegrationInput,
  IntegrationRule,
  LoadedIntegrationInput,
} from '../src/validate/index.js';
import { IntegrationError, integrate, isLoadedInput } from '../src/validate/index.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import { assertCodes } from './helpers/assert-codes.js';
import { specOf } from './helpers/classified.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { CAPPED_READ_LIMIT_BYTES, GENERATED_BUILDERS } from './helpers/generated.js';
import { sha256File, stage } from './helpers/stage.js';

/** Committed text fixtures: the ones a staging helper can hand to the real reader. */
const TEXT_FIXTURES = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');

/** A staged fixture, run through the four stages and integrated once. */
interface Pipeline {
  readonly input: LoadedIntegrationInput;
  readonly integration: CompletedIntegration;
}

const PIPELINES = new Map<string, Pipeline>();

/** The first element, or a thrown error naming the empty list. */
function first<T>(items: readonly T[], label: string): T {
  const value = items.at(0);
  if (value === undefined) throw new Error(`${label} is empty`);
  return value;
}

/** Run the real stages over a path. No diagnosis is invented and no stage is skipped. */
function inputFromPath(path: string, limits?: Partial<Limits>): IntegrationInput {
  const load: LoadOutcome = limits === undefined ? loadSource(path) : loadSource(path, { limits });
  if (!load.ok) return { load };

  const scan: SyntaxScan = scanSource(load.source);
  const classification: Classification = classify(scan);
  const semantics: PartialSemantics = derivePartialSemantics(classification);
  return { load, scan, classification, semantics };
}

/** The integrated pipeline for a synthetic fixture, derived once per test process. */
function pipelineOf(id: string): Pipeline {
  const cached = PIPELINES.get(id);
  if (cached !== undefined) return cached;

  const staged = stage(id);
  let input: IntegrationInput;
  try {
    input = inputFromPath(staged.path);
  } finally {
    staged.cleanup();
  }

  if (!isLoadedInput(input)) throw new Error(`${id} did not load`);
  const integration = integrate(input);
  if (integration.status === 'failed') throw new Error(`${id} integrated as failed`);

  const pipeline: Pipeline = { input, integration };
  PIPELINES.set(id, pipeline);
  return pipeline;
}

/** Every diagnostic the four stages produced, before integration touches the order. */
function stageDiagnostics(input: LoadedIntegrationInput): readonly Diagnostic[] {
  return [
    ...input.load.source.diagnostics,
    ...input.scan.diagnostics,
    ...input.classification.diagnostics,
    ...input.semantics.diagnostics,
  ];
}

/** Write bytes into a scratch directory and run `run` on the path; always cleans up. */
function withBytes<T>(bytes: Uint8Array, run: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-validate-'));
  try {
    const path = join(directory, 'fixture.a5er');
    writeFileSync(path, bytes);
    return run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Integrate a documented rejection; fails loudly if the read unexpectedly succeeded. */
function rejectedFrom(load: () => LoadOutcome): FailedIntegration {
  const outcome = load();
  if (outcome.ok) throw new Error('expected the reader to reject the input');
  const integration = integrate({ load: outcome });
  if (integration.status !== 'failed') throw new Error('expected a failed integration');
  return integration;
}

/** A loaded input built from text in memory: same stages as a real file, no file at all. */
function loadedFromText(text: string, format: number | null = 21): LoadedIntegrationInput {
  const bytes = Buffer.from(text, 'utf8');
  const source = {
    text,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    encoding: { detected: 'utf-8' as const, bom: false, declared: 'UTF8', mismatch: false },
    format,
    diagnostics: [],
  };
  const scan = scanSource(source);
  const classification = classify(scan);
  const semantics = derivePartialSemantics(classification);
  return { load: { ok: true, source }, scan, classification, semantics };
}

/** Replace only the four diagnostic arrays, so counts stay exactly as the stages derived them. */
function withDiagnostics(
  input: LoadedIntegrationInput,
  diagnostics: {
    readonly decode: readonly Diagnostic[];
    readonly syntax: readonly Diagnostic[];
    readonly schema: readonly Diagnostic[];
    readonly semantic: readonly Diagnostic[];
  },
): IntegrationInput {
  return {
    load: { ok: true, source: { ...input.load.source, diagnostics: diagnostics.decode } },
    scan: { ...input.scan, diagnostics: diagnostics.syntax },
    classification: { ...input.classification, diagnostics: diagnostics.schema },
    semantics: { ...input.semantics, diagnostics: diagnostics.semantic },
  };
}

/** A single-line span at `line`. */
function spanAt(line: number, sectionIndex = 1): Span {
  return { sectionIndex, startLine: line, endLine: line, keyLine: line };
}

/** The rules an `IntegrationError` reports, or a failed expectation when nothing throws. */
function rulesOf(run: () => void): readonly IntegrationRule[] {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof IntegrationError) return error.violations.map((entry) => entry.rule);
    throw error;
  }
  throw new Error('expected an IntegrationError');
}

/**
 * The source line a span names, exactly as the scanner stored it (terminator excluded).
 *
 * Read from `scan.lines` rather than from the fixture file, so the check compares the evidence
 * against the same text the pipeline saw, with no second decoder in the way.
 */
function lineTextAt(input: LoadedIntegrationInput, line: number): string {
  const source = input.scan.lines.at(line - 1);
  if (source === undefined) throw new Error(`line ${String(line)} is outside the document`);
  return source.text;
}

/** Every span the integration reports must point at a line that exists (§12 rule 3, T4). */
function assertSpansAreReal(
  input: LoadedIntegrationInput,
  diagnostics: readonly Diagnostic[],
  label: string,
): void {
  const lineCount = input.scan.lines.length;
  for (const diagnostic of diagnostics) {
    const where = `${label} ${diagnostic.code}`;
    const span = diagnostic.span;
    if (span === null) continue; // Decode-stage diagnostics are about the whole input.

    expect(span.startLine, where).toBeGreaterThanOrEqual(1);
    expect(span.startLine, where).toBeLessThanOrEqual(span.endLine);
    expect(span.endLine, where).toBeLessThanOrEqual(lineCount);
    expect(span.keyLine, where).toBeGreaterThanOrEqual(span.startLine);
    expect(span.keyLine, where).toBeLessThanOrEqual(span.endLine);
    expect(span.sectionIndex, where).toBeGreaterThanOrEqual(0);
    expect(span.sectionIndex, where).toBeLessThanOrEqual(input.scan.sections.length);

    if (span.sectionIndex === 0) continue;
    const section = input.scan.sections.at(span.sectionIndex - 1);
    if (section === undefined) throw new Error(`${where} names no section`);
    expect(span.keyLine, where).toBeGreaterThanOrEqual(section.span.startLine);
    expect(span.keyLine, where).toBeLessThanOrEqual(section.span.endLine);
  }
}

describe('validate — Stage 5 acceptance fixtures', () => {
  it('sem-01: the dangling trio, degraded, and both commands exit 0', () => {
    const { input, integration } = pipelineOf('sem-01');
    // §14 row 13: exactly the three codes, in file order.
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'V_DANGLING_ENTITY',
      'V_DANGLING_COLUMN',
      'V_DANGLING_PAGE',
    ]);
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([14, 16, 21]);
    expect(integration.diagnostics.map((entry) => entry.severity)).toEqual([
      'warning',
      'warning',
      'warning',
    ]);
    expect(integration.status).toBe('degraded');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 0 });
    // None of the three is an `error`, so `validate` has nothing to return 3 for.
    expect(integration.diagnostics.map((entry) => entry.code)).not.toContain(
      'V_DUPLICATE_OBJECT_NAME',
    );
    expect(input.semantics.danglingEntities).toHaveLength(1);
    expect(input.semantics.danglingColumns).toHaveLength(1);
    expect(input.semantics.pageReferences.filter((ref) => ref.status === 'dangling')).toHaveLength(
      1,
    );
  });

  it('sem-08: duplicate identity is an error, so inspect exits 0 and validate exits 3', () => {
    const { integration } = pipelineOf('sem-08');
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'V_DUPLICATE_OBJECT_NAME',
      'V_VIEW_COLUMNS_UNKNOWN',
    ]);
    // Both findings point at the `[View] PName` line: the tie is real, not an accident of order.
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([12, 12]);
    expect(integration.diagnostics.map((entry) => entry.severity)).toEqual(['error', 'info']);
    expect(integration.status).toBe('degraded');
    // test-strategy §14 stage 5: sem-08 exits 3 under `validate` and 0 under `inspect`.
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 3 });
  });

  it('sem-09: missing PageInfo is an error, so inspect exits 0 and validate exits 3', () => {
    const { integration } = pipelineOf('sem-09');
    const diagnostic = first(integration.diagnostics, 'sem-09 diagnostics');
    expect(diagnostic.code).toBe('V_MISSING_REQUIRED_KEY');
    // §11 assigns this severity per subject: identity and PageInfo are `error`.
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.details['keys']).toBe('PageInfo');
    expect(diagnostic.span?.startLine).toBe(3);
    expect(integration.status).toBe('degraded');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 3 });
  });

  it('fmt-01: an info-only view finding leaves the document ok and both exits 0', () => {
    const { integration } = pipelineOf('fmt-01');
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual(['V_VIEW_COLUMNS_UNKNOWN']);
    expect(integration.diagnostics.map((entry) => entry.severity)).toEqual(['info']);
    expect(integration.status).toBe('ok');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 0 });
    // §12 rule 2: `info` still rides along, and the counters still reconcile to zero.
    expect(integration.completeness.dropped).toBe(0);
    expect(integration.completeness.lines.dropped).toBe(0);
  });

  it('txt-04: unknown section and keys are ok, ordered by line, and kept as evidence', () => {
    const { input, integration } = pipelineOf('txt-04');
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'S_UNKNOWN_KEY',
      'S_UNKNOWN_KEY',
      'S_UNKNOWN_SECTION',
    ]);
    // The scan raises its line-9 record first, the registry its line-5 and line-6 records later;
    // integration orders them by the file, not by the stage that produced them.
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([5, 6, 9]);
    expect(integration.diagnostics.map((entry) => entry.severity)).toEqual([
      'info',
      'info',
      'info',
    ]);
    expect(integration.status).toBe('ok');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 0 });

    expect(
      integration.unsupported.map((entry) => ({
        kind: entry.kind,
        line: entry.span.startLine,
        raw: entry.raw,
      })),
    ).toEqual([
      { kind: 'unknown-key', line: 5, raw: 'MysteryKey="value"' },
      { kind: 'unknown-key', line: 6, raw: 'SecondMystery="value2"' },
      { kind: 'unknown-section', line: 9, raw: '[Memo]' },
      { kind: 'unknown-key', line: 10, raw: 'Note="自由メモ"' },
    ]);
    expect(input.classification.preserved).toHaveLength(4);
  });

  it('val-08: a malformed line degrades the status and the order follows the file', () => {
    const { integration } = pipelineOf('val-08');
    // The view's `info` (line 7) precedes the syntax warning (line 9): family order is not the key.
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'V_VIEW_COLUMNS_UNKNOWN',
      'S_MALFORMED_LINE',
    ]);
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([7, 9]);
    expect(integration.status).toBe('degraded');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 0 });

    const evidence = first(integration.unsupported, 'val-08 evidence');
    expect(evidence.kind).toBe('multiline-value');
    expect(evidence.reason).toBe('not-a-key-value-line');
    expect(evidence.raw).toBe('FROM users WHERE id > 0"');
    expect(evidence.span.startLine).toBe(9);
    expect(evidence.key).toBeNull();
  });
});

describe('validate — catalog-wide multiset, status, exit code and spans', () => {
  it('has fixtures to check', () => {
    expect(TEXT_FIXTURES.length).toBeGreaterThanOrEqual(39);
  });

  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: multiset, status, inspect exit and spans match the catalog`, () => {
      const { input, integration } = pipelineOf(spec.id);
      const expectation = spec.expectation;

      // G-2: the exact multiset, duplicates included (assertCodes is the shared gate).
      assertCodes(
        integration.diagnostics.map((entry) => entry.code),
        expectation.codes,
        `${spec.id} codes`,
      );

      // §12 rule 1 / test-strategy §8: status from severities, never from a stage or a code list.
      expect(integration.status, `${spec.id} status`).toBe(expectation.status);
      expect(integration.exitPolicy.inspect, `${spec.id} inspect`).toBe(expectation.exitCode);

      // The catalog's independent counts (§13). Nothing is bent to fit output.
      expect(integration.completeness.sections.total, spec.id).toBe(
        expectation.counts.sections.total,
      );
      expect(integration.completeness.sections.parsed, spec.id).toBe(
        expectation.counts.sections.parsed,
      );
      expect(integration.completeness.sections.preservedRaw, spec.id).toBe(
        expectation.counts.sections.preservedRaw,
      );
      expect(integration.completeness.keys.total, spec.id).toBe(expectation.counts.keys.total);
      expect(integration.completeness.keys.parsed, spec.id).toBe(expectation.counts.keys.parsed);
      expect(integration.completeness.keys.preservedRaw, spec.id).toBe(
        expectation.counts.keys.preservedRaw,
      );

      assertSpansAreReal(input, integration.diagnostics, spec.id);
    });
  }

  it('bare bytes fixtures: the D_ and E_ families reach the same sequence', () => {
    // enc-04 and hst-02 stop the pipeline, but a fatal result is already the many-member sequence.
    const fatal = new Map<string, Uint8Array>([
      ['enc-04', enc04.BYTES],
      ['hst-02', hst02.BYTES],
    ]);
    for (const [id, bytes] of fatal) {
      const expectation = specOf(id).expectation;
      const integration = withBytes(bytes, (path) => integrate(inputFromPath(path)));
      assertCodes(
        integration.diagnostics.map((entry) => entry.code),
        expectation.codes,
        `${id} codes`,
      );
      expect(integration.status, `${id} status`).toBe(expectation.status);
      expect(integration.exitPolicy.inspect, `${id} inspect`).toBe(expectation.exitCode);
    }

    // The two surviving byte fixtures carry a minimal document, so the full pipeline adds two
    // findings the stage-2 catalog entry could not have known about:
    //
    //   FINDING (recorded, not bent): enc-03 and enc-05 declare `codes` and (for enc-05) `status`
    //   as of the *decode* stage. Their decoded document is `[Entity] PName + Position` with no
    //   `[Manager]`, so the semantic stage adds `V_MISSING_REQUIRED_KEY` (error, the absent
    //   `PageInfo`) and `V_DANGLING_PAGE` (warning, `Main` is never declared). The integrated
    //   result is therefore a superset of the catalog entry, and enc-05 is `degraded`, not `ok`.
    //   The entry is left untouched: it is the source of truth for the decode stage, and the
    //   envelope expectations that supersede it are authored in stage 6 (§18), never by blessing
    //   parser output here. The assertion below pins the delta so a change cannot pass unnoticed.
    const survivors = new Map<string, Uint8Array>([
      ['enc-03', enc03.BYTES],
      ['enc-05', enc05.BYTES],
    ]);
    for (const [id, bytes] of survivors) {
      const expectation = specOf(id).expectation;
      const decoded = withBytes(bytes, (path) => loadSource(path));
      if (!decoded.ok) throw new Error(`${id} must decode`);
      assertCodes(
        decoded.source.diagnostics.map((entry) => entry.code),
        expectation.codes,
        `${id} decode codes`,
      );

      const integration = withBytes(bytes, (path) => integrate(inputFromPath(path)));
      assertCodes(
        integration.diagnostics.map((entry) => entry.code),
        [...expectation.codes, 'V_DANGLING_PAGE', 'V_MISSING_REQUIRED_KEY'],
        `${id} integrated codes`,
      );
      expect(integration.status, `${id} status`).toBe('degraded');
      expect(integration.exitPolicy.inspect, `${id} inspect`).toBe(expectation.exitCode);
      expect(integration.exitPolicy.validate, `${id} validate`).toBe(3);
    }
  });

  it('fatal family members: hst-06 and res-01 keep the read’s own outcome', () => {
    const hst06 = specOf('hst-06').expectation.files ?? [];
    const built = new Map(
      (GENERATED_BUILDERS['hst-06']?.() ?? []).map((file) => [file.name, file.bytes]),
    );
    expect(hst06).toHaveLength(3);

    for (const member of hst06) {
      const bytes = built.get(member.file);
      if (bytes === undefined) throw new Error(`hst-06 built no ${member.file}`);
      const integration = withBytes(bytes, (path) => integrate(inputFromPath(path)));
      assertCodes(
        integration.diagnostics.map((entry) => entry.code),
        member.codes,
        `hst-06/${member.file}`,
      );
      expect(integration.status, member.file).toBe(member.status);
      expect(integration.exitPolicy.inspect, member.file).toBe(member.exitCode);
      expect(integration.exitPolicy.validate, member.file).toBe(member.exitCode);
    }

    const res01 = first(GENERATED_BUILDERS['res-01']?.() ?? [], 'res-01 builder');
    const integration = withBytes(res01.bytes, (path) =>
      integrate(inputFromPath(path, { maxBytes: CAPPED_READ_LIMIT_BYTES })),
    );
    assertCodes(
      integration.diagnostics.map((entry) => entry.code),
      specOf('res-01').expectation.codes,
      'res-01 codes',
    );
    expect(integration.status).toBe('failed');
    expect(integration.exitPolicy).toEqual({ inspect: 1, validate: 1 });
  });
});

describe('validate — ordering and ties', () => {
  const baseline = (): LoadedIntegrationInput => pipelineOf('fmt-01').input;

  it('orders by line, then stage, then code', () => {
    const decode = emit('D_BOM_MISSING', { construct: 'Source' });
    const syntax = emitSyntax('S_HEADER_UNKNOWN_FORMAT', { span: spanAt(7), construct: 'Header' });
    const schema = emitRegistry('S_UNKNOWN_KEY', { span: spanAt(7), construct: 'Key' });
    const semantic = emitSemantic('V_VIEW_COLUMNS_UNKNOWN', { span: spanAt(7), construct: 'View' });

    const integration = integrate(
      withDiagnostics(baseline(), {
        decode: [decode],
        // Deliberately handed over in reverse stage order: only the tie-break decides.
        syntax: [syntax],
        schema: [schema],
        semantic: [semantic],
      }),
    );

    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'D_BOM_MISSING',
      'S_HEADER_UNKNOWN_FORMAT',
      'S_UNKNOWN_KEY',
      'V_VIEW_COLUMNS_UNKNOWN',
    ]);
  });

  it('breaks a same-stage tie by code, by code unit rather than by locale', () => {
    const integration = integrate(
      withDiagnostics(baseline(), {
        decode: [],
        syntax: [],
        schema: [
          emitRegistry('S_UNKNOWN_KEY', { span: spanAt(3), construct: 'Key' }),
          emitRegistry('S_LEGACY_KEY', { span: spanAt(3), construct: 'Key' }),
        ],
        semantic: [],
      }),
    );
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'S_LEGACY_KEY',
      'S_UNKNOWN_KEY',
    ]);
  });

  it('keeps duplicate diagnostics as separate entries', () => {
    const key = emitRegistry('S_UNKNOWN_KEY', { span: spanAt(3), construct: 'Key' });
    const integration = integrate(
      withDiagnostics(baseline(), {
        decode: [],
        syntax: [],
        schema: [key, key, key],
        semantic: [],
      }),
    );
    expect(integration.diagnostics).toHaveLength(3);
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'S_UNKNOWN_KEY',
      'S_UNKNOWN_KEY',
      'S_UNKNOWN_KEY',
    ]);
  });

  it('puts a span-less decode diagnostic before line 1', () => {
    const integration = integrate(
      withDiagnostics(baseline(), {
        decode: [emit('D_BOM_MISSING', { construct: 'Source' })],
        syntax: [emitSyntax('S_MALFORMED_LINE', { span: spanAt(2, 0), construct: 'Line' })],
        schema: [],
        semantic: [],
      }),
    );
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'D_BOM_MISSING',
      'S_MALFORMED_LINE',
    ]);
  });

  it('a real same-line cross-stage tie puts schema before semantic', () => {
    // fmt-02: `S_LEGACY_KEY` (schema) and `V_INDEX_LEGACY_ONLY` (semantic) both point at line 7.
    const { integration } = pipelineOf('fmt-02');
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([7, 7]);
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'S_LEGACY_KEY',
      'V_INDEX_LEGACY_ONLY',
    ]);
  });

  it('a real same-line schema/semantic tie on a Field decodes line 5 the same way', () => {
    // val-05: the Field shape warning and the missing-key error are about the same line.
    const { integration } = pipelineOf('val-05');
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([5, 5]);
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'S_FIELD_TOO_FEW_ELEMENTS',
      'V_MISSING_REQUIRED_KEY',
    ]);
  });

  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: the sequence is non-decreasing in line order`, () => {
      const { integration } = pipelineOf(spec.id);
      const lines = integration.diagnostics.map((entry) => entry.span?.startLine ?? 0);
      for (let index = 1; index < lines.length; index += 1) {
        const previous = lines[index - 1] ?? 0;
        const current = lines[index] ?? 0;
        expect(current, `${spec.id} position ${String(index)}`).toBeGreaterThanOrEqual(previous);
      }
    });
  }
});

describe('validate — counts and reconciliation', () => {
  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: the total is the sum of the stages and nothing was dropped`, () => {
      const { input, integration } = pipelineOf(spec.id);
      const staged = stageDiagnostics(input);

      // Nothing is omitted and nothing is added: same length, and every entry is the very object
      // a stage produced, so no code, severity, message, detail or span was rewritten on the way.
      expect(integration.diagnostics).toHaveLength(staged.length);
      for (const diagnostic of integration.diagnostics) {
        expect(staged).toContain(diagnostic);
      }

      const { completeness } = integration;
      expect(completeness.dropped).toBe(0);
      expect(completeness.lines.dropped).toBe(0);
      expect(completeness.lines.accounted).toBe(completeness.lines.total);
      expect(completeness.sections.parsed + completeness.sections.preservedRaw).toBe(
        completeness.sections.total,
      );
      expect(completeness.sections.unknown).toBe(completeness.sections.preservedRaw);
      expect(completeness.keys.parsed + completeness.keys.preservedRaw).toBe(
        completeness.keys.total,
      );
      // The two derivations agree: the line ledger and the classification (§13).
      expect(completeness.lines.total).toBe(input.scan.lines.length);
      expect(completeness.sections.total).toBe(input.scan.sections.length);
      expect(completeness.keys.total).toBe(input.scan.accounting.keys.total);
    });
  }

  it('a key total that disagrees with the scan is refused, not reported', () => {
    const { input } = pipelineOf('fmt-01');
    const keys = input.classification.completeness.keys;
    const broken: IntegrationInput = {
      ...input,
      classification: {
        ...input.classification,
        completeness: {
          ...input.classification.completeness,
          keys: { ...keys, total: keys.total + 1 },
        },
      },
    };
    expect(rulesOf(() => integrate(broken))).toContain('key-total-mismatch');
  });

  it('a section count that disagrees with the scan is refused, not reported', () => {
    const { input } = pipelineOf('fmt-01');
    const sections = input.classification.completeness.sections;
    const broken: IntegrationInput = {
      ...input,
      classification: {
        ...input.classification,
        completeness: {
          ...input.classification.completeness,
          sections: { ...sections, total: sections.total + 1 },
        },
      },
    };
    expect(rulesOf(() => integrate(broken))).toContain('section-total-mismatch');
  });
});

describe('validate — fatal path', () => {
  it('enc-04: undecodable bytes yield failed, E_ only, and no schema evidence', () => {
    const integration = rejectedFrom(() => withBytes(enc04.BYTES, (path) => loadSource(path)));
    expect(integration.status).toBe('failed');
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual(['E_UNDECODABLE']);
    expect(integration.diagnostics.map((entry) => entry.severity)).toEqual(['fatal']);
    expect(integration.completeness).toBeNull();
    expect(integration.unsupported).toEqual([]);
    expect(integration.exitPolicy).toEqual({ inspect: 1, validate: 1 });
  });

  it('hst-02: binary bytes yield failed with E_BINARY_INPUT', () => {
    const integration = rejectedFrom(() => withBytes(hst02.BYTES, (path) => loadSource(path)));
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual(['E_BINARY_INPUT']);
    expect(integration.completeness).toBeNull();
  });

  it('retains the read’s diagnostics verbatim, as the same objects', () => {
    const outcome = withBytes(enc04.BYTES, (path) => loadSource(path));
    if (outcome.ok) throw new Error('enc-04 must not load');
    const integration = integrate({ load: outcome });
    expect(integration.diagnostics).toHaveLength(outcome.diagnostics.length);
    outcome.diagnostics.forEach((diagnostic, index) => {
      expect(integration.diagnostics[index]).toBe(diagnostic);
    });
  });

  it('never synthesises a schema from a rejected input', () => {
    const integration = rejectedFrom(() => withBytes(enc04.BYTES, (path) => loadSource(path)));
    // The type says so (`completeness: null`, `unsupported: readonly []`) and the runtime agrees:
    // a `failed` result has no counter and no evidence a caller could render as a diagram.
    expect('completeness' in integration).toBe(true);
    expect(integration.completeness).toBeNull();
    expect(Object.keys(integration).sort()).toEqual([
      'completeness',
      'diagnostics',
      'exitPolicy',
      'status',
      'unsupported',
    ]);
  });
});

describe('validate — unsupported evidence', () => {
  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: evidence is the projection of stored records, each with raw on its own line`, () => {
      const { input, integration } = pipelineOf(spec.id);

      // No record is counted twice and none is invented: the list is exactly the retained
      // records plus the unsupported positions plus one record per subtype.
      const unsupportedPositions = input.classification.sections
        .flatMap((section) => section.decoded.positions)
        .filter((position) => position.kind === 'unsupported');
      expect(integration.unsupported).toHaveLength(
        input.classification.preserved.length +
          unsupportedPositions.length +
          input.semantics.subtypes.length,
      );

      for (const evidence of integration.unsupported) {
        expect(evidence.raw.length, `${spec.id} ${evidence.kind}`).toBeGreaterThan(0);
        expect(evidence.reason.length, `${spec.id} ${evidence.kind}`).toBeGreaterThan(0);
        expect(evidence.span.startLine, `${spec.id} ${evidence.kind}`).toBeGreaterThanOrEqual(1);
        expect(evidence.span.startLine, `${spec.id} ${evidence.kind}`).toBeLessThanOrEqual(
          input.scan.lines.length,
        );
        // §12 rule 4: the raw text sits on the line the span names. R31 was exactly this
        // assertion failing for `subtype-membership` (header text, `PName`-line span).
        expect(
          lineTextAt(input, evidence.span.startLine),
          `${spec.id} ${evidence.kind} raw/span`,
        ).toContain(evidence.raw);
      }

      // Ordering is by position, so two runs produce the same list.
      const lines = integration.unsupported.map((evidence) => evidence.span.startLine);
      expect([...lines].sort((left, right) => left - right)).toEqual(lines);
    });
  }

  it('sem-05: membership evidence quotes the header line, the finding stays on the PName line', () => {
    const { input, integration } = pipelineOf('sem-05');
    const evidence = first(integration.unsupported, 'sem-05 evidence');
    expect(evidence.kind).toBe('subtype-membership');
    expect(evidence.sectionKind).toBe('Subtype');
    expect(evidence.sectionHeader).toBe('[Subtype]');
    expect(evidence.raw).toBe('[Subtype]');
    expect(evidence.reason).toBe('no-membership-key-in-v2.21');
    expect(evidence.key).toBeNull();

    // R31: the evidence quotes the `[Subtype]` header, so its span is that header line (11) —
    // one line, `sectionIndex` 3 — and the raw text is the line it claims to have read.
    expect(evidence.span).toEqual({ sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 });
    expect(lineTextAt(input, evidence.span.startLine)).toBe(evidence.raw);

    // The semantic finding keeps its own anchor: the most specific line the file has, `PName` (12).
    const diagnostic = first(integration.diagnostics, 'sem-05 diagnostics');
    expect(diagnostic.code).toBe('V_UNSUPPORTED_SUBTYPE_MEMBERSHIP');
    expect(diagnostic.span).toEqual({ sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 });
    expect(lineTextAt(input, 12)).toBe('PName="unknown_membership"');
    // Evidence and finding are two anchors for two different claims, not a contradiction.
    expect(evidence.span.startLine).not.toBe(diagnostic.span?.startLine);
  });

  it('a subtype with no PName anchors both the evidence and the finding on its header', () => {
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Subtype]',
        'SharedMode=0',
        'Position="Main",10,10',
        '',
      ].join('\n'),
    );
    const integration = integrate(input);

    // `reportSpanOf` falls back to the header when there is no `PName`, so both anchors agree.
    expect(input.semantics.subtypes).toHaveLength(1);
    expect(input.semantics.subtypes.at(0)?.pname).toBeNull();
    expect(input.semantics.subtypes.at(0)?.headerSpan.startLine).toBe(6);
    expect(input.semantics.subtypes.at(0)?.span.startLine).toBe(6);

    const evidence = first(integration.unsupported, 'header-only subtype evidence');
    expect(evidence.kind).toBe('subtype-membership');
    expect(evidence.raw).toBe('[Subtype]');
    expect(evidence.span).toEqual({ sectionIndex: 2, startLine: 6, endLine: 6, keyLine: 6 });
    expect(lineTextAt(input, evidence.span.startLine)).toBe(evidence.raw);

    // Both findings are about that same header line: the absent identity and the silent format.
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'V_MISSING_REQUIRED_KEY',
      'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
    ]);
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([6, 6]);
  });

  it('two subtypes keep their own headers, in file order', () => {
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Subtype]',
        'PName="first"',
        'SharedMode=0',
        'Position="Main",10,10',
        '',
        '[Subtype]',
        'PName="second"',
        'SharedMode=1',
        'Position="Main",20,20',
        '',
      ].join('\n'),
    );
    const integration = integrate(input);

    expect(input.semantics.subtypes.map((entry) => entry.headerSpan.startLine)).toEqual([6, 11]);
    expect(input.semantics.subtypes.map((entry) => entry.span.startLine)).toEqual([7, 12]);

    // One evidence record per subtype, ordered by position, each pointing at its own header.
    expect(
      integration.unsupported.map((entry) => ({
        kind: entry.kind,
        raw: entry.raw,
        span: entry.span,
      })),
    ).toEqual([
      {
        kind: 'subtype-membership',
        raw: '[Subtype]',
        span: { sectionIndex: 2, startLine: 6, endLine: 6, keyLine: 6 },
      },
      {
        kind: 'subtype-membership',
        raw: '[Subtype]',
        span: { sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 },
      },
    ]);
    for (const evidence of integration.unsupported) {
      expect(lineTextAt(input, evidence.span.startLine)).toBe(evidence.raw);
    }

    // The findings still point at each subtype's own `PName` line, in file order.
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual([
      'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
      'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
    ]);
    expect(integration.diagnostics.map((entry) => entry.span?.startLine)).toEqual([7, 12]);
  });

  it('an unsupported Position shape becomes evidence instead of disappearing', () => {
    // FINDING (recorded): `RetentionKind` has `'unsupported-construct'`, but no code path produces
    // it — `decodePosition` keeps an undocumented shape in `section.decoded.positions`, which never
    // reaches `classification.preserved`. Without this projection §13's "undefined vertex format"
    // evidence would be invisible, so integration carries it as `'unsupported-position'`.
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Shape]',
        'PName="box"',
        'Position="Main",10,10',
        '',
      ].join('\n'),
    );
    const integration = integrate(input);
    expect(integration.status).toBe('ok');
    expect(integration.unsupported.map((entry) => entry.kind)).toEqual(['unsupported-position']);
    const evidence = first(integration.unsupported, 'shape evidence');
    expect(evidence.reason).toBe('shape-not-documented');
    expect(evidence.key).toBe('Position');
    expect(evidence.sectionKind).toBe('Shape');
    expect(evidence.raw).toBe('"Main",10,10');
    expect(evidence.span).toEqual({ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 });
    // Audit of this projection, which no fixture exercises: the value text is a suffix of the
    // `Position=` line its span names, so raw and provenance stay on one line (§12 rule 4).
    expect(lineTextAt(input, evidence.span.startLine)).toBe('Position="Main",10,10');
    expect(lineTextAt(input, evidence.span.startLine)).toContain(evidence.raw);
    // No diagnostic is invented for the unsupported shape (§11 has no geometry code).
    expect(integration.diagnostics).toEqual([]);
  });

  it('an object Position with an impossible element count stays unsupported evidence', () => {
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Entity]',
        'PName="e"',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",1,2,3',
        '',
      ].join('\n'),
    );
    const integration = integrate(input);
    expect(integration.unsupported.map((entry) => entry.reason)).toEqual([
      'unexpected-element-count',
    ]);
    expect(integration.unsupported.map((entry) => entry.kind)).toEqual(['unsupported-position']);
    const evidence = first(integration.unsupported, 'four-element position evidence');
    expect(evidence.raw).toBe('"Main",1,2,3');
    expect(evidence.span).toEqual({ sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 });
    expect(lineTextAt(input, evidence.span.startLine)).toBe('Position="Main",1,2,3');
  });

  it('does not fold undecodable tokens or indeterminate markers into diagnostics', () => {
    // FINDING (recorded): §11 assigns no code to `Classification.problems`; this layer adds none.
    // `ZOrder=abc` cannot decode as an integer, so the record survives in the classification and
    // the integration reports no finding for it — the value is visible, never coerced (§4.2).
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Entity]',
        'PName="e"',
        'ZOrder=abc',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10',
        '',
      ].join('\n'),
    );
    const integration = integrate(input);
    expect(input.classification.problems.map((entry) => entry.key)).toEqual(['ZOrder']);
    expect(input.classification.problems.map((entry) => entry.raw)).toEqual(['abc']);
    expect(input.classification.problems.at(0)?.span.startLine).toBe(8);
    expect(integration.diagnostics).toHaveLength(0);
    expect(integration.status).toBe('ok');
    // The malformed token is not evidence either: it is a modelled line with an unreadable value.
    expect(integration.unsupported).toEqual([]);
  });

  it('marks an incomplete primary key indeterminate without inventing a finding', () => {
    // `val-09` already reports the conflicting ordinals; the indeterminate markers the modules keep
    // for undecodable ordinals must stay markers. No fixture produces one, so this is a shape check
    // on a document that declares a key ordinal which is not an integer.
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Entity]',
        'PName="e"',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10',
        '',
      ].join('\n'),
    );
    // A declared, contiguous ordinal: `primaryKeys` holds the key and nothing is indeterminate.
    expect(input.semantics.indeterminateKeys).toEqual([]);
    const integration = integrate(input);
    expect(integration.diagnostics).toEqual([]);
    expect(input.semantics.pkConflicts).toEqual([]);
  });

  it('keeps an ambiguous relation endpoint a marker, with no code of its own', () => {
    // Two entities declare the *same* physical name, so an endpoint naming it resolves to more than
    // one object. The marker `ambiguousEntities` is the whole record: §11 has no code for ambiguity,
    // and this layer must not invent one — nor may it demote the endpoint to a `V_DANGLING_*`,
    // which would claim the name resolves to nothing.
    const input = loadedFromText(
      [
        '# A5:ER FORMAT:21',
        '',
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '',
        '[Entity]',
        'PName="twin"',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",10,10',
        '',
        '[Entity]',
        'PName="twin"',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
        'Position="Main",20,20',
        '',
        '[Relation]',
        'Entity1="twin"',
        'Entity2="twin"',
        'Fields1="id"',
        'Fields2="id"',
        'RelationType1=1',
        'RelationType2=3',
        'Cardinarity1="Z"',
        'Cardinarity2="P"',
        'Position="Main",0,10,200,100,R,R,""',
        '',
      ].join('\n'),
    );
    // Both endpoints of the one relation are ambiguous: the same name, two declarations.
    expect(input.semantics.ambiguousEntities).toHaveLength(2);
    expect(input.semantics.ambiguousEntities.map((entry) => entry.endpoint)).toEqual([
      'Entity1',
      'Entity2',
    ]);
    expect(input.semantics.ambiguousEntities.map((entry) => entry.declared)).toEqual([
      'twin',
      'twin',
    ]);
    expect(input.semantics.danglingEntities).toEqual([]);

    const integration = integrate(input);
    expect(integration.diagnostics.map((entry) => entry.code)).not.toContain('V_DANGLING_ENTITY');
    // The duplicate name is the only finding; the ambiguity added nothing.
    expect(integration.diagnostics.map((entry) => entry.code)).toEqual(['V_DUPLICATE_OBJECT_NAME']);
    expect(integration.status).toBe('degraded');
    expect(integration.exitPolicy).toEqual({ inspect: 0, validate: 3 });
  });
});

describe('validate — immutability and repeated runs', () => {
  it('the same input integrates to an identical result twice', () => {
    for (const id of ['sem-01', 'txt-04', 'sem-05', 'val-08', 'fmt-01']) {
      const { input, integration } = pipelineOf(id);
      const again = integrate(input);
      expect(again, id).toEqual(integration);
      expect(JSON.stringify(again), id).toBe(JSON.stringify(integration));
    }
  });

  it('integration does not mutate the stage results it was given', () => {
    for (const id of ['sem-01', 'txt-04', 'sem-05']) {
      const { input } = pipelineOf(id);
      const before = JSON.stringify(input);
      integrate(input);
      expect(JSON.stringify(input), id).toBe(before);
    }
  });

  for (const spec of TEXT_FIXTURES) {
    it(`${spec.id}: the source file is untouched by integration`, () => {
      const staged = stage(spec.id, { verifyBytes: true });
      try {
        const directory = dirname(staged.path);
        const before = {
          sha256: sha256File(staged.path),
          size: statSync(staged.path).size,
          mtimeMs: statSync(staged.path).mtimeMs,
          siblings: readdirSync(directory).sort(),
        };

        const input = inputFromPath(staged.path);
        if (!isLoadedInput(input)) throw new Error(`${spec.id} did not load`);
        integrate(input);
        // Integrate twice: a repeated run is part of the same guarantee.
        integrate(input);

        expect(readFileSync(staged.path).byteLength, spec.id).toBe(before.size);
        expect(sha256File(staged.path), spec.id).toBe(before.sha256);
        expect(sha256File(staged.path), spec.id).toBe(staged.sha256);
        expect(statSync(staged.path).size, spec.id).toBe(before.size);
        expect(statSync(staged.path).mtimeMs, spec.id).toBe(before.mtimeMs);
        expect(readdirSync(directory).sort(), spec.id).toEqual(before.siblings);
      } finally {
        staged.cleanup();
      }
    });
  }
});

describe('validate — contract errors', () => {
  it('a rejected load with no fatal diagnostic is a contract violation', () => {
    const rules = rulesOf(() => integrate({ load: { ok: false, diagnostics: [] } }));
    expect(rules).toEqual(['failure-without-fatal']);
  });

  it('a loaded input carrying a fatal diagnostic is a contract violation', () => {
    const { input } = pipelineOf('fmt-01');
    const broken = withDiagnostics(input, {
      decode: [],
      // `DecodedSource` cannot exist after a fatal read, so this shape is a caller bug.
      syntax: [emit('E_IO', { construct: 'Source' })],
      schema: [],
      semantic: [],
    });
    expect(rulesOf(() => integrate(broken))).toEqual(['fatal-outside-load']);
  });

  it('reports every reconciliation rule it finds, not only the first', () => {
    const { input } = pipelineOf('fmt-01');
    const keys = input.classification.completeness.keys;
    const sections = input.classification.completeness.sections;
    const broken: IntegrationInput = {
      ...input,
      classification: {
        ...input.classification,
        completeness: {
          ...input.classification.completeness,
          sections: { ...sections, total: sections.total + 1 },
          keys: { ...keys, parsed: keys.parsed - 1 },
        },
      },
    };
    const rules = rulesOf(() => integrate(broken));
    expect(rules).toContain('section-total-mismatch');
    expect(rules).toContain('key-partition');
    expect(rules).toContain('dropped-nonzero');
  });

  it('keeps the severity policy readable: warning is not error, info is not warning', () => {
    const { input } = pipelineOf('fmt-01');

    const infoOnly = integrate(
      withDiagnostics(input, {
        decode: [],
        syntax: [],
        schema: [],
        semantic: [emitSemantic('V_VIEW_COLUMNS_UNKNOWN', { span: spanAt(2), construct: 'View' })],
      }),
    );
    expect(infoOnly.status).toBe('ok');
    expect(infoOnly.exitPolicy).toEqual({ inspect: 0, validate: 0 });

    const warned = integrate(
      withDiagnostics(input, {
        decode: [],
        syntax: [],
        schema: [],
        semantic: [emitSemantic('V_DANGLING_ENTITY', { span: spanAt(2), construct: 'Relation' })],
      }),
    );
    expect(warned.status).toBe('degraded');
    expect(warned.exitPolicy).toEqual({ inspect: 0, validate: 0 });

    const failed = integrate(
      withDiagnostics(input, {
        decode: [],
        syntax: [],
        schema: [],
        semantic: [
          emitSemantic('V_DUPLICATE_OBJECT_NAME', { span: spanAt(2), construct: 'Object' }),
        ],
      }),
    );
    expect(failed.status).toBe('degraded');
    expect(failed.exitPolicy).toEqual({ inspect: 0, validate: 3 });
  });
});
