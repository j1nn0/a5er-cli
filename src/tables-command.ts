/**
 * `tables-command.ts` — `a5er tables`, end to end (`docs/proposals/human-cli.md` §2, §6, §7.2).
 *
 * **Two phases, one writer.** Phase A is eager and runs before any output: the same four stages
 * `inspect` uses, then `integrate()` for the exit policy. Phase B is lazy and runs *inside* the
 * writer's guard, so a defect in `serialize()`, in the projection or in a renderer becomes an
 * output-generation failure (exit `70`) instead of a stack trace: the tables envelope is a pure
 * function of the inspect envelope, and the CLI stays the only parser.
 *
 * **Why the writer is separate.** `src/io/stdout.ts` owns the §7.2 state machine — the single
 * terminal stdout state, backpressure, `EPIPE` versus an early close, and the rule that a stderr
 * callback error must release a pending wait. This module only decides *what* to write and which
 * read code to fall back on; it never touches `process`, so tests can pass fakes.
 *
 * **Phase A's own guard (§7.2 item 10).** A throw from the pipeline or from `integrate()` is an
 * internal defect, not a finding about the file. It writes nothing to stdout and only the
 * generation-failure line to stderr — through the same writer, so the stderr rules (bounded chunks,
 * the stopping flag, failures ignored) still hold — and exits `70` even when that write fails.
 *
 * Exit codes are the writer's: `0` or `1` for an accepted or closed stdout, `74` for a write
 * failure or an early close, `70` for a generation failure. `74` outranks `70`, which outranks the
 * read's code.
 */

import { loadSource } from './decode/load.js';
import type { OutputStream, WriteOutcome } from './io/stdout.js';
import { OUTPUT_GENERATION_FAILED_LINE, writeOutput } from './io/stdout.js';
import { encodeJson, serialize } from './json/index.js';
import { classify } from './schema/index.js';
import { derivePartialSemantics } from './semantic/index.js';
import { scanSource } from './syntax/index.js';
import { renderTablesText, tablesDiagnosticLines } from './text/index.js';
import type { Integration, IntegrationInput } from './validate/index.js';
import { integrate } from './validate/index.js';
import { toTablesEnvelope } from './view/index.js';

/** The two output formats `tables` accepts (§3.2, §3.3). */
export type TablesFormat = 'text' | 'json';

/**
 * Phase A, as a seam.
 *
 * The real implementation is the CLI's own pipeline; tests inject one that throws, which is how
 * R-20 reaches the Phase A guard without a broken document.
 */
export type TablesPipeline = (path: string) => IntegrationInput;

/** What one `a5er tables` invocation needs (§6). */
export interface TablesCommandOptions {
  /** The operand, echoed and read as given; never resolved further (§12 `source.path`). */
  readonly path: string;
  readonly format: TablesFormat;
  /** `process.stdout` in the CLI, a deterministic fake in tests. */
  readonly stdout: OutputStream;
  /** `process.stderr` in the CLI, a deterministic fake in tests. */
  readonly stderr: OutputStream;
  /** Defaults to the real stages; the seam R-20 injects a throw through. */
  readonly pipeline?: TablesPipeline;
}

/**
 * The real Phase A: `loadSource` → `scanSource` → `classify` → `derivePartialSemantics`.
 *
 * The same composition `src/cli.ts` has always used for `inspect`; a rejected load stops here and
 * is reported by the diagnostics it already carries.
 */
function defaultPipeline(path: string): IntegrationInput {
  const load = loadSource(path);
  if (!load.ok) return { load };

  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

/**
 * Run one `a5er tables` invocation and resolve with its exit code.
 *
 * Phase A's guard is the only `try`/`catch` here: everything after it is either the writer's own
 * guard (a throw inside Phase B) or a value the writer returns.
 */
export async function runTablesCommand(options: TablesCommandOptions): Promise<WriteOutcome> {
  const { path, format, stdout, stderr } = options;
  const pipeline = options.pipeline ?? defaultPipeline;

  // ── Phase A: eager, before any output, guarded (§7.2 item 10) ──────────────────────────────
  let input: IntegrationInput;
  let integration: Integration;
  try {
    input = pipeline(path);
    // One integration, reused by the exit policy and by the stderr line source.
    integration = integrate(input);
  } catch {
    // Nothing on stdout. The line goes through the writer so stderr keeps its §7.2 item 8 rules,
    // and the exit stays 70 even when that write fails: there is nowhere left to report it.
    await writeOutput({
      stdoutChunks: () => [],
      stderrLines: () => [OUTPUT_GENERATION_FAILED_LINE],
      stdout,
      stderr,
      readCode: 0,
    });
    return 70;
  }

  // ── Phase B: lazy, pulled chunk by chunk by the writer (§2) ────────────────────────────────
  const stdoutChunks = (): Iterable<string> => {
    // Inside the writer's guard: a throw here is reported as a generation failure, never as prose.
    const document = toTablesEnvelope(serialize(input, { command: 'inspect', path }));
    return format === 'json' ? encodeJson(document) : renderTablesText(document);
  };

  return writeOutput({
    stdoutChunks,
    stderrLines: () => tablesDiagnosticLines(integration),
    stdout,
    stderr,
    readCode: integration.exitPolicy.inspect,
  });
}
