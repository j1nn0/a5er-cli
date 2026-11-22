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
| chunk | One string handed to one `write()` call; always under 262,144 UTF-16 code units (§4.10, §5.10) |
| settle | The single, final outcome of the stdout write: accepted, closed, failed or generation-failed (§7.2). It is decided once, by the first event that determines it |
| accepted | Node accepted every chunk (every `write()` callback succeeded). Not a delivery guarantee (§3.7) |

---

## 2. Where `tables` sits in the pipeline

`tables` runs the same pipeline as `inspect`. It parses nothing on its own:

```
Phase A (eager, before any output; guarded, §7.2 item 10)
  loadSource → scanSource → classify → derivePartialSemantics    (unchanged, src/cli.ts inputFor)
        → integrate()                 exit policy: exitPolicy.inspect          (unchanged)
Phase B (lazy, pulled chunk by chunk by the writer)
  stdout: buildTablesEnvelope(input, integration, { path }) src/view/tables.ts        (new, pure)
        → --format json: encodeJson(tablesEnvelope)         src/json/stream.ts        (new, §5.10)
          --format text: renderTablesText(tablesEnvelope)   src/text/tables.ts        (new, §4.10)
  stderr: tablesDiagnosticLines(integration)                src/text/diagnostics.ts   (new, §3.6)
        → writeOutput({ stdoutChunks, stderrLines, … })     src/io/stdout.ts          (new, §7.2)
```

The tables envelope is a pure function of the stage results and of the `Integration` over those
same results, not of the inspect envelope: it selects its rows while it walks the classification,
takes every count from the semantic records, and shares the remaining members through one function
with `inspect`, so `serialize()` and `inspect.schema` are never built for `tables`. Two things
follow from that. `tables` and `inspect` cannot disagree about a file, because neither re-derives a
fact the other projects; and every fact `tables` reports is a length counted there or a value
copied from a record the CLI already holds. The CLI stays the only parser (AGENTS.md), and the
view layer only counts and copies.

`tables` never builds a whole output as one string, on stdout or on stderr. Both renderers and the
stderr line source are lazy, and the writer pulls bounded chunks from them one at a time (§4.10,
§5.10, §7.2). Because Phase B is lazy, an exception in the projection or in a renderer happens
inside the writer's guard, and is reported as an output-generation failure (§7.2), never as a
stack trace.

**Memory is not bounded by P0.** Peak heap still grows with the input: Phase A's stage results and
semantic records are held whole, which is the largest retained cost of a large diagram, and Phase B
additionally holds the rows, evidence, diagnostics and envelope it streams. `tables` no longer
builds `inspect`'s `schema`, so that document is not part of its peak; what the projection does
cost, and how much the omission saves, are measured rather than asserted here. Inputs within the
current read limits can still exhaust the default V8 heap (§7.1): the process then aborts, outside
every exit code of §3.7. This is tracked as F-4 in
[issue #27](https://github.com/j1nn0/a5er-cli/issues/27). P0 does not fix it. P1 measures it, and
the release decision for `tables` must address it (§11).

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

**No arguments.** `a5er` with an empty argv prints the help on stdout and exits `0`. This special
case comes before every rule below, as it does today.

**Scan.** Otherwise argv is scanned once, from left to right. Each token is classified as follows,
in this order:

| Token | Effect |
|---|---|
| `--help` or `-h` | sets *help* |
| `--version` or `-v` | sets *version* |
| `--format` | **always consumes the next token as its value**, whatever it looks like (`--help`, `-v`, `--format`, `""` and `json` alike). It is misuse if there is no next token, or if the value is not `text` or `json`. It is also misuse if an earlier `--format` gave a different value. Repeating the same value is accepted |
| any other token that starts with `-` | misuse (unknown option). This includes `-`, `--`, `--format=json`, `-hv` and `--FORMAT` |
| anything else | an operand, in order |

**The first violation wins.** The scan stops at the first token-level misuse and reports it. Tokens
after it are not examined, so with several violations the leftmost one is reported. Examples:

| argv | Result |
|---|---|
| `--format --help` | misuse: `unsupported --format value "--help"; supported values are text and json` (the value is consumed, so *help* is not set) |
| `--help --format` | misuse: `--format requires a value (text or json)` (token misuse wins over help) |
| `--bogus --help` | misuse: `unknown option "--bogus"` |
| `--format yaml --bogus` | misuse: `unsupported --format value "yaml"; …` (leftmost) |
| `--format json --format text --help` | misuse: `conflicting --format values "json" and "text"` |

**After the scan,** if there was no token misuse, these checks run in order. The first one that
applies decides:

1. *help* is set: help, exit `0`. This applies even when *version* is also set, and even when an
   operand check below would fail (`a5er --help bogus` prints the help, as today).
2. *version* is set: the version, exit `0`.
3. There is no operand: misuse `missing a command (inspect, validate or tables)`.
4. The first operand is not `inspect`, `validate` or `tables`: misuse `unknown command "<op>"`.
5. There is no second operand: misuse `missing the file operand for <command>`.
6. The second operand is empty: misuse `the file operand is empty`.
7. There is a third operand: misuse `extra operand "<op>"; exactly one file is read` (the third
   operand is quoted).
8. The command is `inspect` or `validate` and the format is `text`: misuse
   `unsupported --format value "text" for <command>; only json is supported`.
9. Otherwise the command runs with the explicit format, or the command's default (`json` for
   `inspect` and `validate`, `text` for `tables`).

Steps 1–7 are today's rules in today's order. Only the command list in step 3, `tables` in step 4,
and step 8 are new. Every `<op>` and format value in a message is quoted with `quoteArg` (§3.5).

### 3.3 Format selection is explicit

**When every write succeeds**, the output bytes and the exit code depend only on argv and the file
bytes:

- `process.stdout.isTTY`, `process.stderr.isTTY`, `COLUMNS`, `LINES`, `TERM`, `NO_COLOR`,
  `FORCE_COLOR`, `LANG`, `LC_ALL` and the time zone are never read. No pager is started.
- Numbers are written with `String(n)`. `toLocaleString`, `Intl.*` and locale collation are never
  used.
- The same argv and the same bytes give the same stdout, stderr and exit code on a terminal, in a
  pipe and in a file.

This determinism is a property of a successful write only: stdout settled as **accepted** and no
generation failure happened. When the stdout write fails, the pipe is closed, or output generation
fails, the bytes that reach the reader and the exit code also depend on when and how that happened
(§7.2). Even an **accepted** write is accepted by Node, not proven delivered (§3.7).

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
  70  tables failed internally while generating its output; stdout is
      incomplete
  74  tables could not write its output (a write error other than a closed
      pipe, or stdout closed early); stdout is incomplete

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
is `a5er: <message>\n\n<usage>\nRun 'a5er --help' for details.\n`.

**Quoting user-supplied tokens (`quoteArg`).** Today `quote()` is `JSON.stringify`. That escapes
C0 controls, `"` and `\` and lone surrogates, but it leaves DEL, C1 controls (including U+009B
CSI), bidi controls and the other invisible code points of §4.4.2 raw on stderr. `quoteArg` is
`JSON.stringify` followed by one more step: every escape-set code point (§4.4.2) that
`JSON.stringify` left raw is replaced by its JSON escape, `\uXXXX` with lowercase hexadecimal, the
style `JSON.stringify` itself uses. A code point above U+FFFF (the tag characters) is written as
its two `\uXXXX` surrogate escapes. The result is still a valid JSON string literal. For any
argument with no such code point, which covers every printable ASCII argument, the bytes are
exactly `JSON.stringify`'s, so no existing message changes. The `"--bad\ncontrol"` case that
`cli.test.ts` checks keeps its current text.

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
| `inspect` + an argument holding U+202E or U+009B | the code point raw inside the quotes | `\u202e` / `\u009b` inside the quotes |

Every message that `cli.test.ts` checks with `toContain` today still contains the checked
substring. The exceptions are the two assertions that use `tables` as an example of a command
that does not exist (§9, item T-1).

### 3.6 Streams

| | `--format text` | `--format json` |
|---|---|---|
| stdout | The table and notes (§4), UTF-8 without BOM, LF only, ending in `\n` | One tables envelope on one line, plus `\n` |
| stderr | One line per `fatal` or `error` diagnostic, the same bytes `inspect` prints | Same |
| delivery | Bounded chunks pulled lazily, never one whole-output string (§4.10) | Same (§5.10) |

**stderr is generated lazily for `tables`.** `tablesDiagnosticLines(integration)` in
`src/text/diagnostics.ts` yields one line per `fatal` or `error` diagnostic, in the integration's
own order. Each line is `a5er: <severity>: <code>: <message>` plus ` (line <startLine>)` when the
span is not `null`, plus `\n`: the fixed table text and the same line number that the existing
`renderDiagnostics()` writes. A test asserts that the concatenated lines equal `inspect`'s stderr
for the same input, byte for byte (§8.5, N-2). `renderDiagnostics()` itself, and the
`inspect`/`validate` output path, are not changed: they still build their stderr as one string.

**Order (fixed).** The writer (§7.2) first writes stdout until it *settles* (§7.2 table). Only then
does it write stderr, in this order:

1. the diagnostic lines, which are always written whatever the stdout outcome, so a write failure
   never drops a diagnostic;
2. then at most one outcome line: the stdout write error, the early close, or the output
   generation failure (§7.2 item 7);
3. then, only if the stderr line source itself threw, the stderr generation failure line.

stderr is written in chunks of the same bound as stdout (§4.10), with the same backpressure rule
(§7.2 item 8). Its errors are ignored. Losing stderr is the only way diagnostic lines can be lost.

`warning` and `info` diagnostics never reach stderr. In text mode they are summarised in the notes,
and in JSON mode the envelope holds the full record.

### 3.7 Exit codes

| Code | `tables` |
|---|---|
| `0` | `status` is `ok` or `degraded`, and stdout settled as **accepted** or **closed**. This includes `error` diagnostics and 0 rows |
| `1` | `status` is `failed` (a fatal read), and stdout settled as **accepted** or **closed**. The output is still written (§3.8) |
| `2` | Misuse (§3.5). Nothing is read, and stdout is empty |
| `3` | Never. Only `validate` turns an `error` diagnostic into an exit code |
| `4` | Never. Reserved for a future `columns` selection failure (decision 9) |
| `70` | **Internal output-generation failure** (§7.2 table, items 9 and 10): a JavaScript exception while computing the read in Phase A, while generating stdout chunks, or while generating stderr lines. stdout may hold a prefix of the output, or nothing |
| `74` | stdout settled as **failed**: a write error other than `EPIPE`, or a `'close'` before the output was complete (§7.2). Precedence: `74`, then `70`, then the read's `0`/`1` |

Codes `0` and `1` come from `integrate(input).exitPolicy.inspect`. `ExitPolicy` and `validate/`
are not changed, and the CLI maps `tables` to the `inspect` policy. A closed pipe (`EPIPE`) keeps
the code from the read.

**Why `70` and not `74` for a generation failure.** `74` (`EX_IOERR` in `sysexits.h`) means here:
the output was correct, but stdout refused it. A generation failure is a defect in this tool: the
output itself could not be produced, and retrying the same I/O cannot help. Using `74` for both
would make "fix the destination" and "report a bug" indistinguishable. `1` is already "failed
read", and `3`/`4` have other meanings. `70` (`EX_SOFTWARE`, "internal software error") is the
established code for this case. In both cases stdout must be treated as incomplete. (The Skill's
recorded run block exits `70` on its own `mktemp` failure, before it runs `a5er`. That is the
Skill's convention, not a CLI code, and §9 D-9 notes it.)

**What exit `0`/`1` does and does not prove.** **accepted** means that Node accepted every chunk:
every `write()` callback reported success. It is not a delivery guarantee. The data may still sit
in a pipe buffer when the reader dies, and when stdout was closed before the process started,
Node accepts the writes and the bytes go nowhere (§7.1: `>&-` exits `0`). So EOF plus exit `0` or
`1` does **not** by itself prove that the reader holds the complete output. A JSON consumer
should check all of the following, which detect most anomalies but are still not a delivery
guarantee:

1. the process ended normally, with exit `0` or `1` (not `2`, `70`, `74`, nor a signal);
2. stdout ends with exactly one `\n`, and that is its only line feed (compact JSON escapes every LF
   inside strings);
3. the whole stream parses as exactly one JSON value, and that value is an object;
4. `(command, contractVersion)` is a supported pair (§5.1), the keys match §5.3, `status` is one
   of the three values, its null rule holds (§5.4 item 8), and `status: failed` goes with exit `1`
   while `ok`/`degraded` go with exit `0`.

For text, the matching check is that the output ends with `\n` and its last line is the
completeness note or the dropped warning (§4.1). Text is for humans, and scripts use JSON.

The runtime itself can still end the process outside this table. The known case is a V8 heap
exhaustion abort wherever memory grows with the input: Phase A's stages, which hold the
classification and the semantic records whole (§2, §7.1, F-4), the Phase B document build, or the
streaming encode of a very large envelope (§5.10, §7.1). A heap abort ends the process by signal
(`SIGABRT`, exit status `134` in a POSIX shell), which no `70`/`74` handling catches. If the abort
happens before the first stdout chunk, stdout stays empty; if it happens after output started,
stdout can hold a prefix. No byte count is guaranteed for a signal abort — a consumer must treat
any signal termination as a failure (check 1 above).

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

- the help text (tables lines, the `--format` description and exit codes `70` and `74`);
- the usage block in misuse messages (one more line);
- the misuse messages listed in §3.5;
- `quoteArg`: a misuse message that quotes an argument containing an escape-set code point that
  `JSON.stringify` leaves raw (DEL, C1, bidi and the other invisible code points of §4.4.2) now
  shows that code point as `\uXXXX`. This applies to `inspect` and `validate` misuse too. Misuse
  is not the `run()` path, and arguments without such a code point give the same bytes as today;
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
| `PNAME` | physical name (§4.4), aligned up to the cap below | left |
| `LNAME` | logical name (§4.4); last column, never padded | left |

- Two spaces separate columns.
- **Fixed columns.** The width of `SECTION`, `LINE`, `KIND`, `DECLARED`, `COMMON` and `EFFECTIVE`
  is the largest display width (§4.11) of the header and the cells. These cells are decimal
  numbers, `unknown`, `entity` or `view`, so their width is bounded by the digits of the largest
  section, line or count: at most 7 digits under the default `maxLines` of 2,000,000.
- **`PNAME` alignment cap: 48 display cells.** Let `wᵢ` be the display width of row *i*'s
  rendered `PNAME` (after quoting and escaping). The `PNAME` column width is
  `W = max(5, max{ wᵢ : wᵢ ≤ 48 })`, where 5 is the width of the header `PNAME`.
  - A row with `wᵢ ≤ 48` is padded to `W`, then two spaces, then `LNAME`.
  - A row with `wᵢ > 48` is **not truncated**. The full name is written, then exactly two
    spaces, then `LNAME`. Alignment is relaxed for that row only. The other rows and the header
    keep `W`.
  - Why 48: before `PNAME` the fixed columns take about 53 cells (with up to 4-digit line numbers).
    `53 + 48 + 2` leaves `LNAME` starting at about column 104, which is still inside a common 120-
    to 132-column terminal. 48 cells also cover typical physical names: Oracle's classic 30-byte
    limit, and most names below PostgreSQL's 63-byte and MySQL's 64-character limits. A larger
    cap pushes `LNAME` off typical terminals for every row, and a smaller one breaks alignment for
    common names. The cap is a constant (`PNAME_ALIGN_CAP = 48`), not an option.
- Right-aligned cells are padded on the left, and left-aligned cells on the right, except
  `LNAME`, which is the last column and gets no trailing padding.
- **Padding is bounded.** No row gets more than `W ≤ 48` cells of `PNAME` padding, plus the
  bounded fixed-column padding. The total padding is at most linear in the number of rows, whatever
  the longest name is. (Without the cap, one 200,001-character name among 4,000 rows would need
  about 800 million padding characters: §7.1.)
- The counts come before the names on purpose. Only `PNAME` needs width-dependent padding, so a
  width the terminal measures differently can only shift the `LNAME` column. It can never move a
  count.
- Row order, column order, cell values and the escaping rules of §4.4 do not depend on the cap.

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
- **Order of the unknown notes is fixed by reason, in definition order**, not by row order:
  `view-columns-not-stored`, then `view-columns-named-from-query` (the order of `ViewColumnReason`
  in `src/semantic/views.ts`), then `using-common-columns-unrecognised` (the partial entity
  reason). Each note appears only if at least one row has that reason, and lists all of that
  reason's sections in file order. So a file with a partial entity in section 2 and a
  `LNameByComment=1` view in section 3 prints the named-from-query note first, then the partial
  note.
- Diagnostic groups are keyed by `(severity, code)` in order of first appearance. That order is the
  envelope's source-line order (Skill item 3).
- `details` is never printed: it holds file text. `message` is fixed table text. As defence in
  depth it still goes through `escapeText`, which replaces escape-set code points (§4.4.2) with
  `\u{XXXX}` but never quotes. For the current ASCII messages this changes nothing.
- The only file-derived text in the output is the two name columns, and both are escaped (§4.4).
  Every other token is fixed vocabulary or a number.
- **How lists are produced (bounded).** For the diagnostic groups, one pass over `diagnostics`
  records, per `(severity, code)` key in order of first appearance, the list of diagnostic indexes
  (numbers). Each group line is then emitted from its index list as separate pieces (§4.10): the
  fixed `#   <severity> <code>: <message> (` prefix, one `line <n>` or `file` piece per
  diagnostic with `, ` between them, and `)` plus `\n`. The section lists of the omitted and
  unknown notes, and the kind counts of the unsupported note, are built the same way: from number
  lists and counters, emitted piece by piece. No list is ever joined into one string. The order of
  the fixed message and of the locations is exactly the one stated above.

