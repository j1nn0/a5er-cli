# `.a5er` format coverage — A5:SQL Mk-2 v2.21 (FORMAT 21)

Phase 1 investigation output. **Docs only:** this unit writes no parser, no CLI, no fixtures.

Purpose: state, item by item, what the v2.21 format specification actually says, what a
reader must do to consume it, and which items are *confirmed* by the spec, *unconfirmed* by
it, or deliberately *not planned*. Every "parse work" entry below is a requirement on a future
implementation, not a description of existing code.

---

## 1. Source of record

| Property | Value | How verified |
|---|---|---|
| Human-facing page | `https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.html` | HTTP 200 but **1,127 bytes**: a JavaScript shell. The body is AJAX-injected via `marked()` from `var mdSource = "a5er_specification.jpn.md?"`. Not usable as source text. |
| **Actual spec payload** | `https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.jpn.md?` | HTTP 200, `content-type: application/octet-stream`, **51,038 bytes**, 506 lines |
| `sha256` | `760e78fbbfe88fd33522989ebb31cacea6a7d66525218f24785f06f49db1de5e` | re-fetched and hashed in this unit |
| Encoding / line endings | UTF-8, CRLF, 506 lines | byte inspection |
| Server metadata | `last-modified: Sun, 01 Feb 2026 11:49:20 GMT`, `etag: "697f3dc0-c75e"` | response headers |
| Title line | `# A5:SQL Mk-2 ER図ファイル形式仕様書 (Version 2.21系)` | first line of payload |
| Edition status | v2.21 is the **newest** published edition | site root publishes v2.21; `v2.19`, `v2.22`, `v2.23` → 404 |
| English edition | **none** | `a5er_specification.eng.md?` → 404; `a5er_specification.md?` → 404 |

Reproduce the identity block before trusting anything below:

```bash
curl -sS 'https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.jpn.md?' | shasum -a 256
# expect 760e78fbbfe88fd33522989ebb31cacea6a7d66525218f24785f06f49db1de5e
```

### 1.1 Auxiliary edition — never a substitute

| Property | Value |
|---|---|
| URL | `https://a5m2.mmatsubara.com/document/v2.20/a5er_specification.md?` (different filename convention: `.md?`, not `.jpn.md?`) |
| Size / hash | 52,942 bytes, `sha256 c0f0fc023e89f0350f74a99b768bc7e40edc15f94250f90ac46dbcde3b23b62c` |
| Status | **auxiliary only.** Used exclusively as delta material (what changed 2.20 → 2.21) and always tagged `[aux v2.20]` below. No `[aux v2.20]` statement is presented as v2.21 behaviour. |

### 1.2 Citation convention, and why

**Sections are cited by TITLE, not by number.** v2.21 uses the number `3.1.2` **twice**
(`ページ設定(複合値)` and `ドメイン設定`), so numbers are not unique identifiers; relative
references between editions also shift (`ドメイン設定` was `3.1.3` in `[aux v2.20]`).

Section map, titles as written:

`概要` (§1) · `基本構造` (§1.1) · `値のフォーマット` (§1.2) · `ヘッダコメント` (§2) ·
`[Manager]` (§3) · `ER図全体のグローバルな設定` (§3.1) · `ヘッダとフッタ文字列` (§3.1.1) ·
`ページ設定(複合値)` (§3.1.2) · `ドメイン設定` (§3.1.2, duplicate number) ·
`共通列設定` (§3.1.3) · `オブジェクトセクション` (§4) · `[Entity]` (§4.1) ·
`Field` (§4.1.1) · `IndexInfo` (§4.1.2) · `Position` (§4.1.3) ·
`[Relation]` / `[Relationship]` (§4.2) · `Position` (§4.2.1) · `[View]` (§4.3) ·
`[Subtype]` (§4.4) · `[Shape]` (§4.5) · `[Line]` (§4.6) · `[Comment]` (§4.7)

### 1.3 Scale of the document

147 documented key rows · 99 unique key names · 32 rows marked **必須** (required) ·
5 keys marked **複数指定可能** (repeatable) · 8 section names
(`[Manager]`, `[Entity]`, `[Relation]` ≡ `[Relationship]`, `[View]`, `[Subtype]`, `[Shape]`,
`[Line]`, `[Comment]`).

### 1.4 Classification vocabulary

| Label | Meaning | Consequence for a reader |
|---|---|---|
| **confirmed** | The spec states the syntax explicitly; a sample corroborates it. | Implement as written; test asserted on values. |
| **unconfirmed** | The spec is silent, recommends without requiring, or contradicts itself; no real export was available to settle it. | Implement conservatively (preserve raw, emit a diagnostic), and do **not** claim the behaviour is spec-defined. |
| **not-planned** | Real, but outside a read-only structural tool's job (rendering geometry, DDL constraint-name generation). | Carry raw values through; do not interpret. |

---

## 2. Coverage at a glance

