# Proposal — F4-D1: a separator-count admission control for relation columns on `tables`

> **Status: draft design proposal. Not implemented, not calibrated, no metric or ceiling approved.**
> Nothing here is shipped behaviour. This document changes no code, test, fixture, golden, contract
> or version. It recommends **one** additive `tables` budget member, fed by **one** new measurement
> figure, compares it after the existing composed bound, names the calibration that must happen
> before any value is chosen, and leaves the envelope profile untouched. Design acceptance is not
> calibration, calibration is not a ceiling decision, and neither authorises shipping a value.

| | |
|---|---|
| Baseline | `main` at `8df73ea8fa4f79880196cfab79497be65437e031` |
| Package | `@j1nn0/a5er-cli` `0.1.2` |
| Contract | `CONTRACT_VERSION` `0.1.0`, and it stays `0.1.0` (§6) |
| Tracks | [issue #27](https://github.com/j1nn0/a5er-cli/issues/27) (F-4) |
| Scope | R1: one new `TablesResourceBudget` member compared against a new separator-count figure, with the metric recommended by this design and both the metric and its ceiling approved later. R2 is a future independent unit (§4) |
| Out of scope | ceiling values (§5), calibration runs, implementation, integration, envelope changes, Field-heavy JSON, unknown-key volume, diagnostics outside the relation path, streaming or plan-B projection, read-limit changes |

Normative words: **must**, **must not** and **never** are requirements on an implementation this
proposal would authorise. "Today" means the baseline above. Every claim carries one of four labels:

| Label | Meaning |
|---|---|
| **measured** | Observed in a run recorded in this repository or in the manager's F4-M1A report, with its environment. Not re-run for this proposal. |
| **derived** | Follows by arithmetic on the code's own rules or on a cited figure; no run needed, and no run is claimed. |
| **estimate** | Arithmetic on a written record's shape. A planning figure, not an observation. |
| **hypothesis** | Plausible but unestablished, and stated as such. Physical heap cost is the main one. |

**Recommendation in one paragraph.** Adopt a **separator count** as the `tables` R1 metric: for every
`Fields1`/`Fields2` value, `1 + the number of literal commas`, summed — a figure that is a sound upper
bound on the retained relation columns and, unlike the published slot bound, is **blind to name
length** (§3). Add it to `ResourceMeasure.counters` in the existing relation loop, and add one
`TablesResourceBudget` member comparing it **after** the existing composed bound, so today's refusal
reason survives. The published `bounds.relationColumnSlotsUpperBound` stays where it is — published,
documented, unchanged, with no consumer — because its unit mixes columns with name lengths (§3.1).
The envelope profile, Σ`L²` and the seven shipped ceilings do not change. No ceiling value is chosen
here: §5 records derivations only, the calibration that would justify a value is a separate,
separately authorised step, and rejecting the manager's shape is a **policy choice** for that step.
R2 remains a future, independently reviewed unit with a narrower proxy than the previous draft
claimed (§4).

## 1. Problem statement and the current implementation

### 1.1 What admission is for, and the rule it applies

The read limits bound the **input** — `maxBytes` is bytes (`src/io/read.ts:242`), while `maxLines`
and `maxLineLength` are counts of **decoded UTF-16 code units** (`src/decode/decode.ts:252-267`) — and
say nothing about the **work** an accepted document asks for (`docs/architecture.md` §10.5; module
comment at `src/budget/admission.ts:50-60`). Admission runs twice: a pre-scan walk before the scan
(`src/pipeline.ts:116-118`) and a measurement of the finished scan before `classify()`
(`src/pipeline.ts:124-125`, classification at `:127`). The comparison rule is one line:
`observed > ceiling` refuses, and a document **exactly at** a ceiling is admitted
(`src/budget/admission.ts:274-281`, rationale at `:26-32`).

The unit of every relation figure in this document is the **decoded relation value**, quotes and
escapes included — the string the scanner hands to `measure()`. All four codecs this project decodes
— `utf-8`, `shift_jis`, `utf-16le`, `utf-16be` (`src/decode/bom.ts:9`, candidate order `:12`;
declared-name mapping `src/decode/decode.ts:189-201`) — produce decoded text, so a figure computed
from that text is **codec-independent**, while `maxBytes` is not. A BOM only lowers the byte count.

### 1.2 R1 — what the relation stage actually retains

`columnsOf` (`src/semantic/relations.ts:174-204`) is the amplification. For one section and one key
it walks the entries and, for the **last** decoded occurrence, splits every element's text on commas:

```ts
// src/semantic/relations.ts:188-201, abridged
const parts = value.trailingElementsOmitted ? value.parts.slice(0, -1) : value.parts;
const columns: RelationColumn[] = [];
for (const part of parts) {
  for (const name of part.value.split(',')) {          // split first, unescape second (:193)
    columns.push({ pname: unescapeEscaped(name), raw: partRaw(part), span: occurrence.span,
                   index: columns.length, empty: name === '' });
  }
}
list = { key, raw: occurrence.raw, span: occurrence.span, columns };   // ← assignment, not append
```

Four rules follow from that code, and the design must not describe anything else:

* **Only the last decoded occurrence per key per section survives.** `list` is assigned (`:201`); a
  second `Fields1` in one section replaces the first and the earlier array is not retained. A
  duplicate is reported once per extra occurrence as `S_DUPLICATE_KEY`
  (`src/schema/registry.ts:730-740`; `Fields1`/`Fields2` are not `repeatable`, `:162-181`).
* **`trailingElementsOmitted` drops exactly one element**, and only when the last element is empty
  *and* unquoted (`src/syntax/complex.ts:189-192`). A bare trailing comma declares nothing; a quoted
  empty element (`""`) declares an empty slot, retained as a record but skipped for diagnostics
  (`src/semantic/relations.ts:355`).
* **One slice yields exactly one part.** The element splitter cuts only outside double quotes
  (`src/syntax/complex.ts:113-143`), and `readPart` (`:145-166`) returns one part per slice.
* **Each column's `raw` is the whole element text** (`partRaw`, `src/schema/values.ts:232-234`), so a
  quoted element of `L` code units that splits into `n` slots retains `n` records each holding that
  element's text. The **logical content** is `n × L` code units; whether that becomes physical heap
  is engine-dependent and is **not established here** (§1.5, §3.6).

The envelope then repeats the shape: per column it writes `{pname, raw, span, index, empty}` and per
list the whole value again as `raw` (`src/json/serialize.ts:846-863`), and the value also appears as
`scalars[].raw` and `scalars[].value.parts[].value` (`:882-903`, `:564-573`). `inspect`/`validate`
build that envelope as one string (`src/cli.ts:304`, `src/json/index.ts:83`).

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

Four things must stay apart when costs are discussed, and this document keeps them apart:

| Thing | What it is | Bounded by |
|---|---|---|
| **retained records** | `RelationColumn` and `DanglingColumn` objects kept in `PartialSemantics` until the process ends | a **column count** (the R1 metric, §3) |
| **transient objects** | per-value `parts`, the `part.value.split(',')` arrays and substrings, the replaced list of a duplicate key | the scan's lifetime, not by the gate |
| **JSON mappings** | one fresh `jsonDiagnostic` object per diagnostic while the document is built | the diagnostic count |
| **estimated bytes** | the written document, from per-record arithmetic (§2.3) | nothing here — an **estimate**, not a bound |

### 1.4 The gap: the `tables` profile has no relation control

The `tables` branch of `admit()` compares exactly one figure, `composedColumnsUpperBound`
(`src/budget/admission.ts:332-341`). A document with no `[Entity]` and no `CommonField` has a composed
bound of 0, so **every** `tables` ceiling passes it regardless of how many relation columns it
declares, while each of those columns can produce a retained record and a diagnostic.

Two published figures come close, and neither is a column count:

| Figure | Unit | Why it is not the control |
|---|---|---|
| `counters.relationValueLengthSquares` (Σ`L²`) | code units squared | grows with name length; one 4 MiB name scores 1.7 × 10¹³ with **one** column, while 400,000 one-code-unit values score 400,000 with 400,000 columns |
| `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`) | **slots** | a sound count upper bound, but its unit mixes columns with name length: the committed anchor scores 12,008 for **two** columns (§3.1, §5.2) |

