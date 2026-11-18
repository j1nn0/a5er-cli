# a5er-cli

A read-only command-line tool for A5:SQL Mk-2 ER diagram (`.a5er`) files. It parses one file and
writes one JSON envelope to stdout — entities, views, relations, diagnostics, unsupported constructs
and completeness counts — so a person, a script or an agent can read a diagram without the GUI. The
input file is never modified.

## What ships today

Two commands read a file:

| Invocation                             | What it does                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `a5er inspect [--format json] <file>`  | Reads the file and emits one JSON envelope                                         |
| `a5er validate [--format json] <file>` | Emits the same envelope, and also exits `3` when a diagnostic has severity `error` |
| `a5er --help`, `-h`                    | Prints the help and exits `0`; `a5er` with no arguments does the same              |
| `a5er --version`, `-v`                 | Prints the version and exits `0`                                                   |

Both commands take exactly one file. `--format json` is accepted and is the only format — it is also
the default; there is no text renderer.

`a5er` is the name `package.json` declares for its `bin` entry (`./dist/cli.js`). In a checkout, run
`node dist/cli.js` with the same arguments; that is the form every example below uses.

**Not shipped in this build:** `tables`, `table`, `relations`, `search` and `export`. None of them
is a command yet, so each exits `2` with the usage block on stderr and nothing on stdout, and none
of them appears in `--help`.

## Install

The CLI is not on npm, so it comes from a checkout. Two commands that readers are likely to try
first are documented below with the reason they do not work, so a failure is not mistaken for a
local mistake.

### Verified: run the CLI from a checkout

The package is not published to npm — `package.json` is `"private": true` and the registry has no
`@j1nn0/a5er-cli` — so the CLI is run from source. The branch that carries the build described here
is `phase2`; `main` does not contain `src/cli.ts` yet.

Requirements: Node.js 24 or newer (`engines.node`) and pnpm 11.28.12 (`packageManager`).

```bash
git clone https://github.com/j1nn0/a5er-cli.git
cd a5er-cli
git checkout phase2
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js --version                       # 0.1.0
node dist/cli.js inspect tests/fixtures/synthetic/fmt-01-baseline.a5er
```

Run the block from any directory outside an existing checkout; the clone creates `a5er-cli`, and the
last two commands run from its root. That last command reads a synthetic fixture committed here, so
it works on a fresh checkout — replace the path with your own diagram. The small file already
produces about 22 KB of JSON, so extract fields instead of printing the whole envelope.

### Unavailable: install the package from npm

```bash
npm install -g @j1nn0/a5er-cli
```

UNAVAILABLE. `package.json` is `"private": true` and nothing is published: `npm view @j1nn0/a5er-cli`
answers `E404`, so this install fails today.

### Unverified: install the agent skill from the default branch

```bash
npx skills@latest add j1nn0/a5er-cli -s a5er-cli
```

