/**
 * `measure(scan)` — structural counters and two conservative bounds (F4; `architecture.md` §13).
 *
 * Six axes, and nothing about admission (weights, thresholds, refusal and CLI output are later
 * units and have no representation here):
 *
 * 1. **counters** — every figure is an occurrence a line scan settles, so the expectations below are
 *    derived by counting lines of hand-written documents and of the committed fixtures, never from
 *    the module's own output;
 * 2. **§13 reuse** — the line/section/key totals are `scan.accounting`'s, returned by reference; a
 *    second bookkeeping path is exactly what §13 forbids, so the test asserts identity;
 * 3. **kind, not name** — `[Relationship]` counts as `Relation`, `[entity]` counts as `unknown`;
 * 4. **exact key text** — ` Field`, `Field ` and `field` are different keys, because the registry
 *    compares keys as written;
 * 5. **bounds** — the composed-column bound and the relation-slot bound are checked against the
 *    figures the *semantic* stage actually produces (`commonColumnsOf`, `relationsOf`), called from
 *    this file only: `measure()` never imports them;
 * 6. **purity** — a frozen scan is measurable, the result is deterministic, and `src/budget/` reads
 *    no clock, environment, filesystem or heap figure;
 * 7. **range contract** — every numeric input and every published number is a non-negative safe
 *    integer; a violation throws `ResourceMeasureError` naming the field, and the product/sum
 *    boundaries are checked against exact `BigInt` arithmetic around `2^53`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measure, ResourceMeasureError } from '../src/budget/index.js';
import { checkedProduct, checkedSum } from '../src/budget/measure.js';
import type { ResourceMeasure } from '../src/budget/measure.js';
import { loadSource } from '../src/decode/load.js';
import { classify } from '../src/schema/registry.js';
import { commonColumnsOf } from '../src/semantic/common-columns.js';
import { relationsOf } from '../src/semantic/relations.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { SyntaxAccounting, SyntaxScan } from '../src/syntax/scanner.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

const BUDGET_DIR = fileURLToPath(new URL('../src/budget/', import.meta.url));

/** A scan of inline text; FORMAT 21 unless a case is about the format fact itself. */
function scanOf(text: string, format: number | null = 21): SyntaxScan {
  return scanSource({ text, format });
}

/** The measurement of inline text. */
function measureOf(text: string, format: number | null = 21): ResourceMeasure {
  return measure(scanOf(text, format));
}

const SYNTHETIC = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');
const FIXTURE_SCANS = new Map<string, SyntaxScan>();

/** One committed synthetic fixture, staged and scanned; the same result for every test. */
function scanOfFixture(id: string): SyntaxScan {
  const cached = FIXTURE_SCANS.get(id);
  if (cached !== undefined) return cached;
  const staged = stage(id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    const scan = scanSource(outcome.source);
    FIXTURE_SCANS.set(id, scan);
    return scan;
  } finally {
    staged.cleanup();
  }
}

/** The common columns every entity actually adopts, summed — what the bound must cover. */
function composedCommonColumns(scan: SyntaxScan): number {
  const columns = commonColumnsOf(classify(scan));
  return columns.entities.reduce((total, entity) => total + entity.common.length, 0);
}

/** The `Fields1`/`Fields2` slots the relation stage actually lists, both sides together. */
function listedColumnSlots(scan: SyntaxScan): number {
  const relations = relationsOf(classify(scan));
  return relations.relations.reduce(
    (total, relation) =>
      total +
      (relation.fromColumns?.columns.length ?? 0) +
      (relation.toColumns?.columns.length ?? 0),
    0,
  );
}

/** Recursively freeze an input so any mutation attempt becomes a TypeError in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** Every numeric leaf of a measurement, with a path so a failure names the offender. */
function numericLeaves(result: ResourceMeasure): [path: string, value: number][] {
  const leaves: [string, number][] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      leaves.push([path, value]);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(result.counters, 'counters');
  walk(result.bounds, 'bounds');
  return leaves;
}

const MANAGER_KEYS = 'PageInfo="Main",3,"A4Landscape","$FFFFFF"\n';
const COMMON_FIELD = (column: string): string =>
  `CommonField="共通","${column}","Integer","NOT NULL","0","","","$FFFFFFFF"\n`;
const FIELD = (column: string): string =>
  `Field="列","${column}","Serial","NOT NULL",0,"","",$FFFFFFFF,""\n`;
const POSITION = (x: number, y: number): string => `Position="Main",${x},${y}\n`;

/** An `[Entity]` section; `null` for a name leaves `PName` out entirely. */
function entitySection(name: string | null, body: string): string {
  return `[Entity]\n${name === null ? '' : `PName="${name}"\n`}${body}`;
}

/** A relation section of either spelling, with both column lists. */
function relationSection(
  header: '[Relation]' | '[Relationship]',
  from: string,
  to: string,
  fields1: string,
  fields2: string,
): string {
  return (
    `${header}\nEntity1="${from}"\nEntity2="${to}"\n` +
    `Fields1="${fields1}"\nFields2="${fields2}"\nRelationType1=1\nRelationType2=3\n` +
    'Position="Main",0,100,100,100,R,R,""\n'
  );
}

