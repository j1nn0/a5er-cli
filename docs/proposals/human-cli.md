# Proposal — human-friendly CLI, P0: `a5er tables`

> **Status: proposed specification. Not implemented.** Nothing in this document is shipped
> behaviour. `a5er tables` does not exist in any released version: today it exits `2` with
> `unknown command "tables"`. This file changes no code, contract, golden, README, Skill or
> version. Where the proposal needs one of those to change, §9 lists the change and says that it
> needs agreement first.

| | |
|---|---|
| Baseline | `main` at `617b1eb0f8d754140c7b7ddc40418a87af2f0482` |
| Package | `@j1nn0/a5er-cli` `0.1.2` |
| Contract | `CONTRACT_VERSION` `0.1.0`, and it stays `0.1.0` (§5.9) |
| Scope | P0 = `tables` only. `columns` and `relations` are outlined in §10 and are not specified |

Normative words: **must**, **must not** and **never** are requirements on the implementation.
"Today" means the baseline above.

---

## 0. Accepted decisions this proposal builds on

1. The first human-oriented command is `tables`, and only `tables`.
2. The default output of `tables` is text.
3. `tables --format json` exists.
4. The format is never chosen automatically from a TTY.
5. `tables` lists entities and views. Subtypes are omitted, and the omission is recorded as a
   count with references.
6. The `inspect` and `validate` output stays byte-for-byte the same (§3.10 defines the scope).
7. No external runtime dependency is added, as a rule.
8. New modules go to `src/view/` and `src/text/` where needed.
9. A failed `columns` selection will use exit code `4` in the future. `tables` never exits `4`.
10. Text notes go to stdout, and every note line starts with `#`.

## 1. Terms

| Term | Meaning |
|---|---|
| object | One element of `schema.objects` in the `inspect` envelope: `entity`, `view` or `subtype` |
| row | One listed object: an entity or a view |
| inspect envelope | The `JsonEnvelope` that `serialize(input, { command: 'inspect', path })` builds today |
| tables envelope | The new `JsonTablesEnvelope` (§5.2) |
| note | A text line that starts with `# ` |
| escape set | The frozen list of code points that are never written raw to a terminal (§4.4.2) |

---

## 2. Where `tables` sits in the pipeline

`tables` runs the same pipeline as `inspect`. It parses nothing on its own:

```
loadSource → scanSource → classify → derivePartialSemantics      (unchanged, src/cli.ts inputFor)
        → integrate()                 exit policy: exitPolicy.inspect            (unchanged)
        → serialize(input, { command: 'inspect', path })   the inspect envelope  (unchanged)
        → toTablesEnvelope(inspectEnvelope)                 src/view/tables.ts   (new, pure)
        → --format json: toJsonString(tablesEnvelope) + '\n'                     (widened type)
          --format text: renderTablesText(tablesEnvelope)   src/text/tables.ts   (new, pure)
```

The tables envelope is a pure function of the inspect envelope for the same bytes. Two things
follow from that. `tables` and `inspect` cannot disagree about a file, and every fact `tables`
reports can be traced to a field of `inspect`. The CLI stays the only parser (AGENTS.md), and the
view layer only counts and copies.

---

## 3. A — CLI interface

### 3.1 Synopsis

```
a5er tables [--format text|json] <file>
```

- `<file>`: exactly one operand. It is not empty, and it is read with the same read-only loader
  as `inspect` (§10.1 of `architecture.md`).
- `--format text`: the default. Human-readable table plus notes (§4).
- `--format json`: one tables envelope (§5).
- `--format` may come before, between or after the operands, as it may today.
- `-h`/`--help` and `-v`/`--version` behave as they do today: they print the global help or the
  version and exit `0`. There is no per-command help page.

There is no other option. In particular there is no `--color`, `--no-header`, `--width` or
`--sort`, and the output is never coloured.

### 3.2 Parsing rules, in order

`parse()` keeps its order (rule 1 wins over rule 2, and so on). The token rules are the same as
today for every token that is not `--format text` or the word `tables`:

1. **Token misuse** (decided from the tokens alone, before the command is known):
   - an unrecognised token that starts with `-`. `--format=json`, `-` and `--` are included, as
     today;
   - `--format` as the last token;
   - `--format` followed by a value other than `text` or `json`;
   - two `--format` occurrences with different values. Repeating the same value is accepted, as
     `--format json --format json` is today.
2. `-h`/`--help` present: help.
3. `-v`/`--version` present: version.
4. The first operand names the command, and the second names the file:
   - no first operand: misuse;
   - not `inspect`, `validate` or `tables`: misuse;
   - no second operand, an empty one, or a third operand: misuse;
   - `inspect` or `validate` with `--format text`: misuse (rule 4 is the first point where the
     command is known);
   - otherwise run the command.

The format value is resolved after rule 4: an explicit `--format` value, else the default of the
command (`json` for `inspect` and `validate`, `text` for `tables`).

### 3.3 Format selection is explicit

The output bytes are a function of argv and the file bytes only:

- `process.stdout.isTTY`, `process.stderr.isTTY`, `COLUMNS`, `LINES`, `TERM`, `NO_COLOR`,
  `FORCE_COLOR`, `LANG`, `LC_ALL` and the time zone are never read. No pager is started.
- Numbers are written with `String(n)`. `toLocaleString`, `Intl.*` and locale collation are never
  used.
- The same argv and the same bytes give the same stdout, stderr and exit code on a terminal, in a
  pipe and in a file.

### 3.4 Help and usage (exact proposed text)

The global help gains the `tables` lines. Lines that do not mention `tables`, formats or exit `74`
keep their current wording.

```
a5er — read-only CLI for A5:SQL Mk-2 ER diagram (.a5er) files

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er tables [--format text|json] <file>
  a5er --help
  a5er --version

Commands:
  inspect          Read the file and emit one JSON envelope
  validate         Read the file, emit one JSON envelope, and exit 3 when an
                   error-severity finding is reported
  tables           List the entities and views the file declares; text by
                   default, one JSON envelope with --format json

Options:
  --format FORMAT  Output format. inspect and validate: json (the default and
                   only format). tables: text (the default) or json
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Exit codes:
  0   The read was not fatal (inspect and tables, degraded included) and
      validate found no error-severity finding
  1   The file could not be read into a schema (fatal diagnostic)
  2   Command-line misuse; nothing is read, and stdout stays empty
  3   validate found an error-severity finding
  74  tables could not write its output (a write error other than a closed
      pipe)

With --format json, stdout carries exactly one JSON envelope and nothing else.
tables text is one table plus note lines that start with '#'. Human-readable
lines for fatal and error diagnostics go to stderr.
```

The usage block in a misuse message becomes:

```
Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er tables [--format text|json] <file>
  a5er --help | --version
```

### 3.5 Misuse

Misuse keeps its current shape. The exit code is `2`, stdout is empty, nothing is read, and stderr
is `a5er: <message>\n\n<usage>\nRun 'a5er --help' for details.\n`. User-supplied tokens are quoted
with the existing `quote()` (`JSON.stringify`).

| argv (examples) | Message today | Proposed message |
|---|---|---|
| `tables x` | `unknown command "tables"` | *(not misuse: runs `tables`)* |
| `columns x` | `unknown command "columns"` | unchanged |
| *(no command)* `--format json` | `missing a command (inspect or validate)` | `missing a command (inspect, validate or tables)` |
| `tables` | — | `missing the file operand for tables` |
| `tables a b` | — | `extra operand "b"; exactly one file is read` |
| `tables ""` | — | `the file operand is empty` |
| `inspect --format` | `--format requires a value (json)` | `--format requires a value (text or json)` |
| `inspect --format yaml x` | `unsupported --format value "yaml"; only json is supported` | `unsupported --format value "yaml"; supported values are text and json` |
| `inspect --format text x` | `unsupported --format value "text"; only json is supported` | `unsupported --format value "text" for inspect; only json is supported` |
| `validate --format text x` | same as above | `unsupported --format value "text" for validate; only json is supported` |
| `tables --format json --format text x` | — | `conflicting --format values "json" and "text"` |
| `--format text --help` | misuse (`unsupported --format value "text"…`) | help, exit `0` (`text` is now a known value) |

Every message that `cli.test.ts` checks with `toContain` today still contains the checked
substring. The exceptions are the two assertions that use `tables` as an example of a command
that does not exist (§9, item T-1).

### 3.6 Streams

| | `--format text` | `--format json` |
|---|---|---|
| stdout | The table and notes (§4), UTF-8 without BOM, LF only, ending in `\n` | One tables envelope on one line plus `\n` |
| stderr | One line per `fatal` or `error` diagnostic, from the existing `renderDiagnostics()` | Same |
| order | stdout is written first, then stderr, as today | Same |

stderr carries the same lines that `inspect` prints for the same file, byte for byte. `warning` and
`info` diagnostics never reach stderr. In text mode they are summarised in the notes, and in JSON
mode the envelope holds the full record.

### 3.7 Exit codes

