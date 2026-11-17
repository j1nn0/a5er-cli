/**
 * Stage 6 — golden envelopes (`architecture.md` §12, §13; `test-strategy.md` §3.6, §8, §14 stage 6).
 *
 * **What this file covers.** All **44** committed fixtures whose bytes exist in the repository:
 * the 39 `synthetic` entries and the 5 `bytes` entries of `tests/helpers/fixture-registry.ts`.
 * Each one is staged exactly as the reader will see it, run through the real four stages
 * (`loadSource` → `scanSource` → `classify` → `derivePartialSemantics`), serialized with
 * `command: 'inspect'`, have its temp path scrubbed to `<tmp>/<id>.a5er`, and compared
 * structurally with `tests/fixtures/json-goldens/<id>.expected.json`.
 *
 * **Deliberate exclusions (7 registry entries).** They are not runnable as one committed file:
 *
 * - `hst-03` — a generated 1 MiB single line (byte-limit fixture);
 * - `hst-06` — a generated family of empty/whitespace-only/no-section documents;
 * - `res-01` — a generated capped read;
 * - `res-03` — a generated family of three multi-MiB limit breaches;
 * - `res-02` — needs the injected short-read IO seam that does not exist yet (G4);
 * - `fuzz-01` — seeded mutants, not a fixed document;
 * - `imm-01` — a catalog-wide harness with no bytes of its own.
 *
 * `hst-04` is large but committed and deterministic, so it is included; its 4 KiB hostile header
 * is preserved verbatim in its golden on purpose (§4.3, L2).
 *
 * **How the goldens were authored.** Every file was derived from the fixture text plus the
 * documented stage model (`docs/architecture.md` §4–§9, §12–§13, `docs/format-coverage.md`, the
 * fixture catalog) through a one-off authoring projection that imports **nothing** from
 * `src/json/`; `serialize()` was never invoked to produce a golden. Diagnostics/status/counts/
 * evidence are the Integration record (the model stage whose output §12 projects), and the schema
 * block is a separate projection of the classification and semantics. This file then compares the
 * serializer against those authored expectations, so a serializer regression shows up as a diff
 * rather than being blessed. Where the catalog disagrees with the full pipeline, the difference is
 * recorded in the test that observes it (see `enc-03`/`enc-05` below and `enc-05`'s key count).
 *
 * **The seven relation goldens (stage 6-A).** `fmt-01`, `sem-01`, `sem-03`, `txt-01`, `txt-02`,
 * `txt-03` and `txt-09` were the only goldens the relation-provenance repair could touch, and each
 * was re-derived from its own fixture: the `[Relation]`/`[Relationship]` header line for the record
 * anchor, and the `RelationType1/2` and `Cardinarity1/2` lines for the slots and the retained
 * declarations. The per-file line table lives in the acceptance case at the end of this file, so a
 * reader can check every number against the fixture instead of against this serializer.
 *
 * **The 41 object-bearing goldens (stage 6-B).** Every entity, view and subtype gained one member,
 * `scalars`, so all 41 goldens that project an object were edited by hand — 54 objects, 62
 * declarations. Each record was authored from its own fixture too: the fixture line for the key
 * text, the value text and the line number, and the registry's key type for the decoded token
 * (`string` for `PName`/`LName`, `escaped` for `Comment`). The three goldens that carry no object
 * (`enc-04`, `hst-02`, `sem-09`) were not touched, and no fixture declares one of these keys
 * twice, so every `scalars` here is the section's own single-declaration history, not an empty
 * placeholder. `serialize()` was not used to author any of it (test-strategy §3.6).
 *
 * **The 42 schema-bearing goldens (stage 6-B unit 3).** Every envelope with a `schema` gained two
 * members, `pageReferences` and `domainReferences`, so those 42 goldens were edited by hand — 60
 * page references and 1 domain reference. Each record was authored from its own fixture: the
 * `Position`/`Field` line for the reference span and raw text, the `PageInfo`/`DomainInfo` line for
 * every declaration it names. Not one of them came from `serialize()`: the whole list is re-derived
 * from the fixture text plus P9/P11/P12 (`resolved`/`ambiguous`/`dangling`; `@`-system domains and
 * the ten of P12; an unmatched type stays plain and is therefore absent), then compared with the
 * serializer by the sweep above. `enc-04` and `hst-02` are `failed` with `schema: null` and were not
 * touched. `sem-09` and `sem-10` declare no `Position` at all, so their lists are empty, not
 * missing. The per-file line table lives in the acceptance case at the end of this file.
 *
 * **Comparison rules.** After `JSON.parse`, objects are compared structurally and arrays keep
 * file order; key arrays are compared recursively as well, so construction order is deterministic
 * without a textual diff. `source.path` is the only scrubbed field; `source.sha256` is asserted
 * against the staged bytes, so editing a fixture fails loudly instead of silently regenerating a
 * golden. Golden files are stored pretty-printed for review (2-space); their formatting is not
 * part of the comparison. `serialize` is called without a `limits` override, which is exactly the
 * documented default (an explicit `limits: undefined` is not representable under
 * `exactOptionalPropertyTypes`), so `limits.maxBytes` is `DEFAULT_LIMITS.maxBytes`.
 * part of the comparison.
 *
 * **Catalog supersessions, preserved not bent.** `enc-03`/`enc-05` carry decode-only catalog
 * expectations. Their full-pipeline envelopes add `V_MISSING_REQUIRED_KEY` (error: no `PageInfo`)
 * and `V_DANGLING_PAGE` (warning: `Main` is never declared), and both are `degraded`; the registry
 * entries stay untouched (`tests/validate-integration.test.ts` §"decode-only" documents the same
 * delta). This file asserts the three-code envelope.
 *
 * **Counts come from the catalog, once.** Every `completeness` number below is compared with
 * `spec.expectation.counts` (`tests/helpers/fixture-registry.ts`), with no per-fixture override: the
 * catalog is the authored expectation and a disagreement must show up as a failed assertion rather
 * than be papered over here. `enc-05`'s `keys.total` was the one stale number (3 for a five-line
 * UTF-16LE document that writes two `key=value` lines); it now says `2`, counted from the decoded
 * bytes in `tests/fixtures-content.test.ts` and re-derived again in the enc-05 case below.
 *
 * **`exitPolicy`.** Unit 1 deliberately does not emit `exitPolicy` in the envelope (the §12 field
 * list has no such member), so it is not in any golden. The policy remains Integration data and is
 * asserted at that level in `tests/validate-integration.test.ts`; this file still proves the
 * envelope's `status` is exactly `failed`/`degraded`/`ok` as derived from severities.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type {
  JsonDomainReference,
  JsonEnvelope,
  JsonObject,
  JsonPageReference,
  JsonSpan,
} from '../src/json/index.js';
import { serialize } from '../src/json/index.js';
import { classify } from '../src/schema/registry.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { IntegrationInput } from '../src/validate/index.js';
import { integrate, isLoadedInput } from '../src/validate/index.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';
import { assertCodes } from './helpers/assert-codes.js';
import { classificationOf } from './helpers/classified.js';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/json-goldens/', import.meta.url));

/**
 * The projected keys, per kind — this repo's statement of the registry's key sets, kept in the test
 * so a golden cannot gain a key the format does not define for that section. The three `JsonValue`
 * slots and the single-fact slots are projected the same way, so they are listed together.
 */
const OBJECT_SCALAR_KEYS: Readonly<Record<JsonObject['kind'], readonly string[]>> = {
  entity: ['PName', 'LName', 'Comment', 'UsingCommonColumns'],
  view: ['PName', 'LName', 'Comment', 'Query', 'LNameByComment'],
  subtype: ['PName', 'SharedMode', 'CompleteCategory', 'ZOrder'],
};

/** The nine `[Relation]` keys with a typed slot, in registry order. */
const RELATION_SCALAR_KEYS: readonly string[] = [
  'PName',
  'RelationType1',
  'RelationType2',
  'Cardinarity1',
  'Cardinarity2',
  'Entity1',
  'Entity2',
  'Fields1',
  'Fields2',
];

/** The five committed byte fixtures, as their modules export them. */
const BYTE_FIXTURES: Readonly<Record<string, Uint8Array>> = {
  'enc-03': enc03.BYTES,
  'enc-04': enc04.BYTES,
  'enc-05': enc05.BYTES,
  'hst-02': hst02.BYTES,
  'hst-05': hst05.BYTES,
};

/** Every fixture with committed bytes: 39 synthetic + 5 bytes. */
const GOLDEN_CASES: readonly FixtureSpec[] = FIXTURES.filter(
  (spec) => spec.fixtureClass === 'synthetic' || spec.fixtureClass === 'bytes',
);

/** `enc-03`/`enc-05` catalog codes are decode-only; the envelope is the three-code superset. */
const DECODE_ONLY = new Set(['enc-03', 'enc-05']);

