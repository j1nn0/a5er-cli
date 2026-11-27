#!/usr/bin/env node
/**
 * `a5er` command-line entry point.
 *
 * Four commands read a `.a5er` file: `inspect`, `validate`, `tables` and `columns`. All four run
 * the one pipeline `src/pipeline.ts` owns — `loadSource` → `scanSource` → `measure` → `admit` →
 * `classify` → `derivePartialSemantics` — and hand the stage results to `integrate()` for the exit
 * policy and to `serialize()` for the envelope. Nothing about the file is decided here: the exit
 * code is `integrate().exitPolicy[command]` (`architecture.md` §11, §12, §17 TBD-O7), and the bytes
 * on stdout are `toJsonString()` plus the one trailing newline that §12's
 * one-envelope-per-invocation rule implies. A document the admission gate refuses arrives here as a
 * `failed` read, so the refusal needs no case of its own: it is the fatal family's envelope with
 * exit `1`.
 *
 * `inspect` and `validate` differ only in the exit policy and the `command` member. `tables` reads
 * the same bytes and prints a projection of the same envelope — text by default, one JSON document
 * with `--format json` (`docs/proposals/human-cli.md` §3–§5); `columns` prints one selected
 * object's columns the same way. Both are written through the bounded writer of `src/io/stdout.ts`
 * (`src/tables-command.ts`, `src/columns-command.ts`), because they may stream output far larger
 * than one string; `inspect` and `validate` keep their single synchronous write and their
 * one-string stderr unchanged (§3.10, F-1).
 *
 * **Streams** (§3, §12). stdout carries exactly one JSON envelope and never prose, so the whole
 * stream parses as one document. stderr carries prose and nothing else: one line per `fatal` or
 * `error` diagnostic — the two severities that can decide a non-zero exit — and the usage block
 * for command-line misuse. `warning` and `info` findings are not repeated as prose; the envelope
 * is their complete record, and a text renderer is not part of this build (§12).
 *
 * **Exit codes** (§12's table, TBD-O7). `0` for a non-failed `inspect` (`degraded` included) or a
 * `validate` without an `error`; `1` for a `failed` read, which still emits its envelope with
 * `source`, `schema` and `completeness` `null`; `3` for `validate` with an `error`; `2` for
 * misuse, decided here before any input is read, with stdout left empty.
 *
 * **Scope.** `--format json` is accepted and is the only format. The commands the roadmap still
 * holds back are not part of this build: they do not parse as commands, so they exit `2` with the
 * usage block, and the help text names only the three that exist.
 *
 * The executable bit is not stored in this repository. `package.json#bin` points npm/pnpm at
 * `dist/cli.js`, and the package manager sets the mode when the package is linked or installed;
 * `node dist/cli.js` needs no mode at all.
 */

import { DEFAULT_RESOURCE_BUDGETS } from './budget/index.js';
import { VERSION } from './index.js';
import { runColumnsCommand } from './columns-command.js';
import type { JsonColumnsCommand, JsonCommand, JsonTablesCommand } from './json/index.js';
import { serialize, toJsonString } from './json/index.js';
import { createPipeline } from './pipeline.js';
import { runTablesCommand } from './tables-command.js';
import type { Integration } from './validate/index.js';
import { integrate } from './validate/index.js';

// `quoteArg` moved to `src/text/escape.ts` with the rest of the escape set (§6); the import
// re-exports it here so the misuse messages keep their bytes.
import { quoteArg } from './text/index.js';

/** The formats a command can be asked for; `text` is a known value, accepted only by `tables`. */
type OutputFormat = 'text' | 'json';

/** Every command this CLI parses: `JsonCommand` plus the two whose documents are projections. */
type CliCommand = JsonCommand | JsonTablesCommand | JsonColumnsCommand;

