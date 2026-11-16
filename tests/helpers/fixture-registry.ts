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
export const FIXTURES: readonly FixtureSpec[] = [];

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