| Code | `tables` |
|---|---|
| `0` | `status` is `ok` or `degraded`. This includes `error` diagnostics and 0 rows |
| `1` | `status` is `failed`: a fatal read. The output is still written (§3.8) |
| `2` | Misuse (§3.5). Nothing is read, and stdout is empty |
| `3` | Never. Only `validate` turns an `error` diagnostic into an exit code |
| `4` | Never. Reserved for a future `columns` selection failure (decision 9) |
| `74` | stdout could not be written for a reason other than a closed pipe (§7.2) |

Codes `0` and `1` come from `integrate(input).exitPolicy.inspect`. `ExitPolicy` and `validate/`
are not changed, and the CLI maps `tables` to the `inspect` policy. A closed pipe (`EPIPE`) keeps
the code from the read (§7.2).

### 3.8 `failed` and `degraded`

- **`degraded`**: the rows are listed. The notes count every diagnostic by severity and list
  every diagnostic code with its lines (§4.8). stderr carries the `error` lines. The exit code is
  `0`.
- **`failed`**: there is no schema, so there are no rows and no table header. Text stdout has the
  status note, `# objects: none (status failed)`, the unsupported count, the diagnostic summary,
  and `# completeness: none (status failed)`. JSON stdout is the tables envelope with `source`,
  `result` and `completeness` all `null` (§5.6). stderr carries the `fatal` line. The exit code is
  `1`.

### 3.9 Zero objects, and zero rows

- **0 objects** (`schema.objects` is empty, for example sem-09): text prints no table header. The
  note is `# objects: 0 (entity 0, view 0, subtype 0); listed 0, omitted 0`. JSON has
  `result.tables: []`, `result.objects: 0` and an omitted count of `0`. The exit code follows the
  status (`0` for sem-09, which is `degraded`).
- **Only subtypes**: there are 0 rows, so text prints no table header. The objects note shows the
  subtypes, and the omitted note shows where they are.
- A table header is printed if and only if there is at least one row.

### 3.10 What "byte-for-byte unchanged" covers

For every argv that reaches `run()` today, that is, any `inspect` or `validate` invocation that is
not misuse, help or version, the following must be identical to the baseline for every input:

- the stdout bytes, the stderr bytes and the exit code;
- the bytes of every envelope;
- the write path, including today's behaviour on a broken pipe. That behaviour is a crash with
  exit `1` (§7.1). Changing it is out of scope (§11, item F-1).

Outside that scope, the CLI surface changes in exactly these ways (each is listed in §3.4 or §3.5):

- the help text (tables lines, the `--format` description and exit code `74`);
- the usage block in misuse messages (one more line);
- the misuse messages listed in §3.5;
- `--format text` together with `--help` or `--version` now prints help or the version. Before,
  it was misuse.

---

## 4. B — Human-readable renderer (`--format text`)

### 4.1 Layout

```
<status note>
<table header>          only if there is at least one row
<row> …                 one line per entity or view, in file order
<objects note>
<omitted note>          only if a subtype exists
<unknown notes>         only if there is a view or a partial entity
<effective note>        only if an effective list has a name collision
<unsupported note>
<diagnostics note>
<diagnostic group notes> one per (severity, code), only if a diagnostic exists
<completeness note>
<dropped warning note>  only if completeness.dropped is not 0
```

Line classes, all distinguishable by their first character:

| Starts with | Line class |
|---|---|
| `#` | note |
| `S` (`SECTION`) | the table header |
| a space or a digit | a row (the first column is a right-aligned number) |

The output has no blank lines and no tabs, no line ends in whitespace, and every line ends in
`\n` (LF), CRLF never. The path is not printed: the user passed it, and leaving it out avoids
echoing a path with control characters. The JSON envelope carries it in `source.path`.

### 4.2 Row order

Rows follow `schema.objects` order. That is file order, with entities and views interleaved as they
are declared. Rows are never sorted, grouped by kind or de-duplicated.

### 4.3 Columns

| Header | Content | Align |
|---|---|---|
| `SECTION` | `sectionIndex`, the 1-based section ordinal (`0` is the header block, which never holds an object) | right |
| `LINE` | `span.startLine` of the object: its last `PName` line, else its header line | right |
| `KIND` | `entity` or `view` | left |
| `DECLARED` | declared `Field` count, or `unknown` | right |
| `COMMON` | composed `CommonField` count, or `unknown` | right |
| `EFFECTIVE` | effective column count, or `unknown` | right |
| `PNAME` | physical name (§4.4) | left |
| `LNAME` | logical name (§4.4); last column, never padded | left |

- Two spaces separate columns.
- The width of a column is the largest display width (§4.11) of its header and its cells.
- Right-aligned cells are padded on the left, and left-aligned cells on the right, except
  `LNAME`, which is the last column and gets no trailing padding.
- The counts come before the names on purpose. Only `PNAME` needs width-dependent padding, so a
  width the terminal measures differently can only shift the `LNAME` column. It can never move a
  count.

### 4.4 Names

#### 4.4.1 Bare, quoted and absent

| Value | Rendered as |
|---|---|
| `null` (the file gives no `PName`/`LName`) | `-` |
| `""` (declared empty) | `""` |
| exactly `-` | `"-"` |
| a value with any code point from the escape set (§4.4.2), any whitespace code point (§4.4.3), `"` or `\` | `"` + escaped value + `"` |
| any other value | the value as it is (bare) |

Inside quotes, `"` becomes `\"`, `\` becomes `\\`, and each escape-set code point becomes
`\u{XXXX}`: uppercase hexadecimal, at least four digits, no `U+` (for example `\u{001B}`,
`\u{202E}` or `\u{E0041}`). Whitespace inside quotes stays literal. Nothing else is changed: no
normalisation (NFC/NFKC), no case folding, no trimming.

The mapping is reversible and unambiguous. A bare token never contains `"` or `\`, so it can never
be confused with a quoted one. `-` is always a missing value, and `"-"` is always the name `-`. A
test decodes every rendered name back to its value (§7.4).

The names are the `value` members of the inspect envelope (`pname.value`, `lname.value`). For
`string` keys that is the text inside one quote pair, with no escape processing
(`schema/values.ts`). So `\Q` in a `PName` is two characters, and it renders as `"\\Q"`.

#### 4.4.2 The escape set (frozen)

The escape set is a fixed table in `src/text/escape.ts`. It must not be built from `\p{…}`
property escapes or `Intl`, because those follow the Unicode version of the runtime, and Node 24 and
26 can differ (Node `v24.22.3` reports Unicode `17.0` and ICU `78.3`). With a fixed table the
bytes are the same on every supported runtime.

| Range | Why |
|---|---|
| U+0000–U+001F | C0 controls, including NUL, BEL, BS, TAB, LF, CR and ESC |
| U+007F–U+009F | DEL and C1 controls, including U+009B CSI and U+0085 NEL |
| U+00AD | soft hyphen (invisible) |
| U+061C | Arabic letter mark (bidi) |
| U+180E | Mongolian vowel separator (invisible) |
| U+200B–U+200F | ZWSP, ZWNJ, ZWJ, LRM, RLM |
| U+2028–U+202E | line separator, paragraph separator, LRE, RLE, PDF, LRO, RLO |
| U+2060–U+206F | word joiner, invisible operators, LRI, RLI, FSI, PDI, deprecated format controls |
| U+D800–U+DFFF | lone surrogates (a JS string can hold them) |
| U+FDD0–U+FDEF | noncharacters |
| U+FEFF | BOM / zero-width no-break space |
| U+FFF9–U+FFFB | interlinear annotation controls |
| U+xFFFE, U+xFFFF for every plane x | noncharacters |
| U+E0000–U+E007F | tag characters (invisible) |

Combining marks, variation selectors (including the ideographic variation sequences used in
Japanese names), private-use code points and emoji are not escaped. They cannot move the cursor or
start a control sequence.

#### 4.4.3 Whitespace that forces quoting (frozen)

U+0020, U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F and U+3000. A name that contains any of
these is quoted, so `"顧客 一覧"` reads as one value in a space-separated row. These code points
stay literal inside the quotes, except those that are also in the escape set (none are today).

### 4.5 Counts, `partial` and `unknown`

From the entity's `effectiveColumns`:

| Object | `DECLARED` | `COMMON` | `EFFECTIVE` |
|---|---|---|---|
| entity, `status: complete` | `declared.length` | `common.length` | `columns.length` |
| entity, `status: partial` | `declared.length` | `unknown` | `unknown` |
| view (`status: unknown`) | `unknown` | `unknown` | `unknown` |

- `EFFECTIVE` counts every entry of the effective list. A physical name that occurs in both the
  declared and the common columns is counted twice: the list keeps both and reports a collision
  (`architecture.md` §9.4). When `collisions` is not empty, the effective note says so (§4.8). For
  a complete entity, `EFFECTIVE = DECLARED + COMMON` always holds.
- `partial` means the composition was withheld. `common` is `[]` in the envelope, which is "not
  composed", not "zero". So `COMMON` and `EFFECTIVE` are `unknown`, never `0`, and never the
  declared count.
- A view stores no columns. All three counts are `unknown` and never `0`.
- `unknown` is the only placeholder in a count column. A number is always a known count.

### 4.6 Objects with the same name

Every object is its own row. Rows are never merged, de-duplicated or marked by the view layer.
`SECTION` and `LINE` tell rows with the same name apart. Name uniqueness is the semantic layer's
rule, so `V_DUPLICATE_OBJECT_NAME` (exact `PName` match across entity, view and subtype) is
reported in the diagnostic notes and on stderr as an `error` line. `tables` does not compare names
on its own.

### 4.7 Omitted subtypes

A subtype never gets a row. The objects note counts it, and the omitted note gives the section of
each one in file order:

```
# omitted: subtypes are not listed (section 7); 'a5er inspect' reports them
```

The `subtype-membership` unsupported record and the `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` info
diagnostic still show up in their own notes. Subtype names are not printed.

### 4.8 Notes: exact formats

`<n>` is a decimal number. `<sections>` is `section A` for one section and `sections A, B, …` for
more, in file order.

| Note | Format |
|---|---|
| status | `# status: <ok\|degraded\|failed>` |
| objects | `# objects: <total> (entity <e>, view <v>, subtype <s>); listed <e+v>, omitted <s>` |
| objects, failed | `# objects: none (status failed)` |
| omitted | `# omitted: subtypes are not listed (<sections>); 'a5er inspect' reports them` |
| unknown, view `view-columns-not-stored` | `# unknown: a view does not store its columns (<sections>)` |
| unknown, view `view-columns-named-from-query` | `# unknown: a view names its columns from its query (LNameByComment=1) and does not store them (<sections>)` |
| unknown, entity partial `using-common-columns-unrecognised` | `# unknown: UsingCommonColumns is neither 1 nor 0, so common columns are not composed (<sections>)` |
| effective | `# effective: a physical column name repeats in the effective list and is counted once per occurrence (<sections>)` |
| unsupported, none | `# unsupported: 0` |
| unsupported | `# unsupported: <n> (<kind> <n>, …); kept verbatim, not interpreted` (kinds in order of first appearance) |
| diagnostics | `# diagnostics: <n> (fatal <n>, error <n>, warning <n>, info <n>)` |
| diagnostic group | `#   <severity> <code>: <message> (<loc>, …)`. `<loc>` is `line <startLine>`, or `file` when `span` is `null`. One `<loc>` per diagnostic, in envelope order, duplicates kept |
| completeness | `# completeness: sections <t> (parsed <n>, preservedRaw <n>, unknown <n>); keys <t> (parsed <n>, preservedRaw <n>); lines <t> (accounted <n>, dropped <n>); dropped <n>` |
| completeness, failed | `# completeness: none (status failed)` |
| dropped | `# warning: completeness.dropped is <n>; some lines are not accounted for` |

