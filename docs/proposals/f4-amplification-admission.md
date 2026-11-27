# Proposal — F4-D1: amplification admission for relation columns and common columns

> **Status: draft design proposal. Not implemented, not calibrated, not approved.**
> Nothing here is shipped behaviour and no threshold is decided. This document changes no code,
> test, fixture, golden, contract or version. It designs two additional admission counters, states
> which figures are derived and which are estimates (labels below), and leaves every ceiling value
> open (§5, §9) for management to decide before any implementation branch starts.

| | |
|---|---|
| Baseline | `main` at `8df73ea8fa4f79880196cfab79497be65437e031` |
| Package | `@j1nn0/a5er-cli` `0.1.2` |
| Contract | `CONTRACT_VERSION` `0.1.0`, and it stays `0.1.0` (§6) |
| Tracks | [issue #27](https://github.com/j1nn0/a5er-cli/issues/27) (F-4) |
| Scope | design of two additive admission counters: R1 (relation column amplification), R2 (common-column name length) |
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

**Recommendation in one paragraph.** Keep both shipped post-scan counters exactly as they are and
add two counters beside them, computed in the measurement loop that already runs before
`classify()`: R1 adds one composite code-unit counter per relation value (`L² + L`, summed), so the
per-column linear cost is admitted into the decision without redefining Σ`L²`; R2 adds one
name-length-weighted counter (`[Entity]` sections × Σ raw `CommonField` value code units), so the
cost of writing every composed name once per entity, twice per envelope, is admitted without
redefining the entity × declaration counter. Both are additive: no existing counter, ceiling, unit
or refusal moves. Neither is a bound on memory, RSS or the envelope (§3.6, §4.3).

## 1. Problem statement and the current implementation

### 1.1 What admission is for, and what it is not

The read limits bound the **input** (§`src/io/limits.ts:17-22`: `maxBytes` 64 MiB, `maxLines`
2,000,000, `maxLineLength` 4 MiB) and say nothing about the **work** an accepted document asks for
(`docs/architecture.md` §10.5; module comment at `src/budget/admission.ts:55-70`). Admission
therefore runs twice per document — a pre-scan walk before the scan
(`src/pipeline.ts:116-118`) and a measurement of the finished scan before `classify()`
(`src/pipeline.ts:124-125`, classification at `:127`) — and compares seven figures in total. Each is a **shape proxy**: the counters count occurrences and code units, and the ceilings
name how much of that shape this build tolerates. None of them is a byte, heap or RSS bound
(`src/budget/measure.ts:305-316`, §10.5).

Two stages amplify, and each already has one counter:

| Stage | Counter today | Where it is computed | Compared by |
|---|---|---|---|
| Relation column construction | `relationValueLengthSquares` (Σ`L²`) | `src/budget/measure.ts:479-493`, accumulation at `:123-150` | `inspect`, `validate` |
| Common-column composition | `composedColumnsUpperBound` (`[Entity]` sections × `CommonField=` lines) | `src/budget/measure.ts:499-512`, type at `:319-347` | `inspect`, `validate`, `tables` |

Both are read from `ResourceMeasure`, and `tables` deliberately has no Σ`L²` member: its budget
type has no such field, so "the absence is structural, not numeric"
(`src/budget/admission.ts:84-98`, `docs/architecture.md` §10.5 lines 869-880).

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
on every fixture (`tests/budget-measure.test.ts:790-800`), yet admission never compares it.

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
about 2 GB of name text (**estimate**: 2 × 524,288 × 1,000), while the counter reports 524,288.
For `tables` the same 524,288 compositions are pointer arrays over shared strings, which is a real
but different cost; the `tables` ceiling (4,194,304) exists for that cost, not for name text.

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

### 2.2 What none of those measurements establish

* **No measurement isolates R1 or R2.** Every row above sums all stages: read, scan, classify,
  semantics, serialization and (for `tables`) projection. None of them reports `n`, Σ`L`, Σ`L²` or
  `E × Σℓ` for the input that was run, so none of them can be used to pick a ceiling for a new
  counter.
* **No measurement of the proposed counters exists.** The figures in §1.2, §1.3, §3 and §4 that are
  not cited above are **estimates** derived from the record shapes the serializer writes
  (`src/json/serialize.ts:664-676`, `:846-853`) or **derived** from the invariants in the code.
* **The recorded platform spread is real.** The issue #27 record and the `human-cli.md` rows were
  taken on stated platforms and Node versions; heap ceilings, string limits and RSS differ between
  them. The F4-M1A measurement series this design was briefed with is one environment's record, not
  a boundary of the tool, and none of its numbers is used as a threshold here.
* **`tables` measurements do not transfer to `inspect`.** `tables` streams in chunks
  (`src/json/stream.ts:1-49`) and builds its own document; `inspect`/`validate` build one string.
  The same input can be fatal for one and fine for the other.
* **Nothing here was re-run.** This proposal ran no load measurement and no out-of-memory
  reproduction, by instruction. Every measured row above is cited from a record, not reproduced.

### 2.3 Per-record size estimates used later

Two planning constants recur. Both are **estimates** from the member lists of the two writers, not
observations:

| Estimate | Value | Derivation |
|---|---|---|
| Column record in the envelope (`jsonRelationColumn`, `src/json/serialize.ts:846-853`) | ≈128 characters per record, excluding `raw` | the 4-character `raw` record below is 132 characters long, 128 of them not `raw`: `{"pname":"C1","raw":"XXXX","span":{"start":{"line":1000,"column":10},"end":{"line":1000,"column":2000}},"index":12345,"empty":false}` |
| Effective-column record in the envelope (`jsonEffectiveColumn`, `:664-676`) | ≈140 characters per record, excluding the two names | the same construction with `pname`, `logicalName`, `source`, `span`, `collision` gives 137 characters with both names empty and 148 with a 7-character and a 2-code-unit name |
| JSON escape factor `f` on a decoded name | 1–6 | `src/schema/values.ts:100-142`: `\n`/`\t` decode to one control character, which JSON writes back as `\n`/`\t` (2 characters) or up to `\u000b` (6) |

## 3. R1 — options and recommendation

### 3.1 Options

| Option | Counter | Accuracy as an amplification gate | Extra cost | Available before `classify()` |
|---|---|---|---|---|
| A | Σ`Fields1`+`Fields2` code units (= `fields1ValueCodeUnits + fields2ValueCodeUnits`, `src/budget/measure.ts:484`, `:491`) | **Linear only.** Bounded by `maxBytes`, so a ceiling low enough to protect anything refuses legitimate linear documents; a ceiling above the byte limit never fires. Blind to `n × L`. | 0 — already computed | yes |
| B | `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`) | **Exact on `n`**, linear in the text. Catches "many separators", not "one long value with many separators" — it is ~`L` where the output is ~`L²`. | 0 — already computed and verified on every fixture | yes |
| C | output-cost estimate over raw text | Closest to the observed cost; needs a second cost model that can drift from `serialize.ts` (and from `stream.ts`, a second writer). Blind to diagnostics and to the composed path. | medium, plus a permanent drift surface | partly |
| D | product term (Σ`L²`, present) + a linear term in one composite code-unit counter | **Bounds both halves of the observed cost** for every value with `L ≥ 1` (§3.3). | one multiplication and two checked additions per occurrence, `O(1)` memory | yes |