| # | Point | Classification | Source of record |
|---|---|---|---|
| P1 | Header & version | **unconfirmed** (syntax confirmed; version-mismatch semantics absent) | `ヘッダコメント` (§2), `基本構造` (§1.1) |
| P2 | Encoding & BOM | **unconfirmed** (UTF-8+BOM expected; every other case unspecified) | `概要` (§1), `ヘッダコメント` (§2) |
| P3 | Section syntax & duplicates | **confirmed** (syntax) / **unconfirmed** (duplicate `[Manager]`, unknown sections) | `概要` (§1), `基本構造` (§1.1) |
| P4 | Key-value & duplicate keys | **confirmed** (the 5 repeatable keys) / **unconfirmed** (scalars) | `概要` (§1) |
| P5 | Quoting, commas, newlines, escaping | **confirmed** (byte-verified) | `値のフォーマット` (§1.2) |
| P6 | Table / view definitions | **confirmed** | `[Entity]` (§4.1), `[View]` (§4.3) |
| P7 | Column / data type / NULL / default | **confirmed** (with a real 9-vs-10 element trap) | `Field` (§4.1.1) |
| P8 | PK / index / constraint | **confirmed** (PK, index) / **not-planned** (DDL naming, CHECK) / **unconfirmed** (legacy `Index`) | `Field` (§4.1.1), `IndexInfo` (§4.1.2), `[Relation]` (§4.2), `[Manager]` |
| P9 | Relations & column mapping | **confirmed** (fields) / **unconfirmed** (arity, referential rules, vertices, page-case rule) | `[Relation]` / `[Relationship]` (§4.2), `Position` (§4.2.1) |
| P10 | Logical / physical name / comment | **confirmed** | `[Entity]` (§4.1), `[View]` (§4.3), `ER図全体のグローバルな設定` (§3.1) |
| P11 | Page / position / display info | **confirmed** (syntax) / **not-planned** (rendering geometry) | `ページ設定(複合値)` (§3.1.2), `Position` (§4.1.3) |
| P12 | Domain / shared column / auxiliary | **confirmed** | `ドメイン設定` (§3.1.2), `共通列設定` (§3.1.3), `[Subtype]`–`[Comment]` (§4.4–§4.7) |
| P13 | Unknown items & future versions | **unconfirmed** (principle stated, contract absent) | `基本構造` (§1.1) + legacy notes in §3.1, §4.1, §4.2, §4.3 |

Tally: **confirmed** — P5, P6, P7, P10, P12, plus the named slices of P3, P4, P8, P9, P11.
**unconfirmed** — P1, P2, P13, plus named sub-items in P3, P4, P8, P9, P11.
**not-planned** — rendering geometry (P11), DDL constraint-name generation (P8). Full
unconfirmed inventory in §5.

---

## 3. Item detail

### P1 · Header & version — **unconfirmed**

| Field | Value |
|---|---|
| Classification | unconfirmed: syntax confirmed, version-mismatch semantics absent |
| Primary source | `ヘッダコメント` (§2); `基本構造` (§1.1) |
| Spec definition | Two header comments: `# A5:ER FORMAT:<n>` (file format number) and `# A5:ER ENCODING:<enc>`. Both are **optional hints**: 「基本的にこれはコメントであるので、なくても問題ありませんが、A5:SQL Mk-2 では読み込み時に異なるバージョンで保存された形式であるかの判定や、ファイルエンコーディングの参考として使用されます」 — used only for version discrimination and as an encoding reference. `#`-prefixed lines are comments generally (§1.1), not only the header. |
| Version map (§2) | 2.1→1, 2.2→2, 2.3→3, 2.4→4, 2.5→4, 2.6→5, 2.7→6, 2.8→7, 2.9→8, 2.10→9, 2.11→10, 2.12→11, 2.13→12, 2.14→13, 2.15→14, 2.16→15, 2.17→16, 2.18→17, 2.19→18, 2.20→19, **2.21→21**. **FORMAT 20 is absent and unexplained.** |
| Spec silence | No defined reaction to a higher-than-known, lower-than-known, or missing FORMAT. `エラー` / `例外` / `未対応` occur **0 times** in the whole document. |
| Parse work | Read the leading comment block; match `^#\s*A5:ER\s*(FORMAT\|ENCODING)\s*:\s*(\S+)$`; retain FORMAT as an integer for gated dispatch (see F2); **never hard-fail** on an absent or unknown FORMAT. |
| Test cases | `FORMAT:21` baseline · `FORMAT:19` (a 2.20-era file) · no header at all · `FORMAT:20` (the hole) · `FORMAT:99` · BOM immediately before `#` · a `#` comment interleaved between two sections. |

### P2 · Encoding & BOM — **unconfirmed**

| Field | Value |
|---|---|
| Classification | unconfirmed: UTF-8 with BOM expected; all other behaviour unspecified |
| Primary source | `概要` (§1); `ヘッダコメント` (§2) |
| Spec definition | 「文字エンコーディングは **UTF-8 (BOM付き)** です。」 and 「ファイルエンコーディングは通常 **UTF-8 (BOM付き)** のみが使用されます。他のエンコーディングの使用は推奨されません。」 — "通常" + "推奨されません" is a strong recommendation, **not** a prohibition. The only documented `ENCODING` token is `UTF8`. |
| Spec silence | BOM-less UTF-8; Shift_JIS / CP932 legacy files (a real risk for a Japanese Windows tool); disagreement between `# A5:ER ENCODING:UTF8` and the actual bytes. Line endings are **never specified** (`行末`, `改行コード`, `CRLF` are 0 hits). |
| Parse work | Decode UTF-8 and strip a BOM; validate; on invalid UTF-8 emit a diagnostic instead of producing lossy mojibake; tolerate CRLF, LF, and CR. |
| Test cases | BOM + UTF-8 · UTF-8 without BOM · SJIS bytes under an `ENCODING:UTF8` header · CRLF file · LF file · mixed endings. |

### P3 · Section syntax & duplicate sections — **confirmed** (syntax) / **unconfirmed** (duplicates)

| Field | Value |
|---|---|
| Classification | syntax confirmed; duplicate `[Manager]`, missing `[Manager]`, empty sections, unknown `[Foo]`, and section-name case sensitivity all unconfirmed |
| Primary source | `概要` (§1); `基本構造` (§1.1) sample |
| Spec definition | 「INIファイルに似た構造」; objects are separated by `[セクション名]`. Eight section names; **`[Relation]` and `[Relationship]` are two names for one object**. A repeated section header starts a new object instance — not stated in prose, but demonstrated by the §1.1 sample (two `[Entity]` blocks) and implied by 「複数指定可能」. |
| Spec silence | `重複` (duplicate) and `上書き` (overwrite) are **0 hits**. |
| Parse work | Section-scoped buffers; normalise `[Relationship]` → `Relation`; preserve unknown sections verbatim **with a warning** (traceability, see §4 F6). |
| Test cases | two or more `[Entity]` · `[Relation]` and `[Relationship]` in one file · duplicate `[Manager]` · `[Unknown]` · section with no keys · `[entity]` lowercase · whitespace around a section header. |