§5.3 gives a derived, unexecuted illustration that the `tables` profile admits today and the envelope
refuses at its pre-scan gate.

### 1.5 What is not in question (the invariants this change must keep)

| Invariant | Detail |
|---|---|
| Seven shipped ceilings unchanged | Σ`L²` 134,217,728; composed 524,288 (envelope) / 4,194,304 (`tables`); Field 200,000 / 500,000; content lines 400,000 / 1,000,000 (`src/budget/admission.ts:129-138`) |
| Envelope profile unchanged in R1 | no new member and no new comparison: the shared `measure()` gains the counter, but the envelope profile compares only Σ`L²` and the composed bound |
| The target is `tables` | the profile that emits no relation text but carries the diagnostics list |
| Composed precedence | the composed bound is still compared first, so today's refusal reason survives |
| `details` exactly three keys | `{counter, observed, ceiling}`; no document text (`src/pipeline.ts:69-86`) |
| `CONTRACT_VERSION` stays `0.1.0` | a new `counter` value is data (`docs/architecture.md:1228-1242`) |
| Admitted bytes preserved | no admitted document's output changes; no golden is regenerated |
| Some `tables` inputs newly fail | stated as an outcome change in §6.3, not hidden |
| Fixtures and goldens absolute | never edited to accommodate a ceiling; a value must admit all 39 fixtures |
| 156 comparisons as a post-implementation fence | 39 × 4, after implementation, not during design (§7.2) |

The reason for the gate at all is the same as before: the read limits bound the input, and a
document inside every read limit can still ask the relation stage for millions of records.

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
re-run for this proposal, and the per-diagnostic figure below is **arithmetic** on it.

### 2.2 What none of those measurements establish

* **No run reports a column count or a separator count.** F4-M1A reports output volume, diagnostic
  count and the growth direction; the about-57,001 separator count attributed to that shape in §5.2 is
  a **shape-dependent estimate** derived from its diagnostic count, not read from a run.
* **No measurement of the recommended figure exists**, because it is not implemented.
* **No heap measurement exists for the relation shape.** The `n × L` representation is logical content
  established from the code; its physical cost is a **hypothesis** (engine-dependent, unmeasured), and
  this document makes no RSS or heap claim about it.
* **`tables` measurements do not transfer to `inspect`.** `tables` streams in chunks
  (`src/json/stream.ts:1-49`) and builds its own document; `inspect`/`validate` build one string.
* **Nothing here was re-run.** No load, heap or out-of-memory measurement was run for this proposal,
  and the §5.3 illustration was not executed.

### 2.3 Per-record estimates and arithmetic used later

| Quantity | Value | Derivation |
|---|---|---|
| Relation column record in the envelope (`jsonRelationColumn`, `src/json/serialize.ts:846-853`) | ≈128 characters excluding `raw` | a representative record with a 4-character `raw` serialises to 132 characters, 128 of them not `raw` — **estimate** |
| Effective-column record in the envelope (`jsonEffectiveColumn`, `:664-676`) | ≈140 characters excluding the names | 137 characters with both names empty, 148 with a 7-character and a 2-code-unit name — **estimate** |
| Escape factor `f` on a decoded name | 1–6 | `src/schema/values.ts:100-142`: `\n`/`\t` decode to one control character, which JSON writes back as 2 characters, or up to 6 (`\u000b`) — **derived** |
| Diagnostic record in the `tables` JSON (`jsonDiagnostic`, `src/json/serialize.ts:1305-1314`) | ≈279 bytes average | **arithmetic** on F4-M1A: 15.9 MB / 57,000. No worst-case per-diagnostic figure is claimed in this document |

## 3. R1 — the metric decision

### 3.1 Decision table: the published slot bound (B) versus the separator count (E)

`B` is the shipped `bounds.relationColumnSlotsUpperBound` = Σ(`L + 1`). `E` is the recommended figure:
Σ over every `Fields1`/`Fields2` occurrence of `1 + the number of literal commas` in the raw value.
"cols" is the number of `RelationColumn` records actually retained by `columnsOf`.