interface Staged {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  cleanup(): void;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Stage one fixture: the synthetic helper copies by ID, the byte modules are written as-is. */
function stagedFor(spec: FixtureSpec): Staged {
  if (spec.fixtureClass === 'synthetic') {
    const staged = stage(spec.id);
    return {
      path: staged.path,
      sha256: staged.sha256,
      sizeBytes: staged.sizeBytes,
      cleanup: staged.cleanup,
    };
  }
  if (spec.fixtureClass === 'bytes') {
    const bytes = BYTE_FIXTURES[spec.id];
    if (bytes === undefined) throw new Error(`${spec.id} has no committed bytes`);
    const directory = mkdtempSync(join(tmpdir(), 'a5er-json-golden-'));
    const path = join(directory, `${spec.id}.a5er`);
    writeFileSync(path, bytes);
    return {
      path,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      cleanup() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }
  throw new Error(`${spec.id} is a ${spec.fixtureClass} fixture and has no golden`);
}

/** The four real stages, or the rejected load they stopped at. */
function inputFromPath(path: string): IntegrationInput {
  const load = loadSource(path);
  if (!load.ok) return { load };
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return {
    load,
    scan,
    classification,
    semantics: derivePartialSemantics(classification),
  };
}

function goldenPath(id: string): string {
  return join(GOLDEN_DIR, `${id}.expected.json`);
}

function readGolden(id: string): JsonEnvelope {
  return JSON.parse(readFileSync(goldenPath(id), 'utf8')) as JsonEnvelope;
}

/** Replace the only volatile field: the staging directory around the fixture's file name. */
function withScrubbedPath(envelope: JsonEnvelope, id: string): JsonEnvelope {
  if (envelope.source === null) return envelope;
  return {
    ...envelope,
    source: { ...envelope.source, path: `<tmp>/${id}.a5er` },
  };
}

interface FixtureRun {
  readonly staged: Staged;
  readonly input: IntegrationInput;
  readonly envelope: JsonEnvelope;
  readonly golden: JsonEnvelope;
}

/** Stage, run, serialize and parse one golden; always cleans the staging directory. */
function withFixture(spec: FixtureSpec, run: (result: FixtureRun) => void): void {
  const staged = stagedFor(spec);
  try {
    const input = inputFromPath(staged.path);
    const envelope = serialize(input, { command: 'inspect', path: staged.path });
    run({ staged, input, envelope, golden: readGolden(spec.id) });
  } finally {
    staged.cleanup();
  }
}

/** Status is a function of severities alone (§12 rule 1, `test-strategy.md` §8). */
function statusOf(
  diagnostics: readonly { readonly severity: string }[],
): 'ok' | 'degraded' | 'failed' {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'fatal')) return 'failed';
  if (
    diagnostics.some(
      (diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning',
    )
  ) {
    return 'degraded';
  }
  return 'ok';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSpan(span: unknown, path: string): void {
  if (!isRecord(span)) throw new Error(`${path}: not a span object`);
  for (const key of ['sectionIndex', 'startLine', 'endLine', 'keyLine'] as const) {
    expect(Number.isInteger(span[key]), `${path}.${key}`).toBe(true);
  }
  const sectionIndex = span['sectionIndex'] as number;
  const startLine = span['startLine'] as number;
  const endLine = span['endLine'] as number;
  const keyLine = span['keyLine'] as number;
  expect(sectionIndex, `${path}.sectionIndex`).toBeGreaterThanOrEqual(0);
  expect(startLine, `${path}.startLine`).toBeGreaterThanOrEqual(1);
  expect(endLine, `${path}.endLine`).toBeGreaterThanOrEqual(startLine);
  expect(keyLine, `${path}.keyLine`).toBeGreaterThanOrEqual(startLine);
  expect(keyLine, `${path}.keyLine`).toBeLessThanOrEqual(endLine);
}

/** Key order is part of the contract; deep equality alone would ignore it. */
function assertKeyOrder(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, `${path}.length`).toBe(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      assertKeyOrder(actual[index], expected[index], `${path}[${String(index)}]`);
    }
    return;
  }
  if (!isRecord(actual) || !isRecord(expected)) return;
  expect(Object.keys(actual), `${path}: key order`).toEqual(Object.keys(expected));
  for (const key of Object.keys(expected)) {
    assertKeyOrder(actual[key], expected[key], `${path}.${key}`);
  }
}

