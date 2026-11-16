# Architecture — spec-based `.a5er` parser + CLI (option C)

Phase 1 design output. **Scaffold in place, features not:** `package.json`, `src/cli.ts`,
`src/index.ts`, `tests/`, CI, `oxlint` + `oxfmt`, Node >= 24 and pnpm 11.28.12 (pinned through
`packageManager`) exist and build, and the CLI exposes exactly `--help` and `--version`. The
`.a5er` parser and every analysis command remain unimplemented (Phase 2). This file fixes the
module boundaries, the data model, the error taxonomy, and the initial JSON contract so that
Phase 2 can be built against a contract instead of invented incrementally.

Companion documents, both committed: `docs/format-coverage.md` (what v2.21 says, item by item)
and `docs/parser-evaluation.md` (why option C). This document assumes both and cites them.

**Source of truth for format claims** is the v2.21 specification copy identified in
`format-coverage.md` §1: `https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.jpn.md?`,
51,038 bytes, 506 lines, `sha256 760e78fb…`. Sections are cited by title (v2.21 repeats the
number `3.1.2`).

**Citation shorthand used below**

| Shorthand | Meaning | Where it lives |
|---|---|---|
| F1–F10 | Cross-cutting parser invariants | `format-coverage.md` §4 |
| P1–P13 | Format points with classification and tests | `format-coverage.md` §3 |
| D1–D8 | Decisions forced by the format coverage | `format-coverage.md` §6 |
| U1–U15 | Explicitly unconfirmed format items | `format-coverage.md` §5 |
| K1–K13 | Known defects in the specification itself | `format-coverage.md` §8 |
| L1–L8 | Local implementation decisions from the parser evaluation | `parser-evaluation.md` §7 |

---

## 1. Position within option C

Option C was chosen in `parser-evaluation.md` §6: a spec-based original parser, with two ideas
**reimplemented, not copied**, from the evaluated third party — the warning taxonomy split
(trusted codes versus untrusted details) and the encoding fallback chain. No third-party code
enters this repository; there is no attribution obligation to discharge while that stays true.

Three properties follow directly from C and are structural, not aspirational:

1. **Lossless syntax.** Every line, key and value the file contains is representable after
   parsing, whether or not it is understood (F6, D1).
2. **Spans from line 1.** Source locations are emitted by the first parser, not retrofitted;
   `parser-evaluation.md` §6 notes this is impossible to add later (L1, traceability goal).
3. **Unsupported is an output, not an omission.** A construct we do not model is a record with
   a location, never an absence (F6, F7, D6, L7).

---

## 2. What forces what

Every structural choice below traces to an invariant or an evaluated defect. Summary; the
detail follows in the section named.

| Choice | Forced by | Section |
|---|---|---|
| Section-scoped key registry keyed `(sectionKind, key)` | F1: `Page`/`Left`/`Top` legacy in `[Entity]`/`[View]` but 必須 in `[Shape]`/`[Line]`/`[Comment]`; two different `Position` shapes under one key name | §5 |
| FORMAT profile gating decoders | F2: 2.20→21 renamed `Index`/`IndexOption` to `IndexInfo` with a different payload; `FontSize` int→float | §6 |
| One quote-aware Complex splitter, no ad-hoc `split(',')` | F3: escapes `\\ \Q \q \t \n`; `IndexInfo` element 3 is `"user_name,birthday"` | §7.1 |
| Positional `Field` decode with tail defaults | F4: spec sample has 9 elements, the definition has 10, `追加オプション` may grow | §7.2 |
| Line spans, not byte offsets | Raw text is captured at scan time, so re-slicing is never needed; byte offsets become ill-defined after transcoding | §4.1 |
| `Value<T>` carrying `origin` + `raw` | Declared/defaulted/inferred distinction; D3 (raw always retained) | §4.2 |
| Typed `RawEntry` list instead of a `Record<string, unknown>` bag | L1: no untyped escape hatch; every retained unknown keeps its location | §4.3 |
| AST (syntax) and resolved model (semantics) as separate types | Pipeline brief; the spec defines no error semantics (F10, K13), so syntax must never be able to fail on semantics | §3, §9 |
| Fatal-by-limit, never partial success | Fail-closed requirement; truncated input must not be reported as healthy | §10.2 |
| No lossy decoding | L3; mojibake in Japanese logical names is silent corruption | §8 |
| Subtype membership as `unsupported` | F7, D6, K11: no membership key exists anywhere in the spec | §9.6 |
| Colours as token + best-effort RGB | F8, K10: three conflicting channel orders | §9.4 |
| Presentation and DDL switches kept, never interpreted | F9, D7: they are metadata, not schema | §9.3 |

---

## 3. Pipeline

```
Input File
   │  §10.1  bounded, read-only read; pre/post stat
   ▼
Encoding Detection / Decoding
   │  §8      BOM sniff → fixed-order strict decode chain → header parse (authoritative)
   ▼
Syntax Parsing
   │  §5,§6,§7   lines → sections → (sectionKind,key) registry → Complex/Field/Position decoders
   ▼
Structured Representation  (AST: lossless, spanned, raw-preserving)
   │  §4
   ▼
Semantic Validation
   │  §9      resolve → validate → diagnostics
   ▼
CLI Commands / JSON Output
   │  §11,§12
   ▼
stdout: JSON envelope   stderr: human-readable diagnostics
```

Stage contracts — what each stage may and may not do:

| Stage | May | Must not |
|---|---|---|
| Read | Read only, bounded, verify the file did not change | Open for write, create temp files, mutate mtime |
| Decode | Sniff, transcode, report the detected/declared pair | Emit lossy text (L3), silently substitute an encoding |
| Syntax parse | Preserve every line, build the AST, warn | Throw on unknown constructs (D2), guess at semantics |
| Structured representation | Expose spans, raw text, ordered entries | Enforce uniqueness, resolve references, drop anything |
| Resolve | Compute PK, effective columns, page/domain lookup, index interpretation | Modify the AST, invent facts for unconfirmed items |
| Validate | Emit diagnostics with severities and spans | Re-parse, repair, or rewrite the file |
| Output | Serialize one envelope, exit with a defined code | Print JSON and prose on the same stream |

The syntax/semantics boundary is deliberate and hard: **`parse` cannot fail for semantic
reasons, and `validate` never re-parses.** A file with a dangling relation still parses
completely; the breakage appears as diagnostics, not as a parse error.

---

## 4. Data model

### 4.1 Spans — line-based, no byte offsets

```ts
export interface Span {
  sectionIndex: number   // 1-based ordinal of the containing section; 0 = file header and
                         // leading comments, i.e. before the first [section]
  startLine: number      // 1-based, inclusive, in the decoded text
  endLine: number        // 1-based, inclusive
  keyLine: number        // the line carrying `key=value` (== startLine for section headers)
}
```

**Decision: line numbers only; no byte offsets in v1.** Justification:

- Line numbers are free — the decoder hands back text and the scanner already splits it.
- Byte offsets are only useful for re-slicing the original buffer, and **raw text is captured
  by the scanner at read time**, so no later stage ever needs to re-slice (§4.3).
- Once the decoder can transcode (Shift_JIS, UTF-16LE), a byte offset into the original file
  and an offset into the decoded JavaScript string diverge; maintaining a mapping table is
  cost without a consumer.
- "Line" therefore means a logical line of the **decoded** text split on `\r\n|\n|\r`
  (U4: the spec never defines line endings). A consumer must not interpret a line number as a
  byte position.

TBD-O1 records the conditions under which byte offsets would be added (Phase 2).

### 4.2 Every interpreted value carries its origin and its raw text

```ts
export type Origin = 'declared' | 'defaulted' | 'inferred'

export interface Value<T> {
  value: T
  origin: Origin
  raw: string        // exact source text of the value; '' when origin !== 'declared'
  span: Span | null  // null only for 'defaulted' and 'inferred'
}
```

