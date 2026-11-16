# Test strategy — Phase 1 (Vitest, synthetic fixtures)

Phase 1 design output. **Nothing here is implemented:** no `package.json`, no `src/`, no
`tests/` exist in this repository as of this unit. This file decides how the parser and CLI
will be tested in Phase 2, so that tests are written against a contract rather than invented
alongside the code.

Companions, both committed: `docs/architecture.md` (pipeline, data model, diagnostics, JSON
envelope, §13 completeness, §14 adversarial matrix, §17 TBDs, §18 staging) and
`docs/format-coverage.md` (P1–P13 with per-point test cases, F1–F10 invariants, U1–U15 open
items). Citation shorthand is the same as in `architecture.md` §"Citation shorthand".

Governing principle, taken from `parser-evaluation.md` §7 L4: **a test must assert a value
parsed from a fixture that contains the construct.** A green suite that proves only "did not
throw" is the failure mode this project exists to avoid — both evaluated parsers had one.

---

## 1. What is tested

| Layer under test | Covered by | Not covered |
|---|---|---|
| Decoder (`decode/`) | L1 unit + L2 integration | OS-specific codepages outside the documented chain |
| Scanner and registry (`syntax/`, `schema/`) | L1 unit + L2 + L3 fixture snapshots | Nothing — this is the core |
| AST and resolver (`model/`, `resolve/`) | L2 + L3 | Presentation semantics (F9) |
| Validator (`validate/`) | L2 + L3 | DDL generation, constraint-name templates (D7) |
| JSON envelope (`json/`) | L4 contract | Consumer-side behaviour |
| CLI (`cli/`) | L5 end-to-end (spawn) | Shell completion, packaging, publishing |

**Stage boundary rule** (from `architecture.md` §3): a syntax test must never need the
validator, and a validation test must never re-parse. If a test cannot be written at one level
without reaching into another, that is a design defect to report, not a test to bend.

---

## 2. Test levels

| Level | What it owns | Isolation | Runner |
|---|---|---|---|
| **L1 unit** | One exported function: `splitComplex`, `decodeField`, registry lookup, `decodeBuffer`, span arithmetic, diagnostics factory, envelope serialiser | Pure, no filesystem | Vitest, in-process |
| **L2 integration** | Decode → parse → resolve → validate over in-memory bytes; AST and resolved-model assertions | Temp dir for anything needing a path | Vitest |
| **L3 fixture snapshot** | Committed fixture file → full JSON envelope → golden comparison | Real file on disk | Vitest |
| **L4 contract** | Envelope shape invariants: `dropped === 0`, status derivation, exit codes, stdout/stderr separation, span presence rules | Spawned CLI | Vitest + `execa`-free `node:child_process` |
| **L5 end-to-end** | `a5er inspect` / `validate` on a staged fixture, including failure modes | Spawned CLI, temp cwd | Vitest |
| **L6 hostile/fuzz floor** | Fixed-seed byte mutation of a baseline fixture | In-process | Vitest |

L1 exists so that the highest-risk component (F3, the Complex splitter) can be tested
exhaustively without building a file for every escape combination.

---

## 3. Fixtures

### 3.1 Three fixture classes

| Class | Shape | Committed as | Why |
|---|---|---|---|
| **Text-shaped** | Valid UTF-8, reviewable line by line (BOM, CRLF, LF, no trailing newline, escapes, Japanese names) | `tests/fixtures/synthetic/<id>.a5er.txt` | Reviewable in diff; the `.txt` suffix keeps `*.a5er` ignored (3.2) |
| **Byte-shaped** | Not valid UTF-8 or not text: Shift_JIS, UTF-16LE, invalid UTF-8, NUL bytes | `tests/fixtures/bytes/<id>.ts` exporting the exact bytes, with the decoded text in a comment | Node has **no Shift_JIS encoder** — verified: `new TextEncoder('shift_jis')` reports `utf-8` and emits `e38386e382b9e38388` for `テスト`, i.e. UTF-8. A byte fixture therefore cannot be produced from readable text, and a committed non-UTF-8 blob would be unreviewable and EOL-conversion-sensitive |
| **Generated** | Size/limit cases and fuzz mutations | Not committed; built in a temp dir at test time | A 64 MiB file must not live in git, and mutations are defined by code |

### 3.2 Decision: `.a5er.txt` in the repo, real `.a5er` only at run time

Committed fixtures end in `.a5er.txt`. A staging helper copies each fixture to a temp directory
under its real name (`<tmp>/<id>.a5er`) before any code under test opens it.

Rationale, in order of weight:

1. **The confidentiality guard stays absolute.** `.gitignore` ignores `*.a5er` with the comment
   "Real ER diagrams may contain confidential schema information". Adding an exception weakens
   that guard for every future contributor; the `.txt` suffix means **no `.gitignore` change is
   required at all** for this strategy.