### 3.2 Recommendation (proposal)

**Take D.** Add **one** counter to `ResourceMeasure.counters`:

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
* **Envelope profile only.** It goes on `EnvelopeResourceBudget`, never on
  `TablesResourceBudget`: `tables` emits no relation text, and giving it a relation-shaped ceiling
  would refuse documents it can answer — the same structural argument the module comment already
  makes for Σ`L²` (`src/budget/admission.ts:84-98`).
* **Compared second**, after Σ`L²` and before the composed bound (§5.4), and its observation is
  proved comparable before the first comparison, as every figure in `admit()` already is
  (`src/budget/admission.ts:305-316`).

### 3.3 What the composite bounds, derived

Per value of raw length `L`:

* `n ≤ L + 1` slots (one separator per code unit; `src/budget/measure.ts:353-361`).
* Each slot costs `L` code units of `raw` plus a fixed `k` for `pname`, `span`, `index`, `empty` and
  the JSON member text — `k ≈ 128` characters per record (§2.3, **estimate**).

So the rendered cost of one value is at most `n·(L + k) ≤ (L+1)(L+k) = L² + (k+1)L + k`, and, over
the whole document, `Σ(L² + L)` covers the `ΣL²` and `ΣL` terms. Two further facts, **derived**:

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

### 3.4 Options rejected, and why

* **A alone.** Linear in the text, so it cannot distinguish the L² case from a large legitimate
  document; a ceiling that catches one refuses the other.
* **B alone.** Same shape of failure from the other side: it bounds the *count* of columns, not
their content. One value of 100,000 code units is bounded at 100,001 slots — a linear figure —
while the `raw` text the list retains is about 10¹⁰ code units (**estimate**: 100,001 × 100,000).
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
`columnsOf` allocate anything, which is the stage this counter is meant to refuse.

