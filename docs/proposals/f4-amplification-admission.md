# Proposal — F4-D1: an admission control for relation-column slots on `tables`

> **Status: draft design proposal. Not implemented, not calibrated, no ceiling approved.**
> Nothing here is shipped behaviour. This document changes no code, test, fixture, golden, contract
> or version. It designs **one** additive `tables` budget member that compares a figure the
> measurement already publishes, names the calibration that must happen before any value is chosen,
> and leaves the envelope profile untouched. Design acceptance is not calibration and neither is an
> approval to ship a ceiling (§5, §9).

| | |
|---|---|
| Baseline | `main` at `8df73ea8fa4f79880196cfab79497be65437e031` |
| Package | `@j1nn0/a5er-cli` `0.1.2` |
| Contract | `CONTRACT_VERSION` `0.1.0`, and it stays `0.1.0` (§6) |
| Tracks | [issue #27](https://github.com/j1nn0/a5er-cli/issues/27) (F-4) |
| Scope | R1: one new `TablesResourceBudget` member comparing the already-published `bounds.relationColumnSlotsUpperBound`, with its ceiling to be approved later. R2 is named as a later unit and is not designed here |
| Out of scope | ceiling values (§5), calibration runs, implementation, envelope changes, Field-heavy JSON, unknown-key volume, additive diagnostics outside the relation path, streaming or plan-B projection, read-limit changes |

Normative words: **must**, **must not** and **never** are requirements on an implementation this
proposal would authorise. "Today" means the baseline above. Every claim carries one of four labels:

| Label | Meaning |
|---|---|
| **measured** | Observed in a run recorded in this repository or in the manager's F4-M1A report, with its environment. Not re-run for this proposal. |
| **derived** | Follows by arithmetic on the code's own rules or on a cited figure; no run needed, and no run is claimed. |
| **estimate** | Arithmetic on a written record's shape. A planning figure, not an observation. |
| **hypothesis** | Plausible but unestablished, and stated as such. Physical heap cost is the main one. |

**Recommendation in one paragraph.** Give the `tables` profile an effective relation control by
adding **one** member to `TablesResourceBudget` that compares the figure the measurement already
publishes — `bounds.relationColumnSlotsUpperBound`, the sum of `L + 1` over every `Fields1`/`Fields2`
value, in **slots** — and compare it **after** the existing composed bound so today's refusal reason
survives. The measurement, the 28-leaf pin and the envelope profile do not change: no new counter is
added, the envelope keeps Σ`L²` unchanged, and the previously proposed envelope composite is dropped
(§3.4). No ceiling value is chosen here: the band the value must satisfy is derived in §5, and the
calibration that would justify a value is a separate, separately authorised step (§5.4, §9). R2 — name
length in common-column composition — remains a later, independently reviewed unit (§4).

## 1. Problem statement and the current implementation

### 1.1 What admission is for, and the rule it applies

The read limits bound the **input** — `maxBytes` is bytes (`src/io/read.ts:242`), while `maxLines`
and `maxLineLength` are counts of **decoded UTF-16 code units** (`src/decode/decode.ts:252-267`,
`src/io/limits.ts:17-22`) — and say nothing about the **work** an accepted document asks for
(`docs/architecture.md` §10.5; module comment at `src/budget/admission.ts:50-60`). Admission therefore
runs twice: a pre-scan walk before the scan (`src/pipeline.ts:116-118`) and a measurement of the
finished scan before `classify()` (`src/pipeline.ts:124-125`, classification at `:127`). Today the two
gates compare seven figures, and the comparison rule is one line: `observed > ceiling` refuses, and a
document **exactly at** a ceiling is admitted (`src/budget/admission.ts:274-281`, rationale at
`:26-32`).

The units matter for everything below. `L` in this document is the **raw relation value's UTF-16
code-unit length**, quotes and escapes included — the same unit `maxLineLength` limits and the same
text the scan stores. All four codecs this project decodes — `utf-8`, `shift_jis`, `utf-16le`,
`utf-16be` (`src/decode/bom.ts:9`, candidate order `:12`; declared-name mapping
`src/decode/decode.ts:189-201`) produce decoded text, so the slot figure is **codec-independent**;
only the bytes-per-unit ratio differs (UTF-8 1 unit per 1–4 bytes, Shift_JIS 1 per 1–2, UTF-16LE/BE 1
per 2). A BOM only lowers the byte count. The counter is therefore stated in code units, not
bytes: its figure is codec-independent, while `maxBytes` is not.

### 1.2 R1 — what the relation stage actually retains

`columnsOf` (`src/semantic/relations.ts:174-204`) is the amplification. For one section and one key it
walks the entries and, for the last decoded occurrence, splits each element's text on commas:

```ts
// src/semantic/relations.ts:188-201, abridged
const parts = value.trailingElementsOmitted ? value.parts.slice(0, -1) : value.parts;
const columns: RelationColumn[] = [];
for (const part of parts) {
  for (const name of part.value.split(',')) {
    columns.push({ pname: unescapeEscaped(name), raw: partRaw(part), span: occurrence.span,
                   index: columns.length, empty: name === '' });
  }
}
list = { key, raw: occurrence.raw, span: occurrence.span, columns };   // ← assignment, not append
```

Three rules follow from that code, and the design must not describe anything else:

* **Only the last decoded occurrence per key per section survives.** `list` is assigned (`:201`); a
  second `Fields1` in one section replaces the first, and the earlier array is not retained. The
  measurement deliberately counts every occurrence (`src/budget/measure.ts:479-493`), so
  `relationColumnSlotsUpperBound` (`:514-522`) and Σ`L²` **over-count duplicates** — an over-estimate
  pinned as intended by `tests/budget-measure.test.ts:548-565` ("bounds lists that the relation stage
  never reads"). The duplicate is still reported once per extra occurrence as `S_DUPLICATE_KEY`
  (`src/schema/registry.ts:730-740`; `Fields1`/`Fields2` are not `repeatable`, `:162-181`).
* **`trailingElementsOmitted` drops exactly one element**, and only when the last element is empty
  *and* unquoted (`src/syntax/complex.ts:189-192`). A bare trailing comma declares nothing; a quoted
  empty element (`""`) declares an empty slot, which is retained as a record but skipped for
  diagnostics (`src/semantic/relations.ts:355`).
* **Each slot's `raw` is the whole element text** (`partRaw`, `src/schema/values.ts:232-234`), so a
  quoted element of `L` code units that splits into `n` slots retains `n` records each holding that
  element's text. `n` is linear in the text — `n ≤ L + 1`, because every separator is one code unit —
  but the **logical** retained and emitted size is the product `n × L`. Whether that becomes physical
  heap is engine-dependent and is **not established here** (§1.5, §3.5).

The envelope then repeats the shape: per column it writes `{pname, raw, span, index, empty}` and per
list it writes the whole value again as `raw` (`src/json/serialize.ts:846-863`), and the value also
appears as `scalars[].raw` and `scalars[].value.parts[].value` (`:882-903`, `:564-573`).
`inspect`/`validate` build that envelope as one string (`src/cli.ts:304`, `src/json/index.ts:83`).

### 1.3 What `tables` pays for the same work

`tables` runs the same pipeline: there is one `derivePartialSemantics` call site
(`src/pipeline.ts:128`), and `commonColumnsOf` runs for every command
(`src/semantic/partial.ts:169`; its result is stored at `:319-322`). So `tables` retains the same
`ResolvedRelation` records with their full `RelationColumn[]` (`src/semantic/partial.ts:108`,
`:308`), and one `DanglingColumn` per unmatched **non-empty** slot (`:111`, `:311`;
`src/semantic/relations.ts:353-375`).

Its **own** document is different: `tables` carries counts per object
(`src/view/tables.ts:67-112`, `:405-411`) and the shared `diagnostics` list (`:350`, `:367`), which
`sharedEnvelopeMembers` builds through `jsonDiagnostic` (`src/json/serialize.ts:1435`,
`:1305-1314`). The relation path therefore reaches `tables` output **only** through diagnostics: one
`V_DANGLING_COLUMN` per unmatched non-empty slot (`src/semantic/partial.ts:243-251`), each with a
fixed message and string details cut at 200 code units
(`src/diagnostics/diagnostic.ts:321-324`, `:150-173`). Both formats pay for the same construction —
one document is built before either writer runs (`src/tables-command.ts:116-120`) — so `tables` text
retains the same objects and only writes fewer bytes (`src/text/tables.ts:311-373`; stderr receives
only `fatal`/`error`, `src/text/diagnostics.ts:28-36`).

### 1.4 The gap: the `tables` profile has no relation control

Two figures target the relation path, and the `tables` gate reads neither:

| Figure | Where it is computed | Compared by |
|---|---|---|
| `counters.relationValueLengthSquares` (Σ`L²`) | `src/budget/measure.ts:479-493` | `inspect`, `validate` only — deliberately absent from `TablesResourceBudget` (`src/budget/admission.ts:84-92`) |
| `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`) | `src/budget/measure.ts:514-522`, type at `:349-361` | **nobody**: published, unit-tested (`tests/budget-measure.test.ts:518-576`, `:790-800`), read by neither gate |

The `tables` branch of `admit()` compares exactly one figure, `composedColumnsUpperBound`
(`src/budget/admission.ts:332-341`). A document with no `[Entity]` and no `CommonField` has a composed
bound of 0, so **every** `tables` ceiling passes it regardless of how many relation columns it
declares, while each of those columns can produce a retained record and a diagnostic. §5.3 gives the
verified construction that does exactly this, and shows the envelope refusing the same document twice.

### 1.5 What is not in question

The shipped counters are sound at what they measure: the slot bound is a conservative over-count
(duplicates and trailing slots included), it is pinned by tests, and it is already one of the 28
numeric leaves of the measurement (`tests/budget-measure.test.ts:144-157`, `:780-789`). Nothing in
this proposal weakens it or the seven shipped ceilings (§6.4), and no physical-memory claim is made
for any of them: the logical `n × L` representation is a risk, the heap cost of it is a
**hypothesis** that no measurement in this repository establishes.

## 2. Measured evidence versus estimates

### 2.1 What is measured, and where it is recorded

Every row taken from `human-cli.md` §7.1 was observed once on Linux (Ubuntu, kernel 7.0, 8 CPUs,
30 GB RAM) with Node `v24.22.3`, V8 heap limit 4,288 MiB and maximum string length 536,870,888
code units; Node 26, Windows and macOS were not measured
(`docs/proposals/human-cli.md:1432-1436`). The F4-M1A rows come from the manager's report, whose
environment is stated below the table.

| Observation | Recorded in | Label |
|---|---|---|
| 616,068-byte input (one 200,001-character `PName`, 3,999 short entities) → `inspect` exit `0`, 17,032,749-byte envelope, 0.69 s, 232 MB peak RSS | `docs/proposals/human-cli.md:1452`, `docs/architecture.md` §10.3 lines 790-800 | **measured** |
| 816,067-byte input → 25,832,745-byte envelope, 259 MB peak RSS | `docs/architecture.md` §10.3 lines 790-800 | **measured** |
| 20,878,001-byte input of 1,999,000 unknown keys → `RangeError: Invalid string length` in `toJsonString`, exit `1`, no envelope, 3.0 GB peak RSS | `docs/architecture.md` §10.3, `docs/proposals/human-cli.md:1454` | **measured** |
| 11,377,891-byte input of 200,000 `Field` lines → `inspect` exit `0`, 372,293,684-byte envelope, 8.0 s, 1.78 GB peak RSS | `docs/proposals/human-cli.md:1455` | **measured** |
| 67,108,851-byte input of 1,155,516 `Field` lines → pipeline heap 2,847 MiB, `serialize()` aborts on a 4,288 MiB heap, exit `134` | `docs/proposals/human-cli.md:1456`, §10.3 | **measured** on the pre-U5-ADMIT2 build; not re-run since |
| One ~12,100-byte document whose relation values put Σ`L²` at 144,048,020 → refused by `inspect`/`validate`, admitted by `tables` | `docs/test-strategy.md:456-467`, `tests/pipeline-admission.test.ts:967-1017` | **measured** (a shipped-ceiling refusal, in the suite) |
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
re-run for this proposal, and the per-diagnostic figure below is **arithmetic** on it, not a second
observation.

### 2.2 What none of those measurements establish

* **No run reports the slot figure for its input.** F4-M1A reports output volume, diagnostic count and
  the growth direction; it does not report `relationColumnSlotsUpperBound`, Σ`L²` or `E × Σℓ` for that
  document. The about-114,004 slots attributed to it in §5.2 are **derived** from its diagnostic count,
  not read from a run.
* **No measurement of a proposed counter exists**, because this proposal adds none (§6.4).
* **No heap measurement exists for the relation shape.** The `n × L` representation is established
  from the code; its physical cost is a **hypothesis** (engine-dependent, unmeasured), and this
  document makes no RSS or heap claim about it.
* **`tables` measurements do not transfer to `inspect`.** `tables` streams in chunks
  (`src/json/stream.ts:1-49`) and builds its own document; `inspect`/`validate` build one string.
* **Nothing here was re-run.** No load, heap or out-of-memory measurement was run for this proposal.

### 2.3 Per-record size estimates and arithmetic used later

| Quantity | Value | Derivation |
|---|---|---|
| Relation column record in the envelope (`jsonRelationColumn`, `src/json/serialize.ts:846-853`) | ≈128 characters excluding `raw` | a representative record with a 4-character `raw` serialises to 132 characters, 128 of them not `raw` — **estimate** |
| Effective-column record in the envelope (`jsonEffectiveColumn`, `:664-676`) | ≈140 characters excluding the two names | 137 characters with both names empty, 148 with a 7-character and a 2-code-unit name — **estimate** |
| Escape factor `f` on a decoded name | 1–6 | `src/schema/values.ts:100-142`: `\n`/`\t` decode to one control character, which JSON writes back as 2 characters, or up to 6 (`\u000b`) — **derived** |
| Diagnostic record in the `tables` JSON (`jsonDiagnostic`, `src/json/serialize.ts:1305-1314`) | ≈279 bytes average | **arithmetic** on F4-M1A: 15.9 MB / 57,000. No worst-case per-diagnostic figure is claimed anywhere in this document |

## 3. R1 — options and recommendation

### 3.1 Options

| Option | Figure | What it can control | Why not (or why now) |
|---|---|---|---|
| A | Σ `Fields1`/`Fields2` code units (`fields1ValueCodeUnits + fields2ValueCodeUnits`, `src/budget/measure.ts:484`, `:491`) | nothing useful: linear in the text, and bounded by `maxBytes`, so any ceiling is either non-binding or refuses legitimate documents | rejected |
| B | `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`), unit slots | the number of retained column records and the slot-driven diagnostics, one-to-one | **adopted for `tables`** (§3.2) |
| C | an output-cost model over the raw text | close to the written bytes | needs a second model that can drift from `serialize.ts` and from `stream.ts`, and a second bookkeeping path `src/budget/measure.ts:13-29` forbids |
| D | envelope composite `Σ(L² + L)` (previous draft) | the envelope's `n × L` representation, in principle | **dropped** (§3.4): its usable ceiling is non-binding by construction; it couples a long value and many short values into one figure; it adds no independent slot-risk coverage; it costs a new measurement leaf and its tests |
| E | envelope slot ceiling (compare B on the envelope profile too) | record count when names are short, where Σ`L²` is small | a candidate **follow-up**, not initial scope; the `k × n` residual needs its own analysis (§3.4) |

