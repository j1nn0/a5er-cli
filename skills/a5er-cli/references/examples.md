# Recorded runs

Every case below ran the run block from SKILL.md, unchanged except for the `file=` line and the subcommand shown with it. The text output is verbatim except that trailing spaces are trimmed. Run from the repository root. Fixture paths exist only in a checkout of the a5er-cli repository. The block's own exit status equals the CLI's.

The cases down to "exit 2: unsupported --format value" are historical: they ran with CLI version 0.1.2 as published, which has only `inspect` and `validate` (its usage text lists just those two), and with the earlier form of the block, which skipped extraction only after exit 2 and used `exit 70` for a failed `mktemp`. Their stdout, stderr and exit codes are unchanged by the later block. The cases under "Focused commands" were recorded afterwards with the repository build at commit `650cfb4`, using the current block.

## ok, nothing unsupported (inspect)

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=0
ok unsupported=0 {"sections":{"total":5,"parsed":5,"preservedRaw":0,"unknown":0},"keys":{"total":25,"parsed":25,"preservedRaw":0},"lines":{"total":37,"accounted":37,"dropped":0},"dropped":0}
info V_VIEW_COLUMNS_UNKNOWN line 35
(block exit status: 0)
```

## ok, with unsupported constructs (inspect)

```sh
file=tests/fixtures/synthetic/txt-04-unknown-section-key.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=0
ok unsupported=4 {"sections":{"total":3,"parsed":2,"preservedRaw":1,"unknown":1},"keys":{"total":6,"parsed":3,"preservedRaw":3},"lines":{"total":13,"accounted":13,"dropped":0},"dropped":0}
unsupported {"index":0,"kind":"unknown-key","key":"MysteryKey"}
unsupported {"index":1,"kind":"unknown-key","key":"SecondMystery"}
unsupported {"index":2,"kind":"unknown-section","key":null}
unsupported {"index":3,"kind":"unknown-key","key":"Note"}
info S_UNKNOWN_KEY line 5
info S_UNKNOWN_KEY line 6
info S_UNKNOWN_SECTION line 9
(block exit status: 0)
```

## ok, subtype membership unsupported (inspect)

```sh
file=tests/fixtures/synthetic/sem-05-subtype.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=0
ok unsupported=1 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":9,"parsed":9,"preservedRaw":0},"lines":{"total":16,"accounted":16,"dropped":0},"dropped":0}
unsupported {"index":0,"kind":"subtype-membership","key":null}
info V_UNSUPPORTED_SUBTYPE_MEMBERSHIP line 12
(block exit status: 0)
```

## degraded, warnings only (validate, exit 0)

```sh
file=tests/fixtures/synthetic/sem-01-dangling-refs.a5er
# subcommand line in the block: a5er validate "$file"
```

```text
exit=0
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":14,"parsed":14,"preservedRaw":0},"lines":{"total":21,"accounted":21,"dropped":0},"dropped":0}
warning V_DANGLING_ENTITY line 14
warning V_DANGLING_COLUMN line 16
warning V_DANGLING_PAGE line 21
(block exit status: 0)
```

## degraded, error diagnostic (validate, exit 3)

```sh
file=tests/fixtures/synthetic/sem-08-duplicate-pname.a5er
# subcommand line in the block: a5er validate "$file"
```

```text
exit=3
a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":7,"parsed":7,"preservedRaw":0},"lines":{"total":14,"accounted":14,"dropped":0},"dropped":0}
error V_DUPLICATE_OBJECT_NAME line 12
info V_VIEW_COLUMNS_UNKNOWN line 12
(block exit status: 3)
```

## same file under inspect: error diagnostic, exit 0

```sh
file=tests/fixtures/synthetic/sem-08-duplicate-pname.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=0
a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":7,"parsed":7,"preservedRaw":0},"lines":{"total":14,"accounted":14,"dropped":0},"dropped":0}
error V_DUPLICATE_OBJECT_NAME line 12
info V_VIEW_COLUMNS_UNKNOWN line 12
(block exit status: 0)
```

## diagnostics are in line order, not severity order (inspect)

```sh
file=tests/fixtures/synthetic/val-08-continuation-line.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=0
degraded unsupported=1 {"sections":{"total":2,"parsed":2,"preservedRaw":0,"unknown":0},"keys":{"total":4,"parsed":4,"preservedRaw":0},"lines":{"total":10,"accounted":10,"dropped":0},"dropped":0}
unsupported {"index":0,"kind":"multiline-value","key":null}
info V_VIEW_COLUMNS_UNKNOWN line 7
warning S_MALFORMED_LINE line 9
(block exit status: 0)
```

## failed envelope: unreadable path (inspect, exit 1)

```sh
file=tests/fixtures/synthetic/does-not-exist.a5er
# subcommand line in the block: a5er inspect "$file"
```

```text
exit=1
a5er: fatal: E_IO: The input could not be read
failed unsupported=0 null
fatal E_IO
(block exit status: 1)
```

## exit 2: missing operand

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er inspect
```

```text
exit=2
a5er: missing the file operand for inspect

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version
Run 'a5er --help' for details.
(block exit status: 2)
```

## exit 2: unsupported --format value

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er inspect --format yaml "$file"
```

```text
exit=2
a5er: unsupported --format value "yaml"; only json is supported

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version
Run 'a5er --help' for details.
(block exit status: 2)
```

## Focused commands (repository build, commit 650cfb4)

`a5er --version` prints `0.1.2` on this build too, the same string as the published package, so the version does not show which commands exist. The `tables`, `columns` and `relations` cases below use `--format json` and add the payload line from SKILL.md after the diagnostics loop (it drops `span`).

### tables --format json

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er tables --format json "$file"
```