### 3.6 Non-coverage, stated as a requirement

An implementation must document, in the counter's own doc comment and in §10.5, that
`relationColumnCodeUnits`:

* is **not** a byte, heap or RSS bound, in the words Σ`L²` already uses;
* does not cover the `k` term per record — coefficient 1 is a unit choice, not a weight (§5.3);
* does not cover empty relation values (`L = 0`), whose count is bounded by the content-line gate
  instead;
* says nothing about `[Entity]` `Field=` lines, unknown keys, diagnostics volume, or the composed
  path — those are R2, the pre-scan counters, or uncovered.

## 4. R2 — options and recommendation

### 4.1 Options

| Option | Bound | Sound? | What it fails to cover |
|---|---|---|---|
| A | current `E × C` | sound and cheap; verified to cover what entities adopt (`tests/budget-measure.test.ts:460-518`) | name length: `E × C` at the ceiling with 1,000-code-unit names renders ~2 GB of names (**estimate**) |
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

## 5. Threshold calibration and unresolved values

### 5.1 No ceiling is decided here

Two new counters need two new ceilings on the envelope profile. This proposal decides neither. A
value may only be shipped after one of two records exists:

1. **a measurement record** — synthetic fixtures only, environment (platform, Node version, heap
   limit) recorded, and the two counter values reported for each run together with the outcome; or
2. **an explicit decision to ship a figure that is not empirically proven**, recorded with that
   wording and with what it does and does not guarantee.

Today neither record exists for either counter (§2.2). Nothing below is a boundary of the tool.

### 5.2 Candidate provisional values, labelled

| Counter | Provisional value | How it is obtained | What it guarantees |
|---|---|---|---|
| `relationColumnCodeUnits` | `201,326,592` = 2²⁷ + 2²⁶ | **derived**: Σ`L` ≤ the decoded text's code units ≤ `maxBytes` bytes = 67,108,864 — a decoded UTF-16 code unit never costs more than one UTF-8 byte, whatever the character's width (`src/io/limits.ts:17-22`). A document at the Σ`L²` ceiling therefore has composite ≤ 134,217,728 + 67,108,864 | **provably never binding** on a document the existing Σ`L²` ceiling admits. It changes no outcome; it is a consistency guard, not a mitigation |
| `composedColumnCodeUnits` | `16,777,216` = 2²⁴ | **estimate**: equivalent to the existing 524,288-column ceiling when the mean raw declaration length is 32 code units (524,288 × 32) | caps the name-length term at a figure aligned with the shipped column ceiling **assuming** that mean length. If real names average longer it refuses earlier than the column ceiling would; if shorter, it adds nothing |

Both values are **not empirically proven**. Neither may be described as a memory bound, and the
first may not be presented as a mitigation: it is deliberately non-binding. A mitigation needs a
value below it, and choosing that value is the open decision.

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

| Order | Gate | Counter | Compared |
|---|---|---|---|
| 1 | pre-scan | `entityFieldOccurrences` | before `scanSource()` — unchanged |
| 2 | pre-scan | `contentLineOccurrences` | before `scanSource()` — unchanged |
| 3 | post-scan | `relationValueLengthSquares` | unchanged position (first in `admit()`) |
| 4 | post-scan | `relationColumnCodeUnits` | **new**, between Σ`L²` and the composed bound |
| 5 | post-scan | `composedColumnsUpperBound` | unchanged position |
| 6 | post-scan | `composedColumnCodeUnits` | **new**, last in the envelope profile |

`tables` keeps its single post-scan comparison (`composedColumnsUpperBound`) and gains no member.
Every figure the profile reads must be proved comparable before the first comparison, exactly as
`admit()` and `admitShape()` do today (`src/budget/admission.ts:305-316`, `:355-363`); a new counter
must join that check even when it is only reached last.

### 5.5 Who may change a value

`DEFAULT_RESOURCE_BUDGETS` is frozen and pinned (`src/budget/admission.ts:126-160`,
`tests/budget-admission.test.ts:126-233`), and the §10.5 tables list every figure with its profiles.
A value change must move the default, the pin and the documentation in the same change, and a value
that would refuse a committed fixture must never ship (§6.6).

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
values already created, and it must be repeated in the release note.

### 6.2 `details` keeps three keys

`E_LIMIT_BUDGET` is emitted with `{counter, observed, ceiling}` and `construct: 'Source'`
(`src/pipeline.ts:69-86`); message and severity are table-driven
(`src/diagnostics/diagnostic.ts:202-205`), and `details` carry this tool's own aggregate figures,
no document text (`docs/architecture.md:1258-1265`). Both new counters reuse those three keys;
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
consumer.

