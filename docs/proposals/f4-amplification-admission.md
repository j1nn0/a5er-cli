# Proposal — F4-D1: amplification admission for relation columns and common columns

> **Status: draft design proposal. Not implemented, not calibrated, not approved.**
> Nothing here is shipped behaviour and no threshold is decided. This document changes no code,
> test, fixture, golden, contract or version. It designs two R1 controls — one new envelope counter
> and one `tables` budget member reusing an already-published bound — plus an R2 counter for a later
> unit, states which figures are derived and which are estimates (labels below), and leaves every
> ceiling value open (§5, §9) for management to decide before any implementation branch starts.

| | |
|---|---|
| Baseline | `main` at `8df73ea8fa4f79880196cfab79497be65437e031` |
| Package | `@j1nn0/a5er-cli` `0.1.2` |
| Contract | `CONTRACT_VERSION` `0.1.0`, and it stays `0.1.0` (§6) |
| Tracks | [issue #27](https://github.com/j1nn0/a5er-cli/issues/27) (F-4) |
| Scope | R1: one additive envelope counter plus one `tables` budget member adopting an already-published bound. R2: one additive envelope counter, as a separate later unit |
| Out of scope | ceiling values (§5), Field-heavy JSON, unknown-key volume, unrelated diagnostics, streaming or plan-B projection, read-limit changes, measurement runs |

Normative words: **must**, **must not** and **never** are requirements on an implementation that
this proposal would authorise. "Today" means the baseline above. Every claim carries one of four
labels:

| Label | Meaning |
|---|---|
| **measured** | Observed in a run recorded in this repository, with its environment. Not re-run for this proposal. |
| **derived** | Follows by arithmetic or by the code's own invariants; no run needed, and no run is claimed. |
| **estimate** | Arithmetic on the shape of a written record. A planning figure, not an observation. |
| **proposal** | A design decision this document recommends. Not implemented, not accepted. |

**Recommendation in one paragraph.** Keep all seven shipped ceilings and both shipped post-scan
counters exactly as they are, and add **two controls computed from figures the measurement loop
already produces** before `classify()` runs. **R1** covers both profiles: the envelope profile gains
one composite code-unit counter per relation value (`L² + L`, summed) for the `n × L` representation,
and the `tables` profile gains the already-published slot bound — `relationColumnSlotsUpperBound`,
Σ(`L + 1`), a count of columns — as a new budget member, because a `tables` *document* cost per
column is bounded by about one diagnostic (fixed message, details cut at 200 code units), so a count
is sufficient for that cost there. The composite stays off `tables`:
it would refuse the committed 12,100-byte anchor that `tables` is designed to answer. **R2** — name
length in common-column composition — stays a **separate, later unit** and adds one name-length-
weighted counter on the envelope profile only. Both controls are additive: no existing counter,
ceiling, unit, refusal order or fatal shape moves. Neither is a bound on memory, RSS or the envelope
(§3.6, §4.3, §5.2.1).

## 1. Problem statement and the current implementation

### 1.1 What admission is for, and what it is not

The read limits bound the **input** (§`src/io/limits.ts:17-22`: `maxBytes` 64 MiB, `maxLines`
2,000,000, `maxLineLength` 4 MiB) and say nothing about the **work** an accepted document asks for
(`docs/architecture.md` §10.5; module comment at `src/budget/admission.ts:55-70`). Admission
therefore runs twice per document — a pre-scan walk before the scan
(`src/pipeline.ts:116-118`) and a measurement of the finished scan before `classify()`
(`src/pipeline.ts:124-125`, classification at `:127`) — and compares seven figures today. Each
is a **shape proxy**: the counters count occurrences and code units, and the ceilings
name how much of that shape this build tolerates. None of them is a byte, heap or RSS bound
(`src/budget/measure.ts:305-316`, §10.5).

Three figures target the two amplifying stages, and only two of them reach a decision today:

| Stage | Figure today | Where it is computed | Compared by |
|---|---|---|---|
| Relation columns, envelope | `relationValueLengthSquares` (Σ`L²`) | `src/budget/measure.ts:479-493`, accumulation at `:123-150` | `inspect`, `validate` |
| Relation columns, slots | `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`) | `src/budget/measure.ts:514-522`, type at `:353-361` | **nobody** — published and unit-tested (`tests/budget-measure.test.ts:518-576`, `:790-800`), read by neither gate |
| Common-column composition | `composedColumnsUpperBound` (`[Entity]` sections × `CommonField=` lines) | `src/budget/measure.ts:499-512`, type at `:319-347` | `inspect`, `validate`, `tables` |

`tables` deliberately has no Σ`L²` member: its budget type has no such field, so "the absence is
structural, not numeric" (`src/budget/admission.ts:84-98`, `docs/architecture.md` §10.5
lines 869-880). The same paragraph explains the defect this correction addresses: the slot bound is
also absent from `TablesResourceBudget`, and the `tables` branch of `admit()` compares exactly one
figure (`src/budget/admission.ts:332-341`), so the count that would give `tables` a relation control
is published, tested and never read.

### 1.2 R1 — the relation-column path

One `Fields1`/`Fields2` value of raw length `L` becomes a column list in
`columnsOf` (`src/semantic/relations.ts:174-204`). The inner loop is the amplification:

```ts
// src/semantic/relations.ts:188-200
const parts = value.trailingElementsOmitted ? value.parts.slice(0, -1) : value.parts;
for (const part of parts) {
  for (const name of part.value.split(',')) {
    columns.push({
      pname: unescapeEscaped(name),
      raw: partRaw(part),
      span: occurrence.span,
      index: columns.length,
      empty: name === '',
    });
  }
}
```

`partRaw` (`src/schema/values.ts:232-234`) returns the **whole element text** for every slot, so a
value of `L` code units that yields `n` slots retains `n` records whose `raw` is about `L` long.
`n` is linear in the value's text (`n ≤ L + 1`, one separator per code unit), but the retained and
emitted size is the **product** `n × L`. The slot count is already published as
`bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`)
(`src/budget/measure.ts:514-522`, type comment `:353-361`) and is verified to cover the listed slots
on every fixture (`tests/budget-measure.test.ts:790-800`), yet no gate compares it today.

The JSON writer then repeats the same shape
(`src/json/serialize.ts:846-863`): per column it emits `{pname, raw, span, index, empty}` and per
list it emits the whole value again as `raw`; the envelope also carries the value as
`scalars[].raw` and `scalars[].value.parts[].value` (`:882-903`, `:564-573`). `inspect`/`validate`
build that envelope as one string (`src/cli.ts:304`, `src/json/index.ts:83`).

**The gap.** Σ`L²` sees the product term and is blind to the count of short values. A document of
one-unit relation values, each splitting into two slots, is admitted today: 399,999 such lines in
one `[Relation]` section put the content-line count at exactly 400,000, its envelope ceiling, Σ`L²`
is 399,999 against a ceiling of 134,217,728, and the composed bound is 0. The envelope still carries
about 800,000 column records to render, about 103 MB at 128 characters per record plus the `raw`
copies (**estimate**, §2.3). The provisional R1 ceiling of §5.2 does not refuse this document
either — it is non-binding by construction — so only a calibrated value can decide about it.

