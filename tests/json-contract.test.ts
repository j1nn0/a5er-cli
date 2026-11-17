/**
 * Stage 6 Unit 1 — the JSON envelope's contract (`architecture.md` §12, §13;
 * `test-strategy.md` §3.6, §8, §10, §14 stage 6).
 *
 * This file pins what the serializer owns, and only that:
 *
 * 1. determinism — two serializations of the same input are byte-identical, and the key order is
 *    the construction order of §12;
 * 2. immutability — a deeply frozen input serializes, so nothing in the factory mutates a stage
 *    result;
 * 3. strictness — `toJsonString` throws on `undefined`, functions, symbols, bigints and non-finite
 *    numbers instead of letting `JSON.stringify` drop or rewrite them;
 * 4. the frozen constants — `contractVersion` is its own literal, the tool identity mirrors
 *    `package.json` and `VERSION`, and `src/json/` imports neither;
 * 5. the failed shape — a rejected read is valid JSON with `source`/`schema`/`completeness` `null`
 *    and `unsupported: []`;
 * 6. the two spans of R31 — subtype evidence points at the header, the diagnostic at the `PName`
 *    line;
 * 7. the explicit unknown states — a view's columns stay a status object, never `[]`;
 * 8. retention — duplicate diagnostics, duplicate objects and repeated Manager scalars all survive
 *    in file order, and a relation keeps every declaration of its interpreted scalars (§12 rule 4);
 * 9. evidence for known-but-unrepresented section kinds — `[Shape]`, `[Line]` and `[Comment]`
 *    headers and parsed keys reach `unsupported` with their original lines (§13, stage 6-A).
 *
 * No golden file is written here: stage 6's expected envelopes are authored separately from the
 * stage 1–5 expectations (`test-strategy.md` §3.6, §14), never by blessing this serializer's output.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import { DEFAULT_LIMITS } from '../src/io/limits.js';
import {
  CONTRACT_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
  serialize,
  toJsonString,
} from '../src/json/index.js';
import type { JsonEnvelope, JsonObject, JsonSpan } from '../src/json/index.js';
import { VERSION } from '../src/index.js';
import type { Span } from '../src/model/span.js';
import { classify } from '../src/schema/registry.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { IntegrationInput, LoadedIntegrationInput } from '../src/validate/index.js';
import { integrate } from '../src/validate/index.js';
import { stage } from './helpers/stage.js';

/** §12's envelope fields, in the order `serialize` constructs them (construction = emission). */
const ENVELOPE_KEYS = [
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

/** A caller-supplied context; the path is echoed and never resolved. */
const CONTEXT = { command: 'inspect', path: '/tmp/schema.a5er' } as const;

const JSON_DIR = fileURLToPath(new URL('../src/json/', import.meta.url));

/** Run the real four stages over a path, without a shortcut or an invented result. */
function inputFromPath(path: string): LoadedIntegrationInput {
  const load = loadSource(path);
  if (!load.ok) throw new Error(`input ${path} did not load`);
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return {
    load,
    scan,
    classification,
    semantics: derivePartialSemantics(classification),
  };
}

/** Run the real four stages over a staged synthetic fixture, then throw the staging away. */
function pipelineFor(id: string): LoadedIntegrationInput {
  const staged = stage(id);
  try {
    return inputFromPath(staged.path);
  } finally {
    staged.cleanup();
  }
}

/** The JSON projection of a stage span, for span-equality assertions without importing internals. */
function jsonSpanOf(span: Span): JsonSpan {
  return {
    sectionIndex: span.sectionIndex,
    startLine: span.startLine,
    endLine: span.endLine,
    keyLine: span.keyLine,
  };
}

/** Recursively freeze an input so any mutation attempt becomes a TypeError in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Drop comments before the purity scan: the prose names `package.json` and `VERSION` on purpose,
 * while the imports and identifiers are what the guard is about. `src/json/` has no string literal
 * containing `//`, so two regexes are enough here.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `package.json`, read the way the manifest test reads it. */
function readPackageJson(): Record<string, unknown> {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** The first object of one kind, or a thrown error naming the fixture. */
function objectOfKind(objects: readonly JsonObject[], kind: JsonObject['kind']): JsonObject {
  const object = objects.find((candidate) => candidate.kind === kind);
  if (object === undefined) throw new Error(`envelope has no ${kind} object`);
  return object;
}

describe('json envelope — determinism and key order', () => {
  it('serializes the same input to the same string, twice', () => {
    const input = pipelineFor('fmt-01');
    const first = toJsonString(serialize(input, CONTEXT));
    const second = toJsonString(serialize(input, CONTEXT));

    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(JSON.parse(second));
  });

  it('emits the §12 fields in construction order', () => {
    const envelope = serialize(pipelineFor('fmt-01'), CONTEXT);

    expect(Object.keys(envelope)).toEqual([...ENVELOPE_KEYS]);
    expect(Object.keys(envelope.tool)).toEqual(['name', 'version']);
    expect(Object.keys(envelope.limits)).toEqual(['maxBytes', 'truncated']);
    expect(envelope.source).not.toBeNull();
    if (envelope.source === null) throw new Error('fmt-01 lost its source');
    expect(Object.keys(envelope.source)).toEqual([
      'path',
      'sizeBytes',
      'sha256',
      'encoding',
      'format',
    ]);
    expect(Object.keys(envelope.source.format)).toEqual(['declared', 'effective', 'known']);
    expect(envelope.schema).not.toBeNull();
    if (envelope.schema === null) throw new Error('fmt-01 lost its schema');
    expect(Object.keys(envelope.schema)).toEqual([
      'objects',
      'relations',
      'pages',
      'domains',
      'commonFields',
      'manager',
    ]);
  });

  it('projects Integration once: status, counts, diagnostics and evidence agree with it', () => {
    const input = pipelineFor('sem-01');
    const envelope = serialize(input, CONTEXT);
    const integration = integrate(input);

    expect(envelope.status).toBe(integration.status);
    expect(envelope.completeness).toEqual(integration.completeness);
    expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      integration.diagnostics.map((diagnostic) => diagnostic.code),
    );
    // Exactly one list, in Integration's order, with its duplicates intact — no second
    // concatenation of the stage diagnostics.
    expect(envelope.diagnostics).toHaveLength(integration.diagnostics.length);
    // `sem-01` declares no `[Shape]`/`[Line]`/`[Comment]` section, so Integration's list is the
    // whole list; the one documented addition is tested in the stage 6-A evidence block below.
    expect(envelope.unsupported).toEqual(integration.unsupported);
  });

  it('projects a readable source and a known FORMAT', () => {
    const envelope = serialize(pipelineFor('fmt-01'), CONTEXT);

    expect(envelope.source?.format).toEqual({ declared: 21, effective: 21, known: true });
    // fmt-03 declares no FORMAT: the decoder runs, but no version can be named (D4's gap).
    const headerless = serialize(pipelineFor('fmt-03'), CONTEXT);
    expect(headerless.source?.format).toEqual({ declared: null, effective: null, known: false });
  });

  it('takes maxBytes from the caller context and truncation from the diagnostics alone', () => {
    const envelope = serialize(pipelineFor('fmt-01'), {
      ...CONTEXT,
      limits: { ...DEFAULT_LIMITS, maxBytes: 4096 },
    });

    expect(envelope.limits).toEqual({ maxBytes: 4096, truncated: false });
  });
});

describe('json envelope — input immutability', () => {
  it('serializes a deeply frozen input without mutating it', () => {
    const frozen = deepFreeze(pipelineFor('fmt-01'));
    const plain = pipelineFor('fmt-01');

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(toJsonString(serialize(frozen, CONTEXT))).toBe(toJsonString(serialize(plain, CONTEXT)));
  });
});

describe('json envelope — strict stringification', () => {
  it('accepts a real envelope', () => {
    const envelope = serialize(pipelineFor('fmt-01'), CONTEXT);
    const text = toJsonString(envelope);

    const parsed = JSON.parse(text) as unknown;
    expect(typeof parsed).toBe('object');
    expect(Object.keys(parsed as Record<string, unknown>)).toEqual([...ENVELOPE_KEYS]);
    expect((parsed as { status: string }).status).toBe(envelope.status);
  });

  it('throws instead of dropping or rewriting lossy values', () => {
    const base = serialize(pipelineFor('fmt-01'), CONTEXT);
    const crafted: readonly unknown[] = [
      { ...base, source: undefined },
      { ...base, tool: { name: TOOL_NAME, version: undefined } },
      { ...base, tool: { name: TOOL_NAME, version: () => 'x' } },
      { ...base, command: Symbol('inspect') },
      { ...base, limits: { maxBytes: Number.NaN, truncated: false } },
      { ...base, limits: { maxBytes: Number.POSITIVE_INFINITY, truncated: false } },
      { ...base, limits: { maxBytes: Number.NEGATIVE_INFINITY, truncated: false } },
      { ...base, limits: { maxBytes: 1n, truncated: false } },
    ];

    expect(() => toJsonString(base)).not.toThrow();
    for (const envelope of crafted) {
      expect(() => toJsonString(envelope as JsonEnvelope)).toThrow(TypeError);
    }
  });
});

describe('json envelope — frozen constants', () => {
  it('pins the contract version to its own literal', () => {
    expect(CONTRACT_VERSION).toBe('0.1.0');
  });

  it('mirrors the real tool identity', () => {
    const pkg = readPackageJson();

    expect(TOOL_NAME).toBe('@j1nn0/a5er-cli');
    expect(pkg['name']).toBe(TOOL_NAME);
    expect(pkg['version']).toBe(TOOL_VERSION);
    expect(TOOL_VERSION).toBe(VERSION);
  });

  it('never imports package.json or VERSION, and stays pure', () => {
    const files = readdirSync(JSON_DIR)
      .filter((name) => name.endsWith('.ts'))
      .sort();

    expect(files).toEqual(['envelope.ts', 'index.ts', 'serialize.ts']);
    for (const file of files) {
      const text = stripComments(readFileSync(join(JSON_DIR, file), 'utf8'));
      // The version is a literal, not a manifest read and not the library surface's constant.
      expect(text).not.toMatch(/\bpackage\.json\b/);
      expect(text).not.toMatch(/\bVERSION\b/);
      expect(text).not.toMatch(/from\s+['"]\.\.\/index\.js['"]/);
      // Pure: no filesystem, no clock, no environment, no stdout, no exit.
      expect(text).not.toMatch(/\bnode:/);
      expect(text).not.toMatch(/\bconsole\./);
      expect(text).not.toMatch(/\bprocess\./);
      expect(text).not.toMatch(/\bDate\.now\b/);
      expect(text).not.toMatch(/new Date\(/);
    }
  });
});

describe('json envelope — failed input', () => {
  it('stays valid JSON and fabricates no source, schema or counts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-json-'));
    const path = join(directory, 'empty.a5er');
    try {
      writeFileSync(path, ' \n\t\n');
      const load = loadSource(path);
      expect(load.ok).toBe(false);
      if (load.ok) throw new Error('whitespace-only input was accepted');

      const input: IntegrationInput = { load };
      const envelope = serialize(input, { command: 'validate', path });

      expect(envelope.status).toBe('failed');
      expect(envelope.source).toBeNull();
      expect(envelope.schema).toBeNull();
      expect(envelope.completeness).toBeNull();
      expect(envelope.unsupported).toEqual([]);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toContain('E_EMPTY_INPUT');
      expect(envelope.limits).toEqual({ maxBytes: DEFAULT_LIMITS.maxBytes, truncated: false });
      expect(() => JSON.parse(toJsonString(envelope))).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('json envelope — R31 spans stay distinct', () => {
  it('anchors subtype evidence on the header and the finding on the PName line', () => {
    const input = pipelineFor('sem-05');
    const envelope = serialize(input, CONTEXT);
    const subtype = input.semantics.subtypes[0];
    if (subtype === undefined) throw new Error('sem-05 declares no subtype');

    const object = objectOfKind(envelope.schema?.objects ?? [], 'subtype');
    if (object.kind !== 'subtype') throw new Error('subtype projection lost its kind');
    expect(object.headerSpan).toEqual(jsonSpanOf(subtype.headerSpan));
    expect(object.span).toEqual(jsonSpanOf(subtype.span));
    expect(object.membership).toEqual(subtype.membership);

    const evidence = envelope.unsupported.filter((entry) => entry.kind === 'subtype-membership');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.raw).toBe(subtype.headerRaw);
    expect(evidence[0]?.key).toBeNull();
    expect(evidence[0]?.span).toEqual(jsonSpanOf(subtype.headerSpan));

    const findings = envelope.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.span).toEqual(jsonSpanOf(subtype.span));

    // One record quotes the header; the other reports the most specific line. They must not merge.
    expect(evidence[0]?.span.startLine).not.toBe(findings[0]?.span?.startLine);
  });
});

describe('json envelope — unknown stays explicit', () => {
  it('keeps every view column list unknown, with a reason and no columns member', () => {
    const envelope = serialize(pipelineFor('sem-06'), CONTEXT);
    const objects = envelope.schema?.objects ?? [];
    const views = objects.filter((object) => object.kind === 'view');

    expect(views).toHaveLength(2);
    expect(views[0]?.effectiveColumns).toEqual({
      status: 'unknown',
      reason: 'view-columns-named-from-query',
    });
    expect(views[1]?.effectiveColumns).toEqual({
      status: 'unknown',
      reason: 'view-columns-not-stored',
    });
    for (const view of views) {
      expect(Object.prototype.hasOwnProperty.call(view.effectiveColumns, 'columns')).toBe(false);
    }
    expect(
      envelope.diagnostics.filter((diagnostic) => diagnostic.code === 'V_VIEW_COLUMNS_UNKNOWN'),
    ).toHaveLength(2);
    // No `fields`/`indexes` member to misread: a view has no `Field` key (P6).
    for (const view of views) {
      expect(Object.prototype.hasOwnProperty.call(view, 'fields')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(view, 'indexes')).toBe(false);
    }
  });
});

describe('json envelope — retention in file order', () => {
  it('keeps duplicate objects and their finding, rather than merging them', () => {
    const envelope = serialize(pipelineFor('sem-08'), CONTEXT);
    const objects = envelope.schema?.objects ?? [];

    expect(objects.map((object) => object.kind)).toEqual(['entity', 'view']);
    expect(objects[0]?.pname?.value).toBe('twin');
    expect(objects[1]?.pname?.value).toBe('twin');
    expect(
      envelope.diagnostics.filter((diagnostic) => diagnostic.code === 'V_DUPLICATE_OBJECT_NAME'),
    ).toHaveLength(1);
  });

  it('keeps unknown-key evidence, one record per line, in Integration order', () => {
    const input = pipelineFor('txt-04');
    const envelope = serialize(input, CONTEXT);
    const integration = integrate(input);

    const unknownKeys = envelope.unsupported.filter((entry) => entry.kind === 'unknown-key');
    expect(unknownKeys.map((entry) => entry.raw)).toEqual([
      'MysteryKey="value"',
      'SecondMystery="value2"',
      // The unknown section's key is preserved as evidence too, after the modelled section's.
      'Note="自由メモ"',
    ]);
    // Two keys in a modelled section carry S_UNKNOWN_KEY; the unknown section is one
    // S_UNKNOWN_SECTION finding, so its key is evidence without a second key-level code.
    expect(
      envelope.diagnostics.filter((diagnostic) => diagnostic.code === 'S_UNKNOWN_KEY'),
    ).toHaveLength(2);
    // `txt-04`'s sections are modelled or unknown, never a known-but-unprojected kind, so the
    // envelope adds no record to Integration's list here (stage 6-A evidence block covers that).
    expect(envelope.unsupported).toEqual(integration.unsupported);
  });

  it('keeps legacy presentation keys as uninterpreted attributes with raw text and spans', () => {
    const envelope = serialize(pipelineFor('fmt-03'), CONTEXT);
    const entity = objectOfKind(envelope.schema?.objects ?? [], 'entity');

    expect(entity.attributes.map((attribute) => attribute.key)).toEqual(['Page', 'Left', 'Top']);
    expect(entity.attributes.map((attribute) => attribute.disposition)).toEqual([
      'legacy',
      'legacy',
      'legacy',
    ]);
    expect(entity.attributes.map((attribute) => attribute.raw)).toEqual(['"1"', '"10"', '"10"']);
    expect(entity.attributes.map((attribute) => attribute.span?.startLine)).toEqual([10, 11, 12]);
    expect(entity.attributes[0]?.value).toEqual({
      status: 'decoded',
      kind: 'string',
      value: '1',
    });
  });

  it('keeps every repeated Manager scalar, in file order', () => {
    const envelope = serialize(pipelineFor('txt-06'), CONTEXT);
    const projectNames = envelope.schema?.manager.attributes.filter(
      (attribute) => attribute.key === 'ProjectName',
    );

    expect(projectNames?.map((attribute) => attribute.raw)).toEqual([
      '"first_manager"',
      '"second_manager"',
    ]);
    expect(projectNames?.map((attribute) => attribute.value)).toEqual([
      { status: 'decoded', kind: 'string', value: 'first_manager' },
      { status: 'decoded', kind: 'string', value: 'second_manager' },
    ]);
    expect(envelope.schema?.pages).toHaveLength(2);
  });

  it('marks a defaulted value as defaulted, with no raw text and no span', () => {
    const envelope = serialize(pipelineFor('sem-07'), CONTEXT);
    const entity = objectOfKind(envelope.schema?.objects ?? [], 'entity');

    if (entity.kind !== 'entity') throw new Error('entity projection lost its kind');
    expect(entity.effectiveColumns.status).toBe('complete');
    expect(entity.effectiveColumns.usingCommonColumns).toEqual({
      value: 1,
      origin: 'defaulted',
      raw: '',
      span: null,
      token: 'absent',
    });
    expect(entity.effectiveColumns.common.map((column) => column.pname)).toContain('common_id');
    expect(entity.fields[0]?.physicalName.value).toBe('id');
    expect(entity.fields[0]?.physicalName.raw).toBe('"id"');
    expect(entity.fields[0]?.physicalName.span).not.toBeNull();
    expect(entity.fields.some((field) => field.color !== null)).toBe(true);
    expect(envelope.schema?.domains).toHaveLength(1);
    expect(envelope.schema?.commonFields).toHaveLength(1);
  });
});

describe('json envelope — incomplete and unreadable data', () => {
  it('keeps a partial or indeterminate key as a status, never as an empty key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-json-'));
    const path = join(directory, 'broken-key.a5er');
    try {
      writeFileSync(
        path,
        [
          '# A5:ER FORMAT:21',
          '',
          '[Manager]',
          'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
          // A registered integer key with a token its type cannot read: an `invalid` attribute.
          'DecodeDomain=abc',
          '',
          '[Entity]',
          'PName="partial_key"',
          'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
          'Field="BAD","bad","Integer","",9007199254740993,"","",$FFFFFFFF,"",""',
          'Position="Main",10,10',
          '',
          '[Entity]',
          'PName="indeterminate_key"',
          'Field="BAD","bad","Integer","",9007199254740993,"","",$FFFFFFFF,"",""',
          'Position="Main",20,20',
          '',
          '[Entity]',
          'PName="odd_position"',
          'Position="Main",10,20,30',
          '',
        ].join('\n'),
      );

      const input = inputFromPath(path);
      const envelope = serialize(input, { command: 'inspect', path });
      const entities = (envelope.schema?.objects ?? []).filter(
        (object) => object.kind === 'entity',
      );
      expect(entities).toHaveLength(3);

      const partial = entities[0];
      if (partial?.kind !== 'entity') throw new Error('partial key object lost its kind');
      expect(partial.primaryKey.status).toBe('partial');
      if (partial.primaryKey.status !== 'partial') throw new Error('partial key was not partial');
      expect(partial.primaryKey.value).toEqual(['id']);
      expect(partial.primaryKey.span).toBeNull();
      expect(partial.primaryKey.derivedFrom).toHaveLength(1);
      expect(partial.primaryKey.invalidOrdinals.map((ordinal) => ordinal.raw)).toEqual([
        '9007199254740993',
      ]);

      // The semantic record is the authority; the envelope adds only the JSON span shape.
      const indeterminateKey = input.semantics.indeterminateKeys.find(
        (candidate) => candidate.object === 'indeterminate_key',
      );
      if (indeterminateKey === undefined) throw new Error('no indeterminate key was derived');
      const indeterminate = entities[1];
      if (indeterminate?.kind !== 'entity') throw new Error('indeterminate object lost its kind');
      expect(indeterminate.primaryKey).toEqual({
        status: 'indeterminate',
        invalidOrdinals: indeterminateKey.invalidOrdinals.map((ordinal) => ({
          raw: ordinal.raw,
          span: jsonSpanOf(ordinal.span),
        })),
      });
      expect(Object.prototype.hasOwnProperty.call(indeterminate.primaryKey, 'value')).toBe(false);

      // A `Position` whose arity does not fit its grammar is kept as a placement record and as
      // evidence; it is never truncated to the first elements and never dropped.
      const odd = entities[2];
      if (odd?.kind !== 'entity') throw new Error('odd-position object lost its kind');
      expect(odd.positions).toHaveLength(1);
      expect(odd.positions[0]?.kind).toBe('unsupported');
      if (odd.positions[0]?.kind !== 'unsupported') throw new Error('position was interpreted');
      expect(odd.positions[0].reason).toBe('unexpected-element-count');
      expect(odd.positions[0].rawElements).toHaveLength(4);
      expect(envelope.unsupported).toEqual([
        {
          kind: 'unsupported-position',
          sectionKind: 'Entity',
          sectionHeader: '[Entity]',
          key: 'Position',
          raw: '"Main",10,20,30',
          span: jsonSpanOf(odd.positions[0].span),
          reason: 'unexpected-element-count',
        },
      ]);

      const decodeDomain = envelope.schema?.manager.attributes.find(
        (attribute) => attribute.key === 'DecodeDomain',
      );
      const occurrence = input.classification.sections
        .flatMap((section) => section.entries)
        .find((entry) => entry.kind === 'parsed' && entry.occurrence.spec.key === 'DecodeDomain');
      if (occurrence?.kind !== 'parsed' || occurrence.occurrence.span === null) {
        throw new Error('DecodeDomain occurrence is missing from the classification');
      }
      expect(decodeDomain).toEqual({
        key: 'DecodeDomain',
        keyRaw: 'DecodeDomain',
        disposition: 'structured',
        origin: 'declared',
        raw: 'abc',
        span: jsonSpanOf(occurrence.occurrence.span),
        value: { status: 'invalid', kind: 'integer', reason: 'not-an-integer' },
      });
      expect(() => JSON.parse(toJsonString(envelope))).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/**
 * The five `[Relation]` scalars that have a typed slot, the slot each fills, and the JSON type the
 * token must decode to before the slot is filled at all (`src/json/envelope.ts`, §9.2, K7).
 */
const RELATION_SLOTS = [
  { key: 'PName', slot: 'pname', type: 'string' },
  { key: 'RelationType1', slot: 'relationType1', type: 'number' },
  { key: 'RelationType2', slot: 'relationType2', type: 'number' },
  { key: 'Cardinarity1', slot: 'cardinarity1', type: 'string' },
  { key: 'Cardinarity2', slot: 'cardinarity2', type: 'string' },
] as const;

const RELATION_SLOT_KEYS: ReadonlySet<string> = new Set(RELATION_SLOTS.map((entry) => entry.key));

/**
 * The goldens whose `schema.relations` is non-empty — read off the committed expectations, not off
 * this serializer — and therefore the only fixtures D4 could touch.
 */
const RELATION_FIXTURES = ['fmt-01', 'sem-01', 'sem-03', 'txt-01', 'txt-02', 'txt-03', 'txt-09'];

/** Write one document into a throwaway directory, run the real stages, and clean up afterwards. */
function withDocument(
  text: string,
  run: (path: string, input: LoadedIntegrationInput) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-json-6a-'));
  const path = join(directory, 'document.a5er');
  try {
    writeFileSync(path, text);
    run(path, inputFromPath(path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** One span from a section ordinal and one line, for equality without importing `Span` helpers. */
function oneLineSpan(sectionIndex: number, line: number): JsonSpan {
  return { sectionIndex, startLine: line, endLine: line, keyLine: line };
}

describe('json envelope — relation provenance (stage 6-A)', () => {
  it('gives a relation a record span and every declaration of its five interpreted scalars', () => {
    for (const id of RELATION_FIXTURES) {
      const staged = stage(id);
      try {
        const input = inputFromPath(staged.path);
        const envelope = serialize(input, { command: 'inspect', path: staged.path });
        const relations = envelope.schema?.relations ?? [];
        const sections = input.scan.sections.filter((section) => section.kind === 'Relation');

        expect(relations, id).toHaveLength(sections.length);

        for (const [index, section] of sections.entries()) {
          const relation = relations[index];
          if (relation === undefined)
            throw new Error(`${id}: relation ${String(index)} is missing`);
          const where = `${id}.relations[${String(index)}]`;

          // The record anchor is the last `PName` line, else the header line — the same
          // convention `JsonObjectBase.span` follows. No fixture relation declares a `PName`, so
          // here it is the header line; either way it is never one of the value lines below.
          const pnameLines = section.entries.flatMap((entry) =>
            entry.kind === 'key' && entry.key === 'PName' ? [entry.span.startLine] : [],
          );
          const anchor = pnameLines.at(-1) ?? section.headerSpan.startLine;
          expect(relation.span, `${where}.span`).toEqual(oneLineSpan(section.index, anchor));
          expect(relation.sectionIndex).toBe(section.index);
          expect(relation.sectionHeader).toBe(section.headerRaw);

          // Every occurrence of the five scalars, straight from the scanner: as-written key text,
          // the value text, and the line. The envelope must show all of them, in file order —
          // duplicates included, which is what last-wins would otherwise erase (§12 rule 4).
          const declared = section.entries.flatMap((entry) =>
            entry.kind === 'key' && RELATION_SLOT_KEYS.has(entry.key) ? [entry] : [],
          );
          expect(
            relation.scalars.map((scalar) => [
              scalar.key,
              scalar.keyRaw,
              scalar.raw,
              scalar.span.startLine,
              scalar.span.sectionIndex,
              scalar.origin,
            ]),
            `${where}.scalars`,
          ).toEqual(
            declared.map((record) => [
              record.key,
              record.key,
              record.value,
              record.span.startLine,
              section.index,
              'declared',
            ]),
          );

          // A value's raw text is on the line the record points at; nothing was re-derived.
          for (const [position, scalar] of relation.scalars.entries()) {
            expect(declared[position]?.raw, `${where}.scalars[${String(position)}].raw`).toContain(
              scalar.raw,
            );
          }

          // The typed slot is the terminal occurrence, and it keeps that occurrence's own text and
          // line. A terminal token that does not decode leaves the slot unknown (R26) instead of
          // resurrecting an earlier value.
          const classified = input.classification.sections.find(
            (candidate) => candidate.index === section.index,
          );
          if (classified === undefined) {
            throw new Error(`${id}: section ${String(section.index)} is not classified`);
          }
          const parsed = classified.entries.flatMap((entry) =>
            entry.kind === 'parsed' ? [entry.occurrence] : [],
          );
          for (const slotSpec of RELATION_SLOTS) {
            const occurrences = parsed.filter((occurrence) => occurrence.spec.key === slotSpec.key);
            const last = occurrences.at(-1);
            const selected: unknown = relation[slotSpec.slot];
            if (last === undefined) {
              expect(selected, `${where}.${slotSpec.slot}: key never appeared`).toBeNull();
              continue;
            }
            expect(
              last.span,
              `${where}.${slotSpec.key}: declared occurrence has a line`,
            ).not.toBeNull();
            if (last.span === null) throw new Error(`${where}: unreachable`);
            const decoded = last.decoded;
            const value = decoded.ok ? decoded.value.value : null;
            if (value === null || typeof value !== slotSpec.type) {
              expect(
                selected,
                `${where}.${slotSpec.slot}: terminal token did not decode`,
              ).toBeNull();
              continue;
            }
            expect(selected, `${where}.${slotSpec.slot}: last-wins`).toEqual({
              value,
              origin: 'declared',
              raw: last.raw,
              span: jsonSpanOf(last.span),
            });
          }

          // The semantic record and the envelope read the same occurrences: neither may silently
          // disagree about what the file means, and the envelope adds only provenance.
          const semantic = input.semantics.relations[index];
          if (semantic === undefined)
            throw new Error(`${id}: no semantic relation ${String(index)}`);
          expect(relation.pname?.value ?? null, `${where}.pname`).toBe(semantic.pname);
          expect(relation.relationType1?.value ?? null, `${where}.relationType1`).toBe(
            semantic.relationType1,
          );
          expect(relation.relationType2?.value ?? null, `${where}.relationType2`).toBe(
            semantic.relationType2,
          );
          expect(relation.cardinarity1?.value ?? null, `${where}.cardinarity1`).toBe(
            semantic.cardinarity1,
          );
          expect(relation.cardinarity2?.value ?? null, `${where}.cardinarity2`).toBe(
            semantic.cardinarity2,
          );

          // A projected key is never also an attribute: that would report one source line twice.
          for (const attribute of relation.attributes) {
            expect(RELATION_SLOT_KEYS.has(attribute.key), `${where}.${attribute.key}`).toBe(false);
          }
        }
      } finally {
        staged.cleanup();
      }
    }
  });

  it('keeps every duplicate relation scalar, including one its type cannot decode', () => {
    // Adversarial by construction: one repeated integer (both readable), one repeated integer whose
    // terminal token is not an integer, one repeated text, and a `PName` on its own line so the
    // record anchor and the value lines cannot be confused.
    const text = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      '',
      '[Entity]',
      'PName="alpha"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
      '',
      '[Entity]',
      'PName="beta"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",20,20',
      '',
      '[Relation]',
      'PName="rel_one"',
      'RelationType1=2',
      'RelationType1=5',
      'RelationType2=4',
      'RelationType2=bad',
      'Cardinarity1="P"',
      'Cardinarity1="Z"',
      'Cardinarity2="Z"',
      'Position="Main",0,100,100,100,R,R,""',
      '',
    ].join('\n');

    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const relation = envelope.schema?.relations[0];
      if (relation === undefined) throw new Error('the duplicate relation is missing');

      // Lines 17-24 are the relation's own; the header is line 16. The anchor is the `PName` line.
      expect(relation.span).toEqual(oneLineSpan(4, 17));
      expect(relation.sectionHeader).toBe('[Relation]');
      expect(relation.pname).toEqual({
        value: 'rel_one',
        origin: 'declared',
        raw: '"rel_one"',
        span: oneLineSpan(4, 17),
      });

      expect(
        relation.scalars.map((scalar) => [scalar.key, scalar.raw, scalar.span.startLine]),
      ).toEqual([
        ['PName', '"rel_one"', 17],
        ['RelationType1', '2', 18],
        ['RelationType1', '5', 19],
        ['RelationType2', '4', 20],
        ['RelationType2', 'bad', 21],
        ['Cardinarity1', '"P"', 22],
        ['Cardinarity1', '"Z"', 23],
        ['Cardinarity2', '"Z"', 24],
      ]);

      // An unreadable terminal token is kept as evidence with its reason, not dropped and not
      // silently reinterpreted (R26).
      expect(relation.scalars[4]?.value).toEqual({
        status: 'invalid',
        kind: 'integer',
        reason: 'not-an-integer',
      });
      expect(relation.scalars[2]?.value).toEqual({ status: 'decoded', kind: 'integer', value: 5 });

      // Last-wins: the slot follows the terminal occurrence — including to `null` — and still
      // carries that occurrence's raw text and line.
      expect(relation.relationType1).toEqual({
        value: 5,
        origin: 'declared',
        raw: '5',
        span: oneLineSpan(4, 19),
      });
      expect(relation.relationType2).toBeNull();
      expect(relation.cardinarity1).toEqual({
        value: 'Z',
        origin: 'declared',
        raw: '"Z"',
        span: oneLineSpan(4, 23),
      });

      // The overwritten declarations are still in the document, text and line both.
      const json = toJsonString(envelope);
      for (const raw of ['"5"', '"P"', '"bad"']) expect(json).toContain(raw);

      // The repetition is reported, once per extra occurrence, and nothing else is invented.
      const duplicates = envelope.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'S_DUPLICATE_KEY',
      );
      expect(duplicates.map((diagnostic) => diagnostic.details['key'])).toEqual([
        'RelationType1',
        'RelationType2',
        'Cardinarity1',
      ]);
      expect(relation.attributes).toEqual([]);

      // No new code accompanies the evidence.
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'V_MISSING_REQUIRED_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
      ]);
    });
  });
});

describe('json envelope — known sections the model does not resolve (stage 6-A)', () => {
  /**
   * `[Shape]`, `[Line]` and `[Comment]` are recognised kinds with real registries, and §4.5's
   * resolved model has no collection for them. Seven of this document's keys are parsed and then
   * shown nowhere unless the envelope projects them: two `[Comment]` keys, three `[Shape]` keys and
   * two `[Line]` keys. The two padded keys are deliberately *not* registered — the registry is an
   * exact match (§5) — so they arrive as `unknown-key` evidence with their padding intact.
   */
  const text = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
    '[Comment]',
    '  PName  ="sticky"',
    'Width=40',
    'Height=12',
    'MysteryKey="raw note"',
    '',
    '[Shape]',
    'PName="box"',
    'ShapeType="rect"',
    'Position="Main",10,10',
    '',
    '[Line]',
    'PName="connector"',
    '  StartLineTermType =1',
    'Position="Main",20,20',
    'Note="unknown line key"',
    '',
  ].join('\n');

  it('keeps each header and each parsed key as evidence with its original line', () => {
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });

      expect(
        envelope.unsupported.map((entry) => [
          entry.kind,
          entry.sectionKind,
          entry.key,
          entry.raw,
          entry.span.startLine,
          entry.reason,
        ]),
      ).toEqual([
        ['unsupported-construct', 'Comment', null, '[Comment]', 6, 'section-not-in-resolved-model'],
        ['unknown-key', 'Comment', '  PName  ', '  PName  ="sticky"', 7, 'no-registry-entry'],
        ['unsupported-construct', 'Comment', 'Width', 'Width=40', 8, 'key-not-in-resolved-model'],
        ['unsupported-construct', 'Comment', 'Height', 'Height=12', 9, 'key-not-in-resolved-model'],
        ['unknown-key', 'Comment', 'MysteryKey', 'MysteryKey="raw note"', 10, 'no-registry-entry'],
        ['unsupported-construct', 'Shape', null, '[Shape]', 12, 'section-not-in-resolved-model'],
        ['unsupported-construct', 'Shape', 'PName', 'PName="box"', 13, 'key-not-in-resolved-model'],
        [
          'unsupported-construct',
          'Shape',
          'ShapeType',
          'ShapeType="rect"',
          14,
          'key-not-in-resolved-model',
        ],
        [
          'unsupported-construct',
          'Shape',
          'Position',
          'Position="Main",10,10',
          15,
          'key-not-in-resolved-model',
        ],
        ['unsupported-position', 'Shape', 'Position', '"Main",10,10', 15, 'shape-not-documented'],
        ['unsupported-construct', 'Line', null, '[Line]', 17, 'section-not-in-resolved-model'],
        [
          'unsupported-construct',
          'Line',
          'PName',
          'PName="connector"',
          18,
          'key-not-in-resolved-model',
        ],
        [
          'unknown-key',
          'Line',
          '  StartLineTermType ',
          '  StartLineTermType =1',
          19,
          'no-registry-entry',
        ],
        [
          'unsupported-construct',
          'Line',
          'Position',
          'Position="Main",20,20',
          20,
          'key-not-in-resolved-model',
        ],
        ['unsupported-position', 'Line', 'Position', '"Main",20,20', 20, 'shape-not-documented'],
        ['unknown-key', 'Line', 'Note', 'Note="unknown line key"', 21, 'no-registry-entry'],
      ]);

      // Every `raw` is the whole original line, whitespace included — read from the scan, never
      // rebuilt from the pieces. `key` is the key text exactly as written, padding and all.
      for (const entry of envelope.unsupported) {
        if (entry.kind === 'unsupported-construct' && entry.key !== null) {
          expect(entry.raw.startsWith(entry.key)).toBe(true);
          expect(entry.raw.at(entry.key.length)).toBe('=');
        }
      }

      // The list is the §12 rule 7 order: by line, then by kind. Two records share a `Position`
      // line on purpose: the line is a key of an unmodelled section, and its value is a position
      // shape the format does not document — two constructs, not one record written twice.
      const lines = envelope.unsupported.map((entry) => entry.span.startLine);
      expect(lines).toEqual([...lines].sort((left, right) => left - right));

      // The two sources cannot overlap: Integration's retained records are lines the registry could
      // not model, this projection only reads parsed keys of three known kinds. Each unknown key
      // therefore appears exactly once.
      for (const key of ['  PName  ', 'MysteryKey', '  StartLineTermType ', 'Note']) {
        expect(
          envelope.unsupported.filter((entry) => entry.key === key),
          `${key} must be reported once`,
        ).toHaveLength(1);
      }

      // Nothing is invented: no `V_*`/`S_*`/`D_*` code accompanies the evidence, and the reasons are
      // stable machine codes rather than file text.
      for (const entry of envelope.unsupported) expect(entry.reason).not.toMatch(/^[DESV]_/);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'V_MISSING_REQUIRED_KEY',
        'S_UNKNOWN_KEY',
        'S_UNKNOWN_KEY',
        'S_UNKNOWN_KEY',
        'S_UNKNOWN_KEY',
      ]);
    });
  });

  it('accounts for every parsed key once and leaves the counts untouched', () => {
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const integration = integrate(input);

      // 4 headers, 12 `key=value` lines: 8 registered keys (1 Manager, 2 Comment, 3 Shape, 2 Line)
      // and 4 unknown keys (the two padded spellings and two keys no registry defines).
      expect(envelope.completeness).toEqual({
        sections: { total: 4, parsed: 4, preservedRaw: 0, unknown: 0 },
        keys: { total: 12, parsed: 8, preservedRaw: 4 },
        lines: { total: 21, accounted: 21, dropped: 0 },
        dropped: 0,
      });
      // Evidence is not a third partition: the counters are Integration's, unchanged.
      expect(envelope.completeness).toEqual(integration.completeness);

      // Every parsed occurrence of an unrepresented kind is evidence, exactly once and in file
      // order — so `keys.parsed` cannot claim a key the envelope never shows.
      const unrepresented = input.classification.sections.filter((section) =>
        ['Shape', 'Line', 'Comment'].includes(section.kind),
      );
      const parsedKeys = unrepresented.flatMap((section) =>
        section.entries.flatMap((entry) =>
          entry.kind === 'parsed' && entry.occurrence.span !== null
            ? [[section.index, entry.occurrence.span.keyLine]]
            : [],
        ),
      );
      const projectedKeys = envelope.unsupported.flatMap((entry) =>
        entry.kind === 'unsupported-construct' && entry.key !== null
          ? [[entry.span.sectionIndex, entry.span.startLine]]
          : [],
      );
      expect(projectedKeys).toEqual(parsedKeys);
      expect(parsedKeys).toHaveLength(7);

      // The one parsed key these kinds do not own is `[Manager].PageInfo`, which the model does
      // project: nothing parsed is left without a record somewhere in the envelope.
      expect(envelope.schema?.pages).toHaveLength(1);
      expect(envelope.schema?.objects).toEqual([]);
    });
  });

  it('keeps the header of an unrepresented section that declares nothing', () => {
    // An empty `[Comment]` still exists in the file and is still counted as a parsed section, so
    // its header must be addressable — and no key record may be invented for it.
    const empty = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4","$FFFFFF"',
      '',
      '[Comment]',
      '',
    ].join('\n');

    withDocument(empty, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      expect(envelope.completeness?.sections).toEqual({
        total: 2,
        parsed: 2,
        preservedRaw: 0,
        unknown: 0,
      });
      expect(envelope.unsupported).toEqual([
        {
          kind: 'unsupported-construct',
          sectionKind: 'Comment',
          sectionHeader: '[Comment]',
          key: null,
          raw: '[Comment]',
          span: oneLineSpan(2, 6),
          reason: 'section-not-in-resolved-model',
        },
      ]);
      expect(envelope.schema?.objects).toEqual([]);
      expect(envelope.schema?.relations).toEqual([]);
    });
  });
});