### 6.4 Existing counters, ceilings and profiles do not move

| Figure | Value today | Under this proposal |
|---|---|---|
| `relationValueLengthSquares` | 134,217,728 | unchanged, still computed and compared |
| `composedColumnsUpperBound` (envelope) | 524,288 | unchanged, still compared |
| `composedColumnsUpperBound` (tables) | 4,194,304 | unchanged |
| `entityFieldOccurrences` (envelope / tables) | 200,000 / 500,000 | unchanged |
| `contentLineOccurrences` (envelope / tables) | 400,000 / 1,000,000 | unchanged |

`EnvelopeResourceBudget` gains two members; `TablesResourceBudget` gains none. Because
`withResourceBudget()` rebuilds each profile member by member with `checkedCeiling`
(`src/budget/admission.ts:206-252`), a missing member is a compile error rather than a silent
default, and no ceiling can ride along from the other profile. That stays true.

### 6.5 `ResourceMeasure` is internal, but the pin moves deliberately

`ResourceMeasure` never enters the envelope; it is the measurement the gate reads. Its completeness
is pinned by a numeric-leaf count — 28 today, with the breakdown in the test's own comment — and by
exactly one Σ`L²` leaf per fixture (`tests/budget-measure.test.ts:784-800`). Two new counters make
that 30 (or 31 if the R2 figure becomes a three-leaf bound, §4.5). That test must be updated
*because the measurement deliberately grew*, in the same commit, with the reason recorded; it must
not be loosened to "at least 28" or to a regex.

### 6.6 Goldens and fixtures

The committed corpus measures Σ`L²` = 277 and composed = 2 at its maximum
(`tests/pipeline-admission.test.ts:888-905`). Every candidate value in §5.2 is orders of magnitude
above those, so **no committed envelope changes** and no golden may be regenerated. A ceiling that
would refuse a fixture is not a calibration choice but a defect: it would break
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
| Measurement | `tests/budget-measure.test.ts` | the new sums equal a hand-computed value per fixture and per hand-built scan; the Σ`L²` value is unchanged by the addition; checked arithmetic rejects a value past the safe range; no array grows with the input; the leaf pin is updated deliberately (§6.5) |
| Decision | `tests/budget-admission.test.ts` | each new ceiling at and one past; the fixed refusal order of §5.4; an unprovable observation throws instead of refusing; the frozen defaults table pins both new values per profile; purity and determinism |
| Wiring | `tests/pipeline-admission.test.ts` | a small injected budget drives both new refusals through `createPipeline(budget)`; the refusal arm is unchanged (one fatal, `details` of three keys, `limits` intact, `source`/`schema`/`completeness` null); the pre-scan gate still precedes the post-scan one; the call order test still reads `src/pipeline.ts` correctly; the production-wiring document of `:967-1013` (Σ`L²` = 144,048,020, about 12,100 bytes) still refuses `inspect`/`validate` with a `details` record of exactly three keys, and is still admitted by `tables` |
| Profile separation | `tests/pipeline-admission.test.ts`, `tests/budget-admission.test.ts` | `tables` has no new member (a type-level and a runtime check), and a document refused by an envelope-only counter is admitted by `tables` |
| Fixture immutability | `tests/immutability.test.ts`, `tests/json-goldens.test.ts`, `tests/cli-byte-regression.test.ts`, `tests/cli-tables-cases.test.ts` | every committed envelope is byte-identical; staged copies only; no fixture edited |
| CLI behaviour | `tests/pipeline-admission.test.ts`, `tests/cli-large-diagnostics.test.ts` | refusal exit `1` with the fixed fatal line for `inspect`, `validate` and `tables` (text and JSON); the 200,000-`Field` at-ceiling document is still admitted |

### 7.2 Gates

`build`, `typecheck`, `lint`, `format:check`, `test` from `package.json`, with real results
reported, including failures. CI is `.github/workflows/ci.yml` as it exists: two jobs — `verify`
(ubuntu-latest/windows-latest × Node 24/26, running those five commands) and `pack-smoke` (the same
matrix, packing the tarball and smoke-testing the CLI from it). CI must be checked against the exact
pushed commit SHA for every job of that matrix. Two traps:

* **No CodeQL workflow exists** in `.github/workflows/`, and no `codeql` string exists in
  `.github/` or `package.json`. A design must not claim static-analysis coverage it does not have.