| Origin | Meaning | Example |
|---|---|---|
| `declared` | The token was present in the file and decoded per the spec's type for that key | `PName="users"` |
| `defaulted` | The spec supplies a default and the key is absent | `UsingCommonColumns` absent ⇒ `1`, origin `defaulted`; a default carries an info diagnostic only when it changes behaviour the consumer must know about — it does here, because common columns join `effectiveColumns` — otherwise `origin` is the whole record and no diagnostic is invented |
| `inferred` | This project computed the value from other declared facts | `primaryKey` synthesised from `Field` キー順 ordinals; case-insensitive page match |

The rule that makes this trustworthy: **an `inferred` value is never presented without the
facts it was inferred from.** A PK carries the `Value` of the キー順 element it came from; a
page match carries both the requested spelling and the declared spelling. No stage may
re-label an `inferred` value as `declared`.

Encoding has the same shape: `source.encoding.declared` (from the `# A5:ER ENCODING:` hint)
and `source.encoding.detected` are reported side by side, never collapsed (§8.4).

### 4.3 Unknown and unsupported constructs are records with provenance

```ts
export type RetentionKind =
  | 'unknown-section'      // a [Foo] header we do not model
  | 'unknown-key'          // a key with no registry entry for this section
  | 'legacy-key'           // a key the spec marks as old but that we decoded anyway
  | 'unsupported-construct'// a known construct we deliberately do not resolve
  | 'multiline-value'      // a continuation line we refused to join into a value

export interface RawEntry {
  kind: RetentionKind
  sectionKind: SectionKind          // 'unknown' for unknown-section
  sectionHeader: string             // header text exactly as written, e.g. '[Foo]'
  key: string | null                // key text exactly as written; null for sections
  raw: string                       // full original line(s), verbatim
  span: Span
  reason: string                    // stable machine code, e.g. 'no-registry-entry'
  detail?: string                   // bounded human note, never parsed
}
```

There is no `Record<string, unknown>` anywhere in the public model (L1). Retained-but-unmodelled
data is a list of typed records ordered by position, so a caller can reconstruct the file's
shape and so nothing is lost without an address.

### 4.4 AST — syntax only

```ts
export interface A5erFile {
  header: HeaderInfo            // FORMAT/ENCODING as declared, plus what was detected
  sections: AstSection[]        // in file order, unknown sections included
  comments: RawEntry[]          // free-standing `#` lines between sections
  span: Span                    // whole file
}

export interface AstSection {
  kind: SectionKind             // 'Manager' | 'Entity' | ... | 'unknown'
  header: Value<string>         // '[Entity]' exactly as written
  entries: AstEntry[]           // ordered; parsed entries and raw entries interleaved
  span: Span
}

export type AstEntry = ParsedEntry | RawEntry

export interface ParsedEntry {
  key: string                   // canonical (post-alias) key, e.g. 'Relation' for '[Relationship]'
  keyRaw: string                // exactly as written
  values: Value<unknown>[]      // one per occurrence; `unknown` is TS `unknown`, not `any` (L1)
  span: Span
}
```

The AST holds **no interpretation**: no PK, no resolved page references, no effective columns.
It holds every occurrence, including duplicates (P4: duplicate keys are legal for exactly five
keys and unspecified elsewhere — the AST simply records them).

### 4.5 Resolved model — semantics

```ts
export interface ResolvedSchema {
  objects: SchemaObject[]          // Entity | View | Subtype
  relations: ResolvedRelation[]
  pages: ResolvedPage[]
  domains: ResolvedDomain[]
  commonFields: ResolvedCommonField[]
  manager: ManagerView             // presentation and DDL switches, uninterpreted
}

export interface SchemaObject {
  kind: 'entity' | 'view' | 'subtype'
  pname: Value<string>                       // physical name; identity (P6)
  lname: Value<string | null>                // logical name (P10)
  comment: Value<string | null>              // EscapedString (K4)
  positions: Value<PositionValue>[]          // one per page (P11)
  fields: ResolvedColumn[]                   // [Entity] only
  indexes: ResolvedIndex[]                   // origin 'declared' | 'legacy' (P8)
  effectiveColumns: EffectiveColumns         // fields + applicable CommonField (P12)
  attributes: ResolvedAttribute[]            // every other key, typed and dispositioned
  span: Span
}

export type EffectiveColumns =
  | { status: 'complete'; columns: ResolvedColumn[] }
  | { status: 'partial'; columns: ResolvedColumn[]; unknown: 'common-fields-not-enumerated' }
  | { status: 'unknown'; reason: 'view-columns-not-stored' | 'view-columns-named-from-query' }
```

`partial` covers the one case where declared columns are complete but the common-field
contribution is not determinable — the body sets `UsingCommonColumns=1` and a `CommonField`
row fails its own decode (F4-style tail defect). Declared columns are never withheld to
signal that; the state is explicit so a consumer does not read an under-populated table as an
empty one.

`unknown` is a first-class state, not an empty array: a `[View]` cannot be distinguished from
a column-less table if both report `columns: []` (P10, and the evaluated parser's defect in
`parser-evaluation.md` §2.4). `[View]` with `LNameByComment=1` reports
`view-columns-named-from-query`.

### 4.6 Positions — one key, two shapes

```ts
export type PositionValue =
  | { kind: 'object'    // [Entity], [View], [Subtype] — 3 or 5 elements
      page: CaseInsensitiveRef
      x: number; y: number
      width: number | null; height: number | null }
  | { kind: 'relation'  // [Relation] — 8 elements
      page: CaseInsensitiveRef
      lineMode: number
      linePositions: [number, number, number]
      termPositions: ['R' | 'L', 'R' | 'L']
      verticesRaw: string }   // ';'-separated, inner format undefined (U9, K12)
```

Dispatch is by **section**, never by key name alone — F1. A single `Position` decoder keyed on
the key is the bug F1 exists to prevent.

### 4.7 Columns and indexes

```ts
export interface ResolvedColumn {
  logicalName: Value<string>
  physicalName: Value<string>
  dataType: Value<DataTypeRef>          // 'type' | 'user-domain' | 'system-domain' (unresolved)
  notNull: Value<boolean>               // literal "NOT NULL" / empty; CommonField uses 'NotNull'
  keyOrder: Value<number | null>        // 0-based PK ordinal (P8)
  defaultValue: Value<string | null>    // never coerced, never evaluated (D3)
  comment: Value<string | null>
  color: ColorToken | null              // required by spec, may be absent in real rows (F4)
  option: Value<string | null>
  additionalOption: Value<string | null> // 'DISABLE' today, growth allowed (F4)
  elementsSeen: number                  // 8, 9, 10, 11… (F4 completeness evidence)
  span: Span
}

export interface ColorToken {
  raw: string                  // e.g. '$FFFFFFFF', preserved verbatim
  rgb: string | null           // best-effort, lowercase '#rrggbb'
  channelOrder: 'AABBGGRR' | 'AARRGGBB' | 'BBGGRR' | 'assumed'
}