### 4.9 Completeness and omissions

`tables` deliberately shows a limited view of the file, in text and in JSON alike. It must not
look like the whole file, so the limits are stated:

1. **Entities and views are listed completely.** Every entity and view in `schema.objects` is a
   row, in file order (§4.2). None is merged, de-duplicated or left out.
2. **Subtypes are omitted, with a count and references.** The objects note counts them, and the
   omitted note gives the section of each one (§4.7). JSON carries the same facts in
   `result.omitted.subtypes` (`count`, `sectionIndexes`).
3. **`unsupported` and `completeness` are reported.** Text counts `unsupported` by kind, `0`
   included, and prints every `completeness` count; they are never summarised as a single "OK".
   The JSON envelope carries both members in full, verbatim from the inspect envelope (§5.5).
4. **No structured fields for relations, columns or view queries.** `result` has no member for
   relations, pages, domains, common-field definitions, indexes, primary keys, `Comment`, `Query`,
   or per-column details such as column names, data types and NOT NULL. Only the column counts of
   §4.5 are reported. This is a statement about structure, not about strings: the shared members
   `unsupported` and `diagnostics` are copied verbatim from the inspect envelope, and their
   evidence can hold source text of such constructs. For example, `unsupported[].raw` of an
   unknown key inside a `[Relation]`, or of a continuation line of a `Query`, is that line's text
   (§5.7). The text output never prints those members' text (§4.8).
5. **For more detail, use `a5er inspect`.** It returns the detailed model that the current parser
   builds, together with the evidence it retained (`unsupported`, `diagnostics`, `completeness`).
   It does not claim to interpret or reconstruct every input completely. What it does not model is
   reported as unsupported evidence or diagnostics instead (`architecture.md` §4.3, §13).

### 4.10 Long names

**No truncation.** Names are never truncated, wrapped or ellipsised, and lines have no length
limit. The full rendered name is always written, and the escaping of §4.4.1 is reversible, so the
original value can always be recovered from the text. JSON carries the exact value (§5.10).

**Bounded alignment.** A long name never widens the table: the `PNAME` cap of §4.3 limits the
alignment width to 48 cells. A longer name relaxes alignment for its own row only. The terminal
width is never read (§3.3).

**Bounded rendering.** `renderTablesText` returns an iterable of string chunks, not one string:

- **Pass 1** walks the rows and computes, for each row, the display width of the rendered `PNAME`,
  and the fixed-column widths. It does this arithmetically, code point by code point. A bare code
  point adds its §4.11 width, an escaped code point adds the length of its `\u{…}` text (8 to 10
  ASCII cells), and quotes add 1 each. The escaped string itself is never built. Pass 1 keeps only
  numbers.
- **Pass 2** emits every line as a sequence of pieces: the fixed cells, the padding, the name
  pieces and `\n`. A name is rendered by walking its code points and escaping them in slices of at
  most 16,384 code points. One escaped code point is at most 10 code units (`\u{10FFFF}`), so a
  slice is at most 163,840 code units.
- **Chunks.** Pieces are appended to a buffer, and the buffer is yielded as a chunk once it holds
  at least 65,536 code units. Every chunk is therefore under 262,144 code units (a test asserts
  this bound, §7.7). The last chunk ends with the final `\n`.
- **Surrogate pairs.** A slice and a chunk boundary never fall between a high surrogate and the low
  surrogate that follows it. This matters for more than display: Node encodes each `write()` string
  to UTF-8 separately, so a split pair would turn into two U+FFFD characters on the wire. Lone
  surrogates cannot reach a chunk boundary raw, because they are escaped (§4.4.2).
- **Notes are streamed too** (§4.8). A note line is emitted piece by piece: its fixed prefix, then
  one piece per listed item (`section 7`, `, 8`, `line 31`, `, line 36`, `file`), then its closing
  text. A note line may be hundreds of KB long (30,000 diagnostics of one code give one line of
  about 349,000 characters), but it never exists as one string. Like every other piece, it is cut
  into chunks at the 65,536-code-unit threshold, so a chunk boundary may fall inside a note line.
- **stderr** follows the same rule: `tablesDiagnosticLines()` yields one short line at a time
  (fixed text plus a line number, under 200 code units), and the writer chunks them (§7.2 item 8).
- **Forbidden.** No `rows.join(…)`, no `locations.join(', ')`, no `sections.join(', ')`, no
  concatenation of a whole output, note line or stderr text, no `padEnd`/`repeat` wider than the
  bounded widths above, and no escaped copy of a whole name.

Memory for the output is therefore one chunk, plus the per-row width numbers and the per-group
index lists of §4.8 (numbers, not strings), whatever the input size. The inspect envelope that the
renderer reads is already in memory (§2).

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
SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME                             LNAME
      2     9  entity         2        1          3  customers                         顧客
      3    16  entity         1  unknown    unknown  order_lines_with_a_deliberately_long_physical_name  受注明細
      4    22  entity         0        0          0  -                                 名前のない表
      5    28  view     unknown  unknown    unknown  customers                         "顧客 一覧"
      6    34  entity         1        0          1  社員マスタ                        社員
      8    45  entity         0        0          0  "evil\u{001B}[2J\u{202E}txt.exe"  "-"
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

The `PNAME` column is `W = 32` cells wide: the widest rendered name within the 48-cell cap is the
quoted, escaped `"evil\u{001B}[2J\u{202E}txt.exe"`. The `社員マスタ` cell is 10 cells wide (five
width-2 code points), so it gets 22 spaces of padding where `customers` gets 23. The 50-character
`order_lines_…` name is over the cap, so it is written in full, followed by exactly two spaces and
`LNAME`. Only that row is not aligned. Because `LINE` is the `PName` line, row 4 (no `PName`)
reports its header line, 22.

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

**Decoder selection key: `(command, contractVersion)`.** A consumer selects its decoder from both
members together. `command` sits at position 3 and `contractVersion` at position 1 in every shape,
before any member that differs. The supported pairs at this version are `("inspect", "0.1.0")`,
`("validate", "0.1.0")` and `("tables", "0.1.0")`. A consumer must reject a pair it does not
support explicitly, an unknown `command` included. It must never guess the shape from which keys
happen to be present, and never treat an unknown command as `inspect`.

**What is not guaranteed.** A consumer written for 0.1.0 that selects its decoder by
`contractVersion` alone, and assumes every 0.1.0 document has `schema`, is not guaranteed to
decode a tables document. Such a consumer keeps working, byte for byte, for every `inspect` and
`validate` document (§5.9 K-1, K-2). It only meets a tables document if it runs the new
`a5er tables --format json` (K-3), and then it must fail rather than misread it. This is the
compatibility boundary on which keeping `0.1.0` rests (§5.9).

### 5.2 Type definitions (proposed additions to `src/json/envelope.ts`)

Field order is emission order, as for every existing interface. No emitted member is optional: a
member with nothing to say is `null` or a status object, never `undefined`. The only optional
member is the type-level `schema?: never` below, which is never emitted.

