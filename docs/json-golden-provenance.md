# Golden provenance inventory

One row per committed golden (`tests/fixtures/json-goldens/`), with the numbers a reader can
re-derive from the fixture's own bytes. This is the written form of the second witness that
`tests/json-source-counts.test.ts` asserts: the same counts, produced without importing anything
from `src/`.

## How the numbers were produced

An independent reader — `tests/helpers/source-counts.ts`, importing nothing from `src/` — decodes
each fixture in its own codec and applies only the documented rules:

- **physical lines** (`architecture.md` §4.1, U4, R17): a break is `\r\n`, `\n` or a bare `\r`, and
  a trailing terminator closes the line it follows instead of adding an empty one;
- **header** (§10.4): `^\s*\[(.+)\]\s*$`, greedy on the outer pair (`[[Entity]]` names `[Entity]`,
  `[Entity]x` is not a header), and the nine documented names are case-sensitive;
- **blank / comment / key** (§7.4, §5): `trim() === ''`, `startsWith('#')`, first `=` at index > 0;
- everything else is a **raw** line (a continuation, a malformed construct, a stray bracket line).

**What the test asserts** is exactly ten values per count-bearing fixture: `sections.total`,
`sections.parsed`, `sections.preservedRaw`, `sections.unknown`, `keys.total`, `keys.parsed`,
`keys.preservedRaw`, `lines.total`, `lines.accounted`, `lines.dropped`. Each is compared three ways
where a third witness exists — the source derivation, the golden and the catalog entry.
**The `blank` / `cmt` / `raw` columns below and the `bytes` column are printed for review** — they
come from the same reader and the same bytes, and they are what makes the physical-line total
auditable by hand, but they are not separately asserted.

**The key split is derived, not taken on trust.** Whether a key is *known* is a lookup of its text
in the table for its line's section kind: the eight tables live in the reader as data
(`tests/helpers/key-tables.ts`, 111 names transcribed from `src/schema/registry.ts:101-264`), and
three rules from the classifier's own documented behaviour decide the rest — a key before the first
header has no section and is preserved (`registry.ts:570-580`), every key of an unknown section is
preserved (`:615-630`), and a key with no registry entry in a known section is preserved
(`:635-639`). A decoded legacy `Index`/`IndexOption` is still parsed (`:640-660`), as is a key whose
value fails to decode.

Only three fixtures preserve a key line, and each does so for a reason the source shows:

| fixture | parsed | preserved | preserved lines |
|---|---|---|---|
| `hst-04` | 4 | 2 | l.12 `alert`, l.15 `PName` — inside `[<script>]` and `[[Entity]]` |
| `txt-04` | 3 | 3 | l.5 `MysteryKey`, l.6 `SecondMystery` (`[Entity]` does not register them) and l.10 `Note` (unknown section) |
| `txt-07` | 4 | 3 | l.12–14 `PName`/`Field`/`Position` — `[entity]` is a different header from `[Entity]` |

The other 39 preserve nothing. `fmt-02` and `sem-04` write legacy `Index=` keys and still preserve
nothing — the concrete proof that a decoded legacy key is parsed.

**What is *not* derived here:** no nested member of the JSON (object records, `scalars`,
`pageReferences`, `unsupported` contents, span geometry) is audited by this inventory; those have
their own tests, listed under *Exceptional spans* below. Two key rules have no fixture at all — a
key in the header region and a whitespace-padded key are both preserved — so they are pinned by
inline reader tests in `tests/json-source-counts.test.ts`, not by a row above.

## Columns