export interface ResolvedIndex {
  name: Value<string>
  uniqueness: Value<'non-unique' | 'unique' | 'unique-constraint'>   // flags 0/1/2
  columns: Value<string[]>     // split from one quoted element, order preserved
  option: Value<string | null>
  origin: 'declared' | 'legacy' // 'legacy' always carries a diagnostic (D5, L6)
  span: Span
}
```

`DataTypeRef` classifies the token as `type`, `user-domain` or `system-domain` (the 10 `@…`
names) **without resolving it to a SQL type** (P12). That is a resolver decision, not a decoder
one, and it preserves what the file says.

### 4.8 What "lossless" covers

Lossless here is a statement about *source coverage*, not about bytes:

- **Covered:** every source line is represented — comments, blank lines (positionally), unknown
  sections and keys as `RawEntry` with spans, and the raw text of every value kept beside its
  interpretation (§4.2, §4.3).
- **Not covered:** byte-exact reproduction of the input file (EOL normalisation and BOM handling
  belong to the decoder, §8), semantic interpretation of constructs the spec does not define, and
  rendering fidelity for presentation fields (F9).

So "lossless" means nothing read from the file disappears without a record. It does not mean the
output can be byte-diffed against the input, and it does not promise understanding.

---

## 5. Section-scoped schema registry (F1)

The registry is the only place that knows what a key means. Shape:

```ts
export interface KeySpec {
  key: string                  // canonical on-disk name incl. numeric suffix and real spelling (e.g. RelationType1, Cardinarity1)
  repeatable: boolean          // P4: exactly PageInfo, DomainInfo, CommonField, Field, IndexInfo, Position
  required: boolean            // 必須 rows
  type: 'string' | 'escaped' | 'int' | 'bool' | 'color' | 'complex'
  disposition: 'structured' | 'presentation' | 'ddl-only' | 'legacy'
  decode?: (raw: string, ctx: ParseContext) => unknown   // Field / Position / IndexInfo
  sinceFormat?: number
  legacyBeforeFormat?: number  // F2 gate
}
```

Lookup is `registry.get(sectionKind, keyRaw)`; a miss produces an `unknown-key` RawEntry plus
`S_UNKNOWN_KEY`. There is no global key table, no case folding of key names, and no
"deprecated key" blacklist.

Worked excerpt — `[Entity]` (16 current keys, 5 legacy), the section with the most traps:

| Key | Type | Repeats | Required | Disposition | Why |
|---|---|---|---|---|---|
| `PName` | string | no | yes | structured | identity, unique per diagram (P6) |
| `LName` | string | no | no | structured | logical name (P10) |
| `Comment` | escaped | no | no | structured | may contain `,` `"` newline |
| `Field` | complex | **yes** | no | structured | F4 positional decode; zero fields is legal |
| `IndexInfo` | complex | **yes** | no | structured | canonical index (P8) |
| `Position` | complex | **yes** | yes | structured | object shape, 3 or 5 elements (P11) |
| `UsingCommonColumns` | int | no | no | structured | defaults to 1, changes effective columns (P12) |
| `TableOption`, `TableInnerOption`, `NoDDL` | string | no | no | ddl-only | DDL-generation switches, not schema (F9) |
| `Tag`, `Color`, `BkColor`, `EffectMode`, `ZOrder` | mixed | no | no | presentation | display metadata (F9) |
| `ModifiedDateTime` | string | no | no | presentation | `YYYYMMDDhhmmss` stamp |
| `Page`, `Left`, `Top` | mixed | no | no | legacy | legacy geometry **in this section only** (F1) |
| `Index`, `IndexOption` | string | no | no | legacy | legacy index payload, decoded under gate (F2) |

The identical key names in `[Shape]`/`[Line]`/`[Comment]` resolve to `structured` and
`required: true` — which is only expressible because the registry is keyed by section.

Alias normalisation happens once, at section-header level: `[Relationship]` → `Relation`, with
`header.raw` preserving `[Relationship]`.

---

## 6. FORMAT gate (F2)

```ts
export interface FormatProfile {
  declared: number | null      // from `# A5:ER FORMAT:<n>`
  effective: number | null     // declared, or filled in from a legacy marker
  known: boolean               // false for absent, 20 (K2), or > 21
  legacyIndex: boolean         // decode Index/IndexOption
  fontSize: 'int' | 'float'    // 2.20: Integer (+FontSizeReal); 2.21: Float
}
```

Policy, and its reasoning:

| Situation | Behaviour | Because |
|---|---|---|
| `FORMAT:21` | Canonical decoders. Legacy `Index` still decoded if present, marked `legacy`, warned | D5, L6: a real 2.21 file may carry compat keys |
| `FORMAT:19` / `< 21` | Legacy decoders active; canonical keys still accepted | F2: 2.20 wrote `Index`, not `IndexInfo` |
| `FORMAT:20` | Treated as `< 21` (legacy decoders on), warning `S_HEADER_UNKNOWN_FORMAT` | K2: the number is a hole; being permissive loses nothing and dropping indexes loses data |
| No header | `declared: null`, `known: false`, **both** canonical and legacy decoders active, warning | U1: no evidence either way; D2: never hard-fail |
| `FORMAT:99` | As absent, warning | U1 |
| Legacy `Index` under `FORMAT:21` and no `IndexInfo` | Decoded, `origin: 'legacy'`, warning `V_INDEX_LEGACY_ONLY` | D5, L6 — never silently empty `indexes` |

The gate decides **interpretation**, never **acceptance**. Every key, in every profile, is
preserved; the profile only changes what the decoder is allowed to conclude. A file whose keys
contradict its declared FORMAT is a diagnostic, not a refusal.

Concretely, the four rows above collapse into one switch: **which index spelling is primary.**
`IndexInfo` and the legacy `Index`/`IndexOption` are decoded in *every* profile — `legacyIndex` as a
per-profile "decode it" flag would be constantly true, so it is not a field — and each decoded index
carries `role: 'primary' | 'compatibility'` from `declared === 21`. `21` makes the canonical spelling
primary; `19`, `20`, absent and `99` make the legacy one primary. *Assumption, not spec:* for an
absent or future declaration the specification says both decoders are active and stops there, so the
legacy-primary reading is this project's choice, made in the same direction §6 already chose for `20`
(being permissive loses nothing) and recorded here rather than presented as a spec rule (K2, U1).

The `S_HEADER_UNKNOWN_FORMAT` warning points at the `# A5:ER FORMAT:` line that declared the
value it is about, wherever that line sits in the header region — not at a fixed first line. When
no numeric declaration exists (absent, or a value the header parser cannot read as a number, such
as `FORMAT:abc`), it points at line 1 with `sectionIndex` 0: that is the first position at which a
declaration would have been read, it is a real line of the file, and it is the span §12's example
shows. The scanner finds the line with the same parser `decode/` uses, not with a second copy of
its pattern.

---

## 7. Syntax layer

### 7.1 Complex splitter (F3)

One function, used by every Complex-typed key:

```ts
export interface ComplexParts {
  parts: Array<{ value: string; quoted: boolean; hadEscape: boolean }>
  trailingElementsOmitted: boolean
}

export function splitComplex(raw: string): ComplexParts
```

Contract, each line traceable to `値のフォーマット` (byte-verified in P5):

| Rule | Consequence if violated |
|---|---|
| Escape table `\\`, `\Q`, `\q`, `\t`, `\n`; unknown escapes pass through as `\x` | `\Q` misread as `\"` corrupts every comment containing a quote |
| Comma separates only outside quotes | `IndexInfo` column list `"user_name,birthday"` breaks into two columns |
| Elements may be empty, quoted-empty, bare integers, or bare colours | Empty キー順 slot becomes a parse failure |
| Whitespace outside quotes is padding, not data; never trim inside quotes | Official sample `…,"user_name", ""` gains a leading space in the column name |
| Unquoted values are taken verbatim (no unescaping) | `String` fields are "no escaping" by spec; unescaping them invents data |
| An unterminated quote yields a diagnostic and the raw remainder as one element | Silent truncation |

### 7.2 `Field` decode (F4)

```ts
export function decodeField(parts: ComplexParts, span: Span): { column: ResolvedColumn; diagnostics: Diagnostic[] }
```

- Positional, with defaults for a missing tail: 8, 9, 10 and more elements are all accepted.
- `elementsSeen` is recorded on every column, so "this file uses the 9-element sample shape"
  is answerable from output (U15).
- More than 10 elements extends `additionalOption` as a raw comma-joined tail; never a
  rejection (spec reserves the right to grow).
- Missing element 8 (色, 必須) is a `S_FIELD_TOO_FEW_ELEMENTS` warning from the syntax layer;
  the validator adds `V_MISSING_REQUIRED_KEY` for the same span. It is a reported defect,
  never a defaulted value, and the layer split is preserved: `S_` never becomes `V_`.
