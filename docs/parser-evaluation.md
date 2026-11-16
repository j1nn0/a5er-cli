# `.a5er` parser evaluation — build, borrow, or depend

Phase 1 investigation output. **Docs only:** no parser, CLI, or dependency change in this
unit. No third-party source was copied into this repository; the published npm tarball was
inspected and executed in a throwaway directory outside the repo.

Question: for a read-only `.a5er` CLI that must never silently invent or discard schema
information, is the parser best (A) taken as a dependency, (B) forked, or (C) written from
the specification?

---

## 1. Baseline

### 1.1 The format reference

All format claims in this document are resolved against the v2.21 specification identified in
`docs/format-coverage.md` §1:

`https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.jpn.md?` · 51,038 bytes ·
506 lines · `sha256 760e78fbbfe88fd33522989ebb31cacea6a7d66525218f24785f06f49db1de5e` ·
FORMAT 21. Sections are cited by title (v2.21 repeats the number `3.1.2`).

Section titles used as anchors below, with the line numbers reported against that copy:
`ヘッダコメント` (§2, lines 77–116) · `ER図全体のグローバルな設定` (§3.1) ·
`ページ設定(複合値)` / `ドメイン設定` (§3.1.2) · `共通列設定` (§3.1.3) ·
`[Entity]` (§4.1, lines 284–311) · `Field` (§4.1.1, line 312) ·
`IndexInfo` (§4.1.2, line 330) · `Position` (§4.1.3) · `[Relation]` (§4.2) ·
`[View]` (§4.3, line 395) · `[Subtype]` (§4.4) · `[Shape]` (§4.5) · `[Line]` (§4.6) ·
`[Comment]` (§4.7) · escape table (§1.2, lines 57–76).

Two spec facts decide most of the comparison, so they are stated once:

- **`IndexInfo` is the canonical index construct** — `"name",uniqueFlag,"col,col","option"`,
  `uniqueFlag` ∈ {0 non-unique, 1 unique, 2 unique-constraint} (`IndexInfo`, line 330).
- **`Index` is a legacy compatibility key** the v2.21 spec says may be ignored (`[Entity]`,
  line 309); its payload format **is not documented by v2.21**. The shape is only visible in
  the auxiliary v2.20 edition (`Index=users_ix1=0,user_name,birthday`) and in third-party
  code.
- **`[View]` has no `Field`**; it has `Query`, `LNameByComment`, `MaterializedView`
  (`[View]`, line 395).

### 1.2 The bar being measured against

From `README.md` (project values): accuracy first — *never silently invent or discard schema
information*; read-only; traceability to the original file; machine-readable output;
portability; and explicit goals to *preserve source information*, *report unsupported
constructs*, and *validate file structure and reference consistency*. The structural
requirements that follow from the format itself are `docs/format-coverage.md` §4, F1–F10.

---

## 2. Target A — `takuyaw-w/a5sql-mcp`

### 2.1 Identity & packaging

| Item | Value |
|---|---|
| Repository | `takuyaw-w/a5sql-mcp` (GitHub API: created 2026-06-25, last push 2026-07-13, 1 star, 0 forks, 0 open issues) |
| Language / layout | TypeScript, ESM, pnpm workspace (`packages/parser`, `packages/core`, `packages/cli`) |
| Parser package | `@takuyaw-w/a5sql-mcp-parser@0.9.9` (npm `latest` at evaluation time, published 2026-07-03) |
| Runtime dependencies | **none** (`versions.0.9.9.dependencies = null`) |
| Tarball | 50,488 bytes, 14 files (`dist/`, `LICENSE`, `package.json`) |
| Public API | `parseA5erIni`, `parseComplexValue`, `parseSqlStatements`, types |
| Parser size | `packages/parser/src/index.ts` = 375 lines; `types.ts` = 1,446 bytes |
| Sibling package | `@takuyaw-w/a5sql-mcp-core@0.9.9` (same licence, depends on parser 0.9.9) |
| Licence | MIT, `Copyright (c) 2026 takuyaw-w` |

### 2.2 Aspect summary