### 3.2 Recommendation (proposal): one member, on `tables` only

Add **one** member to `TablesResourceBudget`:

```
relationColumnSlotsUpperBound: number      // ceiling, in slots; value not chosen here (§5)
```

and compare `measurement.bounds.relationColumnSlotsUpperBound` against it. Semantics, exactly as the
measurement already documents them (`src/budget/measure.ts:349-361`, `:514-522`):

* **What it counts:** the sum over every `Fields1`/`Fields2` key occurrence in a relation section of
  the raw value's UTF-16 code units **plus one**. Unit: **slots (columns)**.
* **Why it is conservative:** every separator costs one code unit, so a value of `L` units yields at
  most `L + 1` slots; the sum therefore never under-states the listed slots. It also over-counts the
  cases the stage does not read: duplicate occurrences whose earlier list is replaced
  (`tests/budget-measure.test.ts:548-565`) and the one slot `trailingElementsOmitted` may drop
  (`src/semantic/relations.ts:188`).
* **What it costs:** nothing new — the figure is already computed by `measure()` and is already one
  of the 28 numeric leaves (`tests/budget-measure.test.ts:144-157`, `:780-789`). No new accumulation,
  no second parser, no new counter, and the 28-leaf pin is untouched (§6.4).
* **Where it is compared:** in the `tables` branch of `admit()`, **after** the existing composed bound
  (`src/budget/admission.ts:332-341`), so a document over both keeps reporting
  `composedColumnsUpperBound` exactly as it does today. The new observation joins the pre-comparison
  check that already proves every figure the profile reads (`:305-316`).