- Values are not coerced beyond the corpus's own typing: `デフォルト値` stays a string (D3).

### 7.3 Continuation lines (U12)

A physical line inside a section that does not match `key=value`, `#…`, or a section header is:

1. attached verbatim to the preceding entry's `raw` as `multiline-value` in `unsupported`,
2. given `S_MALFORMED_LINE` with its span,
3. **never** joined into the preceding value.

`Query` is typed `String` and the spec never defines multi-line values, so joining would invent
join semantics (U12). A file that genuinely needs it will be visible as an `unsupported` entry
rather than as a silently mangled SELECT.

### 7.4 Comments and blank lines

`#`-prefixed lines are comments anywhere (P1). They are preserved in `comments` (between
sections) or attached to the following section's span; blank lines are whitespace and are
recorded only as line offsets, never as data.

---

## 8. Encoding layer

### 8.1 Detection order

```
bytes
 ├─ UTF-8 BOM (EF BB BF)?        → utf-8,      bom: true
 ├─ UTF-16LE/BE BOM?             → utf-16le/be
 ├─ NUL density heuristic?       → utf-16le — **NOT IMPLEMENTED**, see below
 └─ strict UTF-8 (fatal)         → utf-8
     └─ fails → fixed list (shift_jis, utf-16le, utf-16be), first strict success wins
```

The header is read from the **decoded** text: `parseHeader` runs
`^#\s*A5:ER\s*(FORMAT|ENCODING)\s*:\s*(\S+)$` over the decoded string, and that reading is
the authoritative one. `peekHeader` — the same pattern over the first 8 KiB of the raw bytes,
read through `latin1` so one byte is one code point — exists as a helper but is **not** part of
the pipeline: with the candidate order fixed (a BOM pins the codec, otherwise UTF-8 first) and
the declaration explicitly not allowed to order candidates (R11, next paragraph), a pre-decode
reading has nothing left to decide. The chicken-and-egg problem is avoided by not asking the
bytes a question the decoded text answers better.

The declaration does **not** order the candidates (R11). `ENCODING:SJIS` says what the writer
believed, not what the bytes are, and the UTF-8 bytes of `ユーザー` are also valid Shift_JIS —
promoting the declared codec made such a file decode to mojibake with no diagnostic. Without a
BOM the order is therefore fixed: UTF-8 first, legacy codecs only after UTF-8 has failed
**strictly**, which is affirmative evidence rather than a preference (`enc-03` is exactly that
case). Priority resolves the ambiguity; it does not prove the source encoding, and no statistical
detector is invented to pretend otherwise — the residual risk is stated in §8.2 and recorded
rather than hidden.

*Implementation status (R13):* the NUL-density heuristic for a UTF-16 file with **no BOM** is
**not implemented**. Its condition is stated too loosely above ("odd-byte NUL ≥ 85 % printable")
to pick a threshold without inventing one, and this unit does not invent one. What happens instead
is decided by §10.4's binary probe, which runs before decoding: a UTF-16 file whose first 4 KiB
contains ASCII — every real document starts with a header comment or a section header, and each
ASCII character contributes a NUL byte — exceeds the 10 % NUL density and is refused as
`E_BINARY_INPUT`, never guessed at. A UTF-16 payload with no ASCII at all has no NUL bytes, so it
reaches the fixed candidate list and is refused there (`E_UNRECOGNIZED_DOCUMENT`: no section
header). Either way, nothing is decoded as UTF-16 without a BOM. The heuristic stays an open design
item until its threshold is fixed; `src/decode/decode.ts` records the same note, and
`tests/decode.test.ts` pins both outcomes so closing the gap is a deliberate, visible change.

### 8.2 Decoding is strict; there is no lossy path (L3)

`TextDecoder(codec, { fatal: true })` for every candidate. The first candidate that decodes
strictly without error wins, and the candidate list is fixed: **a BOM pins the codec;
otherwise UTF-8, then shift_jis, utf-16le, utf-16be** — the header declaration never reorders it
(§8.1). A candidate that yields U+FFFD is rejected even when the decoder does not throw. If none
succeeds, the file is rejected as fatal (`E_UNDECODABLE`): no
lossy text is ever emitted, and an incomplete schema is never returned as healthy. This drops
the lossy step of the fallback chain borrowed from `parser-evaluation.md` §6 — emitting U+FFFD
into Japanese logical names is exactly the silent corruption the project forbids (L3). The
chain itself — strict UTF-8 first, legacy codec second, diagnostics at each step — is kept.

**What priority does not prove.** A strict success is not an identification: pure ASCII decodes
under every codec, and the UTF-8 bytes of `ユーザー` also decode as `繝ｦ繝ｼ繧ｶ繝ｼ` under
Shift_JIS. The reader stops at the first strict success, so it never learns whether a later
candidate would also have succeeded and must not claim uniqueness. The residual risk is a genuine
Shift_JIS file whose bytes happen to be valid UTF-8: it decodes as UTF-8 and is reported as such,
with no diagnostic. That is inherent to byte-only detection; it is recorded here and in
`src/decode/decode.ts` rather than papered over.

Verified locally on Node v24.22.3 (ICU 78.3): `new TextDecoder('shift_jis')` decodes
`83 65 83 58 83 67` to `テスト`, and `new TextDecoder('utf-8', { fatal: true })` raises
`TypeError` on the same bytes. Both behaviours are what §8.1 depends on.

### 8.3 Codec availability is probed, not assumed

At startup the binary probes `new TextDecoder('shift_jis')`. A build without full ICU is
refused with `E_CODEC_UNAVAILABLE` rather than silently mis-decoding; official Node builds ship
full ICU, so this should never fire in practice. Node >= 24 is required for this and for
`Array.prototype` behaviours the scanner relies on.

### 8.4 Declared versus detected

| Detected | Declared | Behaviour |
|---|---|---|
| utf-8, BOM | UTF8 | Silent |
| utf-8, no BOM | UTF8 | `D_BOM_MISSING` (info): spec expects BOM, absence is tolerated |
| shift_jis | UTF8 | Decode as SJIS; `D_ENCODING_MISMATCH` (warning) recording both; never retry blindly |
| utf-8 | `SJIS` | Decode as UTF-8 (bytes won); `D_ENCODING_MISMATCH` |
| utf-16le | absent | `D_ENCODING_ASSUMED` (info) |

The decoded text always wins over the header; the header is a hint (P2). Both values are
reported so a consumer can see the disagreement: `D_ENCODING_MISMATCH` means exactly "the
declaration names a different codec than the one that decoded the bytes", and it fires in both
directions (rows 3 and 4). A declared legacy codec never wins on its declaration alone (§8.1), so
the mismatch is reported on the decoded outcome, never used to choose it.

---

## 9. Semantic layer

Resolution runs once, over the AST, and produces `ResolvedSchema` plus diagnostics. It never
mutates the AST.

### 9.1 Object identity

`PName` is the identity and must be unique per diagram; uniqueness is checked across
`Entity` + `View` + `Subtype` (P6). Duplicates produce `V_DUPLICATE_OBJECT_NAME` (error) and
both objects are still emitted, each with its span — a validation failure is data, not an
abort. The same `PName` appearing on two pages is **one** object with two `positions` (P6),
never two objects.

### 9.2 PK, indexes, relations

- **PK is synthesised, not read.** `Field` element 5 (キー順) is a declared 0-based ordinal;
  `primaryKey` is an `inferred` value listing columns in ordinal order, citing each
  contributing span (P8). Gaps or duplicate ordinals → `V_PK_ORDER_CONFLICT` (warning).
- **Indexes** come from `IndexInfo` (`origin: 'declared'`). Legacy `Index`/`IndexOption` are
  decoded under the F2 gate with `origin: 'legacy'` and a diagnostic whenever they are the only
  index evidence (D5, L6, U7). A legacy payload whose shape does not match the observed
  `name=flag,cols` pattern is preserved raw and flagged, never guessed (U7).