- The unknown notes are typed on `reason`, and the switch is exhaustive. A new reason value is a
  compile error, not a silent fallback.
- Diagnostic groups are keyed by `(severity, code)` in order of first appearance. That order is the
  envelope's source-line order (Skill item 3).
- `details` is never printed: it holds file text. `message` is fixed table text. As defence in
  depth it still goes through `escapeText`, which replaces escape-set code points (§4.4.2) with
  `\u{XXXX}` but never quotes. For the current ASCII messages this changes nothing.
- The only file-derived text in the output is the two name columns, and both are escaped (§4.4).
  Every other token is fixed vocabulary or a number.

### 4.9 Completeness

The text output is a projection, and it must not look like the whole file. Three rules make the
omissions visible:

1. Every count from `completeness` is printed. They are never summarised as a single "OK".
2. `unsupported` is always counted, `0` included. Its records are never shown in text: `inspect`
   or `--format json` gives them in full.
3. Anything that `tables` deliberately does not list (subtypes, unsupported records, relations,
   column details) is either counted in a note or present in the JSON envelope. Nothing is dropped
   without a count.

### 4.10 Long names

Names are never truncated, wrapped or ellipsised, and lines have no length limit. A row is as long
as its longest name needs. One long name widens the `PNAME` column for every row of that output.
That is the price of alignment, and it is accepted. The terminal width is never read (§3.3).

### 4.11 Display width (frozen)

`displayWidth(s)` adds a width per code point, computed after escaping:

| Width | Code points |
|---|---|
| 0 | U+0300–U+036F, U+1AB0–U+1AFF, U+1DC0–U+1DFF, U+20D0–U+20FF, U+3099–U+309A, U+FE00–U+FE0F, U+FE20–U+FE2F, U+E0100–U+E01EF |
| 2 | U+1100–U+115F, U+2E80–U+303E, U+3041–U+33FF, U+3400–U+4DBF, U+4E00–U+9FFF, U+A000–U+A4CF, U+A960–U+A97F, U+AC00–U+D7A3, U+F900–U+FAFF, U+FE10–U+FE19, U+FE30–U+FE6F, U+FF00–U+FF60, U+FFE0–U+FFE6, U+1F300–U+1F64F, U+1F900–U+1F9FF, U+20000–U+2FFFD, U+30000–U+3FFFD |
| 1 | everything else, including East Asian Ambiguous characters and half-width katakana (U+FF61–U+FF9F) |

The width-0 ranges are checked first, so U+3099–U+309A is 0 inside the wide kana block. The table
is hand-written and frozen in `src/text/width.ts`. It is a Kuhn-style `wcwidth` approximation,
not data generated from the Unicode Character Database. It adds no dependency and no data file,
and it does not change with the Unicode version of the runtime.

Known limits, stated rather than hidden: Ambiguous-width characters (for example `○` and `①`) are
counted as 1, while a CJK-configured terminal may draw them 2 wide. Grapheme clusters are not
segmented, so emoji ZWJ sequences cannot occur raw anyway: ZWJ is escaped. Some scripts outside the
table may be measured wrongly. In every one of these cases only the padding of `PNAME` is affected.
The content never changes, and because of the column order (§4.3) only the start of `LNAME` can
shift.

### 4.12 Examples

Examples A and C–E are real synthetic fixtures. Their output was produced by a throwaway
prototype of these rules (outside the repository) from the baseline inspect envelope, then checked
by hand against the rules and the fixture text (§8.1). It illustrates the specification. It is not
a test expectation (§8.7). Example B is a synthetic document written for this
proposal. In the code blocks, the text on stdout is shown first and the stderr lines are marked.

**A — txt-01-multi-table-view** (`ok`, exit `0`, stderr empty)

```
# status: ok
SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME          LNAME
      2     9  entity         3        0          3  users          ユーザー
      3    18  entity         2        0          2  orders         注文
      4    26  entity         0        0          0  audit_log      監査ログ
      5    31  view     unknown  unknown    unknown  active_users   -
      6    36  view     unknown  unknown    unknown  order_summary  -
# objects: 5 (entity 3, view 2, subtype 0); listed 5, omitted 0
# unknown: a view does not store its columns (sections 5, 6)
# unsupported: 0
# diagnostics: 2 (fatal 0, error 0, warning 0, info 2)
#   info V_VIEW_COLUMNS_UNKNOWN: A view does not store its columns (line 31, line 36)
# completeness: sections 7 (parsed 7, preservedRaw 0, unknown 0); keys 33 (parsed 33, preservedRaw 0); lines 49 (accounted 49, dropped 0); dropped 0
```

**B — synthetic document** with a partial entity, a missing `PName`, the same name on an entity
and a view, a subtype, a CJK physical name, a long name, terminal controls in a name, a name that
is exactly `-`, and an unknown section. Source (UTF-8 with BOM, LF). `<ESC>` stands for one U+001B
byte and `<RLO>` for one U+202E code point:

```
# A5:ER FORMAT:21
# A5:ER ENCODING:UTF8

[Manager]
PageInfo="Main",3,"A4Landscape","$FFFFFF"
CommonField="作成日時","created_at","Timestamp",,,,"",$FFFFFFFF

[Entity]
PName="customers"
LName="顧客"
Field="顧客ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""
Field="氏名","name","varchar(100)","",,"","",$FFFFFFFF,"",""
Position="Main",10,10

[Entity]
PName="order_lines_with_a_deliberately_long_physical_name"
LName="受注明細"
UsingCommonColumns=2
Field="明細ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""
Position="Main",10,10

[Entity]
LName="名前のない表"
UsingCommonColumns=0
Position="Main",10,10

[View]
PName="customers"
LName="顧客 一覧"
Query="SELECT id FROM customers"
Position="Main",10,10

[Entity]
PName="社員マスタ"
LName="社員"
UsingCommonColumns=0
Field="社員番号","emp_no","Integer","NOT NULL",0,"","",$FFFFFFFF,"",""
Position="Main",10,10

[Subtype]
PName="customer_kind"
Position="Main",10,10

[Entity]
PName="evil<ESC>[2J<RLO>txt.exe"
LName="-"
UsingCommonColumns=0
Position="Main",10,10

[Memo]
Text="not modelled"
```