**The `tables` half of the same gap, and why its shape differs.** `tables` renders no relation
columns, but it carries the whole diagnostics list: `buildTablesEnvelope` copies
`shared.diagnostics` (`src/view/tables.ts:350`, `:367`), and `sharedEnvelopeMembers` builds that list
through `jsonDiagnostic` (`src/json/serialize.ts:1435`, `:1305-1314`). One `V_DANGLING_COLUMN` is
emitted per unmatched non-empty slot (`src/semantic/partial.ts:243-251`, fed by
`src/semantic/relations.ts:353-375`), so a slot-heavy document becomes a diagnostic-heavy
`tables --format json`. The per-record cost is **bounded**, not multiplied: the message is fixed and
every string detail is cut at 200 code units (`src/diagnostics/diagnostic.ts:150-173`, `:321-324`).
That asymmetry is what makes a count ceiling sufficient for the `tables` **document** this profile
writes, and a product term unnecessary for it:
the manager report's 15.9 MB for about 57,000 diagnostics implies about 279 bytes per diagnostic, with
a ceiling of about 810 bytes worst case (**arithmetic on the manager's measurement**, not a new
observation). Both formats pay it: one document is built before either writer runs
(`src/tables-command.ts:116-120`), so `tables` text retains the same objects and only writes less
(`src/text/tables.ts:311-373`; stderr receives only `fatal`/`error`, `src/text/diagnostics.ts:28-36`).
Every current `tables` ceiling admits such a document: with no `[Entity]` the composed bound is 0, and
the pre-scan figures count lines, not columns (§5.2.1).

### 1.3 R2 — the common-column path

`commonColumnsOf` (`src/semantic/common-columns.ts:284-368`) gives every entity that adopts the
common columns its own copies: `declared` (fresh objects), `composed` (fresh objects, one per
decoded declaration, `:311-320`), the `effective` array, and then a second array of copied objects
that adds `collision` (`:347-359`). The decoded declaration records themselves are shared, so the
object cost is `E × (D + 2C)` where `D` is an entity's declared columns and `C` the declaration
count, and the name strings are references at this stage, not copies.

The envelope is where name length starts to multiply: `jsonEntityColumns`
(`src/json/serialize.ts:678-707`) writes `columns` (the effective list), `declared` **and** `common`
through `jsonEffectiveColumn` (`:664-676`), so **every composed column is written twice per entity**
and a colliding one a third time in `collisions`. `tables` writes four counts per column list
(`src/view/tables.ts:405-411`, `src/text/tables.ts:148-196`) plus the object's own `pname`/`lname`,
and no per-column text: a column name's length does not reach its output.

**The gap.** `composedColumnsUpperBound = E × C` measures the count of compositions, not their
content. At its own envelope ceiling (524,288) with 1,000-code-unit names the metadata would render
about 1 GB of name text (**estimate**: 2 × 524,288 × 1,000 ≈ 1.05 × 10⁹ characters), while the
counter reports 524,288.
For `tables` the same 524,288 compositions are pointer arrays over shared strings, which is a real
but different cost; the `tables` ceiling (4,194,304) exists for that cost, not for name text. The
manager report's R2 row is the recorded instance of this gap: about 67 KB of input became about
1.32 MB of `inspect` JSON, growing with entities × common columns × name length, and the composed
counter reported the same count regardless of that length (§2.1).

### 1.4 What is not in question

The two shipped counters are sound at what they measure and are pinned by tests
(`tests/budget-admission.test.ts:126-233` for the seven defaults;
`tests/budget-measure.test.ts:518-576` for the slots bound, `:460-518` for the composed bound).
Nothing in this proposal weakens them, and no existing ceiling value changes (§6.4).

## 2. Measured evidence versus estimates

### 2.1 What is measured, and where it is recorded

Every row taken from `human-cli.md` §7.1 was observed once on Linux (Ubuntu, kernel 7.0, 8 CPUs,
30 GB RAM) with Node `v24.22.3`, V8 heap limit 4,288 MiB and maximum string length 536,870,888
code units; Node 26, Windows and macOS were not measured
(`docs/proposals/human-cli.md:1432-1436`). Those conditions are part of every row below.

| Observation | Recorded in | Label |
|---|---|---|
| 616,068-byte input (one 200,001-character `PName`, 3,999 short entities) → `inspect` exit `0`, 17,032,749-byte envelope, 0.69 s, 232 MB peak RSS | `docs/proposals/human-cli.md:1452`, `docs/architecture.md` §10.3 lines 790-800 | **measured** |
| 816,067-byte input → 25,832,745-byte envelope, 259 MB peak RSS | `docs/architecture.md` §10.3 lines 790-800 | **measured** |
| 20,878,001-byte input of 1,999,000 unknown keys → `RangeError: Invalid string length` in `toJsonString`, exit `1`, no envelope, 3.0 GB peak RSS | `docs/architecture.md` §10.3, `docs/proposals/human-cli.md:1454` | **measured** |
| 11,377,891-byte input of 200,000 `Field` lines → `inspect` exit `0`, 372,293,684-byte envelope, 8.0 s, 1.78 GB peak RSS | `docs/proposals/human-cli.md:1455` | **measured** |
| 67,108,851-byte input of 1,155,516 `Field` lines → pipeline heap 2,847 MiB, `serialize()` aborts on a 4,288 MiB heap, exit `134` | `docs/proposals/human-cli.md:1456`, §10.3 | **measured** on the pre-U5-ADMIT2 build; not re-run since |
| One ~12,100-byte document whose relation values put Σ`L²` at 144,048,020 → refused by `inspect`/`validate`, admitted by `tables` | `docs/test-strategy.md:456-467`, `tests/pipeline-admission.test.ts:967-1013` | **measured** (a shipped-ceiling refusal, in the suite) |
| Fixture maxima over the 39 synthetic fixtures: Σ`L²` = 277, composed = 2 | `tests/pipeline-admission.test.ts:888-905` | **measured** |
| **F4-M1A R1, `tables`** — synthetic relation document of about 115 KB: `tables --format json` emitted about 15.9 MB and about 57,000 diagnostics; output grew linearly in the dangling-column count; no out-of-memory abort and no `RangeError` | manager F4-M1A report (attribution below) | **measured** (manager report) |
| **F4-M1A R2, `inspect`** — synthetic entity/common-column document of about 67 KB: `inspect` emitted about 1.32 MB; output grew with entities × common columns × name length; the composed counter is name-blind; no string-limit failure | manager F4-M1A report (attribution below) | **measured** (manager report) |

**The F4-M1A record, as the manager reported it.** Environment: macOS 15.8.3 arm64, Node 24.22.3;
baseline source `8df73ea8fa4f79880196cfab79497be65437e031`; CLI SHA-256
`ac84705bc06767e9520484740ae5a7dae30b311ffd5c58b249a197ef3639c01f`.
**R1:** about 115 KB in, about 15.9 MB of `tables` JSON, about 57,000 diagnostics, linear in the
dangling-column count, no OOM and no `RangeError`. **R2:** about 67 KB in, about 1.32 MB of `inspect`
JSON, growth of the form entities × common columns × name length, composed counter name-blind, no
string-limit failure. It is a manager report, not a record committed to this repository: it was not
re-run for this proposal, the per-diagnostic byte figures derived from it are **arithmetic** (§1.2),
and §5.5 requires a committed record of that shape before any `tables` ceiling ships.

### 2.2 What none of those measurements establish

* **The manager report isolates the two shapes, not the ceilings.** F4-M1A varies the R1 and R2
  constructions and reports output volume, diagnostic count and the qualitative growth, which is what
  §5.2.1 and §5.5 need to state a band. It does not report `relationColumnSlotsUpperBound`, Σ`L²` or
  `E × Σℓ` for those runs, so it cannot by itself set a ceiling; no other row reports `n`, Σ`L`, Σ`L²`
  or `E × Σℓ` either.
