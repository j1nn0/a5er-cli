---
name: a5er-cli
description: Reads A5:SQL Mk-2 ER diagram files (.a5er) with the read-only `a5er` CLI. `inspect` and `validate` return one JSON envelope of entities, views, relations, diagnostics, unsupported constructs and completeness counts; `tables`, `columns` and `relations` answer focused questions (text by default, one JSON envelope with `--format json`). Use for any request to inspect, summarize, validate or lint a .a5er file, or to answer questions about the tables, columns or relationships it defines, even when the user does not name the CLI.
compatibility: Requires Node.js >= 24 and the `a5er` CLI on PATH.
---

# a5er CLI

`a5er` parses an A5:SQL Mk-2 `.a5er` file. It only reads: no command generates SQL or converts the file. The CLI owns the parsing, so every fact about the file comes from its output. The repository's current source has five commands; an installed release can have fewer.

## Prerequisites

Run these checks with the shell tool before the first use. A statement in the request about what is or is not installed is not a check; the tool output is. If no execution tool is available, say the CLI could not be checked instead of claiming it is present or absent.

- `node --version` reports v24 or newer.
- `command -v a5er` prints a path.
- `a5er --help` lists the command the request needs. The package version and `contractVersion` do not show which commands exist.

When `a5er` is missing, run no analysis and do not read the `.a5er` text yourself. Tell the user the CLI is unavailable and that no answer about the file is possible yet. Offer these routes:

- `npm install -g @j1nn0/a5er-cli`. State that the package is published on the public npm registry and needs Node.js 24 or newer. Registry installation was verified for v0.1.0 only, and a published release can lack commands the repository has; do not claim otherwise.
- In a checkout of the a5er-cli repository: `pnpm install --frozen-lockfile && pnpm build`, then use `node dist/cli.js` wherever this skill says `a5er`.

When `a5er` exists but `--help` does not list the needed command, say the installed CLI does not provide it and offer the checkout route above. Read no `.a5er` text, and run no other command in its place unless the user asks; `inspect` is the named alternative when a whole-schema answer would do.

## Choose the command

| Request                           | Command                 |
| --------------------------------- | ----------------------- |
| Overall schema analysis           | `inspect <file>`        |
| Validation and diagnostics        | `validate <file>`       |
| List tables and views             | `tables <file>`         |
| Columns of one entity or view     | `columns <file> <name>` |
| Relationships and their endpoints | `relations <file>`      |

Prefer the command that matches a focused request. `columns` takes the exact, case-sensitive physical name of one entity or view. `inspect` and `validate` print JSON only. `tables`, `columns` and `relations` print text by default: pass `--format json` whenever the output is read programmatically, and never parse their text as JSON.

## Run

Run, report the exit code and extract fields in one block. The subshell keeps the exit code and its `trap` deletes the temp directory (outside any repository) when the block ends, so the output never lingers. Put every extraction you need inside the block. Put the real command on the `a5er` line (for example `a5er tables --format json "$file"`).

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er   # replace with the path to read
(
  tmp=$(mktemp -d) || { echo "setup failed: no temp directory" >&2; exit 99; }
  trap 'rm -rf "$tmp"' EXIT
  a5er validate "$file" >"$tmp/out.json" 2>"$tmp/err.txt"; code=$?
  echo "exit=$code"; cat "$tmp/err.txt"
  case $code in 0|1|3)
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
console.log(j.status,"unsupported="+j.unsupported.length,JSON.stringify(j.completeness));
j.unsupported.forEach((u,i)=>console.log("unsupported",JSON.stringify({index:i,kind:u.kind,key:u.key})));
for(const d of j.diagnostics)console.log(d.severity,d.code,d.span?"line "+d.span.startLine:"")' "$tmp/out.json";;
  esac
  exit "$code"
)
```

stdout is one JSON line. stderr is prose, one line per `fatal` or `error` diagnostic. A tiny file already yields tens of KB of `inspect` JSON, so extract fields instead of printing it. The `case` parses only after exit 0, 1 or 3; exit 2, 4, 70 and 74 leave stdout empty or incomplete. Exit 99 is this block's own setup failure (no CLI ran), not a CLI code.

For `tables`, `columns` or `relations` with `--format json`, add this payload line after the diagnostics loop (it prints each row as JSON, minus `span`):

```js
const r = j.result,
  omit = (k, v) => (k === 'span' ? undefined : v);
