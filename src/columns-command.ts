/**
 * `columns-command.ts` — `a5er columns`, end to end.
 *
 * **Two phases and one selection.** Phase A is eager and runs before any output: the shared pipeline
 * on the `tables` budget, `integrate()` for the exit policy, then the pure selection of
 * `view/columns.ts`. Phase B is lazy and runs inside the writer's guard, so a defect in the
 * projection or in a renderer is an output-generation failure (exit `70`) rather than a stack trace.
 *
 * **Why the `tables` budget.** This command reads the same record and publishes one object's columns:
 * it builds no envelope string, so the Σ`L²` cap `inspect`/`validate` apply is not part of its work,
 * while the common-column composition and the retained relation columns are paid for by the shared
 * pipeline exactly as `tables` pays them. The default *is* that profile, so no ceiling is named twice.
 *
 * **Selection is not a diagnostic.** A name that matches nothing, matches more than one object, or
 * names a subtype is a question this command cannot answer with a column list; it writes **nothing**
 * to stdout (in either format), one concise escaped line to stderr, and exits `4`. A fatal read takes
 * precedence: the failed document is emitted and the exit is `1`, because "this file cannot be read"
 * is a fact about the input, not a property of the operand.
 *
 * **Exit codes.** `0`/`1` from the writer for an accepted or closed stdout, `4` for a selection that
 * is not exactly one entity or view, `70` for a Phase A defect (or a Phase B throw), `74` for a write
 * failure or an early close. `74` outranks `70`, which outranks the read's code; `4` is returned
 * whatever the stderr write does, because the answer is the selection's.
 */

import { DEFAULT_RESOURCE_BUDGETS } from './budget/index.js';
import type { OutputStream, WriteOutcome } from './io/stdout.js';
import { OUTPUT_GENERATION_FAILED_LINE, writeOutput } from './io/stdout.js';
import { encodeJson } from './json/index.js';
import { createPipeline } from './pipeline.js';
import { renderColumnsText } from './text/columns.js';
import { tablesDiagnosticLines } from './text/index.js';
import { quoteArg } from './text/index.js';
import type { ColumnsSelection } from './view/columns.js';
import { buildColumnsEnvelope, selectColumnsObject } from './view/columns.js';
import type { Integration, IntegrationInput } from './validate/index.js';
import { integrate, isLoadedInput } from './validate/index.js';

/** The two output formats `columns` accepts. */
export type ColumnsFormat = 'text' | 'json';

/** Phase A, as a seam; tests inject one that throws to reach the guard without a broken document. */
export type ColumnsPipeline = (path: string) => IntegrationInput;

/** What one `a5er columns` invocation needs. */
export interface ColumnsCommandOptions {
  /** The file operand, echoed and read as given. */
  readonly path: string;
  /** The exact physical name to select; compared decoded and case-sensitively. */
  readonly name: string;
  readonly format: ColumnsFormat;
  /** `process.stdout` in the CLI, a deterministic fake in tests. */
  readonly stdout: OutputStream;
  /** `process.stderr` in the CLI, a deterministic fake in tests. */
  readonly stderr: OutputStream;
  /** Defaults to the real stages; the seam the Phase A guard injects a throw through. */
  readonly pipeline?: ColumnsPipeline;
  /**
   * Called once, the moment Phase A settles and before any byte is written.
   *
   * The CLI assigns `process.exitCode` from it, so the code the process carries is the read's (or the
   * selection's) even if the process dies while the output is still being written. It never changes
   * the value this function returns.
   */
  readonly onPhaseACode?: (code: 0 | 1 | 4 | 70) => void;
}

/** The real Phase A: the shared composition on the `tables` profile (`src/pipeline.ts`). */
const defaultPipeline: ColumnsPipeline = createPipeline(DEFAULT_RESOURCE_BUDGETS.tables);

/**
 * The one stderr line a selection failure writes.
 *
 * Concise, escaped with `quoteArg` (a JSON string literal, so no code point reaches the terminal
 * raw), and never a list of objects' names: only the section indexes of the candidates, which are
 * this tool's own numbering.
 */
function selectionErrorLine(selection: ColumnsSelection, name: string): string {
  const quoted = quoteArg(name);
  switch (selection.kind) {
    case 'none':
      return `a5er: error: no object is named ${quoted}\n`;
    case 'subtype':
      return `a5er: error: ${quoted} is a subtype (section ${String(selection.sectionIndex)}); a subtype declares no columns\n`;
    case 'ambiguous': {
      const sections = selection.sectionIndexes.map((index) => String(index)).join(', ');
      return `a5er: error: ${String(selection.sectionIndexes.length)} objects are named ${quoted}; candidates are sections ${sections}\n`;
    }
    default:
      // `selected` is the success arm and never reaches here; explicit for the compiler.
      return '';
  }
}

/**
 * Run one `a5er columns` invocation and resolve with its exit code.
 *
 * Phase A's guard is the only `try`/`catch`: selection runs inside it so a defect in the pure layer is
 * the same internal-error answer as a defect in a stage, and everything after is either the writer's
 * own guard or a value the writer returns.
 */
export async function runColumnsCommand(options: ColumnsCommandOptions): Promise<WriteOutcome | 4> {
  const { path, name, format, stdout, stderr } = options;
  const pipeline = options.pipeline ?? defaultPipeline;

  // ── Phase A: eager, before any output, guarded ─────────────────────────────────────────────
  let input: IntegrationInput;
  let integration: Integration;
  let selection: ColumnsSelection | null;
  try {
    input = pipeline(path);
    integration = integrate(input);
    // A fatal read is answered as a document, not as a selection question: the failure wins.
    selection =
      isLoadedInput(input) && integration.status !== 'failed'
        ? selectColumnsObject(input.semantics.identities, name)
        : null;
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

  // ── A selection that is not exactly one entity or view: no document, exit 4 ───────────────
  if (selection !== null && selection.kind !== 'selected') {
    options.onPhaseACode?.(4);
    // Nothing on stdout, in either format: a selection failure is not a document. The line goes
    // through the writer so stderr keeps its bounded-chunk rules; the answer stays 4 even if that
    // write fails, because there is no output to have been lost.
    await writeOutput({
      stdoutChunks: () => [],
      stderrLines: () => [selectionErrorLine(selection, name)],
      stdout,
      stderr,
      readCode: 0,
    });
    return 4;
  }

  // The read's code is set before the first write, so a process that dies mid-output still reports
  // what the read found rather than the platform's default.
  options.onPhaseACode?.(integration.exitPolicy.inspect);

  // ── Phase B: lazy, pulled chunk by chunk by the writer ────────────────────────────────────
  const stdoutChunks = (): Iterable<string> => {
    // Inside the writer's guard: a throw here is reported as a generation failure, never as prose.
    const envelope = buildColumnsEnvelope(input, integration, {
      path,
      identity: selection !== null && selection.kind === 'selected' ? selection.identity : null,
    });
    return format === 'json' ? encodeJson(envelope) : renderColumnsText(envelope);
  };

  return writeOutput({
    stdoutChunks,
    stderrLines: () => tablesDiagnosticLines(integration),
    stdout,
    stderr,
    readCode: integration.exitPolicy.inspect,
  });
}