- **Relations** carry parent/child physical names, column lists, cardinality and IDEF1X
  strings. `Cardinarity1` / `Cardinarity2` keep the misspelled spelling the format actually
  writes (K7): the registry keys, the JSON fields and `keyRaw` all read `Cardinarity1` /
  `Cardinarity2`, and no corrected alias is invented. `RelationType1` / `RelationType2` absent
  → warning `V_MISSING_REQUIRED_KEY` and `value: null`; the spec contradicts itself here (K6,
  U14), so the tool reports rather than defaulting. `Fields1`/`Fields2` of different length →
  warning, not error (U8).

### 9.3 Manager, presentation, DDL switches

`ManagerView` splits its keys by disposition, not by guesswork:

| Disposition | Keys (examples) | Treatment |
|---|---|---|
| `structured` | `PageInfo`, `DomainInfo`, `CommonField`, `LogicalView` | decoded, exposed |
| `presentation` | header/footer strings, colours, `PaperSize`, `ViewMode`, `%…%` tokens | preserved verbatim, never interpreted (F9) |
| `ddl-only` | `CreatePkIndex`, `CreateFk`, `FKParentIndex`, `CreateFK_ParentCard1Only`, `DefaultPkName`… | preserved, explicitly **not** schema facts (D7, P8) |

`NoDDL`, `TableOption`, `TableInnerOption`, `EffectMode`, `Tag`, `ZOrder` are exposed the same
way on objects. None of them changes a column, and none is validated.
`UsingCommonColumns` is deliberately **not** in that list, although it is commonly grouped with
the DDL switches: it changes `effectiveColumns` (P12), so it is classified `structured`. This is
a local classification choice, recorded here because it differs from the grouping in the unit
brief.

### 9.4 Domains, common fields, pages

- **Domains**: `DomainInfo` names are resolved case-insensitively; a `Field` data type matching
  a domain name becomes `kind: 'user-domain'` with `domain` set; `@…` tokens become
  `kind: 'system-domain'`. Neither resolves to a SQL type (P12). `DecodeDomain` is parsed as an
  integer despite its `Boolean` type in the spec (K8).
- **Common fields**: `effectiveColumns` = declared `Field`s, plus applicable `CommonField`s when
  `UsingCommonColumns` is 1 — which it is by default when absent, as `origin: 'defaulted'` with
  an info diagnostic (P12). Common columns are marked `source: 'common'` so a consumer can tell
  them from declared ones. `NotNull` is the CommonField spelling of NOT NULL and is normalised
  to the same boolean (P5).
- **Pages**: `PageInfo` must have at least one entry; zero is `V_MISSING_REQUIRED_KEY` (error).
  Page names resolve **case-insensitively** (F5): the spec's own sample pairs `PageInfo="Main"`
  with `Position="MAIN"`. Unresolved page references are `V_DANGLING_PAGE` (warning) and the
  original spelling is preserved in `CaseInsensitiveRef.declared`.

### 9.5 Colours (F8, K10)

Never interpreted as authoritative. `ColorToken.raw` is the file's token; `rgb` is best-effort;
`channelOrder` records which documented form was assumed, or `'assumed'` when the token length
admits more than one reading. `$FFFFFFFF` is reported as the default colour, not as white.

### 9.6 Views and subtypes

- **Views** have no `Field` (P6), so `effectiveColumns.status` is `unknown` with
  `view-columns-not-stored`; when `LNameByComment=1`, `view-columns-named-from-query` (P10).
  `Query` is retained verbatim as a `String` and never split, trimmed, or re-escaped.
- **Subtypes** are emitted with `membership: { status: 'unsupported', reason: 'no-membership-key-in-v2.21' }`
  (F7, D6, K11). The object's own keys (`SharedMode`, `CompleteCategory`, `Position`, `ZOrder`)
  are parsed normally; only the relationship to entities is declared unknown, with an
  `unsupported` entry per subtype.

---

## 10. Input handling, limits, immutability

### 10.1 Read

`fs.open(path, 'r')` → `fstat` → bounded read up to `maxBytes` → `fstat` again. Never
`'r+'`, never a temp file, never a write, never a rename. If the second `fstat` differs in
`size`, `mtimeMs` or `ino`, the read is discarded and `E_FILE_CHANGED_DURING_READ` is fatal.

### 10.2 Limits fail closed

| Limit | Default (TBD-O3) | On breach |
|---|---|---|
| `maxBytes` | 64 MiB | `E_LIMIT_BYTES` — fatal, no schema |
| `maxLines` | 2,000,000 | `E_LIMIT_LINES` — fatal |
| `maxLineLength` | 4 MiB, measured in **UTF-16 code units** (a surrogate pair counts 2) | `E_LIMIT_LINE_LENGTH` — fatal |
| `readBudgetMs` | none in v1 | — |

There is **no partial-success mode**: if the reader stops early, the result is a failed
envelope, never a shorter schema. This is the `not-attempted` pattern recorded in
`parser-evaluation.md` §2.2, adopted as a hard rule.

A line is a physical line of the decoded text, as §4.1 defines it: `\r\n`, `\n` or a bare `\r`
terminates one, and a **trailing** terminator does not create an extra empty line. `maxLines`
counts exactly the lines the scanner later numbers, so a file at the boundary is not refused for a
line it does not have.

### 10.3 Streaming

Not in v1. The AST is materialised in memory regardless, so a streaming reader would only move
the peak, not remove it; the byte cap bounds it deterministically. Revisit if Phase 2 fixtures
show legitimate files above the cap (TBD-O2).

### 10.4 Unrecognised documents

Zero recognised section headers (none of `[Manager]`, `[Entity]`, `[Relation]`,
`[Relationship]`, `[View]`, `[Subtype]`, `[Shape]`, `[Line]`, `[Comment]`) ⇒
`E_UNRECOGNIZED_DOCUMENT` (fatal). This is the guard against reporting a JSON/PowerShell
file as an empty-but-healthy ER diagram. An empty file is `E_EMPTY_INPUT`; a binary file
(> 10 % NUL in the first 4 KiB) is `E_BINARY_INPUT`.

---

## 11. Error taxonomy

Four families, distinguished by **who can fix them** and **whether schema can be emitted**.

| Family | Prefix | Emitted when | Schema | Exit |
|---|---|---|---|---|
| Fatal | `E_` | I/O, limits, decoding, unrecognised document, changed file | none | 1 |
| Decode | `D_` | Encoding was inferred, mismatched, or a BOM was absent | yes | 0 |
| Syntax | `S_` | Unknown/duplicate/malformed constructs, element-count anomalies | yes | 0 |
| Semantic | `V_` | Structural or referential defects found by validation | yes | 0, or 3 for `validate` |

```ts
export type Severity = 'fatal' | 'error' | 'warning' | 'info'

export interface Diagnostic {
  code: DiagnosticCode        // closed enum, stable, documented
  severity: Severity
  message: string             // fixed English text; file content is NEVER interpolated
  details: Record<string, string | number | boolean | null>  // untrusted values live here
  span: Span | null
  construct: string | null    // 'Entity', 'Field', 'Index', …
}
```

Two rules make the taxonomy safe (the borrowed idea from `parser-evaluation.md` §6, L2):

1. **Trusted codes, untrusted details.** A file can never influence `code` or `message`; every
   string taken from the file goes into `details`, truncated to 200 characters. This is what
   stops a hostile `.a5er` from forging a diagnostic code.
2. **No silent branch.** A parser path that decides not to model something must emit a record —
   either a `Diagnostic` or a `RawEntry`. L2 is enforced by review rule: no `catch {}`, no
   `default:` without an emit.

Initial code list (frozen enough to test against, not a promise of completeness):