| Criterion | **B** — Σ(`L + 1`) | **E** — Σ(1 + literal commas) |
|---|---|---|
| Metric and units | slots: an upper bound on columns, derived from **code-unit length** | **columns**: a sound upper bound on the retained column count, computed from **separators** |
| Soundness | sound (`L + 1 ≥ names`, `src/budget/measure.ts:349-361`), verified against the listed slots on every fixture (`tests/budget-measure.test.ts:518-576`, `:790-800`) | sound by the slice/part identity (§3.2); tight except `+1` per trailing-omitted value and duplicates (§3.3) |
| Compute location and cost | already computed — `src/budget/measure.ts:514-522`; zero additional cost | new accumulation in the relation branch (`:479-493`): one allocation-free pass over text the loop already holds, `O(ΣL)`, `O(1)` memory, `checkedAdded` accumulation (§3.5) |
| False-positive class | **length-sensitive**: any value longer than the ceiling is refused regardless of column count. The committed anchor scores 12,008 for 2 columns; a one-column document with a 500-code-unit name scores 503 | **length-blind**: a 4 MiB single name scores 1. Only multiplicity counts — duplicate occurrences (each ≤ 1 per value) and one dropped trailing slot per value |
| Demonstrated amplification rejected | the manager's shape at any ceiling `< ≈114,006`; the §5.3 illustration at any sane ceiling | the manager's shape at any ceiling `< ≈57,001`; the §5.3 illustration at any sane ceiling |
| Calibration still required | yes, and awkwardly: no ceiling below `maxLineLength + 1` (4,194,305) is free of long-name refusals | yes, but the number is directly a column budget; rejecting the manager's shape is a **policy choice** |
| Contract impact | none — the figure exists; only a member and a comparison are added, and the 28-leaf pin is untouched | **one new leaf**: a new `ResourceCounters` field makes the pin 28 → **29** (§3.5, §6.4) and adds one `BudgetCounter` value |
| Test requirements | reuse the slots-bound tests; add the gate cases and a long-name case, which for B is a false-positive test: its unit is length-weighted, so a long single name scores high for one column | all of B's gate tests, with the long-name case reframed as an **admission** test (a long name scores `E` 1, so it proves no length false positive and can never exercise a ceiling in the tens of thousands), **plus** two dedicated E tests (§7.1 L1): hand-computed exact values for every §3.2 case, and a fixture-wide invariant `E ≥` the retained relation-column count, **never** universal equality |
| Verdict | **stays published-only**, no consumer | **recommended** for the `tables` ceiling |

### 3.2 Why E is sound — proof sketch

Let `r` be one raw value and `C(r)` its number of **literal** commas.

1. The element splitter yields `C_outside(r) + 1` slices, where `C_outside` counts commas outside
   double quotes (`src/syntax/complex.ts:113-143`; `:141` pushes the final slice), and `readPart`
   maps each slice to **exactly one** part — its only returns are `:151`, `:160` and `:165`
   (`:145-166`).
2. `columnsOf` keeps `K` parts: `K = slices − 1` when `trailingElementsOmitted`, else `K = slices`
   (`src/semantic/relations.ts:188`).
3. Each kept part contributes `commas(part.value) + 1` columns (`:191`). `part.value` is a **substring**
   of `r` (`src/syntax/complex.ts:160`, `:165`; the only trimming is spaces and tabs at slice edges,
   `:148-150`), so its commas are a subset of `r`'s.
4. The `slices − 1` separator commas sit **outside** every slice, so they are counted in `C(r)` and
   never inside a kept part.

Therefore `columns(r) = C(r) − C_outside(r) + C_outside(r) + 1 = C(r) + 1 = E(r)` when nothing is
dropped, and `columns(r) = C(r) = E(r) − 1` when one trailing slot is dropped. Unescaping cannot change
this: **no escape maps to a comma** (`src/schema/values.ts:101-108`) and unescaping happens **after**
the split (`src/semantic/relations.ts:191-193`). A Complex value also cannot fail to decode
(`src/schema/values.ts:206-218` returns `ok: true`), so there is no failure path that would change the
count.

Every case is covered, including the awkward ones: a quoted list (`"a,b"` → 2), two quoted elements
(`"a","b"` → 2, the separator is the counted comma), an unquoted list (`a,b` → 2), a trailing
separator (`a,b,` → `E` 3, columns 2 — **safe over-count**), a quoted empty element (`"a",""` → 2),
an empty value (`Fields1=` → `E` 1, one `empty` slot), an escaped comma (`"a\,b,c"` → `E` 3,
columns 3), an unterminated quote (`"a,b` → `E` 2, columns 2, plus one `S_COMPLEX_UNTERMINATED_QUOTE`),
duplicate keys (`E` counts both, columns keep the last — safe), and a malformed line with no `=`
(neither counted; `src/syntax/scanner.ts:245-254`).

### 3.3 The maintenance condition this soundness depends on

`E` is sound **only while every literal comma outside quotes becomes a column boundary and no other
separator exists**. That is the grammar rule `columnsOf` implements today: `slice` splits on commas
outside quotes and on nothing else, and `readPart` produces one part per slice. A future change that
introduces another separator, CSV-style `""` doubling, or a path by which a comma reaches
`part.value` from somewhere other than the raw text would have to change `columnsOf` itself — so the
review of that change must re-derive this bound. **Writing that dependency into the design is a
requirement**, not a comment: the counter's doc comment must name `columnsOf` as the grammar it
mirrors (§3.7).

### 3.4 Recommendation: E, with B left published

Take **E** for the `tables` ceiling. Its unit is what the gate is about — a column budget — and it is
length-blind, so it does not refuse a document because one name is long. B stays exactly as it is:
published, documented, unit-tested, and still read by no gate. The alternative of reusing B (zero new
leaves) is rejected because its unit cannot express "at most N columns": the committed 12,100-byte
anchor scores 12,008 for two columns, and a ceiling low enough to mitigate would refuse every
document with a long name (§5.2).

**What the gate compares and in what order** (`src/budget/admission.ts:305-341`):

| # | Profile | Gate | Figure | Compared |
|---|---|---|---|---|
| 1 | both | pre-scan | `entityFieldOccurrences` | before `scanSource()` — unchanged |
| 2 | both | pre-scan | `contentLineOccurrences` | before `scanSource()` — unchanged |
| 3 | envelope | post-scan | `relationValueLengthSquares` | unchanged |
| 4 | envelope | post-scan | `composedColumnsUpperBound` | unchanged |
| 5 | `tables` | post-scan | `composedColumnsUpperBound` | **unchanged and first**, so today's reason survives |
| 6 | `tables` | post-scan | `relationColumnCountUpperBound` (E) | **new**, after the composed bound |

### 3.5 Where it is computed, and what it costs

* **Location:** the `kind === 'Relation'` branch of `measure()` (`src/budget/measure.ts:479-493`),
  beside the `checkedValueLength(entry.value, …)` calls (`:483`, `:490`) — the same string, already
  proven to be a string there.
* **Cost:** one pass over the relation values, `O(ΣL)` character comparisons, **allocation-free** as a
  loop (`split(',').length` would allocate arrays and substrings and must not be used), `O(1)` retained
  state. `ΣL ≤ maxBytes` = 67,108,864, so the worst case is 64 M comparisons — the same order as the
  decoder's own pass over the same text.
* **Documentation impact:** `src/budget/measure.ts:39-42` promises `O(S + E)` with no
  input-proportional work; it becomes `O(S + E + ΣL)` for the relation values only. The
  "no input-proportional intermediate array" half stays true.
