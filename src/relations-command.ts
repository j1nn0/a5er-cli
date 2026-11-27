/**
 * `relations-command.ts` — `a5er relations`, end to end.
 *
 * **Two phases.** Phase A is eager and runs before any output: the shared pipeline on the `tables`
 * budget, then `integrate()` for the exit policy. Phase B is lazy and runs inside the writer's guard,
 * so a defect in the projection or in a renderer is an output-generation failure (exit `70`) rather
 * than a stack trace. The pattern is `src/tables-command.ts`'s, unchanged.
 *
 * **Why the `tables` budget.** This command reads the same record and lists the relations it already
 * resolved: it builds no envelope string, so the Σ`L²` cap `inspect`/`validate` apply is not part of
 * its work, while the retained relation columns are paid for by the shared pipeline exactly as
 * `tables` pays them. The default *is* that profile, so no ceiling is named twice.
 *
 * **No operand, no selection.** Unlike `columns`, this command answers for the whole document, so
 * there is no exit `4` here: an empty relation list is a complete answer (`[]`), and a relation whose
 * endpoints did not resolve is a finding inside the document, not a reason to write nothing.
 *
 * **Exit codes.** `0`/`1` from the writer for an accepted or closed stdout, `70` for a Phase A defect
 * (or a Phase B throw), `74` for a write failure or an early close. `74` outranks `70`, which
 * outranks the read's code.
 */

import { DEFAULT_RESOURCE_BUDGETS } from './budget/index.js';
import type { OutputStream, WriteOutcome } from './io/stdout.js';
import { OUTPUT_GENERATION_FAILED_LINE, writeOutput } from './io/stdout.js';
import { encodeJson } from './json/index.js';
import { createPipeline } from './pipeline.js';
import { tablesDiagnosticLines } from './text/index.js';
import { renderRelationsText } from './text/relations.js';
import type { Integration, IntegrationInput } from './validate/index.js';
import { integrate } from './validate/index.js';
import { buildRelationsEnvelope } from './view/relations.js';

/** The two output formats `relations` accepts. */
export type RelationsFormat = 'text' | 'json';

/** Phase A, as a seam; tests inject one that throws to reach the guard without a broken document. */
export type RelationsPipeline = (path: string) => IntegrationInput;

/** What one `a5er relations` invocation needs. */
export interface RelationsCommandOptions {
  /** The file operand, echoed and read as given. */
  readonly path: string;
  readonly format: RelationsFormat;
  /** `process.stdout` in the CLI, a deterministic fake in tests. */
  readonly stdout: OutputStream;
  /** `process.stderr` in the CLI, a deterministic fake in tests. */
  readonly stderr: OutputStream;
  /** Defaults to the real stages; the seam the Phase A guard injects a throw through. */
  readonly pipeline?: RelationsPipeline;
  /**
   * Called once, the moment Phase A settles and before any byte is written.
   *
   * The CLI assigns `process.exitCode` from it, so the code the process carries is the read's even if
   * the process dies while the output is still being written. It never changes the value this
   * function returns.
   */
  readonly onPhaseACode?: (code: 0 | 1 | 70) => void;
}

/** The real Phase A: the shared composition on the `tables` profile (`src/pipeline.ts`). */
const defaultPipeline: RelationsPipeline = createPipeline(DEFAULT_RESOURCE_BUDGETS.tables);

/**
 * Run one `a5er relations` invocation and resolve with its exit code.
 *
 * Phase A's guard is the only `try`/`catch`: everything after it is either the writer's own guard
 * (a throw inside Phase B) or a value the writer returns.
 */
export async function runRelationsCommand(options: RelationsCommandOptions): Promise<WriteOutcome> {
  const { path, format, stdout, stderr } = options;
  const pipeline = options.pipeline ?? defaultPipeline;

  // ── Phase A: eager, before any output, guarded ─────────────────────────────────────────────
  let input: IntegrationInput;
  let integration: Integration;
  try {
    input = pipeline(path);
    // One integration, reused by the exit policy and by the stderr line source.
    integration = integrate(input);
  } catch {
    options.onPhaseACode?.(70);
    await writeOutput({
      stdoutChunks: () => [],
      stderrLines: () => [OUTPUT_GENERATION_FAILED_LINE],
      stdout,
      stderr,
      readCode: 0,
    });
    return 70;
  }

  // The read's code is set before the first write, so a process that dies mid-output still reports
  // what the read found rather than the platform's default.
  options.onPhaseACode?.(integration.exitPolicy.inspect);

  // ── Phase B: lazy, pulled chunk by chunk by the writer ────────────────────────────────────
  const stdoutChunks = (): Iterable<string> => {
    // Inside the writer's guard: a throw here is reported as a generation failure, never as prose.
    const envelope = buildRelationsEnvelope(input, integration, { path });
    return format === 'json' ? encodeJson(envelope) : renderRelationsText(envelope);
  };

  return writeOutput({
    stdoutChunks,
    stderrLines: () => tablesDiagnosticLines(integration),
    stdout,
    stderr,
    readCode: integration.exitPolicy.inspect,
  });
}