| Aspect | Finding | How verified |
|---|---|---|
| **Features** | Line-oriented INI scanner: split on `\r?\n`, trim, drop blank and `#` lines, match `^\[([^\]]+)]$`, accumulate `key -> string[]` per section. `parseHeader()` regexes `# A5:ER FORMAT:<n>` / `# A5:ER ENCODING:<x>`. Section filters map `Entity`/`View` → tables and `Relation`/`Relationship` → relationships. `parseComplexValue()` is a hand-written quoted-CSV tokenizer implementing the spec escape table. `parseScalar()` coerces numeric tokens to numbers. | source read + execution of the published tarball |
| **Coverage** | 4 distinct object types read (Entity, View, Relation/Relationship alias, plus Manager); `[Subtype]`, `[Shape]`, `[Line]`, `[Comment]` not read at all. Canonical `IndexInfo` **not read at all, no warning**. `Field` parts 0–6 and 8 only. `[View]` returns `columns: []` and drops `Query`. 10 of the 16 current `[Entity]` keys dropped. Per-section matrix in 2.3. | probe: `indexes: []` with `warnings: []` |
| **Unknown retention** | `[Manager]` retained **wholesale** as `Record<string, unknown>` — unknown Manager keys survive. Everything else: a **key whitelist**. `parseSections()` keeps every key internally but does not export it, and the public `ParsedA5erDocument` has no raw-section field, so an unknown Entity/View/Relation key is unrecoverable through the API. Unknown **sections** are discarded in the filter and never reported — documented policy in `README.md` line 475 (「未知セクションは無視します」), with a test asserting that `[Memo]` produces no warning. | source + tests read |
| **Skipped-construct reporting** | **Partial and whole-document scoped.** It has a warning taxonomy and reports malformed/unrecognised *documents*, but it does **not** report per-construct skips: no warning is emitted for a missing `IndexInfo`, an ignored `[Shape]`, or a dropped `Field` element. | probe: `IndexInfo` → `indexes: []`, `warnings: []` |
| **Traceability** | **None.** No line numbers, byte offsets, or section spans in `ParsedA5erDocument`, `ParsedA5erTable` or `ParsedA5erColumn`. (`packages/core/src/locations.ts` is A5:SQL *install-directory* discovery — `%APPDATA%\A5M2`, Wine paths — not source positions.) Adding spans would require re-tokenising. | `types.ts` read |
| **Encoding** | The published **parser package decodes nothing**: it takes an already-decoded `string` plus `options.fileEncoding`, and merely *compares* the header-declared encoding to the caller-supplied one (`a5er_encoding_mismatch`). Real decoding lives in the sibling `core` package: UTF-8 BOM → utf-8, UTF-16LE BOM → utf-16le, a UTF-16LE heuristic, binary sniffing (>10% NUL in the first 4 KiB), truncation-aware streaming decode, and the fallback chain `utf-8 (fatal)` → `shift_jis` (rejected if it yields U+FFFD) → `utf-16le` → `utf-8-lossy`. **Heuristic-first, header-validated** — a file declaring `ENCODING:SJIS` that decodes as UTF-8 still parses, with a warning rather than a retry using the declared codec. | `text.ts` read |
| **Tests** | 15 `it()` cases in a 352-line `a5er.test.ts`, plus `sql.test.ts` and a core suite; CI on Ubuntu **and** Windows, Node 24, format:check → lint → build → test → typecheck → draft-syntax:check. Genuine coverage of escapes, hostile text, truncation, encoding mismatch, lossless scalars. **No test asserts that an `IndexInfo` line is parsed**, and none covers `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` — consistent with the implementation, so the suite is honest but scoped to what is supported. | test file read |
| **Licence / reuse** | MIT. Reuse obligations: preserve the copyright notice and permission text in copies or substantial portions; note modification if forked. No copyleft, no patent or trademark complications. Zero runtime dependencies means no transitive licence surface. | `LICENSE` |
| **Maintenance** | Active in bursts: 13 versions shipped 2026-06-25 → 2026-07-03; `main` HEAD 2026-07-13 contains unreleased 0.10.0–0.10.3 work. **0 issues ever, 0 PRs, 1 star, 0 forks** → maintainer responsiveness is *unknown*, not proven good. Development is agent-driven with heavy process (46 KB `ROADMAP.md`, 30+ plan/spec docs), versioned in lockstep across three packages → high structural churn. `ROADMAP.md` concedes real-variant fixture coverage is incomplete. | repo + npm metadata |

### 2.3 Spec coverage matrix