### P4 · Key-value syntax & duplicate keys — **confirmed** (repeatable keys) / **unconfirmed** (scalars)

| Field | Value |
|---|---|
| Classification | confirmed for the five repeatable keys; unspecified for every other key |
| Primary source | `概要` (§1); `ページ設定(複合値)`, `ドメイン設定`, `共通列設定`, `Field`, `IndexInfo`, `Position` |
| Spec definition | 「各設定項目は `項目=値` のペアで表現され」 — no spaces shown around `=`, so split on the **first** `=` only (values legitimately contain `=`: `Query`, `TableInnerOption`, index options). Empty values are normal. Duplicate keys are **explicitly legal** for exactly these five, marked 「(…ごとに複数指定可能)」: `PageInfo`, `DomainInfo`, `CommonField` (Manager); `Field`, `IndexInfo` (Entity) — plus `Position`, marked 「(複数キー項目)」 and 「1個以上」. These must be **ordered lists, never maps**. |
| Spec silence | Duplicate behaviour for every other key (last-wins, first-wins, or error). |
| Parse work | Line grammar `section? \| key=value \| #comment \| blank`; split on first `=`; per-section schema registry (F1); unknown keys retained as raw with source line and column. |
| Test cases | empty value · value containing `=` · three `Field` lines preserving order · duplicate scalar key · `Page=` inside `[Entity]` ignored while inside `[Shape]` used · `=` inside `TableInnerOption`. |

### P5 · Quoting, commas, newlines, escaping — **confirmed** (byte-verified)

| Field | Value |
|---|---|
| Classification | confirmed, verified from raw bytes |
| Primary source | `値のフォーマット` (§1.2) |
| Spec definition | Type system: `String` (arbitrary, **no escaping**), `EscapedString`, `Boolean` (`1` / `0`), `Color` (`$AABBGGRR` or `$BBGGRR`, `$FFFFFFFF` = default), `Complex` (several comma-separated values on one line, **string elements double-quoted**, escaped per the table). |
| Escape table (literal) | `\` → `\\` · `"` → `\Q` · `'` → `\q` · TAB → `\t` · LF → `\n` |
| Traps confirmed | **`\Q` is the quote escape, not `\"`** — a JSON/CSV-style unescaper corrupts every comment containing a quote. Complex parsing must be **quote-aware**: `IndexInfo` element 3 is itself `"user_name,birthday"`, so a naive `split(',')` breaks multi-column indexes. Elements are heterogeneous: quoted strings, bare integers, bare colours, and empty elements. Official samples pad with a space before the quote (`IndexInfo="users_ix1",0,"user_name", ""`) → trim around elements, do not treat the space as data. Empty *unquoted* elements are real (`Field="…","…","…","NOT NULL",,"","",$FFFFFFFF,""`). NOT NULL is spelled inconsistently (`"NOT NULL"` in `Field` vs the bare token `NotNull` in `CommonField`) → compare semantically. |
| Parse work | One quote-aware Complex splitter honouring `\`-escapes; unescape only inside quoted elements and only for `EscapedString`; never trim inside quotes. |
| Test cases | comment containing `"`, `,`, newline, tab, backslash · multi-column index · empty integer slot · `, ""` padded element · literal `,` in a `String` value · `\Q` / `\\` / `\q` / `\t` / `\n` round-trip · trailing element omitted (P7). |

### P6 · Table / view definitions — **confirmed**

| Field | Value |
|---|---|
| Classification | confirmed |
| Primary source | `[Entity]` (§4.1); `[View]` (§4.3) |
| Spec definition | `[Entity]` = table. Required: `PName` (physical name, **unique across all objects in the diagram**). Optional: `LName`, `Comment`, `TableInnerOption`, `TableOption`, `Field`, `IndexInfo`, `NoDDL`, `UsingCommonColumns` (default **1**), `EffectMode` (`None` / `Gradation`), `Tag`, `Color`, `BkColor`, `ModifiedDateTime` (`YYYYMMDDhhmmss`), `Position` (必須, 1個以上), `ZOrder`. Legacy/ignore: `Page`, `Left`, `Top`, `Index`, `IndexOption`. 「単一のオブジェクトを複数のページに配置できます」 → one table may hold several `Position` lines. `[View]` shares most items but 「`Field`や`Index`は持ちません」 and adds `Query` (the SELECT), `LNameByComment`, `MaterializedView`, `NoDDL`. |
| Spec defects (do not implement from these cells) | `[View].Comment` is typed `String` while `[Entity].Comment` is `EscapedString`; `[View].Position` is typed `String` although it is the shared complex type (the same typo existed for `[Entity]` in `[aux v2.20]` and was fixed to `Complex` in 2.21, but not for `[View]`). |
| Parse work | Object registry keyed by `PName`; uniqueness check across `Entity` + `View` + `Subtype` (「ER図内の全オブジェクトでユニーク」); 1:N object→pages mapping. |
| Test cases | entity on two pages · entity with zero `Field` (legal) · view with escaped `Query` · `[View]` and `[Entity]` sharing a `PName` (violation) · `MaterializedView=1` · duplicate `PName` across pages resolving to **one** object. |

### P7 · Column / data type / NULL / default — **confirmed** (with a real 9-vs-10 trap)

