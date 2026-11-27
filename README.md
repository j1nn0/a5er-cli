# a5er-cli

A read-only command-line tool for A5:SQL Mk-2 ER diagram (`.a5er`) files. It parses one file and
writes either one JSON envelope or a short table listing, so a person, a script or an agent can read
a diagram without the GUI. The input file is never modified.

- **Complete accounting:** the envelope holds entities, views, relations, diagnostics, unsupported
  constructs and completeness counts. A construct the parser does not model is kept verbatim in
  `unsupported` with its span, never reported as interpreted.
- **Traceable and machine-readable:** values carry their origin and raw text; `inspect` and
  `validate` write JSON, `tables` writes text by default or JSON with `--format json`, and prose
  goes to stderr, never stdout.

> **Confidentiality:** ER diagrams are confidential, and an envelope echoes names, comments, raw
> text and the file's path. `tables --format json` carries the same evidence; the `tables` text
> listing prints only the physical and logical names, the counts and the diagnostic lines. Do not
> commit, paste or quote a real `.a5er` file, an envelope or a listing produced from one; keep such
> output outside the repository and delete it when you are done. `.a5er` files are gitignored; only
> synthetic fixtures are tracked.

## Disclaimer

a5er-cli is an independent, unofficial project and is not affiliated with or endorsed by the author of A5:SQL Mk-2.

A5:SQL Mk-2 is developed by Masakazu Matsubara. For information about the original software, visit the [official website](https://a5m2.mmatsubara.com/).

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

`diagram.a5er` below stands for your own file. Each command reads exactly one file; `columns` also
takes the exact physical name of the one object to list.

```bash
a5er inspect diagram.a5er     # emit the JSON envelope
a5er validate diagram.a5er    # same envelope; also exits 3 on an error diagnostic
a5er tables diagram.a5er      # list the entities and views: one table plus notes
a5er tables --format json diagram.a5er   # the same listing as one JSON envelope
a5er columns diagram.a5er users          # one object's columns, by exact physical name
a5er columns --format json diagram.a5er users   # the same selection as one JSON envelope
a5er --help                   # also -h, or run a5er with no arguments
a5er --version                # also -v
```

`--format` is per command. `inspect` and `validate` accept only `json`, which is also their default;
`tables` and `columns` accept `text` (the default) or `json`. `columns` compares the name exactly and
case-sensitively: a name that matches no entity or view, more than one object, or a subtype writes
nothing to stdout and exits 4. The commands the roadmap still holds back — such as `export` — do not
exist yet: any other word exits 2 with the usage text on stderr.

To read one field without keeping the envelope, pipe stdout only:

```bash
a5er inspect diagram.a5er | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).status"
```

Nothing is written to disk, so output from a confidential diagram cannot end up in a checkout or a
commit. Do not merge stderr into stdout (`2>&1`): the diagnostic prose would break JSON parsing.

## Output

`inspect` and `validate` write exactly one JSON envelope and a final newline to `stdout`. `tables`
and `columns` write one table followed by notes — every note starts with `#` — or, with
`--format json`, one envelope of their own shape. `--help` and `--version` print plain text to
`stdout`, while a misused command exits 2 with the usage text on `stderr` and nothing on `stdout`.
`stderr` carries one line per `fatal` or `error` diagnostic; `warning` and `info` findings appear
only in the envelope (and, in the text listings, in their notes).

Every envelope has the keys `contractVersion`, `tool`, `command`, `status`, `source`, `limits`,
`unsupported`, `diagnostics` and `completeness`, plus one payload key at the seventh position:
`schema` for `inspect` and `validate`, `result` for `tables` and `columns`. `status` is `ok`,
`degraded` (readable, with findings) or `failed`. A `failed` envelope is still valid JSON, with
`source`, the payload and `completeness` set to `null`. A consumer selects its decoder from
`(command, contractVersion)`; `contractVersion` is versioned per command and independently of the
package. The full contract is in
[docs/architecture.md](docs/architecture.md#12-json-contract-initial), and the `tables` shape in
[docs/proposals/human-cli.md](docs/proposals/human-cli.md). `columns` reuses the inspected object's
own `effectiveColumns` record, so an entity's `complete`/`partial` arms and a view's `unknown` arm
mean exactly what they mean in an `inspect` envelope.

| Exit | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| `0`  | Envelope written. `inspect`: any read that is not `failed`; `validate`: no `error` diagnostic |
| `1`  | Any `fatal` diagnostic; the envelope is `failed`                                             |
| `2`  | Incorrect usage; nothing on stdout, usage text on stderr, decided before any input is read   |
| `3`  | `validate` only: an `error`-severity diagnostic; the envelope is `degraded`                  |
| `4`  | `columns` only: the name selected no single entity or view; nothing is written to stdout       |
| `70` | `tables` and `columns`: the output could not be generated; stdout must be discarded           |
| `74` | `tables` and `columns`: the stdout write failed, or stdout closed before the output completed  |

`inspect` never exits 3: it reports what is in the file, while `validate` decides whether it is
acceptable. An `error` finding under `inspect` still exits 0 and appears on stderr.

`70` and `74` belong to the two listing commands. After either one — and after a pipe that was
closed early — `stdout` may hold any prefix of the output, or nothing, so discard it rather than
parsing it. A closed pipe is not an error: `a5er tables big.a5er | head -n 3` exits `0` (or `1` for
a file that could not be read), and a writer that leaves mid-listing does not crash the process.
Even exit `0` means "written to the stream", not "delivered to a reader".

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
