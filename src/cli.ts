#!/usr/bin/env node
/**
 * `a5er` command-line entry point.
 *
 * Two commands read a `.a5er` file: `inspect` and `validate`. Both run the one pipeline the
 * library already has — `loadSource` → `scanSource` → `classify` → `derivePartialSemantics` —
 * and hand the stage results to `integrate()` for the exit policy and to `serialize()` for the
 * envelope. Nothing about the file is decided here: the exit code is
 * `integrate().exitPolicy[command]` (`architecture.md` §11, §12, §17 TBD-O7), and the bytes on
 * stdout are `toJsonString()` plus the one trailing newline that §12's
 * one-envelope-per-invocation rule implies.
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
 * usage block, and the help text names only the two that exist.
 *
 * The executable bit is not stored in this repository. `package.json#bin` points npm/pnpm at
 * `dist/cli.js`, and the package manager sets the mode when the package is linked or installed;
 * `node dist/cli.js` needs no mode at all.
 */

import { loadSource } from './decode/load.js';
import { VERSION } from './index.js';
import type { JsonCommand } from './json/index.js';
import { serialize, toJsonString } from './json/index.js';
import { classify } from './schema/index.js';
import { derivePartialSemantics } from './semantic/index.js';
import { scanSource } from './syntax/index.js';
import type { Integration, IntegrationInput } from './validate/index.js';
import { integrate } from './validate/index.js';

const HELP = `a5er — read-only CLI for A5:SQL Mk-2 ER diagram (.a5er) files

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help
  a5er --version

Commands:
  inspect          Read the file and emit one JSON envelope
  validate         Read the file, emit one JSON envelope, and exit 3 when an
                   error-severity finding is reported

Options:
  --format json    Output format; json is the only format and the default
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Exit codes:
  0   The read was not fatal (inspect, degraded included) and validate found
      no error-severity finding
  1   The file could not be read into a schema (fatal diagnostic)
  2   Command-line misuse; nothing is read, and stdout stays empty
  3   validate found an error-severity finding

stdout carries exactly one JSON envelope and nothing else. Human-readable lines
for the fatal and error diagnostics that decide exit 1 or 3 go to stderr.
`;

const USAGE = `Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version`;

/** Long and short spellings accepted by this build. */
const HELP_FLAGS: readonly string[] = ['--help', '-h'];
const VERSION_FLAGS: readonly string[] = ['--version', '-v'];

/** The two commands this build implements, and the only ones the help text may name. */
const COMMANDS: readonly JsonCommand[] = ['inspect', 'validate'];

/** The output-format flag and the one value it accepts (§12: `json` is the default). */
const FORMAT_FLAG = '--format';
const FORMATS: readonly string[] = ['json'];

/** What one invocation returns: the exit code and the two streams, as data. */
interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * How argv parsed. `command` is the only arm that reads a file; the other four are decided from
 * the tokens alone, which is what keeps misuse off the filesystem and stdout empty.
 */
type Parsed =
  | { readonly kind: 'misuse'; readonly message: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'command'; readonly command: JsonCommand; readonly path: string };

/**
 * Quote a user-supplied argument so that control characters cannot reach the
 * terminal raw. `JSON.stringify` is used instead of string interpolation on
 * purpose: the argument is untrusted input.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

/** A token by position, or `null` past the end (`noUncheckedIndexedAccess` made explicit). */
function tokenAt(tokens: readonly string[], index: number): string | null {
  const token = tokens[index];
  return token === undefined ? null : token;
}

function isCommand(token: string): token is JsonCommand {
  return COMMANDS.some((command) => command === token);
}

/** Misuse: the message, the usage block, and nothing on stdout. */
function renderMisuse(message: string): string {
  return `a5er: ${message}\n\n${USAGE}\nRun 'a5er --help' for details.\n`;
}

/**
 * Classify argv (without `node` and the script path).
 *
 * Rules, in order, so a typo can never be silently ignored:
 *   1. an unrecognised `-…` token, or `--format` without a supported value -> misuse
 *   2. `--help`/`-h` present (and nothing in 1)                          -> help
 *   3. `--version`/`-v` present (and nothing in 1)                       -> version
 *   4. the first operand names the command, the second the file          -> run it
 *
 * `--format json` may appear before, between or after the operands; it carries no information
 * today, so accepting only the documented spelling keeps the refusal list short.
 */
function parse(argv: readonly string[]): Parsed {
  const operands: string[] = [];
  let help = false;
  let version = false;

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
      const value = tokenAt(argv, index + 1);
      if (value === null) {
        return { kind: 'misuse', message: `${FORMAT_FLAG} requires a value (json)` };
      }
      if (!FORMATS.includes(value)) {
        return {
          kind: 'misuse',
          message: `unsupported ${FORMAT_FLAG} value ${quote(value)}; only json is supported`,
        };
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      return { kind: 'misuse', message: `unknown option ${quote(token)}` };
    }
    operands.push(token);
  }

  if (help) return { kind: 'help' };
  if (version) return { kind: 'version' };

  const command = tokenAt(operands, 0);
  if (command === null)
    return { kind: 'misuse', message: 'missing a command (inspect or validate)' };
  if (!isCommand(command)) return { kind: 'misuse', message: `unknown command ${quote(command)}` };

  const path = tokenAt(operands, 1);
  if (path === null) {
    return { kind: 'misuse', message: `missing the file operand for ${command}` };
  }
  if (path === '') return { kind: 'misuse', message: 'the file operand is empty' };

  const extra = tokenAt(operands, 2);
  if (extra !== null) {
    return { kind: 'misuse', message: `extra operand ${quote(extra)}; exactly one file is read` };
  }

  return { kind: 'command', command, path };
}

/** The four stage results, or the rejected load that stopped the pipeline (§11's fatal family). */
function inputFor(path: string): IntegrationInput {
  const load = loadSource(path);
  if (!load.ok) return { load };

  const scan = scanSource(load.source);
  const classification = classify(scan);
  return { load, scan, classification, semantics: derivePartialSemantics(classification) };
}

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
 * Map argv (without `node` and the script path) to an exit code and the text
 * written to stdout/stderr.
 *
 * No arguments prints the help and exits 0, which is how a bare `a5er` stays harmless; every
 * other token combination is decided by `parse()`, and misuse never reaches the filesystem.
 */
function main(argv: readonly string[]): CliResult {
  if (argv.length === 0) return { code: 0, stdout: HELP, stderr: '' };

  const parsed = parse(argv);
  switch (parsed.kind) {
    case 'misuse':
      return { code: 2, stdout: '', stderr: renderMisuse(parsed.message) };
    case 'help':
      return { code: 0, stdout: HELP, stderr: '' };
    case 'version':
      return { code: 0, stdout: `${VERSION}\n`, stderr: '' };
    case 'command':
      return run(parsed.command, parsed.path);
  }
}

const result = main(process.argv.slice(2));
if (result.stdout !== '') {
  process.stdout.write(result.stdout);
}
if (result.stderr !== '') {
  process.stderr.write(result.stderr);
}
process.exitCode = result.code;