* **What it does not change:** the envelope profile, Σ`L²`, the composed bound, the pre-scan figures,
  the seven shipped ceilings, the refusal shape and the exit code (§6).

### 3.3 Why a count is the right control for `tables`

The `tables` document contains **counts and diagnostics**, not column text (§1.3). Every relation
column therefore costs the profile at most one retained record plus, when it does not resolve, one
diagnostic whose size is bounded (fixed message, details cut at 200 code units). One diagnostic
records about 279 bytes on average in the F4-M1A report (**arithmetic**, not a worst case), so the
count of columns is the quantity that tracks this profile's output growth — which is also what the
report observed: linear in the dangling-column count.

That is a statement about **records and diagnostics**, not a universal sufficiency claim. In
particular the count does not bound the bytes of the retained records, which still hold the element
text (§3.5), and it says nothing about physical heap, which is a **hypothesis** for both profiles.

### 3.4 Why the envelope keeps Σ`L²`, and the composite is dropped

The envelope profile already has the product-shaped figure, `relationValueLengthSquares`, with its
134,217,728 ceiling and a pinned refusal identity. The previous draft added a second envelope counter,
`Σ(L² + L)`, and this correction removes it from the implementation plan entirely:

* **Its usable value was non-binding by construction.** Σ`L` cannot exceed the file's decoded code
  units, so a ceiling that admits every document the Σ`L²` ceiling admits would have to sit above
  Σ`L²` ceiling + `maxBytes` — and a comparison that can never fire changes no outcome. It was a
  consistency guard, never a mitigation.