| Spec construct | Handled | Evidence |
|---|---|---|
| Header `FORMAT` / `ENCODING` | ✅ reported as `formatVersion` / `encoding` | `parseHeader()` |
| `[Manager]` — all keys | ✅ retained wholesale | probe: supplied keys all returned |
| `PageInfo` / `DomainInfo` / `CommonField` | ✅ complex-split into arrays | probe output |
| `[Entity]` `PName` / `LName` / `Comment` | ✅ | `parseTable()` |
| `[Entity]` `Field` | ⚠️ parts 0–6 and 8 only; **part 7 (colour) and part 9 (`DISABLE`) dropped** | probe: `option` present, no colour, no additional option |
| `[Entity]` **`IndexInfo`** (canonical) | ❌ **not read at all, and no warning** | code calls `all(section, "Index")` only; probe: `indexes: []`, `warnings: []` |
| `[Entity]` legacy `Index` | ✅ parsed as `name=unique,col,col` | probe: `[{name:"t1_ix1",unique:true,uniqueType:1,columns:["a","b"]}]` |
| `[Entity]` `TableOption`, `TableInnerOption`, `NoDDL`, `UsingCommonColumns`, `EffectMode`, `Tag`, `Color`, `BkColor`, `ModifiedDateTime`, `ZOrder` | ❌ all dropped, no warning | probe: table object keys are exactly `objectType,name,physicalName,logicalName,comment,columns,indexes,positions` |
| `Position` (Entity) | ✅ page/x/y/width/height | `parsePosition()` |
| `[Relation]` `Entity1/2`, `Fields1/2`, `RelationType1/2`, `Caption`, `PName` | ✅ | `parseRelationship()` |
| `[Relation]` `Position`, `Dependance`, `LineMode`, `Bar1–3`, `TermPos1/2`, `ZOrder` | ❌ dropped | `parseRelationship()` return shape |
| `[View]` | ⚠️ returns `objectType:"view"`, but `columns` is always `[]` and **`Query` is dropped** | `[View]` (line 395) vs `parseTable()` using `all(section,"Field")` |
| `[Subtype]` / `[Shape]` / `[Line]` / `[Comment]` | ❌ ignored silently | probes: none of them appear in output |
| Any unknown section (e.g. `[Memo]`) | ❌ ignored **by documented design**, no warning | `README.md` line 475; test asserting exactly 2 warnings where `[Memo]` yields none |
| Escape table (`\\`, `\Q`, `\q`, `\t`, `\n`) | ✅ spec-exact, including passthrough of unknown escapes | `parseComplexValue()` + tests |

Recorded tally: **5 of 8 section names** (counting `[Relation]` and `[Relationship]`
separately, plus `[Manager]`); **≈3.5 of 8 object-section types**; 1 of 6 schema-carrying
`[Entity]` metadata keys; canonical index construct unimplemented.

### 2.4 Defects that matter to this project

1. **Canonical index data is lost silently.** Not a limitation that surfaces — an
   `IndexInfo` line produces empty `indexes` **and** an empty `warnings` array. For a tool
   whose stated job includes validating index/PK/FK consistency, this fails the primary
   principle before the first command is written.
2. **Ten `[Entity]` keys are dropped** (`TableOption`, `TableInnerOption`, `NoDDL`,
   `UsingCommonColumns`, `EffectMode`, `Tag`, `Color`, `BkColor`, `ModifiedDateTime`,
   `ZOrder`) — so DDL-generation flags and tagging cannot be validated or inspected.
3. **`Field` parts 7 and 9 are dropped**, i.e. column colour and the `DISABLE` marker
   (`docs/format-coverage.md` P7).
4. **`[View]` loses `Query`** and reports `columns: []`, which is indistinguishable from a
   genuinely column-less view.
5. **Unknown-section skipping is policy, not oversight** — the opposite of "report
   unsupported constructs". Reporting cannot be layered on top of a parser that has already
   discarded the evidence.
6. **No source locations**, so "traceability to the original file" cannot be added without
   re-tokenising.
7. **The published version corrupts numbers silently.** Verified on the 0.9.9 tarball:
   a `Field` default of `17777777777777777777` comes back as `…79000` and `0012.50` comes
   back as `12.5` — precision and leading/trailing zeros destroyed with no diagnostic. The
   bigint/decimal fix exists only on unreleased `main` (0.10.x); leading zeros are still
   unaddressed there.

Genuine strengths worth naming, because they are the two ideas worth keeping: the
**warning taxonomy with an untrusted-details split** (`warnings: string[]` of trusted codes
plus `warningDetails` carrying hostile file values out of the trusted array), the
**fail-closed truncated-source behaviour** (`parser: "not-attempted"` rather than a partial
schema), wholesale `[Manager]` retention, and a spec-exact escape table.