UNVERIFIED. `main` carries no `skills/a5er-cli`, so a real run stops with `SKILLS_NO_VALID_SKILLS`.
The verified form names the branch that carries both the CLI and the skill — see
[Agent skill](#agent-skill).

## Output and exit codes

`stdout` carries exactly one JSON envelope and nothing else: the stream is one JSON document plus
the single newline that ends it, so a consumer can parse it whole. Prose goes to `stderr`, one line
per `fatal` or `error` diagnostic — the two severities that can decide a non-zero exit. `warning`
and `info` findings are recorded only in the envelope.

Every envelope has the same ten top-level keys: `contractVersion`, `tool`, `command`, `status`,
`source`, `limits`, `schema`, `unsupported`, `diagnostics` and `completeness`. `status` is `ok`,
`degraded` or `failed`; a `failed` envelope is still valid JSON, with `source`, `schema` and
`completeness` `null`, so automation never has to tell "no output" from "crashed".
`contractVersion` is versioned independently of the package version.

| Exit | `inspect`                                          | `validate`                      | What is written                                                                          |
| ---- | -------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `0`  | any read that is not `failed`, `degraded` included | no `error`-severity diagnostic  | one envelope on stdout; stderr only for a `fatal`/`error` line                           |
| `1`  | any `fatal` diagnostic                             | any `fatal` diagnostic          | one envelope with `source`, `schema` and `completeness` `null`; the fatal line on stderr |
| `3`  | never                                              | any `error`-severity diagnostic | one envelope with `status` `degraded`; the error line on stderr                          |
| `2`  | —                                                  | —                               | nothing on stdout; the usage block on stderr. Decided before any input is read           |

`inspect` never exits `3`: an `error` finding under `inspect` still exits `0` and puts the same line
on stderr. The split is deliberate — `inspect` reports what is in the file, `validate` decides
whether it is acceptable. The full contract, with the field order and the completeness accounting,
is in [architecture §12](docs/architecture.md#12-json-contract-initial).

## Reading the envelope

Extract the fields you need instead of printing the document. Run this from the repository root:

```bash
(
  file=tests/fixtures/synthetic/fmt-01-baseline.a5er
  tmp=$(mktemp -d) || exit 70
  trap 'rm -rf "$tmp"' EXIT
  node dist/cli.js validate "$file" >"$tmp/envelope.json" 2>"$tmp/diagnostics.txt"; code=$?
  echo "exit=$code"
  cat "$tmp/diagnostics.txt"
  if [ "$code" -ne 2 ] && [ -s "$tmp/envelope.json" ]; then
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
console.log(j.status, j.completeness ? "dropped=" + j.completeness.dropped : "");
for (const d of j.diagnostics) console.log(d.severity, d.code, d.span ? "line " + d.span.startLine : "");' "$tmp/envelope.json"
  fi
  exit "$code"
)
```

`file=` and the temporary directory are both assigned inside the parentheses, so the whole example
is a subshell: the `EXIT` trap deletes the temporary directory the moment the block finishes, and
neither a variable nor a trap is left behind in your shell. The last line is `exit "$code"`, so the
subshell hands back the CLI's status rather than the status of the last helper command. The
redirects capture the CLI's own streams to files — stdout to `envelope.json`, stderr to
`diagnostics.txt` — so everything the block prints is the wrapper's stdout: the `echo` of the exit
code, the diagnostics that `cat` copies back, and the parsed fields. The wrapper writes nothing on
stderr.

With the committed fixture above the block prints `exit=0`, copies back no diagnostic line, then
`ok dropped=0` and `info V_VIEW_COLUMNS_UNKNOWN line 35`. Point `file=` at
`tests/fixtures/synthetic/sem-08-duplicate-pname.a5er` for the failure branch: `exit=3`, the
error line, `degraded dropped=0`, and the `error` and `info` diagnostics. A misuse (exit `2`)
writes nothing to the CLI's stdout, so the guard skips `JSON.parse` and the block prints only the
usage text plus `exit=2`. Set `file=` to your own diagram to run it against another file.

## Agent skill

[`skills/a5er-cli/SKILL.md`](skills/a5er-cli/SKILL.md) is an agent skill for this CLI: it checks the
prerequisites, runs the command, and reads the envelope in a fixed order so an agent answers only
from what was parsed. Every branch — `ok`, `degraded`, `failed`, exit `3`, exit `2`, missing CLI —
has its stdout, stderr and exit code recorded in
[`references/examples.md`](skills/a5er-cli/references/examples.md).

Install it into the current project with the `skills` installer, from the branch that carries it:

```bash
npx skills@latest add j1nn0/a5er-cli#phase2 -s a5er-cli
```

`add` resolves `phase2` at install time and records the ref plus the commit it resolved in
`skills-lock.json`. Because `phase2` is a moving branch, a later `add` resolves whatever `phase2`
points at then and overwrites the recorded commit, so the saved `skills-lock.json` is what pins the
install. To restore the commit a lock records, keep the file and run:

```bash
npx skills@latest experimental_install --frozen-lockfile
```

`experimental_install` restores the skills listed in `skills-lock.json` (`install` and `i` are
aliases). It needs a saved lock: `--frozen-lockfile` makes the command fail with exit `1` rather
than write a new `skills-lock.json` when none is saved, and CI enables it by default. Restored that
way, the installed files match `skills/a5er-cli` in this repository. The unpinned form is the
UNVERIFIED command above.

The skill runs `a5er`, so it needs the CLI on `PATH`. In a checkout, use `node dist/cli.js` in its
place — the skill documents that substitution itself.

## Development

A change must pass these gates. CI runs exactly them on Node.js 24 and 26 under Linux and Windows:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint          # oxlint src tests
pnpm format:check  # oxfmt
pnpm test          # pretest runs pnpm build, then vitest
```

## Design principles

- **Accuracy first:** never silently invent or discard schema information. A construct the parser
  does not model is kept verbatim in `unsupported` with its span, and `completeness` reconciles
  every section, key and line to zero dropped.
- **Read-only:** no command writes to the input file.
- **Traceability:** every interpreted value carries its origin and the raw text it came from, and
  every node the file declares carries a span.
- **Machine-readable:** one stable JSON envelope per invocation, with prose kept off stdout.

## Documentation

- [Architecture](docs/architecture.md) — modules, data model, diagnostics and the JSON contract
  (§12). This is the current description of the shipped pipeline.
- [Format coverage](docs/format-coverage.md) — what the v2.21 specification defines, item by item,
  and what remains unconfirmed.
- [Parser evaluation](docs/parser-evaluation.md) — why the parser is built from the specification
  instead of depending on an existing one.
- [Test strategy](docs/test-strategy.md) — test levels, fixture policy and the gates a change must
  pass. Its opening status paragraph predates the parser; the policy and gates are current.
- [Golden provenance](docs/json-golden-provenance.md) — one row per committed golden, with the
  counts a reader can re-derive from the fixture's own bytes.
- [A5:SQL Mk-2 ER Diagram File Specification](https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.html)

## Confidentiality

ER diagrams are confidential, and an envelope echoes names, comments and raw text from the file.
`.a5er` files are gitignored; the only tracked ones are the 39 synthetic fixtures under
`tests/fixtures/synthetic/`, each on an explicit allowlist in `.gitignore`. Any other `.a5er` file, a
real diagram included, stays ignored. Do not commit, paste or quote a real `.a5er` file or an
envelope produced from one; keep such envelopes outside the repository and delete them when the
command ends.

## License

MIT License. See [LICENSE](LICENSE).