| Field | Value |
|---|---|
| Classification | confirmed, with a verified element-count discrepancy |
| Primary source | `Field` (§4.1.1) |
| Spec definition | `Complex` per column: `"論理名","物理名","データ型","NOT NULL",キー順,"デフォルト値","コメント",色,"オプション","追加オプション"` (10 elements). 論理名/物理名/コメント quoted; データ型 is a real type, a **user domain name**, or an `@`-system domain; NOT NULL is the literal `"NOT NULL"` or empty; キー順 is a **0-based PK ordinal, bare integer** or empty; デフォルト値 is an expression, quoted or empty; 色 is **必須**; オプション is appended to the column DDL; 追加オプション carries `DISABLE` for disabled columns and 「将来のバージョンではカンマ区切りで別の文字列も入る可能性がある」. |
| Verified discrepancy | `Field` (§4.1.1) documents 10 elements, but the `基本構造` (§1.1) sample emits only **9** (`Field="ユーザーID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""` — 追加オプション absent), counted programmatically. The identical 9-element sample exists in `[aux v2.20]`, so this is a **stale sample, not a version difference**. |
| Spec defect | デフォルト値 is described as 「主キーでない場合は空」 — should be about NULL-ability, not PK membership. The same sentence is copy-pasted into `共通列設定`'s description of `CommonField`. |
| Parse work | Positional decode with **tail defaults** (F4); accept at least 8–10+ elements; never reject on "too many elements"; keep the raw string; classify データ型 as `type` / `user-domain` / `system-domain` without resolving it. |
| Test cases | 9-element legacy `Field` · 10-element · 11-element (future) · empty キー順 · `DISABLE` · default containing `(`, `,`, `'` · user-domain name · `@INT` · `"NOT NULL"` vs empty · `Field` missing element 8 (invalid — must be reported). |

### P8 · PK / index / constraint — **confirmed** (PK, index) / **not-planned** (DDL naming) / **unconfirmed** (legacy `Index`)

| Field | Value |
|---|---|
| Classification | confirmed for PK and `IndexInfo`; unconfirmed for the legacy `Index` payload; not-planned for constraint-name generation and CHECK |
| Primary source | `Field` (§4.1.1); `IndexInfo` (§4.1.2); `[Relation]` (§4.2); `ER図全体のグローバルな設定` (§3.1) |
| Spec definition | **A primary key is not an object**: it is `Field` element 5 `キー順`, a 0-based ordinal; a composite PK is 0,1,2… `IndexInfo` = `"インデックス名",ユニークフラグ,"カラムリスト","インデックスオプション"` with ユニークフラグ `0` = non-unique, `1` = unique, **`2` = unique constraint**; カラムリスト is comma-separated names **inside one quoted element**; options are appended to `CREATE INDEX`. A foreign key is `[Relation]` + `PName` + `FkOnDeleteOption` / `FkOnUpdateOption`. Constraint **names are not stored** — Manager holds printf templates (`DefaultPkName=%0:s_PKC`, `DefaultPkIndexName=%0:s_PKI`, `DefaultIndexName=%0:s_IX%1:d`, `DefaultFkName=%0:s_FK%1:d`). |
| Absent by design | No CHECK constraints, no standalone NOT NULL constraint, no sequences, no triggers. `CreatePkIndex`, `CreateFk`, `FKParentIndex`, `CreateFK_ParentCard1Only` are DDL-generation switches, not schema. |
| Version hazard | `[aux v2.20]` used `Index` + `IndexOption` (sample: `Index=users_ix1=0,user_name,birthday` — note the `name=flag,cols` payload). v2.21 introduced `IndexInfo` with a **different, quoted payload** and tells readers to ignore `Index` / `IndexOption` as legacy. Followed literally, every index in an older-FORMAT file disappears silently. |
| Parse work | Derive PK from キー順 ordering; model `IndexInfo` as (name, uniqueness enum including unique-constraint, ordered column list, option); FORMAT-gated legacy decoder for `Index` / `IndexOption` that warns when legacy data is the only index data present (F2). |
| Test cases | composite PK 0,1 · `IndexInfo` flag=2 · multi-column index · index with options · no index · legacy `Index=` under `FORMAT:19` · relation with `PName` · relation FK options. |
| Not planned | Computing `DefaultPkName`-style constraint names (defaults, not facts); CHECK constraints (do not exist in the format). |

### P9 · Relations & column mapping — **confirmed** (fields) / **unconfirmed** (arity, refs, vertices, page case)

| Field | Value |
|---|---|
| Classification | field *meanings* confirmed; arity rules, referential-integrity rules, vertex format, and the page-name case rule unconfirmed/inferred |
| Primary source | `[Relation]` / `[Relationship]` (§4.2); `Position` (§4.2.1) |
| Spec definition | `Entity1` / `Entity2` (必須) = parent(1) / child(2) **physical** entity names. `Fields1` / `Fields2` (必須) = related column physical names, comma-separated. `RelationType1` / `RelationType2` (必須) = cardinality `0` unspecified, `1` 0-or-1, `2` 1, `3` 0-or-more, `4` 1-or-more, `5` fixed N — **with defaults `1` and `3` respectively, which contradicts 必須**. `Cardinarity1` / `Cardinarity2` (**misspelled in the real format — keep the spelling**) hold IDEF1X strings such as `"P"`, `"Z"`. Also `Dependence`, `Caption` (verb phrase), `PName`, `NoDDL`, `LineColor`, FK options, `Position`, `ZOrder`, `ModifiedDateTime`. Legacy/ignore: `LineMode`, `Bar1`, `Bar2`, `Bar3`, `TermPos1`, `TermPos2`. |
| `Position` (§4.2.1) | 8 elements, a **different shape from Entity's `Position` under the same key name**: `"ページ名",ラインモード,線位置1,線位置2,線位置3,端子位置1,端子位置2,"頂点座標リスト"`. ラインモード 必須 `0`–`10` (auto, V-H-V, H-V-H, V-H, H-V, ⊐, ⊏, straight variants, free routing); 線位置1–3 必須 0–10000 (0 = left/top edge, 10000 = right/bottom); 端子位置1–2 必須 `R` / `L`; 頂点座標リスト is **`;`-separated** and the **inner point format is never defined**. |
| Spec silence / inference | No rule that `Fields1` and `Fields2` have equal element counts. No rule that the named entities or columns exist (referential integrity is a *validation* concern this project would invent). Page-name matching **must be case-insensitive** — inferred, but forced by the spec's own sample: `基本構造` (§1.1) declares `PageInfo="Main"` yet emits `Position="MAIN",…` for the relation; `ページ設定(複合値)` only says page names are unique 「大文字小文字の区別なし」. |
| Parse work | Case-insensitive page resolution (F5); never assume `Fields1` / `Fields2` are equal length; no invented referential rules; keyword comparison for `Cardinarity` values, not enumeration assumptions. |
| Test cases | 1:1 · 1:N in both directions · composite FK (`Fields1="a,b"`, `Fields2="x,y"`) · dangling `Entity2` · dangling column · `PageInfo "Main"` with relation `Position "MAIN"` (must resolve) · cardinality 5 · free-routing vertex list · `Fields1` 2 vs `Fields2` 3 (report, do not crash) · `[Relationship]` alias. |