### 2.5 Version drift (decisive for option A)

`npm latest` = 0.9.9 (2026-07-03). The repository `main` (2026-07-13) contains 0.10.0–0.10.3
work — lossless scalars among them — but **none of it is published**. Choosing A means
either shipping the known-lossy release or pinning to an unpublished git state. `ROADMAP.md`
lists "parser fidelity" as later-phase work, and a search of `README.md`, `ROADMAP.md`,
`AGENTS.md` and the design docs found **zero occurrences of `IndexInfo`, `Subtype`, `Shape`,
`[Line]`, `[Comment]`** — the parser was scoped from the keys it needed, not from the spec's
section list. Fidelity gaps are structural, not a queue item.

---

## 3. Target B — `pengent-ai/pengent-a5er-tools`

### 3.1 Identity & packaging

| Item | Value |
|---|---|
| Repository | `pengent-ai/pengent-a5er-tools` |
| Description | 「A5:ER Mk-2(.a5er)形式のER図ファイルをプレビュー・解析・JSON変換できるツール群」 |
| Created / last push | 2025-06-14 / **2025-06-14** |
| Commits | **9, all on 2025-06-14**, from `初期構築コード` to `release0.0.1`; no tags |
| Version | `0.0.1` |
| Kind | **VS Code extension** (`main: ./out/extension.js`, `engines.vscode ^1.101.0`) — no `exports`, no `files`; not a library |
| On npm? | **No** — `registry.npmjs.org/pengent-a5er-tools` → HTTP 404 |
| Licence | MIT ×2, conflicting files: `LICENSE` = "Copyright (c) 2024 PengentAI"; `LICENSE.md` = "Copyright (c) 2025 Ryota Yamafuji (PengentAI)" |
| Stars / forks / issues | 0 / 0 / 0 |

### 3.2 Aspect summary

| Aspect | Finding | How verified |
|---|---|---|
| **Features** | Two independent, divergent parsers in one repo: `src/a5er-converter.ts` (10,412 bytes, `a5erToJson()` / `jsonToA5er()`, section-by-section `switch` on key name) and a **second inline parser** inside `generatePreviewHtml()` in `src/extension.ts` (36,889 bytes) using `line.substring(8)`, `line.startsWith('Field=')`, `line.substring(4).split(',')`. No shared module, no shared tests. Also trims/parses with `split('=', 2)`, which **truncates at the second `=`** — any value containing `=` is silently cut. | source read; mechanics replicated in node |
| **Coverage** | 3 section types (`Manager`, `Entity`, `Relation`). **No index parsing at all** (`Index` or `IndexInfo`). **No `[View]` branch.** `[Relationship]` alias not recognised. `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` ignored. No escape decoding anywhere. Header `FORMAT`/`ENCODING` never read. Matrix in 3.3. | source read |
| **Unknown retention** | **None.** No raw retention, no warnings, no parse status. Every unrecognised key or section falls into a `switch` default and disappears with no diagnostic; there is no way for a caller to learn anything was discarded. | source read |
| **Skipped-construct reporting** | **None at any level** — neither per-construct nor whole-document. | source read |
| **Traceability** | None. No source locations of any kind. | source read |
| **Encoding** | **None.** `a5erToJson(content: string)` assumes the caller decoded. The project's own script hardcodes `fs.readFileSync('../docs/sample.a5er', 'utf-8')`; the sample starts with `\uFEFF`, unstripped but harmless because it lands on a `#` line. No Shift_JIS / CP932 / UTF-16 support despite this being a Japanese-market tool where Shift_JIS exports exist. | source read |
| **Tests** | **No real tests.** `src/test-converter.ts` is a `console.log` script that reads a sample, writes JSON and `.a5er` files, and catches errors with `console.error` — it exits 0 even on failure and has no assertions. `src/test/extension.test.ts` is the untouched VS Code yeoman scaffold (`assert.strictEqual(-1, [1,2,3].indexOf(5))`). `npm test` runs `vscode-test`. | both files read |
| **Fixture quality** | `docs/sample.a5er` (4,063 bytes) has 19 `Field=`, 4 `[Entity]`, 3 `[Relation]` — and **zero `Index` and zero `IndexInfo` lines**; no `[View]`, no `[Subtype]`. Index parsing is not exercised even incidentally. | sample read |
| **Licence / reuse** | MIT either way, but two conflicting notices. Reuse would mean **copying source** (there is no package to depend on) and citing `LICENSE.md`, the newer file, while noting the discrepancy. | both files read |
| **Maintenance** | **Abandoned.** Nine commits on one day, nothing for ~17 months at evaluation time; v0.0.1; `CHANGELOG.md` promises 0.1.0/0.2.0 features never started, and its date predates the repo. `README.md` claims it "Preserves all metadata including … Default values and comments" — demonstrably false (3.4). Reactivation probability near zero; treat as read-only reference material. | repo metadata |

