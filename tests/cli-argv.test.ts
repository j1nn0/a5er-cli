/**
 * P1-A — argv parsing, the help text and `quoteArg`
 * (`docs/proposals/human-cli.md` §3.2, §3.4, §3.5, S-6).
 *
 * Every assertion spawns the built `dist/cli.js`, so what is tested is the shipped artefact: the
 * exit code the process returns and the bytes each stream receives. Nothing here reads a file —
 * which is the point, since §3.2's rules are decided from the tokens alone.
 *
 * The rules pinned here, in the order §3.2 gives them:
 *
 * 1. the scan: `--format` always consumes the next token, so `--format --help` is a bad value and
 *    not help; `--help --format` is a missing value, because a token-level misuse beats help; any
 *    other `-…` token is an unknown option, `-`, `--`, `--format=json`, `-hv` and `--FORMAT`
 *    included; the leftmost violation wins;
 * 2. the post-scan checks: help, version, a command, a non-empty operand, no third operand, and a
 *    format the chosen command accepts;
 * 3. what `tables` and `relations` changed: both are commands now, so each reports its own operand
 *    errors instead of an unknown command, and `inspect`/`validate` refuse `--format text` by name;
 *    instead of an unknown command, and `inspect`/`validate` refuse `--format text` by name;
 * 4. `quoteArg`: printable ASCII is unchanged, and an argument holding a code point of §4.4.2's
 *    escape set reaches stderr as its `\uXXXX` escape, never raw.
 *
 * The help text is compared byte for byte with §3.4's block, plus the `relations` lines this build
 * adds (the proposal is not edited). It is written out here, not blessed from the implementation's
 * output.
 * not blessed from the implementation's output.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the built CLI in a child process with a fixed environment (§3.3: nothing else is read). */
function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
      },
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

/** §3.4's help text, one entry per line; `\n` and the final newline are added below. */
const HELP_LINES = [
  'a5er — read-only CLI for A5:SQL Mk-2 ER diagram (.a5er) files',
  '',
  'Usage:',
  '  a5er inspect [--format json] <file>',
  '  a5er validate [--format json] <file>',
  '  a5er tables [--format text|json] <file>',
  '  a5er columns [--format text|json] <file> <name>',
  '  a5er relations [--format text|json] <file>',
  '  a5er --help',
  '  a5er --version',
  '',
  'Commands:',
  '  inspect          Read the file and emit one JSON envelope',
  '  validate         Read the file, emit one JSON envelope, and exit 3 when an',
  '                   error-severity finding is reported',
  '  tables           List the entities and views the file declares; text by',
  '                   default, one JSON envelope with --format json',
  "  columns          List one entity's columns, selected by exact physical name;",
  '                   text by default, one JSON envelope with --format json',
  "  relations        List every relation the file declares, with its endpoints'",
  '                   resolution; text by default, one JSON envelope with --format',
  '                   json',
  '',
  'Options:',
  '  --format FORMAT  Output format. inspect and validate: json (the default and',
  '                   only format). tables, columns and relations: text (the default)',
  '                   or json',
  '  -h, --help       Show this help and exit',
  '  -v, --version    Print the version and exit',
  '',
  'Exit codes:',
  '  0   The read was not fatal (inspect, tables, columns and relations, degraded',
  '      included) and validate found no error-severity finding',
  '  1   The file could not be read into a schema (fatal diagnostic)',
  '  2   Command-line misuse; nothing is read, and stdout stays empty',
  '  3   validate found an error-severity finding',
  '  4   columns selected no single entity or view; nothing is written to stdout',
  '  70  tables, columns or relations failed internally while generating its output;',
  '      stdout is incomplete',
  '  74  tables, columns or relations could not write its output (a write error other',
  '      than a closed pipe, or stdout closed early); stdout is incomplete',
  '',
  'With --format json, stdout carries exactly one JSON envelope and nothing else.',
  "tables, columns and relations text is one table plus note lines that start with '#'.",
  'Human-readable lines for fatal and error diagnostics go to stderr.',
];

/** The help exactly as §3.4 writes it. */
const HELP = `${HELP_LINES.join('\n')}\n`;