* **Integer safety:** per value `commas + 1 ≤ L + 1 ≤ maxLineLength + 1 = 4,194,305`; the running total
  is at most `occurrences × (maxLineLength + 1) ≤ 2,000,000 × 4,194,305 ≈ 8.4 × 10¹² < 2⁵³`. Accumulate
  through `checkedAdded` (`src/budget/measure.ts:129-144`) like every other counter, so a hand-built
  scan outside that range throws `ResourceMeasureError` instead of publishing a rounded figure.
* **New leaf:** E is not any existing figure. `ResourceCounters` (`:247-317`) and `ResourceBounds`
  (`:349-362`) hold no comma count, and `relationColumnSlotsUpperBound` is Σ(`L + 1`), not Σ(1 +
  commas). So the measurement gains **one numeric leaf**, and the pin at
  `tests/budget-measure.test.ts:784` becomes **29** — edited deliberately in the same change, with the
  reason recorded. This is the price of a figure whose unit is a column count; a decision to reuse B
  would pay zero and inherit B's unit.

### 3.6 What E does and does not bound

**It bounds**, for the retained list of each key in each section, the number of columns (§3.2), and
therefore the column-driven records and the column-driven diagnostics (`V_DANGLING_COLUMN`, one per
unmatched non-empty slot, `src/semantic/partial.ts:243-251`). It over-counts duplicates by one per
extra occurrence and one dropped trailing slot by one, both in the safe direction.

**It does not bound:**

* the **whole** `tables` diagnostic volume. Endpoint findings (`V_DANGLING_ENTITY`, up to 2 per
  relation) and missing-required-key findings (one per relation section) are linear in the **relation
  count**, not in the column count. They are bounded instead by the pre-scan content-line ceiling
  (1,000,000 for `tables`) and must be described that way;
* the **bytes** those records hold — each retains its element text (`partRaw`), so the logical content
  is `n × L`; the heap cost of that is a **hypothesis**, not a bound (§1.5);
* **transient** objects (`parts`, the split arrays, a replaced duplicate list) or the JSON mappings
  built while the document is encoded;
* `[Entity]` `Field=` lines, their projections, unknown keys, the composed path, or diagnostics that
  are not relation-column findings;
* the envelope's `n × L` representation — that is `inspect`/`validate`'s problem, and Σ`L²` is its
  figure.

### 3.7 The envelope is unchanged

The envelope profile keeps Σ`L²` as its only relation figure, with its 134,217,728 ceiling and its
pinned refusal identity, and gains no member. That is deliberate rather than an oversight: a ceiling
for an envelope relation figure sitting at or above Σ`L²` ceiling + `maxBytes` is *sufficient* to be
non-binding, but sufficiency is not necessity, and no value below that was shown to be safe. Neither
Σ`L²` nor E is a substitute for the other, either: `ΣL² ≥ E` does **not** hold in general (a value `,`
has `L = 1`, `E = 2`, `L² = 1`), so a Σ`L²` ceiling does not bound the number of short columns. That
residue is exactly the `tables` hole this change closes on the `tables` profile, and an envelope
question for issue #27 — not this unit.

## 4. R2 — a future independent unit

### 4.1 Scope

R2 covers name length in common-column composition. It stays a **separate, independently reviewed
unit**: no shared commit with R1, no `tables` member, and no dependency of the R1 design on it. The
paragraphs below record what the proxy may and may not claim, so the later unit does not inherit the
previous draft's overstatements.

### 4.2 What the proxy covers, restricted

A name-length-weighted figure — entity sections × Σ raw `CommonField` value code units — is a proxy for
**common-derived physical and logical names in the arrays that render them, before escaping**: the
`columns` (effective) and `common` lists written through `jsonEffectiveColumn`
(`src/json/serialize.ts:678-707`, `:664-676`), i.e. about `2 × N_ent × Σℓ` code units before escaping,
where `N_ent` is the number of `[Entity]` sections. Outside those lists, only each collision's
repeated entity `object` and its `pname` are length-related. It does **not** cover:

* **declared** column names (`declared`, `:681-683`) or `[Entity]` `Field` projections, `attributes`,
  `rawElements`;
* the collision **object** beyond its repetition and the collision `pname` where it may be a declared
  name, and the collision **spans** (four numbers each, `g` per group;
  `src/semantic/common-columns.ts:108-114`, `src/json/serialize.ts:684-690`);
* entity names as such, `manager.commonFields` (`:1102`), or unrelated diagnostics;
* the **fixed per-record cost** `k ≈ 140` characters per effective column (`jsonEffectiveColumn`
  without names) — invisible to a length-weighted figure;
* escaping beyond the 2–6× factor (§2.3).

Collisions **multiply the repeated entity name**: each collision record repeats `object` (the entity's
`PName`, `common-columns.ts:298`, `src/semantic/access.ts:59-61`) and one span per occurrence, so a
group of size `g` emits `g` spans. A collision can form from **declared fields alone** — two `Field`
lines with the same physical name (`common-columns.ts:301-307`, `:322`, `:323-345`, case-insensitive
at `:326`) produce one `ColumnCollision` with no `CommonField` needed — and that declared-only case has
**no committed test** (only the mixed declared-vs-common case is pinned, in
`tests/semantic-domains.test.ts:408-425` and `tests/json-contract.test.ts:2704-2735`). **That gap must
be named and closed in R2's own tests.**

### 4.3 Shared costs the later unit must not attribute to `inspect` alone

`commonColumnsOf` runs for every command (`src/semantic/partial.ts:169`), so the composition and its
`toLowerCase` work are paid by `tables` too. The `toLowerCase` sites are in the shared path
(`src/semantic/common-columns.ts:244`, `:326`, `:338`, `:355`) and touch declared physical names for
**map keys only**; the records keep their original case (`:342`). Opt-out and unusable declarations
only make the `N_ent × C`-style products over-count.

**No universal `tables`-bytes claim.** `tables` writes one row per object with four counts and the
shared diagnostics list (`src/view/tables.ts:67-112`, `:405-411`), so its volume depends on the object
count, the diagnostic count and the per-record sizes together. No single figure bounds it, and R2 makes
no claim about its size.

## 5. Calibration and the undecided ceiling

### 5.1 No ceiling is decided or implied

This design **recommends** the metric and approves nothing. It chooses **no** ceiling. A number inside
any band derived below is **not** thereby approved; rejecting the manager's shape is a **policy
choice** for the ceiling decision, not a mathematical consequence; and shipping an unproven value
needs a separate explicit authorisation that is **not granted here**.

### 5.2 Five-small-shape arithmetic, and why the B band does not transfer to E

`B = Σ(L + 1)`, `E = Σ(1 + literal commas)`, "cols" = retained `RelationColumn` count. All values are
**derived** from §3.2 and the code's own rules.