* **It couples two unrelated shapes.** Folding a long value and many short values into one number
  makes a refusal reason harder to read than two figures with their own ceilings.
* **It adds no independent slot-risk coverage** on the envelope profile: for every value with
  `L ≥ 1`, `L² + L ≥ L + 1`, so a Σ`L²` ceiling already dominates the slot count for those values. The
  one residue Σ`L²` cannot see — per-column fixed cost at `L = 0` and the `k × n` term for short
  values — is a **slot** question, not a composite one.
* **It costs a measurement leaf and its tests**: a new counter makes the leaf count 29 and forces a
  deliberate edit of a pin that this correction instead leaves untouched (§6.4).

**Envelope follow-up, not initial scope.** If the envelope needs a slot-shaped control later, the
figure to consider is the same `relationColumnSlotsUpperBound` on `EnvelopeResourceBudget` (option E),
together with an analysis of the `k × n` residual — the ≈128-character per-column constant that
neither Σ`L²` nor a slot count measures in code units. That work belongs to issue #27 and is not
authorised here.

### 3.5 What the count does and does not bound

**It bounds:** the number of `RelationColumn` records the relation stage can retain
(`src/semantic/relations.ts:189-200`), and therefore the number of slot-driven findings — one
`V_DANGLING_COLUMN` per unmatched non-empty slot (`src/semantic/relations.ts:353-375`,
`src/semantic/partial.ts:243-251`) — and the diagnostics list that `tables` copies into its document.