2. **Extension realism is preserved where it matters.** The CLI only ever sees `<id>.a5er`, so
   error messages, path handling and any future extension check are exercised realistically.
3. **Byte fidelity is independent of the name.** A `.txt` file is not treated as text by git
   once `.gitattributes` marks it `-text` (3.3).

Verified: with `*.a5er` as the only rule, `git check-ignore -v tests/fixtures/synthetic/case.a5er.txt`
reports nothing (not ignored), while `tests/fixtures/synthetic/case.a5er` and `docs/x.a5er` are
ignored.

### 3.3 Rejected alternative, and the exact rule if it is ever adopted

If real `.a5er` extensions must live in the repo, this is the rule — **proposed, not applied in
this unit**, and it must be appended *after* `*.a5er` (order matters):

```gitignore
# Synthetic fixtures only. Real ER diagrams stay ignored everywhere else.
!tests/fixtures/synthetic/**/*.a5er
```

Verified behaviour of that pair: `tests/fixtures/synthetic/case.a5er` becomes trackable while
`docs/x.a5er` stays ignored. It is rejected for now because it weakens the guard for one whole
directory; a stray `cp` of a real export into that directory would be committed silently.

**Byte-fidelity rule (proposed, not applied in this unit)** — required either way, because git
may normalise line endings on checkout and the CRLF/LF/mixed fixtures depend on exact bytes:

```gitattributes
# Fixtures are byte-exact: no EOL conversion, no text diffing
tests/fixtures/** -text
```

### 3.4 Layout and naming

```
tests/
  fixtures/
    synthetic/            # committed, text-shaped, staged to *.a5er at run time
      fmt-01-baseline.a5er.txt
      fmt-01-baseline.expected.json
      val-01-escapes.a5er.txt
      ...
    bytes/                # committed, byte-shaped, exported as Uint8Array
      enc-03-sjis.ts
    generated/            # builders, not fixtures (limits, fuzz seeds)
  helpers/
    stage.ts              # fixture -> temp path under its real extension
    envelope.ts           # assertStatus / assertCodes / assertCompleteness / scrubPaths
  unit/                   # L1
  integration/            # L2
  fixtures.test.ts        # L3 over the whole catalog
  contract.test.ts        # L4
  cli.test.ts             # L5
  fuzz.test.ts            # L6
  immutability.test.ts    # G-7, one run per command per fixture
```

Naming: `<family>-<nn>-<slug>`, families `fmt`, `enc`, `txt`, `val`, `sem`, `hst`, `res`.
IDs are stable — they appear in this document, in the catalog test, and in failure messages.

### 3.5 Staging helper and the access rule

```ts
// tests/helpers/stage.ts
export async function stage(id: string): Promise<StagedFile>  // { path, sha256, cleanup }
```

Rules:

- **No test opens `tests/fixtures/**` directly.** A guard test greps the test sources for
  `readFileSync('tests/fixtures` / `readFile('tests/fixtures` and fails. This keeps byte
  handling, path scrubbing and cleanup in one place.
- Staging copies bytes (`fs.copyFileSync`), never decodes and re-encodes.
- `StagedFile.sha256` is the hash of the staged bytes and is what immutability assertions
  compare against.

### 3.6 Expected output

Every snapshot fixture has a sibling `<id>.expected.json` containing the full envelope with
paths scrubbed. Comparison rules:

| Rule | Detail |
|---|---|
| Path normalisation | Any absolute path is replaced by `<tmp>` before comparison |
| Hash normalisation | `source.sha256` is compared, not regenerated, so fixture edits fail loudly |
| Key order | Compared structurally (deep equal on parsed objects), not textually |
| Volatile fields | `tool.version` compared as a semver pattern, not a literal |
| Arrays | Order is significant (file order is part of the contract) except `diagnostics`, which is asserted as a per-code multiset plus span checks |

**No inline Vitest snapshots.** `vitest -u` can rewrite a snapshot without a human reading the
diff, which is exactly the "illusory green" risk. Expected JSON files change only by explicit
edit, so the diff is the review.

### 3.7 Authoring rules

- Synthetic only. No fixture may be derived from a real export, a customer schema, or a
  confidential diagram (`parser-evaluation.md` §6 fixture gate).
- Names are obviously fake: `users`, `orders`, `ユーザー`, `注文`. No real project or person.
- Every fixture states, in a leading comment or in its `.ts` docstring, **what construct it
  exists to exercise** and which P/§14 row it serves.
- A fixture that does not contain the construct under test is rejected in review (L4).

### 3.8 Real-export validation — local only, never committed

The parser is not "validated" on synthetic fixtures alone: `parser-evaluation.md` §6 makes 2–3
anonymised real exports a gate. Because those files are exactly what `.gitignore` protects, they
must never enter the repository or CI. Mechanics:

- A test module discovers real fixtures through `A5ER_REAL_FIXTURES=/path/to/dir` and is
  skipped entirely (`describe.skipIf`) when the variable is unset — so CI on a clean checkout
  stays green, and the skip is honest rather than silent.