const HELP = `a5er — read-only CLI for A5:SQL Mk-2 ER diagram (.a5er) files

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er tables [--format text|json] <file>
  a5er columns [--format text|json] <file> <name>
  a5er --help
  a5er --version

Commands:
  inspect          Read the file and emit one JSON envelope
  validate         Read the file, emit one JSON envelope, and exit 3 when an
                   error-severity finding is reported
  tables           List the entities and views the file declares; text by
                   default, one JSON envelope with --format json
  columns          List one entity's columns, selected by exact physical name;
                   text by default, one JSON envelope with --format json

Options:
  --format FORMAT  Output format. inspect and validate: json (the default and
                   only format). tables and columns: text (the default) or json
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Exit codes:
  0   The read was not fatal (inspect, tables and columns, degraded included)
      and validate found no error-severity finding
  1   The file could not be read into a schema (fatal diagnostic)
  2   Command-line misuse; nothing is read, and stdout stays empty
  3   validate found an error-severity finding
  4   columns selected no single entity or view; nothing is written to stdout
  70  tables or columns failed internally while generating its output; stdout
      is incomplete
  74  tables or columns could not write its output (a write error other than a
      closed pipe, or stdout closed early); stdout is incomplete

With --format json, stdout carries exactly one JSON envelope and nothing else.
tables and columns text is one table plus note lines that start with '#'.
Human-readable lines for fatal and error diagnostics go to stderr.
`;

const USAGE = `Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er tables [--format text|json] <file>
  a5er columns [--format text|json] <file> <name>
  a5er --help | --version`;

/** Long and short spellings accepted by this build. */
const HELP_FLAGS: readonly string[] = ['--help', '-h'];
const VERSION_FLAGS: readonly string[] = ['--version', '-v'];

/**
 * The four commands this build implements, and the only ones the help text may name.
 *
 * Wider than `JsonCommand`, which stays `inspect | validate`: `tables` and `columns` each emit a
 * different document (`docs/proposals/human-cli.md` §5.1), so adding them there would change the
 * schema envelope's contract instead of adding to it.
 */
const COMMANDS: readonly CliCommand[] = ['inspect', 'validate', 'tables', 'columns'];

/**
 * The output-format flag and the values it accepts (§3.2).
 *
 * Both spellings are known before the command is, so `--format text` is a value mismatch for
 * `inspect`/`validate` rather than an unknown value for every command, and `--format text --help`
 * prints the help (§3.5).
 */
const FORMAT_FLAG = '--format';
const FORMATS: readonly OutputFormat[] = ['text', 'json'];

/** What one invocation returns: the exit code and the two streams, as data. */
interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * How argv parsed. The `command` and `tables` arms are the only ones that read a file; the other
 * three are decided from the tokens alone, which is what keeps misuse off the filesystem and
 * stdout empty.
 */
type Parsed =
  | { readonly kind: 'misuse'; readonly message: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'command'; readonly command: JsonCommand; readonly path: string }
  | { readonly kind: 'tables'; readonly path: string; readonly format: OutputFormat }
  | {
      readonly kind: 'columns';
      readonly path: string;
      readonly name: string;
      readonly format: OutputFormat;
    };

/** A token by position, or `null` past the end (`noUncheckedIndexedAccess` made explicit). */
function tokenAt(tokens: readonly string[], index: number): string | null {
  const token = tokens[index];
  return token === undefined ? null : token;
}

function isCommand(token: string): token is CliCommand {
  return COMMANDS.some((command) => command === token);
}

/** True for a value `--format` accepts (§3.2); both are known before the command is. */
function isFormat(value: string): value is OutputFormat {
  return FORMATS.some((format) => format === value);
}

/** Misuse: the message, the usage block, and nothing on stdout. */
function renderMisuse(message: string): string {
  return `a5er: ${message}\n\n${USAGE}\nRun 'a5er --help' for details.\n`;
}

/**
 * Classify argv (without `node` and the script path) — the rules of §3.2, in order.
 *
 * **Scan, left to right.** `--help`/`-h` and `--version`/`-v` set a flag; `--format` always
 * consumes the next token as its value, so `--format --help` is a bad value rather than help and
 * a missing token is the only "no value"; any other `-…` token is misuse. Everything else is an
 * operand, in order. The leftmost violation wins and ends the scan.
 *
 * **Then, in order:** help, version, a command, a non-empty file operand, no third operand, a
 * format the command accepts. Steps 1–7 are the pre-`tables` rules unchanged; the command list,
 * `tables`, and the per-command format check are what this build adds, and every quoted token goes
 * through `quoteArg` (§3.5).
 */