```ts
/** The one command whose envelope carries a projection instead of the schema. */
export type JsonTablesCommand = 'tables';

/**
 * An inspect/validate envelope as a tables-aware consumer sees it. `JsonEnvelope` itself is not
 * changed; `result?: never` is a type-level statement that the key is absent.
 */
export type JsonSchemaDocument = JsonEnvelope & { readonly result?: never };

/** Every document the CLI can emit, discriminated on `command` (§5.1). */
export type JsonDocument = JsonSchemaDocument | JsonTablesEnvelope;

/** `a5er tables --format json` for a read that is not fatal. */
export interface JsonTablesEnvelopeRead {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly tool: { readonly name: typeof TOOL_NAME; readonly version: typeof TOOL_VERSION };
  readonly command: JsonTablesCommand;
  readonly status: 'ok' | 'degraded';
  readonly source: JsonSource;
  readonly limits: JsonLimits;
  readonly result: JsonTablesResult;
  readonly unsupported: readonly JsonUnsupported[];
  readonly diagnostics: readonly JsonDiagnostic[];
  readonly completeness: JsonCompleteness;
  /** Type-level only: a tables envelope never has a `schema` key (§5.3). Not emitted. */
  readonly schema?: never;
}

/** `a5er tables --format json` for a fatal read. */
export interface JsonTablesEnvelopeFailed {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly tool: { readonly name: typeof TOOL_NAME; readonly version: typeof TOOL_VERSION };
  readonly command: JsonTablesCommand;
  readonly status: 'failed';
  readonly source: null;
  readonly limits: JsonLimits;
  readonly result: null;
  readonly unsupported: readonly JsonUnsupported[];
  readonly diagnostics: readonly JsonDiagnostic[];
  readonly completeness: null;
  readonly schema?: never;
}

export type JsonTablesEnvelope = JsonTablesEnvelopeRead | JsonTablesEnvelopeFailed;

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
  /** The object's `span`, its four members copied: its last `PName` line, else its header line. */
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

`JsonCommand` (`'inspect' | 'validate'`), `JsonEnvelope`, `SerializeContext`, `ExitPolicy`,
`serialize()` and `toJsonString()` do not change. Tables JSON is not produced by `toJsonString`
but by the bounded encoder of §5.10. The package entry point (`src/index.ts`) exports only
`VERSION` today, and it keeps doing so: none of these types become public library API.

**`?: never` is type-level only.** It does not add a JSON member, and the encoder never writes
`undefined` (§5.10 rejects it). TypeScript still allows *reading* the key: `envelope.schema` on a
tables envelope compiles and has type `undefined`. What it forbids is *assigning* a value that has
the key. A variable with `schema: JsonSchema | null` is not assignable to `JsonTablesEnvelope`,
and under the repository's `exactOptionalPropertyTypes: true` neither is `schema: undefined`. The
same holds for `result` on `JsonSchemaDocument`. The two arms likewise reject a `failed` value with
a non-null `source`/`completeness` and an `ok`/`degraded` value with a `null` `result`. §8.4 tests
exactly these assignments. Runtime absence of the keys does not follow from the types: it comes
from the construction rule of §5.3, and the CLI JSON contract tests of §8.4 check it.

### 5.3 `schema` and `result`

- A tables envelope has **no** `schema` member, and an inspect or validate envelope has **no**
  `result` member. `result` sits at the position `schema` has in the inspect envelope.
- `result` agrees with the `schema` that `inspect` emits for the same bytes: it equals
  `projectTables(inspect.schema)`, the oracle projection kept in `src/view/tables.ts` for
  comparison. `result` is `null` if and only if the read failed — the same condition that makes
  `inspect.schema` `null`. The number table below states this agreement (equal values); at runtime
  the counts are lengths taken from the semantic records (§2, §5.5).
- Why not both: the schema of a small file is already tens of KB (Skill, "Run"). `tables` exists
  to give a small answer, and its `result` echoes fewer file-derived strings than the full schema.
  For the full model, run `inspect` (§4.9).
- `result` invents nothing (see the number table below).

**Construction rule (runtime).** `buildTablesEnvelope(input, integration, { path })` builds every
object as an object literal with its keys spelled out, in emission order. It never uses spread
(`...e`), `Object.assign`, `structuredClone` or any other copy of an inspect object, because a copy
would carry `schema` or other keys along — and it never has one: `serialize()` is not called. The
strict replacer of `serialize.ts` rejects `undefined`, functions, symbols, `bigint` and non-finite
numbers, but it would serialise an extra *defined* key without complaint. So the replacer does not
protect the key set. Explicit construction does, and the key-set tests of §8.4 check it. The key
lists are constants in `src/view/tables.ts`:

| Object | Keys, in order |
|---|---|
| envelope | `contractVersion, tool, command, status, source, limits, result, unsupported, diagnostics, completeness` |
| `result` | `objects, tables, omitted` |
| row | `objectIndex, sectionIndex, span, kind, pname, lname, columns` |
| `span` | `sectionIndex, startLine, endLine, keyLine` (copied member by member into a new object) |
| `columns` | `status, reason, declared, common, effective, collisions` |
| `omitted` | `subtypes` |
| `omitted.subtypes` | `count, sectionIndexes` |

The shared members (`source`, `limits`, `unsupported`, `diagnostics`, `completeness`) come
from `sharedEnvelopeMembers()` in `src/json/serialize.ts`, the one function the inspect envelope
uses too, over the same input and one `Integration` of it (§5.5). `tool` is the `TOOL_NAME` /
`TOOL_VERSION` constant and `command` is the invocation's own; `status` comes from the
`Integration`. Their key sets are those of the existing contract, and the goldens already pin them.

**Status and nulls (runtime).** `JsonTablesEnvelope` is a discriminated union: the read arm carries
`status: 'ok' | 'degraded'` with non-null members, and the failed arm carries `status: 'failed'`
with `source`, `result` and `completeness` all `null`. The builder still confirms the consistency
of its input and `Integration` at runtime, and `toTablesEnvelope()` keeps the same check over the
received `JsonEnvelope` as the comparison oracle; any other combination is a defect and throws. The
throw runs inside the first `next()` of the stdout generator (§2, Phase B), before any chunk
exists, so the writer reports a generation failure (exit `70`, §7.2). Directly tested: the oracle
rejects a contradictory envelope (`tests/view-tables.test.ts`), and a missing semantic record
turns into a generation failure with empty stdout (`tests/tables-command.test.ts`). A
`status`/null contradiction inside the builder itself has no direct injection test and is not
claimed as tested.

**Numbers: counted versus copied.**

| Member | Kind | Source |
|---|---|---|
| `result.objects` | count | `schema.objects.length` |
| `columns.declared`, `.common`, `.effective`, `.collisions` | count | `effectiveColumns.declared.length`, `.common.length`, `.columns.length`, `.collisions.length` |
| `omitted.subtypes.count` | count | the number of `subtype` objects (`=== sectionIndexes.length`) |
| `objectIndex` | position | the object's index in `schema.objects`, taken while iterating. It is not a count |
| `sectionIndex` | copied | `object.sectionIndex` |
| `span.sectionIndex`, `.startLine`, `.endLine`, `.keyLine` | copied | `object.span` |
| `omitted.subtypes.sectionIndexes[]` | copied | each subtype's `sectionIndex` |

A count is never copied from a stored number, and a copied value is never recomputed.

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
7. Every object in the tables envelope has exactly the keys of §5.3, in that order. There is no
   `schema` key, and the inspect envelope of the same input has no `result` key.
8. `status: failed` implies `source`, `result` and `completeness` are `null`.
   `status: ok|degraded` implies all three are non-null.

### 5.5 Shared members

`contractVersion`, `tool`, `status`, `source`, `limits`, `unsupported`, `diagnostics` and
`completeness` must deep-equal the inspect envelope's members for the same input, and must
serialise to the same bytes. Of these, five come from the helper both envelopes share
(`sharedEnvelopeMembers()` in `src/json/serialize.ts`, over the same input and one `Integration`
of it): `source`, `limits`, `unsupported`, `diagnostics` and `completeness`. The remaining members
do not come from the helper: `contractVersion` and `tool` are constants, `command` is the
invocation's own, and `status` comes from the `Integration` — so neither document is projected from
the other and neither rebuilds the shared five. Their meaning, rules 1–4 and 7 of
`architecture.md` §12, and the `limits` semantics apply unchanged.

### 5.6 `failed`

`status: 'failed'` means `source: null`, `result: null` and `completeness: null`
(`JsonTablesEnvelopeFailed`). `diagnostics` holds the fatal record, as in the inspect envelope.
Conversely, `ok` and `degraded` always carry a non-null `source`, `result` and `completeness`
(`JsonTablesEnvelopeRead`). Sample (empty input; `tool.version` is shown as the golden
placeholder):

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

The JSON bytes are those of standard `JSON.stringify` escaping, as in `inspect`, written by the
bounded encoder of §5.10. A name keeps its exact
value: C0 controls appear as `\u001b`, while U+202E and C1 controls appear as raw UTF-8. A consumer
that prints JSON strings to a terminal must sanitise them itself. The text renderer (§4.4) does
this for humans.

**Confidentiality.** Like the inspect envelope, `tables --format json` can contain file text and
local paths, in addition to the names in `result.tables`. The absence of structured fields for
relations, columns or `Query` (§4.9) does not mean that their text cannot appear as strings:

- `unsupported[].raw`: the source text fragment that an existing evidence record keeps verbatim,
  typically the whole line it points at (a header line, a `key=value` line, a continuation line).
  Its `sectionHeader` and `key` are file text too. Such a line can belong to any section,
  including a `[Relation]` or a view's `Query`;
- `diagnostics[].details`: values taken from the file (for example a subtype name) or from the
  read (for example the path and `errno` of `E_IO`);
- `source.path`: the path exactly as given on the command line.

The two formats have different priorities. JSON is for machines and keeps information intact: it
carries these members unchanged and does not neutralise terminal controls. Text is for humans and
puts safe display first: it prints none of these members (§4.1, §4.8, §7.8), and it escapes the
only file-derived text it shows, the names (§4.4). Handle JSON output with the same care as
`inspect` output (Skill, "Confidentiality").

### 5.8 Byte compatibility of existing commands

- `serialize.ts` adds `sharedEnvelopeMembers()` (§5.5), and `serialize()` itself calls it for the five
  shared members; the `inspect`/`validate` bytes are unchanged, which independent review confirmed
  (88/88 byte compatibility). `envelope.ts` only gains declarations. `cli.ts` keeps the `run()` path
  for `inspect` and `validate` as it is: the same `serialize(input, { command, path })`, the same
  `toJsonString`, the same `renderDiagnostics`, the same write calls.
- The 44 committed goldens and `json-goldens.test.ts` do not change, and they must pass.
- The CLI tests for `inspect` and `validate` pass without edits, except the two help and
  unknown-command assertions in §9 T-1, which are about the global surface (§3.10).

### 5.9 `contractVersion` stays `0.1.0`

**Why it cannot move.** Every committed golden asserts `contractVersion: "0.1.0"`, and
`release:check` compares the goldens with `CONTRACT_VERSION`. A bump would change the bytes of every
`inspect` and `validate` envelope, which decision 6 forbids. Keeping `0.1.0` is therefore a
consequence of decision 6. It holds only together with the compatibility boundary of §5.1 and the
document revisions in §9 (D-1 to D-7).

**Conditions.** Each is checked by a test in §8:

| ID | Condition |
|---|---|
| K-1 | `JsonEnvelope` loses, gains, renames and reorders no member, and `JsonCommand` stays `'inspect' \| 'validate'` |
| K-2 | Every `inspect` and `validate` output is byte-identical to the baseline (§3.10): goldens, CLI tests and the byte regression of §8.5 |
| K-3 | A tables envelope can only be reached through `a5er tables --format json`, which is misuse today. So no invocation that produced an envelope before produces a different one |
| K-4 | The shared members of the tables envelope equal the inspect envelope's (§5.5), so a consumer's handling of those members stays valid for them |
| K-5 | The revisions D-1 to D-7 of §9 are agreed and applied together with the implementation |

**What K-1 to K-5 guarantee, exactly:**

- **G-1.** For `command` `inspect` or `validate` at `0.1.0`: the same argv and bytes give the same
  document, byte for byte, as at the baseline (K-1, K-2).
- **G-2.** No invocation that was accepted before now yields a tables document (K-3).
- **G-3.** In a tables document, the eight shared members mean what they mean in the inspect
  document of the same input, and serialise to the same bytes (K-4).
- **G-4.** The contract documents describe the per-command shapes, and the selection key of §5.1
  (K-5).

**What they do not guarantee:** that a consumer selecting its decoder by `contractVersion` alone
can decode every `0.1.0` document. A tables document has no `schema`. Such a consumer is outside
the boundary and must reject the document (§5.1).

**Rule amendment** (D-1, applied in the implementation PR with agreement). The current wording
does not agree with itself. `architecture.md` §12 rule 6 says unknown fields are *additive*, and
only removing or renaming one bumps the version. The comments in `src/json/envelope.ts` and
`scripts/lib/version.mjs` say the version moves when a field is *added*, removed or renamed. The
proposed single wording, for all three places:

> `contractVersion` versions the envelope of each command. It moves when a field of an existing
> command's envelope is added, removed, renamed or reordered, or when the meaning of a value
> changes. A new command that has its own envelope shape, is selected by `(command,
> contractVersion)`, keeps the shared members verbatim and leaves every existing envelope
> byte-identical is additive and does not move it. Consumers select decoders by `(command,
> contractVersion)` and reject pairs they do not support.

**Not covered by `contractVersion`:** the text output of `tables`. Text is for humans. It is
specified and tested here, and changing it needs a reviewed change to this specification and its
tests, but it is not the machine contract. Scripts must use `--format json`.

### 5.10 Bounded JSON emission

`toJsonString` (one `JSON.stringify` of the whole envelope) is what `inspect` uses. It is not safe
to assume for the largest inputs the read accepts. A 20,878,001-byte synthetic file of 1,999,000
unknown keys (within `maxBytes` and `maxLines`) makes today's `inspect` throw
`RangeError: Invalid string length` inside `toJsonString` (§7.1). Its envelope would exceed V8's
maximum string length of 536,870,888 code units. A tables envelope carries the same `unsupported`
and `diagnostics`, so it can be just as large. Tables JSON is therefore produced by a streaming
encoder, `encodeJson(document: JsonTablesEnvelope): Iterable<string>` in `src/json/stream.ts`. It
is lazy: each `next()` does a bounded amount of work.

**Scope.** The encoder accepts exactly the data that `buildTablesEnvelope()` produces
(`toTablesEnvelope()` produces identical documents as the comparison oracle): plain objects and
arrays whose leaves are strings, finite numbers, booleans and `null`.
For that data it guarantees byte equivalence with `JSON.stringify(document, strictReplacer)`.
Nothing outside that scope is accepted, so nothing outside it needs to be equivalent.

**Traversal (the same order `JSON.stringify` uses):**

- **Objects:** keys in `Object.keys(value)` order. That is the JavaScript own-property order:
  array-index keys (canonical decimal integers below 2³² − 1, such as `"0"` or `"42"`) first, in
  ascending numeric order, then every other string key in insertion order. So `"01"` and
  `"4294967295"` are ordinary keys. `JSON.stringify` uses the same `[[OwnPropertyKeys]]` order, so
  the encoder never sorts and never relies on insertion order alone. In the tables envelope every
  key is a contract name or a `details` name from the code, never file text and never numeric, but
  the rule is stated so that equivalence does not depend on that.
- **Arrays:** indexes `0` to `length − 1`, in order. A hole reads as `undefined`, and the strict
  replacer rejects it, just as `JSON.stringify` with that replacer would.
- **Replacer:** for every value, the encoder calls `strictReplacer.call(holder, key, value)`. The
  key is `''` for the root, the index as a string inside arrays and the property key inside
  objects, and the holder is the containing object (`{ '': document }` for the root). `undefined`,
  functions, symbols, `bigint` and non-finite numbers therefore throw a `TypeError`, exactly as
  today. `strictReplacer` is exported from `serialize.ts` with no behaviour change.

**Explicitly rejected (a `TypeError`, which the writer reports as a generation failure, §7.2):**

- an object whose prototype is not `Object.prototype` or `null`, or an array whose prototype is not
  `Array.prototype`. This covers class instances, `Date`, `Map`, `Set`, boxed primitives and typed
  arrays;
- any object or array that has a `toJSON` member, own or inherited (`'toJSON' in value`), because
  `JSON.stringify` would call it;
- an accessor property among the `Object.keys` (`Object.getOwnPropertyDescriptor(value, key)`
  without a `value` member), because `JSON.stringify` would run the getter.

Symbol-keyed and non-enumerable properties are not in `Object.keys`, and `JSON.stringify` ignores
them too, so they need no rule. A `Proxy` cannot be detected and is out of scope: neither
`serialize()` nor the projection ever creates one.

**Strings, including keys.** A string or a key is written as `"`, then the string in slices of at
most 16,384 code units, each escaped as `JSON.stringify(slice).slice(1, -1)`, then `"`. A slice
never ends on a high surrogate that is followed by a low surrogate: the cut moves back by one code
unit. `JSON.stringify` escapes code unit by code unit, except that a surrogate is written raw when
it is part of a pair and as `\uXXXX` when it is lone. A cut that never separates a pair cannot
change whether any surrogate is lone, so the concatenated slices equal `JSON.stringify` of the
whole string. Keys use the same slicing for the *output*, so a long key never makes an output
chunk large.