- The directory is read **in place**, copied only into the per-test temp dir, and never named in
  an expected-output file.
- Running with the variable set is a **release and stage-gate checklist item**, not a CI job:
  `A5ER_REAL_FIXTURES=… pnpm test -- --mode real`.
- Failures are reported with the fixture's sha256 and a redacted excerpt (line number and code
  only, never schema text), so a maintainer can act without pasting confidential content into
  an issue.
- Real-file results never update committed expectations; divergence becomes a new synthetic
  fixture that reproduces the construct.

---

## 4. Fixture catalog

Every row is a required fixture. "Stage" is the `architecture.md` §18 stage that owns it.

| ID | File | Serves | Encodes | Stage |
|---|---|---|---|---|
| `fmt-01` | `fmt-01-baseline.a5er.txt` | §14 row 1; golden | BOM + UTF-8 + CRLF; two entities, one view, one relation, `IndexInfo`, composite PK-free, one page | 2–3 |
| `fmt-02` | `fmt-02-format19-legacy-index.a5er.txt` | §14 row 1; P8 | `FORMAT:19`, legacy `Index=` only, no `IndexInfo` | 3 |
| `fmt-03` | `fmt-03-no-header.a5er.txt` | P1 | No `FORMAT` line, BOM present | 3 |
| `fmt-04` | `fmt-04-format20.a5er.txt` | P1, K2 | `FORMAT:20` (the documented hole) | 3 |
| `fmt-05` | `fmt-05-format99.a5er.txt` | P1 | `FORMAT:99` | 3 |
| `enc-02` | `enc-02-no-bom.a5er.txt` | §14 row 2 | UTF-8 without BOM | 2 |
| `enc-03` | `bytes/enc-03-sjis.ts` | §14 row 3 | Shift_JIS bytes with `ENCODING:UTF8`; Japanese names decode correctly | 2 |
| `enc-04` | `bytes/enc-04-undecodable.ts` | §14 row 4 | Bytes that fail every strict candidate | 2 |
| `enc-05` | `bytes/enc-05-utf16le.ts` | P2 | UTF-16LE BOM, no `ENCODING` hint | 2 |
| `txt-01` | `txt-01-multi-table-view.a5er.txt` | §14 row 6 | Three entities, two views, two pages | 3 |
| `txt-02` | `txt-02-relationship-alias.a5er.txt` | P3 | `[Relation]` and `[Relationship]` in one file | 3 |
| `txt-03` | `txt-03-relation-composite.a5er.txt` | §14 row 8 | `Fields1="a,b"`, `Fields2="x,y"` | 3 |
| `txt-04` | `txt-04-unknown-section-key.a5er.txt` | §14 row 9 | `[Memo]` section, unknown key in `[Entity]` | 3 |
| `txt-05` | `txt-05-duplicate-scalar.a5er.txt` | §14 row 10; U6 | Duplicate `ProjectName` with different values | 3 |
| `txt-06` | `txt-06-duplicate-manager.a5er.txt` | P3, U5 | Two `[Manager]` sections | 3 |
| `txt-07` | `txt-07-lowercase-section.a5er.txt` | P3 | `[entity]` | 3 |
| `txt-08` | `txt-08-header-whitespace.a5er.txt` | P3 | ` [Entity] ` with surrounding spaces | 3 |
| `txt-09` | `txt-09-empty-section.a5er.txt` | P3 | A known section with no keys | 3 |
| `val-01` | `val-01-escapes.a5er.txt` | §14 row 5; P5 | Comments containing `\Q`, `\q`, `\\`, `\t`, `\n`, a literal `,` and a real `\"` sequence | 3 |
| `val-02` | `val-02-index-multi-column.a5er.txt` | §14 row 8; P8 | `IndexInfo="users_ix1",1,"user_name,birthday", ""` | 3 |
| `val-03` | `val-03-field-9-element.a5er.txt` | P7, K3 | The 9-element sample shape | 3 |
| `val-04` | `val-04-field-11-element.a5er.txt` | P7 | 11 elements (future growth) | 3 |
| `val-05` | `val-05-field-missing-color.a5er.txt` | P7 | 7 elements — 色 absent | 3 |
| `val-06` | `val-06-composite-pk.a5er.txt` | §14 row 7; P8 | キー順 `0,1,2` | 4 |
| `val-07` | `val-07-color-tokens.a5er.txt` | P5, F8 | `$FFFFFFFF`, `$AABBGGRR`-style and ambiguous-length tokens | 4 |
| `val-08` | `val-08-continuation-line.a5er.txt` | P13, U12 | A query split across two physical lines | 3 |
| `val-09` | `val-09-keyorder-gap.a5er.txt` | P8 | キー順 `0,2` | 4 |
| `val-10` | `val-10-value-with-equals.a5er.txt` | P4 | `TableInnerOption` value containing `=` | 3 |
| `val-11` | `val-11-unterminated-quote.a5er.txt` | P5 | A Complex value whose closing quote is missing | 3 |
| `sem-01` | `sem-01-dangling-refs.a5er.txt` | §14 row 13 | Dangling entity, dangling column, dangling page — in one file | 4 |
| `sem-02` | `sem-02-page-case.a5er.txt` | P9, F5 | `PageInfo="Main"` with `Position="MAIN"` | 4 |
| `sem-03` | `sem-03-fields-count-mismatch.a5er.txt` | P9, U8 | `Fields1` 2, `Fields2` 3 | 4 |
| `sem-04` | `sem-04-legacy-index-under-21.a5er.txt` | F2, D5 | `FORMAT:21` carrying only legacy `Index=` | 3–4 |
| `sem-05` | `sem-05-subtype.a5er.txt` | P13, F7 | `[Subtype]` present | 4 |
| `sem-06` | `sem-06-view-columns.a5er.txt` | P10 | View with `LNameByComment=1`, plus a plain view | 4 |
| `sem-07` | `sem-07-domains-commonfields.a5er.txt` | P12 | Domain + `@INT` field + `UsingCommonColumns` absent and `0` | 4 |
| `sem-08` | `sem-08-duplicate-pname.a5er.txt` | P6 | Entity and View sharing `PName` | 4 |
| `sem-09` | `sem-09-zero-pages.a5er.txt` | P11 | `[Manager]` with no `PageInfo` | 4 |
| `sem-10` | `sem-10-missing-position.a5er.txt` | P11 | Entity with no `Position` | 4 |
| `sem-11` | `sem-11-zero-fields.a5er.txt` | P6 | Entity with no `Field` (legal) | 4 |
| `hst-01` | `hst-01-nul-inside-text.a5er.txt` | §14 row 15 | A NUL below the binary threshold, inside a comment | 2 |
| `hst-02` | `bytes/hst-02-binary.ts` | §14 row 15 | More than 10 % NUL in the first 4 KiB | 2 |
| `hst-03` | generated | §14 row 15 | 1 MiB single line, under the limit | 2 |
| `hst-04` | `hst-04-hostile-names.a5er.txt` | §14 row 15 | `[<script>]`, `[[Entity]]`, `[Entity]x`, 4 KiB section name | 3 |
| `hst-05` | `hst-05-mixed-eol.a5er.txt` | §14 row 15, U4 | CRLF, LF and CR in one file | 2 |
| `hst-06` | generated (3 files) | §14 row 16 | Empty, whitespace-only, no recognised sections | 2 |
| `res-01` | generated | §14 row 11 | Read capped below file size | 2 |
| `res-02` | injected reader | §14 row 11 | Short read reported by the IO seam | 2 |
| `res-03` | generated (3 files) | §14 row 12 | `maxBytes`, `maxLines`, `maxLineLength` breaches | 2 |
| `imm-01` | catalog-wide | §14 row 14 | Every command against every text fixture | 5 |
| `fuzz-01` | generated | §14 row 15 | Seeded byte mutations of `fmt-01` | 6 |

