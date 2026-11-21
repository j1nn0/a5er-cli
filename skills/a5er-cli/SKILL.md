---
name: a5er-cli
description: Reads A5:SQL Mk-2 ER diagram files (.a5er) with the read-only `a5er` CLI, which returns one JSON envelope of entities, views, relations, diagnostics, unsupported constructs and completeness counts. Use for any request to inspect, summarize, validate or lint a .a5er file, or to answer questions about the tables, columns or relationships it defines, even when the user does not name the CLI.
compatibility: Requires Node.js >= 24 and the `a5er` CLI on PATH.
---

# a5er CLI

`a5er` parses an A5:SQL Mk-2 `.a5er` file and prints one JSON envelope. It only reads. The CLI owns the parsing, so every fact about the file comes from its envelope.

## Prerequisites

Run both checks with the shell tool before the first use. A statement in the request about what is or is not installed is not a check; the tool output is. If no execution tool is available, say the CLI could not be checked instead of claiming it is present or absent.

- `node --version` reports v24 or newer.
- `command -v a5er` prints a path.

When `a5er` is missing, run no analysis and do not read the `.a5er` text yourself. Tell the user the CLI is unavailable and that no answer about the file is possible yet. Offer these routes:

- `npm install -g @j1nn0/a5er-cli`. State that the package is published on the public npm registry and needs Node.js 24 or newer. Registry installation was verified for v0.1.0 only; do not claim it is verified for a later version.
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
j.unsupported.forEach((u,i)=>console.log("unsupported",JSON.stringify({index:i,kind:u.kind,key:u.key})));
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
2. **`unsupported`** and **`completeness`**: `ok` can coexist with a non-empty `unsupported` list. Those items (for example kinds `unknown-key`, `unknown-section`, `subtype-membership`, `multiline-value`) are kept verbatim and not interpreted. State how many there are and which `kind` and `key` they carry: the block prints one `unsupported` line per element, `{index,kind,key}` as JSON in array order with duplicates kept, and `key` is `null` when the file gave none. `raw` is never printed. `completeness.sections`, `.keys` and `.lines` give parsed, preserved-raw and unknown counts, and `dropped` above 0 means lines went unaccounted: say so.
3. **`diagnostics`**: the array is in source-line order (file-level findings first, `span` is `null`), with ties broken by stage and then code. Severity does not drive the order. Report `code`, `severity` and line (`span.startLine`). Leading your report with the `fatal` and `error` entries is a reporting choice; keep the envelope's order when quoting positions.
4. **`schema`**: `objects[]`, `relations`, `pages`, `pageReferences`, `domains`, `domainReferences`, `commonFields`, `manager`.
   - Every object has `kind` (`entity`, `view` or `subtype`), `pname`, `lname` and `comment`; each is `{value, origin, raw, span}` or `null`. Read `.value`. `origin` is `declared` or `defaulted`; a value the tool computed (the entity `primaryKey`) is `inferred`.
   - `entity` adds `fields[]` (`logicalName`, `physicalName`, `dataType`, `notNull`, `keyOrder`, ...), `indexes`, `primaryKey` and `effectiveColumns`. Only entities carry `fields[]`.
   - `view` adds `query`, `queryRaw`, `lnameByComment` and `effectiveColumns`. A view stores no columns; its `info` diagnostic `V_VIEW_COLUMNS_UNKNOWN` says so.
   - `subtype` adds `sharedMode`, `completeCategory`, `zOrder` and `membership`, which is always `{status: "unsupported", reason: "no-membership-key-in-v2.21"}`. No member list exists, so no entity can be named as belonging to a subtype. The same fact appears in `unsupported` (`kind` `subtype-membership`) with the `info` diagnostic `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP`.

Answer only from what the envelope parsed, and label anything in `unsupported` as present in the file but not interpreted.

## List tables and views

When the request is "what tables and views are in this file?", keep the run block above, put `a5er inspect "$file"` on its subcommand line and replace its `node -e` command with this one. The first four lines are the ones already there; the rest prints one JSON object per line for each `entity` or `view`, in the original `schema.objects` order: `index` (the original array index), `sectionIndex` (the 1-based section ordinal), `kind`, `pname`, `lname` and `columns`, then a last JSON line with `objects`, `listed` and `omitted.subtypes`.

```sh
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
console.log(j.status,"unsupported="+j.unsupported.length,JSON.stringify(j.completeness));
j.unsupported.forEach((u,i)=>console.log("unsupported",JSON.stringify({index:i,kind:u.kind,key:u.key})));
for(const d of j.diagnostics)console.log(d.severity,d.code,d.span?"line "+d.span.startLine:"");
if(j.schema===null)console.log("no listing: status="+j.status);
else{const nm=v=>v?v.value:null,o=j.schema.objects,omitted={subtypes:0};let listed=0;
for(const[i,x]of o.entries()){if(x.kind==="subtype"){omitted.subtypes++;continue;}const e=x.effectiveColumns;
const c=x.kind==="view"?{status:e.status,reason:e.reason}:e.status==="partial"?
{status:e.status,reason:e.reason,declared:e.declared.length}:
{status:e.status,declared:e.declared.length,effective:e.columns.length};
listed++;console.log(JSON.stringify({index:i,sectionIndex:x.sectionIndex,kind:x.kind,pname:nm(x.pname),lname:nm(x.lname),columns:c}));}
console.log(JSON.stringify({objects:o.length,listed,omitted}));}' "$tmp/out.json"
```

- `pname` and `lname` are JSON strings or `null`; `null` means the file gave no name, and it is never `0`, an empty string or a placeholder. Quotes, newlines, control characters and separators inside a name are escaped, so each row parses back to its exact names (`"a | b"` with `"c"` differs from `"a"` with `"b | c"`). An object with no `PName` is still a row, and two objects with the same `pname` stay two rows in array order.
- `entity` with `status` `complete` has `declared` beside `effective`; with `partial` the composition is withheld, so `columns` holds `declared` and `reason` and no `effective` member. `view` has `status` `unknown` and a `reason` and no count, because a view stores no columns.
- `subtype` objects are never listed and never get a row: they are only counted in `omitted.subtypes`, so printed indexes can have gaps and are not renumbered. Their `membership` stays unsupported (item 2).
- The `status`, `unsupported`, `completeness` and diagnostic lines are the ones items 1-3 describe: report them there. A `failed` envelope (`schema` is `null`) prints `no listing` and no row (item 1).
- `degraded` still lists, but name each `warning` and `error` code and treat values at an affected `span` as suspect (item 1). A view's `V_VIEW_COLUMNS_UNKNOWN` is expected (item 4), and `subtype-membership` in `unsupported` means no member list exists (item 2).
- Names are printed because the listing is the answer. The temp directory and `trap` still apply: show the rows, never the envelope.

## Confidentiality

ER diagrams are confidential, and the envelope echoes names, comments and raw text from the file. Keep envelopes in a temp directory outside any repository, removed when the command ends (the `trap` above). Report counts, kinds, diagnostic codes and line numbers, and quote an identifier only when the user's question needs it. Keep real `.a5er` content and envelopes out of commits, issues and external services.

For recorded runs of each branch (ok, degraded, failed, exit 3, exit 2, missing CLI), load [references/examples.md](references/examples.md) when you need to see the exact stdout, stderr and exit codes to expect.
