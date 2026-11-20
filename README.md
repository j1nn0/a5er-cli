# a5er-cli

A read-only command-line tool for A5:SQL Mk-2 ER diagram (`.a5er`) files. It parses one file and
writes one JSON envelope to stdout, so a person, a script or an agent can read a diagram without the
GUI. The input file is never modified.

- **Complete accounting:** the envelope holds entities, views, relations, diagnostics, unsupported
  constructs and completeness counts. A construct the parser does not model is kept verbatim in
  `unsupported` with its span, never reported as interpreted.
- **Traceable and machine-readable:** values carry their origin and raw text; JSON is the only
  output format, and prose goes to stderr, never stdout.

> **Confidentiality:** ER diagrams are confidential, and an envelope echoes names, comments and raw
> text from the file. Do not commit, paste or quote a real `.a5er` file or an envelope produced from
> one; keep such envelopes outside the repository and delete them when you are done. `.a5er` files
> are gitignored; only synthetic fixtures are tracked.

## Installation

The executable is `a5er`, from the npm package `@j1nn0/a5er-cli`. It requires Node.js 24 or later.

```bash
npm install -g @j1nn0/a5er-cli
```

```bash
mise use -g 'npm:@j1nn0/a5er-cli'
```

To run from a source checkout (pnpm 11.28.12) instead:

```bash
git clone https://github.com/j1nn0/a5er-cli.git
cd a5er-cli
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js --version
```

In a checkout, use `node dist/cli.js` wherever this README says `a5er`.

Verified so far: installing v0.1.0 from the public npm registry and from a locally built tarball,
and installing v0.1.0 with mise on macOS arm64 (mise 2026.11.10), where only the installation and
`a5er --version` were checked. Other versions and platforms have not been verified separately. If
mise does not yet resolve a just-published release as the latest, pin the exact version
(`npm:@j1nn0/a5er-cli@X.Y.Z`).

## Usage

`diagram.a5er` below stands for your own file. Each command takes exactly one file.

```bash
a5er inspect diagram.a5er     # emit the JSON envelope
a5er validate diagram.a5er    # same envelope; also exits 3 on an error diagnostic
a5er --help                   # also -h, or run a5er with no arguments
a5er --version                # also -v
```

`--format json` is accepted but is the default and only format. No other command exists yet: any
other word, such as `tables` or `export`, exits 2 with the usage text on stderr.

To keep the envelope, redirect stdout only:

```bash
a5er inspect diagram.a5er > envelope.json
node -p "JSON.parse(require('fs').readFileSync('envelope.json', 'utf8')).status"
```

Do not merge stderr into stdout (`2>&1`): the diagnostic prose would break JSON parsing.

## Output

`stdout` carries exactly one JSON envelope and a final newline. `stderr` carries one line per `fatal`
or `error` diagnostic; `warning` and `info` findings appear only in the envelope.

Every envelope has the keys `contractVersion`, `tool`, `command`, `status`, `source`, `limits`,
`schema`, `unsupported`, `diagnostics` and `completeness`. `status` is `ok`, `degraded` (readable,
with findings) or `failed`. A `failed` envelope is still valid JSON, with `source`, `schema` and
`completeness` set to `null`. `contractVersion` is versioned independently of the package. The full
contract is in [docs/architecture.md](docs/architecture.md#12-json-contract-initial).

| Exit | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| `0`  | Envelope written. `inspect`: any read that is not `failed`; `validate`: no `error` diagnostic |
| `1`  | Any `fatal` diagnostic; the envelope is `failed`                                             |
| `2`  | Incorrect usage; nothing on stdout, usage text on stderr, decided before any input is read   |
| `3`  | `validate` only: an `error`-severity diagnostic; the envelope is `degraded`                  |

`inspect` never exits 3: it reports what is in the file, while `validate` decides whether it is
acceptable. An `error` finding under `inspect` still exits 0 and appears on stderr.

## Agent Skill

[`skills/a5er-cli/SKILL.md`](skills/a5er-cli/SKILL.md) is an agent skill that runs the CLI and reads
the envelope in a fixed order, so an agent answers only from what was parsed. Its expected outputs
for each case are in [`references/examples.md`](skills/a5er-cli/references/examples.md).

```bash
npx skills@latest add j1nn0/a5er-cli -s a5er-cli
```

The skill and the CLI are installed separately. The skill only invokes `a5er`, so install the CLI
and keep it on `PATH`. In a checkout, the skill documents the `node dist/cli.js` substitution.

The installer records the resolved commit in `skills-lock.json`. To restore that commit later, keep
the file and run `npx skills@latest experimental_install --frozen-lockfile`. Installing from the
default branch with `--agent '*' -y` has been verified.

## Development

CI runs these gates on Node.js 24 and 26 under Linux and Windows:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

## Documentation

- [Architecture](docs/architecture.md): modules, data model, diagnostics and the JSON contract
- [Format coverage](docs/format-coverage.md): what the specification defines, and what is unconfirmed
- [Parser evaluation](docs/parser-evaluation.md): why the parser is built from the specification
- [Test strategy](docs/test-strategy.md): test levels, fixture policy and quality gates
- [Golden provenance](docs/json-golden-provenance.md): one row per committed golden
- [A5:SQL Mk-2 ER Diagram File Specification](https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.html)

## License

MIT License. See [LICENSE](LICENSE).