// ── §13 totals are reused, never re-counted ────────────────────────────────

describe('measure — the §13 totals are the scan’s own', () => {
  it('returns the accounting object by reference and repeats its fields', () => {
    const scan = scanOf(`[Manager]\n${MANAGER_KEYS}[Entity]\nPName="a"\n${FIELD('id')}`);
    const result = measure(scan);

    // §13 has exactly one bookkeeping path; a copy would let the two drift.
    expect(result.accounting).toBe(scan.accounting);
    expect(result.counters.totalLines).toBe(scan.accounting.lines.total);
    expect(result.counters.totalSections).toBe(scan.accounting.sections.total);
    expect(result.counters.totalKeys).toBe(scan.accounting.keys.total);
    expect(result.counters.totalComments).toBe(scan.accounting.lines.comments);
    expect(result.counters.totalBlankLines).toBe(scan.accounting.lines.blank);
    expect(result.counters.totalRawLines).toBe(scan.accounting.lines.raw);
    expect(result.counters.unknownSectionKeyOccurrences).toBe(
      scan.accounting.keys.inUnknownSections,
    );
  });

  it('keeps the line partition for a document with every line kind', () => {
    // 1 [Manager], 2 PageInfo, 3 CommonField, 4 blank, 5 comment, 6 [Entity], 7 PName,
    // 8 Field, 9 Field, 10 UsingCommonColumns, 11 Position, 12 [Relation], 13 Entity1,
    // 14 Entity2, 15 Fields1, 16 Fields2, 17 RelationType1, 18 RelationType2, 19 Position.
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('id')}\n` +
      '# a note\n' +
      entitySection(
        'orders',
        `${FIELD('id')}${FIELD('qty')}UsingCommonColumns=1\n${POSITION(10, 10)}`,
      ) +
      relationSection('[Relation]', 'orders', 'orders', 'id,qty', 'id,qty');
    const result = measureOf(text);

    expect(result.counters.totalLines).toBe(19);
    expect(result.counters.totalSections).toBe(3);
    expect(result.counters.totalKeys).toBe(14);
    expect(result.counters.totalComments).toBe(1);
    expect(result.counters.totalBlankLines).toBe(1);
    expect(result.counters.totalRawLines).toBe(0);
    expect(result.accounting.dropped).toBe(0);
  });
});

// ── structural occurrences ─────────────────────────────────────────────────

describe('measure — structural occurrences, counted as written', () => {
  it('counts Field lines in every [Entity] section', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}${FIELD('b')}\n${POSITION(1, 1)}`) +
      entitySection('b', `${FIELD('id')}\n${POSITION(2, 2)}`);

    const result = measureOf(text);

    expect(result.counters.entityFieldOccurrences).toBe(3);
    expect(result.counters.sectionsByKind.Entity).toBe(2);
    expect(result.counters.managerCommonFieldOccurrences).toBe(0);
  });

  it('counts CommonField lines in every [Manager] section, not only the first', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('created_at')}${COMMON_FIELD('updated_at')}\n` +
      `[Manager]\n${COMMON_FIELD('deleted_at')}\n` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`);

    const result = measureOf(text);

    // A first-section-only reader would report 2 and silently under-bound the composition.
    expect(result.counters.managerCommonFieldOccurrences).toBe(3);
    expect(result.counters.sectionsByKind.Manager).toBe(2);
  });

  it('counts Fields1 and Fields2 once per relation section', () => {
    const relations = Array.from({ length: 20 }, () =>
      relationSection('[Relation]', 'a', 'a', 'id', 'id'),
    ).join('');
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      relations;

    const result = measureOf(text);

    expect(result.counters.relationFields1Occurrences).toBe(20);
    expect(result.counters.relationFields2Occurrences).toBe(20);
    expect(result.counters.sectionsByKind.Relation).toBe(20);
    // `"id"` is four UTF-16 code units, quotes included; every occurrence counts once.
    expect(result.counters.fields1ValueCodeUnits).toBe(80);
    expect(result.counters.fields2ValueCodeUnits).toBe(80);
  });

  it('counts the [Relationship] alias as a relation section', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      relationSection('[Relation]', 'a', 'a', 'id', 'id') +
      relationSection('[Relationship]', 'a', 'a', 'id', 'id');
    const scan = scanOf(text);
    const result = measure(scan);

    // The two headers are different spellings of one kind (§5); counting by `name` would say 1.
    expect(scan.sections.map((section) => section.name)).toEqual([
      'Manager',
      'Entity',
      'Relation',
      'Relationship',
    ]);
    expect(result.counters.sectionsByKind.Relation).toBe(2);
    expect(result.counters.sectionsByKind.unknown).toBe(0);
    expect(result.counters.relationFields1Occurrences).toBe(2);
    expect(result.counters.relationFields2Occurrences).toBe(2);
  });

  it('counts UsingCommonColumns lines whatever their value says', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('id')}` +
      entitySection('omitted', `${FIELD('a')}\n${POSITION(1, 1)}`) +
      entitySection('zero', `${FIELD('b')}UsingCommonColumns=0\n${POSITION(2, 2)}`) +
      entitySection('one', `${FIELD('c')}UsingCommonColumns=1\n${POSITION(3, 3)}`) +
      entitySection('odd', `${FIELD('d')}UsingCommonColumns=maybe\n${POSITION(4, 4)}`);

    const result = measureOf(text);

    // Occurrences, not verdicts: the value is the semantic stage's business, not this one's.
    expect(result.counters.entityUsingCommonColumnsOccurrences).toBe(3);
    expect(result.counters.sectionsByKind.Entity).toBe(4);
  });

  it('counts duplicate keys once per occurrence', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}${FIELD('id')}\n${POSITION(1, 1)}`) +
      '[Relation]\nEntity1="a"\nEntity2="a"\nFields1="x"\nFields1="y,z"\n' +
      'RelationType1=1\nRelationType2=3\n';

    const result = measureOf(text);

    // Duplicates are separate records (P4, U6); `"x"` is three code units, `"y,z"` is five.
    expect(result.counters.entityFieldOccurrences).toBe(2);
    expect(result.counters.relationFields1Occurrences).toBe(2);
    expect(result.counters.fields1ValueCodeUnits).toBe(8);
  });

  it('counts key lines that declare nothing usable', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('id')}` +
      entitySection('a', `Field=\n${FIELD('id')}\n${POSITION(1, 1)}`);

    const result = measureOf(text);

    // `Field=` is a `Field` occurrence whose value declares no column; the line is a fact, the
    // column is not, and this module only publishes the fact.
    expect(result.counters.entityFieldOccurrences).toBe(2);
  });

  it('counts a value the decoder cannot tokenise, and bounds it as raw text', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      // val-11's shape: the quote never closes, so the token is not a value the stage can read.
      '[Relation]\nEntity1="a"\nEntity2="a"\nFields1="unterminated\nFields2=""\n' +
      'RelationType1=1\nRelationType2=3\n';
    const scan = scanOf(text);
    const result = measure(scan);

    expect(result.counters.relationFields1Occurrences).toBe(1);
    // `"unterminated` is 13 UTF-16 code units; the bound is 13 + 1, whatever the quote did.
    expect(result.counters.fields1ValueCodeUnits).toBe(13);
    expect(result.counters.fields2ValueCodeUnits).toBe(2);
    expect(result.bounds.relationColumnSlotsUpperBound).toBe(17);
    expect(listedColumnSlots(scan)).toBeLessThanOrEqual(
      result.bounds.relationColumnSlotsUpperBound,
    );
  });

  it('counts a field-heavy document once per line', () => {
    const entities = Array.from({ length: 50 }, (_, index) =>
      entitySection(
        `e${index}`,
        `${FIELD('id')}${FIELD('a')}${FIELD('b')}${FIELD('c')}${FIELD('d')}${FIELD('e')}${FIELD('f')}${FIELD('g')}` +
          POSITION(index, index),
      ),
    ).join('');
    const result = measureOf(`[Manager]\n${MANAGER_KEYS}${entities}`);

    expect(result.counters.entityFieldOccurrences).toBe(50 * 8);
    expect(result.counters.sectionsByKind.Entity).toBe(50);
    // 2 document lines, then 11 per entity: header, `PName`, eight `Field`, one `Position`.
    expect(result.counters.totalLines).toBe(2 + 50 * 11);
  });
});