| column | meaning |
|---|---|
| `id` | catalog ID; the golden is `<id>.expected.json` |
| `source` | the committed file (`.a5er` under `tests/fixtures/synthetic/`, or the `.ts` byte module under `tests/fixtures/bytes/`) |
| `enc` | the codec used to decode it; `undecodable`/`binary` mean no decoder is ever asked |
| `bytes` | the fixture's size on disk / in its module |
| `status` | the golden's `status` |
| `§` | section headers (`sections.total`) |
| `keys` | `key=value` lines (`keys.total`) |
| `lines` | physical lines (`lines.total`) |
| `blank` / `cmt` / `raw` | the other three line kinds; `§ + keys + blank + cmt + raw = lines` |
| `codes` | the golden's diagnostic codes, in its order |
| `anchors` | `specRefs` from `tests/helpers/fixture-registry.ts` (spec coverage, not a JSON anchor) |

## The inventory

| id | source | enc | bytes | status | § | keys | lines | blank | cmt | raw | codes | anchors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `enc-02` | `enc-02-no-bom.a5er` | utf-8 | 197 | ok | 2 | 4 | 10 | 2 | 2 | 0 | D_BOM_MISSING | §14 row 2, P2 |
| `enc-03` | `enc-03-sjis.ts` | shift_jis | 106 | degraded | 1 | 3 | 7 | 1 | 2 | 0 | D_ENCODING_MISMATCH,V_MISSING_REQUIRED_KEY,V_DANGLING_PAGE | §14 row 3, P2 |
| `enc-04` | `enc-04-undecodable.ts` | undecodable | 39 | failed | — | — | — | — | — | — | E_UNDECODABLE | §14 row 4, §8.2 of docs/architecture.md |
| `enc-05` | `enc-05-utf16le.ts` | utf-16le | 130 | degraded | 1 | 2 | 5 | 1 | 1 | 0 | D_ENCODING_ASSUMED,V_MISSING_REQUIRED_KEY,V_DANGLING_PAGE | P2, §6 |
| `fmt-01` | `fmt-01-baseline.a5er` | utf-8 | 935 | ok | 5 | 25 | 37 | 5 | 2 | 0 | V_VIEW_COLUMNS_UNKNOWN | §14 row 1, P1, P6, P8 |
| `fmt-02` | `fmt-02-format19-legacy-index.a5er` | utf-8 | 244 | degraded | 2 | 5 | 11 | 2 | 2 | 0 | S_LEGACY_KEY,V_INDEX_LEGACY_ONLY | F2, D5, L6, P8 |
| `fmt-03` | `fmt-03-no-header.a5er` | utf-8 | 253 | degraded | 2 | 8 | 13 | 2 | 1 | 0 | S_HEADER_UNKNOWN_FORMAT | P1, U1, D2 |
| `fmt-04` | `fmt-04-format20.a5er` | utf-8 | 119 | degraded | 2 | 3 | 8 | 2 | 1 | 0 | S_HEADER_UNKNOWN_FORMAT | P1, K2, §6 |
| `fmt-05` | `fmt-05-format99.a5er` | utf-8 | 279 | degraded | 2 | 8 | 14 | 2 | 2 | 0 | S_HEADER_UNKNOWN_FORMAT | P1, U1 |
| `hst-01` | `hst-01-nul-inside-text.a5er` | utf-8 | 209 | ok | 2 | 5 | 10 | 2 | 1 | 0 | — | §14 row 15, §10.3 |
| `hst-02` | `hst-02-binary.ts` | binary | 4096 | failed | — | — | — | — | — | — | E_BINARY_INPUT | §14 row 15, §10.3, E_BINARY_INPUT |
| `hst-04` | `hst-04-hostile-names.a5er` | utf-8 | 4340 | degraded | 5 | 6 | 19 | 6 | 1 | 1 | S_UNKNOWN_SECTION,S_UNKNOWN_SECTION,S_MALFORMED_LINE,S_UNKNOWN_SECTION | §14 row 15, P3, F6 |
| `hst-05` | `hst-05-mixed-eol.ts` | utf-8 | 185 | ok | 2 | 4 | 7 | 0 | 1 | 0 | — | §14 row 15, U4, P2 |
| `sem-01` | `sem-01-dangling-refs.a5er` | utf-8 | 462 | degraded | 3 | 14 | 21 | 3 | 1 | 0 | V_DANGLING_ENTITY,V_DANGLING_COLUMN,V_DANGLING_PAGE | §14 row 13, P9, F5 |
| `sem-02` | `sem-02-page-case.a5er` | utf-8 | 184 | ok | 2 | 4 | 9 | 2 | 1 | 0 | — | P9, F5, U9 |
| `sem-03` | `sem-03-fields-count-mismatch.a5er` | utf-8 | 674 | degraded | 4 | 19 | 28 | 4 | 1 | 0 | V_FIELD_COUNT_MISMATCH | P9, U8 |
| `sem-04` | `sem-04-legacy-index-under-21.a5er` | utf-8 | 385 | degraded | 2 | 7 | 12 | 2 | 1 | 0 | S_LEGACY_KEY,V_INDEX_LEGACY_ONLY | F2, D5, L6, P8 |
| `sem-05` | `sem-05-subtype.a5er` | utf-8 | 294 | ok | 3 | 9 | 16 | 3 | 1 | 0 | V_UNSUPPORTED_SUBTYPE_MEMBERSHIP | P13, F7, D6, K11 |
| `sem-06` | `sem-06-view-columns.a5er` | utf-8 | 274 | ok | 3 | 8 | 15 | 3 | 1 | 0 | V_VIEW_COLUMNS_UNKNOWN,V_VIEW_COLUMNS_UNKNOWN | P10, F6 |
| `sem-07` | `sem-07-domains-commonfields.a5er` | utf-8 | 511 | ok | 3 | 11 | 18 | 3 | 1 | 0 | — | P12, F9 |
| `sem-08` | `sem-08-duplicate-pname.a5er` | utf-8 | 254 | degraded | 3 | 7 | 14 | 3 | 1 | 0 | V_DUPLICATE_OBJECT_NAME,V_VIEW_COLUMNS_UNKNOWN | P6, U6 |
| `sem-09` | `sem-09-zero-pages.a5er` | utf-8 | 55 | degraded | 1 | 1 | 4 | 1 | 1 | 0 | V_MISSING_REQUIRED_KEY | P11 |
| `sem-10` | `sem-10-missing-position.a5er` | utf-8 | 164 | degraded | 2 | 3 | 8 | 2 | 1 | 0 | V_MISSING_REQUIRED_KEY | P11 |
| `sem-11` | `sem-11-zero-fields.a5er` | utf-8 | 124 | ok | 2 | 3 | 8 | 2 | 1 | 0 | — | P6 |
| `txt-01` | `txt-01-multi-table-view.a5er` | utf-8 | 1171 | ok | 7 | 33 | 49 | 7 | 2 | 0 | V_VIEW_COLUMNS_UNKNOWN,V_VIEW_COLUMNS_UNKNOWN | §14 row 6, P6, P9, P11 |
| `txt-02` | `txt-02-relationship-alias.a5er` | utf-8 | 746 | ok | 5 | 26 | 37 | 5 | 1 | 0 | — | P3, P9, F4 |
| `txt-03` | `txt-03-relation-composite.a5er` | utf-8 | 613 | ok | 4 | 18 | 27 | 4 | 1 | 0 | — | §14 row 8, P9 |
| `txt-04` | `txt-04-unknown-section-key.a5er` | utf-8 | 190 | ok | 3 | 6 | 13 | 3 | 1 | 0 | S_UNKNOWN_KEY,S_UNKNOWN_KEY,S_UNKNOWN_SECTION | §14 row 9, P13, F6 |
| `txt-05` | `txt-05-duplicate-scalar.a5er` | utf-8 | 242 | degraded | 2 | 6 | 11 | 2 | 1 | 0 | S_DUPLICATE_KEY | §14 row 10, U6, P4 |
| `txt-06` | `txt-06-duplicate-manager.a5er` | utf-8 | 296 | degraded | 3 | 7 | 14 | 3 | 1 | 0 | S_DUPLICATE_KEY | P3, U5 |
| `txt-07` | `txt-07-lowercase-section.a5er` | utf-8 | 311 | ok | 3 | 7 | 14 | 3 | 1 | 0 | S_UNKNOWN_SECTION | P3, F6 |
| `txt-08` | `txt-08-header-whitespace.a5er` | utf-8 | 191 | ok | 2 | 4 | 9 | 2 | 1 | 0 | — | P3 |
| `txt-09` | `txt-09-empty-section.a5er` | utf-8 | 206 | degraded | 3 | 4 | 11 | 3 | 1 | 0 | V_MISSING_REQUIRED_KEY | P3, P9 |
| `val-01` | `val-01-escapes.a5er` | utf-8 | 255 | ok | 2 | 5 | 10 | 2 | 1 | 0 | — | §14 row 5, P5, F3 |
| `val-02` | `val-02-index-multi-column.a5er` | utf-8 | 357 | ok | 2 | 7 | 12 | 2 | 1 | 0 | — | §14 row 8, P8, F3 |
| `val-03` | `val-03-field-9-element.a5er` | utf-8 | 196 | ok | 2 | 4 | 9 | 2 | 1 | 0 | — | P7, K3, F4 |
| `val-04` | `val-04-field-11-element.a5er` | utf-8 | 217 | degraded | 2 | 4 | 9 | 2 | 1 | 0 | S_FIELD_TOO_MANY_ELEMENTS | P7, F4 |
| `val-05` | `val-05-field-missing-color.a5er` | utf-8 | 198 | degraded | 2 | 4 | 9 | 2 | 1 | 0 | S_FIELD_TOO_FEW_ELEMENTS,V_MISSING_REQUIRED_KEY | P7, F4 |
| `val-06` | `val-06-composite-pk.a5er` | utf-8 | 337 | ok | 2 | 6 | 11 | 2 | 1 | 0 | — | §14 row 7, P8 |
| `val-07` | `val-07-color-tokens.a5er` | utf-8 | 373 | ok | 2 | 8 | 13 | 2 | 1 | 0 | — | P5, F8, K10 |
| `val-08` | `val-08-continuation-line.a5er` | utf-8 | 166 | degraded | 2 | 4 | 10 | 2 | 1 | 1 | V_VIEW_COLUMNS_UNKNOWN,S_MALFORMED_LINE | P13, U12 |
| `val-09` | `val-09-keyorder-gap.a5er` | utf-8 | 265 | degraded | 2 | 5 | 10 | 2 | 1 | 0 | V_PK_ORDER_CONFLICT | P8 |
| `val-10` | `val-10-value-with-equals.a5er` | utf-8 | 244 | ok | 2 | 5 | 10 | 2 | 1 | 0 | — | P4 |
| `val-11` | `val-11-unterminated-quote.a5er` | utf-8 | 221 | degraded | 2 | 4 | 9 | 2 | 1 | 0 | S_COMPLEX_UNTERMINATED_QUOTE | P5, F3 |