* **No measurement of the proposed counters exists.** The figures in §1.2, §1.3, §3 and §4 that are
  not cited above are **estimates** derived from the record shapes the serializer writes
  (`src/json/serialize.ts:664-676`, `:846-853`) or **derived** from the invariants in the code.
* **The recorded platform spread is real.** The issue #27 record, the `human-cli.md` rows and the
  F4-M1A report were taken on stated platforms and Node versions; heap ceilings, string limits and
  RSS differ between them. No number from any of them is used as a **shipped** threshold here, and
  the slot band of §5.2.1 is derived from F4-M1A's diagnostic count, not measured as a counter value.
* **`tables` measurements do not transfer to `inspect`.** `tables` streams in chunks
  (`src/json/stream.ts:1-49`) and builds its own document; `inspect`/`validate` build one string.
  The same input can be fatal for one and fine for the other.
* **Nothing here was re-run.** This proposal ran no load measurement and no out-of-memory
  reproduction, by instruction. Every measured row above is cited from a record, not reproduced.

### 2.3 Per-record size estimates used later

Three planning constants recur. All are **estimates** from the member lists of the writers or from
arithmetic on the manager report, not observations:

| Estimate | Value | Derivation |
|---|---|---|
| Column record in the envelope (`jsonRelationColumn`, `src/json/serialize.ts:846-853`) | ≈128 characters per record, excluding `raw` | the 4-character `raw` record below is 132 characters long, 128 of them not `raw`: `{"pname":"C1","raw":"XXXX","span":{"start":{"line":1000,"column":10},"end":{"line":1000,"column":2000}},"index":12345,"empty":false}` |
| Effective-column record in the envelope (`jsonEffectiveColumn`, `:664-676`) | ≈140 characters per record, excluding the two names | the same construction with `pname`, `logicalName`, `source`, `span`, `collision` gives 137 characters with both names empty and 148 with a 7-character and a 2-code-unit name |
| JSON escape factor `f` on a decoded name | 1–6 | `src/schema/values.ts:100-142`: `\n`/`\t` decode to one control character, which JSON writes back as `\n`/`\t` (2 characters) or up to `\u000b` (6) |
| Diagnostic record in the `tables` JSON (`jsonDiagnostic`, `src/json/serialize.ts:1305-1314`) | ≈279 bytes average, ≤ ≈810 bytes worst case | **arithmetic on the manager report**: 15.9 MB / 57,000 ≈ 279 B; worst case = fixed message (`src/diagnostics/diagnostic.ts:321-324`) + three details of ≤200 code units (`:150-173`) + span and member text |

## 3. R1 — options and recommendation

### 3.1 Options, and which profile each figure fits

| Option | Counter | Accuracy as an amplification gate | Extra cost | Available before `classify()` |
|---|---|---|---|---|
| A | Σ`Fields1`+`Fields2` code units (= `fields1ValueCodeUnits + fields2ValueCodeUnits`, `src/budget/measure.ts:484`, `:491`) | **Linear only.** Bounded by `maxBytes`, so a ceiling low enough to protect anything refuses legitimate linear documents; a ceiling above the byte limit never fires. Blind to `n × L`. | 0 — already computed | yes |
| B | `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`) | **Bounds `n`** — an over-count of `L + 1` per value, so it is linear in the text and never under-states the slots. Catches "many separators", not "one long value with many separators": it is ~`L` where the `inspect` output is ~`L²`. | 0 — already computed and verified on every fixture | yes |
| C | output-cost estimate over raw text | Closest to the observed cost; needs a second cost model that can drift from `serialize.ts` (and from `stream.ts`, a second writer). Blind to diagnostics and to the composed path. | medium, plus a permanent drift surface | partly |
| D | product term (Σ`L²`, present) + a linear term in one composite code-unit counter | **Bounds both halves of the observed cost** for every value with `L ≥ 1` (§3.3). | one multiplication and two checked additions per occurrence, `O(1)` memory | yes |

**Which row applies where.** B is the figure `tables` needs and D is the figure it must not have. A
`tables` **document** column costs a bounded number of bytes — one diagnostic, with fixed text and
details cut at 200 code units (§1.2) — so a count of columns is sufficient for that output; D's
product term is what `inspect`'s unbounded `raw` repetition needs (§3.3). Neither is a byte bound on
what the profile retains, and §3.6 says what each leaves out. The committed 12,100-byte anchor shows
why D cannot be the `tables` control: its composite is 144,060,026, so any composite ceiling low enough
to mitigate would refuse the document `tables` exists to answer. The envelope profile keeps D and does
not need B as a second shipped ceiling: for every value with `L ≥ 1`, the composite already dominates
the slot count (§3.3).

### 3.2 Recommendation (proposal)

**Take D for the envelope profile and adopt B for `tables`.** R1 therefore has two halves, and
neither half restates the other: one new counter on the envelope, one existing bound promoted to
a budget member for `tables`. Start with the counter — add **one** to `ResourceMeasure.counters`:

```
relationColumnCodeUnits = Σ over every Fields1/Fields2 occurrence in a relation section of (L² + L)
```

and keep `relationValueLengthSquares` (Σ`L²`) exactly as it is: same accumulation, same value, same
ceiling, still compared. The new counter is a composite on purpose — one figure that covers the
product term and the per-value linear term together, so the decision stays one comparison rather
than two that can disagree about which term is large.

* **Computed where the other counters are.** In the `kind === 'Relation'` branch of the existing
  loop (`src/budget/measure.ts:479-493`), from the `length` that branch already proves and reads, so
  there is no second pass, no second parser and no re-implementation of §7.3/§7.4.
  `addValueSquare` (`:123-150`) and `checkedAdded` (`:131-140`) already provide the checked
  arithmetic; the linear addend joins the same running total.
* **Additive, never a redefinition.** Σ`L²` keeps its unit (code units squared), its ceiling and its
  refusal identity. Units of the new figure are code units, deliberately: this is a shape proxy, not
  a byte count, and it must be documented as such in the same words Σ`L²` uses
  (`src/budget/measure.ts:305-316`).
* **The composite stays on the envelope profile.** It goes on `EnvelopeResourceBudget`, never on
  `TablesResourceBudget`: `tables` emits no relation text, and giving it a code-unit ceiling would
  refuse documents it can answer — the same structural argument the module comment already makes for
  Σ`L²` (`src/budget/admission.ts:84-98`).
* **`tables` gets the count instead.** Adopt the already-published
  `bounds.relationColumnSlotsUpperBound` as a new member of `TablesResourceBudget`,
  `relationColumnSlotsUpperBound`, with the semantics the measurement already documents: the sum
  over every `Fields1`/`Fields2` value in a relation section of the raw value's UTF-16 code units
  plus one — unit **slots**, a conservative upper bound that honours `trailingElementsOmitted`
  because the stage may drop one trailing slot and keeps one list per key
  (`src/budget/measure.ts:353-361`, `:514-522`; verified against the listed slots on every fixture,
  `tests/budget-measure.test.ts:518-576`, `:790-800`). It is compared in the `tables` branch of
  `admit()` **before** the composed bound, and is proved comparable with the other figures
  (`src/budget/admission.ts:332-341`, `:290-295`). No new accumulation, no new parser, no code-unit
  composite on a profile that emits no relation columns.
* **Compared second on the envelope profile**, after Σ`L²` and before the composed bound (§5.4), and
  its observation is proved comparable before the first comparison, as every figure in `admit()`
  already is (`src/budget/admission.ts:305-316`). The `tables` member sits first in its own branch
  (§5.4).

### 3.3 What the composite bounds, derived

Per value of raw length `L`:

* `n ≤ L + 1` slots (one separator per code unit; `src/budget/measure.ts:353-361`).
* Each slot costs `L` code units of `raw` plus a fixed `k` for `pname`, `span`, `index`, `empty` and
  the JSON member text — `k ≈ 128` characters per record (§2.3, **estimate**).

So the rendered cost of one value is at most `n·(L + k) ≤ (L+1)(L+k) = L² + (k+1)L + k`, and, over
the whole document, `Σ(L² + L)` covers the `ΣL²` and `ΣL` terms. Three further facts, **derived**:

1. For every value with `L ≥ 1`, `L² + L ≥ L + 1`, so the composite is also an upper bound on the
   slot count, hence on the number of records. This is why the linear term is redundant-looking in
   the `L = 1` case and still worth having: it is the term that keeps the figure from collapsing to
   "count of long values".
2. A value with `L = 0` (an empty `Fields1=`/`Fields2=`) contributes **0** to every Σ-shaped figure
   and still produces one record. The composite does not bound those. Their number is bounded by
   the pre-scan content-line ceiling instead (400,000 for the envelope profile; each empty value is
   one `key=value` line, §10.5), so the uncovered residue is at most 400,000 records, about 51 MB
   of envelope (**estimate**: 400,000 × 128). This residue is not closed by this proposal; it is
   already bounded today by a different gate, and §3.6 says so explicitly.
3. The same inequality is why `tables` gets the **count** and not the composite: the slot figure
   bounds the records, and the diagnostics are one per unmatched non-empty slot, so it bounds them
   too; the `L` factor that makes the composite a mitigation on `inspect` is exactly what would refuse
   a `tables` document whose real cost is two records (§3.2, §5.2.1).

### 3.4 Options rejected as the envelope control, and why

* **A alone.** Linear in the text, so it cannot distinguish the L² case from a large legitimate
  document; a ceiling that catches one refuses the other.
* **B alone, as the envelope control.** It bounds the *count* of columns, not their content: one
  value of 100,000 code units is bounded at 100,001 slots — a linear figure — while the `raw` text
  the list retains is about 10¹⁰ code units (**estimate**: 100,001 × 100,000). It is not rejected for
  `tables`, where that count is what matters (§3.2).
* **C.** Requires a cost model in `budget/` that mimics `serialize.ts` — a second bookkeeping path,
  which `src/budget/measure.ts:13-29` forbids, and a permanent drift risk against a second writer.
* **A second parser over the raw value** (split on commas in `budget/`) would contradict
  `columnsOf`'s own rules — tokenise first, split element contents, honour
  `trailingElementsOmitted` (`src/semantic/relations.ts:188-199`, `src/syntax/complex.ts:189-192`)
  — and the disagreement would be silent.

### 3.5 Why not the pre-scan walk

`measureSourceShape()` could compute the same sum one stage earlier
(`src/syntax/shape.ts:95-126`), but it would duplicate a figure `measure()` already publishes, and
that duplication needs an agreement test like the one pinning `entityFieldOccurrences`. The
post-scan gate is early enough: it runs before `classify()`, i.e. before `splitComplex` and
`columnsOf` allocate anything, which is the stage this counter is meant to refuse. The `tables`
member needs no pre-scan variant either: the count already exists in the same measurement the post-scan
gate reads, so early recomputation would only create a second figure to keep in agreement.

### 3.6 Non-coverage, stated as a requirement

An implementation must document each figure in its own doc comment and in §10.5. For
`relationColumnCodeUnits` (envelope profile):

* is **not** a byte, heap or RSS bound, in the words Σ`L²` already uses;
* does not cover the `k` term per record — coefficient 1 is a unit choice, not a weight (§5.3);
* does not cover empty relation values (`L = 0`), whose count is bounded by the content-line gate
  instead;
* says nothing about `[Entity]` `Field=` lines, unknown keys, diagnostics volume, or the composed
  path — those are R2, the pre-scan counters, or uncovered.

For `relationColumnSlotsUpperBound` on `tables`:

* is **not** a byte, heap or RSS bound either: it bounds a *record and diagnostic count*. A record
  built from a quoted element keeps its own copy of that element's text (`partRaw`,
  `src/schema/values.ts:232-234`), so the retained bytes of those records are `n × L` and are **not**
  bounded by this member — the count bounds what `tables` writes, not what it keeps;
* **over-counts** by construction (`L + 1` per value), so it refuses a document whose single column
  name is longer than the ceiling even though that document costs `tables` two records; the
  inflation is in the safe direction, and §5.2.1 records the class and why it is acceptable;
* says nothing about `[Entity]` `Field=` lines, unknown keys, or the composed path — those stay with
  the pre-scan figures and the composed bound.

## 4. R2 — options and recommendation

**Scope, unchanged by this correction.** R2 covers name length in common-column composition on the
`inspect`/`validate` envelope. It remains a **separate, later unit**: it shares no implementation
commit with R1 and adds no member to the `tables` profile, and the R1 correction adds no name-shaped
figure anywhere. What it must not become is a licence to skip the `tables` half of R1: that control
is a count (§3.2, §5.2.1).

### 4.1 Options

| Option | Bound | Sound? | What it fails to cover |
|---|---|---|---|
| A | current `E × C` | sound and cheap; verified to cover what entities adopt (`tests/budget-measure.test.ts:460-518`) | name length: `E × C` at the ceiling with 1,000-code-unit names renders about 1 GB of names (**estimate**: 2 × 524,288 × 1,000) |
| B | `E × Σc Lc` (name-length-weighted), added | sound-ish if it uses the **raw** line length and a 2–6× escape factor for the JSON | the per-record constant `≈140` characters and the collision spans; nothing about `Field` lines or diagnostics |
| C | output-amplification estimate from the raw text | closest to the observed cost, still pre-parse | a cost model that can drift from two writers (`serialize.ts`, `stream.ts`) |
| D | cap `C` alone, cap `E` alone, or cap total raw `CommonField` bytes | very cheap | each caps one factor of a product: `C = 10k, E = 1` is harmless; `E = 5,000, C = 40` is 200,000 columns — neither factor alone identifies it |

### 4.2 Recommendation (proposal)

**Take B, additively.** Add **one** counter:

```
composedColumnCodeUnits = [Entity] sections × Σ raw CommonField= value code units
```

and keep `composedColumnsUpperBound` (and its `entitySections`/`managerCommonFieldOccurrences`
factors) exactly as they are, compared as they are. The two together bound the written cost: if
`E·Σℓ ≤ C1` and `E·C ≤ C2`, then the composed-column text is at most
`2·(f·E·Σℓ + κ·E·C) ≤ 2·(f·C1 + κ·C2)` per envelope, with `f` the escape factor and `κ ≈ 140` the
per-record constant (§2.3) — **derived**, given the counters; the constants are estimates. That is
the reason to add rather than redefine: a redefinition would change what `524,288` and `4,194,304`
mean (§4.4).

* **Computed in the measurement loop.** In the `kind === 'Manager'` branch, accumulate
  `entry.value`'s length with the same `checkedValueLength` the relation branch uses
  (`src/budget/measure.ts:470-477`); multiply by `entitySections` once, after the loop, with
  `checkedProduct` (`:499-512` shows the pattern). `O(1)` memory, one extra addition per
  `CommonField=` line.
* **Code units of the raw value.** `entry.value` is the value as written (quotes and escapes
  included), which is the conservative direction: decoding can shorten it, JSON escaping can
  lengthen it by up to 6× (§2.3). The counter therefore must not be described as an upper bound on
  the envelope; it is a proxy whose escape factor is not represented.
