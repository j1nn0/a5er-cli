/**
 * Fixture registry — the typed contract between the fixture files and the tests
 * that consume them.
 *
 * Shape follows `docs/test-strategy.md` §3.4 (stable IDs) and §3.6 (semantic
 * expectations before golden JSON exists). This unit (U-1) only defines the
 * mechanism; U-2 populates the 14 catalog entries from test-strategy §4.
 *
 * Deliberate design choices:
 * - `dropped` is **not** part of `ExpectedCounts`. Completeness is asserted as a
 *   reconciliation over concrete counts (architecture §13), never as a constant.
 * - `exitCode` is the code for `inspect`; `validate` may return 3 where an
 *   `error`-severity diagnostic exists (architecture TBD-O7).
 * - `codes` is the exact multiset of diagnostic codes, sorted; duplicates are
 *   normal (two unknown keys are two `S_UNKNOWN_KEY`), while a missing or an extra
 *   occurrence fails the comparison (`codesMatch`, test-strategy T2).
 * - `sourceFacts` are assertions about the committed bytes and raw text (stage 1)
 *   and are resolved today by `fixtures-content.test.ts`. `parseFacts` are
 *   assertions about the future envelope (stages 2–5); they share the shape but
 *   not the path vocabulary, so a parser test cannot borrow a source-only path.
 */

/**
 * Where a fixture lives and how it is materialised.
 *
 * `synthetic` and `bytes` are committed files; `generated` is produced by a builder in
 * `helpers/generated.ts` and never committed; `injected` needs an IO seam that does not
 * exist yet (res-02); `catalog-wide` is a cross-fixture harness with no bytes of its own
 * (imm-01). The last three use a virtual `file` name, because test-strategy §4 gives
 * them a builder, a harness or nothing rather than a path.
 */
export type FixtureClass = 'synthetic' | 'bytes' | 'generated' | 'injected' | 'catalog-wide';

/** Envelope `status` values from architecture §12. */
export type ExpectedStatus = 'ok' | 'degraded' | 'failed';

/** Concrete per-fixture totals; the test reconciles them against the envelope. */
export interface ExpectedCounts {
  readonly sections: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
  };
  readonly keys: {
    readonly total: number;
    readonly parsed: number;
    readonly preservedRaw: number;
  };
}

/** A span the fixture must exhibit, e.g. the line of a specific key. */
export interface ExpectedSpan {
  readonly sectionIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly keyLine: number;
}

/**
 * One assertion addressed by a dotted path. The same shape serves two disjoint
 * path vocabularies: source paths address the bytes and raw text, envelope paths
 * address the parsed document.
 */
export interface SemanticFact {
  /** Source: `line.13.key`, `header.format`. Envelope: `objects[0].pname.value`. */
  readonly path: string;
  readonly equals: string | number | boolean | null;
}

/** Everything a fixture test asserts, except the bytes themselves. */
export interface FixtureExpectation {
  readonly status: ExpectedStatus;
  /** Exit code of `inspect`; see TBD-O7 for `validate`. */
  readonly exitCode: number;
  /** Exact multiset of diagnostic codes, sorted ascending. */
  readonly codes: readonly string[];
  readonly counts: ExpectedCounts;
  readonly spans: readonly ExpectedSpan[];
  /** Assertions against the committed bytes and raw text, resolved at stage 1. */
  readonly sourceFacts: readonly SemanticFact[];
  /** Assertions against the envelope; empty until stages 2–5 exist. */
  readonly parseFacts: readonly SemanticFact[];
}

/** One catalog entry (test-strategy §4). */
export interface FixtureSpec {
  /** Stable catalog ID, e.g. `fmt-01`. */
  readonly id: string;
  /** File name inside its class directory, e.g. `fmt-01-baseline.a5er.txt`. */
  readonly file: string;
  readonly fixtureClass: FixtureClass;
  /** One sentence: which construct this fixture exists to exercise. */
  readonly purpose: string;
  /** Where the expectation comes from, e.g. `P1`, `§14 row 3`, `K2`. */
  readonly specRefs: readonly string[];
  /** Architecture §18 stage that owns the fixture. */
  readonly stage: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly expectation: FixtureExpectation;
}

/**
 * The catalog. Empty in U-1: U-2 adds the 14 entries from test-strategy §4.
 * `validateRegistry` and the tracking test already enforce the rules, so the
 * first entry inherits them.
 */