function parse(argv: readonly string[]): Parsed {
  const operands: string[] = [];
  let help = false;
  let version = false;
  let format: OutputFormat | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = tokenAt(argv, index);
    if (token === null) break;

    if (HELP_FLAGS.includes(token)) {
      help = true;
      continue;
    }
    if (VERSION_FLAGS.includes(token)) {
      version = true;
      continue;
    }
    if (token === FORMAT_FLAG) {
      // The flag always consumes the next token, whatever it looks like: `--format --help` is a
      // bad value, not help. Only a token that is not there at all is "no value".
      const value = tokenAt(argv, index + 1);
      if (value === null) {
        return { kind: 'misuse', message: `${FORMAT_FLAG} requires a value (text or json)` };
      }
      index += 1;
      if (!isFormat(value)) {
        return {
          kind: 'misuse',
          message: `unsupported ${FORMAT_FLAG} value ${quoteArg(value)}; supported values are text and json`,
        };
      }
      if (format !== null && format !== value) {
        return {
          kind: 'misuse',
          message: `conflicting ${FORMAT_FLAG} values ${quoteArg(format)} and ${quoteArg(value)}`,
        };
      }
      format = value;
      continue;
    }
    if (token.startsWith('-')) {
      return { kind: 'misuse', message: `unknown option ${quoteArg(token)}` };
    }
    operands.push(token);
  }

  if (help) return { kind: 'help' };
  if (version) return { kind: 'version' };

  const command = tokenAt(operands, 0);
  if (command === null)
    return { kind: 'misuse', message: 'missing a command (inspect, validate, tables or columns)' };
  if (!isCommand(command))
    return { kind: 'misuse', message: `unknown command ${quoteArg(command)}` };

  const path = tokenAt(operands, 1);
  if (path === null) {
    return { kind: 'misuse', message: `missing the file operand for ${command}` };
  }
  if (path === '') return { kind: 'misuse', message: 'the file operand is empty' };

  // `columns` takes a second operand: the exact physical name to select.
  if (command === 'columns') {
    const name = tokenAt(operands, 2);
    if (name === null) return { kind: 'misuse', message: 'missing the name operand for columns' };
    const extra = tokenAt(operands, 3);
    if (extra !== null) {
      return {
        kind: 'misuse',
        message: `extra operand ${quoteArg(extra)}; exactly one file and one name are read`,
      };
    }
    return { kind: 'columns', path, name, format: format ?? 'text' };
  }

  const extra = tokenAt(operands, 2);
  if (extra !== null) {
    return {
      kind: 'misuse',
      message: `extra operand ${quoteArg(extra)}; exactly one file is read`,
    };
  }

  if (command === 'tables') return { kind: 'tables', path, format: format ?? 'text' };

  if (format === 'text') {
    return {
      kind: 'misuse',
      message: `unsupported ${FORMAT_FLAG} value ${quoteArg(format)} for ${command}; only json is supported`,
    };
  }

  return { kind: 'command', command, path };
}

/**
 * The shared composition with this command's budget (`src/pipeline.ts`).
 *
 * `inspect` and `validate` build one envelope string from all four stages, so they take the budget
 * that caps both figures; the stages themselves — and the refusal that can stop them before the
 * classification runs — are not repeated here. The default *is* the envelope profile, so the
 * ceilings and the counters they cap cannot be named apart.
 */
const inputFor = createPipeline(DEFAULT_RESOURCE_BUDGETS.envelope);

/**
 * Prose for the severities that can decide a non-zero exit (§11's Exit column).
 *
 * One line per `fatal` or `error` finding, in the integration's own file order, so the stream
 * agrees with the envelope. `code` and `message` are fixed table text (§11 rule 1); `details` is
 * untrusted file content and is never printed, and a span contributes its line number only.
 */