Output (`degraded`, exit `0`):

```
# status: degraded
SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME                                               LNAME
      2     9  entity         2        1          3  customers                                           顧客
      3    16  entity         1  unknown    unknown  order_lines_with_a_deliberately_long_physical_name  受注明細
      4    22  entity         0        0          0  -                                                   名前のない表
      5    28  view     unknown  unknown    unknown  customers                                           "顧客 一覧"
      6    34  entity         1        0          1  社員マスタ                                          社員
      8    45  entity         0        0          0  "evil\u{001B}[2J\u{202E}txt.exe"                    "-"
# objects: 7 (entity 5, view 1, subtype 1); listed 6, omitted 1
# omitted: subtypes are not listed (section 7); 'a5er inspect' reports them
# unknown: a view does not store its columns (section 5)
# unknown: UsingCommonColumns is neither 1 nor 0, so common columns are not composed (section 3)
# unsupported: 3 (subtype-membership 1, unknown-section 1, unknown-key 1); kept verbatim, not interpreted
# diagnostics: 5 (fatal 0, error 2, warning 0, info 3)
#   error V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 22)
#   error V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 28)
#   info V_VIEW_COLUMNS_UNKNOWN: A view does not store its columns (line 28)
#   info V_UNSUPPORTED_SUBTYPE_MEMBERSHIP: A subtype cannot declare which entities belong to it (line 41)
#   info S_UNKNOWN_SECTION: A section this tool does not model was preserved verbatim (line 50)
# completeness: sections 9 (parsed 8, preservedRaw 1, unknown 1); keys 31 (parsed 30, preservedRaw 1); lines 51 (accounted 51, dropped 0); dropped 0
```

stderr:

```
a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 22)
a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 28)
```

The `社員マスタ` cell is 10 columns wide (five width-2 code points), so it gets 41 spaces of padding
where `customers` gets 42. Because `LINE` is the `PName` line, row 4 (no `PName`) reports its
header line, 22.

**C — sem-09-zero-pages** (0 objects; `degraded`, exit `0`)

```
# status: degraded
# objects: 0 (entity 0, view 0, subtype 0); listed 0, omitted 0
# unsupported: 0
# diagnostics: 1 (fatal 0, error 1, warning 0, info 0)
#   error V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)
# completeness: sections 1 (parsed 1, preservedRaw 0, unknown 0); keys 1 (parsed 1, preservedRaw 0); lines 4 (accounted 4, dropped 0); dropped 0
```

stderr: `a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 3)`

**D — an empty file** (hst-06 family; `failed`, exit `1`)

```
# status: failed
# objects: none (status failed)
# unsupported: 0
# diagnostics: 1 (fatal 1, error 0, warning 0, info 0)
#   fatal E_EMPTY_INPUT: The input is empty (file)
# completeness: none (status failed)
```

stderr: `a5er: fatal: E_EMPTY_INPUT: The input is empty`

**E — sem-05-subtype** (`ok`, exit `0`)

```
# status: ok
SECTION  LINE  KIND    DECLARED  COMMON  EFFECTIVE  PNAME           LNAME
      2     7  entity         1       0          1  subtype_member  -
# objects: 2 (entity 1, view 0, subtype 1); listed 1, omitted 1
# omitted: subtypes are not listed (section 3); 'a5er inspect' reports them
# unsupported: 1 (subtype-membership 1); kept verbatim, not interpreted
# diagnostics: 1 (fatal 0, error 0, warning 0, info 1)
#   info V_UNSUPPORTED_SUBTYPE_MEMBERSHIP: A subtype cannot declare which entities belong to it (line 12)
# completeness: sections 3 (parsed 3, preservedRaw 0, unknown 0); keys 9 (parsed 9, preservedRaw 0); lines 16 (accounted 16, dropped 0); dropped 0
```

---

## 5. C — JSON output contract (`--format json`)

### 5.1 Discrimination by `command`

What `a5er` emits becomes a discriminated union on `command`:

| `command` | Type | Position 7 |
|---|---|---|
| `inspect`, `validate` | `JsonEnvelope` (unchanged, field for field) | `schema` |
| `tables` | `JsonTablesEnvelope` (new) | `result` |

A consumer reads `command` first and then reads the shape for that command. `command` sits at
position 3 in both shapes, before any member that differs.

### 5.2 Type definitions (proposed additions to `src/json/envelope.ts`)

Field order is emission order, as for every existing interface. No member is optional. A member
with nothing to say is `null` or a status object, never `undefined`, so `toJsonString`'s strict
replacer applies unchanged.

```ts
/** The one command whose envelope carries a projection instead of the schema. */
export type JsonTablesCommand = 'tables';

/** Every document the CLI can emit, discriminated on `command` (§5.1). */
export type JsonDocument = JsonEnvelope | JsonTablesEnvelope;

/** `a5er tables --format json`. Shared members are the inspect envelope's, verbatim. */
export interface JsonTablesEnvelope {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly tool: { readonly name: typeof TOOL_NAME; readonly version: typeof TOOL_VERSION };
  readonly command: JsonTablesCommand;
  readonly status: IntegrationStatus;
  readonly source: JsonSource | null;
  readonly limits: JsonLimits;
  /** `null` exactly when `status` is `failed`, like `schema`. */
  readonly result: JsonTablesResult | null;
  readonly unsupported: readonly JsonUnsupported[];
  readonly diagnostics: readonly JsonDiagnostic[];
  readonly completeness: JsonCompleteness | null;
}

export interface JsonTablesResult {
  /** `schema.objects.length` of the inspect envelope: every kind, subtypes included. */
  readonly objects: number;
  /** Entities and views, in `schema.objects` order. */
  readonly tables: readonly JsonTableRow[];
  readonly omitted: JsonTablesOmitted;
}

export interface JsonTableRow {
  /** Index into the inspect envelope's `schema.objects`: gaps are subtypes, never renumbered. */
  readonly objectIndex: number;
  readonly sectionIndex: number;
  /** The object's `span`, verbatim: its last `PName` line, else its header line. */
  readonly span: JsonSpan;
  readonly kind: 'entity' | 'view';
  /** `pname.value`, or `null` when the object declares no `PName`; `''` stays `''`. */
  readonly pname: string | null;
  readonly lname: string | null;
  readonly columns: JsonTableColumns;
}

/** Column counts; `null` is "not known", never zero. */
export type JsonTableColumns =
  | {
      readonly status: 'complete';
      readonly reason: null;
      readonly declared: number;
      readonly common: number;
      readonly effective: number;
      readonly collisions: number;
    }
  | {
      readonly status: 'partial';
      readonly reason: 'using-common-columns-unrecognised';
      readonly declared: number;
      readonly common: null;
      readonly effective: null;
      readonly collisions: null;
    }
  | {
      readonly status: 'unknown';
      readonly reason: ViewColumnReason;
      readonly declared: null;
      readonly common: null;
      readonly effective: null;
      readonly collisions: null;
    };

export interface JsonTablesOmitted {
  readonly subtypes: {
    readonly count: number;
    /** `sectionIndex` of every subtype, in file order; `count === sectionIndexes.length`. */
    readonly sectionIndexes: readonly number[];
  };
}
```

`JsonCommand` (`'inspect' | 'validate'`), `JsonEnvelope`, `SerializeContext`, `ExitPolicy` and
`serialize()` do not change. `toJsonString` widens its parameter from `JsonEnvelope` to
`JsonDocument`. It is the same function with the same replacer, so the bytes for an existing
envelope are the same. The package entry point (`src/index.ts`) exports only `VERSION` today, and it
keeps doing so: none of these types become public library API.

### 5.3 `schema` and `result`

- A tables envelope has **no** `schema` member. `result` sits at the position `schema` has in the
  inspect envelope.
- `result` is a pure projection of the `schema` that `inspect` emits for the same bytes:
  `result = projectTables(inspect.schema)`, and `result` is `null` if and only if
  `inspect.schema` is `null`.
- Why not both: the schema of a small file is already tens of KB (Skill, "Run"). `tables` exists
  to give a small answer, and it echoes less confidential text than the full schema. For the full
  model, run `inspect`.
- `result` invents nothing. Every number is a length of an array in `inspect.schema`. Every string
  is a `value` copied from it, and every `reason` is copied verbatim.

### 5.4 Row and omission invariants (tested, §8.4)

For every input, with `S = inspect.schema` and `R = tables.result`:

1. `R.objects === S.objects.length`.
2. `R.tables.length + R.omitted.subtypes.count === R.objects`.
3. `R.tables[i].objectIndex` strictly increases, and `S.objects[objectIndex].kind` is never
   `subtype`.
4. `sectionIndex`, `span`, `kind`, `pname` (`.value` or `null`) and `lname` equal the
   corresponding members of `S.objects[objectIndex]`.