**Temporary strings are a separate matter.** The 262,144-code-unit guarantee is about output
chunks only. It does not bound every temporary string the encoder creates. In particular, the
unchanged `strictReplacer` builds its error context, `` ` at key ${JSON.stringify(key)}` ``, on
**every** call, before it looks at the value. So each value costs one temporary string whose
length is proportional to its key. P0 does not change `strictReplacer` to avoid this.

- **Reachable from product input:** `buildTablesEnvelope()` (and the identical `toTablesEnvelope()`
  oracle) only produce keys that
  are fixed short names from the code (the longest is a few tens of characters), plus array
  indexes, which have at most 7 digits under the default `maxLines`. `details` keys are fixed names
  too, and file text only ever appears in values (whose `details` strings are bounded to 200
  characters). So in real use these temporary strings are small and do not depend on the file.
- **Generalized encoder tests only:** the 40,001-code-unit key of §8.4 and the other key cases
  exist to prove byte equivalence for arbitrary in-scope keys. They do create temporary strings of
  that size, and that is accepted, because no product input produces such a key. The chunk-bound
  assertions in those tests apply to the output chunks, not to these temporaries.

**Other values:** numbers, booleans and `null` are written with `JSON.stringify(value)`, so `-0`
becomes `0` as in `JSON.stringify`.

**Chunks.** Pieces go into a buffer, which is yielded once it holds at least 65,536 code units. A
piece is at most 6 × 16,384 + 2 code units, so every chunk is under 262,144 code units. The last
chunk ends with `\n`.

**Equivalence**, tested by B-5 and the encoder cases of §8.4: for every in-scope document that
`JSON.stringify` can hold as one string, `[...encodeJson(d)].join('')` equals
`JSON.stringify(d, strictReplacer) + '\n'`, the same call `toJsonString` makes. For larger documents,
the bytes are by definition the ones `JSON.stringify` would produce if it had no length limit.
`toJsonString`, `serialize()` and the `inspect`/`validate` bytes do not change.

**Measured feasibility** (throwaway prototypes outside the repository, Linux, Node v24.22.3):

- The large envelope above (1,999,000 `unsupported` and 1,999,001 `diagnostics` records), written
  by this chunking scheme, produced 951,520,194 bytes of valid JSON in 13.8 s. The largest chunk
  was 65,792 code units, the heap held 2,455 MiB after encoding, and peak RSS was 2.75 GB. Python's
  `json` module parsed the result.
- An encoder prototype following the rules above gave output equal to `JSON.stringify` on 10 of 10
  edge-case documents. They covered numeric and non-index keys (the order came out as `"1"`, `"2"`,
  `"b"`, `"01"`, `"4294967295"`, `"a"`), keys with quotes, backslashes, controls and lone
  surrogates, a 40,001-code-unit key, a pair straddling code unit 16,384, a lone high surrogate at
  code units 16,383 and at the end, a lone low surrogate at 16,384, a pair at code unit 65,535, and
  `-0`/`1e21`. It rejected an accessor, `toJSON`, `Date`, `Map`, a boxed number, a class instance,
  an array hole and an `undefined` member.

**Consumer note.** A valid tables document can be larger than what a consumer can hold as one
string. `JSON.parse(readFileSync(…, 'utf8'))` on the 951 MB output above failed in Node with
`ERR_STRING_TOO_LONG`. Consumers that must handle the largest inputs need a streaming parser, and
the completeness checks of §3.7 still apply. P0 does not add a size option or a summary-only JSON
mode.

---

## 6. Module layout

| Module | Role | Imports |
|---|---|---|
| `src/json/envelope.ts` | The types of §5.2 (types only, as today) | unchanged set |
| `src/json/serialize.ts` | Behaviour for `inspect`/`validate` unchanged. Additionally exports `sharedEnvelopeMembers()` (§5.5), used by both envelopes; `strictReplacer` stays exported so that §5.10 reuses it | unchanged |
| `src/json/stream.ts` (new) | `encodeJson(document: JsonTablesEnvelope): Iterable<string>`: lazy, bounded chunks, the scope and rejections of §5.10 | `serialize.ts` (`strictReplacer`), `envelope.ts` types |
| `src/json/index.ts` | barrel: also exports the new types and `encodeJson` | — |
| `src/view/tables.ts` (new) | `buildTablesEnvelope(input: IntegrationInput, integration: Integration, { path })`: the production document, plus the key-list constants of §5.3. `projectTables(schema: JsonSchema): JsonTablesResult` and `toTablesEnvelope(envelope: JsonEnvelope): JsonTablesEnvelope` stay as the comparison oracle. Pure, no I/O, no `node:` imports | `src/json/` types, constants and `sharedEnvelopeMembers()`; `src/validate/` (`Integration`/`IntegrationInput` types and the `isLoadedInput` guard); `src/schema/` and `src/model/` types only; `src/io/limits` types only |
| `src/view/index.ts` (new) | barrel | — |
| `src/text/escape.ts` (new) | the escape set, the whitespace set, `renderNamePieces(value: string \| null): Iterable<string>` and `renderedNameWidth(value: string \| null): number` (§4.4.1, §4.10), `escapeText(text: string): string` for fixed short text only (§4.8), and `quoteArg(arg: string): string` (§3.5) | none |
| `src/text/width.ts` (new) | `codePointWidth(cp: number): 0 \| 1 \| 2` and `displayWidth(text: string): number` with the table of §4.11 | none |
| `src/text/chunks.ts` (new) | the chunk buffer shared by both renderers and by the stderr writer: append pieces, yield at 65,536 code units, never split a surrogate pair | none |
| `src/text/tables.ts` (new) | `renderTablesText(envelope: JsonTablesEnvelope): Iterable<string>`: the two passes of §4.10, the layout of §4.3 and the streamed notes of §4.8 | `src/json/` types, `escape.ts`, `width.ts`, `chunks.ts` |
| `src/text/diagnostics.ts` (new) | `tablesDiagnosticLines(integration: Integration): Iterable<string>`: one `fatal`/`error` line per `next()`, the same bytes as `renderDiagnostics()` (§3.6) | `src/validate/` types only |
| `src/text/index.ts` (new) | barrel | — |
| `src/io/stdout.ts` (new) | `OutputStream` and `writeOutput(options): Promise<0 \| 1 \| 70 \| 74>`, the state machine of §7.2. It takes the streams as `OutputStream` parameters, so tests can pass fakes | `node:events`/`node:stream` types only |
| `src/tables-command.ts` (new) | `runTablesCommand({ path, format, stdout, stderr, pipeline })`: Phase A under the guard of §7.2 item 10, and Phase B as lazy generators handed to `writeOutput`; Phase B builds the document with `buildTablesEnvelope(input, integration, { path })`. `pipeline` defaults to the real stages and is the seam that R-20 uses | the above, plus the existing stages |
| `src/cli.ts` | the argv rules of §3.2, `quoteArg` in misuse messages, and dispatch of `tables` to `runTablesCommand`. `run()` and `renderDiagnostics()` for `inspect`/`validate` are unchanged | the above |