* **Envelope profile only** (proposal). Name length is rendered only by `inspect`/`validate`: they
  write each composed name twice per entity (`src/json/serialize.ts:678-707`). `tables` writes four
  counts per column list and the object's two names, holds the same declaration strings by
  reference, and emits no per-column text, so a column name's length does not multiply its cost.
  Putting this ceiling on `TablesResourceBudget` would refuse documents `tables` answers, the exact
  mistake the Σ`L²` absence is designed to avoid.
* **Compared** after both existing post-scan figures on the envelope profile, before any pre-scan
  figure could matter (the pre-scan gate runs first in the pipeline, §5.4). Its observation is
  checked before the first comparison, like every other.

### 4.3 What the counter does not see, derived

* `ℓ = 0` declarations (empty `CommonField=` values) contribute 0 while costing `κ` each; their
  number is bounded by the existing `E × C` ceiling, so that residue is at most 524,288 records,
  about 73 MB of envelope (**estimate**: 524,288 × 140).
* Collision spans (`src/json/serialize.ts:684-690`) are written once more per colliding column and
  are not counted by either figure. They are bounded by the same `E × C` product.
* `Field`-heavy documents, unknown keys and diagnostic volume are untouched by this counter. They
  are covered today only by `entityFieldOccurrences` and `contentLineOccurrences`, and an
  implementation must not claim otherwise.

### 4.4 Why not a redefinition

Redefining `composedColumnsUpperBound` to `E × Σℓ` would change the meaning of two shipped
ceilings (`src/budget/admission.ts:130`, `:136`), the pinned defaults
(`tests/budget-admission.test.ts:126-233`), the §10.5 table (`docs/architecture.md` §10.5
lines 855-869) and the factor documentation in the counter's own type comment
(`src/budget/measure.ts:319-347`), all together — a meaning change dressed as a tuning change.
Architecture frames `counter` values as an open data set, not as values whose meaning may drift
(`docs/architecture.md:1228-1242`). Adding a figure leaves every published meaning intact and lets
the two ceilings be chosen independently.

### 4.5 Where the figure lives (a note for the implementer)

It is recommended as a **counter** (§4.2) rather than as a `bounds` object with published factors,
which is how `composedColumnsUpperBound` is shaped. The trade-off is honest: a counter publishes one
number and loses the two factors that would let a refusal be read as "which factor grew"; a bounds
object mirrors the existing style and adds two more numeric leaves. §9 asks management to confirm
the single-counter form; if it is not confirmed, the value and its comparison site move together and
nothing else in this design changes.

### 4.6 Sequencing

R2 lands after R1, as its own reviewed change (§8), and only after R1's `tables` count has a decided
ceiling (§5.5). Ordering it first would leave the profile this correction is about without any
relation control for as long as R2 takes, and would put two new members on `EnvelopeResourceBudget`
and none on `TablesResourceBudget` in the same commit — the imbalance the manager review rejected.

## 5. Threshold calibration and unresolved values

### 5.1 No ceiling is decided here

Three new ceilings are in play — two on the envelope profile (the R1 composite and, later, the R2
name length) and one on `tables` (the slot count) — and this proposal decides **none** of them. A
value may only be shipped after one of two records exists:

1. **a measurement record** — synthetic fixtures only, environment (platform, Node version, heap
   limit, maximum string length) recorded, and each figure's counter value reported per run together
   with the outcome; or
2. **an explicit decision to ship a figure that is not empirically proven**, recorded with that
   wording and with what it does and does not guarantee.

Today neither record exists for any of these figures (§2.2). Nothing below is a boundary of the
tool.

### 5.2 Candidate values and bands, labelled

| Figure | Value or band | How it is obtained | What it guarantees |
|---|---|---|---|
| `relationColumnCodeUnits` (envelope) | `201,326,592` = 2²⁷ + 2²⁶ | **derived**: Σ`L` ≤ the decoded text's code units ≤ `maxBytes` bytes = 67,108,864 — a decoded UTF-16 code unit never costs more than one UTF-8 byte, whatever the character's width (`src/io/limits.ts:19`; the Σ`L²` ceiling is `src/budget/admission.ts:129`) | **a consistency assertion only, never a mitigation**: it is provably never binding on a document the existing Σ`L²` ceiling admits, so `observed ≤ 201,326,592` always holds there and the comparison cannot change an outcome. It would catch a future accumulation bug |
| `relationColumnSlotsUpperBound` (`tables` member) | **no value chosen**; a derived band only | **derived from two shapes**: the committed anchor must stay admitted at 12,008 slots, and the manager's ~57,000-diagnostic shape sits at about 114,004 slots, so a `tables` ceiling `C` needs 12,008 < `C` < ≈114,004. That band is a factor ≈9.5 wide; `65,536` = 2¹⁶ is the only power of two in it (5.5× above the anchor, 1.7× below the measured shape) | nothing yet: the band states what a value must satisfy, not what it is. Neither endpoint is a measurement of this counter (§5.2.1) |
| `composedColumnCodeUnits` (R2, later unit) | `16,777,216` = 2²⁴ | **estimate**: equivalent to the existing 524,288-column ceiling when the mean raw declaration length is 32 code units (524,288 × 32) | caps the name-length term at a figure aligned with the shipped column ceiling **assuming** that mean length. If real names average longer it refuses earlier than the column ceiling would; if shorter, it adds nothing |

None of these is **empirically proven**. None may be described as a memory bound. The first is a
**consistency assertion, not a mitigation** — that is its whole purpose, and it may not be cited as
protection against the R1 shape: the mitigation is the decided value the band in the second row is
waiting for. R2's figure is neither, and its own unit ships later (§4.6).

#### 5.2.1 The `tables` band, the anchor it must keep, and the shape it must reject

Two committed or reported shapes fix the band (**derived**, not measured counter values):

| Shape | Slots (`relationColumnSlotsUpperBound`) | What `tables` pays today | Must be |
|---|---|---|---|
| The committed anchor: `overEnvelopeDocument()` (`tests/pipeline-admission.test.ts:1008-1017`), about 12,100 bytes, `Fields1` a 12,000-character name (raw value 12,002 code units), `Fields2` = `id` (raw 4), no `[Entity]` | (12,002 + 1) + (4 + 1) = **12,008** | 2 columns, 2 `V_DANGLING_COLUMN` + 2 `V_DANGLING_ENTITY` warnings, a few kilobytes of envelope | **admitted** — it is the document that proves `tables` is deliberately more permissive than `inspect`, which refuses it on Σ`L²` = 144,048,020 |
| The representative rejectable shape: one `[Relation]`, both `Fields1` and `Fields2` a comma-separated list of 200,001 names inside one quoted element (raw length 400,003 each) | bound (400,004) + (400,004) = **800,008** (the real slot count is 200,001 per value; the bound over-counts as designed) | 400,002 retained column records and **400,002 diagnostics**, about 112 MB of `tables --format json` (**arithmetic** at ≈279 B per diagnostic, §2.3) | **refused** |
| The manager's F4-M1A shape (§2.1): the same construction at about 115 KB | about **114,004** | about 57,000 diagnostics, about 15.9 MB of `tables` JSON (**manager report**) | must be refused by any real mitigation |

Every shipped `tables` ceiling admits the middle row today: `entityFieldOccurrences` 0 ≤ 500,000,
content lines 5 ≤ 1,000,000, `composedColumnsUpperBound` 0 ≤ 4,194,304, and the input is about 800 KB
over 7 lines with 400,003 code units on a line — all inside `maxBytes`, `maxLines` and
`maxLineLength` (`src/io/limits.ts:17-22`). That is the hole the new member closes, and the count is
the right shape for it: one diagnostic per non-empty slot bounds the `tables` JSON at slots × ≈810 B
worst case (§2.3).