function walk(
  node: unknown,
  path: string,
  visit: (record: Record<string, unknown>, at: string) => void,
): void {
  if (Array.isArray(node)) {
    for (const [index, child] of node.entries()) {
      walk(child, `${path}[${String(index)}]`, visit);
    }
    return;
  }
  if (!isRecord(node)) return;
  visit(node, path);
  for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`, visit);
}

/**
 * Invariants every envelope must hold, independently of any one golden:
 * declared/defaulted provenance, span shape, inferred keys, and the unknown/unsupported arms.
 */
function assertEnvelopeInvariants(envelope: JsonEnvelope): void {
  walk(envelope, 'envelope', (record, path) => {
    if ('span' in record && record['span'] !== null) assertSpan(record['span'], `${path}.span`);
    if (
      typeof record['origin'] === 'string' &&
      'value' in record &&
      'raw' in record &&
      'span' in record
    ) {
      if (record['origin'] === 'defaulted') {
        expect(record['raw'], `${path}.raw`).toBe('');
        expect(record['span'], `${path}.span`).toBeNull();
      }
      if (record['origin'] === 'declared') {
        expect(record['span'], `${path}.span`).not.toBeNull();
      }
    }
  });

  for (const object of envelope.schema?.objects ?? []) {
    if (object.kind === 'entity') {
      const key = object.primaryKey;
      if (key.status === 'inferred' || key.status === 'partial') {
        expect(key.origin, 'primaryKey.origin').toBe('inferred');
        expect(key.span, 'primaryKey.span').toBeNull();
        expect(key.derivedFrom.length, 'primaryKey.derivedFrom').toBeGreaterThan(0);
        expect(key.columns.length, 'primaryKey.columns').toBe(key.value.length);
        if (key.status === 'partial') {
          expect(key.invalidOrdinals.length, 'primaryKey.partial').toBeGreaterThan(0);
        }
      }
      expect(object.effectiveColumns.columns.length, 'effectiveColumns = declared + common').toBe(
        object.effectiveColumns.declared.length + object.effectiveColumns.common.length,
      );
    }
    if (object.kind === 'view') {
      expect(object.effectiveColumns.status, 'view columns').toBe('unknown');
      expect(Object.prototype.hasOwnProperty.call(object.effectiveColumns, 'columns')).toBe(false);
    }
    if (object.kind === 'subtype') {
      expect(object.membership.status, 'subtype membership').toBe('unsupported');
      expect(Object.prototype.hasOwnProperty.call(object.membership, 'members')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(object.membership, 'entities')).toBe(false);
    }

    // Every declaration of a projected object scalar is retained, in file order, on its own line;
    // the slots hold the last-wins selection, which must be one of those declarations (§12 rule 4).
    const objectWhere = `objects[section ${String(object.sectionIndex)}]`;
    const scalarKeys = OBJECT_SCALAR_KEYS[object.kind];
    const scalarLines = object.scalars.map((scalar) => scalar.span.startLine);
    expect(scalarLines, `${objectWhere}.scalars: file order`).toEqual(
      [...scalarLines].sort((left, right) => left - right),
    );
    for (const scalar of object.scalars) {
      expect(scalarKeys, `${objectWhere}.scalars.key`).toContain(scalar.key);
      expect(scalar.origin, `${objectWhere}.scalars.origin`).toBe('declared');
      expect(scalar.span.sectionIndex, `${objectWhere}.scalars.span`).toBe(object.sectionIndex);
      expect(scalar.keyRaw.length, `${objectWhere}.scalars.keyRaw`).toBeGreaterThan(0);
      // `raw` is the value text exactly as written and may legitimately be empty (`Query=`,
      // `UsingCommonColumns=`): an empty token is still a declaration with a line, so it is kept.
      // Nothing in this corpus writes one (checked across all 44 fixtures), and the record is
      // compared against the authored golden anyway, so no `raw.length > 0` rule is asserted here.
      expect(typeof scalar.raw, `${objectWhere}.scalars.raw`).toBe('string');
      // One source line, one record: no projected scalar is repeated as an attribute.
      const alsoAttribute = object.attributes.some(
        (attribute) =>
          attribute.key === scalar.key && attribute.span?.startLine === scalar.span.startLine,
      );
      expect(alsoAttribute, `${objectWhere}.attributes: ${scalar.key} reported twice`).toBe(false);
    }
    for (const [key, slot] of [
      ['PName', object.pname],
      ['LName', object.lname],
      ['Comment', object.comment],
    ] as const) {
      if (!scalarKeys.includes(key) || slot === null) continue;
      expect(slot.span, `${objectWhere}.${key}: selected value has a span`).not.toBeNull();
      const declared = object.scalars.some(
        (scalar) =>
          scalar.key === key &&
          scalar.raw === slot.raw &&
          scalar.span.startLine === slot.span?.startLine &&
          scalar.value.status === 'decoded' &&
          scalar.value.value === slot.value,
      );
      expect(declared, `${objectWhere}.${key}: selected value is a retained declaration`).toBe(
        true,
      );
    }

    // The single-fact slots are the same rule in a different shape: a *declared* fact must be one of
    // the retained records (raw + line), and a defaulted or absent one must have no record at all.
    const checkFact = (
      key: string,
      label: string,
      raw: string | null,
      span: JsonSpan | null,
    ): void => {
      if (!scalarKeys.includes(key)) return;
      const retained = object.scalars.filter((scalar) => scalar.key === key);
      if (span === null) {
        expect(retained, `${objectWhere}.${label}: an undeclared fact has no record`).toEqual([]);
        return;
      }
      const declared = retained.some(
        (scalar) => scalar.raw === raw && scalar.span.startLine === span.startLine,
      );
      expect(declared, `${objectWhere}.${label}: selected fact is a retained declaration`).toBe(
        true,
      );
    };
    if (object.kind === 'entity') {
      const columns = object.effectiveColumns.usingCommonColumns;
      checkFact('UsingCommonColumns', 'usingCommonColumns', columns.raw, columns.span);
    }
    if (object.kind === 'view') {
      checkFact('Query', 'query', object.queryRaw ?? '', object.querySpan);
      checkFact(
        'LNameByComment',
        'lnameByComment',
        object.lnameByComment.raw,
        object.lnameByComment.span,
      );
    }
    if (object.kind === 'subtype') {
      checkFact('SharedMode', 'sharedMode', object.sharedMode.raw, object.sharedMode.span);
      checkFact(
        'CompleteCategory',
        'completeCategory',
        object.completeCategory.raw,
        object.completeCategory.span,
      );
      checkFact('ZOrder', 'zOrder', object.zOrder.raw, object.zOrder.span);
    }
  }

  for (const relation of envelope.schema?.relations ?? []) {
    // §12 rule 3: a relation exists in the file, so it carries a span — its own, not a value's.
    const where = `relations[section ${String(relation.sectionIndex)}]`;
    assertSpan(relation.span, `${where}.span`);
    expect(relation.span.sectionIndex, `${where}.span.sectionIndex`).toBe(relation.sectionIndex);

    // Every declaration is retained, in file order, on its own line inside the section.
    const lines = relation.scalars.map((scalar) => scalar.span.startLine);
    expect(lines, `${where}.scalars: file order`).toEqual(
      [...lines].sort((left, right) => left - right),
    );
    for (const scalar of relation.scalars) {
      expect(RELATION_SCALAR_KEYS, `${where}.scalars.key`).toContain(scalar.key);
      expect(scalar.origin, `${where}.scalars.origin`).toBe('declared');
      expect(scalar.span.sectionIndex, `${where}.scalars.span`).toBe(relation.sectionIndex);
      expect(scalar.keyRaw.length, `${where}.scalars.keyRaw`).toBeGreaterThan(0);
      // Same policy as above: `Fields1=` is a legal empty token and must not be filtered out.
      expect(typeof scalar.raw, `${where}.scalars.raw`).toBe('string');
    }
    // One record per declaration: the history never projects the same line twice.
    expect(new Set(lines).size, `${where}.scalars: one record per line`).toBe(lines.length);

    // Last-wins selects one of those declarations: a slot that matches none would be a fabricated
    // provenance, and a slot without a span would break §12 rule 3.
    const slots = [
      relation.pname,
      relation.relationType1,
      relation.relationType2,
      relation.cardinarity1,
      relation.cardinarity2,
    ];
    for (const slot of slots) {
      if (slot === null) continue;
      expect(slot.span, `${where}: selected value has a span`).not.toBeNull();
      const declared = relation.scalars.some(
        (scalar) =>
          scalar.raw === slot.raw &&
          scalar.span.startLine === slot.span?.startLine &&
          scalar.value.status === 'decoded' &&
          scalar.value.value === slot.value,
      );
      expect(declared, `${where}: selected value is a retained declaration`).toBe(true);
    }

    // The four declaration-shaped slots: their raw text and line must be the terminal occurrence's,
    // and a key the fixture never declares must have neither a slot nor a record.
    const checkRecord = (
      key: string,
      label: string,
      slot: { readonly raw: string; readonly span: JsonSpan } | null,
    ): void => {
      const retained = relation.scalars.filter((scalar) => scalar.key === key).at(-1);
      if (slot === null) {
        expect(retained, `${where}.${label}: no declaration, no record`).toBeUndefined();
        return;
      }
      expect(retained?.raw, `${where}.${label}: terminal declaration`).toBe(slot.raw);
      expect(retained?.span.startLine, `${where}.${label}: terminal line`).toBe(
        slot.span.startLine,
      );
    };
    checkRecord('Entity1', 'from', relation.from);
    checkRecord('Entity2', 'to', relation.to);
    checkRecord('Fields1', 'fromColumns', relation.fromColumns);
    checkRecord('Fields2', 'toColumns', relation.toColumns);
  }
}

function entities(envelope: JsonEnvelope): Extract<JsonObject, { kind: 'entity' }>[] {
  return (envelope.schema?.objects ?? []).filter(
    (object): object is Extract<JsonObject, { kind: 'entity' }> => object.kind === 'entity',
  );
}

function views(envelope: JsonEnvelope): Extract<JsonObject, { kind: 'view' }>[] {
  return (envelope.schema?.objects ?? []).filter(
    (object): object is Extract<JsonObject, { kind: 'view' }> => object.kind === 'view',
  );
}

function subtypes(envelope: JsonEnvelope): Extract<JsonObject, { kind: 'subtype' }>[] {
  return (envelope.schema?.objects ?? []).filter(
    (object): object is Extract<JsonObject, { kind: 'subtype' }> => object.kind === 'subtype',
  );
}

function first<T>(items: readonly T[], label: string): T {
  const value = items.at(0);
  if (value === undefined) throw new Error(`${label} is empty`);
  return value;
}

function codesOf(envelope: JsonEnvelope): string[] {
  return envelope.diagnostics.map((diagnostic) => diagnostic.code);
}

function lineOf(span: JsonSpan | null): number | null {
  return span === null ? null : span.startLine;
}

describe('json goldens — full-envelope sweep', () => {
  it('has exactly one golden for each of the 44 committed synthetic and byte fixtures', () => {
    const expected = GOLDEN_CASES.map((spec) => `${spec.id}.expected.json`).sort();
    const actual = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.expected.json'))
      .sort();

    expect(expected).toHaveLength(44);
    expect(actual).toEqual(expected);
  });

  for (const spec of GOLDEN_CASES) {
    it(`${spec.id}: envelope matches the authored golden`, () => {
      withFixture(spec, ({ staged, input, envelope, golden }) => {
        const scrubbed = withScrubbedPath(envelope, spec.id);
        const integration = integrate(input);

        // Deterministic construction order, not just deep equality.
        expect(scrubbed).toEqual(golden);
        assertKeyOrder(scrubbed, golden, spec.id);
        assertEnvelopeInvariants(scrubbed);
        expect(JSON.parse(JSON.stringify(golden))).toEqual(golden);

        // Frozen constants and the requested command.
        // Exactly §12's ten fields: `exitPolicy` is deliberately not one of them (Unit 1).
        expect(Object.keys(golden)).toEqual([
          'contractVersion',
          'tool',
          'command',
          'status',
          'source',
          'limits',
          'schema',
          'unsupported',
          'diagnostics',
          'completeness',
        ]);
        expect(golden.contractVersion).toBe('0.1.0');
        expect(golden.tool).toEqual({ name: '@j1nn0/a5er-cli', version: '0.1.0' });
        expect(golden.command).toBe('inspect');
        expect(golden.limits).toEqual({ maxBytes: 64 * 1024 * 1024, truncated: false });

        // Status is Integration's, and is also exactly what severities imply.
        expect(golden.status).toBe(integration.status);
        expect(golden.status).toBe(statusOf(golden.diagnostics));
        expect(envelope.status).toBe(integration.status);

        // Diagnostics: one ordered list, exact catalog multiset (with the decode-only delta).
        expect(golden.diagnostics).toEqual(envelope.diagnostics);
        for (const diagnostic of golden.diagnostics) {
          expect('span' in diagnostic).toBe(true);
          expect(diagnostic.message.length).toBeGreaterThan(0);
          expect(typeof diagnostic.details).toBe('object');
          if (diagnostic.span !== null) assertSpan(diagnostic.span, `${spec.id}.diagnostic`);
        }
        if (DECODE_ONLY.has(spec.id)) {
          assertCodes(
            codesOf(golden),
            [...spec.expectation.codes, 'V_DANGLING_PAGE', 'V_MISSING_REQUIRED_KEY'],
            `${spec.id} codes`,
          );
          expect(golden.status).toBe('degraded');
        } else {
          assertCodes(codesOf(golden), spec.expectation.codes, `${spec.id} codes`);
          expect(golden.status).toBe(spec.expectation.status);
        }

        // Evidence is Integration's, in its order (line order, then its own tie-breaks).
        expect(golden.unsupported).toEqual(envelope.unsupported);
        let previousLine = -1;
        for (const evidence of golden.unsupported) {
          expect(evidence.span.startLine).toBeGreaterThanOrEqual(previousLine);
          previousLine = evidence.span.startLine;
          expect(evidence.reason.length).toBeGreaterThan(0);
        }

        // Source identity and the scrubbed path.
        if (golden.source === null) {
          expect(envelope.source).toBeNull();
          expect(golden.schema).toBeNull();
          expect(golden.completeness).toBeNull();
          expect(golden.unsupported).toEqual([]);
          expect(golden.status).toBe('failed');
        } else {
          expect(envelope.source?.path).toBe(staged.path);
          expect(golden.source.path).toBe(`<tmp>/${spec.id}.a5er`);
          expect(golden.source.path).not.toBe(staged.path);
          // A fixture edit changes the staged hash and fails here instead of regenerating a golden.
          expect(golden.source.sha256).toBe(staged.sha256);
          expect(golden.source.sizeBytes).toBe(staged.sizeBytes);
          expect(golden.source.sha256).toBe(sha256(readFileSync(staged.path)));
          expect(golden.source.format.effective).toBe(
            golden.source.format.known ? golden.source.format.declared : null,
          );
          if (isLoadedInput(input)) {
            expect(golden.source.encoding).toEqual({ ...input.load.source.encoding });
            expect(golden.source.format).toEqual({
              declared: input.load.source.format,
              effective: input.scan.format.known ? input.load.source.format : null,
              known: input.scan.format.known,
            });
          }
        }

        // Counts: the envelope's, reconciled, and the catalog's concrete numbers.
        // The identity asserted here is §13's two-term one (`parsed + preservedRaw == total`), plus
        // the line ledger. `unsupported` is never a term: that list projects records already inside
        // `preservedRaw` (unknown sections and keys) together with constructs that own no counter at
        // all (`multiline-value` on a non-line value, `unsupported-position`, `subtype-membership`),
        // so adding it double-counts — `hst-04` has 5 sections against 6 evidence records.
        // `docs/architecture.md` §12 rule 2 and §13 state the same identity.
        if (golden.completeness !== null) {
          const completeness = golden.completeness;
          expect(golden.status).not.toBe('failed');
          expect(golden.schema).not.toBeNull();
          expect(completeness.dropped).toBe(0);
          expect(completeness.lines.dropped).toBe(0);
          expect(completeness.lines.accounted).toBe(completeness.lines.total);
          expect(completeness.sections.parsed + completeness.sections.preservedRaw).toBe(
            completeness.sections.total,
          );
          expect(completeness.keys.parsed + completeness.keys.preservedRaw).toBe(
            completeness.keys.total,
          );
          expect(completeness.sections.unknown).toBe(completeness.sections.preservedRaw);

          // Straight from the catalog: no per-fixture override anywhere in this file.
          const expected = spec.expectation.counts;
          expect(completeness.sections.total).toBe(expected.sections.total);
          expect(completeness.sections.parsed).toBe(expected.sections.parsed);
          expect(completeness.sections.preservedRaw).toBe(expected.sections.preservedRaw);
          expect(completeness.keys.total).toBe(expected.keys.total);
          expect(completeness.keys.parsed).toBe(expected.keys.parsed);
          expect(completeness.keys.preservedRaw).toBe(expected.keys.preservedRaw);
        }

        // The golden file is valid JSON and ends with a newline; formatting is not contractual.
        const text = readFileSync(goldenPath(spec.id), 'utf8');
        expect(text.startsWith('{')).toBe(true);
        expect(text.endsWith('\n')).toBe(true);
        expect(JSON.parse(text)).toEqual(golden);
      });
    });
  }
});

describe('json goldens — the named acceptance cases', () => {
  it('fatal reads keep a valid envelope with no source, schema or counts', () => {
    for (const id of ['enc-04', 'hst-02']) {
      withFixture(
        GOLDEN_CASES.find((spec) => spec.id === id) as FixtureSpec,
        ({ envelope, golden }) => {
          expect(envelope.status).toBe('failed');
          expect(envelope.source).toBeNull();
          expect(envelope.schema).toBeNull();
          expect(envelope.completeness).toBeNull();
          expect(envelope.unsupported).toEqual([]);
          expect(envelope.diagnostics).toHaveLength(1);
          expect(envelope.diagnostics[0]?.severity).toBe('fatal');
          expect(golden).toEqual(envelope);
        },
      );
    }
    expect(codesOf(readGolden('enc-04'))).toEqual(['E_UNDECODABLE']);
    expect(codesOf(readGolden('hst-02'))).toEqual(['E_BINARY_INPUT']);
  });

  it('unknown-only documents are ok with non-empty evidence and dropped 0', () => {
    for (const id of ['txt-04', 'txt-07']) {
      const golden = readGolden(id);
      expect(golden.status).toBe('ok');
      expect(golden.completeness?.dropped).toBe(0);
      expect(golden.unsupported.length).toBeGreaterThan(0);
      expect(golden.diagnostics.every((diagnostic) => diagnostic.severity === 'info')).toBe(true);
    }
    const txt04 = readGolden('txt-04');
    expect(codesOf(txt04)).toEqual(['S_UNKNOWN_KEY', 'S_UNKNOWN_KEY', 'S_UNKNOWN_SECTION']);
    expect(txt04.unsupported.map((entry) => entry.kind)).toEqual([
      'unknown-key',
      'unknown-key',
      'unknown-section',
      'unknown-key',
    ]);
  });

  it('malformed values keep their code, their raw text and their line', () => {
    const malformed = readGolden('val-08');
    expect(codesOf(malformed)).toEqual(['V_VIEW_COLUMNS_UNKNOWN', 'S_MALFORMED_LINE']);
    expect(malformed.status).toBe('degraded');
    expect(malformed.unsupported).toHaveLength(1);
    expect(malformed.unsupported[0]).toMatchObject({
      kind: 'multiline-value',
      sectionKind: 'View',
      key: null,
      raw: 'FROM users WHERE id > 0"',
      reason: 'not-a-key-value-line',
    });
    expect(lineOf(malformed.unsupported[0]?.span ?? null)).toBe(9);

    const quote = readGolden('val-11');
    expect(codesOf(quote)).toEqual(['S_COMPLEX_UNTERMINATED_QUOTE']);
    expect(quote.status).toBe('degraded');
    expect(quote.unsupported).toEqual([]);
    expect(lineOf(first(quote.diagnostics, 'val-11 diagnostics').span)).toBe(8);
  });

  it('legacy index evidence is reported and labelled with the profile role', () => {
    const fmt02 = readGolden('fmt-02');
    expect(codesOf(fmt02)).toEqual(['S_LEGACY_KEY', 'V_INDEX_LEGACY_ONLY']);
    const fmt02Entity = first(entities(fmt02), 'fmt-02 entities');
    expect(fmt02Entity.indexes?.primarySource).toBe('legacy');
    expect(fmt02Entity.indexes?.legacy[0]?.role).toBe('primary');
    expect(fmt02Entity.indexes?.canonical).toEqual([]);

    const sem04 = readGolden('sem-04');
    expect(codesOf(sem04)).toEqual(['S_LEGACY_KEY', 'V_INDEX_LEGACY_ONLY']);
    const sem04Entity = first(entities(sem04), 'sem-04 entities');
    expect(sem04Entity.indexes?.primarySource).toBe('canonical');
    expect(sem04Entity.indexes?.legacy[0]?.role).toBe('compatibility');
    expect(sem04Entity.indexes?.canonical).toEqual([]);
  });

  it('escaped Japanese round-trips through raw and value', () => {
    const envelope = readGolden('val-01');
    const entity = first(entities(envelope), 'val-01 entities');
    expect(entity.comment).toEqual({
      value: '引用"と\\と\'と\tと\nです',
      origin: 'declared',
      raw: '"引用\\Qと\\\\と\\qと\\tと\\nです"',
      span: { sectionIndex: 1, startLine: 5, endLine: 5, keyLine: 5 },
    });
    expect(entity.fields?.[0]?.comment).toEqual({
      value: 'コメント"付き',
      origin: 'declared',
      raw: '"コメント\\Q付き"',
      span: { sectionIndex: 1, startLine: 6, endLine: 6, keyLine: 6 },
    });
    expect(entity.fields?.[0]?.logicalName.value).toBe('論理');
    expect(entity.pname?.raw).toBe('"escapes"');
  });

  it('duplicates are retained as records; only a duplicate identity is an error', () => {
    const txt05 = readGolden('txt-05');
    expect(codesOf(txt05)).toEqual(['S_DUPLICATE_KEY']);
    expect(txt05.schema?.manager.attributes.map((attribute) => attribute.raw)).toEqual([
      '"first_project"',
      '"second_project"',
    ]);

    // The envelope keeps every occurrence; the last-wins *selection* exists in the classification
    // (the only place §4.2 defines it) and is asserted here so "retained" and "selected" stay
    // distinguishable instead of being conflated into one merged Manager scalar.
    const txt05Key = classificationOf('txt-05').keys.find(
      (entry) => entry.kind === 'Manager' && entry.spec.key === 'ProjectName',
    );
    expect(txt05Key?.occurrences.map((occurrence) => occurrence.raw)).toEqual([
      '"first_project"',
      '"second_project"',
    ]);
    expect(txt05Key?.selected?.raw).toBe('"second_project"');

    const txt06 = readGolden('txt-06');
    expect(codesOf(txt06)).toEqual(['S_DUPLICATE_KEY']);
    expect(txt06.schema?.manager.attributes.map((attribute) => attribute.raw)).toEqual([
      '"first_manager"',
      '"second_manager"',
    ]);
    expect(txt06.schema?.pages).toHaveLength(2);

    const txt06Key = classificationOf('txt-06').keys.find(
      (entry) => entry.kind === 'Manager' && entry.spec.key === 'ProjectName',
    );
    expect(txt06Key?.occurrences.map((occurrence) => occurrence.raw)).toEqual([
      '"first_manager"',
      '"second_manager"',
    ]);
    expect(txt06Key?.selected?.raw).toBe('"second_manager"');

    const sem08 = readGolden('sem-08');
    expect(codesOf(sem08)).toEqual(['V_DUPLICATE_OBJECT_NAME', 'V_VIEW_COLUMNS_UNKNOWN']);
    expect(first(entities(sem08), 'sem-08 entities').pname?.value).toBe('twin');
    expect(first(views(sem08), 'sem-08 views').pname?.value).toBe('twin');
    const duplicate = first(sem08.diagnostics, 'sem-08 diagnostics');
    expect(duplicate.severity).toBe('error');
    expect(duplicate.span).toEqual({
      sectionIndex: 3,
      startLine: 12,
      endLine: 12,
      keyLine: 12,
    });
    expect(sem08.status).toBe('degraded');
  });

  it('subtype membership stays unsupported, and R31 keeps the two spans distinct', () => {
    const envelope = readGolden('sem-05');
    const subtype = first(subtypes(envelope), 'sem-05 subtypes');
    expect(subtype.headerSpan).toEqual({
      sectionIndex: 3,
      startLine: 11,
      endLine: 11,
      keyLine: 11,
    });
    expect(subtype.span).toEqual({ sectionIndex: 3, startLine: 12, endLine: 12, keyLine: 12 });
    expect(subtype.membership).toEqual({
      status: 'unsupported',
      reason: 'no-membership-key-in-v2.21',
    });

    const evidence = envelope.unsupported.filter((entry) => entry.kind === 'subtype-membership');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.raw).toBe(subtype.sectionHeader);
    expect(evidence[0]?.raw).toBe('[Subtype]');
    expect(evidence[0]?.span).toEqual(subtype.headerSpan);
    expect(evidence[0]?.key).toBeNull();

    const finding = envelope.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
    );
    expect(finding).toHaveLength(1);
    expect(finding[0]?.severity).toBe('info');
    expect(finding[0]?.span).toEqual(subtype.span);
    expect(evidence[0]?.span.startLine).not.toBe(finding[0]?.span?.startLine);
  });

  it('view columns are an explicit unknown status, never []', () => {
    const sem06 = readGolden('sem-06');
    const sem06Views = views(sem06);
    expect(sem06Views).toHaveLength(2);
    expect(sem06Views.map((view) => view.effectiveColumns)).toEqual([
      { status: 'unknown', reason: 'view-columns-named-from-query' },
      { status: 'unknown', reason: 'view-columns-not-stored' },
    ]);
    for (const view of sem06Views) {
      expect(Array.isArray(view.effectiveColumns)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(view.effectiveColumns, 'columns')).toBe(false);
    }
    expect(codesOf(sem06)).toEqual(['V_VIEW_COLUMNS_UNKNOWN', 'V_VIEW_COLUMNS_UNKNOWN']);

    const txt01 = readGolden('txt-01');
    expect(views(txt01).map((view) => view.effectiveColumns)).toEqual([
      { status: 'unknown', reason: 'view-columns-not-stored' },
      { status: 'unknown', reason: 'view-columns-not-stored' },
    ]);
    expect(codesOf(txt01)).toEqual(['V_VIEW_COLUMNS_UNKNOWN', 'V_VIEW_COLUMNS_UNKNOWN']);
  });

  it('NUL inside text is preserved exactly', () => {
    const envelope = readGolden('hst-01');
    expect(codesOf(envelope)).toEqual([]);
    const entity = first(entities(envelope), 'hst-01 entities');
    expect(entity.comment?.value).toBe('before\u0000after');
    expect(entity.comment?.raw).toBe('"before\u0000after"');
    expect(entity.comment?.span?.startLine).toBe(8);
  });

  it('hostile names keep their raw headers and exact spans', () => {
    const envelope = readGolden('hst-04');
    expect(envelope.status).toBe('degraded');
    expect(envelope.completeness?.dropped).toBe(0);
    expect(envelope.unsupported.map((entry) => entry.span.startLine)).toEqual([
      11, 12, 14, 15, 17, 19,
    ]);
    expect(envelope.unsupported.map((entry) => entry.kind)).toEqual([
      'unknown-section',
      'unknown-key',
      'unknown-section',
      'unknown-key',
      'multiline-value',
      'unknown-section',
    ]);
    expect(envelope.unsupported[0]?.sectionHeader).toBe('[<script>]');
    expect(envelope.unsupported[2]?.sectionHeader).toBe('[[Entity]]');
    expect(envelope.unsupported[4]?.raw).toBe('[Entity]x');
    const huge = envelope.unsupported[5];
    expect(huge?.sectionHeader).toBe(`[${'A'.repeat(4096)}]`);
    expect(huge?.span).toEqual({ sectionIndex: 5, startLine: 19, endLine: 19, keyLine: 19 });
    expect(codesOf(envelope)).toEqual([
      'S_UNKNOWN_SECTION',
      'S_UNKNOWN_SECTION',
      'S_MALFORMED_LINE',
      'S_UNKNOWN_SECTION',
    ]);
  });

  it('mixed CRLF/LF/CR bytes keep spans per decoded line', () => {
    const envelope = readGolden('hst-05');
    expect(codesOf(envelope)).toEqual([]);
    expect(envelope.completeness?.lines.total).toBe(7);
    expect(envelope.completeness?.lines.accounted).toBe(7);
    expect(envelope.completeness?.lines.dropped).toBe(0);
    expect(envelope.source?.encoding).toEqual({
      detected: 'utf-8',
      bom: true,
      declared: null,
      mismatch: false,
    });
    const entity = first(entities(envelope), 'hst-05 entities');
    expect(entity.pname?.span).toEqual({
      sectionIndex: 2,
      startLine: 5,
      endLine: 5,
      keyLine: 5,
    });
    expect(entity.fields?.[0]?.span.startLine).toBe(6);
    expect(entity.positions?.[0]?.span.startLine).toBe(7);
    expect(entity.pname?.raw).toBe('"mixed_eol"');
    expect(entity.pname?.raw).not.toContain('\r');
  });

  it('widths beyond the documented shape are extended, never truncated', () => {
    const envelope = readGolden('val-04');
    const field = first(entities(envelope), 'val-04 entities').fields?.[0];
    expect(field?.elementsSeen).toBe(11);
    expect(field?.additionalOption.value).toBe('オプション,追加事項');
    expect(field?.additionalOption.raw).toBe('"オプション","追加事項"');
    expect(field?.color?.value).toBe('$FFFFFFFF');
    expect(codesOf(envelope)).toEqual(['S_FIELD_TOO_MANY_ELEMENTS']);
  });

  it('a missing colour is null with a warning, not an invented default', () => {
    const envelope = readGolden('val-05');
    const field = first(entities(envelope), 'val-05 entities').fields?.[0];
    expect(field?.elementsSeen).toBe(7);
    expect(field?.color).toBeNull();
    expect(field?.comment.value).toBe('コメント');
    expect(codesOf(envelope)).toEqual(['S_FIELD_TOO_FEW_ELEMENTS', 'V_MISSING_REQUIRED_KEY']);
  });

  it('a declared ordinal gap is reported and left unrepaired', () => {
    const envelope = readGolden('val-09');
    const key = first(entities(envelope), 'val-09 entities').primaryKey;
    expect(key).toMatchObject({
      status: 'inferred',
      value: ['first_col', 'third_col'],
      origin: 'inferred',
      span: null,
    });
    if (key.status !== 'inferred') throw new Error('val-09 lost its inferred key');
    expect(key.columns.map((column) => column.ordinal)).toEqual([0, 2]);
    expect(codesOf(envelope)).toEqual(['V_PK_ORDER_CONFLICT']);
  });

  it('relation goldens carry a record span and every declared scalar (per-file review)', () => {
    // The seven goldens stage 6-A rewrote and stage 6-B unit 2 extended, justified file by file from
    // the fixture text. `section` is the `[Relation]`/`[Relationship]` header's ordinal, `header`
    // its line, and each scalar tuple is (line, as-written value text) for an occurrence of one of
    // the nine projected keys — the five interpreted scalars (`PName`, `RelationType1/2`,
    // `Cardinarity1/2`) and the four declarations unit 2 added (`Entity1`, `Entity2`, `Fields1`,
    // `Fields2`), which the fixture writes first. No fixture relation declares a `PName`, so every
    // anchor is the header line, and the values are the fixture's own (`"users"`, `"id"`, `2`, `"P"`,
    // …; txt-09's section is empty).
    const review = [
      {
        id: 'fmt-01',
        relations: [
          {
            section: 4,
            header: 23,
            headerRaw: '[Relation]',
            scalars: [
              [24, '"users"'],
              [25, '"orders"'],
              [26, '"id"'],
              [27, '"user_id"'],
              [28, '2'],
              [29, '4'],
              [30, '"P"'],
              [31, '"Z"'],
            ],
          },
        ],
      },
      {
        id: 'sem-01',
        relations: [
          {
            section: 3,
            header: 12,
            headerRaw: '[Relation]',
            scalars: [
              [13, '"orders"'],
              [14, '"ghost_table"'],
              [15, '"user_id"'],
              [16, '"ghost_column"'],
              [17, '1'],
              [18, '3'],
              [19, '"Z"'],
              [20, '"P"'],
            ],
          },
        ],
      },
      {
        id: 'sem-03',
        relations: [
          {
            section: 4,
            header: 19,
            headerRaw: '[Relation]',
            scalars: [
              [20, '"parent_a"'],
              [21, '"child_b"'],
              [22, '"a,b"'],
              [23, '"x,y,z"'],
              [24, '2'],
              [25, '4'],
              [26, '"P"'],
              [27, '"Z"'],
            ],
          },
        ],
      },
      {
        id: 'txt-01',
        relations: [
          {
            section: 7,
            header: 40,
            headerRaw: '[Relation]',
            scalars: [
              [41, '"users"'],
              [42, '"orders"'],
              [43, '"id"'],
              [44, '"user_id"'],
              [45, '2'],
              [46, '4'],
              [47, '"P"'],
              [48, '"Z"'],
            ],
          },
        ],
      },
      {
        id: 'txt-02',
        relations: [
          {
            section: 4,
            header: 17,
            headerRaw: '[Relation]',
            scalars: [
              [18, '"parent_t"'],
              [19, '"child_t"'],
              [20, '"id"'],
              [21, '"parent_id"'],
              [22, '2'],
              [23, '4'],
              [24, '"P"'],
              [25, '"Z"'],
            ],
          },
          {
            section: 5,
            header: 28,
            headerRaw: '[Relationship]',
            scalars: [
              [29, '"parent_t"'],
              [30, '"child_t"'],
              [31, '"id"'],
              [32, '"parent_id"'],
              [33, '2'],
              [34, '4'],
              [35, '"P"'],
              [36, '"Z"'],
            ],
          },
        ],
      },
      {
        id: 'txt-03',
        relations: [
          {
            section: 4,
            header: 18,
            headerRaw: '[Relation]',
            scalars: [
              [19, '"table_a"'],
              [20, '"table_b"'],
              [21, '"a,b"'],
              [22, '"x,y"'],
              [23, '2'],
              [24, '4'],
              [25, '"P"'],
              [26, '"Z"'],
            ],
          },
        ],
      },
      {
        id: 'txt-09',
        relations: [
          {
            section: 3,
            header: 11,
            headerRaw: '[Relation]',
            scalars: [],
          },
        ],
      },
    ] as const;

    for (const { id, relations } of review) {
      const envelope = readGolden(id);
      expect(
        envelope.schema?.relations.map((relation) => relation.sectionIndex),
        id,
      ).toEqual(relations.map((expected) => expected.section));
      for (const expected of relations) {
        const relation = envelope.schema?.relations.find(
          (candidate) => candidate.sectionIndex === expected.section,
        );
        if (relation === undefined) throw new Error(`${id}: relation ${String(expected.section)}`);
        const where = `${id}.relations[section ${String(expected.section)}]`;

        expect(relation.span, `${where}.span`).toEqual({
          sectionIndex: expected.section,
          startLine: expected.header,
          endLine: expected.header,
          keyLine: expected.header,
        });
        expect(relation.sectionHeader, `${where}.sectionHeader`).toBe(expected.headerRaw);
        expect(relation.pname, `${where}.pname`).toBeNull();
        expect(
          relation.scalars.map((scalar) => [scalar.span.startLine, scalar.raw]),
          `${where}.scalars`,
        ).toEqual(expected.scalars.map(([line, raw]) => [line, raw]));

        // The slots restate the same declarations — the last occurrence per key — so the fixture's
        // own values are checkable without trusting the serializer's choice.
        const lastRaw = (key: string): string | undefined =>
          relation.scalars.filter((scalar) => scalar.key === key).at(-1)?.raw;
        expect(relation.relationType1?.raw, `${where}.relationType1`).toBe(
          lastRaw('RelationType1'),
        );
        expect(relation.relationType2?.raw, `${where}.relationType2`).toBe(
          lastRaw('RelationType2'),
        );
        expect(relation.cardinarity1?.raw, `${where}.cardinarity1`).toBe(lastRaw('Cardinarity1'));
        expect(relation.cardinarity2?.raw, `${where}.cardinarity2`).toBe(lastRaw('Cardinarity2'));
      }
    }
  });
});

describe('json goldens — page and domain references (stage 6-B unit 3)', () => {
  /**
   * One page reference as a reviewer checks it against the fixture: section ordinal, the physical
   * line the `Position` wrote, and the outcome as `<status>` or `<status> <declared spelling>@<line>`
   * for every declaration it matched. The line after `@` is the declaration's own `PageInfo` line.
   */
  function pageOutcome(reference: JsonPageReference): string {
    switch (reference.status) {
      case 'resolved':
        return `resolved ${reference.resolvedPage.name}@${String(reference.resolvedPage.span.keyLine)}`;
      case 'ambiguous':
        return `ambiguous ${reference.candidates
          .map((candidate) => `${candidate.name}@${String(candidate.span.keyLine)}`)
          .join(',')}`;
      case 'dangling':
        return 'dangling';
    }
  }
  /** One domain reference the same way: system with its `known` flag, or user with its match(es). */
  function domainOutcome(reference: JsonDomainReference): string {
    const { classification } = reference;
    switch (classification.kind) {
      case 'system':
        return `system ${classification.name} ${classification.known ? 'known' : 'unknown'}`;
      case 'user':
        return classification.status === 'resolved'
          ? `user resolved ${classification.resolvedDomain.name}@${String(
              classification.resolvedDomain.span.keyLine,
            )}`
          : `user ambiguous ${classification.candidates
              .map((candidate) => `${candidate.name}@${String(candidate.span.keyLine)}`)
              .join(',')}`;
    }
  }
  it('carries every reference, on its own line, with the outcome the fixture implies', () => {
    // Justified file by file from the fixture text: `section` is the `Position`/`Field` line's
    // section ordinal, `line` that line, and the outcome names the `PageInfo`/`DomainInfo` line it
    // resolved to (or the two it could not choose between, or none). Every fixture but `txt-06`
    // resolves; `txt-06` declares `PageInfo="Main"` twice, once per `[Manager]`, so its one
    // placement is ambiguous over both lines; `enc-03`/`enc-05` declare no page at all.
    const review = [
      { id: 'enc-02', pages: [[1, 7, 'resolved Main@10']], domains: [] },
      { id: 'enc-03', pages: [[1, 7, 'dangling']], domains: [] },
      { id: 'enc-05', pages: [[1, 5, 'dangling']], domains: [] },
      {
        id: 'fmt-01',
        pages: [
          [2, 14, 'resolved Main@5'],
          [3, 21, 'resolved Main@5'],
          [4, 32, 'resolved Main@5'],
          [5, 37, 'resolved Main@5'],
        ],
        domains: [],
      },
      { id: 'fmt-02', pages: [[1, 8, 'resolved Main@11']], domains: [] },
      { id: 'fmt-03', pages: [[2, 13, 'resolved Main@4']], domains: [] },
      { id: 'fmt-04', pages: [[1, 5, 'resolved Main@8']], domains: [] },
      { id: 'fmt-05', pages: [[2, 14, 'resolved Main@5']], domains: [] },
      { id: 'hst-01', pages: [[2, 10, 'resolved Main@4']], domains: [] },
      { id: 'hst-04', pages: [[2, 9, 'resolved Main@4']], domains: [] },
      { id: 'hst-05', pages: [[2, 7, 'resolved Main@3']], domains: [] },
      {
        id: 'sem-01',
        pages: [
          [2, 10, 'resolved Main@4'],
          [3, 21, 'dangling'],
        ],
        domains: [],
      },
      { id: 'sem-02', pages: [[2, 9, 'resolved Main@4']], domains: [] },
      {
        id: 'sem-03',
        pages: [
          [2, 10, 'resolved Main@4'],
          [3, 17, 'resolved Main@4'],
          [4, 28, 'resolved Main@4'],
        ],
        domains: [],
      },
      { id: 'sem-04', pages: [[2, 12, 'resolved Main@4']], domains: [] },
      {
        id: 'sem-05',
        pages: [
          [2, 9, 'resolved Main@4'],
          [3, 15, 'resolved Main@4'],
        ],
        domains: [],
      },
      {
        id: 'sem-06',
        pages: [
          [2, 10, 'resolved Main@4'],
          [3, 15, 'resolved Main@4'],
        ],
        domains: [],
      },
      {
        id: 'sem-07',
        pages: [
          [2, 12, 'resolved Main@4'],
          [3, 18, 'resolved Main@4'],
        ],
        domains: [[2, 11, 'system @INT known']],
      },
      {
        id: 'sem-08',
        pages: [
          [2, 9, 'resolved Main@4'],
          [3, 14, 'resolved Main@4'],
        ],
        domains: [],
      },
      { id: 'sem-09', pages: [], domains: [] },
      { id: 'sem-10', pages: [], domains: [] },
      { id: 'sem-11', pages: [[2, 8, 'resolved Main@4']], domains: [] },
      {
        id: 'txt-01',
        pages: [
          [2, 15, 'resolved Main@5'],
          [3, 23, 'resolved Main@5'],
          [4, 28, 'resolved Detail@6'],
          [5, 33, 'resolved Main@5'],
          [6, 38, 'resolved Detail@6'],
          [7, 49, 'resolved Main@5'],
        ],
        domains: [],
      },
      {
        id: 'txt-02',
        pages: [
          [2, 9, 'resolved Main@4'],
          [3, 15, 'resolved Main@4'],
          [4, 26, 'resolved Main@4'],
          [5, 37, 'resolved Main@4'],
        ],
        domains: [],
      },
      {
        id: 'txt-03',
        pages: [
          [2, 10, 'resolved Main@4'],
          [3, 16, 'resolved Main@4'],
          [4, 27, 'resolved Main@4'],
        ],
        domains: [],
      },
      { id: 'txt-04', pages: [[1, 7, 'resolved Main@13']], domains: [] },
      { id: 'txt-05', pages: [[2, 11, 'resolved Main@5']], domains: [] },
      { id: 'txt-06', pages: [[2, 10, 'ambiguous Main@5,Main@14']], domains: [] },
      { id: 'txt-07', pages: [[1, 6, 'resolved Main@9']], domains: [] },
      { id: 'txt-08', pages: [[2, 9, 'resolved Main@4']], domains: [] },
      { id: 'txt-09', pages: [[2, 9, 'resolved Main@4']], domains: [] },
      { id: 'val-01', pages: [[1, 7, 'resolved Main@10']], domains: [] },
      { id: 'val-02', pages: [[1, 9, 'resolved Main@12']], domains: [] },
      { id: 'val-03', pages: [[1, 6, 'resolved Main@9']], domains: [] },
      { id: 'val-04', pages: [[2, 9, 'resolved Main@4']], domains: [] },
      { id: 'val-05', pages: [[1, 6, 'resolved Main@9']], domains: [] },
      { id: 'val-06', pages: [[1, 8, 'resolved Main@11']], domains: [] },
      { id: 'val-07', pages: [[2, 13, 'resolved Main@4']], domains: [] },
      { id: 'val-08', pages: [[2, 10, 'resolved Main@4']], domains: [] },
      { id: 'val-09', pages: [[2, 10, 'resolved Main@4']], domains: [] },
      { id: 'val-10', pages: [[2, 10, 'resolved Main@4']], domains: [] },
      { id: 'val-11', pages: [[2, 9, 'resolved Main@4']], domains: [] },
    ] as const;
    // Every schema-bearing golden is in the table, and only those: the two failed envelopes have
    // no `schema` to review.
    const expectedIds = GOLDEN_CASES.map((spec) => spec.id).filter(
      (id) => id !== 'enc-04' && id !== 'hst-02',
    );
    expect(review.map((row) => row.id)).toEqual([...expectedIds].sort());
    for (const row of review) {
      const envelope = readGolden(row.id);
      expect(
        (envelope.schema?.pageReferences ?? []).map((reference) => [
          reference.sectionIndex,
          reference.span.keyLine,
          pageOutcome(reference),
        ]),
        `${row.id}.pageReferences`,
      ).toEqual(row.pages.map((entry) => [...entry]));
      expect(
        (envelope.schema?.domainReferences ?? []).map((reference) => [
          reference.sectionIndex,
          reference.span.keyLine,
          domainOutcome(reference) as string,
        ]),
        `${row.id}.domainReferences`,
      ).toEqual(row.domains.map((entry) => [...entry]));
    }
  });
  it('never turns a plain type, or a page token, into a record the model does not have', () => {
    // The two lists are 1:1 with the semantic records: no reference is invented for a `Field` that
    // names no domain (`Serial` is everywhere), and no page reference is dropped.
    for (const spec of GOLDEN_CASES) {
      const envelope = readGolden(spec.id);
      if (envelope.schema === null) continue;
      const positions = [
        ...envelope.schema.objects.flatMap((object) => object.positions ?? []),
        ...envelope.schema.relations.flatMap((relation) => relation.positions ?? []),
      ].filter((position) => position.kind !== 'unsupported');
      expect(envelope.schema.pageReferences, spec.id).toHaveLength(positions.length);
      // Every domain record names a domain (system or declared user name); a plain type is absent.
      const names = new Set(
        envelope.schema.domains
          .filter((domain) => domain.name !== '')
          .map((domain) => domain.name.toLowerCase()),
      );
      for (const reference of envelope.schema.domainReferences) {
        const { classification } = reference;
        const named =
          classification.kind === 'system' || names.has(classification.name.toLowerCase());
        expect(named, `${spec.id}: ${reference.dataType}`).toBe(true);
      }
      // Nothing was dropped and the references added no diagnostic of their own.
      expect(envelope.completeness?.dropped ?? 0, spec.id).toBe(0);
    }
  });
});

describe('json goldens — counting identities, FORMAT and the byte fixtures (stage 6-B unit 4)', () => {
  /** The catalog entry for one id, or a thrown error: no fixture is looked up by file name. */
  function specOf(id: string): FixtureSpec {
    const spec = FIXTURES.find((candidate) => candidate.id === id);
    if (spec === undefined) throw new Error(`no fixture ${id}`);
    return spec;
  }
  it('reconciles in two terms: `unsupported` is evidence, never a summand (§12 rule 2, §13)', () => {
    // §12 rule 2 used to claim `total = structured + raw-preserved + unsupported-reported`. That sum
    // cannot close, and these three goldens show why in all three shapes of evidence:
    //
    //   - `unknown-section` / `unknown-key` records are *already inside* `preservedRaw`;
    //   - `subtype-membership` and `unsupported-position` own no counter at all;
    //   - `multiline-value` counts as a key only when it starts a key line.
    //
    // So `counted` evidence repeats the partition and `uncounted` evidence has no term to be added
    // to: the three-term formula over-counts (and for `sem-05` it invents a section).
    const ROWS = [
      // id, sections[total, parsed, preservedRaw], keys[total, parsed, preservedRaw],
      // evidence already inside preservedRaw, evidence with no counter.
      { id: 'hst-04', sections: [5, 2, 3], keys: [6, 4, 2], counted: 5, uncounted: 1 },
      { id: 'sem-05', sections: [3, 3, 0], keys: [9, 9, 0], counted: 0, uncounted: 1 },
      { id: 'txt-04', sections: [3, 2, 1], keys: [6, 3, 3], counted: 4, uncounted: 0 },
    ] as const;
    for (const row of ROWS) {
      const envelope = readGolden(row.id);
      const completeness = envelope.completeness;
      if (completeness === null) throw new Error(`${row.id} lost its completeness`);
      const [sectionsTotal, sectionsParsed, sectionsPreserved] = row.sections;
      const [keysTotal, keysParsed, keysPreserved] = row.keys;
      expect(completeness.sections, row.id).toEqual({
        total: sectionsTotal,
        parsed: sectionsParsed,
        preservedRaw: sectionsPreserved,
        unknown: sectionsPreserved,
      });
      expect(completeness.keys, row.id).toEqual({
        total: keysTotal,
        parsed: keysParsed,
        preservedRaw: keysPreserved,
      });
      expect(completeness.dropped, row.id).toBe(0);
      expect(completeness.lines.dropped, row.id).toBe(0);
      expect(completeness.lines.accounted, row.id).toBe(completeness.lines.total);
      // The two-term identity §13 states, and which `validate/` enforces at runtime.
      expect(sectionsParsed + sectionsPreserved, row.id).toBe(sectionsTotal);
      expect(keysParsed + keysPreserved, row.id).toBe(keysTotal);
      // The evidence splits exactly into the part the partition already counted and the part no
      // counter owns — never into a third term.
      expect(envelope.unsupported, row.id).toHaveLength(row.counted + row.uncounted);
      const countedKinds = new Set(['unknown-section', 'unknown-key', 'legacy-key']);
      const counted = envelope.unsupported.filter((record) => countedKinds.has(record.kind));
      expect(counted, row.id).toHaveLength(row.counted);
      expect(counted.length, row.id).toBe(sectionsPreserved + keysPreserved);
      // Adding the evidence to the partition over-counts the total, in both dimensions.
      expect(sectionsParsed + sectionsPreserved + envelope.unsupported.length, row.id).not.toBe(
        sectionsTotal,
      );
      expect(keysParsed + keysPreserved + envelope.unsupported.length, row.id).not.toBe(keysTotal);
    }
  });
  it('counts enc-05 from its decoded bytes: one header, two key lines', () => {
    // The stale number this unit fixes, derived from the bytes rather than from the catalog: the
    // fixture is `FF FE` plus five UTF-16LE lines. Counting the documented shapes on those physical
    // lines gives 1 section and 2 `key=value` lines — not the 3 the entry used to claim.
    const spec = specOf('enc-05');
    withFixture(spec, ({ staged, envelope, golden }) => {
      const bytes = readFileSync(staged.path);
      expect(bytes.subarray(0, 2).toString('hex')).toBe('fffe');
      const decoded = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      const lines = decoded.split(/\r\n|\n|\r/);
      // The document writes one terminating newline; the reader counts the five lines before it.
      if (lines.at(-1) === '') lines.pop();
      expect(lines).toEqual([
        '# A5:ER FORMAT:21',
        '',
        '[Entity]',
        'PName="utf16"',
        'Position="Main",10,10',
      ]);
      const headers = lines.filter((line) => /^\s*\[.+\]\s*$/.test(line));
      const keys = lines.filter(
        (line) =>
          !/^\s*\[.+\]\s*$/.test(line) &&
          line.trim() !== '' &&
          !line.startsWith('#') &&
          /^[^=]+?=/.test(line),
      );
      expect(headers, 'section headers').toHaveLength(1);
      expect(keys, 'key=value lines').toHaveLength(2);
      // Three independent sources agree: the bytes, the catalog entry, and the golden.
      expect(spec.expectation.counts.sections).toEqual({ total: 1, parsed: 1, preservedRaw: 0 });
      expect(spec.expectation.counts.keys).toEqual({ total: 2, parsed: 2, preservedRaw: 0 });
      expect(golden.completeness?.sections.total).toBe(headers.length);
      expect(golden.completeness?.keys.total).toBe(keys.length);
      expect(envelope.completeness?.sections).toEqual({
        total: 1,
        parsed: 1,
        preservedRaw: 0,
        unknown: 0,
      });
      expect(envelope.completeness?.keys).toEqual({ total: 2, parsed: 2, preservedRaw: 0 });
      expect(envelope.completeness?.lines).toEqual({ total: 5, accounted: 5, dropped: 0 });
    });
  });
  it("keeps enc-03's decode-stage entry apart from the envelope, bending neither", () => {
    // `enc-03`/`enc-05` catalog codes are measured at the decode stage (`DECODE_ONLY`). The split is
    // real for diagnostics and *not* real for counts: the decoded document has one section and three
    // key lines either way, and only the semantic stage adds the two findings it could not see.
    const spec = specOf('enc-03');
    withFixture(spec, ({ input, envelope, golden }) => {
      // The decode stage's own outcome, before scan/classify/derive ever run.
      const load = input.load;
      if (!load.ok) throw new Error('enc-03 must decode');
      const decodeCodes = load.source.diagnostics.map((entry) => entry.code);
      expect(decodeCodes).toEqual(spec.expectation.codes);
      expect(decodeCodes).toEqual(['D_ENCODING_MISMATCH']);
      expect(spec.expectation.status).toBe('degraded');
      expect(load.source.format).toBe(21);
      assertCodes(
        envelope.diagnostics.map((diagnostic) => diagnostic.code),
        [...spec.expectation.codes, 'V_DANGLING_PAGE', 'V_MISSING_REQUIRED_KEY'],
        'enc-03 envelope codes',
      );
      expect(envelope.status).toBe('degraded');
      // Counts are the same fact at both stages, which is why the `enc-05` key count could be
      // fixed in the catalog without touching the decode-only code delta.
      expect(spec.expectation.counts).toEqual({
        sections: { total: 1, parsed: 1, preservedRaw: 0 },
        keys: { total: 3, parsed: 3, preservedRaw: 0 },
      });
      expect(envelope.completeness?.sections.total).toBe(1);
      expect(envelope.completeness?.keys.total).toBe(3);
      expect(golden.completeness).toEqual(envelope.completeness);
    });
  });
  it('keeps all 44 goldens complete, stamped and self-consistent on their own', () => {
    // Read from disk only: this guard does not run the serializer, so a golden cannot be kept
    // honest by the code it is supposed to judge.
    const names = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.expected.json'))
      .sort();
    expect(names).toHaveLength(44);
    expect(names).toEqual(GOLDEN_CASES.map((spec) => `${spec.id}.expected.json`).sort());
    const FIELDS = [
      'contractVersion',
      'tool',
      'command',
      'status',
      'source',
      'limits',
      'schema',
      'unsupported',
      'diagnostics',
      'completeness',
    ] as const;
    let projected = 0;
    let rejected = 0;
    for (const name of names) {
      const raw: unknown = JSON.parse(readFileSync(join(GOLDEN_DIR, name), 'utf8'));
      if (!isRecord(raw)) throw new Error(`${name}: not an object`);
      // §12's ten fields, in construction order.
      expect(Object.keys(raw), name).toEqual([...FIELDS]);
      expect(raw['contractVersion'], name).toBe('0.1.0');
      expect(raw['tool'], name).toEqual({ name: '@j1nn0/a5er-cli', version: '0.1.0' });
      expect(raw['command'], name).toBe('inspect');
      expect(raw['limits'], name).toEqual({ maxBytes: 64 * 1024 * 1024, truncated: false });
      const source = raw['source'];
      const schema = raw['schema'];
      const completeness = raw['completeness'];
      if (schema === null) {
        rejected += 1;
        // A rejected read is the documented arm, not a half-built envelope.
        expect(raw['status'], name).toBe('failed');
        expect(source, name).toBeNull();
        expect(completeness, name).toBeNull();
        expect(raw['unsupported'], name).toEqual([]);
        continue;
      }
      projected += 1;
      expect(raw['status'], name).not.toBe('failed');
      if (!isRecord(source) || !isRecord(completeness)) throw new Error(`${name}: missing block`);
      // The FORMAT identity, on the golden alone: no effective version this build cannot name.
      const format = source['format'];
      if (!isRecord(format)) throw new Error(`${name}: no format`);
      expect(format['effective'], name).toBe(format['known'] === true ? format['declared'] : null);
      // §13's identities, on the golden alone.
      const sections = completeness['sections'];
      const keys = completeness['keys'];
      const lines = completeness['lines'];
      if (!isRecord(sections) || !isRecord(keys) || !isRecord(lines)) {
        throw new Error(`${name}: incomplete ledger`);
      }
      expect(completeness['dropped'], name).toBe(0);
      expect(sections['parsed'], name).toEqual(expect.any(Number));
      expect(
        Number(sections['parsed']) + Number(sections['preservedRaw']),
        `${name} sections`,
      ).toBe(Number(sections['total']));
      expect(sections['unknown'], `${name} unknown`).toBe(sections['preservedRaw']);
      expect(Number(keys['parsed']) + Number(keys['preservedRaw']), `${name} keys`).toBe(
        Number(keys['total']),
      );
      expect(lines['accounted'], `${name} lines`).toBe(lines['total']);
      expect(lines['dropped'], name).toBe(0);
      expect(raw['unsupported'], name).toEqual(expect.any(Array));
      expect(raw['diagnostics'], name).toEqual(expect.any(Array));
    }
    expect(projected).toBe(42);
    expect(rejected).toBe(2);
  });
});