Dependencies go one way: `cli → tables-command → text, view, json, io/stdout`, `text → json` and
`validate` (types only) plus `text → view` for `NOTE_PREFIX`, `view → json` (types, constants and
the one shared function `sharedEnvelopeMembers()`), `validate` (types and the `isLoadedInput`
guard), `schema`/`model` (types only) and `io/limits` (types only). Neither `view` nor `text`
imports stage runtime that parses, decodes or decides (`decode`, `syntax`, `schema` and `semantic`
builders, `validate`'s `integrate()`), so they cannot parse or re-decide anything.
`src/json/stream.ts` sits in `src/json/` because it is the JSON contract's encoder.
`src/io/stdout.ts` sits in `src/io/` because it is a process I/O boundary. `src/tables-command.ts`
is separate from `cli.ts` so that tests can import it without running `main()`. Decision 8 places
new modules in `src/view/` and `src/text/` "where needed". These three files sit elsewhere for the
reasons just given, and the re-review is asked to confirm that (§9). No `package.json` dependency
is added.

---

## 7. D — Robustness

### 7.1 Measured baseline (before any change)

All measurements were taken once on Linux (Ubuntu, kernel 7.0, 8 CPUs, 30 GB RAM) with Node
`v24.22.3` (V8 heap limit 4,288 MiB, maximum string length 536,870,888 code units) and the baseline
`dist/cli.js`. Inputs were synthetic and lived in temp directories outside the repository. Node 26,
Windows and macOS were **not** measured locally: a local Node 26 install was incomplete, and no
Windows or macOS host was available.

**Write errors of today's `inspect`:**

| Scenario | Observed exit | Observed stderr |
|---|---|---|
| `inspect txt-01 \| true` (29,381-byte envelope, reader already gone) | `1` (5/5 runs) | Node's `Unhandled 'error' event`, `Error: write EPIPE`, stack trace with the install path (992 bytes) |
| `inspect <2,000-entity doc> \| head -c 1` (8,756,368-byte envelope) | `1` (3/3) | same, `write EPIPE` |
| `inspect txt-01 \| head -c 10` (fits the pipe buffer) | `0` | empty: the write finished before the reader closed |
| `inspect txt-01 > /dev/full` | `1` | `Unhandled 'error' event`, `ENOSPC: no space left on device, write` |
| `inspect txt-01 >&-` (stdout closed) | `0` | empty. The output is lost without any signal, and the process cannot see it |

**Large but accepted inputs:**

| Input (all accepted by the read limits) | Observation |
|---|---|
| Review reproduction: one 200,001-character `PName`, plus 3,999 entities with 5-character names (616,068 bytes) | `inspect`: exit `0`, 17,032,749-byte envelope, 0.69 s, peak RSS 232 MB. A prototype renderer that pads every row to the longest name and joins the output into one string failed with `RangeError: Invalid string length`: about 200,001 × 4,000 ≈ 800 million padding characters. That is the B1 defect, and §4.3 and §4.10 remove it |
| Escape expansion: one `PName` of 400,000 ESC characters (each renders as the 8-character `\u{001B}`), plus 3,999 short names (816,067 bytes) | `inspect`: exit `0`, 25,832,745-byte envelope, 0.74 s, peak RSS 259 MB |
| 1,999,000 unknown keys in one entity (20,878,001 bytes, 1,999,008 lines) | `inspect`: exit `1`, no stdout, `RangeError: Invalid string length` thrown from `JSON.stringify` in `toJsonString`, 23.5 s, peak RSS 3.0 GB. With the §5.10 chunking, a tables-like envelope wrote 951,520,194 bytes of valid JSON (13.8 s, peak RSS 2.75 GB, largest chunk 65,792 code units) |
| 200,000 `Field` lines in one entity (11,377,891 bytes) | `inspect`: exit `0`, 372,293,684-byte envelope (69 % of the maximum string length), 8.0 s, peak RSS 1.78 GB. A tables-like prototype that ran `serialize()`: heap 791 MiB after it, peak RSS 984 MB |
| 1,155,516 `Field` lines (67,108,851 bytes, just under `maxBytes`) | Pipeline through `integrate()`: heap 2,847 MiB (load 82, scan 594, classify 2,628, semantics 2,847). `serialize()` then exhausted the 4,288 MiB heap: `FATAL ERROR … heap out of memory`, exit `134` (SIGABRT), 28 s. That stage is `inspect`'s, and it was `tables`'s at this baseline. At this baseline the abort happened before any stdout chunk existed. For the current build, see the follow-up below — the 1,155,516-Field input was **not** re-run there |

**Follow-up on the current build (F4-B1b — not the baseline above).** `tables` no longer calls `serialize()` or `jsonSchema()` (§2). On the same machine and Node `v24.22.3`, Field-heavy 100k/300k synthetic inputs peaked at 432.9 → 301.9 MB (−30.3 %) and 1255.2 → 854.8 MB (−31.9 %) heap (median of 3 runs per arm; independent measurement on its own setup likewise met the ≥25 % bar, exact figures differ by setup). Normal-scale and unknown-heavy inputs showed no material regression. Streaming (§5.10) avoids building one huge output string at once; the envelope itself is still retained while it is encoded. The 1,155,516-Field input of the baseline row was **not** re-run on the current build, so this document claims no outcome for it: Phase A's classification and semantic records are still held whole, Phase B additionally retains rows, `unsupported`, `diagnostics` and the envelope while it streams output, and an out-of-memory abort (a signal, outside every exit code of §3.7) remains possible for inputs within the current read limits. Issue #27 stays open.

Findings:

- A broken pipe exits `1`, the code for "failed read", and prints a stack trace. That is the
  failure mode `tables` must not have. `inspect` and `validate` keep it, because they must not
  change (§3.10, §11 F-1).
- Whole-output strings fail on accepted inputs. That covers both the text padding defect and
  `JSON.stringify` of a large envelope. P0 bounds every output string (§4.10, §5.10).
- After that, both Phase A and Phase B allocate memory that grows with the input. Phase A — load,
  scan, classify, semantics — is shared by `inspect`, `validate` and `tables`, and P0 does not
  change that stage (§11 F-4). Phase B additionally retains the rows, `unsupported` evidence,
  `diagnostics` and the envelope while it streams the output. The old measurement completed Phase A
  and exhausted the heap in `serialize()`; the current build omits that complete schema projection
  but still holds both phases' data, so it can still exhaust the V8 heap for inputs within the read
  limits — the precise failure boundary has not been established. What plan B removed is only the
  extra `inspect` schema projection on top (§2 and the follow-up above).

A throwaway prototype of the §7.2 state machine, run against real pipes and against a controlled
fake, gave the results recorded under "Feasibility" in §7.3. In particular, `>&-` (stdout closed
before start) settled as **accepted** with exit `0` while no byte reached anyone. That is why exit
`0` is not treated as proof of delivery (§3.7).

### 7.2 Output writer policy (`tables` only)

```ts
/** Every stream member writeOutput uses, and nothing else (src/io/stdout.ts). */
export interface OutputStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  readonly errored: Error | null;   // Writable.errored
  readonly destroyed: boolean;      // Writable.destroyed: the "already closed" state
}

writeOutput(options: {
  stdoutChunks: () => Iterable<string>;   // lazy: Phase B of §2 runs inside next()
  stderrLines: () => Iterable<string>;    // tablesDiagnosticLines(integration), lazy
  stdout: OutputStream;                   // process.stdout in the CLI, a fake in tests
  stderr: OutputStream;
  readCode: 0 | 1;                        // integrate(input).exitPolicy.inspect
}): Promise<0 | 1 | 70 | 74>
```

`OutputStream` is a structural type, so `process.stdout`, `process.stderr`, a plain
`stream.Writable` and the test fake `ControlledWritable` (§7.3) all satisfy it without a cast.
*Verified:* with the repository's `tsc` 7.0.2 and `@types/node` 24.19.2 (the type definitions that
both CI Node versions, 24 and 26, compile against), all four assignments compile, and an object
without `errored` is rejected. The implementation keeps these assignments as compile-time checks
in `tests/io-stdout.test.ts` (§8.4), which `pnpm typecheck` compiles.

The stdout outcome is a small state machine. It starts in **writing** and moves to exactly one
terminal state, once. The first event that determines a terminal state wins. Every later event
(callback, `'error'`, `'close'`, `'drain'`) is ignored, and it never changes the outcome, the
stderr text or the exit code.

| Terminal state | Entered when (first of these, in arrival order) | stderr outcome line | Exit |
|---|---|---|---|
| **accepted** | The chunk iterator returned `done: true`, **and** every `write()` callback has been called without an error, while still in **writing** | none | read code |
| **closed** | An `EPIPE` arrives from a `write()` callback, an `'error'` event or a synchronous `write()` throw. Or a `'close'` arrives while `stdout.errored` is an `EPIPE` error | none | read code |
| **failed** (error) | Any other error arrives the same ways: from a callback, an `'error'` event, a synchronous throw, or a `'close'` while `stdout.errored` holds that error | `a5er: error: cannot write to stdout (<CODE>)` | `74` |
| **failed** (early close) | A `'close'` arrives while `stdout.errored` is `null`, **before** accepted: the iterator is not exhausted, or a callback is still outstanding | `a5er: error: stdout closed before the output was complete` | `74` |
| **generation-failed** | Creating the chunk iterator, or one of its `next()` calls, throws | `a5er: error: internal error while generating output; the output is incomplete` | `70` |

`<CODE>` is `error.code` when it is a string matching `[A-Z0-9_]+`, and `UNKNOWN` otherwise.
`stdout.errored` is the public `Writable.errored` property (Node 18 and later), read when `'close'`
arrives. It classifies a stream that was destroyed with an error, such as a generic `Writable` or a
test fake. It is **not** what classifies real errors on `process.stdout`. Measured on Linux with
Node v24.22.3, for both a pipe whose reader left (`EPIPE`) and `/dev/full` (`ENOSPC`), the events
arrive as: every pending write callback with the error, then one `'error'` event, then `'close'`,
and at `'close'` `process.stdout.errored` is still `null` (the `hadError` argument is
`undefined`). The real error is therefore always recorded from the callback before `'close'`
arrives, and the `'close'` is ignored. If a platform delivered `'close'` first, the writer would
report an early close (`74`) instead of **closed**. R-1 and R-1j would then fail with exit `74`,
which makes that platform difference visible instead of hiding it.

Rules:

1. **Before writing.** The CLI sets `process.exitCode = readCode`. `process.exit()` is never
   called: on POSIX, pipe writes are asynchronous (Node docs, "A note on process I/O"), and
   `process.exit()` could cut off output that is still queued. When `writeOutput` resolves, the CLI
   sets `process.exitCode` to its result.
2. **Listeners.** `'error'` and `'close'` listeners go on `stdout` and on `stderr` before the first
   write, and stay attached until the process exits. A late or repeated event is therefore never
   unhandled and never prints a stack trace.
3. **Pulling and writing.** While in **writing**: call `next()` (guarded). If it is done, go to the
   settle step. Otherwise, if `stdout.destroyed` is already `true`, handle it exactly like a
   `'close'` (classified by `stdout.errored`, else an early close) and do not write. Otherwise call
   `stdout.write(chunk, callback)`, guarded by `try`/`catch`. Each chunk is written once, in order,
   and there is never a write after a terminal state.
4. **Backpressure.** When `write()` returns `false`, the writer waits for the first of: `'drain'`,
   or any transition to a terminal state. The terminal-state signal is one promise, resolved by
   the transition itself. So a `'close'`, an `'error'` or an error callback releases a pending
   `'drain'` wait at once. The `'drain'` listener is removed after the wait.
5. **Settling.** After `done`, the writer waits for the first of: the last outstanding callback,
   or a terminal state. If the state is still **writing** and no callback is outstanding, the
   state becomes **accepted**. A `'close'` that arrives after **accepted** is ignored. Callbacks
   that arrive after any terminal state only decrement the counter and are otherwise ignored.
6. **Races.** Events are processed in the order Node delivers them. In practice the same failure
   can arrive two or three times: as a callback error, then as an `'error'` event, then as a
   `'close'`. Only the first one is recorded. Between an error and an early close, whichever
   arrives first decides. A `'close'` consults `stdout.errored`, so a stream destroyed with an error
   is classified by that error. On `process.stdout`, the error callbacks and the `'error'` event
   come before `'close'` (measured above). An `'error'` without
   a preceding callback (for example after `destroy(err)`) is handled the same way as a callback
   error.
7. **Then stderr**, in the fixed order of §3.6. First the lines of `stderrLines()`, always and
   whatever the stdout outcome. Then the outcome line of the table, if any. Then, if `stderrLines()`
   threw while being created or iterated, the line
   `a5er: error: internal error while generating diagnostics; the diagnostics are incomplete`.
   No outcome line ever contains an exception message, a stack trace, file text or a path: the
   exception object is caught and discarded.
8. **stderr writing** uses the same chunk buffer as stdout (append lines, write at 65,536 code
   units, so every chunk is under 262,144). stderr has one flag, **stopped**, and one promise that
   resolves when the flag is first set. The flag is set, once, by the first of: an `'error'` event,
   a `'close'` event, a `write()` callback called **with an error**, or a synchronous throw from
   `write()`. Setting it again does nothing, so a failure reported by a callback, then an
   `'error'` and then a `'close'` is processed once. For each chunk:
   - If **stopped** is set, or `stderr.destroyed` is `true`, or `stderr.errored` is not `null`,
     the chunk is not written. The flag is set, and all remaining stderr output (diagnostic lines,
     the outcome line and the generation-failure line) is dropped silently.
   - Otherwise the chunk goes to `stderr.write(chunk, callback)`, guarded by `try`/`catch`.
   - When `write()` returns `false`, the writer waits for the first of `'drain'` or the
     **stopped** promise. A callback error therefore releases the wait even when no event follows
     it. A *successful* callback does not release it: the writer still waits for `'drain'`. The
     `'drain'` listener is removed after the wait.
   - After a release, later callbacks and events only hit the idempotent flag. They change
     nothing.
   stderr failures never change the exit code, as before: there is nowhere left to report them.
   The exit code is decided by the stdout outcome and the generation failures alone (rule 9).
9. **Exit code.** **failed** gives `74`. Otherwise, **generation-failed**, or a throw from
   `stderrLines()`, gives `70`. Otherwise **accepted** and **closed** keep `readCode`. For
   **closed** nothing extra is printed: `a5er tables f | head -n 3` exits `0` for a readable file
   and `1` for a failed read, the same as without `head`.
10. **Phase A guard.** If load, scan, classification, semantics or `integrate()` throws (an
    internal defect, since a bad file is reported through diagnostics and never thrown), the CLI
    writes nothing to stdout. It writes only the generation-failure line of the table to stderr,
    with the rule 8 behaviour, and exits `70`, also when that stderr write fails. A V8 heap exhaustion is not an exception and cannot
    be caught (§3.7, F-4).
11. **Same rules for every chunk and both formats.** Text and JSON go through the same writer. A
    chunk is just the unit of `write()`, and none of the rules depend on how many chunks there are.

**Partial output.** After **closed**, **failed** or **generation-failed**, stdout may hold any
prefix of the complete output, or nothing. The prefix can end inside a row, inside a JSON token,
or even inside a UTF-8 sequence the OS accepted only in part. The writer never adds a completion
marker and never writes to stdout after a terminal state. A prefix must not be mistaken for a
complete output: a JSON prefix that lacks only its final `\n` still parses. The consumer checks of
§3.7 exist for this reason, and exit `70` or `74` always means "discard stdout". **accepted** means
"accepted by Node", not "delivered" (§3.7).

Only an `EPIPE` counts as "reader closed". A `'close'` without an error before the output is
complete is a failure (`74`), not a closed pipe, because nothing tells the writer that the reader
wanted it. If a platform reports a closed pipe with a different code, the real-pipe tests of §7.3
fail on that platform. The fix is then a reviewed change to this list, never a wider catch-all.

`inspect` and `validate` keep their current single synchronous `write()` path and their
`renderDiagnostics()` stderr, and are not routed through `writeOutput` (§3.10, F-1).

### 7.3 Write-error tests