### P10 · Logical / physical names & comments — **confirmed**

| Field | Value |
|---|---|
| Classification | confirmed |
| Primary source | `[Entity]` (§4.1), `[View]` (§4.3), `[Subtype]` (§4.4), `ER図全体のグローバルな設定` (§3.1), `ヘッダとフッタ文字列` (§3.1.1) |
| Spec definition | `PName` = physical name (unique per diagram), `LName` = logical name, on `[Entity]`, `[View]`, `[Subtype]`, and per column (Field elements 1–2). `Comment` is `EscapedString` on `[Entity]` (so it may contain `,`, `"`, newlines) but typed `String` on `[View]` (inconsistent). Presentation is governed by Manager `LogicalView` (`1` = logical, `0` = physical) and the `PageInfo` 表示モード `0`–`7`. `[View].LNameByComment` (`1`) means column logical names come from comments inside the SELECT, so **a View's columns are not enumerable from the file**. `Tag` is a free-form label (「A5:SQLの中では特に意味を持ちません」), with `ShowTag`. DDL comment assembly uses `GenerateCommentStatement`, `GenerateCommentStatement_LName`, `_Comment`, `_Separator` (default `:`). Header/footer tokens: `%FileName%` `%PageCount%` `%PageNo%` `%PageName%` `%Date%` `%Time%` `%ProjectName%` `%Author%` `%%`. |
| Parse work | Expose the flags and page mode rather than pre-resolving a "display name"; keep `%…%` tokens verbatim on read; record that a `LNameByComment=1` view has unknown columns. |
| Test cases | LName present / absent · comment containing `,`, `"`, newline (escape round-trip) · `LNameByComment=1` (must report columns unknown) · `LogicalView=1` with display mode 5/6/7 · `Tag` · `%`-token strings preserved on read. |

### P11 · Page / position / display info — **confirmed** (syntax) / **not-planned** (rendering geometry)

| Field | Value |
|---|---|
| Classification | syntax confirmed; rendering geometry not planned |
| Primary source | `ページ設定(複合値)` (§3.1.2); `Position` (§4.1.3) |
| Spec definition | `PageInfo="ページ名",表示モード,"用紙サイズ","背景色"`; **at least 1 required**; page names unique case-insensitively; 表示モード `0`–`7`; 用紙サイズ = `A4`–`A1`, `B4`–`B2` × `Landscape` / `Portrait` (e.g. `A4Landscape`, `A3Landscape`); 背景色 `$BBGGRR`; 5 mm margins on all sides; coordinates in **0.1 mm**. Entity/View/Subtype `Position` (§4.1.3) = `"ページ名",X座標,Y座標[,幅,高さ]` → **3 or 5 elements**; width/height appear only when the size is fixed (「自動計算するときは出力されない」). `ZOrder`: larger = in front. `EffectMode`: `None` / `Gradation`. |
| Same key, two shapes | Relation `Position` (§4.2.1) is the 8-element form (P9) — the decoder must dispatch on the **containing section**, never on the key name alone (F1). |
| Not planned | Line routing modes, bar/terminal positions, vertex maths, paper margins, header/footer layout — presentation only. Preserve raw values; do not interpret. |
| Parse work | Two `Position` decoders dispatched by section; warn when an object references a page that has no `PageInfo`. |
| Test cases | 2 pages · entity on 2 pages (2 `Position` lines) · position with and without width/height · object referencing a missing page (warn) · single-page `PageInfo`; zero pages (invalid) · paper-size string variants · `ZOrder` ordering · `PageInfo` repeated three times in one `[Manager]`. |

### P12 · Domain / shared column / auxiliary objects — **confirmed**

| Field | Value |
|---|---|
| Classification | confirmed |
| Primary source | `ドメイン設定` (§3.1.2); `共通列設定` (§3.1.3); `[Subtype]` (§4.4), `[Shape]` (§4.5), `[Line]` (§4.6), `[Comment]` (§4.7) |
| Spec definition | `DomainInfo="ドメイン名","データ型","コメント","カラム物理名"`; names unique case-insensitively; データ型 may itself be a user or system domain; カラム物理名 is only a **default** when the domain is applied (「名前が強制されるわけではありません」). System domains (10): `@VARCHAR` `@CHAR` `@DECIMAL` `@INT` `@FLOAT` `@DOUBLE` `@DATE` `@TIME` `@DATETIME` `@BOOLEAN`, mapped per target RDBMS at DDL time. `CommonField="共通列論理名","共通列物理名","データ型","NOT NULL","キー順","デフォルト値","コメント",色` (8) — here NOT NULL is the literal token `NotNull`; カラム物理名 unique case-insensitively; colour `$AARRGGBB`. Sample leaves middle slots empty: `CommonField="削除日時","deleted_at","timestamp",,,,"…",$FFFFFFFF`. Entities opt in with `UsingCommonColumns` (default **1**), so effective columns may be `Field` + applicable `CommonField`s; display flags `ShowCommonAttributes`, `ShowDisableAttributes`. Auxiliary objects: `[Subtype]` (`PName`, `SharedMode`, `CompleteCategory`, `Position`, `ZOrder`), `[Shape]` (23 keys incl. 13 `ShapeType`s), `[Line]` (13 keys, `StartLineTermType` / `EndLineTermType` 0–6, `TermSize`), `[Comment]` (sticky note; `Width` / `Height` required). |
| Spec defect | `DecodeDomain` is documented as `Boolean` but defined for three values (`0` / `1` / `2`) — parse as an integer. |
| Parse work | Resolve domain references **as names, not types**; compose effective columns = `Field` + applicable `CommonField` when `UsingCommonColumns` is 1; parse `[Shape]` / `[Line]` / `[Comment]` / `[Subtype]` at the key level of detail the spec does define. |
| Test cases | `DomainInfo` referenced by a `Field` · `@INT` field · `UsingCommonColumns=1` vs `0` · `CommonField` with empty middle slots · `DecodeDomain=2` · one `Shape`, `Line`, `Comment`, `Subtype` parsed · unknown `ShapeType` value · `Width` / `Height` on `[Comment]`. |