| Shape | Arithmetic | `B` | `E` | cols |
|---|---|---|---|---|
| (a) one 500-code-unit single-column name | `L = 502`, commas 0 | 503 | **1** | 1 |
| (b) 2,000 relations, 2 columns per side, 8-code-unit names | per occurrence `L = 19`, 1 comma → `B` 20, `E` 2; ×2 occurrences ×2,000 | 80,000 | **8,000** | 8,000 |
| (c) one dense dangling relation, 40 commas in one quoted element | 41 one-character names, `L = 83` | 84 | **41** | 41 |
| (d) escaped commas: `"a\,b,c"` and `"a\\,b"` | `L` 8 / 7, literal commas 2 / 1 | 9 / 8 | **3 / 2** | 3 / 2 |
| (e) duplicated then malformed: `"a,b"` twice, then `"a,b` | `B` 2 × 6 / `E` 2 × 2; `B` 5 / `E` 2 | 12 / 5 | **4 / 2** | 2 / 2 |

The shape that matters for calibration is the manager's F4-M1A document (§2.1): about 57,001 columns,
so `E ≈ 57,001` and `B ≈ 114,006`, both **shape-dependent estimates** derived from its diagnostic count,
not measurements of either figure.

**Do not transfer the B band to E.** Under B the committed anchor requires a ceiling of at least 12,008
and the largest power of two that still rejects the manager's shape is 2¹⁶ = 65,536 (5.46× anchor
headroom). Under E the anchor scores **2**, so that constraint disappears, and the largest power of two
that still rejects the manager's shape is **2¹⁵ = 32,768** — 16,384× the anchor's score. Whether to
reject that shape at all is the policy choice above; a ceiling of 2¹⁵ is a recorded derivation, not an
approval.

**The prospective objective, without a tolerance.** Calibration's objective is to give the ceiling
decision a recorded basis: for each candidate, which synthetic shapes it admits and refuses, what
`observed` each reports, how much output the admitted side produces, and where the refusal lands. No
tolerance, percentage, safety margin or "acceptable risk" figure is specified here.

### 5.3 A derived, unexecuted illustration of the `tables` hole

One **quoted** element per side with 22 commas inside it — 23 names — repeated in 133,333 `[Relation]`
sections, with `Entity1`, `Entity2`, `Fields1`, `Fields2` only. **This has not been run.** Every figure
is **derived** from the code's rules (§1.2, §3.2):

| Quantity | Derivation | Value |
|---|---|---|
| `L` (raw value, code units) | 2 quotes + 23 names + 22 commas | **47** |
| `E` per section | 2 occurrences × (22 + 1) | **46** |
| `E` total (`relationColumnCountUpperBound`) | 46 × 133,333 | **6,133,318** |
| `B` total (`relationColumnSlotsUpperBound`) | 2 × 48 × 133,333 | **12,799,968** |
| Σ`L²` | 2 × 47² = 4,418 per section × 133,333 | **589,065,194** |
| `contentLineOccurrences` | 133,333 headers + 533,332 key lines | **666,665** — the same with or without the FORMAT header, because comments are excluded |
| total lines, with `# A5:ER FORMAT:21` + `# A5:ER ENCODING:UTF8` | 666,665 + 2 comment lines | **666,667** |
| total lines, without those headers | — | **666,665**, plus one `S_HEADER_UNKNOWN_FORMAT` warning (`src/syntax/scanner.ts:449-457`) |
| `entityFieldOccurrences` / composed bound | no `[Entity]` | 0 / 0 |
| input size | 147 bytes per section × 133,333 | **≈19.6 MB** (inside `maxBytes`) |
| longest line | `Fields1=` (8) + raw value (47) code units | **55** (inside `maxLineLength`) |
| **retained `RelationColumn` records** | 46 per section × 133,333 | **6,133,318** |
| retained `DanglingColumn` records | one per unmatched non-empty slot | **6,133,318** |
| diagnostics | 6,133,318 `V_DANGLING_COLUMN` + 266,666 `V_DANGLING_ENTITY` + 133,333 `V_MISSING_REQUIRED_KEY` (one per section, for the absent `RelationType1`, `RelationType2`, `Position`) + 1 `PageInfo` finding | **6,533,318** (6,533,319 without the FORMAT header) |
| `tables --format json` volume | 6,533,318 × ≈279 B | **≈1.8 GB** (**estimate**) |

**What the gates would do:**

| Gate | Figure | Ceiling | Result |
|---|---|---|---|
| envelope pre-scan | `contentLineOccurrences` 666,665 | 400,000 (`src/budget/admission.ts:132`) | **refused — the pipeline returns here** (`src/pipeline.ts:118`) |
| envelope post-scan | Σ`L²` 589,065,194 | 134,217,728 (`:129`) | **never executed** for this document: the pre-scan refusal returns first. It is mathematically over the ceiling, but no Σ`L²` comparison runs |
| `tables` pre-scan | `contentLineOccurrences` 666,665 | 1,000,000 (`:138`) | pass |
| `tables` post-scan | composed bound 0 | 4,194,304 (`:136`) | pass |
| `tables` post-scan | E 6,133,318 | **no member today** | **pass — the hole** |

So the illustration is **not** "admitted by all": the envelope refuses it at the pre-scan gate, and the
Σ`L²` comparison is over mathematically but unexecuted. It is a `tables`-specific hole — about 19.6 MB
inside every read limit that this command would process — and closing it is a new kind of refusal for
that profile (§6.3). The distinction between the **retained** records (6,133,318), the **transient**
arrays built while constructing them, the **JSON mappings** built while encoding 6,533,318 diagnostics,
and the **estimated bytes** (≈1.8 GB) must be kept in any summary of this example.

### 5.4 Calibration sequence, and what a record must contain

The order is fixed, and each step is a separate authorisation:

1. **Design acceptance** — this document. It accepts the metric, the comparison order and the
   sequence; it does not accept a ceiling.
2. **Separately authorised bounded calibration** — run against the **baseline** CLI and the existing
   measurement API. It **cannot prove the new comparison**: E does not exist in the product yet, so it
   is computed out-of-tree from the same synthetic documents, and the baseline has no such gate. The
   record must:
   * use **synthetic fixtures only**, so no real diagram is ever involved;
   * run `tables` on the synthetic documents, recording per run: the **estimated E**, the diagnostics
     count by code, the emitted JSON length, and peak RSS;
   * record platform, Node version, heap limit and maximum string length, as `human-cli.md` §7.1 does
     (`docs/proposals/human-cli.md:1432-1436`);
   * cover the committed anchor, the manager's shape and the §5.3 illustration **without executing the
     illustration's document** — its numbers are arithmetic, and the calibration must not require
     running a ≈1.8 GB output to establish them;
   * state the objective of §5.2 and the false-positive classes of §3.1, and name the policy choice
     about rejecting the manager's shape.