**State-transition tests (`tests/io-stdout.test.ts`, all platforms).** They use a controlled fake,
`ControlledWritable` (in the test file, extending `EventEmitter`). Each `write(chunk, cb)` call
records the chunk and returns a value the test chose in advance (`true`, `false`, or "throw an
error with code X"). Each callback is held until the test calls `complete(i, error?)`. The test
also decides when to emit `'error'`, `'drain'` and `'close'`, and what `errored` and `destroyed`
hold. The same class is used for stdout and stderr, and it implements `OutputStream` (§7.2). A
test detects a hang without a timer: it records when the `writeOutput` promise resolves, lets the
reactions run, and then asserts that the promise has resolved. `stdoutChunks`
and `stderrLines` are explicit arrays wrapped in generators, which can be told to throw at a given
step. Between steps the test lets pending promise reactions run with
`await new Promise((resolve) => setImmediate(resolve))`. There is no `setTimeout`, no wall-clock
delay and no fake timer, so every event order is chosen by the test, and the expectations are
exact. `D` below stands for the one diagnostic line
`a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)\n`.
Unless stated otherwise, the input is two stdout chunks `A` and `B`, the stderr lines are `[D]`,
`readCode` is `0`, and every `write()` returns `true`.

| ID | Event order (test-controlled) | Final state | Exit | stderr (exact) | stdout writes |
|---|---|---|---|---|---|
| R-18 | complete(0); complete(1). Run again with `readCode` 1 | accepted | `0` / `1` | `D` | `A`, `B` |
| R-3 | complete(0, `EIO`). Repeat with `ENOSPC`, `EBADF`, and an error with no `code` | failed | `74` | `D` + `cannot write to stdout (EIO)` (`ENOSPC`, `EBADF`, `UNKNOWN`) | `A`, `B` |
| R-3e | (a) complete(0, `EPIPE`); (b) `write` returns `false`, then set `errored = EPIPE`, emit `'error'`, emit `'close'`; (c) `write` returns `false`, then set `errored = EPIPE` and emit `'close'` with no `'error'` | closed | `0` | `D` | (a) `A`, `B`; (b), (c) `A` only |
| R-5 | **Delayed error**: complete(0); the iterator is exhausted; then complete(1, `EIO`) | failed | `74` | `D` + `cannot write to stdout (EIO)` | `A`, `B` |
| R-6 | **Diagnostics coexist**: explicit chunks `A`, `B`, lines `[D]`; complete(0); complete(1, `EIO`) | failed | `74` | exactly `D` then `a5er: error: cannot write to stdout (EIO)\n` | `A`, `B` |
| R-8 | **Double notification**, order 1: complete(0, e₁ = `EIO`); emit `'error'` e₁; emit `'error'` e₂ = `ENOSPC`; emit `'close'`. Order 2: emit `'error'` e₁ first, then complete(0, e₁) | failed | `74` | `D` + exactly one `cannot write to stdout (EIO)` | `A`, `B` |
| R-9 | **Synchronous throw**: the first `write` throws an error with code `ERR_STREAM_DESTROYED` | failed | `74` | `D` + `cannot write to stdout (ERR_STREAM_DESTROYED)` | `A` attempted, `B` never |
| R-10 | **Backpressure**: the first `write` returns `false`. After the reactions run, exactly 1 write has been made. complete(0); emit `'drain'`; complete(1) | accepted | `0` | `D` | `A`, then `B` only after `'drain'` |
| R-12 | **Early close while waiting for drain**: the first `write` returns `false`; complete(0); emit `'close'` with `errored = null` | failed (early close) | `74` | `D` + `stdout closed before the output was complete` | `A` only; the `'drain'` wait is released |
| R-13 | **Early close with a callback outstanding**: the iterator is exhausted, complete(0) but not (1); emit `'close'` with `errored = null`; then complete(1) | failed (early close) | `74` | `D` + `stdout closed before the output was complete` | `A`, `B`; the late callback is ignored |
| R-14 | **Events after a terminal state**: R-18, then emit `'error'` `EIO`, then `'close'` | accepted | `0` | `D` | `A`, `B`; no unhandled `'error'` |
| R-15 | **Generation failure in `next()`**: the generator yields `A` and then throws `new Error('/secret/path: file text')` | generation-failed | `70` | `D` + `internal error while generating output; the output is incomplete` | `A` only; the message text appears nowhere |
| R-16 | **Generation failure at creation**: `stdoutChunks()` throws | generation-failed | `70` | `D` + the same internal-error line | none |
| R-17 | **stderr source throws** after yielding `D`; stdout as R-18 | accepted | `70` | `D` + `internal error while generating diagnostics; the diagnostics are incomplete` | `A`, `B` |
| R-3s | stdout as R-18. stderr's first `write` emits `'error'` `EPIPE` (and separately `EIO`). Run with `readCode` 1 | accepted | `1` | the first stderr write is attempted, and nothing after it | `A`, `B` |
| R-7 | **Both fail**: complete(0, `EIO`) on stdout, and stderr's first `write` emits `'error'` `EIO` | failed | `74` | one stderr write attempted, then silence; no throw | `A`, `B` |
| R-19 | **stderr backpressure**: 100,000 diagnostic lines; the first stderr `write` returns `false`. The test completes that callback **successfully**, lets the reactions run and asserts that still only 1 stderr write was made; then it emits `'drain'`, and on the next `false` emits `'close'` | accepted | `0` | every stderr chunk is under 262,144 code units, a successful callback alone does not release the wait, no write happens after `'close'`, and the writer resolves (no hang) | `A`, `B` |
| R-20 | **Phase A guard**: the CLI's `integrate` step throws (injected through the `pipeline` parameter of `runTablesCommand`, §6) | — | `70` | exactly the internal-error line | none |
| R-21 | **Case A: stderr callback-only failure.** stdout as R-18. stderr's first `write` returns `false`; the test calls its callback with an error coded `ERR_STREAM_DESTROYED` and emits no `'drain'`, `'error'` or `'close'`. Run with `readCode` 0 and 1. Variant (b): after the writer has resolved, the test emits stderr `'error'` `EPIPE` and `'close'` | accepted | `0` / `1` | exactly 1 stderr write (the first chunk); nothing after it; the promise resolves. (b): no throw, no unhandled `'error'`, the result unchanged | `A`, `B` |
| R-20b | **Case B: Phase A failure, stderr fails too.** As R-20, with stderr's first `write` returning `false` and its callback failing as in R-21 | — | `70` | 1 stderr write (the internal-error line) attempted; the promise resolves | none |
| R-7b | **Case C: stdout failure keeps precedence.** stdout: complete(0, `EIO`). stderr: as R-21 | failed | `74` | 1 stderr write attempted; the promise resolves | `A`, `B` |
| R-22 | **Case D: combined failures.** stdout: complete(0, `EIO`). `stderrLines()` yields `D` and then throws | failed | `74` (not `70`) | `D` + `cannot write to stdout (EIO)` + `internal error while generating diagnostics; the diagnostics are incomplete` | `A`, `B` |
| R-23 | **Case E: stderr already closed.** Before the first stderr write the fake has `destroyed = true`. Variant (b): `destroyed = false` and `errored` already holds an `EPIPE` error. stdout as R-18, `readCode` 1 | accepted | `1` | **no** stderr write is attempted | `A`, `B` |

**Real-pipe smoke tests (`tests/cli-tables-io.test.ts`).** These spawn `node dist/cli.js` with
`stdio: ['ignore', 'pipe', 'pipe']` and check only what a real pipe can promise. They never assume
that `EPIPE` is observed: depending on timing and the platform, the child may finish writing into
the pipe buffer before the reader goes away. `<big>` is a generated synthetic document of 4,000
entities, each with a 200-character CJK `LName` (about 600 UTF-8 bytes per row). The test first
measures that its full text output is over 1 MiB, by running it to a file.

| ID | Input and event order | Platforms | Expectation |
|---|---|---|---|
| R-1 | `tables <big>`: read the first `data` chunk, then `child.stdout.destroy()` | Ubuntu, Windows (CI); macOS manual | exit `0`, not killed by a signal; stderr is exactly `''` (`<big>` has no `fatal`/`error` diagnostic); received bytes > 0 and ≤ the full length |
| R-1j | R-1 with `--format json` | same | same |
| R-2 | `tables <big>`: destroy stdout right after `spawn`, before any data | same | exit `0`, stderr `''`, received bytes `0` |
| R-2f | R-2 on an empty file | same | exit `1`, stderr is exactly the `E_EMPTY_INPUT` fatal line |
| R-4 | `tables txt-01 > /dev/full` | Linux only (`it.runIf(process.platform === 'linux')`), reported as a platform skip elsewhere | exit `74`, stderr exactly `a5er: error: cannot write to stdout (ENOSPC)\n` |
| R-11 | Read stdout to EOF. Inputs: txt-01 (text and JSON) and `<big>` (text and JSON) | Ubuntu, Windows (CI) | exit `0`, and the received bytes equal the expected bytes exactly. txt-01 text: the hand-authored expectation of §8.3. txt-01 JSON: the §8.4 expected envelope (golden-derived shared members plus the hand-authored `result`), built as `JSON.stringify(expected) + '\n'`. `<big>` JSON: the B-5 reference, `JSON.stringify(toTablesEnvelope(serialize(…)), strictReplacer) + '\n'`, computed in the test process from the same staged file. `<big>` text: equal to the same command's output redirected to a file, and every row's decoded names equal the generated names, in order |
| R-C | **Observation of today's `inspect`** (not an acceptance condition): R-1 run against `inspect` | same | Records the exit code, and whether stderr contains `EPIPE`. On Linux with Node v24.22.3 it exits `1` with an `EPIPE` stack trace (§7.1), but other platforms may not reproduce it. The test reports what it observed and does not fail on a difference. It does not pin the crash as required behaviour |

The `tables` write paths are proven by R-3 to R-23, R-7b and R-20b (deterministic) and R-1, R-1j, R-2, R-2f, R-4
and R-11 (real pipes). All of these stay mandatory. Real-pipe tests time out at 20 s, like
`runCli`, and clean up their temp directories in `finally`. The generated documents are written to
a `mkdtemp` directory and removed afterwards. They are never committed (§3.1 of
`test-strategy.md`).

**Feasibility.** A throwaway prototype of this writer and of `ControlledWritable` (outside the
repository, about 60 lines) ran the event orders of R-3 to R-19 and of Cases A to E (R-21, R-20b, R-7b, R-22, R-23; for
R-20b a flag stood in for the CLI seam, which R-20 needs) and gave exactly the states, exit codes and stderr lines in the table above. Against real
pipes on Linux with Node v24.22.3: `| head -c 100000` gave **closed**, exit `0`, exactly 100,000
bytes received. `| true` gave **closed**, exit `0`. `> /dev/full` gave **failed**, exit `74`,
with `ENOSPC` after the diagnostic line. `>&-` gave **accepted**, exit `0`, with no bytes delivered
(§3.7). A full read gave **accepted** with the same SHA-256 as the reference output.

### 7.4 Terminal-control neutralisation tests

| ID | Test |
|---|---|
| S-1 | Pure renderer test (no CLI): for every code point in each range of §4.4.2, the range ends and the code points just outside them, `renderNamePieces` gives `\u{XXXX}` for the inside and the raw character for the outside. This includes U+0000, U+000A (LF), U+000D (CR), U+001B, U+007F, U+0085, U+009B, U+009F, U+00A0 (not escaped, but quoted), U+202E, U+2066–U+2069, U+FEFF, U+FFFE, U+10FFFF, U+E0001, and a lone U+D800 and U+DC00 |
| S-2 | Pure renderer test: for all 1,114,112 code points (as one-code-point strings, lone surrogates included), the output contains no escape-set code point, and decoding the output gives the input back (round trip). The cases include CR, LF and CRLF inside a longer string. CR and LF cannot reach a name through the current scanner (S-4), so their escaping and round trip are proven here |
| S-3 | Ambiguity: `null → -`, `'' → ""`, `'-' → "-"`, `'a"b' → "a\"b"`, `'a\\b' → "a\\b"`, `'a b' → "a b"`, `'顧客　一覧' → "顧客　一覧"` |
| S-4 | Real CLI. The current scanner ends a line at CR, LF or CRLF (`src/syntax/lines.ts`), so a literal CR or LF in a generated `PName` would split the key line. S-4 does not require a parser change and does not use them. Instead the generated document puts, inside one `PName`/`LName` line, only controls that the current parser keeps in the value: ESC-based CSI (`<ESC>[2J`), OSC 8 (`<ESC>]8;;x<ESC>\`), BEL, TAB, DEL, one NUL (below the 10 % binary threshold), U+0085, U+009B, U+2028, U+2029, U+202E, U+2066, U+2069, U+200D, U+FEFF and the tag sequence U+E0001 U+E0041. (A local check with the baseline `inspect` showed all of them in `pname.value`, `status: ok`.) Assertions: the text stdout contains no byte `0x00`, `0x07`, `0x09` or `0x1B`, and no UTF-8 encoding of U+007F, U+0085, U+009B, U+2028, U+2029, U+202E, U+2066, U+2069, U+200D, U+FEFF or U+E0000–U+E007F. In the tables JSON, `pname`/`lname` equal `pname.value`/`lname.value` of `a5er inspect` on the same staged file. The test compares against the interpreted value, not against the string the generator wrote |
| S-5 | Every output line of S-4 matches `^(# .*\|SECTION .*\|[ 0-9].*)$`. No line ends in whitespace, and no line holds `\r` or `\t` |
| S-6 | `quoteArg`: printable ASCII arguments give exactly `JSON.stringify(arg)`. `"--bad\ncontrol"` keeps today's text. U+007F, U+009B, U+202E, U+2066, U+FEFF and U+E0041 give `\u007f`, `\u009b`, `\u202e`, `\u2066`, `\ufeff` and `\udb40\udc41`. The result always parses back (`JSON.parse`) to the argument. A real CLI misuse run with such an argument has none of those code points raw on stderr |

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
- The writer's state machine is checked on both versions by the deterministic R-3 to R-23 (with R-7b and R-20b), and the
  real `process.stdout` behaviour by R-1, R-1j, R-2, R-2f, R-4 and R-11 in CI. Neither is assumed.
  `Writable.errored`, which §7.2 reads on `'close'`, exists in both versions.

### 7.7 Line width, long identifiers and bounded output

| ID | Test |
|---|---|
| W-1 | `displayWidth` table test: one sample inside each range and at each range end, a sample outside, U+3099 = 0, U+FF61 = 1, U+3000 = 2, U+1F600 = 2 |
| W-2 | A 10,000-character ASCII `PName` and a 2,000-character CJK `LName` appear in full in the row, and the row length equals the computed sum. Nothing is truncated or wrapped |
| W-3 | Alignment: in every row whose rendered `PNAME` is at most 48 cells wide, the text before `LNAME` has the same display width, with mixed ASCII, CJK and escaped names (hand-computed expected strings) |
| W-4 | Cap boundary: rendered `PNAME` widths of 47, 48 and 49 cells. 47 and 48 are aligned, and with the 48-cell name present `W = 48`. 49 is followed by exactly two spaces and `LNAME`, and does not change `W` |
| B-1 | **Review reproduction**: one entity with a 200,001-character `PName` and 3,999 entities with 5-character names, generated. Real CLI, text: exit `0`. The long row holds the whole name, then exactly two spaces, then `LNAME`. Every other row is aligned at `W = 5`. The stdout size is below 1 MiB (the input is 616,068 bytes). The run finishes inside the 20 s timeout. JSON: `pname` of that row equals inspect's `pname.value` |
| B-2 | **Escape expansion**: one `PName` of 400,000 ESC characters, plus 3,999 short names, generated. Text: the row holds `"` + 400,000 × `\u{001B}` + `"` (3,200,002 code units), and decoding it gives the value back. JSON: `pname` equals inspect's `pname.value` |
| B-3 | **Chunk bound**, as a unit test with a spy sink on in-memory envelopes (B-1, B-2, N-1 to N-3, and 200,000 unknown keys): every chunk from `renderTablesText`, from `encodeJson` and from the stderr writer is under 262,144 code units. No chunk ends with a high surrogate, and no chunk starts with a low surrogate that belongs to a pair |
| B-4 | **Surrogate boundaries**: names and raw values with astral code points placed at code units 16,383, 16,384 and 65,535 of a string. Text and JSON outputs decode to the original values, with no U+FFFD |
| B-5 | **JSON equivalence**: `[...encodeJson(d)].join('')` equals `JSON.stringify(d, strictReplacer) + '\n'` for every fixture and every generated document of §8.6 and B-1 to B-4 |
| B-6 | **Beyond the string limit** (manual measurement, not CI, recorded in the implementation PR): the 1,999,000-unknown-key document of §7.1 through `tables --format json`. Expected: exit `0`, more than 536,870,888 bytes of stdout, and a streaming JSON parse succeeds. It is manual because it needs about 3 GB of RAM and tens of seconds per run. CI covers the same code paths at bounded size (B-3, B-5) |
| N-1 | **Many identical diagnostics in notes**: one entity with 30,000 unknown keys (`Unknown0=1` … `Unknown29999=1`), generated. Real CLI, text: exit `0`. The `#   info S_UNKNOWN_KEY: …` line lists exactly 30,000 `line <n>` locations, in the order of the key lines (the test computes the expected numbers from the document it wrote), and the unsupported note says `unknown-key 30000`. In the unit part, every chunk from `renderTablesText` is under 262,144 code units, and the group line (about 349,000 characters) is split across chunks. JSON: `unsupported` holds 30,000 `unknown-key` records and `diagnostics` 30,000 `S_UNKNOWN_KEY` records, and B-5 equivalence holds. Locally, this input made `inspect` take 0.38 s with a 14,333,347-byte envelope |
| N-2 | **Many stderr lines**: 30,000 entities without `PName`, generated, so each raises the `error` `V_MISSING_REQUIRED_KEY`. Real CLI: tables stderr equals `inspect`'s stderr for the same staged file byte for byte (30,000 lines, 2,786,302 bytes measured locally), exit `0`, and the text group line lists 30,000 locations. In the unit part, with a spy stderr, every stderr chunk is under 262,144 code units and the concatenation equals `tablesDiagnosticLines()` joined. Timeout 60 s (`inspect` took 4.6 s locally) |
| N-3 | **Long section lists**: 30,000 views, generated. The `# unknown: a view does not store its columns (sections …)` note lists 30,000 section numbers in file order, and its chunks obey the bound. Timeout 60 s |

### 7.8 Original file immutability and confidentiality

- `tables` uses the existing read-only loader. A new test file,
  `tests/cli-tables-immutability.test.ts`, runs `tables` (text) and `tables --format json` over
  every staged synthetic fixture. Each run must leave sha256, size and mtime unchanged. The
  existing `tests/immutability.test.ts` is **not** modified.
- `tables` writes no file, temp file or cache, and makes no network call. A test runs it with the
  working directory set to an empty temp directory and checks that the directory is still empty.
- All tests use staged copies (`tests/helpers/stage.ts`) or generated documents in `mkdtemp`
  directories, never the committed files and never a real diagram.
- Tests do not print the output when they pass. A failure message shows the first differing line
  only for synthetic data.
- Text output prints names because the listing is the answer. It never prints `Comment`, `Query`,
  `details`, raw lines or the path. JSON keeps them where the shared members do (§5.7).

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

- **Exact key sets, real CLI, both arms.** On the JSON stdout of `a5er tables --format json` for an
  `ok` fixture (txt-01), a `degraded` one (sem-08) and a `failed` one (an empty file and enc-04),
  `Object.keys` at every level equals the lists of §5.3 in order: envelope, `result`, every row,
  every row `span`, every `columns`, `omitted` and `omitted.subtypes`. There is no `schema` key at
  any level. For `failed`, `source`, `result` and `completeness` are `null`. For `ok`/`degraded`
  they are non-null objects. This is the runtime proof that the forbidden keys are absent, which
  the type tests below cannot give.
- **Inspect has no `result`.** On `a5er inspect` and `a5er validate` stdout for the same fixtures,
  `Object.keys` equals `ENVELOPE_KEYS`, with no `result` key (the existing CLI test, plus this
  explicit absence check).
- **Status narrowing at runtime**: `toTablesEnvelope` throws on hand-built inspect envelopes that
  break the status and null correlation (`failed` with a source; `ok` with a `null` schema).
- **Shared members.** For every synthetic and byte fixture, the tables JSON without `command` and
  `result` deep-equals the inspect JSON without `command` and `schema`. For each shared member,
  the `JSON.stringify` bytes are equal too (§5.5).
- **Result.** `result` equals the hand-authored expectation of §8.1, and §5.4 holds against the
  inspect golden of the same fixture. The expected txt-01 envelope used by R-11 is built from these
  two parts.
- **Encoder (unit, `tests/json-stream.test.ts`).** Each case compares
  `[...encodeJson(d)].join('')` with `JSON.stringify(d, strictReplacer) + '\n'`, and checks every
  chunk bound:
  - key order: `{ b, 2, 1, '01', '4294967295', a }` encodes in `Object.keys` order
    (`1, 2, b, 01, 4294967295, a`);
  - key escaping: keys containing `"`, `\`, LF, U+0001, a lone U+D800 and a lone U+DC00; a
    40,001-code-unit key (a generalized case no product input reaches; its temporary
    `strictReplacer` string is expected, and only the output chunks are bound-checked, §5.10);
  - string slicing: a surrogate pair straddling code unit 16,384; a lone high surrogate at code
    unit 16,383 followed by ASCII; a lone high surrogate as the last code unit; a lone low surrogate
    at 16,384; a pair at 65,535 (the chunk boundary);
  - numbers `0`, `-0`, `1.5`, `1e21`;
  - rejection with `TypeError`: an accessor property, an own and an inherited `toJSON`, `Date`,
    `Map`, a boxed `Number`, a class instance, an array hole, and `undefined`, a function, a symbol,
    a `bigint`, `NaN` and `Infinity` as values;
  - B-5 equivalence on every fixture and generated document.
- **Framing.** stdout is one line plus `\n`, and `JSON.parse` of the whole stream succeeds (the
  fixtures are far below the string limit).

**Type-level tests (`tests/types/tables-envelope.types.ts`).** This file is compiled by
`pnpm typecheck`, which uses `tsconfig.typecheck.json` and includes `tests/**/*.ts`. It is not a
Vitest file (Vitest runs only `tests/**/*.test.ts`), so it needs no runtime. It relies on the
repository's real settings: TypeScript 7.0.2, `strict`, and `exactOptionalPropertyTypes: true`.

Reading a forbidden key is allowed by TypeScript: `read.schema` has type `undefined`. A read is
therefore never marked with `@ts-expect-error`, which would itself fail as unused. The tests
assert **assignments** instead:

```ts
import type {
  JsonCommand, JsonCompleteness, JsonEnvelope, JsonSource,
  JsonSchemaDocument, JsonTablesEnvelope, JsonTablesEnvelopeFailed, JsonTablesEnvelopeRead,
} from '../../src/json/envelope.js';

declare const failed: JsonTablesEnvelopeFailed;
declare const read: JsonTablesEnvelopeRead;
declare const inspect: JsonEnvelope;
declare const source: JsonSource;
declare const completeness: JsonCompleteness;

// Reading a forbidden key compiles and has type undefined: no @ts-expect-error on reads.
export const readSchema: undefined = read.schema;
export const readResult: undefined = (inspect as JsonSchemaDocument).result;

// A variable that carries a forbidden key is not assignable.
const withSchema = { ...read, schema: inspect.schema };
// @ts-expect-error schema is forbidden on a tables envelope
export const t1: JsonTablesEnvelope = withSchema;
const withResult = { ...inspect, result: read.result };
// @ts-expect-error result is forbidden on an inspect/validate document
export const t2: JsonSchemaDocument = withResult;
// Even schema: undefined is rejected. This line depends on exactOptionalPropertyTypes.
const withUndefinedSchema = { ...read, schema: undefined };
// @ts-expect-error a present schema key is rejected
export const t3: JsonTablesEnvelope = withUndefinedSchema;

// Null rules: failed needs null source/result/completeness; ok/degraded needs all three.
const failedWithSource = { ...failed, source };
// @ts-expect-error failed must have source: null
export const t4: JsonTablesEnvelope = failedWithSource;
const readWithNullResult = { ...read, result: null };
// @ts-expect-error ok/degraded must have a result
export const t5: JsonTablesEnvelope = readWithNullResult;
const failedWithCompleteness = { ...failed, completeness };
// @ts-expect-error failed must have completeness: null
export const t6: JsonTablesEnvelope = failedWithCompleteness;

// Positive controls: the same shapes without the defect compile.
export const ok1: JsonTablesEnvelope = { ...failed };
export const ok2: JsonTablesEnvelope = { ...read };
export const ok3: JsonSchemaDocument = inspect;

// Narrowing by status.
declare const any: JsonTablesEnvelope;
if (any.status === 'failed') {
  const s: null = any.source;
  void s;
} else {
  const s: JsonSource = any.source;
  void s;
}
```

The variables are exported, so `oxlint` sees no unused binding. Each `@ts-expect-error` line has a
positive control without the defect (`ok1`, `ok2`, `ok3`), so a line cannot pass because of an
unrelated error. `JsonCommand` is checked to be exactly `'inspect' | 'validate'` (K-1):

```ts
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const k1: Exact<JsonCommand, 'inspect' | 'validate'> = true;
// @ts-expect-error JsonCommand does not include 'tables'
export const k2: Exact<JsonCommand, 'inspect' | 'validate' | 'tables'> = true;
```

*Verified:* this file, with the §5.2 declarations inlined and the real `JsonEnvelope`,
`JsonSource` and `JsonCompleteness` imported from `src/json/envelope.ts`, was compiled outside the
repository with the repository's `tsc` 7.0.2 and a `tsconfig` extending the repository's. The `Exact` checks were included. It
passed with exit `0`. With the six `@ts-expect-error` comments removed, `tsc` reported exactly those
six lines: `schema` and `result` "not assignable to type 'never'", `undefined` "not assignable to
type 'never'", and the three null-rule mismatches.

### 8.5 Full regression for `inspect` and `validate`

- All existing test files pass unchanged, except the edits in §9 T-1. That covers the 44 goldens,
  `cli.test.ts`, `validate-integration`, the immutability tests, the fuzz floor and the guards. No
  assertion is weakened, and no skip is added.
- **New byte-identity test** (`tests/cli-byte-regression.test.ts`). For every staged synthetic and
  byte fixture (44), for both `inspect` and `validate` (88 runs):
  - **Expected stdout** is built from the committed golden without the product serializer. The
    goldens are pretty-printed, while the CLI prints one compact line. So the test parses the
    golden (`JSON.parse`), sets `tool.version` to the manifest version
    (`tests/helpers/package-version.ts`, so no version is hard-coded), sets `command` to the
    command under test (every golden is the `inspect` envelope), and sets `source.path` to the
    staged path when `source` is not `null` (the only scrubbed member, `<tmp>/<id>.a5er`). It then
    builds `Buffer.from(JSON.stringify(e) + '\n', 'utf8')`. `JSON.stringify` here is the language
    built-in on the parsed golden, not `toJsonString`/`serialize`.
  - **Expected stderr and exit code** come from a new, hand-authored table in
    `tests/helpers/cli-expectations.ts`. Each fixture has the exact stderr lines and the exit code
    for `inspect` and for `validate`, derived from the fixture's diagnostics as recorded in the
    registry and the golden, and from the exit rules of `architecture.md` §12. The `inspect` exit
    code is also checked against the registry's `exitCode`.
  - **Capture** with `execFile(…, { encoding: 'buffer' })`, so stdout and stderr are compared as
    raw UTF-8 bytes (`Buffer.compare`), not as decoded strings.
  - Goldens are read through the path helpers the golden tests already use, not with a literal
    `readFileSync('tests/fixtures…')`, so the fixture access guard (`fixtures.test.ts`) still
    holds. Synthetic fixtures are staged with `stage()`, and byte fixtures are written from their
    modules into a temp directory.
  - Implementation output is never copied into an expectation.
- **Feasibility, measured.** A throwaway script built the expected bytes from the 44 goldens with
  exactly this procedure and compared them with the baseline CLI: 88 of 88 byte-identical,
  including the CRLF fixture fmt-01 and the five byte fixtures. The json-goldens test compares
  `diagnostics` as a multiset, while this test pins their order byte for byte. Today the orders
  agree. If they ever disagree, that is a finding to investigate, never a golden to edit.
- The argv variants `--format json` before, between and after the operands, and repeated
  `--format json`, give the same bytes as today.
- **tables stderr matches inspect stderr.** For every staged fixture, and for N-2, the stderr bytes
  of `tables` (text and JSON) equal those of `inspect` on the same file. This is how the lazy
  `tablesDiagnosticLines()` (§3.6) is tied to the unchanged `renderDiagnostics()` without editing it.

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
- The byte regression of §8.5 reads the goldens and never writes them. Its compact expected bytes
  are built in memory for each run and are not stored.

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
3. K-1 to K-5 hold (§5.9), and revisions D-1 to D-7 (§9) have been agreed.
4. §8.5 passes: 88/88 byte-identical, the goldens are untouched, and `git diff` shows no change
   under `tests/fixtures/`.
5. §5.4 invariants 7 and 8, the key-set tests of §8.4 (success and failure), and the type-level
   file compile as specified.
6. The deterministic writer tests R-3 to R-23, R-7b and R-20b pass with the exact states, exit codes and stderr of
   §7.3. The real-pipe tests R-1, R-1j, R-2, R-2f, R-11, and R-4 on Linux, pass.
7. B-1 to B-5 and N-1 to N-3 pass, and so do the encoder cases of §8.4. R-C's observations and
   B-6's manual measurement are reported as measured, including platform differences.
8. No new entry in `package.json` `dependencies` or `devDependencies`, and `pnpm-lock.yaml` is
   unchanged.
9. Every file change matches the inventory in §9. A change to a file not listed there needs its
   own agreement.
10. F-4 ([issue #27](https://github.com/j1nn0/a5er-cli/issues/27)) is not an acceptance condition
    of the implementation PR. A release that ships `tables` needs the P1 measurement and decision
    recorded there (§11).
11. Independent review records an explicit PASS. The implementer does not self-certify.

---

## 9. Changes the implementation PR would make to existing files

Each change to an existing file needs agreement before it is made, because AGENTS.md protects
these documents and tests. New files are listed as well, so that the inventory is complete.

**Existing source files:**

| ID | File | Change |
|---|---|---|
| S-1 | `src/cli.ts` | The argv rules of §3.2, `quoteArg` for every quoted token in misuse messages (§3.5), the help and usage text (§3.4), and dispatch of `tables` to `runTablesCommand` (§6). `run()` for `inspect`/`validate`, `renderDiagnostics()` and their write calls are unchanged |
| S-2 | `src/json/envelope.ts` | The types of §5.2, added. The module header comment's version rule follows D-1. No existing declaration changes |
| S-3 | `src/json/serialize.ts` | `strictReplacer` gets `export`. No behaviour change |
| S-4 | `src/json/index.ts` | Re-exports the new types and `encodeJson` |
| S-5 | `scripts/lib/version.mjs` | Comment wording only, following D-1. No value or check changes |

**New source files:** `src/json/stream.ts`, `src/view/tables.ts`, `src/view/index.ts`,
`src/text/escape.ts`, `src/text/width.ts`, `src/text/chunks.ts`, `src/text/tables.ts`,
`src/text/diagnostics.ts`, `src/text/index.ts`, `src/io/stdout.ts`, `src/tables-command.ts`.
`src/io/index.ts` is unchanged: `src/tables-command.ts` imports `src/io/stdout.ts` directly. Three
of these sit outside `src/view/` and `src/text/` (decision 8): `src/json/stream.ts`,
`src/io/stdout.ts` and `src/tables-command.ts`. §6 gives the reasons, and the re-review is asked to
accept or relocate them.

**Existing tests:**

| ID | File | Change |
|---|---|---|
| T-1 | `tests/cli.test.ts` | `names only the commands that exist`: the help now names `tables`, so the absent list becomes `['columns', 'relations', 'search', 'export']`, and a positive check for `tables` is added. `rejects a command this build does not implement` changes its example from `tables` to `columns`. The help assertions gain `--format text\|json`. These are the only edits to existing tests, and none removes or weakens an assertion |

Not modified: `tests/immutability.test.ts`, `tests/json-goldens.test.ts`,
`tests/json-golden-guards.test.ts`, `tests/json-contract.test.ts`, `tests/fixtures*.test.ts`,
every file under `tests/helpers/` and `tests/fixtures/`, and the 44 goldens.

**New tests and helpers:** `tests/view-tables.test.ts` (§8.2), `tests/cli-tables-text.test.ts`
(§8.3), `tests/json-tables-contract.test.ts` (§8.4), `tests/cli-byte-regression.test.ts` (§8.5),
`tests/cli-tables-cases.test.ts` (§8.6), `tests/cli-argv.test.ts` (§3.2 and §3.5 rules and S-6),
`tests/text-escape.test.ts` (S-1 to S-3), `tests/text-width.test.ts` (W-1), `tests/text-render.test.ts`
(W-2 to W-4, B-1 to B-4 unit parts, N-1 and N-3 unit parts), `tests/json-stream.test.ts` (B-3, B-5,
the encoder cases of §8.4), `tests/text-diagnostics.test.ts` (the stderr line source of §3.6),
`tests/io-stdout.test.ts` (R-3 to R-19, R-7b, R-21 to R-23, and the `OutputStream` assignment checks of §7.2), `tests/tables-command.test.ts` (R-20, R-20b),
`tests/cli-tables-io.test.ts` (R-1, R-1j, R-2, R-2f, R-C, R-4, R-11, B-1, B-2, N-1 to N-3, S-4,
S-5), `tests/cli-tables-immutability.test.ts` (§7.8), `tests/types/tables-envelope.types.ts` (the
type-level checks of §8.4, compiled by `pnpm typecheck` only),
`tests/helpers/tables-expectations.ts`, `tests/helpers/tables-text-expectations.ts` and
`tests/helpers/cli-expectations.ts`. All are new files. Their generated documents live only in temp
directories.

**Documents:**

| ID | File | Change |
|---|---|---|
| D-1 | `docs/architecture.md` §12 rule 6 | The amendment of §5.9: version per command's envelope, selection by `(command, contractVersion)` |
| D-2 | `docs/architecture.md` §12 rule 1 | "`degraded` (warnings/errors, schema emitted) or `failed` (fatal, `schema: null`)" becomes "the command's payload (`schema` for inspect/validate, `result` for tables) emitted, or `null` when `failed`" |
| D-3 | `docs/architecture.md` §12 rule 4 | "Raw is always adjacent to interpreted" is scoped to the `schema` payload. `result` is a projection that cites its object by `objectIndex` and `span` instead of carrying `raw`. The raw text stays available from `inspect` |
| D-4 | `docs/architecture.md` §12 opening paragraph | "`--format json` is the only format and the default; a `text` renderer remains a later command-level concern" becomes per-command formats with a pointer to this specification. "One envelope per invocation, on stdout … exactly one JSON document plus the newline that ends it" is qualified in two ways. First, `tables` in text mode emits no envelope. Second, for `tables` that framing holds only when the write succeeds: after exit `70` or `74`, or a closed pipe, stdout may hold an incomplete prefix, and "accepted" means accepted by Node, not delivered (§3.7, §7.2). The `inspect`/`validate` sentences stay as they are, because their write path does not change (F-1) |
| D-5 | `docs/architecture.md` §12 contract example and its caption | The example stays the `inspect` shape, and the caption says so. A pointer to the tables shape (§5.2 here) is added |
| D-6 | `docs/architecture.md` §3 | The pipeline sketch and the Output row: "stdout: one JSON envelope, or `tables` text". The §11 diagnostic table is not touched, because `tests/catalog.test.ts` parses it |
| D-7 | `README.md` | Every statement that is no longer true once `tables` ships: (1) the introduction, "writes one JSON envelope to stdout" and "JSON is the only output format", becomes: `inspect`/`validate` write one JSON envelope, and `tables` writes text by default or JSON with `--format json`; (2) the usage block gains `a5er tables [--format text\|json] <file>`, and "No other command exists yet: any other word, such as `tables` or `export`, exits 2" is reduced to the commands that still do not exist; (3) "`--format json` is accepted but is the default and only format" becomes per command; (4) the Output section's "`inspect` and `validate` write exactly one JSON envelope …; no other command or option does" gains the `tables` text and JSON outputs and the rule that notes start with `#`; (5) "Every envelope has the keys … `schema` …" becomes per command: `schema` for inspect/validate and `result` for tables, with the `(command, contractVersion)` selection rule (§5.1); (6) "A `failed` envelope … with `source`, `schema` and `completeness` set to `null`" becomes `schema` (inspect/validate) or `result` (tables); (7) the exit table gains `70` and `74`, which only `tables` uses, and a note that after `70`, `74` or a closed pipe stdout may be incomplete, with the consumer checks of §3.7; (8) the confidentiality note says that `tables --format json` echoes `raw`, `details` and the path like `inspect`, and that text prints names only |
| D-8 | `docs/test-strategy.md` | The new test files, the R-4 platform skip in §13 (CI mapping), the byte regression, and B-6 as a manual measurement |
| D-9 | `skills/a5er-cli/SKILL.md` | Optional. The listing procedure could call `a5er tables --format json` instead of its inline projection. That is a separate decision, and until then the Skill stays as it is. If it is adopted, the Skill's run block, which exits `70` on its own `mktemp` failure, must keep that apart from the CLI's new exit `70` (§3.7) |

D-1 to D-7 are the conditions K-5 refers to. D-8 is required by AGENTS.md's rule that documents
describe shipped behaviour. D-9 is optional.

**Workflow (optional, each needs separate approval):** C-1 adds a `tables` step to
`pack smoke` in `.github/workflows/ci.yml`, and C-2 adds a macOS job.

**Not changed:** `package.json` (version and dependencies), `pnpm-lock.yaml`,
`.github/workflows/release.yml`, `.gitignore`, `.gitattributes`. `package.json#version` moves only
through `pnpm release:prepare` in its own reviewed PR.

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
| F-1 | `inspect`/`validate` crash on a broken pipe or a stdout write error: exit `1` (the code for a failed read) and a stack trace that includes the install path (§7.1, measured) | A separate issue to route every command through `writeOutput` (§7.2). It changes observable `inspect`/`validate` behaviour in that error case, so it needs explicit approval outside decision 6. R-C's observation is then expected to change |
| F-2 | `quote()` in misuse messages leaves C1 and bidi controls raw | **Moved into P0**: `quoteArg` (§3.5, §3.10, S-6) |
| F-3 | macOS is not in the CI matrix | C-2 in §9, if wanted |
| F-4 | Large accepted inputs exhaust shared resources in the existing pipeline (§7.1, measured). `inspect`'s `toJsonString` throws `RangeError: Invalid string length` on a 20.9 MB file of 1,999,000 unknown keys, and exits `1` with no envelope. At 64 MiB of `Field` lines, `serialize()` exhausts the default 4,288 MiB heap (abort, exit status `134`); at that baseline the stage was shared by `tables` as well, and Phase A's stage results are still held whole, so an out-of-memory abort is possible for inputs **within the current read limits**, for `inspect`, `validate` and `tables` alike | Tracked in [issue #27](https://github.com/j1nn0/a5er-cli/issues/27). **P0 does not fix the parser or `serialize()` memory use**, and does not hide the risk: §2, §3.7 and §7.1 state it. The schema-side half has since been addressed for `tables`: `buildTablesEnvelope()` (§2, §5.5) builds the document from the stage results and never calls `serialize()`, so `inspect`'s `schema` is no longer part of `tables`' peak — measuring what remains is still open. Handed over to P1: measure peak heap per stage (load, scan, classify, semantics, serialize, projection) against input size on Node 24 and 26, and find the smallest accepted input that aborts. Before any release that ships `tables`, a recorded decision is required: for example lower read limits (TBD-O3), the plan-B projection, or a documented limit. Routing `inspect`'s JSON through `encodeJson` changes its failure behaviour and needs approval outside decision 6 |

No contract question about `tables` is left open (§5.9).