### P13 · Unknown items & future versions — **unconfirmed**

| Field | Value |
|---|---|
| Classification | unconfirmed: the principle is stated, the contract is absent |
| Primary source | `基本構造` (§1.1) note; legacy notes in `ER図全体のグローバルな設定` (§3.1), `[Entity]` (§4.1), `[Relation]` (§4.2), `[View]` (§4.3) |
| Spec definition | 「実際にA5:SQL Mk-2から出力される場合は、前方互換性のために追加の項目が出力されることがあります」 — extra items are expected. Four per-section notes say 「この他に … 項目が出力されますが、互換性のための古い項目であり、無視してかまいません」 (§3.1: `Page`, `Domain`, `ViewModePageIndividually`, `ViewMode`, `PaperSize`, `RDBMSType`; §4.1: `Page`, `Left`, `Top`, `Index`, `IndexOption`; §4.2: `LineMode`, `Bar1`–`Bar3`, `TermPos1`, `TermPos2`; §4.3: `Page`, `Left`, `Top`). `Field` 追加オプション may grow comma-separated values in future versions. |
| Why "ignore unknown" is insufficient | Computed key-set diff, `[aux v2.20]` vs v2.21: **removed** `FontSizeReal`, `Index`, `IndexOption`; **added** `IndexInfo`, `ShowDisableAttributes`. Consequences: (a) a key can be **renamed together with a payload-format change** (`Index=name=0,cols` → `IndexInfo="name",0,"cols", ""`), and the new spec tells you to ignore the old key — so legacy keys need a FORMAT-gated decoder or the data is lost; (b) a key's **type can change** (`FontSize` Integer + `FontSizeReal` Float in `[aux v2.20]` → `FontSize` Float in v2.21), so `FontSize` must accept both int and float. |
| Spec silence | No behaviour is defined for unknown keys, unknown sections, malformed lines, or an unsupported FORMAT. This project must define the contract itself (see §6 D2). |
| Unresolvable gap | `[Subtype]` documents only `PName`, `SharedMode`, `CompleteCategory`, `Position`, `ZOrder`. **No key states which entities belong to a subtype**, and no `[Entity]`-side key points at a subtype (`Subtype` occurs twice in the whole document, both as a heading). Subtype→entity membership **cannot be derived from the spec** → declared unsupported pending a real export. |
| Also undefined | Vertex-list point format (P9); whether `Query` or multi-line `String` values may span lines at all (only `EscapedString` and Complex define `\n`, and `Query` is typed `String`); colour channel order — `$AABBGGRR` (`値のフォーマット` §1.2) vs `$AARRGGBB` (`Field`, `CommonField`) vs `$BBGGRR` (13 other places), with `LineWidth` even described as 「`$BBGGRR` 形式」 although it is an Integer. |
| Parse work | FORMAT-gated decoding (F2); preserve unknown keys and sections as raw **plus** a warning; declare `[Subtype]` membership unsupported; store colours as the raw token with a best-effort RGB. |
| Test cases | unknown key in `[Manager]` / `[Entity]` (preserved + warned) · legacy `Index=` under `FORMAT:19` · `FontSize=9` vs `9.5` · `FORMAT:20` · unknown `[Section]` · `[Subtype]` present → emit "membership undeterminable" · unknown `ShapeType` · colour token preserved verbatim. |

---

## 4. Cross-cutting parser invariants

F1–F4 are the four format-defining invariants; F5–F10 are the remaining non-negotiable
structural consequences of the tables above. Each is a constraint on any future
implementation, derived from a specific confirmed defect risk.

### F1 — Section-scoped key registry, never a global key dictionary

The same key name means different things, and has different required-ness, depending on the
section. `Page`, `Left`, `Top` are legacy ("古い項目であり、無視してかまいません") in
`[Entity]` (§4.1) and `[View]` (§4.3) — yet `Page`, `Left`, `Top`, `Width`, `Height` are
**必須 (required)** real keys in `[Shape]` (§4.5), `[Line]` (§4.6) and `[Comment]` (§4.7).
`Position` has a 3-or-5 element shape in `[Entity]`/`[View]`/`[Subtype]` and an 8-element
shape in `[Relation]`.

A global "ignore deprecated keys" blacklist therefore corrupts Shape, Line and Comment; a
key-name-only decoder mis-parses every relation position. Keys are looked up
`(section, key)`, and the legacy/deprecated status itself is section-scoped.

### F2 — FORMAT-gated decoding

v2.20 → v2.21 renamed `Index` + `IndexOption` to `IndexInfo` **and changed the payload
format**, and retyped `FontSize` from Integer to Float. The new edition instructs readers to
ignore the old keys, so an unconditional reader loses every index in an older file.

Therefore: the header `FORMAT` integer selects the decoder for keys whose meaning changed,
and a **legacy decoder is required** for `Index` / `IndexOption`. Applying the "ignore
legacy" instruction unconditionally is a data-loss bug, not compliance.

