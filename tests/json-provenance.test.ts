/**
 * Stage 6-C Unit 2 — raw/span provenance and physical-line ownership across all 44 goldens
 * (`architecture.md` §4.2, §4.3, §7.1, §7.2, §9.4, §12 rules 3 and 4; `test-strategy.md` §3.6).
 *
 * **What this file is.** A regression fence for provenance, not a defect fix. Every declared `raw`
 * in every golden already comes from the line its span points at — but that fact was a reviewer's
 * memory. This file re-reads each fixture's own bytes (the same bytes `source.sha256` already pins)
 * and asserts, for all 42 schema-bearing goldens:
 *
 * 1. **Every raw token is a real slice of its own line.** The slices are computed from the line
 *    text alone: the whole line (A), the `key=value` right-hand side (B), one §7.1 Complex element
 *    (C), that element trimmed (D), a per-column name inside one quoted list element (E), a piece
 *    of the legacy `Index=name=flag,cols` payload (F), or a contiguous run of elements joined by
 *    commas (G). A raw that is none of those is a provenance claim the source does not support.
 *    `line.includes(raw)` is deliberately **not** the test: `id` occurs inside `"id,email"` and
 *    inside `"user_id"`, and `0` occurs as a legacy flag, so a substring check passes for slices
 *    that the slice check distinguishes.
 * 2. **`''` and `null` travel together.** A record with `raw: ''` has `span: null` and a
 *    defaulted/absent origin; a record with a non-empty raw has a single-line span. §4.2 says so,
 *    and a golden that broke it would be claiming text no line wrote.
 * 3. **An inferred fact cites lines and owns none.** `origin: 'inferred'` records have `span: null`
 *    and a `derivedFrom` list that points only at declared `Field` lines.
 * 4. **Key identity.** Every `keyRaw` equals the key text of its span line, and every collection's
 *    parent record sits on a line whose key is that collection's key (`Field`, `PageInfo`, …).
 * 5. **`rawElements` are the line's elements.** `rawElements[i].raw` is element *i* trimmed,
 *    `quoted` agrees with the §7.1 reading, and `elementsSeen` is the real element count.
 * 6. **Ownership.** One claim per raw-bearing record on `span.keyLine`; every claim is inside the
 *    file and in the section its enclosing record lives in (which is what catches a swapped span
 *    between two byte-identical lines); a blank or a comment line holds no raw and may not be
 *    claimed; a line claimed twice must be a key line (a `Field` line legitimately carries eleven
 *    records); the only non-key claims are six section headers and two raw lines, all evidence; and
 *    a line claimed by nobody must be a header, a blank or a comment. No phantom lines.
 * 7. **References point at declarations.** `pageReferences` resolve to `PageInfo` lines, an
 *    ambiguous reference carries every declaration in file order and no target, and a dangling one
 *    carries neither — `txt-06` is the golden that would catch a secretly selected target.
 *
 * **Deliberate exclusions, with the reason** (each one stated rather than skipped silently):
 *
 * - `JsonDiagnostic` — `span` only, no `raw`; four of them span a whole unknown section (11–13,
 *   14–18, 9–11, 11–14) and their extent is not a claim on the lines inside it.
 * - `JsonRawElement` — no span of its own; addressed by its parent's span plus `index` (checked in 5).
 * - `JsonComplexPart` (`parts[]`) — no span and no raw; it belongs to an undecodable attribute token.
 * - `JsonEffectiveColumn`, `JsonColumnCollision`, `JsonPrimaryKeyColumn`, page/domain candidates —
 *   `span` only; they restate a line another record already claims.
 * - The 65 `raw: ''` + `span: null` records — nothing to claim (checked as a group in 2).
 * - `enc-04` and `hst-02` — `schema: null`, so they contribute no raw record at all; they are
 *   skipped and never given fabricated provenance.
 * - `keys.parsed` / `keys.preservedRaw` — not derivable without the key registry (C1's boundary).
 * - User-domain references and R28's empty relation slot exist only in inline tests, not in any
 *   golden, so their arms are not asserted here.
 *
 * Two source lines are byte-identical in `sem-08` (`PName="twin"` at 7 and 12), so swapping those
 * two spans cannot be caught by content alone; the section-ordinal check below is what catches it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import type {
  FixtureCodec,
  LineSlices,
  SourceCounts,
  SourceRecord,
} from './helpers/source-counts.js';
import { countSource, decodeBytes, lineSlices } from './helpers/source-counts.js';

const SYNTHETIC_DIR = fileURLToPath(new URL('./fixtures/synthetic/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/json-goldens/', import.meta.url));
const HELPERS_DIR = fileURLToPath(new URL('./helpers/', import.meta.url));

/** The bytes of the three byte fixtures that decode, in the codec their module declares. */
const BYTE_SOURCES: Readonly<
  Record<string, { readonly bytes: Uint8Array; readonly codec: FixtureCodec }>
> = {
  'enc-03': { bytes: enc03.BYTES, codec: enc03.ENCODING },
  'enc-05': { bytes: enc05.BYTES, codec: enc05.ENCODING },
  'hst-05': { bytes: hst05.BYTES, codec: hst05.ENCODING },
};

const GOLDEN_IDS: readonly string[] = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.expected.json'))
  .map((name) => name.replace('.expected.json', ''))
  .sort();

/** A JSON object, as read from a golden: structural narrowing only, no envelope import. */
type Node = Record<string, unknown>;

