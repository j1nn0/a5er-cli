---
name: a5er-cli
description: Reads A5:SQL Mk-2 ER diagram files (.a5er) with the read-only `a5er` CLI, which returns one JSON envelope of entities, views, relations, diagnostics, unsupported constructs and completeness counts. Use for any request to inspect, summarize, validate or lint a .a5er file, or to answer questions about the tables, columns or relationships it defines, even when the user does not name the CLI.
compatibility: Requires Node.js >= 24 and the `a5er` CLI on PATH.
---

# a5er CLI

`a5er` parses an A5:SQL Mk-2 `.a5er` file and prints one JSON envelope. It only reads. The CLI owns the parsing, so every fact about the file comes from its envelope.

## Prerequisites

Check both before the first run:

- `node --version` reports v24 or newer.
- `command -v a5er` prints a path.

When `a5er` is missing, tell the user the CLI is unavailable and that no answer about the file is possible yet. Offer these routes:

- `npm install -g @j1nn0/a5er-cli`. UNVERIFIED: the package is private and unpublished, so this may fail.
- In a checkout of the a5er-cli repository: `pnpm install --frozen-lockfile && pnpm build`, then use `node dist/cli.js` wherever this skill says `a5er`.

## Run

- `a5er inspect <file>` reads the file and emits the envelope.
- `a5er validate <file>` emits the same envelope and exits 3 when a diagnostic has severity `error`.

Pick `validate` for "is this file OK?" and `inspect` for "what is in it?". Both take exactly one file. `--format json` is the default and the only format.

Run, report the exit code and extract fields in one block. The subshell keeps the exit code and its `trap` deletes the temp directory (outside any repository) when the block ends, so the envelope never lingers. Put every extraction you need inside the block.

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er   # replace with the path to read
(
  tmp=$(mktemp -d) || exit 70
  trap 'rm -rf "$tmp"' EXIT
  a5er validate "$file" >"$tmp/out.json" 2>"$tmp/err.txt"; code=$?
  echo "exit=$code"; cat "$tmp/err.txt"
  if [ "$code" -ne 2 ]; then
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
console.log(j.status,"unsupported="+j.unsupported.length,JSON.stringify(j.completeness));
for(const d of j.diagnostics)console.log(d.severity,d.code,d.span?"line "+d.span.startLine:"")' "$tmp/out.json"
  fi
  exit "$code"
)
```

stdout is one JSON line. stderr is prose, one line per `fatal` or `error` diagnostic. A tiny file already yields tens of KB of JSON, so extract fields instead of printing it.

## Exit codes

| Exit | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| 0    | Read was not fatal (`ok` or `degraded`), and for `validate` no `error` diagnostic |
| 1    | Failed envelope: no schema could be read (`fatal` diagnostic)                     |
| 2    | Command-line misuse: stdout is empty, stderr names the mistake                    |
| 3    | `validate` only: at least one `error` diagnostic                                  |

`inspect` never exits 3, so an `error` diagnostic under `inspect` still exits 0. Exit 2 means fix the invocation (operand count, option) and rerun; stdout is empty, so the extraction is skipped.

## Read the envelope in this order

Top-level keys: `contractVersion`, `tool`, `command`, `status`, `source`, `limits`, `schema`, `unsupported`, `diagnostics`, `completeness`.

1. **`status`**
   - `ok`: the schema parsed.
   - `degraded`: the schema parsed with warnings or errors. Name each diagnostic code in the answer, and treat values at an affected `span` as suspect.
   - `failed`: `source` and `schema` are `null`. Report `diagnostics[0].code` and `message` (for example `E_IO`, `E_EMPTY_INPUT`, `E_UNRECOGNIZED_DOCUMENT`, `E_NOT_A_FILE`) and answer nothing about the file's content.
2. **`unsupported`** and **`completeness`**: `ok` can coexist with a non-empty `unsupported` list. Those items (for example kinds `unknown-key`, `unknown-section`, `subtype-membership`, `multiline-value`) are kept verbatim and not interpreted. State how many there are and which `kind` and `key` they carry. `completeness.sections`, `.keys` and `.lines` give parsed, preserved-raw and unknown counts, and `dropped` above 0 means lines went unaccounted: say so.
3. **`diagnostics`**: the array is in source-line order (file-level findings first, `span` is `null`), with ties broken by stage and then code. Severity does not drive the order. Report `code`, `severity` and line (`span.startLine`). Leading your report with the `fatal` and `error` entries is a reporting choice; keep the envelope's order when quoting positions.
4. **`schema`**: `objects[]`, `relations`, `pages`, `pageReferences`, `domains`, `domainReferences`, `commonFields`, `manager`.
   - Every object has `kind` (`entity`, `view` or `subtype`), `pname`, `lname` and `comment`; each is `{value, origin, raw, span}` or `null`. Read `.value`. `origin` is `declared` or `defaulted`; a value the tool computed (the entity `primaryKey`) is `inferred`.
   - `entity` adds `fields[]` (`logicalName`, `physicalName`, `dataType`, `notNull`, `keyOrder`, ...), `indexes`, `primaryKey` and `effectiveColumns`. Only entities carry `fields[]`.
   - `view` adds `query`, `queryRaw`, `lnameByComment` and `effectiveColumns`. A view stores no columns; its `info` diagnostic `V_VIEW_COLUMNS_UNKNOWN` says so.
   - `subtype` adds `sharedMode`, `completeCategory`, `zOrder` and `membership`, which is always `{status: "unsupported", reason: "no-membership-key-in-v2.21"}`. No member list exists, so no entity can be named as belonging to a subtype. The same fact appears in `unsupported` (`kind` `subtype-membership`) with the `info` diagnostic `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP`.

Answer only from what the envelope parsed, and label anything in `unsupported` as present in the file but not interpreted.

## Confidentiality

ER diagrams are confidential, and the envelope echoes names, comments and raw text from the file. Keep envelopes in a temp directory outside any repository, removed when the command ends (the `trap` above). Report counts, kinds, diagnostic codes and line numbers, and quote an identifier only when the user's question needs it. Keep real `.a5er` content and envelopes out of commits, issues and external services.

For recorded runs of each branch (ok, degraded, failed, exit 3, exit 2, missing CLI), load [references/examples.md](references/examples.md) when you need to see the exact stdout, stderr and exit codes to expect.