// ── unknown sections, header region, malformed lines ───────────────────────

describe('measure — sections and keys the registry will not recognise', () => {
  it('files an unrecognised header and a wrong-case header under unknown', () => {
    const text = '[Mystery]\nPName="x"\nField="a"\n' + '[entity]\nPName="y"\nField="b"\n';
    const result = measureOf(text);

    expect(result.counters.sectionsByKind.unknown).toBe(2);
    expect(result.counters.sectionsByKind.Entity).toBe(0);
    expect(result.counters.entityFieldOccurrences).toBe(0);
    // Four key lines, two per unknown section: `PName` and `Field` on each side.
    expect(result.counters.unknownSectionKeyOccurrences).toBe(4);
  });

  it('does not count keys before the first header as section keys', () => {
    const text = `Field="x"\nCommonField="y"\nFields1="z"\n[Entity]\nPName="a"\n`;
    const scan = scanOf(text);
    const result = measure(scan);

    expect(scan.header.keyLines).toHaveLength(3);
    expect(result.counters.unknownSectionKeyOccurrences).toBe(0);
    expect(result.counters.entityFieldOccurrences).toBe(0);
    expect(result.counters.managerCommonFieldOccurrences).toBe(0);
    expect(result.counters.relationFields1Occurrences).toBe(0);
    expect(result.counters.totalKeys).toBe(4);
  });

  it('scopes a key to its section kind', () => {
    const text =
      '[Manager]\nField="a"\n' +
      entitySection('a', `CommonField="b"\nFields1="c"\n${POSITION(1, 1)}`) +
      '[View]\nPName="v"\nFields1="d"\n' +
      '[Shape]\nField="e"\n';

    const result = measureOf(text);

    expect(result.counters.entityFieldOccurrences).toBe(0);
    expect(result.counters.managerCommonFieldOccurrences).toBe(0);
    expect(result.counters.relationFields1Occurrences).toBe(0);
    expect(result.counters.sectionsByKind.View).toBe(1);
    expect(result.counters.sectionsByKind.Shape).toBe(1);
    expect(result.counters.totalKeys).toBe(8);
  });

  it('matches a key by its exact text, never by a trimmed or folded form', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', ' Field="a"\nField ="b"\nfield="c"\nField="d"\n' + POSITION(1, 1));

    const scan = scanOf(text);
    const result = measure(scan);

    // The registry looks keys up as written (`lookupKey(kind, entry.key)`), so these are three
    // different unknown keys plus one real `Field`.
    expect(
      scan.sections[1]?.entries.map((entry) => (entry.kind === 'key' ? entry.key : '#')),
    ).toEqual(['PName', ' Field', 'Field ', 'field', 'Field', 'Position']);
    expect(result.counters.entityFieldOccurrences).toBe(1);
  });

  it('leaves a raw line to §13, not to a structural counter', () => {
    const text = entitySection('a', `${FIELD('id')}${POSITION(1, 1)}continued text\n`);
    const result = measureOf(text);

    expect(result.counters.totalRawLines).toBe(1);
    expect(result.counters.entityFieldOccurrences).toBe(1);
    expect(result.counters.totalKeys).toBe(3);
  });

  it('counts comments and blanks through the scan, wherever they sit', () => {
    const text = `# one\n\n[Manager]\n${MANAGER_KEYS}\n# two\n\n# three\n`;
    const result = measureOf(text);

    expect(result.counters.totalComments).toBe(3);
    expect(result.counters.totalBlankLines).toBe(3);
    expect(result.counters.totalKeys).toBe(1);
  });
});