5. `columns`:
   - an entity with `complete` status has `declared = declared.length`,
     `common = common.length`, `effective = columns.length`,
     `collisions = collisions.length`, `effective === declared + common` and `reason: null`;
   - an entity with `partial` status has `declared = declared.length`, `common`, `effective` and
     `collisions` all `null`, and `reason = effectiveColumns.reason`;
   - a view has `status: 'unknown'`, `reason = effectiveColumns.reason` and four `null` counts.
6. `R.omitted.subtypes.sectionIndexes` lists `sectionIndex` for every subtype in `S.objects`
   order, and `count` is its length.

### 5.5 Shared members

`contractVersion`, `tool`, `status`, `source`, `limits`, `unsupported`, `diagnostics` and
`completeness` must deep-equal the inspect envelope's members for the same input, and must
serialise to the same bytes. The view layer copies them by reference from the inspect envelope and
never rebuilds them. Their meaning, rules 1–4 and 7 of `architecture.md` §12, and the `limits`
semantics apply unchanged.

### 5.6 `failed`

`status: 'failed'` means `source: null`, `result: null` and `completeness: null`. `diagnostics`
holds the fatal record, as in the inspect envelope. Sample (empty input; `tool.version` is shown as
the golden placeholder):

```json
{"contractVersion":"0.1.0","tool":{"name":"@j1nn0/a5er-cli","version":"<package-version>"},"command":"tables","status":"failed","source":null,"limits":{"maxBytes":67108864,"truncated":false},"result":null,"unsupported":[],"diagnostics":[{"code":"E_EMPTY_INPUT","severity":"fatal","message":"The input is empty","details":{"sizeBytes":0},"span":null,"construct":"Source"}],"completeness":null}
```

### 5.7 Sample: sem-05-subtype

Pretty-printed here for reading. The real output is one line plus `\n`. The `source` members are
the ones the inspect envelope reports for the same staged bytes, with the path scrubbed as in the
goldens.

```json
{
  "contractVersion": "0.1.0",
  "tool": { "name": "@j1nn0/a5er-cli", "version": "<package-version>" },
  "command": "tables",
  "status": "ok",
  "source": {
    "path": "<tmp>/sem-05.a5er",
    "sizeBytes": 294,
    "sha256": "a2d4f11d06f3ebfe16f613d8e0f20acf4857acd26845482e34a3ceeaf4ddc470",
    "encoding": { "detected": "utf-8", "bom": true, "declared": null, "mismatch": false },
    "format": { "declared": 21, "effective": 21, "known": true }
  },
  "limits": { "maxBytes": 67108864, "truncated": false },
  "result": {
    "objects": 2,
    "tables": [
      {
        "objectIndex": 0,
        "sectionIndex": 2,
        "span": { "sectionIndex": 2, "startLine": 7, "endLine": 7, "keyLine": 7 },
        "kind": "entity",
        "pname": "subtype_member",
        "lname": null,
        "columns": {
          "status": "complete", "reason": null,
          "declared": 1, "common": 0, "effective": 1, "collisions": 0
        }
      }
    ],
    "omitted": { "subtypes": { "count": 1, "sectionIndexes": [3] } }
  },
  "unsupported": [
    { "kind": "subtype-membership", "sectionKind": "Subtype", "sectionHeader": "[Subtype]",
      "key": null, "raw": "[Subtype]",
      "span": { "sectionIndex": 3, "startLine": 11, "endLine": 11, "keyLine": 11 },
      "reason": "no-membership-key-in-v2.21" }
  ],
  "diagnostics": [
    { "code": "V_UNSUPPORTED_SUBTYPE_MEMBERSHIP", "severity": "info",
      "message": "A subtype cannot declare which entities belong to it",
      "details": { "subtype": "unknown_membership", "reason": "no-membership-key-in-v2.21" },
      "span": { "sectionIndex": 3, "startLine": 12, "endLine": 12, "keyLine": 12 },
      "construct": "Subtype" }
  ],
  "completeness": {
    "sections": { "total": 3, "parsed": 3, "preservedRaw": 0, "unknown": 0 },
    "keys": { "total": 9, "parsed": 9, "preservedRaw": 0 },
    "lines": { "total": 16, "accounted": 16, "dropped": 0 },
    "dropped": 0
  }
}
```

JSON escaping is standard `JSON.stringify` escaping, as in `inspect`. A name keeps its exact
value: C0 controls appear as `\u001b`, while U+202E and C1 controls appear as raw UTF-8. A consumer
that prints JSON strings to a terminal must sanitise them itself. The text renderer (§4.4) does
this for humans.

### 5.8 Byte compatibility of existing commands

- `serialize.ts` does not change. `envelope.ts` only gains declarations. `cli.ts` keeps the
  `run()` path for `inspect` and `validate` as it is: the same `serialize(input, { command, path })`,
  the same `toJsonString`, the same `renderDiagnostics`, the same write calls.
- The 44 committed goldens and `json-goldens.test.ts` do not change, and they must pass.
- The CLI tests for `inspect` and `validate` pass without edits, except the two help and
  unknown-command assertions in §9 T-1, which are about the global surface (§3.10).

### 5.9 `contractVersion` stays `0.1.0`

**Why it cannot move.** Every committed golden asserts `contractVersion: "0.1.0"`, and
`release:check` compares the goldens with `CONTRACT_VERSION`. A bump would change the bytes of every
`inspect` and `validate` envelope, which decision 6 forbids. So decision 6 already decides that the
version stays, and the contract rules must say clearly why a new command is allowed under it.

**Conditions.** The version stays `0.1.0` only if all of these hold. Each is checked by a test in
§8:

| ID | Condition |
|---|---|
| K-1 | `JsonEnvelope` loses, gains, renames and reorders no member, and `JsonCommand` stays `'inspect' \| 'validate'` |
| K-2 | Every `inspect` and `validate` output is byte-identical to the baseline (§3.10): goldens, CLI tests and the regression in §8.5 |
| K-3 | The tables envelope can only be reached through `a5er tables --format json`, which is misuse today. So no invocation that produced an envelope before produces a different one |
| K-4 | The shared members of the tables envelope equal the inspect envelope's (§5.5), so a consumer's handling of the existing fields stays valid for them |
| K-5 | The rule amendment below is agreed and applied together with the implementation |

**Rule amendment** (to apply in the implementation PR, with agreement). The current wording does
not agree with itself. `architecture.md` §12 rule 6 says unknown fields are *additive*, and only
removing or renaming one bumps the version. The comments in `src/json/envelope.ts` and
`scripts/lib/version.mjs` say the version moves when a field is *added*, removed or renamed. The
proposed single wording, for all three places:

> `contractVersion` versions the envelope of each command. It moves when a field of an existing
> command's envelope is added, removed, renamed or reordered, or when the meaning of a value
> changes. A new command that has its own envelope shape, is discriminated by `command`, keeps the
> shared members verbatim and leaves every existing envelope byte-identical is additive and does
> not move it.

**Not covered by `contractVersion`:** the text output of `tables`. Text is for humans. It is
specified and tested here, and changing it needs a reviewed change to this specification and its
tests, but it is not the machine contract. Scripts must use `--format json`.

With K-1 to K-5 in place, no contract question is left open: the discriminator, the payload
position, the null rule for `failed`, the shared members, the version and the status of text are
all decided above.

---

## 6. Module layout

| Module | Role | Imports |
|---|---|---|
| `src/json/envelope.ts` | The types of §5.2 (types only, as today) | unchanged set |
| `src/json/serialize.ts` | `toJsonString(document: JsonDocument)`: parameter type widened only | unchanged |
| `src/view/tables.ts` | `projectTables(schema: JsonSchema): JsonTablesResult` and `toTablesEnvelope(envelope: JsonEnvelope): JsonTablesEnvelope`. Pure, no I/O, no `node:` imports | `src/json/` types |
| `src/view/index.ts` | barrel | — |
| `src/text/escape.ts` | the escape set, the whitespace set, `renderName(value: string \| null): string` (§4.4.1) and `escapeText(text: string): string` (escape-set replacement only, §4.8) | none |
| `src/text/width.ts` | `displayWidth(text: string): number` with the table of §4.11 | none |
| `src/text/layout.ts` | `layoutColumns(header, rows, align): string[]`: padding only, no trailing whitespace | `width.ts` |
| `src/text/tables.ts` | `renderTablesText(envelope: JsonTablesEnvelope): string` | `src/json/` types, `escape.ts`, `layout.ts` |
| `src/text/index.ts` | barrel | — |
| `src/cli.ts` | the argv rules of §3.2, `tables` dispatch, the output writer of §7.2 for `tables` | the above |

Dependencies go one way: `cli → text → view → json`, and `text` only needs `json` types. Neither
`view` nor `text` imports a pipeline stage (`decode`, `syntax`, `schema`, `semantic`, `validate`).
Both work only on the envelope, so they cannot parse or re-decide anything. No `package.json`
dependency is added.

---

## 7. D — Robustness

### 7.1 Measured baseline (today's `inspect`, before any change)

