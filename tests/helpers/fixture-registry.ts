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
 * - `codes` is the exact multiset of diagnostic codes, sorted; extra or missing
 *   codes must fail the test (test-strategy T2).
 * - `facts` carries semantic values by path so a fixture can assert parsed
 *   content without a golden document (test-strategy §3.6 ordering).
 */

/** Where a fixture lives and how it is materialised. */
export type FixtureClass = 'synthetic' | 'bytes' | 'generated';

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

/** One semantic assertion, addressed by a dotted path into the envelope. */
export interface SemanticFact {
  /** e.g. `objects[0].pname.value` or `pages[0].name.origin`. */
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
  readonly facts: readonly SemanticFact[];
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
      facts: [
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: true },
        { path: 'encoding.crlf', equals: true },
        { path: 'entity.count', equals: 2 },
        { path: 'view.count', equals: 1 },
        { path: 'relation.count', equals: 1 },
        { path: 'field.1.1.elements', equals: 10 },
        { path: 'field.1.keyOrders', equals: '0,1' },
        { path: 'index.1.1.columns', equals: 'user_name,birthday' },
        { path: 'line.13.key', equals: 'IndexInfo' },
      ],
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
      facts: [
        { path: 'header.format', equals: 19 },
        { path: 'encoding.bom', equals: true },
        { path: 'line.7.key', equals: 'Index' },
        { path: 'text.contains', equals: 'Index=legacy_orders_ix1=0,user_id,created_at' },
      ],
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
      facts: [
        { path: 'header.format', equals: 20 },
        { path: 'line.4.key', equals: 'PName' },
      ],
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
      facts: [
        { path: 'header.format', equals: 21 },
        { path: 'encoding.bom', equals: false },
        { path: 'line.5.key', equals: 'PName' },
      ],
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
      facts: [
        { path: 'bytes.length', equals: 106 },
        { path: 'encoding.bom', equals: false },
        { path: 'header.format', equals: 21 },
        { path: 'encoding.declared', equals: 'UTF8' },
      ],
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
      facts: [
        { path: 'bytes.length', equals: 39 },
        { path: 'strict.allReject', equals: true },
      ],
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
      facts: [
        { path: 'bytes.prefix', equals: 'fffe' },
        { path: 'header.format', equals: 21 },
      ],
    },
  },
  // ── structure ──────────────────────────────────────────────────────────
  {
    id: 'txt-04',
    file: 'txt-04-unknown-section-key.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'Unknown section and unknown key are preserved as raw evidence, not dropped.',
    specRefs: ['§14 row 9', 'P13', 'F6'],
    stage: 3,
    expectation: {
      status: 'ok',
      exitCode: 0,
      codes: ['S_UNKNOWN_KEY', 'S_UNKNOWN_SECTION'],
      counts: {
        sections: { total: 2, parsed: 1, preservedRaw: 1 },
        keys: { total: 4, parsed: 2, preservedRaw: 2 },
      },
      spans: [{ sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 }],
      facts: [
        { path: 'header.format', equals: 21 },
        { path: 'text.contains', equals: 'MysteryKey="value"' },
        { path: 'text.contains', equals: '[Memo]' },
        { path: 'line.5.key', equals: 'MysteryKey' },
      ],
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
      facts: [
        { path: 'escape.sequences', equals: '\\Q,\\\\,\\q,\\t,\\n' },
        { path: 'line.5.key', equals: 'Comment' },
      ],
    },
  },
  {
    id: 'val-02',
    file: 'val-02-index-multi-column.a5er.txt',
    fixtureClass: 'synthetic',
    purpose: 'IndexInfo whose column list is one quoted element containing a comma.',
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
      facts: [
        { path: 'index.1.1.columns', equals: 'user_name,birthday' },
        { path: 'index.1.2.columns', equals: 'user_name' },
        { path: 'line.7.key', equals: 'IndexInfo' },
      ],
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
      facts: [
        { path: 'field.1.1.elements', equals: 9 },
        { path: 'line.5.key', equals: 'Field' },
      ],
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
      facts: [
        { path: 'field.1.1.elements', equals: 7 },
        { path: 'line.5.key', equals: 'Field' },
      ],
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
      facts: [
        { path: 'field.1.keyOrders', equals: '0,1,2' },
        { path: 'line.6.key', equals: 'Field' },
      ],
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
      facts: [
        { path: 'text.contains', equals: 'Entity2="ghost_table"' },
        { path: 'text.contains', equals: 'Fields2="ghost_column"' },
        { path: 'text.contains', equals: 'Position="GhostPage",' },
        { path: 'line.14.key', equals: 'Entity2' },
      ],
    },
  },
];

const FILE_SUFFIXES: Record<FixtureClass, readonly string[]> = {
  synthetic: ['.a5er.txt'],
  bytes: ['.ts', '.bin'],
  generated: [],
};

const ID_PATTERN = /^[a-z]{3}-\d{2}$/;

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
    if (!allowed.some((suffix) => spec.file.endsWith(suffix) || suffix === '')) {
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
    if (new Set(codes).size !== codes.length) problems.push(`${spec.id}: codes must not repeat`);

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

    for (const fact of spec.expectation.facts) {
      if (fact.path.trim() === '') problems.push(`${spec.id}: fact path is empty`);
    }
  }

  return problems;
}