**The price, recorded.** The slot figure over-counts by `L + 1` per value, so a `tables` ceiling
`C` also refuses a document whose single column name is longer than about `C` code units, even
though that document costs two records and one diagnostic. Two facts make that acceptable and both
belong in the implementation's own documentation: the inflation is in the **safe** direction (the
gate never admits more columns than it claims), and that document class is already outside the
envelope profile's admitted set — a 65,536-code-unit name gives Σ`L²` ≈ 4.3 × 10⁹ against a ceiling
of 134,217,728 — so it costs no user a document `inspect` could have answered, only a
`tables`-only document. A ceiling chosen to never refuse a single long line would have to be at least
`maxLineLength + 1` = 4,194,305, which is ≈1.2 GB of diagnostics even at the measured average of
279 B each (≈3.4 GB at the ≈810 B ceiling) (**arithmetic**) and no mitigation at all; that is the
trade-off stated rather than inherited. **No shipped ceiling is
lowered**: the `tables` member is additive, and its three existing values stay as they are.

**What it does not buy.** The member caps retained column *records* and diagnostics, not the bytes
those records hold: one built from a quoted element keeps its own copy of that element's text
(`partRaw`, `src/schema/values.ts:232-234`),
so a `tables` peak still contains an `n × L` residue that this count does not bound. That residue is
shared with `inspect` and stays with issue #27; the member is not described as closing it anywhere in
this document.

### 5.3 Reading a composite ceiling as a column count

The composite's unit is one code unit, so a ceiling can be translated into a column count only for
an assumed value length. For a document whose values are all one code unit long, `L² + L = 2` and
the slot count is 2 per value, so `relationColumnCodeUnits ≈` the number of columns and a ceiling
`C` admits at most about `C` columns in that shape — each of which costs ≈128 characters of
envelope (**estimate**). A ceiling chosen at "N columns is acceptable" is therefore `C ≈ N`, not
`C ≈ N/2`. For a mean length `L̄` the same ceiling admits roughly `C / L̄` columns of that length.

**Coefficient question, unresolved.** The linear term has coefficient 1 while each record costs
`k ≈ 128` characters. The counter is a shape proxy in code units, so this is a unit choice, not an
error; but a ceiling on it caps columns at `C` (short values) or fewer (long values), and the
constant term is covered only by that ceiling being small enough. §9 asks whether that is acceptable
or whether the linear coefficient must become a recorded weight.

### 5.4 Refusal order (proposal)

The order decides which counter a document over several ceilings reports, so it is part of the
design, not an implementation detail (`src/budget/admission.ts:305-329`).

| # | Profile | Gate | Figure | Compared |
|---|---|---|---|---|
| 1 | both | pre-scan | `entityFieldOccurrences` | before `scanSource()` — unchanged |
| 2 | both | pre-scan | `contentLineOccurrences` | before `scanSource()` — unchanged |
| 3 | envelope | post-scan | `relationValueLengthSquares` | unchanged position (first in `admit()`) |
| 4 | envelope | post-scan | `relationColumnCodeUnits` | **new**, between Σ`L²` and the composed bound |
| 5 | envelope | post-scan | `composedColumnsUpperBound` | unchanged position |
| 6 | envelope | post-scan | `composedColumnCodeUnits` | **new**, R2's later unit, last on this profile |
| 7 | `tables` | post-scan | `relationColumnSlotsUpperBound` | **new member**, first in the `tables` branch (today that branch compares only the composed bound) |
| 8 | `tables` | post-scan | `composedColumnsUpperBound` | unchanged position |

`tables` therefore goes from one post-scan comparison to two, and the count is compared **first** so a
slot-heavy document reports the figure it exceeds rather than the composed bound it does not (the
shapes in §5.2.1 have a composed bound of 0). The envelope profile does not adopt the slot member: its
composite already dominates the slot count for `L ≥ 1` (§3.3). Every figure a profile reads must be
proved comparable before the first comparison, exactly as `admit()` and `admitShape()` do today
(`src/budget/admission.ts:305-316`, `:355-363`); the new slot member must join that pre-check list.

### 5.5 Calibration protocol for the new ceilings

The envelope composite's value is a consistency assertion (§5.2) and needs no calibration to be
non-binding; a **mitigating** value and the `tables` value do. Either is justified only by a record
that:

1. runs **synthetic fixtures only**, through the real command (`runTablesCommand` for the `tables`
   member; `inspect` for the envelope composite), on the profile that ships the ceiling — never
   inferred from the other command, because `tables` streams in chunks and builds its own document
   (`src/json/stream.ts:1-49`) while `inspect` builds one string;
2. reports, per run: the counter value (`relationColumnSlotsUpperBound`, or
   `relationColumnCodeUnits`), the diagnostics count, the emitted JSON length, and peak RSS;
3. records platform, Node version, heap limit and maximum string length, as `human-cli.md` §7.1 does
   (`docs/proposals/human-cli.md:1432-1436`);
4. covers the **anchor**, the **rejectable shape** and the **candidate ceiling ± 1** (at, one below,
   one above), so the record states both edges of the band rather than a single pass;
5. states the band explicitly (§5.2.1) and records the false-positive class the count ceiling carries,
   so a reviewer can see which `tables`-only documents the value intends to refuse.

Until that record exists, no shipped `tables` value changes and the tests drive the new member with an
injected budget (`tests/helpers`, the `createPipeline(budget)` seam).

### 5.6 Who may change a value

`DEFAULT_RESOURCE_BUDGETS` is frozen and pinned (`src/budget/admission.ts:126-160`,
`tests/budget-admission.test.ts:126-233`), and the §10.5 tables list every figure with its profiles.
A value change must move the default, the pin and the documentation in the same change, and a value
that would refuse a committed fixture must never ship (§6.6). This covers the new `tables` value too
(§5.2.1): its default, the defaults pin, the §10.5 row and the band it was chosen from must move
together, and no future edit may lower it below the anchor.

## 6. Contract and compatibility analysis

### 6.1 `CONTRACT_VERSION` stays `0.1.0`

A new `counter` value is data, not a shape: `E_LIMIT_BUDGET.details.counter` is a string inside a
`Record<string, DiagnosticDetail>`, and `docs/architecture.md:1228-1242` already decided this case
when the two pre-scan counters arrived — "the ten members, their order and the meaning of every
existing value are as they were, so `contractVersion` stays `0.1.0`". A new counter, a new refusal
outcome, and a previously processed input becoming `failed` are explicitly not version moves
(`:1238-1253`). Rule 6 (`:1205-1216`) moves the version for an envelope field, key order or value
meaning, none of which changes here.

**The one consumer obligation.** A consumer that types `counter` as a **strict enum** of the
previous values must add the new ones to compile against a refusal. A consumer that types it as a
string, or decides from `severity`, needs no change. That is the same obligation the two pre-scan
values already created; R1 adds **two** new values — `relationColumnCodeUnits` for the envelope
composite and `relationColumnSlotsUpperBound` for the `tables` member — and both must be repeated in
the release note. `tables` consumers are the ones to watch: a document this profile used to admit now
fails, and the fatal's `counter` is a value they have never seen from `tables` before.

### 6.2 `details` keeps three keys

`E_LIMIT_BUDGET` is emitted with `{counter, observed, ceiling}` and `construct: 'Source'`
(`src/pipeline.ts:69-86`); message and severity are table-driven
(`src/diagnostics/diagnostic.ts:202-205`), and `details` carry this tool's own aggregate figures,
no document text (`docs/architecture.md:1258-1265`). Both new R1 figures reuse those three keys;
adding a fourth is type-legal and unnecessary, and §9 asks management to keep it that way.