### 3.3 Spec coverage matrix

| Spec construct | Handled |
|---|---|
| Header `FORMAT` / `ENCODING` | ❌ not read (hardcodes `FORMAT:13` on write) |
| `[Manager]` `ProjectName`, `Author`, `RDBMSTypeName` | ✅ only these three |
| `[Manager]` `PageInfo`, `DomainInfo`, `CommonField`, header/footer, DDL keys | ❌ dropped |
| `[Entity]` `PName`, `LName` | ✅ |
| `[Entity]` `Comment` | ❌ dropped |
| `[Entity]` `Field` | ⚠️ logical/physical/type/NOT NULL read; **default and comment wrong**; colour, option and additional option dropped |
| `[Entity]` `IndexInfo` **or** `Index` | ❌ **no index parsing at all** |
| `[Entity]` `TableOption`, `TableInnerOption`, `NoDDL`, `Tag`, `Color`, `BkColor`, `ModifiedDateTime`, `EffectMode`, `UsingCommonColumns` | ❌ dropped |
| `[Entity]` `ZOrder` | ⚠️ used only as a section terminator; the value is discarded |
| `[Entity]` `Position` | ❌ not read; legacy `Left`/`Top` are read instead; width/height never populated |
| `[Relation]` `Entity1/2`, `Fields1/2` | ⚠️ raw; the preview parser does `replace(/"/g,'').split(',')`, so commas inside names break the mapping |
| `[Relation]` `RelationType1` | ❌ hardcoded to `'1:N'` (`// リレーションタイプの変換は後で実装`) |
| `[Relation]` `RelationType2`, `Position`, `Caption`, `PName`, `Dependance`, `LineMode`, `Bar1–3`, `TermPos1/2` | ❌ dropped |
| `[View]` | ❌ **no branch at all** |
| `[Relationship]` alias | ❌ not recognised (only `'Relation'`) |
| `[Subtype]` / `[Shape]` / `[Line]` / `[Comment]` | ❌ ignored |
| Escaping (`\\`, `\Q`, `\q`, `\t`, `\n`) | ❌ no escape decoding anywhere |

Recorded tally: **3 of 8 section names**; index support absent entirely; `Field` default and
comment systematically wrong.

### 3.4 The `Field` mis-mapping, and why it matters

Replicated against a real spec-shaped line:

```
Field="ユーザーID","id","@INTEGER","NOT NULL",0,"","ユーザーのユニークID",$FFFFFFFF,""
quoted matches: ["ユーザーID"],["id"],["@INTEGER"],["NOT NULL"],[""],["ユーザーのユニークID"],[""]
```

Because `"NOT NULL"` is itself quoted, the quoted-substring list is **shifted by one**
relative to the spec's positional order
(`論理名, 物理名, データ型, NOT NULL, キー順, デフォルト値, コメント, 色, オプション, 追加オプション`):

- `matches[3]` (the NOT NULL constraint) is assigned to `default` → **every NOT NULL column
  gets `default: "NOT NULL"`** and loses its real default;
- `matches[4]` (the true default) is assigned to `comment` → comments are lost too.

Related defects: `pk = parts[4].trim() === '0'` makes only a single-column primary key's
first column a key (a composite-PK member with `keyOrder=1` reads as `pk = false`), and
`type: typeStr.replace('@','')` strips the system-domain marker, erasing the distinction the
spec draws between a real type and `@INT`-style system domains.

Also decisive in the other direction: `jsonToA5er()` is a **writer** that emits
`# A5:ER FORMAT:13`, a fixed `[Manager]` block, a fixed
`ModifiedDateTime=20250613055042` and fixed `Bar1/2/3` values — it fabricates metadata on
round-trip, so it is unusable in a read-only tool even as a reference for output shape.

