# Recorded runs

Every command below was executed against committed synthetic fixtures (or a throwaway temp file) with CLI version 0.1.0; outputs are verbatim, trimmed only by the extraction snippet from SKILL.md. Run from the repository root. Fixture paths exist only in a checkout of the a5er-cli repository.

## ok, nothing unsupported (inspect)

```sh
file=tests/fixtures/synthetic/fmt-01-baseline.a5er.txt
out=$(mktemp)
a5er inspect "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=0
--- stderr ($out.err)
(empty)
--- stdout bytes: 22280, lines: 1
--- extraction snippet output
ok unsupported=0 {"sections":{"total":5,"parsed":5,"preservedRaw":0,"unknown":0},"keys":{"total":25,"parsed":25,"preservedRaw":0},"lines":{"total":37,"accounted":37,"dropped":0},"dropped":0}
info V_VIEW_COLUMNS_UNKNOWN line 35
```

## ok, with unsupported constructs (inspect)

```sh
file=tests/fixtures/synthetic/txt-04-unknown-section-key.a5er.txt
out=$(mktemp)
a5er inspect "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=0
--- stderr ($out.err)
(empty)
--- stdout bytes: 4588, lines: 1
--- extraction snippet output
ok unsupported=4 {"sections":{"total":3,"parsed":2,"preservedRaw":1,"unknown":1},"keys":{"total":6,"parsed":3,"preservedRaw":3},"lines":{"total":13,"accounted":13,"dropped":0},"dropped":0}
info S_UNKNOWN_KEY line 5
info S_UNKNOWN_KEY line 6
info S_UNKNOWN_SECTION line 9
```

## degraded, warnings only (validate, exit 0)

```sh
file=tests/fixtures/synthetic/sem-01-dangling-refs.a5er.txt
out=$(mktemp)
a5er validate "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=0
--- stderr ($out.err)
(empty)
--- stdout bytes: 12936, lines: 1
--- extraction snippet output
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":14,"parsed":14,"preservedRaw":0},"lines":{"total":21,"accounted":21,"dropped":0},"dropped":0}
warning V_DANGLING_ENTITY line 14
warning V_DANGLING_COLUMN line 16
warning V_DANGLING_PAGE line 21
```

## degraded, error diagnostic (validate, exit 3)

```sh
file=tests/fixtures/synthetic/sem-08-duplicate-pname.a5er.txt
out=$(mktemp)
a5er validate "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=3
--- stderr ($out.err)
a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)
--- stdout bytes: 7483, lines: 1
--- extraction snippet output
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":7,"parsed":7,"preservedRaw":0},"lines":{"total":14,"accounted":14,"dropped":0},"dropped":0}
error V_DUPLICATE_OBJECT_NAME line 12
info V_VIEW_COLUMNS_UNKNOWN line 12
```

## same file under inspect: error diagnostic, exit 0

```sh
file=tests/fixtures/synthetic/sem-08-duplicate-pname.a5er.txt
out=$(mktemp)
a5er inspect "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=0
--- stderr ($out.err)
a5er: error: V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 12)
--- stdout bytes: 7482, lines: 1
--- extraction snippet output
degraded unsupported=0 {"sections":{"total":3,"parsed":3,"preservedRaw":0,"unknown":0},"keys":{"total":7,"parsed":7,"preservedRaw":0},"lines":{"total":14,"accounted":14,"dropped":0},"dropped":0}
error V_DUPLICATE_OBJECT_NAME line 12
info V_VIEW_COLUMNS_UNKNOWN line 12
```

## failed envelope (empty input, exit 1)

```sh
file=$(mktemp)   # an empty temp file
a5er inspect "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=1
--- stderr
a5er: fatal: E_EMPTY_INPUT: The input is empty
--- extraction snippet output
failed unsupported=0 null
fatal E_EMPTY_INPUT
--- raw stdout
{"contractVersion":"0.1.0","tool":{"name":"@j1nn0/a5er-cli","version":"0.1.0"},"command":"inspect","status":"failed","source":null,"limits":{"maxBytes":67108864,"truncated":false},"schema":null,"unsupported":[],"diagnostics":[{"code":"E_EMPTY_INPUT","severity":"fatal","message":"The input is empty","details":{"sizeBytes":0},"span":null,"construct":"Source"}],"completeness":null}
```

## exit 2 (missing operand)

```sh
a5er inspect >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=2
--- stderr
a5er: missing the file operand for inspect

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version
Run 'a5er --help' for details.
--- stdout bytes: 0
```

## exit 2 (unsupported --format value)

```sh
a5er inspect --format yaml "$file" >"$out" 2>"$out.err"; echo "exit=$?"
```

```text
exit=2
--- stderr
a5er: unsupported --format value "yaml"; only json is supported

Usage:
  a5er inspect [--format json] <file>
  a5er validate [--format json] <file>
  a5er --help | --version
Run 'a5er --help' for details.
--- stdout bytes: 0
```

## missing CLI

Run in a shell where `a5er` is not on PATH (simulated here by a subshell whose PATH is `/usr/bin:/bin`):

```sh
(PATH=/usr/bin:/bin; command -v a5er; echo "exit=$?")
```

```text
exit=1
```