---

## 5. Expected behaviour — the 16 adversarial rows

`status` is derived from severities (`architecture.md` §11): any fatal → `failed`; else any
`error` or `warning` → `degraded`; else `ok`. `exit` is for `inspect` (`validate` is noted where
it differs, per TBD-O7).

| # | Scenario | Fixtures | status | exit | Expected codes | Must assert |
|---|---|---|---|---|---|---|
| 1 | UTF-8 with BOM | `fmt-01` | ok | 0 | none | 2 entities + 1 view + 1 relation parsed; `encoding.bom === true`; every node has a span |
| 2 | UTF-8 without BOM | `enc-02` | ok | 0 | `D_BOM_MISSING` (info) | same schema as `fmt-01`; diagnostic present exactly once |
| 3 | Shift_JIS under `ENCODING:UTF8` | `enc-03` | degraded | 0 | `D_ENCODING_MISMATCH` (warning) | Japanese logical names decode exactly; **no U+FFFD anywhere in the envelope**; `encoding.detected === "shift_jis"` |
| 4 | Undecodable bytes | `enc-04` | failed | 1 | `E_UNDECODABLE` | `schema` absent, `limits.truncated === false`, no partial objects |
| 5 | Japanese names, comments, escapes | `val-01` | ok | 0 | none | `\Q` → `"`, `\q` → `'`, `\\`, `\t`, `\n` round-trip; a literal `\"` stays `\"`; comment text byte-identical to the decoded source |
| 6 | Multi-table, multi-view | `txt-01` | ok | 0 | none | 3 objects, 2 views, 2 pages; `[View]` objects report `effectiveColumns.status === "unknown"` |
| 7 | Composite PK | `val-06` | ok | 0 | none | `primaryKey.origin === "inferred"`; column order `0,1,2`; `derivedFrom` cites three key lines |
| 8 | Multi-column relation and index | `txt-03`, `val-02` | ok | 0 | none | `Fields1` → `["a","b"]`; index columns `["user_name","birthday"]` (not three fragments); order preserved |
| 9 | Unknown section and key | `txt-04` | ok | 0 | `S_UNKNOWN_SECTION`, `S_UNKNOWN_KEY` (info) | `unsupported` has 2 entries with spans; `completeness.dropped === 0`; raw lines preserved verbatim |
| 10 | Duplicate scalar, missing identity | `txt-05`, `sem-08` | degraded | 0 | `S_DUPLICATE_KEY` (warning); `V_DUPLICATE_OBJECT_NAME` (error) | last occurrence wins; both spans retained; both objects still emitted; `validate` on `sem-08` exits 3 |
| 11 | Truncated read | `res-01`, `res-02` | failed | 1 | `E_LIMIT_BYTES`; `E_TRUNCATED_INPUT` | `schema` absent in both; `limits.truncated === true` for `res-01`; no stdout JSON is a "shorter schema" |
| 12 | Above `maxBytes` | `res-03` | failed | 1 | `E_LIMIT_BYTES` | fatal before allocation; stderr carries the diagnostic; stdout envelope still valid JSON |
| 13 | Referentially broken | `sem-01` | degraded | 0 | `V_DANGLING_ENTITY`, `V_DANGLING_COLUMN`, `V_DANGLING_PAGE` (warning) | all three codes, each with its own span; schema fully emitted |
| 14 | Immutability | `imm-01` | — | 0 | none | sha256, size and `mtimeMs` identical before and after every command; handle opened read-only |
| 15 | Hostile bytes | `hst-01`, `hst-02`, `hst-03`, `hst-04`, `hst-05` | mixed | 0/1 | `E_BINARY_INPUT` for `hst-02`; others none | no crash, no hang, no mojibake; file text never appears in `code` or `message`, only in `details` (≤ 200 chars); mixed EOL produces **no** diagnostic (documented: the format defines no line endings, U4) |
| 16 | Empty, whitespace, no sections | `hst-06` | failed | 1 | `E_EMPTY_INPUT`, `E_UNRECOGNIZED_DOCUMENT` | three distinct outcomes for three distinct inputs; nothing reported as healthy |