3. **Management metric-and-ceiling choice** — confirm E and pick a value, recorded with the calibration
   record, with what it does and does not guarantee. Shipping a value the record does not establish
   needs a separate explicit authorisation; none is granted here.
4. **One implementation PR** (§8), then **review**, then **authorised integration** — three separate
   steps, none implied by the previous one.

### 5.5 Who may change the value afterwards

`DEFAULT_RESOURCE_BUDGETS` is frozen and pinned (`src/budget/admission.ts:126-160`,
`tests/budget-admission.test.ts:126-233`), and the §10.5 tables list every figure with its profiles. A
value change must move the default, the pin and the documentation in the same change; no future edit
may lower it below the committed anchor's score; and a value that would refuse a committed fixture
must never ship (§6.5).

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
`relationColumnCountUpperBound`, to `E_LIMIT_BUDGET.details.counter`. A consumer that types `counter`
as a **strict enum** of the previous values must add it to compile against a refusal; one that types it
as a string or decides from `severity` needs no change. The release note must say so.

### 6.2 `details` keeps three keys, and the refusal shape is unchanged

`E_LIMIT_BUDGET` is emitted with `{counter, observed, ceiling}` and `construct: 'Source'`
(`src/pipeline.ts:69-86`); message and severity are table-driven
(`src/diagnostics/diagnostic.ts:202-205`), and `details` carry this tool's own aggregate figures, no
document text (`docs/architecture.md:1258-1265`). R1 reuses those three keys; adding a fourth is
type-legal and unnecessary, and §9 asks management to keep it that way.

A refusal is `fatal`; `integrate()` gives status `failed` with `source`/`schema`/`completeness` `null`
and `unsupported` `[]`, and `exitPolicyOf` maps any fatal to `{inspect: 1, validate: 1}`
(`src/validate/index.ts:311-315`). `tables` uses the same arm (`src/tables-command.ts:96-127`), emits
`JsonTablesEnvelopeFailed` with status `failed`, `source` and `result` `null`
(`src/json/envelope.ts:965-982`, built at `src/view/tables.ts:353-370`) and exits `1`. Phase A's `70`
stays reserved for internal errors and `74` for a write failure. A refusal is whole-file and reports
`truncated: false`, because `limits.truncated` derives only from `E_TRUNCATED_INPUT`
(`src/json/serialize.ts:1426-1428`).

### 6.3 A new kind of refusal for `tables`

Some inputs that are processed today would become `failed` with exit `1`. That is the gate's purpose
and has precedent at the same `(command, contractVersion)` (`docs/architecture.md:1238-1253`), but for
`tables` this is a **new kind** of refusal: that profile has no relation-shaped ceiling today, so the
§5.3 illustration would be admitted and its column-driven diagnostics written out. The release note
must say so in those terms, and the `tables` consumer is the one to watch.

### 6.4 One member, one new leaf, everything else fixed

| Item | Today | Under this proposal |
|---|---|---|
| `relationValueLengthSquares` (envelope) | 134,217,728, computed and compared | **unchanged** |
| envelope profile member count | 4 | **unchanged** — no new member |
| `composedColumnsUpperBound` | 524,288 (envelope) / 4,194,304 (`tables`) | unchanged, both compared, **composed still first** |
| `entityFieldOccurrences`, `contentLineOccurrences` | 200,000/500,000, 400,000/1,000,000 | unchanged |
| `bounds.relationColumnSlotsUpperBound` (B) | published, one of the 28 leaves, no consumer | **unchanged and still published-only**; no member compares it |
| new figure E | absent | **new counter** `relationColumnCountUpperBound`, one new numeric leaf |
| numeric leaves of `ResourceMeasure` | 28, pinned (`tests/budget-measure.test.ts:784`) | **29**, pin edited deliberately in the implementation change |
| `TablesResourceBudget` | 3 members | **4** — one new member comparing E |

Because `withResourceBudget()` rebuilds each profile member by member with `checkedCeiling`
(`src/budget/admission.ts:206-252`), a missing member is a compile error rather than a silent default,
and no ceiling can ride along from the other profile. The new member must be added to that construction
and to the pre-comparison check that already proves every observed figure (`:290-295`, `:305-316`); the
envelope profile must not gain it.

### 6.5 Goldens, fixtures, and the post-implementation fence

The committed corpus measures Σ`L²` = 277 and composed = 2 at its maximum
(`tests/pipeline-admission.test.ts:888-905`). Any shipped E ceiling must admit the committed anchor
(`tests/pipeline-admission.test.ts:1008-1017`) and all 39 fixtures — asserted, not assumed — so no
committed envelope changes and no golden may be regenerated. A ceiling that would refuse a fixture is a
defect, not a calibration choice. After implementation, the **156-of-156** fence (39 synthetic fixtures
× 4 command forms — `inspect`, `validate`, `tables` text, `tables --format json` — byte-identical on
stdout, stderr and exit code against the accepted baseline build) is a post-implementation
requirement; the recorded 156/156 runs against `1c6a4320` and `251ec00` were **pre-merge records, not
CI jobs**, and are not re-run here (`docs/test-strategy.md:485-492`).

### 6.6 The Agent Skill

`skills/a5er-cli/SKILL.md` does not enumerate `counter` values; it invokes the CLI and interprets the
envelope. No change is required. A refusal is already reported as a failed document with exit `1`.

## 7. Verification plan

### 7.1 Five layers, and the evidence each one can produce

The plan is layered so that no test is credited with evidence it cannot produce. **L1–L4 need no large
document, no load run and no production seam**, and they are required exactly as written. **L5 is the
only layer that runs the approved production value through a real command, and its refusal half is
deferred by default**; that deferral is a recorded coverage limitation (§7.3), never a reason to weaken
another layer.

#### L1 — the measurement is correct (`tests/budget-measure.test.ts`)