**Fatal rows carry no counts.** `enc-04` (`E_UNDECODABLE`) and `hst-02` (`E_BINARY_INPUT`) have
`completeness: null` and `schema: null`: nothing was decoded, so there is nothing to count. The
`0/0` their catalog entries carry is the registry's convention for "no counts", **not** a
measurement, and both are excluded from every count assertion rather than given fabricated zeros.

**`enc-03` and `enc-05` are decode-stage catalog entries.** The codes above are the *envelope's* —
the catalog rows for these two declare only their decode-stage codes (`D_ENCODING_MISMATCH`,
`D_ENCODING_ASSUMED`). Their decoded document is `[Entity]` + `PName` + `Position` with no
`[Manager]`, so the semantic stage legitimately adds `V_MISSING_REQUIRED_KEY` (error: no
`PageInfo`) and `V_DANGLING_PAGE` (warning: `Main` is never declared), and both envelopes are
`degraded`. The counts are unaffected by that delta — key and line counting is a source fact, which
is why `enc-05`'s stale `keys.total: 3` could be corrected to `2` without touching the code split.

## Ambiguous source lines (pinned by hand)

Two lines in the whole fixture set could be read two ways, and both readings are pinned in
`tests/json-source-counts.test.ts` so the reader cannot drift into the parser's reading:

| line | text | reading |
|---|---|---|
| `hst-04:17` | `[Entity]x` | bracket-led but a character follows the closing bracket, so **not** a header; no `=` either, so a **raw** line → `S_MALFORMED_LINE` + `unsupported` `multiline-value` |
| `txt-08:6` | `  [Entity] ` | a **header** after trimming, with the raw line keeping its whitespace (`name` is `Entity`) |

Two more shapes are pinned there because they are the natural traps:

- `hst-04:19` is a **4098-character** header line, so its name (between the greedy outer brackets)
  is 4096 characters — the hostile-name case that would break a naive `split`-based header reader.
- `hst-05` is the only fixture with **zero** blank lines: it mixes CRLF, LF and bare CR with no
  empty line, which is exactly why the physical-line rule cannot be a `split` on `\n`.

No fixture contains a header-shaped line with an `=` inside (`[a=b]`) and none has `=` at index 0,
so the "header before key" precedence and "an empty key name is not a key" are implemented from
§10.4/§7.4 but not exercised by a fixture. The unit tests pin both directly.

## Exceptional spans and references (verified elsewhere, not here)

- **R31 — `sem-05`**: the `subtype-membership` evidence anchors the `[Subtype]` header (line 11),
  while `V_UNSUPPORTED_SUBTYPE_MEMBERSHIP` points at the `PName` line (12). `tests/json-goldens.test.ts`
  asserts both spans and that they are not the same line.