| Code | Severity | Meaning |
|---|---|---|
| `E_IO`, `E_NOT_A_FILE`, `E_EMPTY_INPUT`, `E_BINARY_INPUT` | fatal | cannot treat input as text |
| `E_TRUNCATED_INPUT`, `E_LIMIT_BYTES`, `E_LIMIT_LINES`, `E_LIMIT_LINE_LENGTH` | fatal | stopped early — never partial |
| `E_UNDECODABLE`, `E_CODEC_UNAVAILABLE` | fatal | no strict decoder succeeded |
| `E_UNRECOGNIZED_DOCUMENT`, `E_FILE_CHANGED_DURING_READ` | fatal | not an a5er, or unstable input |
| `D_BOM_MISSING`, `D_ENCODING_ASSUMED` | info | spec-preferred form absent |
| `D_ENCODING_MISMATCH` | warning | header and bytes disagree; bytes won |
| `S_HEADER_UNKNOWN_FORMAT` | warning | absent, 20, or > 21 |
| `S_UNKNOWN_SECTION`, `S_UNKNOWN_KEY` | info | preserved as RawEntry |
| `S_LEGACY_KEY` | info | decoded under the F2 gate |
| `S_MALFORMED_LINE` | warning | not a key, header, comment, or blank |
| `S_DUPLICATE_KEY` | warning | scalar key repeated (last wins, both spans kept) |
| `S_FIELD_TOO_FEW_ELEMENTS`, `S_FIELD_TOO_MANY_ELEMENTS` | warning | F4 shape anomaly |
| `S_COMPLEX_UNTERMINATED_QUOTE` | warning | raw remainder kept |
| `V_MISSING_REQUIRED_KEY` | warning or error | required key absent (error for identity/PageInfo) |
| `V_DUPLICATE_OBJECT_NAME` | error | `PName` collision across Entity/View/Subtype |
| `V_DANGLING_ENTITY`, `V_DANGLING_COLUMN`, `V_DANGLING_PAGE` | warning | reference does not resolve |
| `V_FIELD_COUNT_MISMATCH` | warning | `Fields1` and `Fields2` differ in length |
| `V_PK_ORDER_CONFLICT` | warning | duplicate or non-contiguous キー順 |
| `V_INDEX_LEGACY_ONLY` | warning | indexes exist only as legacy `Index` |
| `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` | info | membership undeterminable (F7) |
| `V_VIEW_COLUMNS_UNKNOWN` | info | columns not stored in the file |

Severity is assigned by consequence, not by family: a missing `RelationType1` / `RelationType2`
is a `warning` (contradiction K6, U14), a missing `PName` is an `error`, and a duplicate scalar
key is a `warning` (U6 defines no semantics).

---

## 12. JSON contract (initial)

One envelope per invocation, on **stdout**. Human-readable diagnostics go to **stderr**; JSON
is never mixed with prose. `--format json` is the default for machine use; a `text` renderer is
a Phase 2 command-level concern.

```json
{
  "contractVersion": "0.1.0",
  "tool": { "name": "a5er-cli", "version": "0.0.0" },
  "status": "degraded",
  "command": "inspect",
  "source": {
    "path": "schema.a5er",
    "sizeBytes": 4321,
    "sha256": "…",
    "encoding": { "detected": "utf-8", "bom": true, "declared": "UTF8", "mismatch": false },
    "format": { "declared": null, "effective": null, "known": false }
  },
  "schema": { "objects": [], "relations": [], "pages": [], "domains": [], "commonFields": [] },
  "unsupported": [
    { "kind": "unknown-section", "sectionKind": "unknown", "sectionHeader": "[Memo]",
      "key": null, "reason": "no-registry-entry",
      "span": { "sectionIndex": 5, "startLine": 102, "endLine": 105, "keyLine": 102 } }
  ],
  "diagnostics": [
    { "code": "S_HEADER_UNKNOWN_FORMAT", "severity": "warning",
      "message": "The file declares no FORMAT, or one this tool does not know",
      "details": { "declared": null },
      "span": { "sectionIndex": 0, "startLine": 1, "endLine": 1, "keyLine": 1 },
      "construct": "Header" },
    { "code": "S_UNKNOWN_SECTION", "severity": "info",
      "message": "A section this tool does not model was preserved verbatim",
      "details": { "section": "[Memo]", "keys": 3 },
      "span": { "sectionIndex": 5, "startLine": 102, "endLine": 105, "keyLine": 102 },
      "construct": "Section" }
  ],
  "completeness": {
    "sections": { "total": 5, "parsed": 4, "preservedRaw": 1 },
    "keys":     { "total": 41, "parsed": 38, "preservedRaw": 3 },
    "dropped":  0
  },
  "limits": { "maxBytes": 67108864, "truncated": false }
}
```

Abbreviated: one `inspect` of a five-section file that has no `FORMAT` header and carries an
unmodelled `[Memo]` section. Arrays are elided to a single entry; every real `unsupported`
record also carries the verbatim `raw` line(s), omitted here only for width.

Contract rules:

1. **`status`** is `ok` (nothing above `info`), `degraded` (warnings/errors, schema emitted) or
   `failed` (fatal, `schema: null`). A `failed` envelope is still valid JSON — automation
   should never have to distinguish "no output" from "crashed".
2. **`dropped` must be `0` by reconciliation, not by assertion.** For every fixture,
   `sections.total` and `keys.total` must equal structured + raw-preserved + unsupported-reported
   using that fixture's concrete counts; `dropped` is the arithmetic remainder of the
   reconciliation and must come out as zero (§13). A bare `dropped === 0` proves nothing on its
   own. `unsupported` entries are *not* drops — they are retained evidence.
3. **Span presence**: every node that exists in the file — object, entry, column, index,
   relation, position, diagnostic — carries a `Span`. A node the resolver synthesised has
   `span: null`, `origin` other than `declared`, and cites its inputs in `derivedFrom` instead
   (the `primaryKey` in the example); `origin` and `span` therefore always travel together
   (§4.2).
4. **Raw is always adjacent to interpreted.** A column's `defaultValue.value` never appears
   without `defaultValue.raw`.
5. **`contractVersion`** is versioned independently of the package version (TBD-O5).
6. Unknown envelope fields are additive; removing or renaming one is a `contractVersion` bump.
7. **One `diagnostics` list, not separate `warnings` and `errors` arrays.** Severity is a
   field, so ordering follows the file and a consumer never has to merge two streams to
   reconstruct causality. `unsupported` stays separate because it is evidence, not a
   judgement about correctness.

A single object, abbreviated, to show span/raw/origin co-location:

```json
{
  "kind": "entity",
  "pname":     { "value": "users", "origin": "declared", "raw": "\"users\"",
                 "span": { "sectionIndex": 2, "startLine": 31, "endLine": 31, "keyLine": 31 } },
  "lname":     { "value": "ユーザー", "origin": "declared", "raw": "\"ユーザー\"", "span": { "…": "…" } },
  "primaryKey":{ "value": ["id"], "origin": "inferred",
                 "derivedFrom": [{ "keyLine": 33, "ordinal": 0 }], "span": null },
  "indexes":   [{ "name": { "value": "users_ix1", "origin": "declared", "raw": "\"users_ix1\"" },
                  "uniqueness": { "value": "unique", "origin": "declared", "raw": "1" },
                  "columns": { "value": ["user_name", "birthday"], "origin": "declared",
                               "raw": "\"user_name,birthday\"" },
                  "origin": "declared" }],
  "effectiveColumns": { "status": "complete", "columns": [] }
}
```

Open contract points are listed as TBD-O4–O6; none blocks Phase 2 stage 1–4.

---

## 13. Completeness accounting

Three counters, computed during parse and resolved output, never estimated:

| Counter | Definition | Invariant |
|---|---|---|
| `sections.total` | Every `[…]` header in the file, known or not | equals parsed + preservedRaw |
| `keys.total` | Every `key=value` line in every section | equals parsed + preservedRaw (decoded legacy keys count as parsed) |
| `dropped` | Constructs that were read and then discarded | arithmetic remainder of the two rows above; **must be 0** |