export const FIXTURES: readonly FixtureSpec[] = [
  // ── format / header ────────────────────────────────────────────────────
  {
    id: 'fmt-01',
    file: 'fmt-01-baseline.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Baseline document: BOM, UTF-8, CRLF, two entities, one view, one relation, IndexInfo.',
    specRefs: ['§14 row 1', 'P1', 'P6', 'P8'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 5, parsed: 5, preservedRaw: 0 },
        keys: { total: 25, parsed: 25, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 2, startLine: 13, endLine: 13, keyLine: 13 },
        { sectionIndex: 4, startLine: 24, endLine: 24, keyLine: 24 },
      ],
      sourceFacts: [
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: true },
        { path: 'encoding.crlf', equals: true },
        { path: 'entity.count', equals: 2 },
        { path: 'view.count', equals: 1 },
        { path: 'relation.count', equals: 1 },
        { path: 'field.1.1.elements', equals: 10 },
        // Single-column PK: only element 5 of the first Field is an ordinal; the
        // second Field's キー順 is empty (not part of the key), so the join shows `0,`.
        { path: 'field.1.keyOrders', equals: '0,' },
        { path: 'index.1.1.columns', equals: 'id,email' },
        { path: 'line.13.key', equals: 'IndexInfo' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'fmt-02',
    file: 'fmt-02-format19-legacy-index.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'FORMAT:19 file whose only index data is the legacy Index key.',
    specRefs: ['F2', 'D5', 'L6', 'P8'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_LEGACY_KEY', 'V_INDEX_LEGACY_ONLY'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 7, endLine: 7, keyLine: 7 }],
      sourceFacts: [
        { path: 'header.format', equals: 19 },
        { path: 'encoding.bom', equals: true },
        { path: 'line.7.key', equals: 'Index' },
        { path: 'text.contains', equals: 'Index=legacy_orders_ix1=0,id' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'fmt-03',
    file: 'fmt-03-no-header.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'No FORMAT line at all: the version is unknown, so canonical and legacy decoders stay active.',
    specRefs: ['P1', 'U1', 'D2'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_HEADER_UNKNOWN_FORMAT'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 8, parsed: 8, preservedRaw: 0 },
      },
      spans: [
        // Canonical decoder active with no FORMAT evidence.
        { sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 },
        // Legacy geometry keys decoded under the same profile (F1).
        { sectionIndex: 2, startLine: 10, endLine: 10, keyLine: 10 },
      ],
      sourceFacts: [
        { path: 'header.absent', equals: true },
        { path: 'encoding.bom', equals: true },
        { path: 'encoding.declared', equals: 'UTF8' },
        { path: 'line.9.key', equals: 'IndexInfo' },
        { path: 'line.10.key', equals: 'Page' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'fmt-04',
    file: 'fmt-04-format20.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'FORMAT:20, the hole in the documented version map (K2).',
    specRefs: ['P1', 'K2', '§6'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_HEADER_UNKNOWN_FORMAT'],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 2, parsed: 2, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 4, endLine: 4, keyLine: 4 }],
      sourceFacts: [
        { path: 'header.format', equals: 20 },
        { path: 'line.4.key', equals: 'PName' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'fmt-05',
    file: 'fmt-05-format99.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'FORMAT:99, above every documented version: the absent-FORMAT policy applies.',
    specRefs: ['P1', 'U1'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_HEADER_UNKNOWN_FORMAT'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 8, parsed: 8, preservedRaw: 0 },
      },
      spans: [
        // Canonical keys are still decoded under an unknown FORMAT.
        { sectionIndex: 2, startLine: 10, endLine: 10, keyLine: 10 },
      ],
      sourceFacts: [
        { path: 'header.format', equals: 99 },
        { path: 'encoding.bom', equals: true },
        { path: 'line.10.key', equals: 'IndexInfo' },
        // Legacy geometry keys are decoded under the same profile (F1).
        { path: 'line.11.key', equals: 'Page' },
      ],
      parseFacts: [],
    },
  },
  // ── encoding ───────────────────────────────────────────────────────────
  {
    id: 'enc-02',
    file: 'enc-02-no-bom.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'UTF-8 without a BOM: the spec-preferred form is absent, nothing else is wrong.',
    specRefs: ['§14 row 2', 'P2'],
    stage: 2,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['D_BOM_MISSING'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: false },
        { path: 'line.5.key', equals: 'PName' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'enc-03',
    file: 'enc-03-sjis.ts',
    fixtureClass: 'bytes',
    purpose: 'Shift_JIS bytes under an ENCODING:UTF8 header; bytes win over the declared encoding.',
    specRefs: ['§14 row 3', 'P2'],
    stage: 2,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['D_ENCODING_MISMATCH'],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 6, endLine: 6, keyLine: 6 }],
      sourceFacts: [
        { path: 'bytes.length', equals: 106 },
        { path: 'encoding.bom', equals: false },
        { path: 'header.format', equals: 21 },
        { path: 'encoding.declared', equals: 'UTF8' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'enc-04',
    file: 'enc-04-undecodable.ts',
    fixtureClass: 'bytes',
    purpose: 'Bytes no strict decoder accepts: fatal, never mojibake, never partial schema.',
    specRefs: ['§14 row 4', '§8.2 of docs/architecture.md'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      codes: ['E_UNDECODABLE'],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [
        { path: 'bytes.length', equals: 39 },
        { path: 'strict.allReject', equals: true },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'enc-05',
    file: 'enc-05-utf16le.ts',
    fixtureClass: 'bytes',
    purpose: 'UTF-16LE with a BOM and no ENCODING hint: encoding is assumed, then decoded.',
    specRefs: ['P2', '§6'],
    stage: 2,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['D_ENCODING_ASSUMED'],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'bytes.prefix', equals: 'fffe' },
        { path: 'header.format', equals: 21 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-01',
    file: 'txt-01-multi-table-view.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Three entities (one with zero Field), two views, two pages and one relation across two pages.',
    specRefs: ['§14 row 6', 'P6', 'P9', 'P11'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      // The plain views' effective columns are unknown; §9.6 reports that as info, not as
      // a code this row expects. §5 row 6 pins `none`, so nothing else may appear here.
      codes: [],
      counts: {
        sections: { total: 7, parsed: 7, preservedRaw: 0 },
        keys: { total: 33, parsed: 33, preservedRaw: 0 },
      },
      spans: [
        // The zero-Field entity is legal: it still has its position.
        { sectionIndex: 4, startLine: 28, endLine: 28, keyLine: 28 },
        { sectionIndex: 5, startLine: 32, endLine: 32, keyLine: 32 },
        { sectionIndex: 7, startLine: 41, endLine: 41, keyLine: 41 },
      ],
      sourceFacts: [
        { path: 'entity.count', equals: 3 },
        { path: 'view.count', equals: 2 },
        { path: 'page.count', equals: 2 },
        { path: 'relation.count', equals: 1 },
        // P6: PName is unique per diagram, across entities and views.
        { path: 'pname.unique', equals: true },
        // Zero fields on the third entity is legal, not missing data.
        { path: 'field.3.count', equals: 0 },
        { path: 'text.contains', equals: 'PName="audit_log"' },
        {
          path: 'text.contains',
          equals: 'Query="SELECT user_id, COUNT(*) FROM orders GROUP BY user_id"',
        },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-02',
    file: 'txt-02-relationship-alias.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      '[Relationship] is one section for [Relation], so two sections mean two relations, not four.',
    specRefs: ['P3', 'P9', 'F4'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 5, parsed: 5, preservedRaw: 0 },
        keys: { total: 26, parsed: 26, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 4, startLine: 18, endLine: 18, keyLine: 18 },
        // The alias spelling survives in header.raw.
        { sectionIndex: 5, startLine: 28, endLine: 28, keyLine: 28 },
      ],
      sourceFacts: [
        { path: 'relation.count', equals: 2 },
        { path: 'section.5.header', equals: '[Relationship]' },
        { path: 'line.18.key', equals: 'Entity1' },
        { path: 'text.contains', equals: 'Fields2="parent_id"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-03',
    file: 'txt-03-relation-composite.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Composite foreign key: Fields1 and Fields2 each carry two columns in one value.',
    specRefs: ['§14 row 8', 'P9'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 4, parsed: 4, preservedRaw: 0 },
        keys: { total: 18, parsed: 18, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 4, startLine: 21, endLine: 21, keyLine: 21 }],
      sourceFacts: [
        { path: 'entity.count', equals: 2 },
        { path: 'relation.count', equals: 1 },
        { path: 'text.contains', equals: 'Fields1="a,b"' },
        { path: 'text.contains', equals: 'Fields2="x,y"' },
        { path: 'line.21.key', equals: 'Fields1' },
      ],
      parseFacts: [],
    },
  },
  // ── structure ──────────────────────────────────────────────────────────
  {
    id: 'txt-04',
    file: 'txt-04-unknown-section-key.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Unknown section and two unknown keys are preserved as raw evidence.',
    specRefs: ['§14 row 9', 'P13', 'F6'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      // Two unknown keys are two occurrences of the same code: `codes` is a multiset.
      codes: ['S_UNKNOWN_KEY', 'S_UNKNOWN_KEY', 'S_UNKNOWN_SECTION'],
      counts: {
        sections: { total: 2, parsed: 1, preservedRaw: 1 },
        keys: { total: 5, parsed: 2, preservedRaw: 3 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'header.format', equals: 21 },
        { path: 'text.contains', equals: 'MysteryKey="value"' },
        { path: 'text.contains', equals: 'SecondMystery="value2"' },
        { path: 'text.contains', equals: '[Memo]' },
        { path: 'line.5.key', equals: 'MysteryKey' },
        { path: 'line.6.key', equals: 'SecondMystery' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-05',
    file: 'txt-05-duplicate-scalar.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'ProjectName appears twice with different values: last occurrence wins, both spans are kept.',
    specRefs: ['§14 row 10', 'U6', 'P4'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_DUPLICATE_KEY'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 6, parsed: 6, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 1, startLine: 4, endLine: 4, keyLine: 4 },
        { sectionIndex: 1, startLine: 6, endLine: 6, keyLine: 6 },
      ],
      sourceFacts: [
        { path: 'text.contains', equals: 'ProjectName="first_project"' },
        { path: 'text.contains', equals: 'ProjectName="second_project"' },
        { path: 'line.4.key', equals: 'ProjectName' },
        { path: 'line.6.key', equals: 'ProjectName' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-06',
    file: 'txt-06-duplicate-manager.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Two [Manager] sections: both stay in the AST, both spans are reported, scalars resolve last-wins.',
    specRefs: ['P3', 'U5'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_DUPLICATE_KEY'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 7, parsed: 7, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 1, startLine: 3, endLine: 3, keyLine: 3 },
        { sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 },
      ],
      sourceFacts: [
        { path: 'section.1.header', equals: '[Manager]' },
        { path: 'section.3.header', equals: '[Manager]' },
        { path: 'text.contains', equals: 'ProjectName="first_manager"' },
        { path: 'text.contains', equals: 'ProjectName="second_manager"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-07',
    file: 'txt-07-lowercase-section.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      '[entity] in lower case is an unknown section, preserved raw and never parsed as [Entity].',
    specRefs: ['P3', 'F6'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['S_UNKNOWN_SECTION'],
      counts: {
        sections: { total: 3, parsed: 2, preservedRaw: 1 },
        keys: { total: 7, parsed: 4, preservedRaw: 3 },
      },
      spans: [{ sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 }],
      sourceFacts: [
        { path: 'section.3.header', equals: '[entity]' },
        // One [Entity] section: the lower-case header was not folded into it.
        { path: 'entity.count', equals: 1 },
        { path: 'text.contains', equals: 'PName="lowercase_stays_unknown"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-08',
    file: 'txt-08-header-whitespace.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Whitespace around a section header is trimmed for recognition and kept in header.raw.',
    specRefs: ['P3'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 6, endLine: 6, keyLine: 6 }],
      sourceFacts: [
        { path: 'section.2.header', equals: '  [Entity] ' },
        { path: 'entity.count', equals: 1 },
        { path: 'line.7.key', equals: 'PName' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'txt-09',
    file: 'txt-09-empty-section.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'A known section with zero entries stays in the AST and is missing required keys, not dropped.',
    specRefs: ['P3', 'P9'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_MISSING_REQUIRED_KEY'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 }],
      sourceFacts: [
        { path: 'section.3.header', equals: '[Relation]' },
        { path: 'text.contains', equals: '[Relation]' },
      ],
      parseFacts: [],
    },
  },
  // ── values ─────────────────────────────────────────────────────────────
  {
    id: 'val-01',
    file: 'val-01-escapes.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Escape table in real strings: \\Q, \\\\, \\q, \\t, \\n appear verbatim.',
    specRefs: ['§14 row 5', 'P5', 'F3'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'escape.sequences', equals: '\\Q,\\\\,\\q,\\t,\\n' },
        { path: 'line.5.key', equals: 'Comment' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-02',
    file: 'val-02-index-multi-column.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'IndexInfo whose column list is one quoted element containing a comma; single-column PK.',
    specRefs: ['§14 row 8', 'P8', 'F3'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 6, parsed: 6, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 7, endLine: 7, keyLine: 7 }],
      sourceFacts: [
        // Single-column PK: the second Field's キー順 is empty, so the ordinals
        // present are just [0] and no duplicate ordinal can arise.
        { path: 'field.1.keyOrders', equals: '0,' },
        { path: 'index.1.1.columns', equals: 'user_name,birthday' },
        { path: 'index.1.2.columns', equals: 'user_name' },
        { path: 'line.7.key', equals: 'IndexInfo' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-03',
    file: 'val-03-field-9-element.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Field row with the 9-element shape of the spec sample (tail defaulted, no diagnostic).',
    specRefs: ['P7', 'K3', 'F4'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'field.1.1.elements', equals: 9 },
        { path: 'line.5.key', equals: 'Field' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-04',
    file: 'val-04-field-11-element.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Field row with 11 elements: the tail beyond 追加オプション is kept raw, the row is kept.',
    specRefs: ['P7', 'F4'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_FIELD_TOO_MANY_ELEMENTS'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'field.1.1.elements', equals: 11 },
        { path: 'line.8.key', equals: 'Field' },
        { path: 'text.contains', equals: '"オプション","追加事項"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-05',
    file: 'val-05-field-missing-color.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Field row missing 色 (element 8, 必須): reported, never defaulted.',
    specRefs: ['P7', 'F4'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_FIELD_TOO_FEW_ELEMENTS', 'V_MISSING_REQUIRED_KEY'],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'field.1.1.elements', equals: 7 },
        { path: 'line.5.key', equals: 'Field' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-06',
    file: 'val-06-composite-pk.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Composite primary key as キー順 0,1,2 — a primary key is positional, not an object.',
    specRefs: ['§14 row 7', 'P8'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 6, endLine: 6, keyLine: 6 }],
      sourceFacts: [
        { path: 'field.1.keyOrders', equals: '0,1,2' },
        { path: 'line.6.key', equals: 'Field' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-07',
    file: 'val-07-color-tokens.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Colour tokens: $FFFFFFFF default, 8-hex $AABBGGRR, 6-hex $BBGGRR and a length that fits neither.',
    specRefs: ['P5', 'F8', 'K10'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      // F8/K10: a colour is never authoritative, so no diagnostic exists for an odd length;
      // the token is preserved raw and channelOrder records the assumption.
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 8, parsed: 8, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 },
        { sectionIndex: 2, startLine: 12, endLine: 12, keyLine: 12 },
      ],
      sourceFacts: [
        { path: 'text.contains', equals: 'Color="$FFFFFFFF"' },
        { path: 'text.contains', equals: 'BkColor="$80FF0000"' },
        { path: 'text.contains', equals: ',$0000FF,' },
        { path: 'text.contains', equals: ',$1234567,' },
        // 10 elements: colour and option populated, 追加オプション present but empty.
        { path: 'field.1.1.elements', equals: 10 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-08',
    file: 'val-08-continuation-line.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'A Query value broken across two physical lines: the rest is one malformed line, never joined.',
    specRefs: ['P13', 'U12'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_MALFORMED_LINE'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      // The warning sits on the key whose value did not finish on its line.
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'view.count', equals: 1 },
        { path: 'text.contains', equals: 'Query="SELECT id' },
        // The continuation is a physical line of its own, not part of a closed value.
        { path: 'text.contains', equals: 'FROM users WHERE id > 0"' },
        { path: 'line.8.key', equals: 'Query' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-09',
    file: 'val-09-keyorder-gap.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'キー順 is 0 and 2: a gap, so the inferred primary key is reported as a conflict.',
    specRefs: ['P8'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_PK_ORDER_CONFLICT'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      // Both contributing key lines are real and keep their declared ordinals.
      spans: [
        { sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 },
        { sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 },
      ],
      sourceFacts: [
        { path: 'field.1.keyOrders', equals: '0,2' },
        { path: 'line.8.key', equals: 'Field' },
        { path: 'line.9.key', equals: 'Field' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-10',
    file: 'val-10-value-with-equals.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'A TableInnerOption value contains `=`: the key/value split happens on the first one and the rest is data.',
    specRefs: ['P4'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 }],
      sourceFacts: [
        { path: 'line.9.key', equals: 'TableInnerOption' },
        // Everything after the *first* '=' is the value, including the later '=' signs.
        { path: 'line.9.value', equals: '"ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"' },
        {
          path: 'text.contains',
          equals: 'TableInnerOption="ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"',
        },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'val-11',
    file: 'val-11-unterminated-quote.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'A Complex value whose closing quote never arrives: the raw remainder stays one element.',
    specRefs: ['P5', 'F3'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_COMPLEX_UNTERMINATED_QUOTE'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'line.8.key', equals: 'Field' },
        // The ninth element opens a quote that never closes; nothing is re-parsed after it.
        { path: 'field.1.1.elements', equals: 9 },
        {
          path: 'line.8.value',
          equals: '"論理名","phys","varchar(10)","NOT NULL",0,"","",$FFFFFFFF,"オプション未終端',
        },
      ],
      parseFacts: [],
    },
  },
  // ── semantics ──────────────────────────────────────────────────────────
  {
    id: 'sem-01',
    file: 'sem-01-dangling-refs.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Relation to a missing entity, a missing column and a missing page: three warnings, no crash.',
    specRefs: ['§14 row 13', 'P9', 'F5'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_DANGLING_COLUMN', 'V_DANGLING_ENTITY', 'V_DANGLING_PAGE'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 14, parsed: 14, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 3, startLine: 14, endLine: 14, keyLine: 14 }],
      sourceFacts: [
        { path: 'text.contains', equals: 'Entity2="ghost_table"' },
        { path: 'text.contains', equals: 'Fields2="ghost_column"' },
        { path: 'text.contains', equals: 'Position="GhostPage",' },
        { path: 'line.14.key', equals: 'Entity2' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-02',
    file: 'sem-02-page-case.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'PageInfo declares "Main" while the entity position says "MAIN": page names resolve case-insensitively.',
    specRefs: ['P9', 'F5', 'U9'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 }],
      sourceFacts: [
        { path: 'page.count', equals: 1 },
        { path: 'text.contains', equals: 'PageInfo="Main"' },
        // The spelling in the file is what a CaseInsensitiveRef must keep as `declared`.
        { path: 'text.contains', equals: 'Position="MAIN"' },
        { path: 'line.9.value', equals: '"MAIN",10,10' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-03',
    file: 'sem-03-fields-count-mismatch.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Fields1 names two columns and Fields2 three: the arity mismatch is reported, never truncated.',
    specRefs: ['P9', 'U8'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_FIELD_COUNT_MISMATCH'],
      counts: {
        sections: { total: 4, parsed: 4, preservedRaw: 0 },
        keys: { total: 19, parsed: 19, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 4, startLine: 22, endLine: 22, keyLine: 22 },
        { sectionIndex: 4, startLine: 23, endLine: 23, keyLine: 23 },
      ],
      sourceFacts: [
        { path: 'entity.count', equals: 2 },
        { path: 'relation.count', equals: 1 },
        { path: 'text.contains', equals: 'Fields1="a,b"' },
        { path: 'text.contains', equals: 'Fields2="x,y,z"' },
        // Every referenced column is declared, so the only finding is the arity mismatch.
        { path: 'field.1.count', equals: 2 },
        { path: 'field.2.count', equals: 3 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-04',
    file: 'sem-04-legacy-index-under-21.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'FORMAT:21 carrying only the legacy Index key, with a multi-column payload and no IndexInfo.',
    specRefs: ['F2', 'D5', 'L6', 'P8'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['S_LEGACY_KEY', 'V_INDEX_LEGACY_ONLY'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 7, parsed: 7, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 11, endLine: 11, keyLine: 11 }],
      sourceFacts: [
        { path: 'header.format', equals: 21 },
        // The multi-column legacy payload U-A deliberately left out of fmt-02.
        { path: 'text.contains', equals: 'Index=legacy_ix1=0,user_id,created_at' },
        { path: 'line.11.key', equals: 'Index' },
        { path: 'field.1.count', equals: 3 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-05',
    file: 'sem-05-subtype.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      '[Subtype] present: its own keys parse, its entity membership is undeterminable and never inferred.',
    specRefs: ['P13', 'F7', 'D6', 'K11'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['V_UNSUPPORTED_SUBTYPE_MEMBERSHIP'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 9, parsed: 9, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 },
        { sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 },
      ],
      sourceFacts: [
        { path: 'section.3.header', equals: '[Subtype]' },
        { path: 'text.contains', equals: 'SharedMode=0' },
        { path: 'text.contains', equals: 'CompleteCategory=0' },
        // No membership key exists in the format, so the fixture cannot carry one.
        { path: 'text.contains', equals: 'PName="unknown_membership"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-06',
    file: 'sem-06-view-columns.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'One view with LNameByComment=1 beside a plain view: neither stores columns, both say so.',
    specRefs: ['P10', 'F6'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['V_VIEW_COLUMNS_UNKNOWN'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 8, parsed: 8, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 2, startLine: 9, endLine: 9, keyLine: 9 },
        { sectionIndex: 3, startLine: 13, endLine: 13, keyLine: 13 },
      ],
      sourceFacts: [
        { path: 'view.count', equals: 2 },
        { path: 'text.contains', equals: 'LNameByComment=1' },
        { path: 'text.contains', equals: 'PName="plain_view"' },
        // Views carry no Field key at all, so `columns: []` would be a fabrication.
        { path: 'field.count', equals: 0 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-07',
    file: 'sem-07-domains-commonfields.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'A domain, a common field, an @INT system domain and UsingCommonColumns absent beside explicit 0.',
    specRefs: ['P12', 'F9'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      // P12 defaulted-UsingCommonColumns carries an info diagnostic with no taxonomy code (G1).
      codes: [],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 11, parsed: 11, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 },
        { sectionIndex: 3, startLine: 16, endLine: 16, keyLine: 16 },
      ],
      sourceFacts: [
        { path: 'text.contains', equals: 'DomainInfo="int_domain"' },
        { path: 'text.contains', equals: 'CommonField="共通ID"' },
        { path: 'text.contains', equals: '"@INT"' },
        { path: 'text.contains', equals: 'UsingCommonColumns=0' },
        { path: 'entity.count', equals: 2 },
        // The first entity omits the key (default 1), the second sets it to 0.
        { path: 'field.1.count', equals: 2 },
        { path: 'field.2.count', equals: 1 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-08',
    file: 'sem-08-duplicate-pname.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'An entity and a view share one PName: both are emitted and the collision is an error.',
    specRefs: ['P6', 'U6'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_DUPLICATE_OBJECT_NAME'],
      counts: {
        sections: { total: 3, parsed: 3, preservedRaw: 0 },
        keys: { total: 7, parsed: 7, preservedRaw: 0 },
      },
      spans: [
        { sectionIndex: 2, startLine: 7, endLine: 7, keyLine: 7 },
        { sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 },
      ],
      sourceFacts: [
        { path: 'entity.count', equals: 1 },
        { path: 'view.count', equals: 1 },
        { path: 'text.contains', equals: 'PName="twin"' },
        // Uniqueness is what the fixture violates, so the helper must report it.
        { path: 'pname.unique', equals: false },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-09',
    file: 'sem-09-zero-pages.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      '[Manager] with no PageInfo at all: zero pages is an error, and no schema is invented.',
    specRefs: ['P11'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_MISSING_REQUIRED_KEY'],
      counts: {
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 1, parsed: 1, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 1, startLine: 3, endLine: 3, keyLine: 3 }],
      sourceFacts: [
        { path: 'page.count', equals: 0 },
        { path: 'text.contains', equals: 'ProjectName="no_pages"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-10',
    file: 'sem-10-missing-position.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'An entity without Position is still emitted, with an empty positions list and a warning.',
    specRefs: ['P11'],
    stage: 4,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      codes: ['V_MISSING_REQUIRED_KEY'],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 7, endLine: 7, keyLine: 7 }],
      sourceFacts: [
        { path: 'entity.count', equals: 1 },
        { path: 'field.1.count', equals: 1 },
        // Three keys in the file: the entity has no Position line at all.
        { path: 'text.contains', equals: 'PName="no_position"' },
        { path: 'page.count', equals: 1 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'sem-11',
    file: 'sem-11-zero-fields.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'An entity with zero Field keys is legal: complete columns with an empty list, no diagnostic.',
    specRefs: ['P6'],
    stage: 4,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'entity.count', equals: 1 },
        { path: 'field.1.count', equals: 0 },
        { path: 'text.contains', equals: 'PName="no_fields"' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-01',
    file: 'hst-01-nul-inside-text.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'One NUL byte inside a comment, far below the 10 %/4 KiB binary threshold: the document stays text.',
    specRefs: ['§14 row 15', '§10.3'],
    stage: 2,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'line.8.key', equals: 'Comment' },
        // The NUL is data inside a quoted value, not a terminator and not a binary verdict.
        { path: 'text.contains', equals: 'before\u0000after' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-02',
    file: 'hst-02-binary.ts',
    fixtureClass: 'bytes',
    purpose:
      'NUL density above 10 % in the first 4 KiB: the binary verdict is fatal, never a decode attempt.',
    specRefs: ['§14 row 15', '§10.3', 'E_BINARY_INPUT'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      codes: ['E_BINARY_INPUT'],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [
        { path: 'bytes.length', equals: 4096 },
        // 1024 NUL bytes in the first 4096: exactly a quarter, well past the threshold.
        { path: 'bytes.nulRatio', equals: 0.25 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-03',
    file: 'hst-03-single-long-line.a5er',
    fixtureClass: 'generated',
    purpose:
      'A valid document whose Comment line is 1 MiB: a quarter of maxLineLength, so no limit fires.',
    specRefs: ['§14 row 15', '§10.2'],
    stage: 2,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 5, parsed: 5, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 8, endLine: 8, keyLine: 8 }],
      sourceFacts: [
        { path: 'generated.fileCount', equals: 1 },
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: true },
        // Line 8 is the 1 MiB value; the builder pins its length at 1 MiB exactly.
        { path: 'line.8.key', equals: 'Comment' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-04',
    file: 'hst-04-hostile-names.a5er.txt',
    fixtureClass: 'synthetic',
    purpose:
      'Hostile section names: a tag, a nested pair, a trailing character and a 4 KiB name, all inert.',
    specRefs: ['§14 row 15', 'P3', 'F6'],
    stage: 3,
    expectation: {
      status: 'degraded',
      exitCode: 0,
      // Three headers that name nothing known, plus one line that is not a header at all.
      // §5 row 15 groups these five hostile fixtures under "others none"; §14 row 15 says
      // hostile input is parsed *with* diagnostics, and P3 preserves unknown sections with
      // a warning, so the explicit multiset below is the derived expectation. See U-C report.
      codes: ['S_MALFORMED_LINE', 'S_UNKNOWN_SECTION', 'S_UNKNOWN_SECTION', 'S_UNKNOWN_SECTION'],
      counts: {
        sections: { total: 5, parsed: 2, preservedRaw: 3 },
        keys: { total: 6, parsed: 4, preservedRaw: 2 },
      },
      spans: [
        { sectionIndex: 3, startLine: 11, endLine: 11, keyLine: 11 },
        { sectionIndex: 4, startLine: 14, endLine: 14, keyLine: 14 },
        { sectionIndex: 5, startLine: 19, endLine: 19, keyLine: 19 },
      ],
      sourceFacts: [
        { path: 'section.3.header', equals: '[<script>]' },
        // The name keeps the inner brackets; the greedy outer pair is the only delimiter.
        { path: 'section.4.header', equals: '[[Entity]]' },
        // `[` + 4096 characters + `]`, so the raw header is 4098 characters long.
        { path: 'section.5.headerLength', equals: 4098 },
        // One extra character after the bracket means this line is not a header.
        { path: 'text.contains', equals: '[Entity]x' },
        { path: 'entity.count', equals: 1 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-05',
    file: 'hst-05-mixed-eol.ts',
    fixtureClass: 'bytes',
    purpose:
      'CRLF, LF and a bare CR in one file: the format defines no line endings, so nothing is reported.',
    specRefs: ['§14 row 15', 'U4', 'P2'],
    stage: 2,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 2, parsed: 2, preservedRaw: 0 },
        keys: { total: 4, parsed: 4, preservedRaw: 0 },
      },
      spans: [{ sectionIndex: 2, startLine: 5, endLine: 5, keyLine: 5 }],
      sourceFacts: [
        { path: 'encoding.bom', equals: true },
        { path: 'encoding.mixedEol', equals: true },
        { path: 'section.2.header', equals: '[Entity]' },
        // Line 5 follows a CRLF terminator, so numbering survives every line-ending form.
        { path: 'line.5.key', equals: 'PName' },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'hst-06',
    file: 'hst-06-empty-family',
    fixtureClass: 'generated',
    purpose:
      'Three inputs that are not diagrams: empty, whitespace-only, and no recognised section.',
    specRefs: ['§14 row 16', 'E_EMPTY_INPUT', 'E_UNRECOGNIZED_DOCUMENT'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      // One code per outcome; the family is three files, so §5 row 16 lists both codes.
      codes: ['E_EMPTY_INPUT', 'E_UNRECOGNIZED_DOCUMENT'],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [
        { path: 'generated.fileCount', equals: 3 },
        // The first member of the family is the empty file.
        { path: 'bytes.length', equals: 0 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'res-01',
    file: 'res-01-capped-read.a5er',
    fixtureClass: 'generated',
    purpose:
      'A well-formed document larger than a bounded read cap: the read stops short before any schema exists.',
    specRefs: ['§14 row 11', 'E_TRUNCATED_INPUT', '§10.2'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      codes: ['E_TRUNCATED_INPUT'],
      // Fatal: no schema, so no section or key is ever counted.
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [
        { path: 'generated.fileCount', equals: 1 },
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: true },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'res-02',
    file: 'res-02-injected-short-read',
    fixtureClass: 'injected',
    purpose:
      'A short read reported by the IO seam: no file can express it, so the expectation waits for a harness.',
    specRefs: ['§14 row 11', 'E_TRUNCATED_INPUT'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      codes: ['E_TRUNCATED_INPUT'],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      // No bytes exist yet: the injected reader is the harness, and it is not built.
      // Asserting a source fact here would assert something no test can observe.
      sourceFacts: [],
      parseFacts: [],
    },
  },
  {
    id: 'res-03',
    file: 'res-03-limit-family',
    fixtureClass: 'generated',
    purpose:
      'Three files, each one byte or one line past maxBytes, maxLines and maxLineLength respectively.',
    specRefs: ['§14 row 12', '§10.2'],
    stage: 2,
    expectation: {
      status: 'failed',
      exitCode: 1,
      // One code per file; a single file breaching several limits could not say which fired.
      codes: ['E_LIMIT_BYTES', 'E_LIMIT_LINES', 'E_LIMIT_LINE_LENGTH'],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [
        // The family is three documents; the per-file breach is asserted by the builder test.
        { path: 'generated.fileCount', equals: 3 },
      ],
      parseFacts: [],
    },
  },
  {
    id: 'imm-01',
    file: 'imm-01-catalog-wide',
    fixtureClass: 'catalog-wide',
    purpose:
      'Every command against every text fixture leaves sha256, size, mtime and the directory untouched.',
    specRefs: ['§14 row 14', 'G-7'],
    stage: 5,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: [],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      // A harness over the whole catalog owns no bytes of its own.
      sourceFacts: [],
      parseFacts: [],
    },
  },
  {
    id: 'fuzz-01',
    file: 'fuzz-01-seeded-mutants',
    fixtureClass: 'generated',
    purpose:
      'Two hundred seeded byte mutations of fmt-01: the floor for crashes, hangs and leaked input.',
    specRefs: ['§14 row 15', '§12'],
    stage: 6,
    expectation: {
      status: 'ok',
      exitCode: 0,
      // §12: the floor is not a correctness oracle, so it pins no diagnostic of its own and
      // each mutant's status is asserted per mutant, not once for the family.
      codes: [],
      counts: {
        sections: { total: 0, parsed: 0, preservedRaw: 0 },
        keys: { total: 0, parsed: 0, preservedRaw: 0 },
      },
      spans: [],
      sourceFacts: [{ path: 'generated.fileCount', equals: 200 }],
      parseFacts: [],
    },
  },
];

const FILE_SUFFIXES: Record<FixtureClass, readonly string[]> = {
  synthetic: ['.a5er.txt'],
  bytes: ['.ts', '.bin'],
  generated: [],
  injected: [],
  'catalog-wide': [],
};

// §4 uses one four-letter family (`fuzz-01`); every other ID is three letters.
const ID_PATTERN = /^[a-z]{3,4}-\d{2}$/;

function duplicateIds(specs: readonly FixtureSpec[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const spec of specs) {
    if (seen.has(spec.id)) duplicates.push(spec.id);
    seen.add(spec.id);
  }
  return duplicates;
}

/**
 * Compare produced diagnostic codes against the expectation as an order-normalised
 * multiset (test-strategy §7 T2, §10 G-2): the arrays are sorted first, so a missing
 * occurrence or an extra one fails while a repeat that both sides carry passes.
 */
export function codesMatch(actual: readonly string[], expected: readonly string[]): boolean {
  const normalise = (codes: readonly string[]): string[] => [...codes].sort();
  const left = normalise(actual);
  const right = normalise(expected);
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

/**
 * Return a list of problems (empty means valid). Returning problems instead of
 * throwing keeps the failure diff readable in the test that asserts `[]`.
 */
export function validateRegistry(specs: readonly FixtureSpec[]): string[] {
  const problems: string[] = [];

  for (const id of duplicateIds(specs)) problems.push(`duplicate fixture id: ${id}`);

  for (const spec of specs) {
    if (!ID_PATTERN.test(spec.id)) problems.push(`${spec.id}: id must match <family>-<nn>`);
    if (spec.purpose.trim() === '') problems.push(`${spec.id}: purpose is empty`);
    if (spec.specRefs.length === 0) problems.push(`${spec.id}: specRefs is empty`);

    const allowed = FILE_SUFFIXES[spec.fixtureClass];
    // An empty list means the class imposes no suffix (generated bytes, harnesses).
    if (allowed.length > 0 && !allowed.some((suffix) => spec.file.endsWith(suffix))) {
      problems.push(`${spec.id}: ${spec.file} does not match class ${spec.fixtureClass}`);
    }
    if (!spec.file.startsWith(`${spec.id}-`))
      problems.push(`${spec.id}: file must start with the id`);

    const { counts, codes, exitCode, status } = spec.expectation;
    for (const [label, value] of [
      ['sections.total', counts.sections.total],
      ['sections.parsed', counts.sections.parsed],
      ['sections.preservedRaw', counts.sections.preservedRaw],
      ['keys.total', counts.keys.total],
      ['keys.parsed', counts.keys.parsed],
      ['keys.preservedRaw', counts.keys.preservedRaw],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) problems.push(`${spec.id}: ${label} must be >= 0`);
    }

    if (counts.sections.total !== counts.sections.parsed + counts.sections.preservedRaw) {
      problems.push(`${spec.id}: sections.total must equal parsed + preservedRaw`);
    }
    if (counts.keys.total !== counts.keys.parsed + counts.keys.preservedRaw) {
      problems.push(`${spec.id}: keys.total must equal parsed + preservedRaw`);
    }

    const sorted = [...codes].sort();
    if (codes.some((code, index) => code !== sorted[index])) {
      problems.push(`${spec.id}: codes must be sorted`);
    }
    // Duplicates are legal and expected: one diagnostic per occurrence (`codes` is a
    // multiset). Comparison happens in `codesMatch`, so nothing is lost here.

    if (status === 'failed' && exitCode !== 1) problems.push(`${spec.id}: failed implies exit 1`);
    if (status !== 'failed' && exitCode !== 0 && exitCode !== 3) {
      problems.push(`${spec.id}: non-failed exit must be 0 (inspect) or 3 (validate)`);
    }

    for (const span of spec.expectation.spans) {
      if (span.startLine < 1 || span.keyLine < span.startLine || span.keyLine > span.endLine) {
        problems.push(`${spec.id}: invalid span ${String(span.startLine)}-${String(span.endLine)}`);
      }
      if (span.sectionIndex < 0) problems.push(`${spec.id}: sectionIndex must be >= 0`);
    }

    for (const list of ['sourceFacts', 'parseFacts'] as const) {
      for (const fact of spec.expectation[list]) {
        if (fact.path.trim() === '') problems.push(`${spec.id}: ${list} path is empty`);
      }
    }

    // The two lists must stay disjoint: a source path in `parseFacts` (or the reverse)
    // would let a parser test assert stage-1 evidence it cannot observe.
    const sourcePaths = new Set(spec.expectation.sourceFacts.map((fact) => fact.path));
    for (const fact of spec.expectation.parseFacts) {
      if (sourcePaths.has(fact.path)) {
        problems.push(`${spec.id}: fact path ${fact.path} is both a source and a parse fact`);
      }
    }
  }

  return problems;
}