---

## 6. Expected behaviour — point-level cases

Cases from P1–P13 that the 16 rows above do not already pin down.

| Case | Fixture | status | exit | Expected codes | Must assert |
|---|---|---|---|---|---|
| P1 · `FORMAT:20` (hole) | `fmt-04` | degraded | 0 | `S_HEADER_UNKNOWN_FORMAT` | legacy `Index` decoders active; `format.known === false` |
| P1 · `FORMAT:99` | `fmt-05` | degraded | 0 | `S_HEADER_UNKNOWN_FORMAT` | same policy as absent FORMAT |
| P1 · no header | `fmt-03` | degraded | 0 | `S_HEADER_UNKNOWN_FORMAT` | `format.declared === null`; both canonical and legacy keys decoded |
| P2 · UTF-16LE BOM | `enc-05` | ok | 0 | `D_ENCODING_ASSUMED` (info) | `encoding.detected === "utf-16le"`; content equals the UTF-8 twin byte-for-byte after decode |
| P3 · duplicate `[Manager]` | `txt-06` | degraded | 0 | `S_DUPLICATE_KEY` | both sections in the AST; both spans reported; resolved scalar is last-wins |
| P3 · `[Relationship]` alias | `txt-02` | ok | 0 | none | one relation type, not two; `header.raw` retains `[Relationship]` |
| P3 · `[entity]` lowercase | `txt-07` | ok | 0 | `S_UNKNOWN_SECTION` (info) | treated as unknown and preserved; **not** silently parsed as `[Entity]` (registry is case-sensitive; the spec defines no case rule) |
| P3 · whitespace around header | `txt-08` | ok | 0 | none | section recognised; `header.raw` keeps the original spacing |
| P3 · empty known section | `txt-09` | degraded | 0 | `V_MISSING_REQUIRED_KEY` (warning) | section present in AST with zero entries; not dropped from `completeness` |
| P4 · value containing `=` | `val-10` | ok | 0 | none | value preserved in full, including everything after the second `=` |
| P7 · 9-element `Field` | `val-03` | ok | 0 | none | `elementsSeen === 9`; colour and option populated; `additionalOption === null` |
| P7 · 11-element `Field` | `val-04` | degraded | 0 | `S_FIELD_TOO_MANY_ELEMENTS` (warning) | tenth-and-beyond tail kept in `additionalOption` raw; row not rejected |
| P7 · missing 色 | `val-05` | degraded | 0 | `S_FIELD_TOO_FEW_ELEMENTS` + `V_MISSING_REQUIRED_KEY` | `color === null`; no invented default; both diagnostics carry the same span |
| P5 · unterminated quote | `val-11` | degraded | 0 | `S_COMPLEX_UNTERMINATED_QUOTE` (warning) | the raw remainder is kept as one element; nothing after the break is silently re-parsed |
| P8 · キー順 gap | `val-09` | degraded | 0 | `V_PK_ORDER_CONFLICT` (warning) | both columns still exposed with their declared ordinals |
| P8 · legacy `Index` under `FORMAT:19` | `fmt-02` | degraded | 0 | `S_LEGACY_KEY` (info) + `V_INDEX_LEGACY_ONLY` (warning) | `indexes[].origin === "legacy"`; index columns and uniqueness correct |
| P8 · legacy `Index` under `FORMAT:21` | `sem-04` | degraded | 0 | `S_LEGACY_KEY` + `V_INDEX_LEGACY_ONLY` | same shape as `fmt-02`; canonical `IndexInfo` remains absent, never fabricated |
| P9 · page case | `sem-02` | ok | 0 | none | `MAIN` resolves to `Main`; both spellings recorded in `CaseInsensitiveRef` |
| P9 · arity mismatch | `sem-03` | degraded | 0 | `V_FIELD_COUNT_MISMATCH` (warning) | both lists preserved in full; no truncation to the shorter one |
| P11 · zero pages | `sem-09` | degraded | 0 | `V_MISSING_REQUIRED_KEY` (error) | `validate` exits 3; `inspect` still emits the schema |
| P11 · missing `Position` | `sem-10` | degraded | 0 | `V_MISSING_REQUIRED_KEY` (warning) | object emitted with `positions: []` and a span on the warning |
| P6 · zero fields (legal) | `sem-11` | ok | 0 | none | `effectiveColumns.status === "complete"` with an empty list — **not** `unknown` |
| P10 · view columns | `sem-06` | ok | 0 | `V_VIEW_COLUMNS_UNKNOWN` (info) | `LNameByComment=1` → reason `view-columns-named-from-query`; plain view → `view-columns-not-stored`; neither reports `columns: []` as if it were a fact |
| P12 · domains and common fields | `sem-07` | ok | 0 | none (G1 deferred) | `UsingCommonColumns` absent → `origin === "defaulted"`, value `1`; explicit `0` excludes common columns; `@INT` classified `system-domain`, not resolved |
| P13 · subtype | `sem-05` | ok | 0 | `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` (info) | `membership.status === "unsupported"`; no entity list invented |
| P13 · continuation line | `val-08` | degraded | 0 | `S_MALFORMED_LINE` (warning) | `unsupported` entry kind `multiline-value`; `Query` **not** joined across lines |
| P6 · duplicate `PName` | `sem-08` | degraded | 0 | `V_DUPLICATE_OBJECT_NAME` (error) | both objects emitted; `validate` exits 3 |