`dropped` is a reconciliation, not a switch. The guarantee is that every section and key counted
in `total` is accounted for on the right-hand side with the fixture's concrete numbers, and the
remainder is asserted to be zero. Asserting `dropped === 0` alone proves nothing — a parser that
never increments `total` would pass it. A test that reconciles the totals will fail the day a
code path learns to skip, which is the only durable defence against the failure mode this project
exists to avoid (D8, L4); both evaluated parsers fail precisely here (`parser-evaluation.md` §4 —
"neither reports what it skipped").

The counters are **derived, never accumulated**. Both stages recompute them by walking the
records they stored — lines, section headers, keys, comments, blank positions, raw lines — and
then verify the partition from the other side: every source line must be claimed by exactly one
record, and every record's `sectionIndex` must name a section that exists (or the header region
before the first one). A line claimed twice, a line claimed by nothing, or a `sectionIndex` that
names no section raises a typed error, because it is a defect in the tool rather than in the file.
Accumulating the same numbers in a second place during classification is what R15 removed: two
bookkeeping paths can drift silently, and only one of them would be tested.

`unsupported` is separate and expected to be non-empty: `Subtype` membership, unknown
`ShapeType`, undefined vertex format, multi-line values, unknown keys and sections.

---

## 14. Adversarial inputs (Phase 2 fixture matrix)

Every row is a required fixture plus an assertion. "Fatal" means `status: "failed"` **and** no
schema key — never a partial diagram.

| # | Input | Expected behaviour | Assertion |
|---|---|---|---|
| 1 | UTF-8 with BOM | parses, no diagnostic | `encoding.bom === true`, status ok |
| 2 | UTF-8 without BOM | parses, `D_BOM_MISSING` (info) | diagnostic present, status ok |
| 3 | Shift_JIS bytes under `ENCODING:UTF8` | decodes as SJIS, `D_ENCODING_MISMATCH` | Japanese names correct; no U+FFFD anywhere |
| 4 | Invalid UTF-8, no valid candidate | fatal `E_UNDECODABLE` | status failed, no schema |
| 5 | Japanese logical names and comments with `\Q`, `,`, newline, TAB, backslash | round-trip exact | every escape reproduces the source character |
| 6 | Multi-table and multi-view document | all objects, correct count | counts match fixture; no duplicate identity |
| 7 | Composite PK (`0,1,2`) | `primaryKey` inferred in ordinal order | order preserved; spans cited |
| 8 | Multi-column relation and multi-column index | columns split correctly | `["user_name","birthday"]`, not three fragments |
| 9 | Unknown section and unknown key | preserved + diagnosed (info) | `unsupported` non-empty, `dropped === 0`, status ok |
| 10 | Duplicate scalar key, missing required key | last wins + warning; missing → error/warning | both spans present; no crash |
| 11 | Truncated read (limit or mid-file) | fatal, no partial schema | `status: "failed"`, `schema` absent, `limits.truncated === true` |
| 12 | File above `maxBytes` | fatal before allocation | `E_LIMIT_BYTES`, constant memory |
| 13 | Schema-valid but referentially broken (dangling entity, column, page) | parses fully, warns | all three `V_DANGLING_*` codes; status degraded |
| 14 | Input immutability | file unchanged after every command | mtime and sha256 identical before/after |
| 15 | Hostile bytes: NUL-laden, CR/LF/CRLF mixed, no trailing newline, BOM mid-file, 1 MB single line | no crash, no mojibake, correct line spans | binary → fatal; others parse with diagnostics |
| 16 | Empty / whitespace-only / zero recognised sections | fatal | `E_EMPTY_INPUT` or `E_UNRECOGNIZED_DOCUMENT` |

Fixture policy (L5, D8): fixtures are committed with expected JSON, and **a fixture must
contain the construct it claims to test**. Neither evaluated parser could demonstrate index
support because its sample had no `IndexInfo` line; the same trap is closed here by
construction.

The status in each assertion above is derived mechanically and only from severities, as §11 and
§12 rule 1 define it: `failed` if any fatal, `degraded` if any `error` or `warning`, `ok`
otherwise — so rows 2 and 9 expect `ok` because `D_BOM_MISSING`, `S_UNKNOWN_SECTION` and
`S_UNKNOWN_KEY` are `info`. This is the correction `docs/test-strategy.md` §8 was waiting for;
that document's own §8 rule already reads this way.

---

## 15. Technology envelope

| Decision | Value | Reason |
|---|---|---|
| Language | TypeScript, `strict: true` plus `noUncheckedIndexedAccess` | Array index access is pervasive in a tokenizer; the flag is what makes `parts[8]` an honest `T \| undefined` (F4) |
| Runtime | Node >= 24 | `TextDecoder` with `fatal` and full-ICU codecs; native ESM; matches `engines` in `package.json` |
| Package manager | pnpm 11.28.12, pinned in `packageManager` | Aligns the local toolchain with CI, which resolves the version from that field |
| Modules | ESM only (`"type": "module"`, `NodeNext`) | Node-native; no dual-package hazard |
| Tests | Vitest | Fast, ESM-native, no transform config |
| Package | `@j1nn0/a5er-cli`, binary `a5er`, `private: true` until release | Given |
| Licence | MIT (matches `LICENSE`) | Given |
| Runtime dependencies | **none** | The format needs no parser library: line scanning, `TextDecoder` (UTF-8/UTF-16LE/Shift_JIS via ICU), `node:crypto` for sha256, and `JSON.stringify` cover every requirement (§8.2 verified locally). Adding a dependency would add a supply-chain and licence surface for zero capability |
| Dev dependencies | `typescript`, `vitest`, `@types/node` | Minimum to build, typecheck and test; no linter/CI matrix is decided in this unit |

Planned layout (not created in this unit):

```
src/
  cli/          command dispatch, flags, exit-code mapping, text renderer
  io/           bounded read-only read, stat before/after, sha256
  decode/       BOM sniff, fixed-order strict decode chain, authoritative header parse, codec probe
  syntax/       line scanner, complex splitter, Field/Position/Index decoders
  schema/       section-scoped key registry, FORMAT profiles
  model/        Span, Value, RawEntry, AST, ResolvedSchema types
  resolve/      PK, indexes (canonical + legacy), pages, domains, common fields
  validate/     referential and structural checks
  json/         envelope serialisation, completeness counters
  diagnostics/  code enum, severity, factory, truncation
```

Module responsibilities, one line each, with the invariant that makes the boundary non-negotiable:

| Module | Responsibility | Must not | Invariant |
|---|---|---|---|
| `io/` | Bounded read, sha256, stat before and after | Write, hold a partial buffer, follow the input through a rename | A18 |
| `decode/` | BOM sniff, fixed-order strict decode chain, authoritative header parse, codec probe | Emit lossy text or U+FFFD | L3, §8.2 |
| `syntax/` | Line scanner, complex splitter, `Field`/`Position`/`IndexInfo` decoders | Resolve references, drop a line, join continuations | F3, F4, §7.3 |
| `schema/` | Section-scoped registry and FORMAT profiles | Treat an unregistered key as structured, or a key name as globally meaningful | F1, F2 |
| `model/` | `Span`, `Value`, `RawEntry`, AST and resolved types | Contain `any`, or an untyped attribute bag | L1, A4 |
| `resolve/` | PK synthesis, index interpretation, page/domain/common-field resolution | Mutate the AST, or invent facts where the spec is silent | F5, F7, D6 |
| `validate/` | Referential and structural checks | Repair, re-parse, or abort the run | A2 |
| `json/` | Envelope serialisation and completeness counters | Emit twice, or mix prose into stdout | §12 |
| `diagnostics/` | Code enum, severity, factory, 200-char truncation | Interpolate file content into `code` or `message` | A12 |
| `cli/` | Dispatch, flags, exit-code mapping, text renderer | Open the input for anything but reading | A17 |

---

## 16. Decisions taken here