* `docs/test-strategy.md:545-560` still lists six jobs (`typecheck`, `test`, `test-windows`,
  `build`, `fixture-policy`, `no-update`) that `ci.yml` does not define. That drift predates this
  proposal; §9 asks whether repairing it belongs to this change or to a separate one.

### 7.3 What the plan does not verify

* No load, heap, RSS or out-of-memory measurement, by instruction. A ceiling is not validated by
  this plan; it is validated by the calibration record of §5.1, which is a separate task.
* No claim that a document below every ceiling of its own profile is cheap: §10.5's warning stays
  true, and the new counters do not narrow it.
* No `tables`-side coverage for either new figure, because neither is on its profile.

## 8. Implementation sequence

Each step is one reviewed change on its own branch; a step that cannot keep every gate green does
not merge. Steps 1–4 are one PR only after §9's Q1–Q3 are answered.

1. **Measurement** (`src/budget/measure.ts`): add the two accumulations to the existing loop, reuse
   `checkedValueLength`/`addValueSquare`/`checkedAdded`/`checkedProduct`, extend
   `ResourceMeasure.counters`, update the 28-leaf pin with its reason. Unit tests first: a
   hand-computed value per shape, and Σ`L²` unchanged.
2. **Budget types and defaults** (`src/budget/admission.ts`): add both members to
   `EnvelopeResourceBudget`, extend `withResourceBudget()` and its validation, add the §5.2
   provisional values to `DEFAULT_RESOURCE_BUDGETS.envelope` (frozen) with a comment saying they are
   not empirically proven, and extend the defaults pin. `tables` is untouched, and a test asserts
   that. Step 5 replaces the provisional values.
3. **Decision** (`src/budget/admission.ts`): compare in the §5.4 order, prove both new observations
   before the first comparison, extend `BudgetCounter`. Decision tests cover each ceiling at and one
   past, and the order.
4. **Wiring check and documentation** (`src/pipeline.ts` unchanged; `docs/architecture.md` §10.5
   rows; `docs/test-strategy.md` gate table): no new call is needed — `measure()` already runs
   before `classify()` — so the change proves that with the existing call-order test instead of
   moving it. Document the non-coverage of §3.6 and §4.3 in the same place as the counters.
5. **Calibration** (separate, gated by §5.1): obtain a measurement record, or record the decision to
   ship an unproven value, then set the two ceilings in the defaults, the pin and the documentation
   together.
6. **Release note**: state the new counters, the strict-enum `counter` obligation, the
   previously-admitted-now-failed outcome, and the non-coverage in plain words.

Ordering constraints: step 3 cannot precede step 2 (no member to read); step 4 cannot precede step
3 (the documentation would describe a comparison that does not exist); step 5 must not change a
ceiling before step 1–3 are merged, or a test would pin a value nothing computes. No step may
weaken an existing assertion, add a skip, or regenerate a golden.

## 9. Open questions for management

| # | Question | Why it is not decided here |
|---|---|---|
| Q1 | Do we ship two counters, or one R1-only change first and R2 later? | Both are additive and independent; the sequence changes review size, not design. This proposal recommends both, in one PR. |
| Q2 | Which ceiling ships for each counter, and is an empirically unproven value acceptable? | §5.1: no measurement isolates either counter yet. The §5.2 candidates are a derived non-binding guard (R1) and an estimate assuming a 32-code-unit mean name (R2). |
| Q3 | Is coefficient 1 on the linear term acceptable, or must the per-record constant `k ≈ 128` become a recorded weight? | §5.3. A weight is a policy choice and would need its own justification and test. |
| Q4 | Is the R2 figure a single counter, or a bound with published factors? | §4.5. It changes the measurement's leaf count and the readability of a refusal, not the arithmetic. |
| Q5 | Does R2 stay envelope-only, as recommended, leaving `tables` composition cost covered by `E × C` alone? | §4.2. Adding it to `tables` would refuse documents `tables` answers; not adding it leaves name length uncounted there. |
| Q6 | Do we accept that more inputs become `failed` at `0.1.0`? | §6.3. The precedent exists, but each new refusal condition is an outcome change a consumer can see. |
| Q7 | Do `details` stay at three keys? | §6.2. Reuse keeps the shape; a fourth key is type-legal but unnecessary. |
| Q8 | Does repairing the `docs/test-strategy.md` CI job table (§7.2 drift) belong to this change? | It is unrelated to the counters and would widen the diff; leaving it means the design cites `ci.yml` rather than the table. |
| Q9 | Who reviews, and what counts as acceptance? | `AGENTS.md`: implementation completion is not acceptance; the issue stays open until a reviewer records an explicit PASS. |