function isRecord(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringAt(node: Node, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' ? value : null;
}
function numberAt(node: Node, key: string): number | null {
  const value = node[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function arrayAt(node: Node, key: string): readonly unknown[] {
  const value = node[key];
  return Array.isArray(value) ? value : [];
}
/** A span if the node carries one, `null` when it is absent, `null`-valued or not a span. */
interface Span {
  readonly sectionIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly keyLine: number;
}
/** Read a span out of a value that *is* the span object (`derivedFrom[]`, candidate spans). */
function spanOfNode(value: unknown): Span | null {
  if (!isRecord(value)) return null;
  const sectionIndex = numberAt(value, 'sectionIndex');
  const startLine = numberAt(value, 'startLine');
  const endLine = numberAt(value, 'endLine');
  const keyLine = numberAt(value, 'keyLine');
  if (sectionIndex === null || startLine === null || endLine === null || keyLine === null) {
    return null;
  }
  return { sectionIndex, startLine, endLine, keyLine };
}
function spanAt(node: Node, key = 'span'): Span | null {
  const value = node[key];
  if (!isRecord(value)) return null;
  const sectionIndex = numberAt(value, 'sectionIndex');
  const startLine = numberAt(value, 'startLine');
  const endLine = numberAt(value, 'endLine');
  const keyLine = numberAt(value, 'keyLine');
  if (sectionIndex === null || startLine === null || endLine === null || keyLine === null) {
    return null;
  }
  return { sectionIndex, startLine, endLine, keyLine };
}
function hasKey(node: Node, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

function specOf(id: string): FixtureSpec {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`golden ${id} has no catalog entry`);
  return spec;
}

/** The fixture's decoded text, or `null` when nothing decodes it (the two fatal goldens). */
function textOf(id: string): string | null {
  const spec = specOf(id);
  if (spec.fixtureClass === 'synthetic') {
    return decodeBytes(readFileSync(join(SYNTHETIC_DIR, spec.file)), 'utf-8');
  }
  const source = BYTE_SOURCES[spec.id];
  return source === undefined ? null : decodeBytes(source.bytes, source.codec);
}

function readGolden(id: string): Node {
  const parsed: unknown = JSON.parse(readFileSync(join(GOLDEN_DIR, `${id}.expected.json`), 'utf8'));
  if (!isRecord(parsed)) throw new Error(`golden ${id} is not an object`);
  return parsed;
}

/** The seven slice classes a `raw` token may belong to, in the order they are tried. */
type RawClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

/**
 * Which class one raw token is a slice of, or `null` when it is not a slice of this line at all.
 *
 * The order matters: for a single-element key the right-hand side *is* the element, so B is tried
 * before C, and C before D (an element with no padding is its own trimmed form).
 */
function classOf(raw: string, line: LineSlices): RawClass | null {
  if (raw === line.whole) return 'A';
  if (line.rhs !== null && raw === line.rhs) return 'B';
  if (line.elements.some((element) => raw === element.raw)) return 'C';
  if (line.elements.some((element) => raw === element.trimmed)) return 'D';
  if (line.elements.some((element) => element.innerSlices.includes(raw))) return 'E';
  if (line.legacySlices.includes(raw)) return 'F';
  for (let from = 0; from < line.elements.length; from += 1) {
    for (let to = from + 1; to < line.elements.length; to += 1) {
      const run = line.elements
        .slice(from, to + 1)
        .map((element) => element.raw)
        .join(',');
      if (raw === run) return 'G';
    }
  }
  return null;
}

/**
 * Where each non-default class is allowed to appear.
 *
 * Membership alone is not enough for the slices that only *some* records publish: an unquoted copy
 * of a quoted element (`Main` for `"Main"`) is still a slice of the line, because the inner text of
 * a quoted element is a legitimate class-E slice on an `IndexInfo` column line. Pinning which record
 * kinds publish which granularity is what makes a wrong-granularity copy visible — and it mirrors
 * the measured corpus rather than inventing a rule.
 */
const CLASS_HOME: Readonly<Partial<Record<RawClass, RegExp>>> = {
  A: /^\$\.unsupported\[\d+\]$/,
  E: /\.indexes\.canonical\[\d+\]\.columns\[\d+\]$/,
  F: /\.indexes\.legacy\[\d+\]\./,
  G: /\.fields\[\d+\]\.additionalOption$/,
};

/**
 * Where a `Field`'s declared tail begins: §7.2's nine documented elements, then the rest.
 *
 * `additionalOption` is the remainder of the line, comma-joined, so its raw must be *every* element
 * from here to the end. Membership alone cannot say that: a tail truncated to its last element is
 * still a slice of the same line (class C, or G when it spans several).
 */
const FIELD_TAIL_START = 9;

/** What the walk measured, so the population itself is asserted rather than assumed. */
interface Tallies {
  declared: number;
  defaulted: number;
  inferred: number;
  keyRaw: number;
  rawElements: number;
  resolvedPageRefs: number;
  danglingPageRefs: number;
  ambiguousPageRefs: number;
  systemDomainRefs: number;
  userDomainRefs: number;
  claims: number;
  unclaimedLines: number;
  sharedLines: number;
  /** The largest number of records claiming one line (a `Field` line is the worst case). */
  maxClaims: number;
  /** Claims on a section-header line (evidence for an unknown section, and the subtype header). */
  headerClaims: number;
  /** Claims on a raw line (a continuation or a malformed construct, kept as evidence). */
  rawClaims: number;
  classes: Record<RawClass, number>;
}

interface Audit {
  readonly violations: readonly string[];
  readonly tallies: Tallies;
  /** Every span that covers more than one line, with the path that carried it. */
  readonly multiLine: readonly {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
}

/** One raw-bearing record found by the walk, kept with its path for the violation message. */
interface Claim {
  readonly path: string;
  readonly keyLine: number;
}

/**
 * Walk every declared raw/span pair of one golden and assert the seven properties above.
 *
 * Pure over `(golden, counts)`: every violation is returned as a string, so the negative tests can
 * corrupt an in-memory copy and prove the guard notices.
 */
function auditGolden(id: string, golden: Node, counts: SourceCounts): Audit {
  const violations: string[] = [];
  const fail = (where: string, message: string): void => {
    violations.push(`${id}: ${where}: ${message}`);
  };
  const records = new Map<number, SourceRecord>();
  for (const record of counts.records) records.set(record.line, record);
  const sliceCache = new Map<number, LineSlices>();
  const slicesOf = (line: number): LineSlices => {
    const cached = sliceCache.get(line);
    if (cached !== undefined) return cached;
    const slices = lineSlices(recordOf(line).text);
    sliceCache.set(line, slices);
    return slices;
  };
  const recordOf = (line: number): SourceRecord => {
    const record = records.get(line);
    if (record === undefined) throw new Error(`${id}: line ${String(line)} is outside the file`);
    return record;
  };
  /** The section ordinal a line belongs to: headers seen up to and including it (§4.1). */
  const sectionIndexOf = (line: number): number => {
    let index = 0;
    for (const record of counts.records) {
      if (record.line > line) break;
      if (record.kind === 'header') index += 1;
    }
    return index;
  };
  const classes: Record<RawClass, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  const tallies: Tallies = {
    declared: 0,
    defaulted: 0,
    inferred: 0,
    keyRaw: 0,
    rawElements: 0,
    resolvedPageRefs: 0,
    danglingPageRefs: 0,
    ambiguousPageRefs: 0,
    systemDomainRefs: 0,
    userDomainRefs: 0,
    claims: 0,
    unclaimedLines: 0,
    sharedLines: 0,
    maxClaims: 0,
    headerClaims: 0,
    rawClaims: 0,
    classes,
  };
  const claims: Claim[] = [];
  const multiLine: { path: string; startLine: number; endLine: number }[] = [];

  /** Every non-null span in the document must be inside the file and consistent with its section. */
  const checkSpan = (where: string, span: Span, label = 'span'): boolean => {
    if (
      span.keyLine < 1 ||
      span.keyLine > counts.lines ||
      span.startLine < 1 ||
      span.endLine > counts.lines
    ) {
      fail(
        where,
        `${label} ${String(span.keyLine)} is outside the file (1..${String(counts.lines)})`,
      );
      return false;
    }
    const derived = sectionIndexOf(span.keyLine);
    if (span.sectionIndex !== derived) {
      fail(
        where,
        `${label}.sectionIndex ${String(span.sectionIndex)} but line ${String(span.keyLine)} is in section ${String(derived)}`,
      );
    }
    return true;
  };

  const visit = (node: Node, path: string, parentSection: number | null): void => {
    const origin = stringAt(node, 'origin');
    const raw = stringAt(node, 'raw');
    const carriesSpan = hasKey(node, 'span');
    const span = spanAt(node);

    // §4.2: origin, raw and span travel together.
    if (raw !== null && raw !== '') {
      tallies.declared += 1;
      if (origin !== null && origin !== 'declared') {
        // A defaulted or absent record has no text; one that carries text claims a line it lacks.
        fail(path, `a non-empty raw carries origin ${JSON.stringify(origin)}`);
      } else if (!carriesSpan || span === null) {
        fail(path, `declared raw ${JSON.stringify(raw)} has no span`);
      } else if (!checkSpan(path, span)) {
        // A span outside the file is already reported; there is no line to slice.
      } else {
        // The record claims this line whatever the slice check says: ownership is about the claim.
        claims.push({ path, keyLine: span.keyLine });
        tallies.claims += 1;
        if (parentSection !== null && span.sectionIndex !== parentSection) {
          // Two byte-identical lines exist (`sem-08`'s `PName="twin"`), so content alone cannot
          // catch a swapped span: the enclosing record's section is what does.
          fail(
            path,
            `span is in section ${String(span.sectionIndex)} but its parent is in ${String(parentSection)}`,
          );
        }
        if (span.startLine !== span.keyLine || span.endLine !== span.keyLine) {
          fail(
            path,
            `raw-bearing span ${String(span.startLine)}..${String(span.endLine)} is not a single line`,
          );
        } else if (classOf(raw, slicesOf(span.keyLine)) === null) {
          fail(
            path,
            `raw ${JSON.stringify(raw)} is not a slice of line ${String(span.keyLine)} ${JSON.stringify(
              recordOf(span.keyLine).text.slice(0, 80),
            )}`,
          );
        } else {
          const matched = classOf(raw, slicesOf(span.keyLine)) as RawClass;
          const home = CLASS_HOME[matched];
          const elements = slicesOf(span.keyLine).elements;
          const expectedTail = /\.fields\[\d+\]\.additionalOption$/.test(path)
            ? elements
                .slice(FIELD_TAIL_START)
                .map((element) => element.raw)
                .join(',')
            : null;
          if (home !== undefined && !home.test(path)) {
            fail(path, `a class-${matched} slice is not published by this record kind`);
          } else if (expectedTail !== null && raw !== expectedTail) {
            fail(
              path,
              `additionalOption must be the declared tail ${JSON.stringify(expectedTail)}, not ${JSON.stringify(raw)}`,
            );
          } else {
            classes[matched] += 1;
          }
        }
      }
    } else if (raw === '') {
      tallies.defaulted += 1;
      if (span !== null || !carriesSpan) fail(path, `empty raw must carry span: null`);
      if (origin !== 'defaulted' && origin !== 'absent') {
        fail(path, `empty raw must be defaulted or absent, not ${JSON.stringify(origin)}`);
      }
    } else if (hasKey(node, 'raw') && node['raw'] === null) {
      // `JsonSubtypeScalar` allows `raw: null` for an absent scalar; it must have no span either.
      if (span !== null) fail(path, 'raw: null must carry span: null');
    }

    if (origin === 'inferred') {
      tallies.inferred += 1;
      if (span !== null) fail(path, 'an inferred value must not carry a span');
      if (hasKey(node, 'raw')) fail(path, 'an inferred value must not carry a raw');
      const derived = arrayAt(node, 'derivedFrom');
      if (derived.length === 0) fail(path, 'an inferred value must cite its inputs');
      derived.forEach((entry, index) => {
        if (!isRecord(entry)) {
          fail(path, `derivedFrom[${String(index)}] is not a span`);
          return;
        }
        const source = spanOfNode(entry);
        if (source === null) {
          fail(path, `derivedFrom[${String(index)}] is not a span`);
          return;
        }
        checkSpan(path, source, `derivedFrom[${String(index)}]`);
        const line = records.get(source.keyLine);
        if (line === undefined) return;
        if (line.kind !== 'key' || lineSlices(line.text).key !== 'Field') {
          fail(
            path,
            `derivedFrom[${String(index)}] cites a non-Field line ${String(source.keyLine)}`,
          );
        }
      });
    }

    // Key identity: `keyRaw` is the source side and must equal the line's key text verbatim.
    const keyRaw = stringAt(node, 'keyRaw');
    if (keyRaw !== null) {
      tallies.keyRaw += 1;
      if (span === null) fail(path, 'keyRaw without a span');
      else {
        const key = slicesOf(span.keyLine).key;
        if (key !== keyRaw) {
          fail(path, `keyRaw ${JSON.stringify(keyRaw)} but line key is ${JSON.stringify(key)}`);
        }
      }
    }

    // `rawElements` are the line's own elements, addressed by the parent's span + index.
    if (hasKey(node, 'rawElements') && span !== null) {
      const elements = slicesOf(span.keyLine).elements;
      const rawElements = arrayAt(node, 'rawElements');
      const elementsSeen = numberAt(node, 'elementsSeen');
      if (elementsSeen !== null && elementsSeen !== elements.length) {
        fail(
          path,
          `elementsSeen ${String(elementsSeen)} but the line has ${String(elements.length)} elements`,
        );
      }
      rawElements.forEach((entry, index) => {
        tallies.rawElements += 1;
        if (!isRecord(entry)) {
          fail(path, `rawElements[${String(index)}] is not an object`);
          return;
        }
        const element = elements[index];
        if (element === undefined) {
          fail(path, `rawElements[${String(index)}] has no source element`);
          return;
        }
        if (stringAt(entry, 'raw') !== element.trimmed) {
          fail(
            path,
            `rawElements[${String(index)}].raw ${JSON.stringify(stringAt(entry, 'raw'))} != element ${JSON.stringify(element.trimmed)}`,
          );
        }
        if (entry['quoted'] !== element.quoted) {
          fail(path, `rawElements[${String(index)}].quoted disagrees with §7.1`);
        }
        if (numberAt(entry, 'index') !== index) {
          fail(path, `rawElements[${String(index)}].index is not ${String(index)}`);
        }
      });
    }
  };

  /** Recurse, except into the containers that carry raw without a span of their own. */
  const walk = (value: unknown, path: string, parentSection: number | null): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${path}[${String(index)}]`, parentSection));
      return;
    }
    if (!isRecord(value)) return;
    visit(value, path, parentSection);
    const own = spanAt(value);
    if (own !== null && own.endLine > own.startLine) {
      multiLine.push({ path, startLine: own.startLine, endLine: own.endLine });
    }
    const section = own === null ? parentSection : own.sectionIndex;
    for (const [key, child] of Object.entries(value)) {
      // `rawElements` is handled above; `parts` (JsonComplexPart) has neither raw nor span.
      if (key === 'rawElements' || key === 'parts') continue;
      walk(child, `${path}.${key}`, section);
    }
  };
  walk(golden, '$', null);

  // Ownership: one claim per raw-bearing record, on its own key line.
  const perLine = new Map<number, number>();
  for (const claim of claims) perLine.set(claim.keyLine, (perLine.get(claim.keyLine) ?? 0) + 1);
  tallies.maxClaims = Math.max(0, ...perLine.values());
  for (const [line, count] of perLine) {
    const record = recordOf(line);
    // Only a line that carries text can be claimed: a blank or a comment holds no raw at all.
    if (record.kind === 'blank' || record.kind === 'comment') {
      fail('ownership', `line ${String(line)} is a ${record.kind} line, which holds no raw`);
    }
    if (record.kind === 'header') tallies.headerClaims += 1;
    if (record.kind === 'raw') tallies.rawClaims += 1;
    if (count > 1) {
      tallies.sharedLines += 1;
      if (record.kind !== 'key') {
        fail(
          'ownership',
          `line ${String(line)} is claimed ${String(count)} times but is a ${record.kind}`,
        );
      }
    }
  }
  for (const record of counts.records) {
    if (perLine.has(record.line)) continue;
    tallies.unclaimedLines += 1;
    if (record.kind !== 'header' && record.kind !== 'blank' && record.kind !== 'comment') {
      fail('ownership', `line ${String(record.line)} is a ${record.kind} line nobody claims`);
    }
  }

  // References point at declarations, never at the placement that asked.
  const schema = golden['schema'];
  if (!isRecord(schema)) {
    fail('$', 'a count-bearing golden must carry a schema');
    return { violations, tallies, multiLine };
  }
  const pages = arrayAt(schema, 'pages').filter(isRecord);
  const declarations = pages.map((page, index) => {
    const name = stringAt(page, 'name');
    const span = spanAt(page);
    if (name === null || span === null) {
      fail(`schema.pages[${String(index)}]`, 'a declaration needs a name and a span');
      return { name: '', keyLine: -1 };
    }
    if (slicesOf(span.keyLine).key !== 'PageInfo') {
      fail(`schema.pages[${String(index)}]`, 'a declaration is not on a PageInfo line');
    }
    return { name, keyLine: span.keyLine };
  });
  arrayAt(schema, 'pageReferences')
    .filter(isRecord)
    .forEach((reference, index) => {
      const where = `schema.pageReferences[${String(index)}]`;
      const declared = stringAt(reference, 'declared') ?? '';
      const status = stringAt(reference, 'status');
      const span = spanAt(reference);
      const matches = declarations.filter(
        (candidate) =>
          candidate.name !== '' && candidate.name.toLowerCase() === declared.toLowerCase(),
      );
      const resolvedPage = reference['resolvedPage'];
      const candidates = arrayAt(reference, 'candidates').filter(isRecord);
      if (span !== null) {
        const slices = slicesOf(span.keyLine);
        const element = slices.elements.find((candidate) => candidate.inner === declared);
        if (element === undefined && !declared.includes('\\')) {
          fail(
            where,
            `declared ${JSON.stringify(declared)} is not the element on line ${String(span.keyLine)}`,
          );
        }
      }
      const candidateLines = candidates.map((candidate) => spanAt(candidate)?.keyLine ?? -1);
      if (status === 'resolved') {
        tallies.resolvedPageRefs += 1;
        if (matches.length !== 1)
          fail(where, `resolved but ${String(matches.length)} declarations match`);
        if (!isRecord(resolvedPage)) {
          fail(where, 'resolved without a resolvedPage');
        } else {
          const target = spanAt(resolvedPage);
          if (stringAt(resolvedPage, 'name') !== matches[0]?.name) {
            fail(where, 'resolvedPage.name is not the declaration that matched');
          }
          if (target === null || target.keyLine !== matches[0]?.keyLine) {
            fail(where, 'resolvedPage.span is not the declaration line');
          } else if (slicesOf(target.keyLine).key !== 'PageInfo') {
            fail(where, 'resolvedPage is not on a PageInfo line');
          }
        }
        if (candidates.length !== 0) fail(where, 'a resolved reference must carry no candidates');
      } else if (status === 'ambiguous') {
        tallies.ambiguousPageRefs += 1;
        if (matches.length < 2)
          fail(where, `ambiguous but only ${String(matches.length)} declaration matches`);
        if (resolvedPage !== null) fail(where, 'an ambiguous reference must not name a target');
        if (candidates.length !== matches.length) {
          fail(
            where,
            `${String(candidates.length)} candidates for ${String(matches.length)} declarations`,
          );
        }
        candidates.forEach((candidate, position) => {
          const target = spanAt(candidate);
          if (stringAt(candidate, 'name') !== matches[position]?.name) {
            fail(
              where,
              `candidates[${String(position)}] is not declaration ${String(position)} in file order`,
            );
          }
          if (target === null || target.keyLine !== matches[position]?.keyLine) {
            fail(where, `candidates[${String(position)}] is not its declaration line`);
          } else if (slicesOf(target.keyLine).key !== 'PageInfo') {
            fail(where, `candidates[${String(position)}] is not on a PageInfo line`);
          }
        });
      } else if (status === 'dangling') {
        tallies.danglingPageRefs += 1;
        if (matches.length !== 0)
          fail(where, `dangling but ${String(matches.length)} declarations match`);
        if (resolvedPage !== null) fail(where, 'a dangling reference must not name a target');
        if (candidates.length !== 0) fail(where, 'a dangling reference must carry no candidates');
      } else {
        fail(where, `unknown status ${JSON.stringify(status)}`);
      }
      // A candidate may never sit on the reference's own line.
      if (candidateLines.includes(span?.keyLine ?? -1)) {
        fail(where, 'a candidate points at the reference line');
      }
    });

  const domains = arrayAt(schema, 'domains').filter(isRecord);
  arrayAt(schema, 'domainReferences')
    .filter(isRecord)
    .forEach((reference, index) => {
      const where = `schema.domainReferences[${String(index)}]`;
      const dataType = stringAt(reference, 'dataType') ?? '';
      const span = spanAt(reference);
      const classification = reference['classification'];
      const kind = isRecord(classification) ? stringAt(classification, 'kind') : null;
      if (kind === 'system') tallies.systemDomainRefs += 1;
      else if (kind === 'user') tallies.userDomainRefs += 1;
      else fail(where, `unknown classification ${JSON.stringify(kind)}`);
      if (span !== null) {
        const element = slicesOf(span.keyLine).elements.find(
          (candidate) => candidate.inner === dataType,
        );
        if (element === undefined) {
          fail(
            where,
            `dataType ${JSON.stringify(dataType)} is not the element on line ${String(span.keyLine)}`,
          );
        }
      } else {
        fail(where, 'a domain reference needs the Field line it came from');
      }
      // A user-domain arm must name a declaration; no golden has one, and this keeps that honest.
      if (kind === 'user') {
        const named = isRecord(classification) ? (stringAt(classification, 'name') ?? '') : '';
        if (
          !domains.some((domain) => stringAt(domain, 'name')?.toLowerCase() === named.toLowerCase())
        ) {
          fail(where, 'a user-domain reference names no declared domain');
        }
      }
    });

  return { violations, tallies, multiLine };
}

/** Which fixture each golden audits against, and the audit of every count-bearing golden. */
interface Audited {
  readonly id: string;
  readonly golden: Node;
  readonly counts: SourceCounts;
  readonly audit: Audit;
}
function auditAll(): readonly Audited[] {
  const audited: Audited[] = [];
  for (const id of GOLDEN_IDS) {
    const golden = readGolden(id);
    if (golden['completeness'] === null) continue;
    const text = textOf(id);
    if (text === null) throw new Error(`${id} has counts but no decodable source`);
    const counts = countSource(text);
    audited.push({ id, golden, counts, audit: auditGolden(id, golden, counts) });
  }
  return audited;
}

describe('json provenance — every raw/span pair comes from its own line (stage 6-C unit 2)', () => {
  it('audits all 44 goldens: 42 schema-bearing, 2 with no schema', () => {
    const schemaBearing = GOLDEN_IDS.filter((id) => readGolden(id)['schema'] !== null);
    const fatal = GOLDEN_IDS.filter((id) => readGolden(id)['schema'] === null);
    expect(schemaBearing).toHaveLength(42);
    expect(fatal).toEqual(['enc-04', 'hst-02']);
    // The fatal ones contribute no raw record at all — never a fabricated one.
    for (const id of fatal) {
      const golden = readGolden(id);
      expect(golden['completeness'], id).toBeNull();
      expect(textOf(id), id).toBeNull();
    }
  });
  it('reports no violation on the committed goldens', () => {
    const audited = auditAll();
    const violations = audited.flatMap((entry) => entry.audit.violations);
    expect(violations).toEqual([]);
    expect(audited).toHaveLength(42);
  });
  it('pins the population and the slice-class distribution', () => {
    const audited = auditAll();
    const sum = (pick: (tallies: Tallies) => number): number =>
      audited.reduce((total, entry) => total + pick(entry.audit.tallies), 0);
    // The headline population: every record that carries a `raw` member and a `span` member.
    // 1380 of them are declared (non-empty raw, a line) and 65 are `raw: ''` with `span: null`.
    expect(sum((tallies) => tallies.declared)).toBe(1380);
    expect(sum((tallies) => tallies.defaulted)).toBe(65);
    expect(sum((tallies) => tallies.declared + tallies.defaulted)).toBe(1445);
    // Synthesised facts: no span, no raw, inputs cited.
    expect(sum((tallies) => tallies.inferred)).toBe(40);
    expect(sum((tallies) => tallies.keyRaw)).toBe(144);
    // 391 element records across 103 parents (positions 215, pages 164, domains 4, commonFields 8):
    // every one of them is element *i* of its parent's line, interpreted per §7.1.
    expect(sum((tallies) => tallies.rawElements)).toBe(391);
    // Page references: 56 resolved, 3 dangling, 1 ambiguous — the whole 60.
    expect(sum((tallies) => tallies.resolvedPageRefs)).toBe(56);
    expect(sum((tallies) => tallies.danglingPageRefs)).toBe(3);
    expect(sum((tallies) => tallies.ambiguousPageRefs)).toBe(1);
    // Domains: one system reference; a user-domain reference exists only in inline tests.
    expect(sum((tallies) => tallies.systemDomainRefs)).toBe(1);
    expect(sum((tallies) => tallies.userDomainRefs)).toBe(0);
    // The seven classes, in the documented precedence.
    const classes = {
      A: sum((tallies) => tallies.classes.A),
      B: sum((tallies) => tallies.classes.B),
      C: sum((tallies) => tallies.classes.C),
      D: sum((tallies) => tallies.classes.D),
      E: sum((tallies) => tallies.classes.E),
      F: sum((tallies) => tallies.classes.F),
      G: sum((tallies) => tallies.classes.G),
    };
    expect(classes).toEqual({
      A: 16,
      B: 462,
      C: 879,
      D: 8,
      E: 10,
      F: 4,
      G: 1,
    });
    // Every declared record is in exactly one class, so the classes partition the declared set.
    expect(Object.values(classes).reduce((total, count) => total + count, 0)).toBe(1380);
  });
  it('confines the multi-line spans to the four unknown-section diagnostics', () => {
    const audited = auditAll();
    const spans = audited.flatMap((entry) =>
      entry.audit.multiLine.map((span) => ({ id: entry.id, golden: entry.golden, ...span })),
    );
    // No raw-bearing record may cover several lines: a `raw` is a slice of one line (§4.3).
    expect(spans.map((span) => [span.id, span.path, span.startLine, span.endLine])).toEqual([
      ['hst-04', '$.diagnostics[0]', 11, 13],
      ['hst-04', '$.diagnostics[1]', 14, 18],
      ['txt-04', '$.diagnostics[2]', 9, 11],
      ['txt-07', '$.diagnostics[0]', 11, 14],
    ]);
    for (const span of spans) {
      // A section extent is a diagnostic fact; the evidence for the same section spans its header
      // line only, so the extent must not be read as a claim on the lines inside it.
      const index = Number(/\[(\d+)\]$/.exec(span.path)?.[1]);
      const diagnostics = arrayAt(span.golden, 'diagnostics').filter(isRecord);
      expect(stringAt(diagnostics[index] ?? {}, 'code'), span.path).toBe('S_UNKNOWN_SECTION');
    }
  });
  it('pins the two granularities of a column list and the ownership shape', () => {
    const audited = auditAll();
    const byId = new Map(audited.map((entry) => [entry.id, entry]));
    // `JsonIndexInfo.columns[]` is a per-column name without quotes; `JsonRelationColumn.raw` is the
    // whole element, so `txt-03`'s two columns both carry `raw: "a,b"` — one element, two records.
    const txt03 = byId.get('txt-03');
    if (txt03 === undefined) throw new Error('txt-03 is missing');
    const schema = txt03.golden['schema'];
    if (!isRecord(schema)) throw new Error('txt-03 lost its schema');
    const relations = arrayAt(schema, 'relations').filter(isRecord);
    const columns = relations.flatMap((relation) =>
      ['fromColumns', 'toColumns'].flatMap((key) => {
        const list = relation[key];
        return isRecord(list) ? arrayAt(list, 'columns').filter(isRecord) : [];
      }),
    );
    expect(columns.map((column) => stringAt(column, 'raw'))).toEqual([
      '"a,b"',
      '"a,b"',
      '"x,y"',
      '"x,y"',
    ]);
    expect(columns.map((column) => stringAt(column, 'pname'))).toEqual(['a', 'b', 'x', 'y']);
    // 19 relation columns exist, none of them empty: R28's slot shape is inline-tested only.
    const allColumns = audited.flatMap((entry) => {
      const entrySchema = entry.golden['schema'];
      if (!isRecord(entrySchema)) return [];
      return arrayAt(entrySchema, 'relations').flatMap((relation) => {
        if (!isRecord(relation)) return [];
        return ['fromColumns', 'toColumns'].flatMap((key) => {
          const list = relation[key];
          return isRecord(list) ? arrayAt(list, 'columns').filter(isRecord) : [];
        });
      });
    });
    expect(allColumns).toHaveLength(19);
    expect(allColumns.filter((column) => column['empty'] === true)).toHaveLength(0);
    // Ownership: a `Field` line is the worst case (the record plus ten elements).
    // The worst case in the corpus: `fmt-01` line 11 (`Field="ユーザーID",…`) carries the JsonField
    // record plus its ten elements — eleven claims on one line, and that line is a key line.
    const fmt01 = byId.get('fmt-01');
    if (fmt01 === undefined) throw new Error('fmt-01 is missing');
    expect(fmt01.audit.tallies.maxClaims).toBe(11);
    expect(fmt01.audit.tallies.sharedLines).toBeGreaterThan(0);
    // 254 lines in the corpus are claimed by more than one record, and every one is a key line.
    expect(audited.reduce((total, entry) => total + entry.audit.tallies.sharedLines, 0)).toBe(254);
    // Every claim outside a key line is evidence: six section headers (`hst-04` ×3, `txt-04`,
    // `txt-07`, and `sem-05`'s subtype header) and the two raw lines (`hst-04:17`, `val-08:9`).
    expect(audited.reduce((total, entry) => total + entry.audit.tallies.headerClaims, 0)).toBe(6);
    expect(audited.reduce((total, entry) => total + entry.audit.tallies.rawClaims, 0)).toBe(2);
    // … and no blank or comment line is ever claimed, so the unclaimed set is the rest of them.
    expect(audited.reduce((total, entry) => total + entry.audit.tallies.unclaimedLines, 0)).toBe(
      audited.reduce(
        (total, entry) =>
          total +
          entry.counts.headers +
          entry.counts.blank +
          entry.counts.comments -
          entry.audit.tallies.headerClaims,
        0,
      ),
    );
  });
  it('detects a corrupted raw, a shifted span and a broken ownership partition', () => {
    const id = 'fmt-01';
    const golden = readGolden(id);
    const text = textOf(id);
    if (text === null) throw new Error('fmt-01 must decode');
    const counts = countSource(text);
    // The clean copy is silent, so every failure below comes from the corruption alone.
    expect(auditGolden(id, golden, counts).violations).toEqual([]);
    const corrupt = (mutate: (copy: Node) => void): readonly string[] => {
      const copy = structuredClone(golden);
      mutate(copy);
      return auditGolden(id, copy, counts).violations;
    };
    const at = (root: Node, path: readonly (string | number)[]): Node => {
      let current: unknown = root;
      for (const step of path) {
        if (typeof step === 'number') {
          if (!Array.isArray(current)) throw new Error('not an array');
          current = current[step];
        } else {
          if (!isRecord(current)) throw new Error('not an object');
          current = current[step];
        }
      }
      if (!isRecord(current)) throw new Error('not an object');
      return current;
    };

    // Class B: wrapping a value in text that no line wrote is the case a substring check misses —
    // the line still *contains* the original value, so only a slice comparison notices.
    const wrapped = corrupt((copy) => {
      const field = at(copy, ['schema', 'objects', 0, 'fields', 0]);
      field['raw'] = `X=${String(field['raw'])},`;
    });
    expect(wrapped.some((message) => message.includes('is not a slice of line'))).toBe(true);

    // Class C: a truncated element is a slice no rule produces.
    const truncated = corrupt((copy) => {
      const position = at(copy, ['schema', 'objects', 0, 'positions', 0]);
      const page = at(position, ['page']);
      page['raw'] = String(page['raw']).slice(0, -1);
    });
    expect(truncated.some((message) => message.includes('is not a slice of line'))).toBe(true);

    // The granularity rule: an unquoted copy of a quoted element is a slice (class E) but only an
    // `IndexInfo` column publishes one, so a page reference may not use it.
    const unquoted = corrupt((copy) => {
      const position = at(copy, ['schema', 'objects', 0, 'positions', 0]);
      const page = at(position, ['page']);
      page['raw'] = String(page['value']);
    });
    expect(unquoted.some((message) => message.includes('not published by this record kind'))).toBe(
      true,
    );

    // Class D: an extra space is padding the element does not have.
    const padded = corrupt((copy) => {
      const option = at(copy, ['schema', 'objects', 0, 'indexes', 'canonical', 0, 'option']);
      option['raw'] = `${String(option['raw'])}  `;
    });
    expect(padded.some((message) => message.includes('is not a slice of line'))).toBe(true);

    // Class E: the whole quoted list (`id,email`) is not one column name, and no class publishes it.
    const wholeList = corrupt((copy) => {
      const column = at(copy, ['schema', 'objects', 0, 'indexes', 'canonical', 0, 'columns', 0]);
      column['raw'] = 'id,email';
    });
    expect(wholeList.some((message) => message.includes('is not a slice of line'))).toBe(true);

    // Class F: the legacy payload's pieces are delimited on their own; a flag+columns run is not one.
    const legacy = readGolden('fmt-02');
    const legacyText = textOf('fmt-02');
    if (legacyText === null) throw new Error('fmt-02 must decode');
    const legacyCounts = countSource(legacyText);
    expect(auditGolden('fmt-02', legacy, legacyCounts).violations).toEqual([]);
    const legacyRun = structuredClone(legacy);
    const legacySchema = legacyRun['schema'];
    if (!isRecord(legacySchema)) throw new Error('fmt-02 lost its schema');
    const legacyObject = arrayAt(legacySchema, 'objects').filter(isRecord)[0];
    if (legacyObject === undefined) throw new Error('fmt-02 has no object');
    const indexes = legacyObject['indexes'];
    if (!isRecord(indexes)) throw new Error('fmt-02 lost its indexes');
    const legacyIndex = arrayAt(indexes, 'legacy').filter(isRecord)[0];
    if (legacyIndex === undefined) throw new Error('fmt-02 has no legacy index');
    const legacyName = at(legacyIndex, ['name']);
    legacyName['raw'] = '0,id';
    expect(
      auditGolden('fmt-02', legacyRun, legacyCounts).violations.some((message) =>
        message.includes('is not a slice of line'),
      ),
    ).toBe(true);

    // Class G: a `Field` tail must be the whole run, not its last element alone.
    const val04 = readGolden('val-04');
    const val04Text = textOf('val-04');
    if (val04Text === null) throw new Error('val-04 must decode');
    const val04Counts = countSource(val04Text);
    expect(auditGolden('val-04', val04, val04Counts).violations).toEqual([]);
    const val04Copy = structuredClone(val04);
    const val04Schema = val04Copy['schema'];
    if (!isRecord(val04Schema)) throw new Error('val-04 lost its schema');
    const val04Field = arrayAt(
      arrayAt(val04Schema, 'objects').filter(isRecord)[0] ?? {},
      'fields',
    )[0];
    if (!isRecord(val04Field)) throw new Error('val-04 has no field');
    const tail = at(val04Field, ['additionalOption']);
    tail['raw'] = '"追加事項"';
    expect(
      auditGolden('val-04', val04Copy, val04Counts).violations.some((message) =>
        message.includes('must be the declared tail'),
      ),
    ).toBe(true);

    // A shifted span: the raw then belongs to a different line.
    const shifted = corrupt((copy) => {
      const field = at(copy, ['schema', 'objects', 0, 'fields', 0]);
      field['span'] = { sectionIndex: 2, startLine: 12, endLine: 12, keyLine: 12 };
    });
    expect(shifted.some((message) => message.includes('is not a slice of line 12'))).toBe(true);

    // A phantom line: a span past the end of the file.
    const phantom = corrupt((copy) => {
      const field = at(copy, ['schema', 'objects', 0, 'fields', 0]);
      field['span'] = {
        sectionIndex: 2,
        startLine: counts.lines + 1,
        endLine: counts.lines + 1,
        keyLine: counts.lines + 1,
      };
    });
    expect(phantom.some((message) => message.includes('outside the file'))).toBe(true);

    // A claim on a header line: the blank line 2 is nobody's to claim.
    const headerClaim = corrupt((copy) => {
      const page = at(copy, ['schema', 'pages', 0]);
      page['span'] = { sectionIndex: 1, startLine: 2, endLine: 2, keyLine: 2 };
    });
    expect(headerClaim.some((message) => message.includes('which holds no raw'))).toBe(true);

    // The section ordinal is what catches two byte-identical lines (sem-08's `PName="twin"`).
    const sem08 = readGolden('sem-08');
    const sem08Text = textOf('sem-08');
    if (sem08Text === null) throw new Error('sem-08 must decode');
    const sem08Counts = countSource(sem08Text);
    const swapped = structuredClone(sem08);
    const entity = at(swapped, ['schema', 'objects', 0, 'pname']);
    const view = at(swapped, ['schema', 'objects', 1, 'pname']);
    expect(entity['raw']).toBe(view['raw']);
    entity['span'] = view['span'];
    const swapViolations = auditGolden('sem-08', swapped, sem08Counts).violations;
    expect(swapViolations.some((message) => message.includes('its parent is in'))).toBe(true);
  });
  it('detects broken inferred provenance and a defaulted record with text', () => {
    const id = 'fmt-01';
    const golden = readGolden(id);
    const text = textOf(id);
    if (text === null) throw new Error('fmt-01 must decode');
    const counts = countSource(text);
    const auditOf = (mutate: (copy: Node) => void): readonly string[] => {
      const copy = structuredClone(golden);
      mutate(copy);
      return auditGolden(id, copy, counts).violations;
    };
    const objects = (copy: Node): readonly Node[] => {
      const schema = copy['schema'];
      if (!isRecord(schema)) throw new Error('no schema');
      return arrayAt(schema, 'objects').filter(isRecord);
    };
    // `fmt-01` has an inferred primary key, so the three corruptions below have a real subject.
    expect(
      objects(structuredClone(golden)).some((object) => {
        const primary = object['primaryKey'];
        return isRecord(primary) && primary['status'] === 'inferred';
      }),
    ).toBe(true);

    // An inferred fact with a span of its own invents a line it never came from.
    const withSpan = auditOf((copy) => {
      const primary = objects(copy)
        .map((object) => object['primaryKey'])
        .find((candidate) => isRecord(candidate) && candidate['status'] === 'inferred');
      if (!isRecord(primary)) throw new Error('no inferred key');
      primary['span'] = { sectionIndex: 2, startLine: 11, endLine: 11, keyLine: 11 };
    });
    expect(withSpan.some((message) => message.includes('must not carry a span'))).toBe(true);

    // … and one that cites nothing cannot be checked at all.
    const noInputs = auditOf((copy) => {
      const primary = objects(copy)
        .map((object) => object['primaryKey'])
        .find((candidate) => isRecord(candidate) && candidate['status'] === 'inferred');
      if (!isRecord(primary)) throw new Error('no inferred key');
      primary['derivedFrom'] = [];
    });
    expect(noInputs.some((message) => message.includes('must cite its inputs'))).toBe(true);

    // … and one that cites a line which is not a `Field` line.
    const wrongInput = auditOf((copy) => {
      const primary = objects(copy)
        .map((object) => object['primaryKey'])
        .find((candidate) => isRecord(candidate) && candidate['status'] === 'inferred');
      if (!isRecord(primary)) throw new Error('no inferred key');
      primary['derivedFrom'] = [{ sectionIndex: 2, startLine: 7, endLine: 7, keyLine: 7 }];
    });
    expect(wrongInput.some((message) => message.includes('cites a non-Field line'))).toBe(true);

    // A defaulted value with text claims a token nobody wrote.
    const defaultedWithText = auditOf((copy) => {
      for (const object of objects(copy)) {
        const columns = object['effectiveColumns'];
        if (!isRecord(columns)) continue;
        const using = columns['usingCommonColumns'];
        if (isRecord(using) && using['origin'] === 'defaulted') {
          using['raw'] = '1';
          return;
        }
      }
      throw new Error('no defaulted usingCommonColumns');
    });
    expect(
      defaultedWithText.some((message) => message.includes('a non-empty raw carries origin')),
    ).toBe(true);
  });
  it('detects a secretly selected target on the ambiguous page reference (txt-06)', () => {
    const id = 'txt-06';
    const golden = readGolden(id);
    const text = textOf(id);
    if (text === null) throw new Error('txt-06 must decode');
    const counts = countSource(text);
    expect(auditGolden(id, golden, counts).violations).toEqual([]);
    const reference = (copy: Node): Node => {
      const schema = copy['schema'];
      if (!isRecord(schema)) throw new Error('no schema');
      const references = arrayAt(schema, 'pageReferences').filter(isRecord);
      const first = references[0];
      if (first === undefined) throw new Error('no page reference');
      return first;
    };
    const clean = reference(structuredClone(golden));
    expect(clean['status']).toBe('ambiguous');
    expect(clean['resolvedPage']).toBeNull();
    const candidates = arrayAt(clean, 'candidates').filter(isRecord);
    expect(candidates).toHaveLength(2);

    // The arm a reader is most likely to get wrong: publish the first declaration as the target.
    const resolved = structuredClone(golden);
    const resolvedReference = reference(resolved);
    resolvedReference['status'] = 'resolved';
    resolvedReference['resolvedPage'] = {
      name: 'Main',
      span: { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 },
    };
    const resolvedViolations = auditGolden(id, resolved, counts).violations;
    expect(resolvedViolations.some((message) => message.includes('must not name a target'))).toBe(
      false,
    );
    expect(resolvedViolations.some((message) => message.includes('declarations match'))).toBe(true);

    // A candidate list truncated to one hides a declaration the file wrote.
    const truncated = structuredClone(golden);
    const truncatedReference = reference(truncated);
    truncatedReference['candidates'] = [candidates[0]];
    expect(
      auditGolden(id, truncated, counts).violations.some((message) =>
        message.includes('candidates for'),
      ),
    ).toBe(true);

    // A candidate on the reference line would point at the placement, not the declaration.
    const misplaced = structuredClone(golden);
    const misplacedReference = reference(misplaced);
    const firstCandidate = arrayAt(misplacedReference, 'candidates').filter(isRecord)[0];
    if (firstCandidate === undefined) throw new Error('no candidate');
    firstCandidate['span'] = { sectionIndex: 2, startLine: 10, endLine: 10, keyLine: 10 };
    expect(
      auditGolden(id, misplaced, counts).violations.some((message) =>
        message.includes('is not its declaration line'),
      ),
    ).toBe(true);
  });
  it('keeps the reader independent: no src/ import, no split-based slicing, no pipeline', () => {
    // C1's guard covers the reader and its own test; this one adds the new files, because a second
    // implementation that quietly imported the first would defeat the point.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const files = [
      join(HELPERS_DIR, 'source-counts.ts'),
      fileURLToPath(new URL('./json-provenance.test.ts', import.meta.url)),
    ];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/from\s+['"][^'"]*src\//);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*fixture-text\.js['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*classified\.js['"]/);
      expect(code, file).not.toMatch(/\.split\s*\(/);
    }
  });
});