/** §3.4's usage block, as it appears inside a misuse message. */
const USAGE_LINES = [
  'Usage:',
  '  a5er inspect [--format json] <file>',
  '  a5er validate [--format json] <file>',
  '  a5er tables [--format text|json] <file>',
  '  a5er columns [--format text|json] <file> <name>',
  '  a5er relations [--format text|json] <file>',
  '  a5er --help | --version',
];

/** The misuse suffix after the usage block, byte for byte. */
const MISUSE_TAIL = `\nRun 'a5er --help' for details.\n`;

/** Expect exit 2, no stdout, and the given message inside the misuse envelope. */
async function expectMisuse(args: readonly string[], message: string): Promise<string> {
  const result = await runCli(args);

  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`a5er: ${message}\n\n${USAGE_LINES.join('\n')}${MISUSE_TAIL}`);
  return result.stderr;
}

describe('a5er argv — help and usage (§3.4)', () => {
  it("prints §3.4's help text exactly for --help", async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(HELP);
  });

  it('prints the same help for -h and for an empty argv', async () => {
    const short = await runCli(['-h']);
    const bare = await runCli([]);

    expect(short.code).toBe(0);
    expect(short.stdout).toBe(HELP);
    expect(bare.code).toBe(0);
    expect(bare.stdout).toBe(HELP);
  });

  it('shows the tables line in the usage block of a misuse message', async () => {
    const stderr = await expectMisuse(['--nope'], 'unknown option "--nope"');

    expect(stderr).toContain('a5er tables [--format text|json] <file>');
  });

  it('still prints the version for --version and -v', async () => {
    const long = await runCli(['--version']);
    const short = await runCli(['-v']);

    expect(long.code).toBe(0);
    expect(long.stderr).toBe('');
    expect(long.stdout).toBe(`${VERSION}\n`);
    expect(short.stdout).toBe(`${VERSION}\n`);
  });
});