---

## 7. Assertion rules

| # | Rule | Enforcement |
|---|---|---|
| T1 | Every test asserts a **parsed value** or an **exact diagnostic set** | Review; banned patterns below |
| T2 | Diagnostic assertions compare the **complete code multiset**, not "contains" | `assertCodes(envelope, [...])` helper, which fails on extras and on missing |
| T3 | `completeness.dropped === 0` is asserted for every fixture that is not `failed` | Global hook in `tests/fixtures.test.ts`, so new fixtures inherit it |
| T4 | Status is asserted, but **never used as evidence of health**: a fixture with only `info` diagnostics is `ok` yet still has diagnostics | `assertStatus` plus `assertCodes` in every fixture test |
| T5 | Every span is real: `startLine ≤ keyLine ≤ endLine`, all ≥ 1, `sectionIndex` within range (0 = header) | Property loop over the whole envelope in `contract.test.ts` |
| T6 | `origin !== "declared"` nodes have `span === null` and, when inferred, a non-empty `derivedFrom` | Same property loop |
| T7 | Text from the file never appears in `code` or `message`; `details` values are ≤ 200 chars | `hst-04` plus a contract test scanning every diagnostic in every expected envelope |
| T8 | No test asserts only "did not throw", "exit code 0", or a snapshot count | Review; the fuzz floor is the single documented exception, and it also asserts a bounded runtime and `dropped === 0` |

Banned in tests: `test.skip` without a `TODO(PHASE2-<id>)` marker; `expect(true)`; unconditional
`try { … } catch { /* ignore */ }`; asserting `warnings.length > 0` instead of the codes.

---

## 8. Status derivation, and one inconsistency to fix in the architecture doc

Status is derived mechanically from severities:

```
failed   if any fatal
degraded if any error or warning
ok       otherwise        // ok may still carry info diagnostics
```