| # | Decision | Forced by | Rejected alternative |
|---|---|---|---|
| A1 | Registry keyed `(sectionKind, key)`; no global key table | F1 | A flat key map plus a deprecation blacklist (corrupts Shape/Line/Comment) |
| A2 | AST (syntax) and `ResolvedSchema` (semantics) are separate types; parse cannot fail on semantics | F10, K13, brief | One merged model where a dangling reference aborts the parse |
| A3 | Line spans only, no byte offsets in v1 | §4.1 cost analysis, U4 | Byte ranges that diverge from decoded strings after transcoding |
| A4 | Every interpreted value is `Value<T>` with `origin` and `raw` | D3, declared-vs-inferred requirement | Bare primitives with a separate side-table of provenance |
| A5 | No `Record<string, unknown>`; unmodelled data is a typed ordered `RawEntry[]` | L1 | An open attribute bag (the evaluated parser's `manager: Record<string, unknown>`) |
| A6 | Legacy keys always preserved; decoded under the FORMAT gate; `V_INDEX_LEGACY_ONLY` when sole evidence | F2, D5, L6 | Applying the spec's "ignore legacy" note literally (loses every index in older files) |
| A7 | Absent/unknown FORMAT ⇒ both canonical and legacy decoders on, warning, never fatal | F2, U1, D2 | Assuming the newest format, or refusing the file |
| A8 | No lossy decoding; undecodable is fatal | L3 | The borrowed chain's final `utf-8-lossy` step (mojibake in names) |
| A9 | Any limit breach or early stop ⇒ failed envelope, no schema | Fail-closed requirement, `not-attempted` pattern | Partial schema with a warning |
| A10 | Whole-file decode, no streaming in v1 | §10.3 | A streaming decoder that still materialises the AST |
| A11 | Zero runtime dependencies; startup codec probe | §15, §8.3 | `iconv-lite` or a CSV/INI parser dependency |
| A12 | Closed diagnostic codes; untrusted file content only in `details`, truncated to 200 chars | L2, borrowed warning-split idea | Interpolating values into message strings |
| A13 | `completeness.dropped` must be 0 *by reconciliation* — totals asserted with concrete per-fixture values, never as a constant | D1, F6, §13 | A `dropped === 0` assertion that counts nothing |
| A14 | Subtype membership emitted as `unsupported`, entities not guessed | F7, D6, K11 | Inferring membership from position or naming |
| A15 | Colours stored raw plus best-effort RGB with `channelOrder: 'assumed'` | F8, K10 | Picking one channel order and presenting it as fact |
| A16 | Presentation and DDL switches are preserved and classified, never interpreted | F9, D7 | Deriving DDL or constraint names from `DefaultPkName` templates |
| A17 | Scalar duplicate keys: last occurrence wins, all occurrences kept, both spans reported | U5, U6, §9.3 | First-wins, or refusing the file |
| A18 | Read-only by construction: `'r'` open, pre/post stat, no temp files | Brief, immutability goal | Reading with a write-capable handle and relying on discipline |

Conservative posture for the unconfirmed items — the tool never upgrades a guess into a fact:

| Unconfirmed item | Posture taken | Where |
|---|---|---|
| U1, U5, U6 — absent/unknown FORMAT, duplicate `[Manager]`, duplicate scalar keys | Accept and warn; scalars resolve last-wins with every occurrence and span retained | A7, A17, §9.3 |
| U2 — the FORMAT 20 hole | Treated as legacy-capable, warned, never inferred backwards | §6 |
| U3, U4 — encoding variants, line endings | Bytes win over the header; CRLF, LF and CR accepted; no lossy fallback | §8 |
| U7 — legacy `Index` payload in real files | Decode the observed shape, otherwise preserve raw and flag it | §9.2 |
| U8 — relation arity and referential rules | Report mismatches and dangling references; never enforce invented rules | §9.2, §14 row 13 |
| U9, U12 — vertex point format, multi-line values | Preserve raw text; never parse the inner format or join lines | §7.3, §9.6 |
| U11 — `[Subtype]` membership | `unsupported`, never inferred | §9.6 (F7) |
| U13 — colour channel order | Raw token plus best-effort RGB, `channelOrder: 'assumed'` when ambiguous | §9.5 |
| U14 — `RelationType1` / `RelationType2` required versus defaulted | Follow 必須: emit `null` plus a warning, do not silently default | §9.2 |
| U15 — 9-element `Field` prevalence in real files | Positional decode, `elementsSeen` recorded so the shape is measurable | §7.2 |
Every A-item that resolves an unconfirmed format question is labelled as a **project choice**,
not as spec behaviour. None of U1–U15 is presented as settled by these decisions.

---

## 17. Open points for Phase 2

| ID | Open point | Default until decided | Owner |
|---|---|---|---|
| TBD-O1 | Byte offsets in spans (only if a consumer needs binary extraction) | Absent | Phase 2, stage 1 |
| TBD-O2 | Streaming threshold for very large files | None; `maxBytes` only | Phase 2, stage 2 |
| TBD-O3 | Final limit defaults (`maxBytes`, `maxLines`, `maxLineLength`) | The values in §10.2 | Phase 2, stage 2 |
| TBD-O4 | Whether a JSON Schema file ships with the CLI | Not in v0.1.0 | Phase 2, stage 7 |
| TBD-O5 | `contractVersion` bump policy and its relation to package semver | Independent versioning | Phase 2, stage 7 |
| TBD-O6 | Whether the AST is exposed behind a flag (`--ast`) | Not exposed | Phase 2, stage 7 |
| TBD-O7 | Exit code for non-`validate` commands when `error`-severity diagnostics exist | 0 (only `validate` returns 3) | Phase 2, stage 7 |
| TBD-O8 | Whether `export` exists as a command or `inspect --format` covers it | Not decided | Phase 3 |

---

## 18. Phase 2 sequencing pointer

This is a pointer, not a plan: the order is fixed by dependencies, and each stage exits only
when its fixtures pass.

1. **Fixtures first** — synthetic, spec-derived fixtures for the §14 matrix. Implementation does
   not wait for real exports: those are local-only verification and a pre-release gate (see
   `docs/test-strategy.md` §3.8). Exit: every row has a committed fixture and a semantic
   expectation (counts, codes, spans); an `IndexInfo`-bearing fixture exists. JSON goldens are
   completed in stage 6, once the serializer exists.
2. **`io` + `decode`** (§8, §10). Exit: rows 1–4, 11, 12, 14, 15, 16 pass; immutability asserted.
3. **`syntax` + `schema`** (§5–§7). Exit: rows 5–10 pass; completeness reconciles on every parsed fixture.
4. **`model` + `resolve`** (§4, §9). Exit: rows 6–8, 13 pass; spans present on every node.
5. **`validate`** (§9, §11). Exit: row 13 emits the exact expected codes; severity mapping fixed.
6. **`json`** (§12–§13). Exit: envelope shape frozen at `contractVersion 0.1.0`; expected
   envelopes are then authored from the stage 1–5 semantic expectations and reviewed, never
   produced by blessing parser output.
7. **`cli`** (§12, TBD-O7). Exit: one command end-to-end with a real fixture, stdout/stderr separated.

Stages 2–4 are independently testable; stage 1 gates them only in the sense that the fixtures
must exist — real exports are not an entry gate (`docs/test-strategy.md` §3.8). No stage may
ship a "temporary" silent skip to pass its fixtures — A13 exists to make that visible.

---

## 19. Non-goals

- Reimplementing A5:SQL's DDL generation, drawing, or constraint-name templates (F9, D7).
- Writing `.a5er` files, or any command that mutates the input (A18).
- Resolving user domains or `@`-system domains to RDBMS-specific SQL types (P12).
- Inferring `[Subtype]` membership (F7, A14).
- Interpreting colour channels as authoritative (F8, A15).
- Claiming any U1–U15 item as spec-defined (F10, §16 closing note).