describe('a5er argv — the scan rules of §3.2', () => {
  it('treats --format as consuming the next token, whatever it looks like', async () => {
    // The value is `--help`, so help is never set and the value is refused.
    await expectMisuse(
      ['--format', '--help'],
      'unsupported --format value "--help"; supported values are text and json',
    );
  });

  it('reports a missing --format value even when --help is present', async () => {
    await expectMisuse(['--help', '--format'], '--format requires a value (text or json)');
  });

  it('reports the leftmost violation', async () => {
    await expectMisuse(['--bogus', '--help'], 'unknown option "--bogus"');
    await expectMisuse(
      ['--format', 'yaml', '--bogus'],
      'unsupported --format value "yaml"; supported values are text and json',
    );
  });

  it('accepts a repeated --format value and refuses a conflict', async () => {
    const repeated = await runCli(['--format', 'json', '--format', 'json', '--help']);
    expect(repeated.code).toBe(0);
    expect(repeated.stdout).toBe(HELP);

    await expectMisuse(
      ['--format', 'json', '--format', 'text', '--help'],
      'conflicting --format values "json" and "text"',
    );
    await expectMisuse(
      ['tables', '--format', 'json', '--format', 'text', 'x'],
      'conflicting --format values "json" and "text"',
    );
  });

  it('refuses every other dash-leading token as an unknown option', async () => {
    for (const token of ['-', '--', '--format=json', '-hv', '--FORMAT']) {
      await expectMisuse([token], `unknown option ${JSON.stringify(token)}`);
    }
  });

  it('prints the help when --help is present and no token misuse came first', async () => {
    // `text` is a known value now, so this is help rather than a refusal (§3.5's table).
    const result = await runCli(['--format', 'text', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(HELP);

    // Rule 1 beats the operand checks: `a5er --help bogus` prints the help, as it did before.
    const withOperand = await runCli(['--help', 'bogus']);
    expect(withOperand.code).toBe(0);
    expect(withOperand.stdout).toBe(HELP);
  });
});

describe('a5er argv — the post-scan checks of §3.2', () => {
  it('names every command in the missing-command message', async () => {
    await expectMisuse(
      ['--format', 'json'],
      'missing a command (inspect, validate, tables, columns or relations)',
    );
  });

  it('refuses a word that is not a command', async () => {
    await expectMisuse(['search', '/tmp/never-read.a5er'], 'unknown command "search"');
    await expectMisuse(['export', '/tmp/never-read.a5er'], 'unknown command "export"');
    // `relations` is a command too, so the example is a word the roadmap still holds back.
    await expectMisuse(['annotate', '/tmp/never-read.a5er'], 'unknown command "annotate"');
  });

  it('accepts tables and relations as commands: their operand errors are operand errors', async () => {
    // No `unknown command "tables"` any more, and the parse stops before any file is opened.
    // `relations` takes the same one operand, so the same rule applies to it.
    await expectMisuse(['relations'], 'missing the file operand for relations');
    await expectMisuse(
      ['relations', 'a.a5er', 'b.a5er'],
      'extra operand "b.a5er"; exactly one file is read',
    );
    await expectMisuse(['relations', '--format', 'text'], 'missing the file operand for relations');
    await expectMisuse(['tables'], 'missing the file operand for tables');
    await expectMisuse(
      ['tables', 'a.a5er', 'b.a5er'],
      'extra operand "b.a5er"; exactly one file is read',
    );
    await expectMisuse(['tables', ''], 'the file operand is empty');
    await expectMisuse(
      ['tables', '--format', 'yaml', 'x'],
      'unsupported --format value "yaml"; supported values are text and json',
    );
  });

  it('refuses --format text for inspect and validate, naming the command', async () => {
    await expectMisuse(
      ['inspect', '--format', 'text', '/tmp/never-read.a5er'],
      'unsupported --format value "text" for inspect; only json is supported',
    );
    await expectMisuse(
      ['--format', 'text', 'validate', '/tmp/never-read.a5er'],
      'unsupported --format value "text" for validate; only json is supported',
    );
  });

  it('accepts --format json wherever it is written, as before', async () => {
    // No file is read here: the command runs only when the operand checks and the format check
    // pass, so an unreadable path reaches the loader instead of the parser.
    for (const args of [
      ['tables', '--format', 'json'],
      ['tables', '--format', 'text'],
      ['tables', '--format', 'json', '--format', 'json'],
    ]) {
      const result = await runCli(args);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('missing the file operand for tables');
    }
  });
});

describe('a5er argv — quoteArg and the escape set (§3.5, S-6)', () => {
  /** The quoted literal `stderr` carries after `unknown option `, or a thrown error. */
  function quotedFrom(stderr: string): string {
    const match = /unknown option ("(?:[^"\\]|\\.)*")/.exec(stderr);
    if (match === null || match[1] === undefined) {
      throw new Error(`no quoted argument in ${JSON.stringify(stderr)}`);
    }
    return match[1];
  }

  it('keeps the text of an argument holding a C0 control', async () => {
    const stderr = await expectMisuse(['--bad\ncontrol'], 'unknown option "--bad\\ncontrol"');

    expect(stderr).toContain('"--bad\\ncontrol"');
  });

  it('leaves printable ASCII exactly as JSON.stringify writes it', async () => {
    for (const token of ['--nope', '--bad-option', '--A1_b-c.d']) {
      const stderr = await expectMisuse([token], `unknown option ${JSON.stringify(token)}`);
      expect(quotedFrom(stderr)).toBe(JSON.stringify(token));
    }
  });

  it('escapes the code points JSON.stringify leaves raw, and none of them reaches stderr', async () => {
    // §4.4.2's escape set, as S-6 states the expected bytes for each one.
    const cases: readonly (readonly [string, string])[] = [
      ['\u007f', '\\u007f'],
      ['\u009b', '\\u009b'],
      ['\u202e', '\\u202e'],
      ['\u2066', '\\u2066'],
      ['\ufeff', '\\ufeff'],
      ['\u{e0041}', '\\udb40\\udc41'],
    ];

    for (const [codePoint, escape] of cases) {
      const token = `--bad${codePoint}`;
      const stderr = await expectMisuse([token], `unknown option "--bad${escape}"`);
      const quoted = quotedFrom(stderr);

      expect(quoted).toBe(`"--bad${escape}"`);
      expect(stderr).not.toContain(codePoint);
      // Still a valid JSON string literal, and it decodes back to the argument byte for byte.
      expect(JSON.parse(quoted)).toBe(token);
    }
  });
});