- **Section extent vs header evidence — `hst-04`**: the diagnostics span the section extent
  (11–13, 14–18, 19–19) while each `unknown-section` evidence record spans only its header line
  (11, 14, 19). `txt-04` (9–11 vs 9) and `txt-07` (11–14 vs 11) show the same pattern.
- **Multi-line value — `val-08`**: `V_VIEW_COLUMNS_UNKNOWN` at line 7, `S_MALFORMED_LINE` at line 9,
  and an `unsupported` `multiline-value` record (key `null`) at line 9.
- **Header-region diagnostic — `fmt-03` / `fmt-04` / `fmt-05`**: `S_HEADER_UNKNOWN_FORMAT` at
  `sectionIndex` 0, line 1 — the position where a declaration would have been read.
- **No span at all — `enc-03`**: `D_ENCODING_MISMATCH` is a header-level fact with `span: null`, so
  it sorts before line 1 in the ordered list.
- **Same-line ties**: `val-05` line 5 (`S_FIELD_TOO_FEW_ELEMENTS` before `V_MISSING_REQUIRED_KEY` —
  stage rank schema < semantic), `sem-08` line 12 (`V_DUPLICATE_OBJECT_NAME` before
  `V_VIEW_COLUMNS_UNKNOWN` — same stage, code order), `fmt-02`/`sem-04` line 7/11
  (`S_LEGACY_KEY` before `V_INDEX_LEGACY_ONLY`).

## What each fixture exercises