Measured once on Linux (Ubuntu, kernel 7.0) with Node `v24.22.3` and the baseline `dist/cli.js`,
using synthetic inputs in a temp directory. Node 26, Windows and macOS were **not** measured
locally: a local Node 26 install was incomplete, and no Windows or macOS host was available.

| Scenario | Observed exit | Observed stderr |
|---|---|---|
| `inspect txt-01 \| true` (29,381-byte envelope, reader already gone) | `1` (5/5 runs) | Node's `Unhandled 'error' event`, `Error: write EPIPE`, stack trace with the install path (992 bytes) |
| `inspect <2,000-entity doc> \| head -c 1` (8,756,368-byte envelope) | `1` (3/3) | same, `write EPIPE` |
| `inspect txt-01 \| head -c 10` (fits the pipe buffer) | `0` | empty: the write finished before the reader closed |
| `inspect txt-01 > /dev/full` | `1` | `Unhandled 'error' event`, `ENOSPC: no space left on device, write` |
| `inspect txt-01 >&-` (stdout closed) | `0` | empty. The output is lost without any signal, and the process cannot see it |

Findings: a broken pipe exits `1`, the code for "failed read", and prints a stack trace. That is
the failure mode `tables` must not have. A throwaway probe that writes 8 MiB with
`process.stdout.on('error', …)` installed exited `0` with no trace on `| head -c 1` and `| true`,
and exited `74` with the one-line message on `/dev/full`. That confirms the policy below is
feasible on this platform. `inspect` and `validate` keep the crash, because they must not change
(§3.10, §11 F-1).

### 7.2 Output writer policy (`tables` only)