### F3 — One Q-aware, quote-aware Complex splitter

A single tokenizer implements `値のフォーマット` (§1.2): escapes `\\`, `\Q`, `\q`, `\t`,
`\n`; quoted string elements; comma separation **outside** quotes; empty elements legal;
padding whitespace outside quotes ignored; never trim inside quotes. `\Q` is the quote
escape — **not** `\"`.

This is the highest-risk component in the whole format: it is on the path of every comment,
every index column list (`"user_name,birthday"` is one element containing a comma), and every
DDL option. Getting it wrong corrupts data that still looks plausible.

### F4 — Positional, tail-defaulting `Field` decode

`Field` (§4.1.1) documents 10 elements, but the spec's own `基本構造` (§1.1) sample emits 9,
and 追加オプション explicitly reserves the right to grow. So decode **by position with
defaults for a missing tail**, accept at least 8 through 10+ elements, and never reject a
row for having "too many" elements. Element 8 (色) is 必須 — its absence is a reportable
defect, not a silent default.

### F5 — Case-insensitive identity resolution

Page names are unique 「大文字小文字の区別なし」; the spec's own sample pairs
`PageInfo="Main"` with `Position="MAIN"`. Domain names and common-column physical names are
likewise case-insensitively unique. Resolution must be case-insensitive, and the original
spelling preserved for output.

### F6 — Preserve, then warn; never drop silently

`基本構造` (§1.1) states that extra items are emitted for forward compatibility, and no
behaviour is defined for unknown keys, unknown sections, malformed lines, or unsupported
FORMAT. Unknown constructs are therefore retained as raw text with their source location and
additionally reported in a machine-readable list. Nothing is discarded without a record.

### F7 — Subtype membership is undocumentable

`[Subtype]` (§4.4) defines the object but no membership key, and no other section references
a subtype. Membership must be declared **unsupported**, with an explicit diagnostic, until a
real export demonstrates the mechanism. Guessing a convention here would be inventing
semantics.

### F8 — Colours are tokens, not facts

The channel order differs across three documented forms (`$AABBGGRR`, `$AARRGGBB`,
`$BBGGRR`) and `LineWidth` is described as `$BBGGRR` despite being an Integer. Store the raw
token verbatim; any derived RGB is best-effort and must be labelled as such.

### F9 — Presentation is not schema

Page display mode, line routing, bar/terminal positions, vertex maths, paper sizes, colours,
`ZOrder`, `EffectMode`, and header/footer `%…%` tokens are display metadata. Carrying them
raw is required for round-trip fidelity; interpreting them is not part of structural
coverage.

### F10 — The spec defines no error semantics; this project does

`エラー`, `例外`, `未対応` appear 0 times. There is no defined reader reaction to a malformed
line, a duplicate scalar key, a missing `[Manager]`, a missing `[Entity].PName`, or an
unknown FORMAT. Every such contract is a local design decision and must be documented and
tested as such (see §6).

---

## 5. Explicitly unconfirmed

Nothing here may be presented as v2.21-defined behaviour. Each item needs either a spec
clarification or a real export to settle.

| # | Unconfirmed item | Why it stays open | Cheapest way to settle |
|---|---|---|---|
| U1 | Reader behaviour on unknown / higher / lower / absent `FORMAT` | Spec silent; `エラー`/`例外`/`未対応` = 0 hits | Local contract + test |
| U2 | `FORMAT:20` | Documented map jumps 19 → 21 with no entry and no explanation | Changelog or a real 2.20.x-era export |
| U3 | BOM-less UTF-8; Shift_JIS / CP932; declared-vs-actual encoding disagreement | Spec only *recommends* UTF-8+BOM; one token (`UTF8`) documented | A Shift_JIS export |
| U4 | Line endings | `行末` / `改行コード` / `CRLF` = 0 hits | Any two real exports |
| U5 | Duplicate `[Manager]`, missing `[Manager]`, empty sections, unknown `[Foo]`, section-name case | `重複` / `上書き` = 0 hits | Local contract + a real export |
| U6 | Duplicate *scalar* keys (every key outside the five repeatable ones) | Unspecified | Real exports + local contract |
| U7 | Legacy `Index` / `IndexOption` payload in real files | v2.21 does not document the legacy payload; the shape is only observable from `[aux v2.20]` and third-party parsers | A pre-FORMAT-21 export |
| U8 | Whether relation `Fields1` / `Fields2` must have equal counts; whether referenced entities/columns must exist | No stated rule — referential integrity is a *validation* feature this project would add | Local contract, plus real exports |
| U9 | Vertex-list inner point format (天下り: `;`-separated outer list only) | Inner format never defined | A real free-routing relation |
| U10 | Page-name case rule for `Position` | Inferred from the spec's own `Main` vs `MAIN` mismatch, not stated | Already resolvable by decision (case-insensitive); keep as inference |
| U11 | `[Subtype]` → entity membership | No key exists in any section | A real `[Subtype]`-bearing export |
| U12 | Whether `Query` (typed `String`) may span multiple lines | Only `EscapedString` and Complex define `\n` | A real view-bearing export |
| U13 | Authoritative colour channel order | Three different documented forms | Spec clarification; store raw meanwhile |
| U14 | `RelationType1` / `RelationType2`: 必須 *and* defaulted (1 / 3) | Contradiction inside one section | Follow 必須 + report when absent |
| U15 | Real-file prevalence of the stale 9-element `Field` | `基本構造` sample vs `Field` section disagree; both editions share the sample | A real 2.21 export |

---

## 6. Local decisions this coverage forces