function renderDiagnostics(integration: Integration): string {
  let prose = '';
  for (const diagnostic of integration.diagnostics) {
    if (diagnostic.severity !== 'fatal' && diagnostic.severity !== 'error') continue;
    const where = diagnostic.span === null ? '' : ` (line ${diagnostic.span.startLine})`;
    prose += `a5er: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}${where}\n`;
  }
  return prose;
}

/**
 * Read `path` once and report it.
 *
 * Two pure entry points, each called once: `integrate()` owns the exit policy and
 * `serialize()` owns the envelope (which integrates the same input internally — the answer is a
 * function of the input, not of the call order). A `failed` read still emits its envelope, so
 * exit `1` never leaves a consumer without the machine-readable reason.
 */
function run(command: JsonCommand, path: string): CliResult {
  const input = inputFor(path);
  const integration = integrate(input);
  const envelope = serialize(input, { command, path });

  return {
    code: integration.exitPolicy[command],
    stdout: `${toJsonString(envelope)}\n`,
    stderr: renderDiagnostics(integration),
  };
}

/**
 * What one invocation is: two streams to write, or a command that owns its own writer.
 *
 * `inspect` and `validate` return the finished bytes, exactly as they always have. `tables` cannot:
 * its output is streamed through `src/io/stdout.ts`, which resolves with the exit code, so the
 * entry point awaits it instead of writing here.
 */
type Invocation =
  | { readonly kind: 'result'; readonly result: CliResult }
  | { readonly kind: 'tables'; readonly path: string; readonly format: OutputFormat }
  | {
      readonly kind: 'columns';
      readonly path: string;
      readonly name: string;
      readonly format: OutputFormat;
    };

/**
 * Map argv (without `node` and the script path) to an exit code and the text
 * written to stdout/stderr.
 *
 * No arguments prints the help and exits 0, which is how a bare `a5er` stays harmless; every
 * other token combination is decided by `parse()`, and misuse never reaches the filesystem.
 */
function main(argv: readonly string[]): Invocation {
  if (argv.length === 0) return { kind: 'result', result: { code: 0, stdout: HELP, stderr: '' } };

  const parsed = parse(argv);
  switch (parsed.kind) {
    case 'misuse':
      return {
        kind: 'result',
        result: { code: 2, stdout: '', stderr: renderMisuse(parsed.message) },
      };
    case 'help':
      return { kind: 'result', result: { code: 0, stdout: HELP, stderr: '' } };
    case 'version':
      return { kind: 'result', result: { code: 0, stdout: `${VERSION}\n`, stderr: '' } };
    case 'command':
      return { kind: 'result', result: run(parsed.command, parsed.path) };
    case 'tables':
      return { kind: 'tables', path: parsed.path, format: parsed.format };
    case 'columns':
      return {
        kind: 'columns',
        path: parsed.path,
        name: parsed.name,
        format: parsed.format,
      };
  }
}

/*
 * `tables` and `columns` write through the bounded writer and resolve with their exit code;
 * `inspect` and `validate` keep the synchronous write below. `process.exit()` is never called: a
 * pipe write is asynchronous on POSIX, so exiting early could cut off output that is still queued
 * (§7.2 rule 1).
 */
const invocation = main(process.argv.slice(2));
if (invocation.kind === 'tables') {
  process.exitCode = await runTablesCommand({
    path: invocation.path,
    format: invocation.format,
    stdout: process.stdout,
    stderr: process.stderr,
    // The read's code is assigned before the first write (§7.2 item 1), so a process that dies
    // mid-output still reports what the read found; the writer's result replaces it below.
    onPhaseACode: (code): void => {
      process.exitCode = code;
    },
  });
} else if (invocation.kind === 'columns') {
  process.exitCode = await runColumnsCommand({
    path: invocation.path,
    name: invocation.name,
    format: invocation.format,
    stdout: process.stdout,
    stderr: process.stderr,
    // The read's or the selection's code is assigned before the first write (§7.2 item 1).
    onPhaseACode: (code): void => {
      process.exitCode = code;
    },
  });
} else {
  const result = invocation.result;
  if (result.stdout !== '') {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== '') {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.code;
}