1. The CLI sets `process.exitCode` to the read's code (`0` or `1`) **before** it writes.
   `process.exit()` is never called. On POSIX, pipe writes are asynchronous (Node docs, "A note on
   process I/O"), and `process.exit()` could cut off output that is still queued.
2. An `'error'` listener goes on `process.stdout` and on `process.stderr` before the first write.
3. stdout `EPIPE`: the reader closed the pipe on purpose (`head`, `less` closed early). Stop
   writing, print nothing, and **keep** the read's exit code. So
   `a5er tables f | head -n 3` exits `0` for a readable file and `1` for a failed read, the
   same as without `head`.
4. Any other stdout error (`ENOSPC`, `EIO`, `EBADF`, …): set `process.exitCode = 74` and write one
   line to stderr: `a5er: error: cannot write to stdout (<code>)`, where `<code>` is
   `error.code`, or `UNKNOWN` when it is missing or not a string of `[A-Z0-9_]+`. No stack, no
   path, no message text from the system.
5. A stderr error of any kind is ignored. There is nowhere left to report it, and it never changes
   the exit code.
6. The whole stdout text is written with one `write()` call, as today. stderr is written after
   stdout has been handed over.
7. The writer is a function with injected streams (`writeOutput(result, { stdout, stderr })`), so
   unit tests can feed it fake streams that fail on all three CI platforms (§7.3 R-3).

Only an `EPIPE` on stdout counts as "reader closed". If a platform reports a closed pipe with a
different code, the tests in §7.3 fail on that platform. The fix is a reviewed change to this list,
never a wider catch-all.

### 7.3 Write-error tests

| ID | Test | Platforms | Expectation |
|---|---|---|---|
| R-1 | Spawn `node dist/cli.js tables <big>` with `stdio: ['ignore', 'pipe', 'pipe']`. `<big>` is a generated synthetic document of 4,000 entities, each with a 200-character CJK `LName` (about 600 UTF-8 bytes per row). The test first asserts that the text stdout of the same document is over 1 MiB, so the precondition is measured, not assumed. Read the first `data` chunk, then `child.stdout.destroy()` | Ubuntu, Windows (CI); macOS manual | exit `0`, stderr `''`, no `EPIPE` or `Error` text anywhere |
| R-1j | R-1 with `--format json` | same | same |
| R-2 | Spawn as R-1, but destroy stdout before the child's first write (right after `spawn`) | same | exit `0`, stderr `''` |
| R-2f | R-2 on a document that fails to read (an empty file) | same | exit `1`, stderr is exactly the `fatal` line |
| R-C | **Reproduction control**: R-1 run against `inspect` on the same document | same | exit `1` and stderr contains `EPIPE`. This proves the harness really produces a broken pipe on that platform. It pins today's behaviour (§3.10) and flips when F-1 lands |
| R-3 | `writeOutput` with a fake stdout whose `write` makes it emit `error` with code `EIO`, `ENOSPC` or `EBADF`, and with no code | all | `exitCode` becomes `74`, and stderr is exactly `a5er: error: cannot write to stdout (EIO)\n`, `(ENOSPC)` or `(UNKNOWN)` |
| R-3e | `writeOutput` with a fake stdout that emits `EPIPE` | all | `exitCode` stays at the read's code, and stderr gets nothing extra |
| R-3s | Fake stderr that emits `EPIPE` or `EIO` | all | no throw, and `exitCode` does not change |
| R-4 | Real `tables txt-01 > /dev/full` | Linux only: `it.runIf(process.platform === 'linux')`, because `/dev/full` exists only there. Reported as a platform skip elsewhere | exit `74`, stderr `a5er: error: cannot write to stdout (ENOSPC)\n` |

The tests time out at 20 s, like `runCli`, and clean up their temp directories in `finally`. The
generated document is written to a `mkdtemp` directory and removed afterwards. It is never
committed (§3.1 of `test-strategy.md`).

### 7.4 Terminal-control neutralisation tests

| ID | Test |
|---|---|
| S-1 | For every code point in each range of §4.4.2, the range ends and the code points just outside them: `renderName` gives `\u{XXXX}` for the inside and the raw character for the outside. This includes U+0000, U+001B, U+007F, U+0085, U+009B, U+009F, U+00A0 (not escaped, but quoted), U+202E, U+2066–U+2069, U+FEFF, U+FFFE, U+10FFFF, U+E0001, and a lone U+D800 and U+DC00 |
| S-2 | Exhaustive: for all 1,114,112 code points (as one-code-point strings, lone surrogates included), the output contains no escape-set code point, and decoding the output gives the input back (round trip) |
| S-3 | Ambiguity: `null → -`, `'' → ""`, `'-' → "-"`, `'a"b' → "a\"b"`, `'a\\b' → "a\\b"`, `'a b' → "a b"`, `'顧客　一覧' → "顧客　一覧"` |
| S-4 | Integration: a generated document whose `PName`/`LName` hold ESC-based CSI (`<ESC>[2J`), OSC 8 (`<ESC>]8;;x<ESC>\`), BEL, CR, C1 CSI (U+009B), RLO, LRI/PDI, ZWJ, BOM and a tag sequence (U+E0001 U+E0041). The text stdout has no byte `0x1B`, `0x07` or `0x0D` and no UTF-8 encoding of U+009B, U+202E, U+2066, U+2069, U+200D, U+FEFF or U+E0000–U+E007F, while the JSON stdout keeps the exact values (decoded `pname` equals the written value) |
| S-5 | Every output line of S-4 matches `^(# .*\|SECTION .*\|[ 0-9].*)$`. No line ends in whitespace, and no line holds `\r` or `\t` |

### 7.5 Platforms

| Aspect | Ubuntu | Windows | macOS |
|---|---|---|---|
| Line ends in output | LF | LF (never CRLF; `\n` is written as is) | LF |
| Encoding of output | UTF-8, no BOM | UTF-8 bytes to pipes and files. A console (TTY) gets the text through libuv's console writer, so the console code page does not matter (expected, measure manually). PowerShell's own pipeline may decode with `[Console]::OutputEncoding`, which is outside `a5er`'s control. Use `--format json` or redirect to a file | UTF-8 |
| Pipe writes | asynchronous (POSIX) | synchronous | asynchronous (POSIX) |
| `EPIPE` evidence | R-1, R-2, R-C in CI | R-1, R-2, R-C in CI | **not in CI.** Manual run of R-1, R-2 and R-C on Node 24 and 26, recorded in the implementation PR, or reported there as unverified |
| `/dev/full` (R-4) | run | skipped (absent) | skipped (absent) |
| Input line ends (CRLF/LF/CR) | handled by the existing decoder (hst-05, fmt-01 CRLF) | same | same |

`.gitattributes` already gives LF for test sources on Windows. Text expectations in tests are
authored with `\n`, and the comparison is byte for byte.

### 7.6 Node.js 24 and 26

- No API beyond what Node 24 has. The text code uses `String.prototype.codePointAt`,
  `String.fromCodePoint` and plain loops, and no `Intl`, `\p{…}`, `Intl.Segmenter` or ICU data.
  Output therefore does not depend on the ICU or Unicode version, and the same expected strings
  must pass in both matrix versions.
- The `'error'` event behaviour of `process.stdout` is checked on both versions by R-1 to R-3 in
  CI. It is never assumed.

### 7.7 Line width and long identifiers

| ID | Test |
|---|---|
| W-1 | `displayWidth` table test: one sample inside each range and at each range end, a sample outside, U+3099 = 0, U+FF61 = 1, U+3000 = 2, U+1F600 = 2 |
| W-2 | A 10,000-character ASCII `PName` and a 2,000-character CJK `LName` appear in full in the row. The row length equals the computed sum, and nothing is truncated or wrapped |
| W-3 | Alignment: for every row, `displayWidth` of the text before `LNAME` is the same, with mixed ASCII, CJK and escaped names (hand-computed expected strings) |
| W-4 | A line near the read limits: a `PName` line of 1 MiB inside the default `maxLineLength` (4 MiB) renders whole |

### 7.8 Original file immutability and confidentiality

- `tables` uses the existing read-only loader. The `imm-01` style test (`immutability.test.ts`)
  gains `tables` (text) and `tables --format json` runs over every staged synthetic fixture. Each
  must leave sha256, size and mtime unchanged.
- `tables` writes no file, temp file or cache, and makes no network call. A test runs it with the
  working directory set to an empty temp directory and checks that the directory is still empty.
- All tests use staged copies (`tests/helpers/stage.ts`) or generated documents in `mkdtemp`
  directories, never the committed files and never a real diagram.
- Tests do not print the output when they pass. A failure message shows the first differing line
  only for synthetic data.
- Text output prints names because the listing is the answer. It never prints `Comment`, `Query`,
  `details`, raw lines or the path, so it echoes strictly less file text than `inspect`.

---

## 8. E — Tests and acceptance

### 8.1 Expected results, derived independently

**How they are derived.** The rows below come from the fixture **text** and the format rules alone.
`tables` itself was never run for them: it does not exist. The rules: a section header is a line
that starts with `[` and ends with `]` after trimming, and it is counted in file order (unknown and
lowercase headers count as sections but are not objects). `LINE` is the last `PName` line, else
the header line, counting the BOM line as line 1. `DECLARED` is the number of `Field` lines.
`COMMON` is the number of `[Manager]` `CommonField` lines when `UsingCommonColumns` is absent or
`1`, and `0` for `0`. A view is `unknown`, with reason `view-columns-named-from-query` when
`LNameByComment=1` and `view-columns-not-stored` otherwise. **Cross-check (stated, not hidden):**
these rows were compared once with a projection of the baseline `inspect` output of all 39
synthetic fixtures, and none differed. The implementation must re-author the expectations in
`tests/helpers/tables-expectations.ts` from the fixture text and the specifications, not from this
table and not from serializer output (`docs/json-golden-provenance.md`).

Notation: `section/line kind declared/common/effective pname lname`. `?` is `unknown`, and `—` is
`null`.

| Fixture | Rows | Omitted subtypes |
|---|---|---|
| enc-02 | `1/5 entity 1/0/1 no_bom —` | — |
| fmt-01 | `2/8 entity 2/0/2 users ユーザー` · `3/17 entity 2/0/2 orders —` · `5/35 view ?/?/? active_users —` (not-stored) | — |
| fmt-02 | `1/5 entity 1/0/1 legacy_orders —` | — |
| fmt-03 | `2/7 entity 1/0/1 no_header —` | — |
| fmt-04 | `1/4 entity 0/0/0 hole —` | — |
| fmt-05 | `2/8 entity 1/0/1 future_format —` | — |
| hst-01 | `2/7 entity 1/0/1 nul_comment —` | — |
| hst-04 | `2/7 entity 1/0/1 hostile —` (`[<script>]`, `[[Entity]]` and the long header are unknown sections, not rows) | — |
| sem-01 | `2/7 entity 2/0/2 orders —` | — |
| sem-02 | `2/7 entity 1/0/1 case_page —` | — |
| sem-03 | `2/7 entity 2/0/2 parent_a —` · `3/13 entity 3/0/3 child_b —` | — |
| sem-04 | `2/7 entity 3/0/3 legacy_orders_21 —` | — |
| sem-05 | `2/7 entity 1/0/1 subtype_member —` | 1 (section 3) |
| sem-06 | `2/7 view ?/?/? view_with_lname —` (named-from-query) · `3/13 view ?/?/? plain_view —` (not-stored) | — |
| sem-07 | `2/9 entity 2/1/3 with_common —` · `3/15 entity 1/0/1 without_common —` | — |
| sem-08 | `2/7 entity 1/0/1 twin —` · `3/12 view ?/?/? twin —` (same name: two rows) | — |
| sem-09 | *(0 objects)* | — |
| sem-10 | `2/7 entity 1/0/1 no_position —` | — |
| sem-11 | `2/7 entity 0/0/0 no_fields —` | — |
| txt-01 | `2/9 entity 3/0/3 users ユーザー` · `3/18 entity 2/0/2 orders 注文` · `4/26 entity 0/0/0 audit_log 監査ログ` · `5/31 view ?/?/? active_users —` · `6/36 view ?/?/? order_summary —` | — |
| txt-02 | `2/7 entity 1/0/1 parent_t —` · `3/12 entity 2/0/2 child_t —` | — |
| txt-03 | `2/7 entity 2/0/2 table_a —` · `3/13 entity 2/0/2 table_b —` | — |
| txt-04 | `1/4 entity 0/0/0 known —` (`[Memo]` is unsupported) | — |
| txt-05 | `2/9 entity 1/0/1 dup_scalar —` | — |
| txt-06 | `2/8 entity 1/0/1 dup_manager —` | — |
| txt-07 | `1/4 entity 1/0/1 known_entity —` (`[entity]` lowercase is an unknown section, not a row) | — |
| txt-08 | `2/7 entity 1/0/1 spaced_header —` (`  [Entity] ` is a header) | — |
| txt-09 | `2/7 entity 1/0/1 with_empty_relation —` | — |
| val-01 | `1/4 entity 1/0/1 escapes —` | — |
| val-02 | `1/4 entity 2/0/2 users —` | — |
| val-03 | `1/4 entity 1/0/1 legacy_shape —` | — |
| val-04 | `2/7 entity 1/0/1 future_field —` | — |
| val-05 | `1/4 entity 1/0/1 no_color —` | — |
| val-06 | `1/4 entity 3/0/3 memberships —` | — |
| val-07 | `2/7 entity 3/0/3 colours —` | — |
| val-08 | `2/7 view ?/?/? split_query —` (not-stored) | — |
| val-09 | `2/7 entity 2/0/2 gap_pk —` | — |
| val-10 | `2/7 entity 1/0/1 equals_value —` | — |
| val-11 | `2/7 entity 1/0/1 unterminated —` | — |
| enc-03 (bytes) | `1/5 entity 0/0/0 注文 注文テーブル` | — |
| enc-05 (bytes) | `1/4 entity 0/0/0 utf16 —` | — |
| hst-05 (bytes) | `2/5 entity 1/0/1 mixed_eol —` | — |
| enc-04, hst-02 (bytes) | `failed`: `result: null`, no rows | — |
| hst-06, res-01, res-02, res-03 (generated or injected) | `failed`: `result: null`, no rows | — |

No committed fixture contains a `partial` entity, an object without a `PName`, a collision, or a
name with terminal controls. Those cases use generated documents (§8.6). The five byte-fixture
rows were derived from the decoded content in their module docstrings and were not
cross-checked.

### 8.2 Unit tests for the projection (`tests/view-tables.test.ts`)

- Invariants 1–6 of §5.4 for every synthetic and byte fixture (staged, real pipeline) and for every
  generated document of §8.6.
- `projectTables` on hand-built `JsonSchema` values for each arm: complete, partial, both view
  reasons, a subtype, an empty `objects`, a `null` `pname`/`lname` and an empty-string name.
- Purity: the input is deep-frozen and the call does not throw. Two calls give deep-equal results.
  The result shares no mutable array with the input.
- Exhaustiveness: a type-level test (`@ts-expect-error`) that an unknown `effectiveColumns.status`
  or `reason` does not compile.

### 8.3 Text integration tests (`tests/cli-tables-text.test.ts`)

Each case runs the real `dist/cli.js` on a staged fixture or a generated document and compares
**the whole stdout byte for byte** with a hand-authored expected string. It also checks stderr
exactly and the exit code:

- txt-01 (Example A), sem-05 (E), sem-08 (same name, plus the stderr `error` line), sem-09 (C),
  txt-04 and txt-07 (unsupported), hst-04 (hostile headers, warning), val-08 (`degraded` with a
  view), enc-04 and an empty file (D, `failed`), fmt-01 (CRLF fixture).
- Example B as a generated document (partial, missing name, CJK, long name, controls, `-`).
- The default is text: `tables f`, `tables --format text f` and `tables f --format text` give the
  same bytes.
- TTY independence: the output under `env: { COLUMNS: '20', TERM: 'xterm-256color',
  FORCE_COLOR: '1', LANG: 'ja_JP.UTF-8' }` equals the output under the default `runCli`
  environment.

### 8.4 JSON contract tests (`tests/json-tables-contract.test.ts`)

- The key order of the tables envelope is
  `contractVersion, tool, command, status, source, limits, result, unsupported, diagnostics, completeness`,
  and there is no `schema` key.
- For every synthetic and byte fixture: `JSON.parse(tables)` without `command` and `result` deep
  equals `JSON.parse(inspect)` without `command` and `schema`. The same holds for the bytes of each
  shared member, compared as `JSON.stringify` of each member (§5.5).
- `result` equals the hand-authored expectation of §8.1, and §5.4 holds against the inspect golden
  of the same fixture.
- `failed` fixtures: `source`, `result` and `completeness` are `null`.
- `toJsonString` rejects `undefined` inside a tables envelope (the replacer still applies).
- K-1: a type-level test that `JsonCommand` is exactly `'inspect' | 'validate'`, plus the
  existing `ENVELOPE_KEYS` checks, unchanged.
- One line plus `\n` on stdout. `JSON.parse` of the whole stream succeeds.

### 8.5 Full regression for `inspect` and `validate`

- All existing test files pass unchanged, except the edits in §9 T-1. That covers the 44 goldens,
  `cli.test.ts`, `validate-integration`, the immutability tests, the fuzz floor and the guards.
- A new byte-identity test: for every staged synthetic and byte fixture, for `inspect` and
  `validate`, stdout, stderr and the exit code of the built CLI equal those of the baseline. The
  expected stdout comes from the committed golden (path-scrubbed and with the version placeholder
  expanded, as `json-goldens.test.ts` already does), not from a re-run.
- The argv variants `--format json` before, between and after the operands, and repeated
  `--format json`, give the same bytes as today.

### 8.6 Unsupported, partial, same-name and missing-name cases

Generated documents are built inline by the test, written to a `mkdtemp` directory and removed in
`finally`, the same pattern as `withDocument` in `json-contract.test.ts`. They are never committed,
and the fixture registry and `.gitignore` do not change.

| Case | Document | Asserts |
|---|---|---|
| partial | `UsingCommonColumns=2` with one `CommonField` | `columns.status: partial`, `common`/`effective`/`collisions` `null`, text `unknown`, the partial note |
| partial + empty token | `UsingCommonColumns=` | as partial (the token is unrecognised, not absent) |
| default composition | `UsingCommonColumns` absent, two `CommonField`s | `common: 2`, `effective = declared + 2` |
| collision | a declared `Field` and a `CommonField` with the same physical name | `collisions: 1`, `effective = declared + common`, the effective note |
| no `PName` | an entity with no `PName` | row present, `pname: null`, text `-`, `LINE` = header line, `V_MISSING_REQUIRED_KEY` in the notes and on stderr |
| empty `PName` | `PName=""` | `pname: ''`, text `""` |
| name `-` | `LName="-"` | text `"-"`, distinct from `-` |
| same name, three kinds | an entity, a view and a subtype all named `x` | two rows, one omitted subtype, `V_DUPLICATE_OBJECT_NAME` reported, no merging |
| case-different names | `Users` and `users` | two rows, no duplicate diagnostic (exact match, `semantic/identity.ts`) |
| only subtypes | two `[Subtype]` sections | no header, `listed 0, omitted 2` |
| unsupported | unknown section, unknown key, legacy key, multiline value | the unsupported count by kind in first-appearance order equals the `unsupported` array |
| duplicate `PName` | `PName` twice in one entity | the last value is shown, and `S_DUPLICATE_KEY` is in the notes |

### 8.7 Goldens

- The 44 files in `tests/fixtures/json-goldens/` stay byte-for-byte unchanged. No tables golden is
  added there: the golden guard enumerates exactly the 44 inspect-shaped goldens, and the shared
  members are already reviewed in them.
- The tables JSON is pinned by structural equality with those goldens (§8.4) and by the
  hand-authored `result` expectations (§8.1).
- The text expectations are hand-authored string literals in
  `tests/helpers/tables-text-expectations.ts`, reviewed in the diff. No Vitest snapshots, no `-u`,
  and no expectation produced by running the renderer.
- The `<package-version>` placeholder rule is unchanged. Text output has no version in it.

### 8.8 CI: all 8 jobs

`.github/workflows/ci.yml` runs 8 jobs: `verify` and `pack smoke`, each on
`ubuntu-latest`/`windows-latest` × Node `24`/`26`. Acceptance requires all 8 green on the exact
pushed head SHA of the implementation PR, checked job by job. `verify` runs build, typecheck,
lint, format:check and test, so §7–§8 run on both operating systems and both Node versions. macOS
is not in the matrix. Its evidence is the manual run in §7.5, or it is reported as unverified.
Adding a `tables` step to `pack smoke` or adding a macOS job changes the workflow and needs its own
approval (§9).

### 8.9 Acceptance checklist for the implementation PR

1. `pnpm install --frozen-lockfile`, then `build`, `typecheck`, `lint`, `format:check` and `test`
   pass locally. Real output is reported, including platform skips (R-4).
2. All 8 CI jobs are green on the head SHA.
3. K-1 to K-5 hold (§5.9), and the rule amendment has been agreed.
4. §8.5 passes: the goldens are untouched, and `git diff` shows no change under
   `tests/fixtures/`.
5. No new entry in `package.json` `dependencies` or `devDependencies`, and `pnpm-lock.yaml` is
   unchanged.
6. The README and Skill updates (§9) are either in the PR as shipped behaviour, or explicitly
   deferred.
7. Independent review records an explicit PASS. The implementer does not self-certify.

---

## 9. Changes the implementation PR would make to existing files

Each needs agreement before it is made, because AGENTS.md protects these documents and tests.

| ID | File | Change |
|---|---|---|
| T-1 | `tests/cli.test.ts` | `names only the commands that exist`: the help now names `tables`, so the absent list becomes `['columns', 'relations', 'search', 'export']`, and a positive check for `tables` is added. `rejects a command this build does not implement` changes its example from `tables` to `columns`. The help assertions gain `--format text\|json`. These are the only edits to existing tests, and none removes an assertion |
| D-1 | `docs/architecture.md` §12 | The rule-6 amendment (§5.9). The first paragraph's "`--format json` is the only format… a `text` renderer remains a later command-level concern" becomes a pointer to this specification |
| D-2 | `docs/architecture.md` §3 | The pipeline sketch and the Output row: "stdout: one JSON envelope, or `tables` text" |
| D-3 | `src/json/envelope.ts`, `scripts/lib/version.mjs` | Comment wording aligned with the rule-6 amendment. No value changes |
| D-4 | `docs/test-strategy.md` | New test files, and the R-4 platform skip in §13 (CI mapping) |
| D-5 | `README.md` | Usage, exit `74` and text output. "`tables` … exits 2" is removed |
| D-6 | `skills/a5er-cli/SKILL.md` | Optional. The listing procedure could call `a5er tables --format json` instead of its inline projection. That is a separate decision, and until then the Skill stays as it is |
| C-1 | `.github/workflows/ci.yml` | Optional. A `tables` step in `pack smoke`. Needs separate approval |
| C-2 | `.github/workflows/ci.yml` | Optional. A macOS job. Needs separate approval |

No version change: `package.json#version` moves only through `pnpm release:prepare` in its own
reviewed PR.

---

## 10. Future commands (outline only, not specified)

**`a5er columns [--format text|json] <file> <pname>`**: the effective columns of one entity
(declared and common, in effective order, with collisions marked) or the `unknown` state of one
view. Selection is by exact `PName`. Exit `4` when the selection fails: no object has that name,
or more than one object does (the candidates are listed by section on stderr), or the selected
object is a subtype. A disambiguation option (for example `--section N`) is still open. The column
detail (data type, NOT NULL, key order, domain resolution) and the JSON shape are left to its own
proposal.

**`a5er relations [--format text|json] <file>`**: one row per `[Relation]`/`[Relationship]`,
with both endpoint names and how they resolved (resolved or dangling), the number of mapped columns
on each side, and the raw cardinality tokens. Exit policy as for `inspect`. The JSON shape is left
to its own proposal.

Both are expected to reuse §3.2's parsing rules, §3.3's explicit format, §4.4's escaping, §4.11's
width table, §7.2's writer and §5.1's discrimination by `command`. Each would add its own payload
member at position 7 under the same additive rule (§5.9).

## 11. Findings outside P0 (recorded, not acted on)

| ID | Finding | Proposed handling |
|---|---|---|
| F-1 | `inspect`/`validate` crash on a broken pipe or a stdout write error: exit `1` (the code for a failed read) and a stack trace that includes the install path (§7.1, measured) | A separate issue to adopt §7.2 for every command. It changes observable `inspect`/`validate` behaviour in that error case, so it needs explicit approval outside decision 6. R-C then flips |
| F-2 | `quote()` in misuse messages uses `JSON.stringify`, which leaves C1 controls and bidi controls in argv raw on stderr | A separate issue to reuse `renderName`'s escaping for argv echoes. It is user-supplied text, so the risk is low |
| F-3 | macOS is not in the CI matrix | C-2 above, if wanted |

No contract question about `tables` is left open (§5.9).
