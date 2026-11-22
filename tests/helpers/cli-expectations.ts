/**
 * `tests/helpers/cli-expectations.ts` — the stderr and exit code of every `inspect`/`validate` run
 * (`docs/proposals/human-cli.md` §8.5).
 *
 * **Hand-written, not transformed.** Each entry is a literal. Nothing here derives stderr from a
 * golden, from `renderDiagnostics()` or from any product output at run time: the file states the
 * bytes the CLI must write, and `tests/cli-byte-regression.test.ts` compares them with
 * `Buffer.compare`. A change to the CLI's stderr shows up as a diff instead of being blessed, and a
 * change to this table is visible in review as a change to the expectation itself.
 *
 * **Where the values come from.** The diagnostics each fixture records — severity, code, message
 * and line, as the fixture's own golden and the registry hold them — plus `architecture.md` §12's
 * exit rules, applied by hand:
 *
 * - `inspect` is `1` for a `failed` read and `0` otherwise, `degraded` included;
 * - `validate` is `1` for a `failed` read, `3` when an `error`-severity finding exists, `0`
 *   otherwise;
 * - `stderr` is one line per `fatal`/`error` finding, `a5er: <severity>: <code>: <message>`, plus
 *   ` (line <n>)` when the finding has a span. `warning`/`info` never appear.
 *
 * Only six of the 44 fixtures carry a `fatal`/`error` finding: `enc-03`, `enc-04`, `enc-05`,
 * `hst-02`, `sem-08` and `sem-09`. Every other entry is the empty stderr with both codes `0`.
 */

/** What one command must write to stderr and exit with, for one fixture. */
export interface CliExpectation {
  /** The exact stderr bytes; empty when the fixture has no `fatal`/`error` finding. */
  readonly stderr: string;
  readonly exitCode: number;
}

/** One fixture's two runs. */
export interface FixtureCliExpectation {
  readonly inspect: CliExpectation;
  readonly validate: CliExpectation;
}

/** Every fixture with committed bytes, by catalog ID: 39 synthetic and 5 byte fixtures. */
export const CLI_EXPECTATIONS: Readonly<Record<string, FixtureCliExpectation>> = {
  'enc-02': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'enc-03': {
    inspect: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 4)\n',
      exitCode: 0,
    },
    validate: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 4)\n',
      exitCode: 3,
    },
  },
  'enc-04': {
    inspect: {
      stderr: 'a5er: fatal: E_UNDECODABLE: No supported encoding decodes the input without loss\n',
      exitCode: 1,
    },
    validate: {
      stderr: 'a5er: fatal: E_UNDECODABLE: No supported encoding decodes the input without loss\n',
      exitCode: 1,
    },
  },
  'enc-05': {
    inspect: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n',
      exitCode: 0,
    },
    validate: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n',
      exitCode: 3,
    },
  },
  'fmt-01': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'fmt-02': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'fmt-03': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'fmt-04': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'fmt-05': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'hst-01': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'hst-02': {
    inspect: {
      stderr: 'a5er: fatal: E_BINARY_INPUT: The input is binary and cannot be treated as text\n',
      exitCode: 1,
    },
    validate: {
      stderr: 'a5er: fatal: E_BINARY_INPUT: The input is binary and cannot be treated as text\n',
      exitCode: 1,
    },
  },
  'hst-04': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'hst-05': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-01': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-02': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-03': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-04': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-05': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-06': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-07': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-08': {
    inspect: {
      stderr:
        'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n',
      exitCode: 0,
    },
    validate: {
      stderr:
        'a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n',
      exitCode: 3,
    },
  },
  'sem-09': {
    inspect: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n',
      exitCode: 0,
    },
    validate: {
      stderr:
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)\n',
      exitCode: 3,
    },
  },
  'sem-10': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'sem-11': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-01': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-02': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-03': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-04': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-05': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-06': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-07': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-08': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'txt-09': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-01': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-02': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-03': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-04': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-05': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-06': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-07': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-08': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-09': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-10': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
  'val-11': {
    inspect: { stderr: '', exitCode: 0 },
    validate: { stderr: '', exitCode: 0 },
  },
};