| Test | What it must show |
|---|---|
| Dedicated exact cases | For every §3.2 case, a hand-built scan whose expected `E` is derived **independently by hand** from the raw text, never copied from the implementation: quoted list (`"a,b"` → 2), two quoted elements (`"a","b"` → 2), unquoted list (`a,b` → 2), trailing separator (`a,b,` → `E` 3 against 2 retained columns), quoted empty element (`"a",""` → 2), empty value (`Fields1=` → 1), a value that is one comma (`","` → 2), escaped comma (`"a\,b,c"` → 3), escaped backslash then comma (`"a\\,b"` → 2), unterminated quote (`"a,b` → 2, with its `S_COMPLEX_UNTERMINATED_QUOTE`), padded elements (`"a" , "b"` → 2), duplicate keys (`E` counts both occurrences while one list is retained) and a `Fields1` line with no `=` (neither counted) |
| Fixture-wide invariant | On **every** one of the 39 fixtures, `E` is **at least** the number of `RelationColumn` records the semantics actually retained (`ResolvedRelation.fromColumns`/`toColumns`, `src/semantic/partial.ts:108`, `:308`) — the analogue of the existing slots-bound test (`:790-800`). **Equality is never asserted as a universal property**: `E` over-counts one per duplicate occurrence and one per trailing-omitted value (§3.2), and every occurrence `columnsOf` skips is still counted by `measure()` (a non-`parsed` entry, a null span, a failed decode, a non-object value — `src/semantic/relations.ts:180-186` against `src/budget/measure.ts:479-493`), so each of those only widens the gap in the safe direction. A fixture with neither over-count may additionally assert equality **for that fixture** |
| Unchanged figures and arithmetic | Σ`L²` and the slot bound are unchanged; checked arithmetic rejects an out-of-range accumulation instead of publishing a rounded figure |
| Leaf pin | The numeric-leaf pin (`tests/budget-measure.test.ts:784`) moves 28 → 29 in the same change, with the reason recorded |

**A long name is an admission case, not a ceiling case.** `E` counts commas, not characters: a
one-column name of any length scores `E` 1, the same as a one-character name, and the committed
two-column anchor scores `E` 2. Neither can reach a ceiling in the tens of thousands, however long the
name is. A long-name test therefore shows that the metric does **not** refuse a document for a long
name — the false positive `B` has — and it must never be offered as evidence that the ceiling fires.
That evidence comes from L2 (the decision), L3 (the wiring) and, conditionally, L5 (a real command).

#### L2 — the decision is right (`tests/budget-admission.test.ts`, pure `admit()`)

| Test | What it must show |
|---|---|
| Fixed ceiling, varied observation | With a **fixed injected ceiling `S`**: observed `S − 1` admits, `S` admits (the boundary is inclusive, `src/budget/admission.ts:274-281`) and `S + 1` refuses, reporting `{counter, observed, ceiling}` |
| Fixed observation, varied ceiling | With a **fixed observation `S`**: an injected ceiling `S − 1` refuses, `S` admits and `S + 1` admits. Both directions are required: a comparison written with the wrong operator, or against the wrong member, can pass one direction alone |
| Invalid observation | An observation that is not a non-negative safe integer makes `admit()` **throw** from its pre-comparison check (`checkedObserved`, `src/budget/admission.ts:290-295`, `:305-341`) instead of reporting a refusal. `NaN` is the case to pin: a refusal would state a cost the figures do not support |
| Precedence | When both the composed bound and `E` are over their ceilings, the reported `counter` is `composedColumnsUpperBound` — the `tables` order of §3.4, preserved so today's refusal reason survives |
| Profile separation | The envelope profile has no `E` member and its decision is unchanged by the new figure: the shared `measure()` computes the counter for every document, but the envelope branch compares only Σ`L²` and the composed bound (`src/budget/admission.ts:306-330`). A missing member is a compile error through `withResourceBudget()`'s member-by-member construction (`:206-252`), and no ceiling rides along from the other profile |

#### L3 — the wiring is right, on small inputs (`tests/pipeline-admission.test.ts`)

Every case here injects a **small test budget** — the value is a test fixture, not the production
default (L4) — and uses a small synthetic document staged as a disposable copy.

| Test | What it must show |
|---|---|
| Injected refusal | The document yields one fatal `E_LIMIT_BUDGET` naming `relationColumnCountUpperBound`, `details` of exactly three keys, `source`/`result` `null` and exit `1`; its admitted twin yields the unchanged document |
| Skip proof | With an injected `tables` budget that refuses, a Vitest `vi.mock` of `../src/schema/index.js` whose `classify` is a **delegating spy** (it calls through to the real implementation) records **zero** invocations; on the admitted twin of the same document it records **one**. A `scanSource` wrapper is **not** proof of this and must not be offered as such; no production seam is authorised |
| Diagnostics and exit | The fatal line, exit `1` and the failed JSON document for `tables` text and JSON; the pre-scan refusal still precedes the post-scan one; `70`/`74` unaffected |

#### L4 — the approved default is configured (`tests/budget-admission.test.ts`)

| Test | What it must show |
|---|---|
| Frozen defaults pin | `DEFAULT_RESOURCE_BUDGETS` is frozen and pinned (`src/budget/admission.ts:126-160`, `tests/budget-admission.test.ts:126-233`). The implementation change adds the decided value to `DEFAULT_RESOURCE_BUDGETS.tables` **and** to that pin in the same change, and the pin asserts the exact value and the member set of both profiles |
| No silent default | The member cannot be omitted: `withResourceBudget()` rebuilds each profile member by member through `checkedCeiling` (`:206-252`), so a missing member is a compile error and no ceiling rides along from the other profile |

L4 reads the configuration and compares nothing: it does **not** run a document through the production
value; the only layer that does is L5, and by default only on its admitted side.

#### L5 — a real `tables` run at the approved value (deferred in part)

**Admitted side, required once a value ships.** Two small synthetic documents, each staged as a
disposable copy: a long single name (`E` = 1, `B` large) and a two-column anchor-like shape. These are
**admission** tests — they show that the gate does not refuse a document because a name is long, and that
an honest small document is admitted at the shipped value. A long name scores `E` = 1, so it can never
exercise a ceiling in the tens of thousands and must not be described as evidence that the comparison
fires.

**Refusal side, conditional and deferred by default.** A real command can only show the production
comparison firing if a witness document's `E` exceeds the approved ceiling. No such witness is designed
here and none is authorised by this document. One may be run in the implementation PR only if all of the
following are written down and established there first:

* its `E` is derived by hand from the raw text, not read from the new counter, and exceeds the approved
  ceiling by the smallest margin the decision needs;
* it is small in bytes and content lines, well inside every read limit, and its per-occurrence text is
  short, so the retained `RelationColumn` records stay small — no `n × L` shape and no large admitted
  side;
* it is **fail-open safe**: if the comparison were mis-wired and admitted the document, the pipeline
  would still finish cheaply. The relation resolves, so a wrong admit produces no per-column diagnostic
  storm, no multi-hundred-megabyte document and no heap risk. A witness that would emit one
  dangling-column diagnostic per declared column if wrongly admitted does not meet this condition;
* it is one bounded document, not a sweep, and it stresses no ceiling and no read limit.

**If no witness meets those conditions, the refusal side of L5 is deferred** and §7.3 records what
is then unverified: no real `tables` invocation demonstrates the production comparison refusing
anything between L4's configured value and L3's injected test budget. L2 supplies the decision
evidence, L3 the wiring evidence and L4 the configuration evidence; none of them becomes a real-CLI
claim, and no test in L1–L4 is weakened to compensate.