| construct | fixtures | evidence |
|---|---|---|
| unknown section headers | `hst-04` (3: `[<script>]` l.11, `[[Entity]]` l.14, the 4098-char name l.19), `txt-04` (`[Note]` l.9), `txt-07` (`[entity]` l.11) | `unsupported` kinds; `S_UNKNOWN_SECTION` |
| unknown keys inside a **known** section | `txt-04` (`MysteryKey` l.5, `SecondMystery` l.6, `sectionKind: Entity`) | `unsupported[0..1]` |
| duplicate scalar key | `txt-05` (`ProjectName` twice), `txt-06` (two `[Manager]` sections + duplicate `PageInfo`) | `S_DUPLICATE_KEY` |
| duplicate object identity | `sem-08` (an entity and a view share `PName`) | `V_DUPLICATE_OBJECT_NAME` |
| legacy index keys | `fmt-02` (`FORMAT:19`, `Index=` l.7), `sem-04` (`FORMAT:21`, legacy `Index=`) | `S_LEGACY_KEY` + `V_INDEX_LEGACY_ONLY` |
| escape table | `val-01` (`\Q \\ \q \t \n`), `val-10` (`=` inside a value), `val-11` (unterminated quote) | `sourceFacts` in the catalog |
| encodings | `enc-02` (no BOM), `enc-03` (Shift_JIS, 106 B), `enc-04` (undecodable, 39 B), `enc-05` (UTF-16LE + `FF FE`, 130 B), `hst-01` (NUL below the binary threshold), `hst-02` (25 % NUL, 4096 B), `hst-05` (BOM + mixed CRLF/LF/CR) | `source.encoding`, `source.format` |
| FORMAT gate | `fmt-02` (19), `fmt-03` (absent), `fmt-04` (20, the hole), `fmt-05` (99) | `S_HEADER_UNKNOWN_FORMAT` where the declaration is unknown |
| page / domain references | `sem-01` (dangling page), `sem-02` (case-insensitive page), `sem-07` (domain + `@INT`) | `V_DANGLING_PAGE`, `schema.pageReferences`, `schema.domainReferences` |
| counting identities | all 42 count-bearing goldens | `tests/json-source-counts.test.ts` (this document's numbers), `tests/json-goldens.test.ts` (§13 identities) |

## History — what the repository actually evidences

Four commits have touched this directory, and their subjects are the only *why* any golden has:

| commit | subject | goldens touched |
|---|---|---|
| `d2dfd88` | `feat(json): checkpoint Stage 6 work and Stage 6-A provenance` | 44 (all of them) |
| `a7a7b9c` | `feat(json): retain every declared Entity/View/Subtype scalar occurrence` | 41 |
| `ba771fa` | `feat(json): retain every declared single-fact scalar occurrence` | 11 |
| `2d262c4` | `feat(json): expose page and domain reference resolution` | 42 |

Per golden, `git log --oneline -- tests/fixtures/json-goldens/<id>.expected.json` shows three of
those commits for 30 fixtures and four for 11, two for `sem-09`, and only the initial checkpoint for
`enc-04` and `hst-02` — the two `failed` goldens, which never gained the later members because they
have no `schema`.

**What is *not* evidenced, and is therefore not asserted anywhere below.** The repository records
*which* commits edited a golden and *why at the level of a commit subject*; it does not record, per
value, which fixture line the number came from. That derivation happened in one-off authoring
projections and is recorded in the stage-6 test comments and unit logs, not in git — so any finer
per-golden history is **uncertain from the repository alone**. The substitute is the set of guards
that re-derive the same facts from the bytes on every run (`tests/json-source-counts.test.ts`,
`tests/json-provenance.test.ts`), which is what makes the claim checkable without trusting the
authoring story.

## Related anchors

- `architecture.md` §4.1 (physical lines), §7.4 (blank/comment/raw), §10.4 (header shape and the
  nine names), §11 (taxonomy and order), §12 (envelope), §13 (counting identities), §14 (matrix).
- `docs/test-strategy.md` §3.6 (goldens authored, never blessed), §5 (the 16 behaviour rows),
  §8 (status is severity-derived), §10 (gates).
- `tests/helpers/fixture-registry.ts` — the catalog these rows are keyed by; the key split's
  catalogue witness.
- `tests/helpers/key-tables.ts` — the eight key tables as data (111 names), and
  `tests/json-source-counts.test.ts` — the split, the header-region/padded-key rules, and the
  legacy-is-parsed proof.
- `tests/json-provenance.test.ts` — raw/span provenance, line ownership and the position-slot
  element binding; `tests/json-contract.test.ts` — the inline documents for the arms no golden
  reaches (collision, empty relation slot, ambiguous endpoint).