---

## 4. Head to head

| Dimension | A — `a5sql-mcp` | B — `pengent-a5er-tools` |
|---|---|---|
| Distributable as a dependency | ✅ npm `@takuyaw-w/a5sql-mcp-parser@0.9.9`, zero runtime deps | ❌ not published; VS Code extension only |
| Section types handled | 5 of 8 section names incl. `[Manager]`, `[Relationship]` alias | 3 of 8 |
| Canonical `IndexInfo` | ❌ unimplemented, silent | ❌ unimplemented |
| `Field` 10-part fidelity | ⚠️ 8 of 10 parts (colour + additional option lost) | ❌ default and comment mis-mapped |
| `[View]` `Query` | ❌ dropped | ❌ section unsupported |
| Skipped-construct reporting | ❌ ignored **by documented policy** | ❌ ignored, no diagnostics at all |
| Raw / unknown key retention | ⚠️ `[Manager]` only | ❌ none |
| Source line/offset traceability | ❌ none | ❌ none |
| Encoding | ✅ good decoding, but in the sibling `core` package; heuristic-first | ❌ none |
| Scalar fidelity | ⚠️ lossy in 0.9.9; fixes unreleased | ❌ lossy |
| Tests | ✅ 15 focused unit tests, CI on 2 OSes | ❌ none (scaffold + file-writing script) |
| Last activity | 2026-07-13 | 2025-06-14 |
| Reuse friction | zero (npm) or carry one `LICENSE` (fork) | copy source + reconcile two licence files |
| Escape-table implementation | ✅ spec-exact | ❌ none |
| Overall as our input | **reference / skeleton-grade** | **read-only cautionary reference** |

**The shared blind spot is decisive: neither reads `IndexInfo`, the canonical index
construct, and neither reports that it skipped it.** A5:SQL Mk-2 2.21 writes `IndexInfo`; both
projects validate against fixtures that contain only the legacy `Index` key (A) or no index
line at all (B). Neither retains unknown keys beyond A's `[Manager]` map, so any information
either drops is unrecoverable by the caller.

---

## 5. Explicitly unconfirmed