**Compatibility checks that stay exactly as they are:** `tests/immutability.test.ts`,
`tests/json-goldens.test.ts` and `tests/cli-tables-cases.test.ts` must still show every committed
envelope byte-identical, with staged copies only and no fixture edited.

The §5.3 illustration is **not** a test input: no pipeline or CLI run may use a document of that size,
and its numbers are asserted as arithmetic (a pure-admission case can use the same `E` on a small
hand-built measure). It is not L5's witness either: it is neither small nor fail-open safe.

### 7.2 Post-approval work (implementation plan, after the ceiling is decided)

Only the items below need a decided value. They belong to the implementation PR, not to the design or the
calibration:

* **L4 values** — the decided value enters `DEFAULT_RESOURCE_BUDGETS.tables` and its frozen pin
  (§7.1 L4);
* **L5, if a witness is justified** — the production-ceiling refusal run under §7.1 L5's conditions,
  or its deferral together with the coverage limitation recorded in §7.3;
* the **156-of-156** fence of §6.5, after implementation.

Nothing else moves: §7.1 L1–L4 are the same tests before and after a value is chosen, and the
admitted-side cases of §7.1 L5 stay small by construction.

### 7.3 Gates and what the plan does not verify

`build`, `typecheck`, `lint`, `format:check`, `test` from `package.json`, with real results reported,
including failures. CI is `.github/workflows/ci.yml` as it exists: two jobs — `verify`
(ubuntu-latest/windows-latest × Node 24/26, running those five commands) and `pack-smoke` (the same
matrix, packing the tarball and smoke-testing the CLI from it). CI must be checked against the exact
pushed commit SHA for every job of that matrix, and the CodeQL check that GitHub-side default setup
runs on pull requests must be inspected and reported — it is **not** part of `ci.yml`, and no workflow
file for it exists in this repository.

What the plan does **not** verify: any ceiling (that is §5.4's separate calibration); the physical heap
cost of the `n × L` content (unmeasured, a **hypothesis**); any claim that a document below every
ceiling is cheap; and any behaviour of the new comparison before it is implemented. If the refusal side
of §7.1 L5 is deferred, the plan also does **not** verify that the production comparison refuses
anything: L2 establishes the decision for injected ceilings, L3 the wiring for an injected test budget
and L4 only that the approved value is configured. That gap is the price of not running an unbounded
witness; it is recorded here rather than hidden, and the implementation PR's report must state it.

## 8. Implementation sequence

Each step is separate, and none begins without the previous authorisation.

1. **Design acceptance** — this document. It accepts the metric (E), the order (composed first), the
   leaf-count change (28 → 29) and the sequence. It does not accept a ceiling.
2. **Calibration** (§5.4, separately authorised) — bounded, synthetic, baseline CLI, out-of-tree E; it
   cannot prove the comparison.
3. **Metric-and-ceiling choice** — management confirms E and picks a value from the record, with its
   policy choice about rejecting the manager's shape and with its non-guarantees.
4. **One implementation PR** — the only code change this design authorises, and only after step 3:
   * add the E accumulation to `src/budget/measure.ts:479-493` with `checkedAdded`, an allocation-free
     loop and the `O(S + E + ΣL)` doc correction;
   * add `relationColumnCountUpperBound` to `ResourceCounters` and to `BudgetCounter`; edit the 28-leaf
     pin to 29 deliberately;
   * add the member to `TablesResourceBudget`, to `withResourceBudget()`'s member-by-member
     construction and to its pre-comparison check; compare it **after** the composed bound;
   * add the decided value to `DEFAULT_RESOURCE_BUDGETS.tables` and to the defaults pin;
   * add the tests of §7.1 and §7.2, and document the non-coverage of §3.6 (including the
     `columnsOf` maintenance dependency of §3.3);
   * leave B published and unchanged, leave the envelope profile without a new member, and add no
     fourth `details` key.
5. **Review** — an independent reviewer records PASS. Implementation completion is not acceptance
   (`AGENTS.md`).
6. **Authorised integration** — merging is its own authorisation, not implied by 1–5.

Constraints: no step may lower an existing ceiling, change the exit code, regenerate a golden, ship a
value without step 3's authorisation, or add the member without the E counter that feeds it. R2 (§4) is
a future unit and shares no commit with step 4.

## 9. Open decisions for management

| # | Question | Why it is not decided here |
|---|---|---|
| Q1 | Approve **E** (Σ(1 + literal commas)) as the `tables` metric, with B left published-only? | §3.1–§3.4 state the comparison; E is the only figure whose unit is a column count. |
| Q2 | Accept the one new measurement leaf, and the 28 → 29 pin change, as the price of E? | §3.5, §6.4. Reusing B would pay zero and inherit B's length-sensitive unit. |
| Q3 | Authorise the bounded calibration of §5.4, knowing it cannot prove the new comparison? | §5.4. It is a separate authorisation and a separate task. |
| Q4 | Which ceiling ships, and is rejecting the manager's shape a policy choice we take? | §5.1–§5.2. Only derivations are recorded — 2¹⁵ is the largest power of two rejecting that shape under E, with 16,384× anchor headroom — and none is approved. |
| Q5 | Confirm the comparison order **composed bound first, then E**, preserving today's refusal reason? | §3.4, §6.4. The reverse order would change which counter a document over both reports. |
| Q6 | Accept that some `tables` documents processed today become `failed` at `0.1.0`? | §6.3. It is a new kind of refusal for that profile. |
| Q7 | Keep `details` at three keys and `CONTRACT_VERSION` at `0.1.0`? | §6.1–§6.2. Reuse keeps the shape. |
| Q8 | Is R2 acceptable as a future independent unit with the restricted proxy and the named test gap? | §4. The declared-only collision case has no committed test and must be closed there. |
| Q9 | Does the `docs/test-strategy.md` CI job-table drift (six jobs listed, two in `ci.yml`) belong to this change? | Unrelated drift; §7.3 cites `ci.yml` and the inspected CodeQL check instead. |
| Q10 | Who reviews, and what counts as acceptance and integration? | §8. Acceptance, integration and publication are separate authorisations. |
| Q11 | Authorise a bounded fail-open-safe witness so §7.1 L5's refusal side can run, or accept the documented coverage limitation of deferring it? | §7.1 L5, §7.3. L1–L4 are unchanged either way, and neither option approves a ceiling. |

**Review map:** problem and evidence §1, §2; the metric decision §3; the envelope stay-out §3.7; R2 as a
future unit §4; calibration first §5.4, §8; no shipping threshold §5.1, Q4; the derived illustration
§5.3; the five verification layers and the skip proof §7.1–§7.2; invariants, contract and precedence
§1.5, §6; open decisions §9.