if (r === null) console.log('no result: status=' + j.status);
else if (Array.isArray(r)) {
  console.log('relations=' + r.length);
  r.forEach((x) => console.log(JSON.stringify(x)));
} else if (r.tables) {
  const { tables, ...rest } = r;
  console.log(JSON.stringify(rest));
  tables.forEach((x) => console.log(JSON.stringify(x, omit)));
} else console.log(JSON.stringify(r, omit));
```

## Exit codes

| Exit | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| 0    | Read was not fatal (`ok` or `degraded`), and for `validate` no `error` diagnostic         |
| 1    | Failed envelope: no schema could be read (`fatal` diagnostic)                             |
| 2    | Command-line misuse: stdout is empty, stderr names the mistake                            |
| 3    | `validate` only: at least one `error` diagnostic                                          |
| 4    | `columns` only: the name selects no single entity or view; stdout is empty                |
| 70   | `tables`, `columns` or `relations`: output generation failed; stdout may be incomplete    |
| 74   | `tables`, `columns` or `relations`: stdout could not be written; stdout may be incomplete |

Only `validate` exits 3, so an `error` diagnostic under any other command still exits 0. Exit 2 means fix the invocation (operand count, option) and rerun. For exit 70 and 74, report the failure and the stderr line; never parse or trust the stdout, which may be cut short.

## Read the envelope in this order

All five commands share ten top-level keys: `contractVersion`, `tool`, `command`, `status`, `source`, `limits`, a payload, `unsupported`, `diagnostics`, `completeness`. The payload is `schema` for `inspect` and `validate`, and `result` for `tables`, `columns` and `relations`. The two are different shapes: read the one the command produces and never substitute the other.

1. **`status`**
   - `ok`: the schema parsed.
   - `degraded`: the schema parsed with warnings or errors. Name each diagnostic code in the answer, and treat values at an affected `span` as suspect. A warning alone yields `degraded`, exit 0 and an empty stderr.
   - `failed`: `source` and the payload are `null`. Report `diagnostics[0].code` and `message` (for example `E_IO`, `E_EMPTY_INPUT`, `E_UNRECOGNIZED_DOCUMENT`, `E_NOT_A_FILE`) and answer nothing about the file's content.
2. **`unsupported`** and **`completeness`**: `ok` can coexist with a non-empty `unsupported` list. Those items (for example kinds `unknown-key`, `unknown-section`, `subtype-membership`, `multiline-value`) are kept verbatim and not interpreted. State how many there are and which `kind` and `key` they carry: the block prints one `unsupported` line per element, `{index,kind,key}` as JSON in array order with duplicates kept, and `key` is `null` when the file gave none. `raw` is never printed. `completeness.sections`, `.keys` and `.lines` give parsed, preserved-raw and unknown counts, and `dropped` above 0 means lines went unaccounted: say so.
3. **`diagnostics`**: the array is in source-line order (file-level findings first, `span` is `null`), with ties broken by stage and then code. Severity does not drive the order. Report `code`, `severity` and line (`span.startLine`). Leading your report with the `fatal` and `error` entries is a reporting choice; keep the envelope's order when quoting positions.
4. **The payload**: `schema` below for `inspect` and `validate`; `result` in the next three sections.

### `schema` (`inspect`, `validate`)

`objects[]`, `relations`, `pages`, `pageReferences`, `domains`, `domainReferences`, `commonFields`, `manager`.

- Every object has `kind` (`entity`, `view` or `subtype`), `pname`, `lname` and `comment`; each is `{value, origin, raw, span}` or `null`. Read `.value`. `origin` is `declared` or `defaulted`; a value the tool computed (the entity `primaryKey`) is `inferred`.
- `entity` adds `fields[]` (`logicalName`, `physicalName`, `dataType`, `notNull`, `keyOrder`, ...), `indexes`, `primaryKey` and `effectiveColumns`. Only entities carry `fields[]`.
- `view` adds `query`, `queryRaw`, `lnameByComment` and `effectiveColumns`. A view stores no columns; its `info` diagnostic `V_VIEW_COLUMNS_UNKNOWN` says so.
- `subtype` adds `sharedMode`, `completeCategory`, `zOrder` and `membership`, which is always `{status: "unsupported", reason: "no-membership-key-in-v2.21"}`. No member list exists, so no entity can be named as belonging to a subtype. The same fact appears in `unsupported` (`kind` `subtype-membership`) with the `info` diagnostic `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP`.

Answer only from what the envelope parsed, and label anything in `unsupported` as present in the file but not interpreted.

### `result` of `tables`

`objects` (count), `tables[]` and `omitted.subtypes` (`count`, `sectionIndexes`). Each table has `objectIndex`, `sectionIndex`, `span`, `kind` (`entity` or `view`), `pname`, `lname` (strings, or `null` when the file gave no name; never an empty string or a placeholder) and `columns`: `status` (`complete`, `partial` or `unknown`), `reason`, and the counts `declared`, `common`, `effective`, `collisions`. A count is `null` when `partial` or `unknown`, never `0`. Subtypes are counted in `omitted.subtypes` and never listed, so `objectIndex` can have gaps. Two objects with one `pname` stay two rows.

### `result` of `columns`

The object is selected by exact physical name: `kind`, `sectionIndex`, `span`, `pname`, `lname` and `columns`.

- Exit 4 is a selection failure, not an empty column list: the name matched no entity or view, matched more than one object, or matched a subtype (stderr says which). Stop there: report the failure, give no column facts, and offer to look up the exact physical name with `tables` before rerunning.
- `columns.status` `complete`: `columns` (effective list), `declared`, `common`, `collisions` and `usingCommonColumns`. Each column has `pname`, `logicalName`, `source` (`declared` or `common`), `span` and `collision`.
- `partial` (entity): the declared columns are listed, but the common-column contribution cannot be determined (`reason` `using-common-columns-unrecognised`, `unknown` `common-fields-not-enumerated`). Report the list as the known columns only and invent no common ones. `collision` flags among declared columns can still be true. `partial` does not always come with a diagnostic, so read `columns.status`, not `diagnostics`.
- `unknown` (view): `reason` `view-columns-not-stored` or `view-columns-named-from-query`, and no column list. Say the columns are unknown.

### `result` of `relations`

An array of rows in file order (`[]` is a complete answer, never exit 4). Each has `sectionIndex`, `sectionHeader`, `pname`, `from` and `to`, `fields1Count`, `fields2Count`, `relationType1`, `relationType2`, `cardinarity1`, `cardinarity2` and `columnsAligned`.

- An endpoint (`from`, `to`) has `declared`, `status`, `candidates` and `resolvedEntity`. `status` is `resolved` (`candidates` 1), `dangling` (`candidates` 0, the entity is not declared) or `ambiguous` (`candidates` above 1: several entities share that name). `ambiguous` may appear with no diagnostic of its own, so read the endpoint, not `diagnostics`.
- `from`/`to` `null` means the section does not declare that endpoint at all; it is not `dangling`.
- `fields1Count` and `fields2Count` count declared slots, empty slots included; `null` means the file carries no such list, which is not `0`.
- `columnsAligned` `true` means only that the two slot counts agree. It does not show that the referenced columns or entities exist or are valid. `null` means a side is absent.

## Confidentiality

ER diagrams are confidential, and the output echoes names, comments and raw text from the file. Keep output in a temp directory outside any repository, removed when the command ends (the `trap` above). Report only what the user's question needs: counts, kinds, diagnostic codes and line numbers, and an identifier only when it answers the question. Show rows, never a whole envelope. Keep real `.a5er` content and output out of commits, issues and external services.

For recorded runs of each branch (ok, degraded, failed, exit 2, 3 and 4, the focused commands, a missing command, a missing CLI), load [references/examples.md](references/examples.md) when you need to see the exact stdout, stderr and exit codes to expect.