```text
exit=0
ok unsupported=0 {"sections":{"total":5,"parsed":5,"preservedRaw":0,"unknown":0},"keys":{"total":25,"parsed":25,"preservedRaw":0},"lines":{"total":37,"accounted":37,"dropped":0},"dropped":0}
info V_VIEW_COLUMNS_UNKNOWN line 35
{"objects":3,"omitted":{"subtypes":{"count":0,"sectionIndexes":[]}}}
{"objectIndex":0,"sectionIndex":2,"kind":"entity","pname":"users","lname":"ユーザー","columns":{"status":"complete","reason":null,"declared":2,"common":0,"effective":2,"collisions":0}}
{"objectIndex":1,"sectionIndex":3,"kind":"entity","pname":"orders","lname":null,"columns":{"status":"complete","reason":null,"declared":2,"common":0,"effective":2,"collisions":0}}
{"objectIndex":2,"sectionIndex":5,"kind":"view","pname":"active_users","lname":null,"columns":{"status":"unknown","reason":"view-columns-not-stored","declared":null,"common":null,"effective":null,"collisions":null}}
(block exit status: 0)
```

The view's counts are `null`, not `0`: its columns are unknown.

### columns --format json: an entity

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er columns --format json "$file" users
```

```text
exit=0
ok unsupported=0 {"sections":{"total":5,"parsed":5,"preservedRaw":0,"unknown":0},"keys":{"total":25,"parsed":25,"preservedRaw":0},"lines":{"total":37,"accounted":37,"dropped":0},"dropped":0}
info V_VIEW_COLUMNS_UNKNOWN line 35
{"kind":"entity","sectionIndex":2,"pname":"users","lname":"ユーザー","columns":{"status":"complete","columns":[{"pname":"id","logicalName":"ユーザーID","source":"declared","collision":false},{"pname":"email","logicalName":"メール","source":"declared","collision":false}],"declared":[{"pname":"id","logicalName":"ユーザーID","source":"declared","collision":false},{"pname":"email","logicalName":"メール","source":"declared","collision":false}],"common":[],"collisions":[],"usingCommonColumns":{"value":1,"origin":"defaulted","raw":"","token":"absent"}}}
(block exit status: 0)
```

### columns --format json: a view, unknown columns

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er columns --format json "$file" active_users
```

```text
exit=0
ok unsupported=0 {"sections":{"total":5,"parsed":5,"preservedRaw":0,"unknown":0},"keys":{"total":25,"parsed":25,"preservedRaw":0},"lines":{"total":37,"accounted":37,"dropped":0},"dropped":0}
info V_VIEW_COLUMNS_UNKNOWN line 35
{"kind":"view","sectionIndex":5,"pname":"active_users","lname":null,"columns":{"status":"unknown","reason":"view-columns-not-stored"}}
(block exit status: 0)
```

There is no column list to report, and none is invented.

### columns: selection failure (exit 4)

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er
# subcommand line in the block: a5er columns --format json "$file" nosuch
```

```text
exit=4
a5er: error: no object is named "nosuch"
(block exit status: 4)
```

stdout is empty and the extraction is skipped. This is not an empty column list.

### relations --format json: a dangling endpoint

```sh
file=tests/fixtures/synthetic/sem-01-dangling-refs.a5er
# subcommand line in the block: a5er relations --format json "$file"
```

```text
exit=0
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":14,"parsed":14,"preservedRaw":0},"lines":{"total":21,"accounted":21,"dropped":0},"dropped":0}
warning V_DANGLING_ENTITY line 14
warning V_DANGLING_COLUMN line 16
warning V_DANGLING_PAGE line 21
relations=1
{"sectionIndex":3,"sectionHeader":"[Relation]","pname":null,"from":{"declared":"orders","status":"resolved","candidates":1,"resolvedEntity":"orders"},"to":{"declared":"ghost_table","status":"dangling","candidates":0,"resolvedEntity":null},"fields1Count":1,"fields2Count":1,"relationType1":1,"relationType2":3,"cardinarity1":"Z","cardinarity2":"P","columnsAligned":true}
(block exit status: 0)
```

`columnsAligned` is `true` although `V_DANGLING_COLUMN` is reported: it compares slot counts only. Exit 0 and empty stderr go with `degraded` because every diagnostic is a warning.

### capability detection: the installed CLI lacks the command

Recorded with the published 0.1.2 package installed from npm into a temporary prefix and put first on `PATH`; run from the repository root. The request was to list the tables of the baseline fixture.

```sh
a5er --help | sed -n 3,7p
a5er tables tests/fixtures/synthetic/fmt-01-baseline.a5er; echo "exit=$?"
```

```text
Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help
  a5er --version
a5er: unknown command "tables"

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version
Run 'a5er --help' for details.
exit=2
```

`--help` lacks `tables`, so the answer is that the installed CLI does not provide it, with the checkout route offered. The `.a5er` text is not read.

## missing CLI

Run in a shell where `a5er` is not on PATH (simulated by a subshell whose PATH is `/usr/bin:/bin`):

```sh
(PATH=/usr/bin:/bin; command -v a5er; echo "exit=$?")
```

```text
exit=1
```