### 6.3 Exit behaviour and the failed arm

A refusal is `fatal`; `integrate()` gives status `failed` with `source`/`schema`/`completeness`
`null` and `unsupported` `[]`, and `exitPolicyOf` maps any fatal to `{inspect: 1, validate: 1}`
(`src/validate/index.ts:311-315`). `tables` uses the same arm
(`src/tables-command.ts:89-113`), emits `JsonTablesEnvelopeFailed` with status `failed`, `source`
and `result` `null` (`src/json/envelope.ts:965-982`) and exits `1`. Phase A's `70` stays reserved
for internal errors. Adding counters changes no exit code.

**Some inputs that are processed today would become `failed` with exit `1`.** That is the gates'
purpose and has precedent at the same `(command, contractVersion)`
(`docs/architecture.md:1238-1253`), but it must be stated in the release note, not discovered by a
consumer. For `tables` this is a **new kind of refusal**, not a tighter existing one: today that
profile has no relation-shaped ceiling at all, so the shape in §5.2.1 is admitted and its 400,002
diagnostics are written out.

### 6.4 Existing counters and ceilings do not move

| Figure | Value today | Under this proposal |
|---|---|---|
| `relationValueLengthSquares` (envelope) | 134,217,728 | unchanged, still computed and compared |
| `composedColumnsUpperBound` (envelope) | 524,288 | unchanged, still compared |
| `composedColumnsUpperBound` (tables) | 4,194,304 | unchanged, still compared |
| `entityFieldOccurrences` (envelope / tables) | 200,000 / 500,000 | unchanged |
| `contentLineOccurrences` (envelope / tables) | 400,000 / 1,000,000 | unchanged |
| `relationColumnSlotsUpperBound` (tables) | **no member today** | new member; its ceiling value is **not decided** (§5.1, §5.2.1) |

