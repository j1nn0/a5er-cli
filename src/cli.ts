#!/usr/bin/env node
/**
 * `a5er` command-line entry point.
 *
 * Phase 1 scope: `--help` and `--version` only. The `.a5er` parser and every
 * analysis command (`inspect`, `tables`, `relations`, `search`, `validate`,
 * `export`) are not implemented yet, so this build cannot read a file.
 *
 * The executable bit is not stored in this repository. `package.json#bin`
 * points npm/pnpm at `dist/cli.js`, and the package manager sets the mode when
 * the package is linked or installed; `node dist/cli.js` needs no mode at all.
 */

import { VERSION } from './index.js';

const HELP = `a5er — read-only CLI for A5:SQL Mk-2 ER diagram (.a5er) files

Usage:
  a5er --help
  a5er --version

Options:
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Status: Phase 1 scaffold only. The .a5er parser and every analysis command
(inspect, tables, relations, search, validate, export) are NOT implemented
yet, so no file can be read with this build.
`;

const USAGE = 'Usage: a5er [--help | --version]';

/** Long and short spellings accepted by this build. */
const HELP_FLAGS: readonly string[] = ['--help', '-h'];
const VERSION_FLAGS: readonly string[] = ['--version', '-v'];

/**
 * Quote a user-supplied argument so that control characters cannot reach the
 * terminal raw. `JSON.stringify` is used instead of string interpolation on
 * purpose: the argument is untrusted input.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

function renderUnknown(token: string): string {
  return `a5er: unknown option ${quote(token)}\n\n${USAGE}\nRun 'a5er --help' for details.\n`;
}

/**
 * Map argv (without `node` and the script path) to an exit code and the text
 * written to stdout/stderr.
 *
 * Rules, in order:
 *   1. no arguments            -> help on stdout, exit 0
 *   2. any unrecognised token  -> usage on stderr, exit 2
 *   3. --help present          -> help on stdout, exit 0
 *   4. --version present       -> version on stdout, exit 0
 *
 * An unknown token always wins over a recognised one, so a typo cannot be
 * silently ignored.
 */
function main(argv: readonly string[]): { code: number; stdout: string; stderr: string } {
  if (argv.length === 0) {
    return { code: 0, stdout: HELP, stderr: '' };
  }

  const unknown = argv.find(
    (token) => !HELP_FLAGS.includes(token) && !VERSION_FLAGS.includes(token),
  );
  if (unknown !== undefined) {
    return { code: 2, stdout: '', stderr: renderUnknown(unknown) };
  }

  if (argv.some((token) => HELP_FLAGS.includes(token))) {
    return { code: 0, stdout: HELP, stderr: '' };
  }

  return { code: 0, stdout: `${VERSION}\n`, stderr: '' };
}

const result = main(process.argv.slice(2));
if (result.stdout !== '') {
  process.stdout.write(result.stdout);
}
if (result.stderr !== '') {
  process.stderr.write(result.stderr);
}
process.exitCode = result.code;