| # | Item | Status |
|---|---|---|
| U1 | Whether real 2.21 exports always emit legacy `Index` **alongside** `IndexInfo` (which would make A's behaviour partially safe by accident) | Unverified — no real export was available. This is the single most consequential open question. |
| U2 | Whether npm `latest` has moved past 0.9.9 since the probe | Unverified over time; the pin, tarball hash and behaviour above were observed at evaluation time. Re-check before relying on it. |
| U3 | A's unpublished `0.10.x` behaviour | Observed only via `main` source and release notes; never executed. Not treated as available. |
| U4 | B's behaviour under the VS Code host | Inferred from source and by replicating its parsing code in node; the extension itself was not launched. |
| U5 | Real-world prevalence of `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` | Unknown; both targets ignore them, so no third-party evidence exists either way. |
| U6 | Whether either project has been exercised against a spec-conformant export | No evidence found for either. Both fixture sets are synthetic and non-conformant on `IndexInfo`. |

No item in §2 or §3 is inferred from marketing text; claims trace to source files, the
published tarball's runtime behaviour, or repository metadata. Anything not so traced is
listed above.

---

## 6. Options and verdict

### A — use an existing parser as a dependency

Take `@takuyaw-w/a5sql-mcp-parser@0.9.9` (plus `@takuyaw-w/a5sql-mcp-core@0.9.9` for
decoding) and map its output onto our JSON.

**Pros** — days rather than weeks; MIT; zero runtime deps; ESM; a typed document model; an
already-solved encoding story (BOM handling, UTF-16LE heuristic, binary sniffing,
truncation-aware decode, Shift_JIS fallback) which is the hardest non-parsing part; a ready
warning-taxonomy design; fail-closed truncation behaviour that matches our stance.

**Cons — each one is a stated project goal**
- `IndexInfo` silently lost: fails "never silently discard schema information" and makes
  index/PK/FK consistency validation impossible.
- 10 of 16 `[Entity]` keys dropped, so `validate` cannot check DDL flags or tags and
  `inspect` under-reports.
- `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` ignored **by documented design** — the inverse
  of "report unsupported constructs", and unfixable without replacing the parser, because
  the evidence is already discarded.
- Zero source locations in the types: the traceability differentiator cannot be retrofitted.
- `[View]` loses `Query` and reports `columns: []`.
- The published release silently corrupts bigint/decimal defaults; the fix is unreleased.
- Couples us to one maintainer's schema and cadence across three lockstep packages at
  0.9.x, with high structural churn.

**Verdict: unacceptable as the foundation** — accuracy, traceability and unsupported-construct
reporting are all below the bar, on axes the project treats as non-negotiable.

### B — fork / extend the `a5sql-mcp` parser

Vendor `packages/parser/src/index.ts` and `types.ts`, then add `IndexInfo`, the remaining
`[Entity]` keys, `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]`, unknown-section reporting, and
source spans.

**Pros** — small, readable, dependency-free starting point (375 LOC + 15 tests) with a
spec-correct escape table and an INI scanner already hardened against hostile and truncated
input; MIT permits it with only the notice obligation; existing tests become a day-one
regression harness.

**Cons** — **we would rewrite the file anyway**: adding line/offset to every node changes
the section type, `parseSections()` and every `parse*` signature; adding raw retention
changes the document type; adding unknown-section reporting changes the section filter. What
survives is the escape/tokenizer logic — roughly 80 of 375 lines. We would also inherit the
design decisions we reject (key whitelisting, silent section skipping, an untyped
`manager: Record<string, unknown>` escape hatch with no provenance), plus a permanent
upstream-divergence tax: porting fixes becomes manual and unbounded, and there is a real risk
of inheriting the `Index`-for-`IndexInfo` misreading as "already done".

**Verdict: viable but Pareto-inferior** — most of C's labour, plus permanent divergence, for
~80 useful lines.

### C — spec-based original parser

Build from the v2.21 specification with an explicit AST.

**Pros** — the only path that satisfies the stated principles by construction: lossless
string handling with coercion only where the spec types a field; per-node source spans emitted
from line 1 (cheap in a fresh line-oriented scanner, impossible to retrofit into A); an
explicit `unsupportedSections[]` / `unsupportedKeys[]` surface with counts and locations,
which is precisely the feature both targets lack; genuine version awareness where
`docs/format-coverage.md` F2 says formats changed. Scope is small: INI sections, one
quote-aware complex tokenizer, ~8 section structs. No licence obligations, no upstream
coupling, and no temptation to accept the legacy `Index` key as a substitute for `IndexInfo`.

**Cons** — we must write our own hostile-input hardening, encoding layer and fixtures; the
highest up-front cost; `validate` and `inspect` land later than under A; and we risk our own
spec misreads.

**Verdict: C** — the right foundation for this project.

### Chosen: C, with two ideas borrowed by reimplementation

1. **Reimplement (do not copy)** two things learned from A, from observed behaviour rather
   than from its source: (a) the **warning taxonomy split** — trusted codes in a `warnings`
   array, untrusted file values in a separate `details` list, so hostile file content can
   never masquerade as a trusted code; (b) the **encoding probe order** — strict UTF-8 first,
   then `shift_jis`, then `utf-16le`, every candidate decoded with `fatal: true` and rejected if
   it yields U+FFFD. No lossy step is reimplemented: a file no candidate decodes is fatal
   (`E_UNDECODABLE`), never mojibake.
   Both are roughly 50–150 LOC to reimplement, which removes the attribution and divergence
   question entirely.
2. **Do what neither target did**: make `IndexInfo` the canonical index source; keep
   `Index` / `IndexOption` as explicitly labelled legacy fallbacks that **warn when they are
   the only index data present**; and emit `unsupported` entries for
   `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` in v1 (supporting them later is a clean
   increment).
3. **Reject A and B as the foundation.** A fails three of the project's five stated
   principles and ships a release with silent numeric corruption; B costs ~85% of C's work
   and buys a permanent divergence tax.

**Licence note (not triggered in this unit).** No third-party code was copied: this
repository currently contains no parser. If any code is ever copied from `a5sql-mcp`, MIT
requires preserving `Copyright (c) 2026 takuyaw-w` and the permission text, and noting the
modification. Nothing in this Phase 1 unit does so.

**Real exports are a pre-release gate, not an entry condition.** Implementation starts from
spec-derived synthetic fixtures (`docs/test-strategy.md` §3.8). When **2–3 real, anonymised**
A5:SQL Mk-2 exports are available — ideally across FORMAT versions, one Shift_JIS, one carrying
`[Subtype]`/`[Shape]` — they are used for **local verification only**, after confidentiality is
confirmed, and are never committed. Compatibility with them is a **pre-release quality gate**;
without one the gap is stated and full compatibility is not claimed. The `Index` vs `IndexInfo`
question in §5 U1 is settled by that local verification whenever a file makes it observable.
Golden-output fixtures are authored after the serializer exists (§14 stage 6 of the test
strategy), so they cannot gate the start of parser work either.

---

## 7. Local implementation decisions

Taken now so that later implementation cannot drift into the failure modes observed in A and
B.

| # | Decision | Failure mode it prevents |
|---|---|---|
| L1 | **No untyped escape hatch.** Unknown data is retained in an explicitly typed raw-entry shape (section, key, raw value, source line), never as `Record<string, unknown>` on the public model. | A's `manager: Record<string, unknown>`: unknown data survives but with no provenance, no type, and no location — and only for one section. |
| L2 | **No ignored errors.** Every unsupported section, unsupported key, undecodable byte sequence, malformed row and truncated element produces a diagnostic record that appears in output. No bare catch, no silently dropped branch. | B's diagnostic-free `switch` default and A's `[Memo]`-yields-nothing policy. |
| L3 | **No lossy decoding.** The chain is strict at every step — `utf-8` → `shift_jis` → `utf-16le`, each with `fatal: true` and U+FFFD rejection; no lossy step exists, and an undecodable file is fatal (`E_UNDECODABLE`). Numbers are never re-coerced: raw text is always retained beside any typed value. | A's 0.9.9 `17777777777777777777` → `…79000` and `0012.50` → `12.5`, both silent. |
| L4 | **No illusory tests.** A test must assert a *value parsed from a fixture that actually contains the construct*. Count-only or "did not throw" assertions are not accepted as coverage. A fixture without an `IndexInfo` line cannot support any claim of index support. | A has no `IndexInfo` assertion at all; B has no assertions at all; both fixtures lack the canonical index key, so a green suite would have proven nothing. |
| L5 | **Synthetic-first; real exports are local verification only** (pre-release gate, never committed, never entry). | Both targets validated only against synthetic, non-conformant samples. |
| L6 | **Legacy keys warn.** When `Index` / `IndexOption` are the only index evidence under an older `FORMAT`, the reader still returns them, labelled legacy, with a warning. | The v2.21 "ignore legacy" instruction being read as permission to discard index data. |
| L7 | **Unsupported is a first-class output, not an omission.** `[Subtype]` membership, unknown `ShapeType`, and undefined vertex formats are reported as unsupported with their source locations. | A's silent `Subtype`/`Shape`/`Line`/`Comment` skip; B's silent everything. |
| L8 | **Copying carries the notice.** Any future code reuse from A must ship the MIT notice and a modification statement; reimplementation is preferred so the question does not arise. | Unattributed vendoring under a permissive licence. |

---

## 8. What would change this verdict

| Trigger | Effect |
|---|---|
| A publishes 0.10.x **with** `IndexInfo` support plus per-construct unsupported reporting | Re-open option A for the reader core (spans would still be missing). |
| Real exports show legacy `Index` is always emitted alongside `IndexInfo` | Narrows the legacy-decoder requirement (F2) but does not restore the dropped `[Entity]` keys or provenance. |
| A real export proves `[Subtype]` membership is derivable from an undocumented key | Re-open `docs/format-coverage.md` F7 and P13. |
| No anonymised fixtures can be obtained | Keep C, but label every parsing claim "spec-derived, unvalidated" and ship `inspect` with that caveat rather than implying verification. |
| A's upstream churn slows and it acquires external review | Reduces B's divergence tax; does not address the ~80-line residual value. |

---

## 9. Summary

Both existing parsers fall below the bar on the axes this project treats as non-negotiable.
A never reads canonical `IndexInfo`, silently drops 10 of 16 `[Entity]` keys plus `Field`
parts 7 and 9 and `[View]`'s `Query`, ignores `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]` by
documented policy, exposes no source locations, and its published release corrupts
bigint/decimal values. B is abandoned, unpublished, off-by-one on `Field`, and has no real
tests. **Neither reports what it skipped** — which is the one behaviour this project exists to
provide differently.

Chosen: **C**, a spec-based original parser, with two ideas reimplemented from A (trusted-code
/ untrusted-details warning split, and a diagnostic-emitting encoding fallback chain), with
real-export compatibility as a pre-release gate (local-only, never committed).