// ── bounds ─────────────────────────────────────────────────────────────────

describe('measure — the composed-column bound covers what the entities adopt', () => {
  it('fits the worst case exactly: every entity adopts every declaration', () => {
    // Three entities (one nameless, which still composes) × two common fields.
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('created_at')}${COMMON_FIELD('updated_at')}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      entitySection('b', `${FIELD('id')}UsingCommonColumns=1\n${POSITION(2, 2)}`) +
      entitySection(null, `${FIELD('id')}\n${POSITION(3, 3)}`);
    const scan = scanOf(text);
    const result = measure(scan);

    expect(result.bounds.composedColumnsUpperBound).toEqual({
      entitySections: 3,
      managerCommonFieldOccurrences: 2,
      upperBound: 6,
    });
    // A bound that is never reached is not evidence; this document reaches it.
    expect(composedCommonColumns(scan)).toBe(6);
  });

  it('covers an opt-out and an unusable opt-in without changing shape', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('created_at')}${COMMON_FIELD('updated_at')}` +
      entitySection('default', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      entitySection('out', `${FIELD('id')}UsingCommonColumns=0\n${POSITION(2, 2)}`) +
      entitySection('in', `${FIELD('id')}UsingCommonColumns=1\n${POSITION(3, 3)}`) +
      entitySection('odd', `${FIELD('id')}UsingCommonColumns=maybe\n${POSITION(4, 4)}`);
    const scan = scanOf(text);
    const result = measure(scan);

    expect(result.bounds.composedColumnsUpperBound).toEqual({
      entitySections: 4,
      managerCommonFieldOccurrences: 2,
      upperBound: 8,
    });
    // Default (2) + opt-out (0) + opt-in (2) + unusable opt-in (0) = 4, and 4 ≤ 8.
    expect(composedCommonColumns(scan)).toBe(4);
  });

  it('keeps the two factors, never a clamped product', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('id')}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      entitySection('b', `${FIELD('id')}\n${POSITION(2, 2)}`);
    const bound = measureOf(text).bounds.composedColumnsUpperBound;

    expect(bound.upperBound).toBe(bound.entitySections * bound.managerCommonFieldOccurrences);
    expect(bound.upperBound).toBe(2);
  });

  it('states the Limits precondition: two factors of 2·10⁶ stay a safe integer', () => {
    // `maxLines` is 2,000,000 (§10.2), so both factors are bounded by it; the product must be a
    // safe integer for the documented precondition to hold.
    expect(2_000_000 * 2_000_000).toBe(4_000_000_000_000);
    expect(Number.isSafeInteger(2_000_000 * 2_000_000)).toBe(true);
  });
});

describe('measure — the relation-slot bound covers what the relation stage lists', () => {
  it('covers a list of five names with room to spare', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      relationSection('[Relation]', 'a', 'a', 'c1,c2,c3', 'c4,c5');
    const scan = scanOf(text);
    const result = measure(scan);

    // `"c1,c2,c3"` is 10 code units and `"c4,c5"` is 7, so the bound is 11 + 8 = 19 for 5 slots.
    expect(result.counters.fields1ValueCodeUnits).toBe(10);
    expect(result.counters.fields2ValueCodeUnits).toBe(7);
    expect(result.bounds.relationColumnSlotsUpperBound).toBe(19);
    expect(listedColumnSlots(scan)).toBe(5);
  });

  it('covers a list whose trailing element separator drops a slot', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      relationSection('[Relation]', 'a', 'a', 'a,b,', 'a,b');
    const scan = scanOf(text);

    // §7.1 drops the slot a trailing separator leaves blank: three names on one side, two on the
    // other, while the bound counts the raw text of both.
    expect(measure(scan).bounds.relationColumnSlotsUpperBound).toBeGreaterThanOrEqual(
      listedColumnSlots(scan),
    );
    expect(listedColumnSlots(scan)).toBe(5);
  });

  it('bounds lists that the relation stage never reads', () => {
    const text =
      `[Manager]\n${MANAGER_KEYS}` +
      entitySection('a', `${FIELD('id')}\n${POSITION(1, 1)}`) +
      // The last `Fields1` wins, so the earlier list is never listed — but it is still counted.
      '[Relation]\nEntity1="a"\nEntity2="a"\nFields1="x,y,z"\nFields1="id"\n' +
      'Fields2="id"\nRelationType1=1\nRelationType2=3\n';
    const scan = scanOf(text);

    expect(measure(scan).counters.relationFields1Occurrences).toBe(2);
    expect(listedColumnSlots(scan)).toBe(2);
    expect(measure(scan).bounds.relationColumnSlotsUpperBound).toBeGreaterThan(2);
  });
});

// ── every committed synthetic fixture ──────────────────────────────────────

describe('measure — the committed synthetic fixtures', () => {
  it('has all 39 synthetic fixtures to measure', () => {
    expect(SYNTHETIC).toHaveLength(39);
  });

  it('reuses the accounting object and keeps every counter a non-negative safe integer', () => {
    for (const spec of SYNTHETIC) {
      const scan = scanOfFixture(spec.id);
      const result = measure(scan);

      expect(result.accounting, spec.id).toBe(scan.accounting);
      for (const [path, value] of numericLeaves(result)) {
        expect(Number.isSafeInteger(value), `${spec.id} ${path}`).toBe(true);
        expect(value, `${spec.id} ${path}`).toBeGreaterThanOrEqual(0);
      }
      expect(result.counters.sectionsByKind, spec.id).toEqual({
        Manager: scan.sections.filter((section) => section.kind === 'Manager').length,
        Entity: scan.sections.filter((section) => section.kind === 'Entity').length,
        Relation: scan.sections.filter((section) => section.kind === 'Relation').length,
        View: scan.sections.filter((section) => section.kind === 'View').length,
        Subtype: scan.sections.filter((section) => section.kind === 'Subtype').length,
        Shape: scan.sections.filter((section) => section.kind === 'Shape').length,
        Line: scan.sections.filter((section) => section.kind === 'Line').length,
        Comment: scan.sections.filter((section) => section.kind === 'Comment').length,
        unknown: scan.sections.filter((section) => section.kind === 'unknown').length,
      });
      const perKind = Object.values(result.counters.sectionsByKind).reduce(
        (total, value) => total + value,
        0,
      );
      expect(perKind, spec.id).toBe(result.counters.totalSections);
    }
  });

  it('bounds the common columns every entity adopts, on every fixture', () => {
    const violations: string[] = [];
    for (const spec of SYNTHETIC) {
      const scan = scanOfFixture(spec.id);
      const { upperBound, entitySections, managerCommonFieldOccurrences } =
        measure(scan).bounds.composedColumnsUpperBound;
      const actual = composedCommonColumns(scan);

      expect(upperBound, spec.id).toBe(entitySections * managerCommonFieldOccurrences);
      if (actual > upperBound) violations.push(`${spec.id}: ${actual} > ${upperBound}`);
    }

    expect(violations).toEqual([]);
  });

  it('bounds the relation column slots, on every fixture', () => {
    const violations: string[] = [];
    for (const spec of SYNTHETIC) {
      const scan = scanOfFixture(spec.id);
      const bound = measure(scan).bounds.relationColumnSlotsUpperBound;
      const actual = listedColumnSlots(scan);

      if (actual > bound) violations.push(`${spec.id}: ${actual} > ${bound}`);
    }

    expect(violations).toEqual([]);
  });
});

// ── determinism, immutability, format independence ─────────────────────────

describe('measure — pure and deterministic', () => {
  const TEXT =
    `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('created_at')}\n` +
    entitySection('a', `${FIELD('id')}UsingCommonColumns=1\n${POSITION(1, 1)}`) +
    relationSection('[Relation]', 'a', 'a', 'id', 'id');

  it('returns the same measurement twice', () => {
    const scan = scanOf(TEXT);

    expect(measure(scan)).toEqual(measure(scan));
    expect(JSON.stringify(measure(scan))).toBe(JSON.stringify(measure(scan)));
  });

  it('measures a deep-frozen scan and changes nothing', () => {
    const scan = scanOf(TEXT);
    const before = JSON.stringify(scan);
    const thawed = measure(scan);
    const frozen = deepFreeze(scanOf(TEXT));
    const frozenBefore = JSON.stringify(frozen);

    expect(measure(frozen)).toEqual(thawed);
    expect(JSON.stringify(scan)).toBe(before);
    expect(JSON.stringify(frozen)).toBe(frozenBefore);
    // The freeze is real, so the equality above is evidence and not a formality.
    expect(() => (frozen.sections as unknown as unknown[]).push('x')).toThrow(TypeError);
  });

  it('does not depend on the FORMAT fact', () => {
    const declared = measureOf(TEXT, 21);
    const absent = measureOf(TEXT, null);

    // FORMAT decides which decoders later stages enable (§6); the scan's structure is the same.
    expect(absent.counters).toEqual(declared.counters);
    expect(absent.bounds).toEqual(declared.bounds);
  });

  it('measures an empty document as zero everywhere', () => {
    const result = measureOf('');

    for (const [path, value] of numericLeaves(result)) {
      expect(value, path).toBe(0);
    }
  });
});

// ── the safe-integer contract ────────────────────────────────────────────

/** `2^53 − 1`, the last integer a JavaScript number holds exactly and safely. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Every value a numeric field must refuse, none of which may be rounded into range. */
const NOT_A_COUNT: readonly (readonly [label: string, value: unknown])[] = [
  ['negative', -1],
  ['fraction', 1.5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['2^53', 2 ** 53],
  ['string', '3'],
  ['undefined', undefined],
  ['null', null],
  ['bigint', 10n],
];

/** Every numeric field of §13's accounting object — the nested ones included. */
const ACCOUNTING_FIELDS = [
  'lines.total',
  'lines.sectionHeaders',
  'lines.keys',
  'lines.comments',
  'lines.blank',
  'lines.raw',
  'sections.total',
  'sections.recognised',
  'sections.unknown',
  'keys.total',
  'keys.inRecognisedSections',
  'keys.inUnknownSections',
  'keys.beforeFirstSection',
  'dropped',
] as const;

describe('measure — the product boundary, derived with exact arithmetic', () => {
  it('accepts exactly 2^53 − 1 and rejects one factor step past it', () => {
    // 2^53 − 1 = 6361 × 69431 × 20,394,401, so these two factors multiply to the last safe integer.
    // The expectation is BigInt's; only the code under test is numeric.
    expect(BigInt(441_650_591) * BigInt(20_394_401)).toBe(BigInt(MAX_SAFE));
    expect(checkedProduct(441_650_591, 20_394_401, 'product')).toBe(MAX_SAFE);

    expect(() => checkedProduct(441_650_591, 20_394_402, 'product')).toThrow(ResourceMeasureError);
    expect(() => checkedProduct(441_650_592, 20_394_401, 'product')).toThrow(ResourceMeasureError);
  });

  it('accepts the integer square root of 2^53 squared and rejects the next integer', () => {
    expect(94_906_265n ** 2n).toBeLessThan(BigInt(MAX_SAFE) + 1n);
    expect(94_906_266n ** 2n).toBeGreaterThan(BigInt(MAX_SAFE));

    expect(BigInt(checkedProduct(94_906_265, 94_906_265, 'square'))).toBe(94_906_265n ** 2n);
    expect(() => checkedProduct(94_906_266, 94_906_266, 'square')).toThrow(ResourceMeasureError);
  });

  it('rejects the product that lands exactly on 2^53', () => {
    // 2^53 is an exact integer but not a *safe* one: `Number.isSafeInteger` is the expression of the
    // contract, and a product that reaches it is rejected rather than published.
    expect(2 ** 26 * 2 ** 27).toBe(2 ** 53);
    expect(Number.isSafeInteger(2 ** 53)).toBe(false);

    expect(() => checkedProduct(2 ** 26, 2 ** 27, 'power')).toThrow(ResourceMeasureError);
  });

  it('names the operation and its reason in a deterministic message', () => {
    let caught: unknown = null;
    try {
      checkedProduct(2 ** 26, 2 ** 27, 'bounds.example');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ResourceMeasureError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('ResourceMeasureError');
    expect((caught as Error).message).toBe(
      'measure(): bounds.example exceeds the safe-integer range',
    );
  });
});

describe('measure — the sum boundary, derived with exact arithmetic', () => {
  it('accepts a sum that lands exactly on the maximum', () => {
    expect(checkedSum([MAX_SAFE - 1, 1], 'sum')).toBe(MAX_SAFE);
    // Zero can never cross a boundary, so it must not be reported as one.
    expect(checkedSum([MAX_SAFE, 0], 'sum')).toBe(MAX_SAFE);
  });

  it('rejects the addition that leaves the range', () => {
    expect(() => checkedSum([MAX_SAFE, 1], 'sum')).toThrow(ResourceMeasureError);
  });

  it('rejects every further addition once the range is left', () => {
    expect(() => checkedSum([MAX_SAFE, 1, 0], 'sum')).toThrow(ResourceMeasureError);
    expect(() => checkedSum([MAX_SAFE, 1, 1], 'sum')).toThrow(ResourceMeasureError);
  });

  it('rejects a multi-term sum that only crosses on a later term', () => {
    // Three terms fit exactly; the fourth is the one that leaves the range.
    expect(checkedSum([MAX_SAFE - 2, 1, 1, 0], 'sum')).toBe(MAX_SAFE);
    expect(() => checkedSum([MAX_SAFE - 2, 1, 1, 1], 'sum')).toThrow(ResourceMeasureError);
  });
});

/** The document every accounting case is built from: one of each relevant shape. */
const ACCOUNTING_TEXT =
  `[Manager]\n${MANAGER_KEYS}${COMMON_FIELD('created_at')}\n` +
  entitySection('a', `${FIELD('id')}UsingCommonColumns=1\n${POSITION(1, 1)}`) +
  relationSection('[Relation]', 'a', 'a', 'id', 'id');

/** The accounting object of `ACCOUNTING_TEXT` with one numeric field replaced. */
function accountingWith(field: string, value: unknown): SyntaxAccounting {
  const source = scanOf(ACCOUNTING_TEXT).accounting;
  const accounting: Record<string, unknown> = {
    lines: { ...source.lines },
    sections: { ...source.sections },
    keys: { ...source.keys },
    dropped: source.dropped,
  };

  const parts = field.split('.');
  const member = parts[1];
  if (member === undefined) {
    accounting[field] = value;
  } else {
    const group = accounting[parts[0] ?? ''] as Record<string, unknown>;
    group[member] = value;
  }
  return accounting as unknown as SyntaxAccounting;
}

/** A scan whose accounting is `accounting`, otherwise the scan of `ACCOUNTING_TEXT`. */
function scanWithAccounting(accounting: SyntaxAccounting): SyntaxScan {
  return { ...scanOf(ACCOUNTING_TEXT), accounting };
}

describe('measure — a numeric input outside the range is rejected, never rounded', () => {
  it('rejects every accounting field that is not a non-negative safe integer', () => {
    for (const field of ACCOUNTING_FIELDS) {
      for (const [label, value] of NOT_A_COUNT) {
        let caught: unknown = null;
        try {
          measure(scanWithAccounting(accountingWith(field, value)));
        } catch (error) {
          caught = error;
        }

        // The field is named, so a bad number cannot be mistaken for a bad document.
        expect(caught, `${field} = ${label}`).toBeInstanceOf(ResourceMeasureError);
        expect((caught as Error).message, `${field} = ${label}`).toBe(
          `measure(): accounting.${field} is not a non-negative safe integer`,
        );
      }
    }
  });

  it('accepts an in-range accounting number however large it is', () => {
    // The check is a range check: a big-but-safe total is published, not second-guessed.
    const result = measure(scanWithAccounting(accountingWith('lines.total', MAX_SAFE)));

    expect(result.counters.totalLines).toBe(MAX_SAFE);
  });

  it('keeps the document out of the message', () => {
    const marker = 'Marker_9f3b';
    const text = `[Manager]\n${MANAGER_KEYS}Note="${marker}"\n`;
    let message = '';
    try {
      measure({ ...scanOf(text), accounting: accountingWith('keys.total', -1) });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe('measure(): accounting.keys.total is not a non-negative safe integer');
    expect(message).not.toContain(marker);
    expect(message).not.toContain('PageInfo');
  });
});

describe('measure — a result it cannot prove is rejected, never published', () => {
  it('rejects an aggregate that a non-string value would turn into NaN', () => {
    // A hand-built `Fields1` entry whose value is not a string makes the code-unit sum NaN. The
    // aggregate check is what catches it, so no NaN can be published as a bound component.
    const scan = scanOf(ACCOUNTING_TEXT);
    const broken = {
      ...scan,
      sections: scan.sections.map((section) => ({
        ...section,
        entries: section.entries.map((entry) =>
          entry.kind === 'key' && entry.key === 'Fields1'
            ? { ...entry, value: 1 as unknown as string }
            : entry,
        ),
      })),
    };

    expect(() => measure(broken as unknown as SyntaxScan)).toThrow(
      'measure(): bounds.relationColumnSlotsUpperBound is not a non-negative safe integer',
    );
  });

  it('rejects a section kind the counter map does not declare', () => {
    // The result gate walks whatever the object carries, so an invented kind cannot leave an
    // unproven number inside `sectionsByKind`.
    const scan = scanOf(ACCOUNTING_TEXT);
    const first = scan.sections[0];
    const broken = {
      ...scan,
      sections: [...scan.sections, { ...first, kind: 'Nope', entries: [] }],
    };

    expect(() => measure(broken as unknown as SyntaxScan)).toThrow(
      'measure(): counters.sectionsByKind.Nope is not a non-negative safe integer',
    );
  });
});

describe('measure — unknown-section keys stay inside §13’s one counter', () => {
  it('counts only unknown-section keys, and totalKeys still holds every key line', () => {
    const text =
      // A header-region key: it is a key line, but it has no section, so the split excludes it.
      'HeaderKey=1\n' +
      `[Manager]\n${MANAGER_KEYS}` +
      // An unknown key inside a recognised section: preserved by the registry, not counted here.
      'UnknownManager=1\n' +
      entitySection('a', `UnknownEntity=1\n${FIELD('id')}\n${POSITION(1, 1)}`) +
      // An unknown section: its keys are the one population this counter holds.
      '[Mystery]\nUnknownA=1\nPName="x"\n' +
      '[View]\nPName="v"\nUnknownView=1\n';
    const result = measureOf(text);

    expect(result.counters.unknownSectionKeyOccurrences).toBe(2);
    // 1 header key + 2 Manager + 4 Entity + 2 Mystery + 2 View.
    expect(result.counters.totalKeys).toBe(11);
    expect(result.counters.unknownSectionKeyOccurrences).toBeLessThanOrEqual(
      result.counters.totalKeys,
    );
  });

  it('adds no counter: the published field set is unchanged', () => {
    expect(Object.keys(measureOf('').counters).sort()).toEqual(
      [
        'entityFieldOccurrences',
        'entityUsingCommonColumnsOccurrences',
        'fields1ValueCodeUnits',
        'fields2ValueCodeUnits',
        'managerCommonFieldOccurrences',
        'relationFields1Occurrences',
        'relationFields2Occurrences',
        'sectionsByKind',
        'totalBlankLines',
        'totalComments',
        'totalKeys',
        'totalLines',
        'totalRawLines',
        'totalSections',
        'unknownSectionKeyOccurrences',
      ].sort(),
    );
  });
});
// ── module surface ─────────────────────────────────────────────────────────

describe('src/budget — module surface and purity', () => {
  /**
   * Drop comments before the purity scan: the prose names `process.memoryUsage()` on purpose, while
   * the imports and identifiers are what the guard is about.
   */
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it('holds exactly the measurement module and its barrel', () => {
    const files = readdirSync(BUDGET_DIR)
      .filter((name) => name.endsWith('.ts'))
      .sort();

    expect(files).toEqual(['index.ts', 'measure.ts']);
  });

  // Forbidden later-stage imports, relative to `src/budget/`. `../syntax/` and `./` stay allowed.
  const FORBIDDEN_STAGE_IMPORT = /from\s+['"]\.\.\/(?!syntax\/)(?:schema|decode|semantic|json)\//;

  it('reads no clock, environment, filesystem or heap figure', () => {
    for (const file of ['index.ts', 'measure.ts']) {
      const text = stripComments(readFileSync(join(BUDGET_DIR, file), 'utf8'));
      expect(text, file).not.toMatch(/\bnode:/);
      expect(text, file).not.toMatch(/\bconsole\./);
      expect(text, file).not.toMatch(/\bprocess\./);
      expect(text, file).not.toMatch(/\bDate\.now\b/);
      expect(text, file).not.toMatch(/new Date\(/);
      expect(text, file).not.toMatch(/Math\.random\(/);
      expect(text, file).not.toMatch(/\bperformance\./);
      expect(text, file).not.toMatch(/\brequire\(/);
      expect(text, file).not.toMatch(/\bimport\(/);
      // No re-implementation of a later stage: the scan's types are the only import allowed.
      // `../syntax/` is the allowed exception; `./` is the module itself.
      expect(text, file).not.toMatch(FORBIDDEN_STAGE_IMPORT);
    }
  });

  // The guard above scans text with this pattern; prove the pattern itself fires without adding
  // a real forbidden import to product code.
  const FORBIDDEN_FIXTURES: Array<[string, boolean]> = [
    ["import { x } from '../schema/registry.js'", true],
    ["import { x } from '../decode/load.js'", true],
    ["import { x } from '../semantic/relations.js'", true],
    ["import { x } from '../json/envelope.js'", true],
    ["import type { SyntaxScan } from '../syntax/scanner.js'", false],
    ["import type { SectionKind } from '../syntax/sections.js'", false],
    ["import { measure } from './measure.js'", false],
  ];

  it('detects a forbidden relative import when one is fed to the guard', () => {
    for (const [line, forbidden] of FORBIDDEN_FIXTURES) {
      if (forbidden) {
        expect(line).toMatch(FORBIDDEN_STAGE_IMPORT);
      } else {
        expect(line).not.toMatch(FORBIDDEN_STAGE_IMPORT);
      }
    }
  });
});