**Finding (report, do not edit here):** `architecture.md` §14 rows 2 and 9 say "status
degraded" for fixtures whose only diagnostics are `info` (`D_BOM_MISSING`,
`S_UNKNOWN_SECTION`/`S_UNKNOWN_KEY`). That contradicts §11 (both are `info`) and §12 rule 1
("`ok` = nothing above `info`"). This strategy treats §11 + §12 as authoritative, so rows 2 and
9 expect `ok`. The two `§14` assertion cells need a one-word correction in Phase 2; editing
`architecture.md` is out of scope for this unit.

---

## 9. Determinism and flakiness

| Rule | Detail |
|---|---|
| No network | Any test that opens a socket fails review; CI runs with network available but no test may depend on it |
| No wall clock | The parser must not read `Date`; a guard test greps `src/` for `Date.now` / `new Date()` outside the diagnostics timestamp field (which is absent in v1) |
| Fixed environment | `TZ=UTC`, `LC_ALL=C`, `LANG=C` in every test process |
| No randomness without a seed | The single PRNG is seeded and its seed is printed on failure |
| Stable ordering | Objects and entries follow file order; diagnostics follow span order; sorts are explicit and stable |
| Path scrubbing | Temp paths become `<tmp>` before comparison (otherwise every run differs) |
| Timing | No test asserts duration except the fuzz floor's upper bound |
| Concurrency | Fixture tests may run in parallel **only** if each stages its own temp directory; `imm-01` runs serially |
| Re-runs | The suite must pass twice in a row on a clean checkout and on Windows (line endings, mtime granularity) |

---

## 10. Gates

A pull request is green only when all of these hold. No numeric coverage percentage is gated in
v1 — it is reported, because a percentage would let an untested branch hide behind a busy module
(`TBD-T1`).

| Gate | Check | Where |
|---|---|---|
| G-1 | `completeness.dropped === 0` on every non-failed fixture | `fixtures.test.ts` global hook |
| G-2 | Exact diagnostic code multiset matches each expected envelope | `assertCodes` |
| G-3 | **Every** non-fatal code in the taxonomy is produced by at least one fixture | `catalog.test.ts` cross-check of codes in expected files vs `DiagnosticCode` |
| G-4 | No `any` in `src/` | `tsc --noEmit` plus a guard test scanning for `: any`, `as any`, `<any>` |
| G-5 | No swallowed exceptions or silently ignored branches | guard test scanning for empty `catch {}` and `catch (e) {}` with no rethrow or diagnostic |
| G-6 | No snapshot auto-update and no committed `.snap` files | guard test asserting no `__snapshots__` directory exists |
| G-7 | Immutability holds for every command | `imm-01` |
| G-8 | Fixture integrity: every catalog ID exists, is tracked, and is not ignored | `catalog.test.ts` runs `git ls-files` and `git check-ignore` |
| G-9 | Policy: no committed `.a5er` files | CI runs `git ls-files '*.a5er'` and expects empty output |

G-4 and G-5 are guard tests, not lint rules, because no linter is decided in
`architecture.md` §15. They are a stopgap: once a linter is chosen, both move to lint rules and
the guard tests are deleted (TBD-T2).

---

## 11. Immutability proof

`imm-01` runs every command (`inspect`, `tables`, `relations`, `validate`, and `search` once it
exists) against every text fixture and asserts, per invocation:

1. `sha256(stagedFile)` unchanged;
2. `stat.size` and `stat.mtimeMs` unchanged;
3. the file was opened read-only — asserted indirectly by making the staged file `chmod 0o444`
   on POSIX, so any write attempt fails loudly;
4. no sibling temp file appears in the staging directory (`readdir` before/after).

Windows: `chmod` is a no-op, so the check is (1), (2) and (4) only; the POSIX job owns (3).

---

## 12. Hostile-input fuzz floor

`fuzz-01`: take `fmt-01` bytes and apply N = 200 seeded single-byte and small-range mutations
(no shrinking, no corpus, no external fuzzer). For each mutant assert:

- the process does not throw an uncaught exception;
- wall time ≤ 2 s;
- exactly one envelope is produced, and it is valid JSON;
- if `status !== "failed"`, then `completeness.dropped === 0` and every diagnostic code is a
  member of the closed enum;
- the original `fmt-01` bytes are untouched afterwards (immutability applies to fuzzed runs too).

The floor is a floor: it exists to catch crashes, hangs and untrusted text leaking into trusted
fields. It is not a correctness oracle, so it must not assert a specific shape.

---

## 13. CI mapping

Proposed jobs (no CI file exists yet; `package.json` scripts are Phase 2 work):