`EnvelopeResourceBudget` gains two members (R1 composite now, R2's name-length counter later, §4.6);
`TablesResourceBudget` gains **one**, `relationColumnSlotsUpperBound`, reusing a measurement leaf
that already exists. Neither profile gains the other's figure, and `tables` still has no Σ`L²` and no
code-unit ceiling. Because `withResourceBudget()` rebuilds each profile member by member with
`checkedCeiling` (`src/budget/admission.ts:206-252`), a missing member is a compile error rather than
a silent default, and no ceiling can ride along from the other profile. That stays true, and the new
member must be added to that construction and to its pre-comparison check.

### 6.5 `ResourceMeasure` is internal, but the pin moves deliberately

`ResourceMeasure` never enters the envelope; it is the measurement the gate reads. Its completeness
is pinned by a numeric-leaf count — 28 today, with the breakdown in the test's own comment — and by
exactly one Σ`L²` leaf per fixture (`tests/budget-measure.test.ts:784-800`). R1 adds **one** leaf —
the envelope composite — because the `tables` member reuses the slot leaf that already exists; that
makes 29, and R2's later counter makes 30 (or 31 if it becomes a three-leaf bound, §4.5). That test
must be updated *because the measurement deliberately grew*, in the same commit, with the reason
recorded; it must not be loosened to "at least 28" or to a regex.

### 6.6 Goldens and fixtures

The committed corpus measures Σ`L²` = 277 and composed = 2 at its maximum
(`tests/pipeline-admission.test.ts:888-905`). Every candidate value in §5.2 is orders of magnitude
above those, and a shipped `tables` value cannot be below the anchor's 12,008 slots without refusing a
document the suite requires to be admitted (§5.2.1). A shipped value must also admit all 39 fixtures
— asserted, not assumed — so **no committed envelope changes** and no golden may be regenerated. A
ceiling that would refuse a fixture is not a calibration choice but a defect: it would break
`tests/json-goldens.test.ts`/`tests/immutability.test.ts`/`tests/cli-byte-regression.test.ts`
expectations. Fixtures and goldens are never edited to accommodate a counter.

### 6.7 The Agent Skill

`skills/a5er-cli/SKILL.md` does not enumerate `counter` values; it invokes the CLI and interprets
the envelope. No change is required, and none is proposed. A refusal is already reported as a failed
document with exit `1`.

## 7. Verification plan

### 7.1 Test layers, all in-process unless stated

| Layer | File | What it must show |
|---|---|---|
| Measurement | `tests/budget-measure.test.ts` | the new composite equals a hand-computed value per fixture and per hand-built scan; the Σ`L²` value and the slot bound are unchanged by the addition, and the slot bound is exposed to admission rather than recomputed; checked arithmetic rejects a value past the safe range; no array grows with the input; the leaf pin is updated deliberately (§6.5) |
| Decision | `tests/budget-admission.test.ts` | each new ceiling at and one past; the fixed refusal order of §5.4, including the `tables` slot comparison **before** the composed bound; an unprovable observation throws instead of refusing; the frozen defaults table pins each new value on its own profile (`tables` gains one member and no code-unit figure), once the `tables` value exists (§5.5, §9 Q10); purity and determinism |
| Wiring | `tests/pipeline-admission.test.ts` | a small injected envelope budget drives the new composite refusal through `createPipeline(budget)`; the refusal arm is unchanged (one fatal, `details` of three keys, `limits` intact, `source`/`schema`/`completeness` null); the pre-scan gate still precedes the post-scan one; the call order test still reads `src/pipeline.ts` correctly; the production-wiring document of `:967-1013` (Σ`L²` = 144,048,020, about 12,100 bytes) still refuses `inspect`/`validate` with a `details` record of exactly three keys, and is still admitted by `tables` — which the new `tables` ceiling must not disturb (§7.1, profile separation) |
| Profile separation | `tests/pipeline-admission.test.ts`, `tests/budget-admission.test.ts` | `tables` has its slot member and **not** the envelope composite (a type-level and a runtime check); a document refused only by the envelope composite is still admitted by `tables`; and the anchor of `:1008-1017` — admitted by `tables` today — stays admitted at any candidate ceiling in the §5.2.1 band |
| `tables` R1 gate | `tests/pipeline-admission.test.ts` | the representative high-slots shape (§5.2.1, 800,008 slots) is **refused through `createPipeline(TABLES_OVER_...)`** — or an equivalent small injected `tables` budget — with one fatal `E_LIMIT_BUDGET` naming `relationColumnSlotsUpperBound`, `details` of three keys, `source`/`result` null and exit `1`; the same injected ceiling one above the observed slots admits it. No shipped `tables` value is needed for this test, and none is exercised by it |
| Fixture immutability | `tests/immutability.test.ts`, `tests/json-goldens.test.ts`, `tests/cli-byte-regression.test.ts`, `tests/cli-tables-cases.test.ts` | every committed envelope is byte-identical; staged copies only; no fixture edited |
| Fixture × command fence | `tests/immutability.test.ts` (`inspect`, `validate`), `tests/json-goldens.test.ts`, `tests/cli-byte-regression.test.ts` (`inspect`, `tables` text, `tables --format json`), `tests/cli-tables-cases.test.ts` (`tables` text and JSON) | all 39 synthetic fixtures × 4 command forms — `inspect`, `validate`, `tables` text, `tables --format json` — that is **156 byte-identical comparisons** of stdout bytes, stderr bytes and exit code against the accepted baseline build; the historical record is 156 of 156 identical against base `1c6a4320` and 156 of 156 again against base `251ec00` (`docs/test-strategy.md:485-492`), and those are recorded pre-merge runs rather than CI jobs |
| CLI behaviour | `tests/pipeline-admission.test.ts`, `tests/cli-large-diagnostics.test.ts` | refusal exit `1` with the fixed fatal line for `inspect`, `validate` and `tables` (text and JSON); the 200,000-`Field` at-ceiling document is still admitted |

### 7.2 Gates

`build`, `typecheck`, `lint`, `format:check`, `test` from `package.json`, with real results
reported, including failures. CI is `.github/workflows/ci.yml` as it exists: two jobs — `verify`
(ubuntu-latest/windows-latest × Node 24/26, running those five commands) and `pack-smoke` (the same
matrix, packing the tarball and smoke-testing the CLI from it). CI must be checked against the exact
pushed commit SHA for every job of that matrix. Two traps:

* **No CodeQL workflow file exists** in `.github/workflows/` (only `ci.yml` and `release.yml`), and no
  `codeql` string exists in `.github/` or `package.json`. A `CodeQL` check does run on pull requests,
  from this repository's GitHub-side default setup rather than from a committed workflow (observed
  on this proposal's own PR, event `dynamic`). It is not part of `ci.yml`, its configuration is not
  in this repository, and neither a design nor a review may count it as a gate this project
  controls or claim coverage it does not have.
* `docs/test-strategy.md:545-560` still lists six jobs (`typecheck`, `test`, `test-windows`,
  `build`, `fixture-policy`, `no-update`) that `ci.yml` does not define. That drift predates this
  proposal; §9 asks whether repairing it belongs to this change or to a separate one.

### 7.3 What the plan does not verify

* No load, heap, RSS or out-of-memory measurement, by instruction. A ceiling is not validated by
  this plan; it is validated by the calibration record of §5.5, which is a separate task.
* No claim that a document below every ceiling of its own profile is cheap: §10.5's warning stays
  true, and the new figures do not narrow it.
* **No shipped `tables` value is exercised**, because none is decided (§5.1). The `tables` gate is
  proven at an injected budget; the shipped default and the anchor at that default stay unverified
  until §5.5 produces the record.

## 8. Implementation sequence

Each step is one reviewed change on its own branch; a step that cannot keep every gate green does
not merge. R1 (steps 1–4) is one PR only after §9's Q1–Q3 are answered; R2 (step 6) is a later,
separate unit (§4.6).

1. **Measurement** (`src/budget/measure.ts`): add the envelope composite accumulation to the existing
   loop, reuse `addValueSquare`/`checkedAdded`, and add the `tables` member's figure **by exposing the
   leaf that already exists** (`relationColumnSlotsUpperBound`) to admission rather than computing a
   second one. Update the leaf pin from 28 to 29 with its reason. Unit tests first: a hand-computed
   composite per shape, the slot bound unchanged, and Σ`L²` unchanged.
2. **Budget types and defaults** (`src/budget/admission.ts`, `src/cli.ts`,
   `src/tables-command.ts`): add `relationColumnCodeUnits` to `EnvelopeResourceBudget` and the §5.2
   provisional consistency value to `DEFAULT_RESOURCE_BUDGETS.envelope` (frozen, commented as not
   empirically proven); add `relationColumnSlotsUpperBound` to `TablesResourceBudget` and to
   `withResourceBudget()`'s member-by-member construction and its pre-comparison check. A required
   member needs a value in `DEFAULT_RESOURCE_BUDGETS.tables`, so this step lands either after step 5's
   decision or with an explicitly recorded unproven value (§9 Q10); it must not silently choose one.
   Until then the tests drive the member with injected budgets, and a test asserts that every committed
   fixture is unaffected.
3. **Decision** (`src/budget/admission.ts`): compare in the §5.4 order — the slot figure first in the
   `tables` branch, then the composed bound; the envelope composite between Σ`L²` and the composed
   bound — prove every new observation before the first comparison, and extend `BudgetCounter` with
   both values. Decision tests cover each ceiling at and one past, the `tables` order, and the
   `details` of three keys.
4. **Wiring check and documentation** (`src/pipeline.ts` unchanged; `docs/architecture.md` §10.5
   rows and both profiles; `docs/test-strategy.md` gate table): no new call is needed — `measure()`
   already runs before `classify()` — so the change proves that with the existing call-order test
   instead of moving it. Document the non-coverage of §3.6 and §4.3 in the same place as the figures.
5. **Calibration** (separate, gated by §5.1, protocol §5.5): obtain the measurement record, or record
   the decision to ship an unproven `tables` value, then set it in the default, the pin and the
   documentation together, with the anchor, the rejectable shape and the ceiling ± 1 in the record.
6. **R2** (later unit): the name-length counter of §4, on the envelope profile only, with its own
   calibration. It does not ship in R1's commits.
7. **Release note**: state the new counter values, the strict-enum `counter` obligation, the
   previously-admitted-now-failed outcome **including the new `tables` refusal**, and the
   non-coverage in plain words.

Ordering constraints: step 3 cannot precede step 2 (no member to read); step 4 cannot precede step
3 (the documentation would describe a comparison that does not exist); step 5 must not change a
ceiling before steps 1–3 are merged, and its `tables` value cannot land before the member exists, or a
test would pin a value nothing compares. R2 cannot share a commit with step 5. No step may weaken an
existing assertion, add a skip, or regenerate a golden.

## 9. Open questions for management

| # | Question | Why it is not decided here |
|---|---|---|
| Q1 | Do we ship two controls (a count on `tables`, a composite on the envelope) now, and R2 later? | Both are additive, and the `tables` count reuses a figure that already exists. This proposal recommends R1 as one PR and R2 as a separate later unit (§4.6). |
| Q2 | Which ceiling ships for each figure, and is an empirically unproven value acceptable? | §5.1: no record reports either counter value. The §5.2 candidates are a non-binding consistency assertion (envelope), a derived band with no value chosen (`tables`, §5.2.1), and an estimate assuming a 32-code-unit mean name (R2). |
| Q3 | Is coefficient 1 on the linear term acceptable, or must the per-record constant `k ≈ 128` become a recorded weight? | §5.3. A weight is a policy choice and would need its own justification and test. |
| Q4 | Is the R2 figure a single counter, or a bound with published factors? | §4.5. It changes the measurement's leaf count and the readability of a refusal, not the arithmetic. |
| Q5 | Does `tables` get the **count** (`relationColumnSlotsUpperBound`) with the code-unit composite kept off that profile, accepting that a single name longer than the ceiling is refused? | §3.2, §5.2.1. The count is what the `tables` cost is proportional to, and the alternative — the composite — refuses the committed 12,100-byte anchor; the false-positive class is recorded but not eliminated. |
| Q6 | Do we accept that more inputs become `failed` at `0.1.0`, including a **new kind of refusal for `tables`**? | §6.3. The precedent exists, but `tables` has no relation-shaped ceiling today, so this is an outcome change a `tables` consumer can see. |
| Q7 | Do `details` stay at three keys? | §6.2. Reuse keeps the shape; a fourth key is type-legal but unnecessary. |
| Q8 | Does repairing the `docs/test-strategy.md` CI job table (§7.2 drift) belong to this change? | It is unrelated to the counters and would widen the diff; leaving it means the design cites `ci.yml` rather than the table. |
| Q9 | Who reviews, and what counts as acceptance? | `AGENTS.md`: implementation completion is not acceptance; the issue stays open until a reviewer records an explicit PASS. |
| Q10 | Is the `tables` member's value a blocker for the R1 PR, or may R1 land with the member present and no shipped ceiling? | §5.5, §8 step 2. A required member needs a value in `DEFAULT_RESOURCE_BUDGETS.tables`, so either step 2 waits for step 5 or it ships an explicitly recorded unproven value; the design permits the latter but does not choose it. |