**It does not bound:** the bytes those records hold (each keeps the element's text, §1.2); physical
heap or RSS; per-column JSON overhead; `[Entity]` `Field=` lines or their projections; unknown keys;
diagnostics that do not come from relation slots; the composed path; or the envelope's `n × L`
representation.

**The other findings are bounded elsewhere.** Under the content-line ceiling (400,000 for the envelope
profile, 1,000,000 for `tables`), a document is limited in **lines**, so:

* **line-driven** findings — one `V_MISSING_REQUIRED_KEY` per section carrying absent names
  (`src/semantic/required.ts:172-190`) and one `S_DUPLICATE_KEY` per extra occurrence
  (`src/schema/registry.ts:730-740`) — are bounded by the number of sections and key lines, not by
  the slot count;
* **section-driven** findings — one per section or document, e.g. the document-level `PageInfo` error
  (`src/semantic/required.ts:135-148`) — are bounded by section count;
* **slot-driven** findings are the ones this member caps.

### 3.6 Non-coverage, stated as a requirement

An implementation must document, in the member's own doc comment and in `docs/architecture.md`
§10.5, that `relationColumnSlotsUpperBound` on `tables`:

* is **not** a byte, heap or RSS bound: it bounds records and slot-driven diagnostics, and a record
  built from a quoted element keeps its own copy of that element's text
  (`partRaw`, `src/schema/values.ts:232-234`);
* **over-counts** by construction (`L + 1` per occurrence, duplicates included), so it also refuses a
  document whose single column name is longer than the ceiling even though that document costs
  `tables` one record (§5.3, §5.4);
* says nothing about `[Entity]` `Field=` lines, unknown keys, line- or section-driven findings, or the
  composed path — those stay with the pre-scan figures, the composed bound, and issue #27.

## 4. R2 — a later unit, not designed here

### 4.1 Scope statement

R2 covers name length in common-column composition on the `inspect`/`validate` envelope. It is a
**separate, independently reviewed unit**: it shares no commit with R1, adds no member to the `tables`
profile, and the correction in §3 does not depend on it. The facts below are recorded so the later
unit starts from the truth rather than from the previous draft's claims.

### 4.2 `tables` shares the derivation and its costs

There is one `derivePartialSemantics` call site (`src/pipeline.ts:128`), and `commonColumnsOf` runs for
every command (`src/semantic/partial.ts:169`, `:319-322`). So `tables` pays the same composition and
retains the same `EntityColumns[]` (`src/semantic/partial.ts:108-112`, `:308-312`). Its own bytes stay
O(E) because it emits counts (`src/view/tables.ts:405-411`), but its **peak** includes the shared
records. Any later claim that R2 is "an `inspect` problem" is wrong; only its *emitted* name text is
envelope-only.

### 4.3 What `E × Σℓ` would and would not bound

A name-length-weighted figure, `[Entity]` sections × Σ raw `CommonField` value code units, is a
**proxy**. It bounds:

* the two emitted name lists — `columns` (effective) and `common` — which `jsonEntityColumns` writes
  through `jsonEffectiveColumn` (`src/json/serialize.ts:678-707`, `:664-676`), i.e. about
  `2 × E × Σℓ` code units before escaping;
* each collision's `pname` and `object` — O(1) per collision, not per column (`:684-690`).

It does **not** bound:

* the per-record constant `k ≈ 140` characters (`jsonEffectiveColumn` without names), i.e.
  `2 × E × C × k` — invisible to a length-weighted figure;
* the `declared` list (`:681-683`), `[Entity]` `Field` projections, `attributes`, `rawElements`;
* `manager.commonFields` (`:1102`), one record per declaration, linear in the input;
* diagnostics volume (`V_DANGLING_COLUMN`, `V_MISSING_REQUIRED_KEY`, collision findings);
* collision `spans` (`src/semantic/common-columns.ts:108-114`, serialised at
  `src/json/serialize.ts:684-690`): four numbers each, `g` per collision group, which a count-only
  `E × C` bound also does not see;
* **`tables` bytes**, which remain O(E) and are not `O(E × Σℓ)` (`src/view/tables.ts:405-411`);
* escape expansion beyond the 2–6× factor (§2.3).

### 4.4 Corrections to the previous draft's R2 prose

* **Case folding touches declared physical names for keys only.** `toLowerCase` appears in the R2 path
  at `src/semantic/common-columns.ts:244` (duplicate grouping), `:326` (the per-entity `seen` map,
  declared and composed), `:338` (the colliding-key set) and `:355` (the per-record `collision` flag).
  The records keep the original case (`pname: first.pname`, `:342`); only map keys are folded. Object
  names and logical names are never folded, and the unrelated `toLowerCase` sites (`pages.ts`,
  `domains.ts`, the declared-encoding token in `decode.ts`) are not part of R2.
* **Opt-out and invalid declarations over-count only.** `composed` is built only when
  `using.value === 1` (`:311-320`); `0` and an unrecognised value compose nothing (`:274-276`), while
  `E × C` counts every `[Entity]` section, so the product over-counts by the opted-out and
  indeterminate entities. `declarationsOf` skips entries that fail to decode or carry no span
  (`:200-204`), while `measure()` counts every `CommonField=` line (`src/budget/measure.ts:473-477`),
  so the `C` factor over-counts unusable declarations too. The only under-count direction is JSON
  escaping of a literal control character in a decoded name, hence the 2–6× factor.
* **The collision record shape** is `{sectionIndex, object, pname, spans}` with `object` the entity's
  unescaped `PName` (`:298`) and `pname` the first occurrence's original case (`:342`), so each
  collision costs `|object| + |pname| + 4 numbers per span`.

### 4.5 Sequencing

R2 lands after R1, as its own reviewed change with its own calibration and ceiling. It is not a
precondition for the `tables` control in §3, and the `tables` control is not a licence to describe R2
as done.

## 5. Calibration and the undecided ceiling

### 5.1 No ceiling is decided, approved or implied

This proposal chooses **no** value. A number inside the theoretical band of §5.2 is **not** thereby
approved, and shipping an unproven value needs a separate explicit authorisation that is **not granted
here**. The sequence is fixed (§5.4): design acceptance first, then a separately authorised bounded
calibration, then a management ceiling decision, then one implementation PR.

### 5.2 The band the value must satisfy, derived

Two shapes fix the band. Neither is a measurement of this counter; both are arithmetic on figures
established above.

| Shape | Slots | Today |
|---|---|---|
| The committed anchor `overEnvelopeDocument()` (`tests/pipeline-admission.test.ts:1008-1017`): about 12,100 bytes, `Fields1` a 12,000-character name (raw 12,002), `Fields2` = `id` (raw 4), no `[Entity]` | (12,002 + 1) + (4 + 1) = **12,008** | `tables` admits it and **must keep** admitting it; `inspect`/`validate` refuse it on Σ`L²` = 144,048,020 |
| The manager's F4-M1A shape (§2.1): the same construction at about 115 KB | about **114,004** (**derived** from about 57,000 diagnostics, not read from a run) | admitted by `tables` today; a real mitigation must refuse it |

So a `tables` ceiling `C` needs `12,008 < C < ≈114,004` — a band of factor ≈9.5. Three powers of two
lie inside it: **16,384**, **32,768** and **65,536** (2¹³ = 8,192 is below the anchor, 2¹⁷ = 131,072
above the measured shape). At two slots per column, they admit roughly 8,192 / 16,384 / 32,768 short
columns and correspond to about 2.3 / 4.6 / 9.1 MB of `tables` diagnostics at the measured 279-byte
average (**estimates**). Choosing among them is the management decision of §5.4, not a design choice.
The §5.3 construction sits far above this band — 12,799,968 slots — so every candidate inside it
refuses that document too; the band is set by the **smallest** shape a mitigation must refuse (the
manager's) and the **largest** shape it must admit (the committed anchor).

### 5.3 The verified construction, and why this is a `tables`-specific hole

One **quoted** element per side with 22 commas inside it — 23 names — repeated in 133,333 `[Relation]`
sections, with `Entity1`, `Entity2`, `Fields1`, `Fields2` only:

```
[Relation]
Entity1="t"
Entity2="t"
Fields1="a,a,…,a"      23 names, 22 commas inside one quoted element
Fields2="a,a,…,a"      same
```

All figures below are **derived** by hand from the code's own rules (§1.2); nothing was run.

| Quantity | Derivation | Value |
|---|---|---|
| `L` (raw relation value, code units) | 2 quotes + 23 names + 22 commas | **47** |
| slots per occurrence | `L + 1` (`src/budget/measure.ts:349-361`) | 48 |
| `relationColumnSlotsUpperBound` | 2 × 48 × 133,333 | **12,799,968** |
| Σ`L²` | 2 × 47² = 4,418 per section × 133,333 | **589,065,194** |
| input lines | 5 per section (1 header + 4 keys), no blanks | **666,665** |
| `contentLineOccurrences` | 133,333 headers + 533,332 key lines | **666,665** |
| `entityFieldOccurrences` | no `[Entity]` | 0 |
| composed bound | 0 `[Entity]` × 0 `CommonField` | 0 |
| input size | 147 bytes per section × 133,333 | **≈19.6 MB** (inside `maxBytes` 64 MiB) |
| longest line | `Fields1=` (8) + raw value (47) code units | **55** (inside `maxLineLength` 4 MiB) |
| **retained `RelationColumn` records** | 23 + 23 = 46 per section (no empty slots, no dropped trailing slot) × 133,333 | **6,133,318** |
| `DanglingColumn` records | one per unmatched non-empty slot | **6,133,318** |
| diagnostics | 6,133,318 `V_DANGLING_COLUMN` + 266,666 `V_DANGLING_ENTITY` (both endpoints dangling) + 133,333 `V_MISSING_REQUIRED_KEY` (one per section, for the absent `RelationType1`, `RelationType2`, `Position`) + 1 document-level `PageInfo` finding | **6,533,318** |
| `tables --format json` volume | 6,533,318 × ≈279 B | **≈1.8 GB** (**estimate**, arithmetic on the average) |

**The gates today:**

| Gate | Figure | Ceiling | Result |
|---|---|---|---|
| envelope pre-scan | `contentLineOccurrences` 666,665 | 400,000 (`src/budget/admission.ts:132`) | **refused** |
| envelope post-scan | Σ`L²` 589,065,194 | 134,217,728 (`:129`) | **refused** |
| envelope pre-scan | `entityFieldOccurrences` 0 | 200,000 | pass |
| `tables` pre-scan | `contentLineOccurrences` 666,665 | 1,000,000 (`:138`) | pass |
| `tables` pre-scan | `entityFieldOccurrences` 0 | 500,000 | pass |
| `tables` post-scan | composed bound 0 | 4,194,304 (`:136`) | pass |
| `tables` post-scan | slots 12,799,968 | **no member** (`:93-98`) | **pass** |

So the document is **not** "admitted by all": the envelope refuses it twice, on the content-line
ceiling and on Σ`L²`. It is a **`tables`-specific hole** — an input about 19.6 MB, inside every read
limit, that this command processes today. Closing it would refuse, at `(tables, 0.1.0)`, a document
`tables` answered before, which §6.3 states as an outcome change rather than hiding.

Three syntax facts keep the construction honest, and the design must not generalise past them: the
commas must sit **inside one quoted element** (`columnsOf` splits `part.value`, and `partRaw` is the
element text, so an unquoted list gives one-character raws and no `n × L` effect); `Fields1`/`Fields2`
are not repeatable, so a second occurrence would both warn and replace the list (the construction uses
one each); and omitting the three required keys costs **one warning per section**, not one per key
(`src/semantic/required.ts:172-190`), which is why it stays under the `tables` content-line ceiling
while adding 133,333 findings.

### 5.4 Calibration sequence, and what a record must contain

The order is fixed and each step is a separate authorisation:

1. **Design acceptance** — this document, reviewed and accepted as a design. No value, no code.
2. **Separately authorised bounded calibration** — using the existing measurement API and the
   **baseline** CLI, without depending on the new member: `measure()` already publishes
   `relationColumnSlotsUpperBound`, so calibration needs no implementation. **Bounded** is part of the
   authorisation and means: no run writes the §5.3 construction's document (its ≈1.8 GB output stays
   an **estimate**); the construction is exercised at the scan/measurement level only, and JSON-volume
   and RSS evidence comes from fixtures whose output stays inside a recorded cap; and no
   out-of-memory reproduction is authorised. A record must:
   * use **synthetic fixtures only**, through the real command (`runTablesCommand`) on the `tables`
     profile for the output measurements, and through the measurement API for the construction's
     slot figure;
   * report per run: the slot figure, the diagnostics count by code, the emitted JSON length, and peak
     RSS;
   * record platform, Node version, heap limit and maximum string length, as `human-cli.md` §7.1 does
     (`docs/proposals/human-cli.md:1432-1436`);
   * cover the **anchor**, the **verified construction** (slot figure only) and the **candidate ceiling
     ± 1** — at, one below and one above — so both edges of the rule (`observed > ceiling` refuses,
     `observed == ceiling` admits, `src/budget/admission.ts:274-281`) are demonstrated;
   * state the band and the false-positive class the count carries (§3.6, §5.3).
3. **Management ceiling decision** — one value, recorded with the record above and with what it does
   and does not guarantee. Shipping a value that the record does not establish needs a separate,
   explicit authorisation; none is granted here.
4. **One R1 implementation PR** (§8) — the member, the comparison, the tests, the documentation.

### 5.5 Who may change the value afterwards

`DEFAULT_RESOURCE_BUDGETS` is frozen and pinned (`src/budget/admission.ts:126-160`,
`tests/budget-admission.test.ts:126-233`), and the §10.5 tables list every figure with its profiles. A
value change must move the default, the pin and the documentation in the same change; no future edit
may lower it below the anchor's 12,008; and a value that would refuse a committed fixture must never
ship (§6.6).

## 6. Contract and compatibility analysis

### 6.1 `CONTRACT_VERSION` stays `0.1.0`

A new `counter` value is data, not a shape: `E_LIMIT_BUDGET.details.counter` is a string inside a
`Record<string, DiagnosticDetail>`, and `docs/architecture.md:1228-1242` already decided this case
when the two pre-scan counters arrived — "the ten members, their order and the meaning of every
existing value are as they were, so `contractVersion` stays `0.1.0`". A new counter, a new refusal
outcome and a previously processed input becoming `failed` are explicitly not version moves
(`:1238-1253`). Rule 6 (`:1205-1216`) moves the version for an envelope field, key order or value
meaning, none of which changes here.

**The one consumer obligation.** R1 adds exactly **one** new value,
`relationColumnSlotsUpperBound`, to `E_LIMIT_BUDGET.details.counter`. A consumer that types `counter`
as a **strict enum** of the previous values must add it to compile against a refusal; one that types it
as a string or decides from `severity` needs no change. This must be stated in the release note.

### 6.2 `details` keeps three keys, and the refusal shape is unchanged

`E_LIMIT_BUDGET` is emitted with `{counter, observed, ceiling}` and `construct: 'Source'`
(`src/pipeline.ts:69-86`); message and severity are table-driven
(`src/diagnostics/diagnostic.ts:202-205`), and `details` carry this tool's own aggregate figures, no
document text (`docs/architecture.md:1258-1265`). R1 reuses those three keys; adding a fourth is
type-legal and unnecessary, and §9 asks management to keep it that way.

A refusal is `fatal`; `integrate()` gives status `failed` with `source`/`schema`/`completeness` `null`
and `unsupported` `[]`, and `exitPolicyOf` maps any fatal to `{inspect: 1, validate: 1}`
(`src/validate/index.ts:311-315`). `tables` uses the same arm
(`src/tables-command.ts:96-127`), emits `JsonTablesEnvelopeFailed` with status `failed`, `source` and
`result` `null` (`src/json/envelope.ts:965-982`, built at `src/view/tables.ts:353-370`) and exits
`1`. Phase A's `70` stays reserved for internal errors and `74` for a write failure. A refusal is
whole-file and reports `truncated: false`, because `limits.truncated` derives only from
`E_TRUNCATED_INPUT` (`src/json/serialize.ts:1426-1428`).

### 6.3 A new kind of refusal for `tables`

Some inputs that are processed today would become `failed` with exit `1`. That is the gate's purpose
and has precedent at the same `(command, contractVersion)` (`docs/architecture.md:1238-1253`), but for
`tables` this is a **new kind** of refusal, not a tighter existing one: that profile has no
relation-shaped ceiling today, so the §5.3 construction is admitted and its slot-driven diagnostics
are written out. The release note must say so in those terms.

### 6.4 One new member, no new measurement, the envelope untouched

| Item | Today | Under this proposal |
|---|---|---|
| `relationValueLengthSquares` (envelope) | 134,217,728, computed and compared | **unchanged** |
| `relationColumnCodeUnits` (envelope composite) | absent | **not added** — dropped from the plan (§3.4) |
| `composedColumnsUpperBound` (envelope / tables) | 524,288 / 4,194,304 | unchanged, both still compared |
| `entityFieldOccurrences`, `contentLineOccurrences` | 200,000/500,000, 400,000/1,000,000 | unchanged |
| `bounds.relationColumnSlotsUpperBound` | published, one of the 28 leaves, compared by nobody | **unchanged figure**; now compared on `tables` only |
| `TablesResourceBudget` | 3 members | **+1 member**, value decided later (§5) |
| `EnvelopeResourceBudget` | 4 members | **unchanged** — no new member |
| numeric leaves of `ResourceMeasure` | 28, pinned (`tests/budget-measure.test.ts:780-789`) | **28, unchanged** — reusing the published figure adds none |

Because `withResourceBudget()` rebuilds each profile member by member with `checkedCeiling`
(`src/budget/admission.ts:206-252`), a missing member is a compile error rather than a silent
default, and no ceiling can ride along from the other profile. The new member must be added to that
construction and to the pre-comparison check; `EnvelopeResourceBudget` must not gain it.

**Precedence, stated so it cannot be inferred from `??` chaining** (`src/budget/admission.ts:305-329`):

| # | Profile | Gate | Figure | Compared |
|---|---|---|---|---|
| 1 | both | pre-scan | `entityFieldOccurrences` | before `scanSource()` — unchanged |
| 2 | both | pre-scan | `contentLineOccurrences` | before `scanSource()` — unchanged |
| 3 | envelope | post-scan | `relationValueLengthSquares` | unchanged |
| 4 | envelope | post-scan | `composedColumnsUpperBound` | unchanged |
| 5 | `tables` | post-scan | `composedColumnsUpperBound` | **unchanged and first**, so today's reason survives |
| 6 | `tables` | post-scan | `relationColumnSlotsUpperBound` | **new**, after the composed bound |

### 6.5 Goldens and fixtures

The committed corpus measures Σ`L²` = 277 and composed = 2 at its maximum
(`tests/pipeline-admission.test.ts:888-905`). A shipped `tables` value cannot be below the anchor's
12,008 slots without refusing a document the suite requires to be admitted
(`tests/pipeline-admission.test.ts:1008-1017`), and it must also admit all 39 fixtures — asserted,
not assumed. No committed envelope changes and no golden may be regenerated; a ceiling that would
refuse a fixture is a defect, not a calibration choice. Fixtures and goldens are never edited to
accommodate a ceiling.

### 6.6 The Agent Skill

`skills/a5er-cli/SKILL.md` does not enumerate `counter` values; it invokes the CLI and interprets the
envelope. No change is required. A refusal is already reported as a failed document with exit `1`.

## 7. Verification plan

### 7.1 Safe tests the implementation PR must contain

None of these needs a large document, a shipped ceiling, or a load run.

| Layer | File | What it must show |
|---|---|---|
| Pure admission | `tests/budget-admission.test.ts` | hand-built small `ResourceMeasure` objects: exactly at the injected `tables` ceiling **admits**, one past **refuses** (`src/budget/admission.ts:274-281`), an invalid observation throws instead of refusing, the composed bound is reported when **both** are exceeded (precedence), `tables` reads the slot figure while the envelope profile has no such member (profile separation), and the frozen defaults pin the member once a value exists |
| Pipeline wiring (small) | `tests/pipeline-admission.test.ts` | a small injected `tables` budget with slots `S`: a document at `S − 1` slots is refused, one at `S` and one at `S + 1` are admitted; the refusal is one fatal `E_LIMIT_BUDGET` naming `relationColumnSlotsUpperBound` with `details` of three keys, `source`/`result` `null`, exit `1`; a delegating `scanSource` wrapper proves the refusal happens before `classify()` |
| Construction as mathematics only | this document and a pure-admission case | the §5.3 numbers are asserted as arithmetic, **not** by running a 19.6 MB document or any admitted large-slot pipeline case |
| Immutability | `tests/immutability.test.ts`, `tests/json-goldens.test.ts`, `tests/cli-tables-cases.test.ts` | every committed envelope is byte-identical; staged copies only; no fixture edited |
| Diagnostics and exit | `tests/pipeline-admission.test.ts` | the fatal line, `details` of three keys and exit `1` for `tables` text and JSON; the pre-scan refusal still precedes the post-scan one; `70`/`74` unaffected |

### 7.2 Post-approval behavioural tests (implementation plan, after the ceiling is decided)

These need a decided value and belong to the implementation PR, not to the design or the calibration:

* **ceiling ± 1 through the real command**, on synthetic fixtures staged as disposable copies;
* **the default-profile CLI case that stays safe if the gate fails open**: one long relation value
  that exceeds the slot ceiling yet yields exactly **one** real column — the short-circuit case of the
  bound's own conservatism — so even a broken comparison that admits it runs a resource-bounded
  document. This is the one admitted-side CLI run at a shipped ceiling, and it is safe by construction;
* the **156-of-156** fixture fence: 39 synthetic fixtures × 4 command forms (`inspect`, `validate`,
  `tables` text, `tables --format json`), byte-identical on stdout, stderr and exit code against the
  accepted baseline build. The recorded comparison is 156 of 156 against base `1c6a4320` and again
  against `251ec00` (`docs/test-strategy.md:485-492`); those were **pre-merge runs, not CI jobs**, and
  this plan requires the comparison again after implementation rather than re-running it now.

### 7.3 Gates and what the plan does not verify

`build`, `typecheck`, `lint`, `format:check`, `test` from `package.json`, with real results reported,
including failures. CI is `.github/workflows/ci.yml` as it exists: two jobs — `verify`
(ubuntu-latest/windows-latest × Node 24/26, running those five commands) and `pack-smoke` (the same
matrix, packing the tarball and smoke-testing the CLI from it). CI must be checked against the exact
pushed commit SHA for every job of that matrix, and the CodeQL check that GitHub-side default setup
runs on pull requests must be inspected and reported — it is **not** part of `ci.yml` and no workflow
file for it exists in this repository.

What the plan does **not** verify: any threshold (that is §5.4's separate calibration); any heap, RSS
or out-of-memory behaviour (nothing here measures physical memory); any claim that a document below
every ceiling is cheap; and any shipped `tables` value, because none is decided.

## 8. Implementation sequence

Each step is separate and none begins without the previous authorisation.

1. **Design acceptance** — this document. The reviewer's PASS accepts the mechanism and the sequence,
   not a ceiling.
2. **Calibration** (§5.4, separately authorised) — bounded, synthetic, baseline CLI, existing
   measurement API; produces the record.
3. **Ceiling decision** — management picks a value from the record and records its false-positive
   class and non-guarantees.
4. **One R1 PR** (`src/budget/admission.ts`, `docs/architecture.md` §10.5, `docs/test-strategy.md`
   gate table):
   * add `relationColumnSlotsUpperBound` to `TablesResourceBudget`, to `withResourceBudget()`'s
     member-by-member construction and to its pre-comparison check;
   * compare it in the `tables` branch **after** the composed bound (§6.4 table), with
     `observed > ceiling` refusing and `observed == ceiling` admitting;
   * add the decided value to `DEFAULT_RESOURCE_BUDGETS.tables` and to the defaults pin;
   * add the tests of §7.1 and §7.2, and document the non-coverage of §3.6;
   * add **no** counter to `ResourceMeasure`, leave the 28-leaf pin at 28, and leave
     `EnvelopeResourceBudget` without a new member.
5. **Post-implementation verification** — the 156-of-156 fence, the §7.2 behavioural cases, the full
   gate set and CI on the pushed commit.

Constraints: no step may lower an existing ceiling, add a new measurement leaf, add a fourth `details`
key, change the exit code, regenerate a golden, or ship a value without the authorisation of step 3.
R2 (§4) is a later unit and shares no commit with step 4.

## 9. Open decisions for management

| # | Question | Why it is not decided here |
|---|---|---|
| Q1 | Approve the R1 scope as **one `tables` member** (the published slot bound), with the envelope profile and Σ`L²` untouched and the composite dropped? | §3.2–§3.4 state the reasoning; the correction removes an envelope addition rather than adding one. |
| Q2 | Authorise the bounded calibration of §5.4, with that protocol and no dependency on the new member? | Calibration is a separate authorisation and a separate task; this document only specifies it. |
| Q3 | Which ceiling ships: 16,384, 32,768, 65,536, or something else inside the derived band? | §5.1–§5.2: a value inside a theoretical band is not thereby approved; the calibration record must justify it. |
| Q4 | Confirm the comparison order **composed bound first, then slots**, preserving today's refusal reason? | §6.4. The reverse order would change which counter a document over both reports. |
| Q5 | Is the envelope slot control (option E) with its `k × n` analysis an issue-#27 follow-up rather than part of R1? | §3.4. It needs its own analysis and ceiling; folding it in would repeat the coupling this correction removes. |
| Q6 | Accept that a `tables` document processed today becomes `failed` at `0.1.0`? | §6.3. The precedent exists, but this is a new kind of refusal for that profile. |
| Q7 | Do `details` stay at three keys and `CONTRACT_VERSION` at `0.1.0`? | §6.1–§6.2. Reuse keeps the shape; a fourth key is type-legal but unnecessary. |
| Q8 | Is R2 acceptable as a later, independently reviewed unit with the corrections in §4 recorded now? | §4. The facts are corrected here so the later unit does not inherit the previous draft's claims. |
| Q9 | Does repairing the `docs/test-strategy.md` CI job table (it lists six jobs `ci.yml` does not define) belong to this change? | Unrelated drift; §7.3 cites `ci.yml` and the inspected CodeQL check rather than the table. |
| Q10 | Who reviews, and what counts as acceptance? | `AGENTS.md`: implementation completion is not acceptance; the issue stays open until a reviewer records an explicit PASS. |

**Where the ten reconciling points live, for review:** problem and evidence §1, §2; the R1 `tables`
control §3.2–§3.3, §6.4; the envelope follow-up §3.4, Q5; R2 as a future unit §4, Q8;
non-coverage §1.5, §3.5, §3.6, §7.3; calibration first §5.4, §8; no shipping threshold §5.1, Q3;
safe tests §7.1–§7.2; compatibility and precedence §6, Q6–Q7; open decisions Q1–Q10.