| Job | Runner | Command | Notes |
|---|---|---|---|
| `typecheck` | ubuntu, node 22 + 24 | `pnpm typecheck` (`tsc --noEmit`) | `strict` + `noUncheckedIndexedAccess` |
| `test` | ubuntu, node 22 + 24 | `pnpm test` (`vitest run`) | All levels; ~60 s budget |
| `test-windows` | windows, node 24 | `vitest run immutability fixtures` | Line endings, mtime granularity, path handling |
| `build` | ubuntu, node 24 | `pnpm build` | Proves the package compiles as ESM |
| `fixture-policy` | ubuntu | `git ls-files '*.a5er'` must be empty; `git check-ignore` on every `*.a5er.txt` must report nothing | Guards the confidentiality rule (G-8, G-9) |
| `no-update` | ubuntu | `git diff --exit-code` after `vitest run` | Fails if anything rewrote an expected file |

Node 22 is the floor from `architecture.md` §15; node 24 is the local development version and is
included to catch runtime drift early. macOS is not a CI target in v1 (`TBD-T3`).

---

## 14. Phase 2 exit criteria

Each stage from `architecture.md` §18 advances only when its tests pass. "Green" below always
means the gates in §10, not just "the suite ran".

| Stage | Exit criteria |
|---|---|
| 1 · Fixtures | Catalog complete: every ID in §4 exists, is tracked, has a documented purpose; `fmt-01` and `fmt-02` carry `IndexInfo` and legacy `Index` respectively; G-8/G-9 pass; expected envelopes exist for all snapshot fixtures; the local real-export run (§3.8) passes and its output is recorded in the stage notes |
| 2 · `io` + `decode` | §5 rows 1–4, 11, 12, 14, 15, 16 green, plus `enc-05`, `hst-05`, `res-01`–`res-03`; immutability passes on POSIX and Windows |
| 3 · `syntax` + `schema` | §5 rows 5–10 green, plus every P3/P4/P7/P8 row in §6; `dropped === 0` on all parsed fixtures; L1 splitter suite covers the full escape table |
| 4 · `model` + `resolve` | §5 rows 6–8, 13 green, plus `val-06`, `val-09`, `sem-02`, `sem-03`, `sem-05`–`sem-07`, `sem-11`; T5/T6 span properties pass on every envelope |
| 5 · `validate` | Row 13 emits exactly the three `V_DANGLING_*` codes; `sem-08`, `sem-09` exit 3 under `validate` and 0 under `inspect`; G-2 holds everywhere |
| 6 · `json` | Envelope frozen at `contractVersion 0.1.0`: all expected files regenerated once and reviewed; §7 T7 passes; G-3 shows every non-fatal code exercised |
| 7 · `cli` | `inspect` end-to-end on `fmt-01`; stdout is JSON only, stderr carries prose; exit codes 0/1/2/3 asserted; `imm-01` covers every shipped command |

Stage 1 gates all others (`parser-evaluation.md` §6 blocker). No stage may pass its fixtures by
adding a temporary silent skip — G-1 is precisely the check that would catch it.

---

## 15. Gaps found while writing this strategy

These are decisions the taxonomy or the architecture does not yet answer. They are **not**
resolved here; the listed fixtures assert the structural behaviour and leave the diagnostic
assertion until Phase 2 owns the decision.

| ID | Gap | Affected fixtures | Interim assertion |
|---|---|---|---|
| G1 | Defaulted values (`UsingCommonColumns`) are supposed to emit an `info` diagnostic (`architecture.md` §4.2) but no code exists for it | `sem-07` | Assert `origin === "defaulted"` and value `1`; no code assertion |
| G2 | Case-insensitive uniqueness of page, domain and common-column names has no code (`V_DUPLICATE_OBJECT_NAME` is `PName`-only) | none yet | Deferred; add a fixture once a code exists |
| G3 | Mixed line endings have no code, and the format defines none (U4) | `hst-05` | Assert **no** diagnostic; a new code would be a taxonomy change |
| G4 | `E_TRUNCATED_INPUT` requires an IO seam (injectable reader) to test without racing; `architecture.md` does not define one | `res-02` | Requires the seam; if the seam is rejected, the fixture is deleted and the code becomes untestable-by-design |

| TBD | Point | Effect on tests |
|---|---|---|
| TBD-T1 | Coverage percentage gate | Reported only in v1 |
| TBD-T2 | When guard tests G-4/G-5 become lint rules | Requires a linter decision |
| TBD-T3 | macOS / other runners | Not a target in v1 |
| TBD-O2 | Streaming threshold | `res-03` uses injectable limits, so no large fixture is needed |
| TBD-O3 | Final limit defaults | Tests override limits per case; defaults are asserted once, in a config test |
| TBD-O6 | `--ast` flag | AST assertions go through the library API, not the CLI |

---

## 16. Non-goals

- Coverage percentages as a merge gate (G-1..G-9 carry the load instead).
- Performance benchmarks, memory profiling, or comparisons with the evaluated parsers.
- Fixtures derived from real exports; the repository holds synthetic data only.
- Testing DDL generation, drawing, or constraint-name templates (they are not modelled: D7, F9).
- Mutation testing, contract testing against a running service, or browser/E2E testing.
- Testing the npm packaging or publish path before the package is taken off `private: true`.