Recorded so that no later implementation quietly chooses the silent path.

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | Unknown keys and unknown sections are **preserved as raw text with source location** and reported in a machine-readable `unsupported` list. | Dropping them (silent) or erroring out (loses readable files). |
| D2 | The file-level reader **never throws on an unknown construct**; it emits a diagnostic record and continues, so a partially-understood file still yields everything understood. | Fail-closed on any unknown, which would make older and newer exports unreadable. |
| D3 | Values are kept as **raw strings**; numeric/boolean coercion happens only where the spec types a field (`Integer`, `Boolean`, `Color`), and the raw text is always retained beside the coerced value. | Coercing every numeric-looking token, which silently destroys `bigint` defaults and leading zeros. |
| D4 | A `Field` row shorter or longer than documented is **decoded positionally and reported** with its source line. | Rejecting the row, or padding it silently. |
| D5 | Legacy `Index` / `IndexOption` are decoded **only** under a FORMAT gate and **always** warn when they are the sole index evidence. | Treating the v2.21 "ignore legacy" note as a licence to discard index data. |
| D6 | `[Subtype]` membership is emitted as **unsupported**, never guessed. | Inferring membership from proximity or naming. |
| D7 | Rendering and DDL-generation values pass through **uninterpreted**. | Reimplementing A5:SQL's drawing and DDL-naming behaviour. |
| D8 | Every test asserts a **value parsed out of a fixture that actually contains the construct**. A fixture without `IndexInfo` cannot support a claim of index support. | Asserting section counts or "no error thrown", which passes while data is dropped. |

---

## 7. How to obtain this coverage: A / B / C

| Option | Description | Why not / why |
|---|---|---|
| **A** | Adopt an existing parser's key set as the coverage definition — whatever `a5sql-mcp` (or any other tool) surfaces *is* the format. | Rejects by construction the items the spec defines and those tools omit: canonical `IndexInfo`, `[View].Query`, `Field` elements 7 and 9, ten `[Entity]` keys, and all of `[Subtype]`/`[Shape]`/`[Line]`/`[Comment]`. It also makes a third party's implementation bugs into our definition. |
| **B** | Merge spec list ∪ third-party behaviour; resolve conflicts case by case. | The union is not a contract: where they disagree (`Index` vs `IndexInfo`), there is no evidence-based tiebreaker, and the merged set inherits the same silent-loss behaviour. It also makes the coverage document unreviewable, because every row's authority depends on which source won. |
| **C** | **Spec-first coverage:** classify all 13 points against the v2.21 text; use third-party behaviour only as evidence *about real files* (hazards, legacy keys), never as a definition. | Chosen. |

**Verdict: C.** Only C keeps the classification column meaningful and keeps every claim
traceable to a section title in one hashed document.

**Concerns with C, and their handling**

1. *The spec contradicts itself in nine places and carries four further unresolvable gaps* (all 13 recorded in §8). C does not resolve them by fiat; it records each as a known issue and picks the conservative reading (retain raw, report, do not invent).
2. *Fifteen unconfirmed items (§5) cannot be closed by reading.* C therefore ships with an explicit open list and a documented local contract instead of pretending certainty.
3. *Scope risk*: 99 unique key names, most of them presentation. C mitigates this with the not-planned line (F9) and by holding schema-bearing keys to a stricter standard than display keys.
4. *Coverage cannot be validated without ground truth.* Two to three anonymised real exports (ideally across FORMAT versions, one Shift_JIS, one `[Subtype]`/`[Shape]`-bearing) would close most of §5. Until then this document is a spec-derived, evidence-marked map — not a verified field report.

---

## 8. Known issues in the specification itself

Recorded so implementations can point at a documented reason instead of looking like bugs.

| # | Issue | Sections involved | Local handling |
|---|---|---|---|
| K1 | Duplicate section number `3.1.2` (`ページ設定(複合値)` and `ドメイン設定`); neighbouring numbers shifted vs `[aux v2.20]` | §3.1.2 ×2, §3.1.3 | Cite by title only |
| K2 | `FORMAT` map skips 20 | `ヘッダコメント` (§2) | Accept and report; do not infer |
| K3 | `Field` sample has 9 elements, the `Field` definition has 10 | `基本構造` (§1.1) vs `Field` (§4.1.1) | Positional decode with tail defaults (F4) |
| K4 | `[View].Comment` typed `String`, `[Entity].Comment` typed `EscapedString` | §4.3 vs §4.1 | Treat view comments as escaped strings (superset) |
| K5 | `[View].Position` typed `String` though it is the shared complex | §4.3 | Use the `Position` decoder, ignore the cell |
| K6 | `RelationType1/2` marked 必須 but given defaults 1 / 3 | `[Relation]` (§4.2) | Follow 必須, report when absent |
| K7 | Key name misspelled `Cardinarity` | `[Relation]` (§4.2) | Keep the real spelling |
| K8 | `DecodeDomain` typed `Boolean` but defined for 0 / 1 / 2 | `ER図全体のグローバルな設定` (§3.1) | Parse as integer |
| K9 | デフォルト値 described as 「主キーでない場合は空」 (should be NULL-ability) | `Field` (§4.1.1) and `共通列設定` (§3.1.3) | Ignore the sentence |
| K10 | Colour order `$AABBGGRR` vs `$AARRGGBB` vs `$BBGGRR`; `LineWidth` called `$BBGGRR` though Integer | §1.2, §4.1.1, §3.1.3, 13 further places | Store raw (F8) |
| K11 | `[Subtype]` has no membership key anywhere | `[Subtype]` (§4.4) | Declare unsupported (F7) |
| K12 | Relation vertex inner point format undefined | `Position` (§4.2.1) | Preserve raw string |
| K13 | No error/validation semantics defined at all | whole document | Project-local contract (§6) |

---

## 9. What this document does not claim

- It does not claim any of the unconfirmed items in §5 are true of real files.
- It does not claim v2.20 semantics apply to v2.21; `[aux v2.20]` appears only as delta evidence.
- It does not describe any third-party parser's behaviour as the format (that is
  `docs/parser-evaluation.md`).
- It does not claim a reader must reject anything; the spec defines rejections nowhere.
