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
import type { FileSystem, SourceHandle, SourceStat } from '../src/io/fs.js';
import type { Limits } from '../src/io/limits.js';
import { DEFAULT_LIMITS, withLimits } from '../src/io/limits.js';
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
import { CAPPED_READ_LIMIT_BYTES, GENERATED_BUILDERS } from './helpers/generated.js';
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
      'pageReferences',
      'domains',
      'domainReferences',
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
 * The five `[Relation]` scalars whose slot is a `JsonValue`: the slot each fills, and the JSON type
 * the token must decode to before the slot is filled at all (`src/json/envelope.ts`, §9.2, K7).
 */
const RELATION_SLOTS = [
  { key: 'PName', slot: 'pname', type: 'string' },
  { key: 'RelationType1', slot: 'relationType1', type: 'number' },
  { key: 'RelationType2', slot: 'relationType2', type: 'number' },
  { key: 'Cardinarity1', slot: 'cardinarity1', type: 'string' },
  { key: 'Cardinarity2', slot: 'cardinarity2', type: 'string' },
] as const;

/**
 * The four `[Relation]` declarations whose slot is a nested record — the endpoints' `declared`/`raw`/
 * `span` and the column lists' `raw`/`span`. They are retained in `scalars` exactly like the five
 * above (unit 2), and their slot keeps the terminal occurrence.
 */
const RELATION_RECORD_SLOTS = [
  { key: 'Entity1', slot: 'from' },
  { key: 'Entity2', slot: 'to' },
  { key: 'Fields1', slot: 'fromColumns' },
  { key: 'Fields2', slot: 'toColumns' },
] as const;

/** All nine projected `[Relation]` keys, so the expected `scalars` list is the scanner's own. */
const RELATION_SLOT_KEYS: ReadonlySet<string> = new Set([
  ...RELATION_SLOTS.map((entry) => entry.key),
  ...RELATION_RECORD_SLOTS.map((entry) => entry.key),
]);

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

          // Every occurrence of the nine projected keys, straight from the scanner: as-written key text,
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

          // The four declaration-shaped slots follow the same rule with their own shape: their raw
          // text and span are the terminal occurrence's, never a mix of two declarations.
          for (const slotSpec of RELATION_RECORD_SLOTS) {
            const occurrences = parsed.filter((occurrence) => occurrence.spec.key === slotSpec.key);
            const last = occurrences.at(-1);
            const selected = relation[slotSpec.slot];
            if (last === undefined) {
              expect(selected, `${where}.${slotSpec.slot}: key never appeared`).toBeNull();
              continue;
            }
            expect(
              last.span,
              `${where}.${slotSpec.key}: declared occurrence has a line`,
            ).not.toBeNull();
            if (last.span === null) throw new Error(`${where}: unreachable`);
            expect(selected?.raw, `${where}.${slotSpec.slot}.raw: last-wins`).toBe(last.raw);
            expect(selected?.span, `${where}.${slotSpec.slot}.span: last-wins`).toEqual(
              jsonSpanOf(last.span),
            );
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

/**
 * The projected object scalars, per kind: `PName`/`LName`/`Comment` for `[Entity]` and `[View]`,
 * `PName` alone for `[Subtype]` — the registry (v2.21) declares no `LName` and no `Comment` for it.
 */
const OBJECT_SCALAR_KEYS: Readonly<Record<'entity' | 'view' | 'subtype', readonly string[]>> = {
  entity: ['PName', 'LName', 'Comment', 'UsingCommonColumns'],
  view: ['PName', 'LName', 'Comment', 'Query', 'LNameByComment'],
  subtype: ['PName', 'SharedMode', 'CompleteCategory', 'ZOrder'],
};

describe('json envelope — object scalar provenance (stage 6-B)', () => {
  it('keeps every duplicate object scalar, in file order, with the slots on the terminal one', () => {
    // One document with each kind's own case: `[Entity]` repeats `LName` and `Comment`, `[View]`
    // repeats `PName`, and `[Subtype]` repeats the only scalar it has. Nothing else repeats, so the
    // four `S_DUPLICATE_KEY` findings are exactly the four scalars this unit retains.
    const text = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      '',
      '[Entity]',
      'PName="alpha"',
      'LName="Alpha"',
      'LName="AlphaRenamed"',
      'Comment="first note"',
      'Comment="second note"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
      '',
      '[View]',
      'PName="report"',
      'PName="report_v2"',
      'LName="Report"',
      'Comment="view note"',
      'Query="select 1"',
      'Position="Main",20,20',
      '',
      '[Subtype]',
      'PName="sub"',
      'PName="sub2"',
      'Position="Main",30,30',
      '',
    ].join('\n');

    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const objects = envelope.schema?.objects ?? [];
      const [entity, view, subtype] = objects;
      if (entity === undefined || view === undefined || subtype === undefined) {
        throw new Error('the three object projections are missing');
      }

      expect(objects.map((object) => object.kind)).toEqual(['entity', 'view', 'subtype']);

      // The anchor is the last `PName` line in the section: 7, 17 and 25 — not the overwritten one.
      expect(entity.span).toEqual(oneLineSpan(2, 7));
      expect(view.span).toEqual(oneLineSpan(3, 17));
      expect(subtype.span).toEqual(oneLineSpan(4, 25));

      // Every declaration is a record, in file order, with its own text and its own line.
      expect(
        entity.scalars.map((scalar) => [
          scalar.key,
          scalar.keyRaw,
          scalar.origin,
          scalar.raw,
          scalar.span.startLine,
        ]),
      ).toEqual([
        ['PName', 'PName', 'declared', '"alpha"', 7],
        ['LName', 'LName', 'declared', '"Alpha"', 8],
        ['LName', 'LName', 'declared', '"AlphaRenamed"', 9],
        ['Comment', 'Comment', 'declared', '"first note"', 10],
        ['Comment', 'Comment', 'declared', '"second note"', 11],
      ]);
      expect(view.scalars.map((scalar) => [scalar.key, scalar.raw, scalar.span.startLine])).toEqual(
        [
          ['PName', '"report"', 16],
          ['PName', '"report_v2"', 17],
          ['LName', '"Report"', 18],
          ['Comment', '"view note"', 19],
          // `Query` is a single-fact slot, so it is retained the same way (unit 2).
          ['Query', '"select 1"', 20],
        ],
      );
      expect(
        subtype.scalars.map((scalar) => [scalar.key, scalar.raw, scalar.span.startLine]),
      ).toEqual([
        ['PName', '"sub"', 24],
        ['PName', '"sub2"', 25],
      ]);

      // The slots hold the occurrence §4.2's last-wins rule selects — never an earlier, readable one.
      expect(entity.pname?.value).toBe('alpha');
      expect(entity.lname).toEqual({
        value: 'AlphaRenamed',
        origin: 'declared',
        raw: '"AlphaRenamed"',
        span: oneLineSpan(2, 9),
      });
      expect(entity.comment).toEqual({
        value: 'second note',
        origin: 'declared',
        raw: '"second note"',
        span: oneLineSpan(2, 11),
      });
      expect(view.pname).toEqual({
        value: 'report_v2',
        origin: 'declared',
        raw: '"report_v2"',
        span: oneLineSpan(3, 17),
      });
      expect(subtype.pname).toEqual({
        value: 'sub2',
        origin: 'declared',
        raw: '"sub2"',
        span: oneLineSpan(4, 25),
      });

      // A subtype has no slot to fill: the registry declares no `LName` and no `Comment` for it, so
      // neither is invented as a null-*shaped* scalar record here either.
      expect(subtype.lname).toBeNull();
      expect(subtype.comment).toBeNull();

      // The token is the same shape `attributes` uses. None of *these* records can be `invalid`:
      // `PName`/`LName`/`Query` are registry-typed `string` and `Comment` is `escaped`, and
      // `decodeValue` never fails for those two types. The integer, boolean and complex fact keys
      // added in unit 2 do have unreadable terminals, and their own case below pins them.
      expect(entity.scalars.map((scalar) => scalar.value)).toEqual([
        { status: 'decoded', kind: 'string', value: 'alpha' },
        { status: 'decoded', kind: 'string', value: 'Alpha' },
        { status: 'decoded', kind: 'string', value: 'AlphaRenamed' },
        { status: 'decoded', kind: 'escaped', value: 'first note' },
        { status: 'decoded', kind: 'escaped', value: 'second note' },
      ]);

      // A projected scalar is never also an attribute: one source line is reported once.
      for (const object of objects) {
        for (const attribute of object.attributes) {
          expect(OBJECT_SCALAR_KEYS[object.kind], `${object.kind}.${attribute.key}`).not.toContain(
            attribute.key,
          );
        }
      }

      // The overwritten values are still in the document, text and line both.
      const json = toJsonString(envelope);
      for (const raw of ['"Alpha"', '"first note"', '"report"', '"sub"']) {
        expect(json).toContain(raw);
      }

      // Reported once per extra occurrence, in file order, and nothing new is invented.
      const duplicates = envelope.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'S_DUPLICATE_KEY',
      );
      expect(
        duplicates.map((diagnostic) => [
          diagnostic.details['key'],
          diagnostic.details['occurrences'],
          diagnostic.span?.startLine,
        ]),
      ).toEqual([
        ['LName', 2, 9],
        ['Comment', 2, 11],
        ['PName', 2, 17],
        ['PName', 2, 25],
      ]);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'V_VIEW_COLUMNS_UNKNOWN',
        'S_DUPLICATE_KEY',
        'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
      ]);

      // Counts, completeness and the one unsupported record are the document's own; `scalars` is
      // evidence and does not move any of them. 4 sections, 17 parsed keys, no dropped line.
      expect(envelope.completeness).toEqual({
        sections: { total: 4, parsed: 4, preservedRaw: 0, unknown: 0 },
        keys: { total: 17, parsed: 17, preservedRaw: 0 },
        lines: { total: 26, accounted: 26, dropped: 0 },
        dropped: 0,
      });
      expect(
        envelope.unsupported.map((entry) => [entry.kind, entry.sectionKind, entry.key]),
      ).toEqual([['subtype-membership', 'Subtype', null]]);
    });
  });

  it('never turns a line that is not a key-value declaration into a scalar record', () => {
    // `LName` with no `=`: §7.3 makes it `multiline-value` evidence plus `S_MALFORMED_LINE`, not a
    // declaration of `LName`. It must neither add a `scalars` record nor blank the slot — the slot
    // follows the last *declaration*, and a line that is not a token at all is `unsupported`
    // evidence, not an unreadable token. This bounds the 6-B change; it is not a retention gap.
    const text = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      '',
      '[Entity]',
      'PName="alpha"',
      'LName="Alpha"',
      'LName',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
      '',
    ].join('\n');

    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const entity = envelope.schema?.objects[0];
      if (entity === undefined) throw new Error('the entity projection is missing');

      expect(
        entity.scalars.map((scalar) => [scalar.key, scalar.raw, scalar.span.startLine]),
      ).toEqual([
        ['PName', '"alpha"', 7],
        ['LName', '"Alpha"', 8],
      ]);
      expect(entity.lname).toEqual({
        value: 'Alpha',
        origin: 'declared',
        raw: '"Alpha"',
        span: oneLineSpan(2, 8),
      });

      // The raw line is still kept, as its own evidence record — never as a phantom default.
      expect(
        envelope.unsupported.map((entry) => [entry.kind, entry.sectionKind, entry.key, entry.raw]),
      ).toEqual([['multiline-value', 'Entity', null, 'LName']]);
      expect(
        envelope.diagnostics.map((diagnostic) => [
          diagnostic.code,
          diagnostic.span?.startLine ?? null,
        ]),
      ).toEqual([
        ['D_BOM_MISSING', null],
        ['S_MALFORMED_LINE', 9],
      ]);
    });
  });
});

describe('json envelope — single-fact scalar provenance (stage 6-B unit 2)', () => {
  it('keeps every declaration of a fact-shaped slot, with the slots on the terminal one', () => {
    // One document, every single-fact key repeated, and every terminal token chosen to be either
    // unreadable or a different value than the first — so "last-wins" cannot be satisfied by
    // reaching backwards. `UsingCommonColumns=7` and `ZOrder=abc` are unreadable; `LNameByComment`
    // is a boolean whose terminal is not `1`/`0`; `Entity1` and `Fields1` repeat a nested slot.
    const text = [
      '# A5:ER FORMAT:21', // 1
      '', // 2
      '[Manager]', // 3
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"', // 4
      '', // 5
      '[Entity]', // 6 — object 1, section 2
      'PName="alpha"', // 7
      'UsingCommonColumns=1', // 8
      'UsingCommonColumns=7', // 9
      'Field="ID","ID","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""', // 10
      'Position="Main",10,10', // 11
      '', // 12
      '[Entity]', // 13 — object 2, section 3 (no `UsingCommonColumns`: the default)
      'PName="beta"', // 14
      'Field="ID","ID","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""', // 15
      'Position="Main",20,20', // 16
      '', // 17
      '[View]', // 18 — object 3, section 4
      'PName="v"', // 19
      'Query="select 1"', // 20
      'Query="select 2"', // 21
      'LNameByComment=1', // 22
      'LNameByComment=maybe', // 23
      'Position="Main",30,30', // 24
      '', // 25
      '[Subtype]', // 26 — object 4, section 5
      'PName="s"', // 27
      'SharedMode=0', // 28
      'SharedMode=2', // 29
      'CompleteCategory=0', // 30
      'CompleteCategory=1', // 31
      'ZOrder=1', // 32
      'ZOrder=abc', // 33
      'Position="Main",40,40', // 34
      '', // 35
      '[Relation]', // 36 — section 6
      'Entity1="alpha"', // 37
      'Entity1="beta"', // 38
      'Entity2="alpha"', // 39
      'RelationType1=2', // 40
      'RelationType2=4', // 41
      'Fields1="ID"', // 42
      'Fields1="ID"', // 43
      'Fields2="ID"', // 44
      'Position="Main",0,1,1,1,R,R,""', // 45
      '', // 46
    ].join('\n');

    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const objects = envelope.schema?.objects ?? [];
      const [alpha, beta, view, subtype] = objects;
      const relation = envelope.schema?.relations[0];
      if (
        alpha === undefined ||
        beta === undefined ||
        view === undefined ||
        subtype === undefined ||
        relation === undefined
      ) {
        throw new Error('the projections are missing');
      }
      if (alpha.kind !== 'entity' || beta.kind !== 'entity') {
        throw new Error('an entity projection lost its kind');
      }
      if (view.kind !== 'view') throw new Error('the view projection lost its kind');
      if (subtype.kind !== 'subtype') throw new Error('the subtype projection lost its kind');

      // Every declaration, in file order. `scalars` is the history behind the slots, so it is never
      // shorter than the slots and never repeats a line.
      const triples = (scalars: readonly { key: string; raw: string; span: JsonSpan }[]) =>
        scalars.map((scalar) => [scalar.key, scalar.raw, scalar.span.startLine]);
      for (const [scalars, sectionIndex] of [
        [alpha.scalars, 2],
        [beta.scalars, 3],
        [view.scalars, 4],
        [subtype.scalars, 5],
        [relation.scalars, 6],
      ] as const) {
        const lines = scalars.map((scalar) => scalar.span.startLine);
        expect(new Set(lines).size, 'one record per physical line').toBe(lines.length);
        expect(lines, 'file order').toEqual([...lines].sort((left, right) => left - right));
        for (const scalar of scalars) {
          expect(scalar.origin).toBe('declared');
          expect(scalar.keyRaw).toBe(scalar.key);
          expect(scalar.span.sectionIndex).toBe(sectionIndex);
          expect(scalar.span.endLine).toBe(scalar.span.startLine);
          expect(scalar.span.keyLine).toBe(scalar.span.startLine);
        }
      }

      expect(triples(alpha.scalars)).toEqual([
        ['PName', '"alpha"', 7],
        ['UsingCommonColumns', '1', 8],
        ['UsingCommonColumns', '7', 9],
      ]);
      // The defaulted `UsingCommonColumns` of the second entity is not a declaration: no line, no
      // record. Only the slot says `defaulted`.
      expect(triples(beta.scalars)).toEqual([['PName', '"beta"', 14]]);
      expect(triples(view.scalars)).toEqual([
        ['PName', '"v"', 19],
        ['Query', '"select 1"', 20],
        ['Query', '"select 2"', 21],
        ['LNameByComment', '1', 22],
        ['LNameByComment', 'maybe', 23],
      ]);
      expect(triples(subtype.scalars)).toEqual([
        ['PName', '"s"', 27],
        ['SharedMode', '0', 28],
        ['SharedMode', '2', 29],
        ['CompleteCategory', '0', 30],
        ['CompleteCategory', '1', 31],
        ['ZOrder', '1', 32],
        ['ZOrder', 'abc', 33],
      ]);
      expect(triples(relation.scalars)).toEqual([
        ['Entity1', '"alpha"', 37],
        ['Entity1', '"beta"', 38],
        ['Entity2', '"alpha"', 39],
        ['RelationType1', '2', 40],
        ['RelationType2', '4', 41],
        ['Fields1', '"ID"', 42],
        ['Fields1', '"ID"', 43],
        ['Fields2', '"ID"', 44],
      ]);

      // The token keeps both statuses: an integer that is not `1`/`0` still *decodes* (it is the
      // slot that calls it unrecognised), while a non-integer and a non-boolean are `invalid`.
      expect(alpha.scalars.map((scalar) => scalar.value)).toEqual([
        { status: 'decoded', kind: 'string', value: 'alpha' },
        { status: 'decoded', kind: 'integer', value: 1 },
        { status: 'decoded', kind: 'integer', value: 7 },
      ]);
      expect(view.scalars.slice(3).map((scalar) => scalar.value)).toEqual([
        { status: 'decoded', kind: 'boolean', value: true },
        { status: 'invalid', kind: 'boolean', reason: 'not-a-boolean' },
      ]);
      expect(subtype.scalars.slice(5).map((scalar) => scalar.value)).toEqual([
        { status: 'decoded', kind: 'integer', value: 1 },
        { status: 'invalid', kind: 'integer', reason: 'not-an-integer' },
      ]);
      // `Fields1` is a Complex token: the JSON value is the elements, one per slot, never a string.
      expect(relation.scalars.slice(5, 7).map((scalar) => scalar.value)).toEqual([
        {
          status: 'decoded',
          kind: 'complex',
          value: {
            parts: [{ value: 'ID', quoted: true, hadEscape: false }],
            trailingElementsOmitted: false,
          },
        },
        {
          status: 'decoded',
          kind: 'complex',
          value: {
            parts: [{ value: 'ID', quoted: true, hadEscape: false }],
            trailingElementsOmitted: false,
          },
        },
      ]);

      // Last-wins: the slot is the terminal declaration, and an unreadable terminal stays unknown
      // instead of resurrecting the readable first one (R26).
      expect(alpha.effectiveColumns.status).toBe('partial');
      expect(alpha.effectiveColumns.usingCommonColumns).toEqual({
        value: null,
        origin: 'declared',
        raw: '7',
        span: oneLineSpan(2, 9),
        token: 'unrecognised',
      });
      expect(beta.effectiveColumns.usingCommonColumns).toEqual({
        value: 1,
        origin: 'defaulted',
        raw: '',
        span: null,
        token: 'absent',
      });
      expect(view.query).toBe('select 2');
      expect(view.queryRaw).toBe('"select 2"');
      expect(view.querySpan).toEqual(oneLineSpan(4, 21));
      expect(view.lnameByComment).toEqual({
        value: null,
        origin: 'invalid',
        raw: 'maybe',
        span: oneLineSpan(4, 23),
        token: 'unrecognised',
      });
      expect(subtype.sharedMode).toEqual({
        value: '2',
        raw: '2',
        span: oneLineSpan(5, 29),
        token: 'declared',
      });
      expect(subtype.completeCategory).toEqual({
        value: '1',
        raw: '1',
        span: oneLineSpan(5, 31),
        token: 'declared',
      });
      expect(subtype.zOrder).toEqual({
        value: null,
        raw: 'abc',
        span: oneLineSpan(5, 33),
        token: 'unrecognised',
      });
      expect(relation.from).toMatchObject({
        key: 'Entity1',
        declared: 'beta',
        raw: '"beta"',
        span: oneLineSpan(6, 38),
        status: 'resolved',
        resolvedEntity: 'beta',
      });
      expect(relation.to).toMatchObject({
        key: 'Entity2',
        declared: 'alpha',
        raw: '"alpha"',
        span: oneLineSpan(6, 39),
      });
      expect(relation.fromColumns?.raw).toBe('"ID"');
      expect(relation.fromColumns?.span).toEqual(oneLineSpan(6, 43));
      expect(relation.toColumns?.raw).toBe('"ID"');
      expect(relation.toColumns?.span).toEqual(oneLineSpan(6, 44));

      // A projected key is never also an attribute, and the count of records is the count of
      // physical key lines — the projections do not re-count the same line.
      for (const object of objects) {
        const keys = new Set(OBJECT_SCALAR_KEYS[object.kind]);
        for (const attribute of object.attributes) {
          expect(keys.has(attribute.key), `${object.kind}.${attribute.key}`).toBe(false);
        }
      }
      const relationKeys = new Set([
        'PName',
        'RelationType1',
        'RelationType2',
        'Cardinarity1',
        'Cardinarity2',
        'Entity1',
        'Entity2',
        'Fields1',
        'Fields2',
      ]);
      for (const attribute of relation.attributes) {
        expect(relationKeys.has(attribute.key), `relation.${attribute.key}`).toBe(false);
      }
      expect(
        [
          alpha.scalars.length,
          beta.scalars.length,
          view.scalars.length,
          subtype.scalars.length,
          relation.scalars.length,
        ].reduce((sum, count) => sum + count, 0),
      ).toBe(24);

      // One finding per extra occurrence, in file order, and nothing else is invented.
      expect(
        envelope.diagnostics
          .filter((diagnostic) => diagnostic.code === 'S_DUPLICATE_KEY')
          .map((diagnostic) => [
            diagnostic.details['key'],
            diagnostic.details['occurrences'],
            diagnostic.span?.startLine,
          ]),
      ).toEqual([
        ['UsingCommonColumns', 2, 9],
        ['Query', 2, 21],
        ['LNameByComment', 2, 23],
        ['SharedMode', 2, 29],
        ['CompleteCategory', 2, 31],
        ['ZOrder', 2, 33],
        ['Entity1', 2, 38],
        ['Fields1', 2, 43],
      ]);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'S_DUPLICATE_KEY',
        'V_VIEW_COLUMNS_UNKNOWN',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
        'S_DUPLICATE_KEY',
      ]);

      // Retention moves no counter: 6 sections, 32 parsed keys, 45 physical lines, nothing dropped.
      expect(envelope.completeness).toEqual({
        sections: { total: 6, parsed: 6, preservedRaw: 0, unknown: 0 },
        keys: { total: 32, parsed: 32, preservedRaw: 0 },
        lines: { total: 45, accounted: 45, dropped: 0 },
        dropped: 0,
      });
      // The one unmodelled construct is the subtype's membership; the repeated keys are findings,
      // not unsupported evidence.
      expect(
        envelope.unsupported.map((entry) => [entry.kind, entry.sectionKind, entry.key]),
      ).toEqual([['subtype-membership', 'Subtype', null]]);

      // Both retained copies are still in the document, text and line both.
      const json = toJsonString(envelope);
      for (const raw of ['"alpha"', '"beta"', '"select 1"', 'maybe', 'abc']) {
        expect(json).toContain(raw);
      }
    });
  });
});
describe('json envelope — page and domain references (stage 6-B unit 3)', () => {
  /**
   * One document that names every outcome the two reference lists can carry.
   *
   * Three `PageInfo` declarations (`Main`, and the case-variant pair `Dup`/`dup`), three
   * `DomainInfo` declarations (`int_domain`, and the case-variant pair `Name`/`name`), and one
   * `Field` per outcome. Nothing here is taken from a golden: every expected line number is the
   * line the token is written on below, and the assertions re-read that line by number.
   */
  const text = [
    '# A5:ER FORMAT:21', // 1
    '', // 2
    '[Manager]', // 3 — section 1
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"', // 4
    'PageInfo="Dup",3,"A4","$000000"', // 5
    'PageInfo="dup",2,"A3","$FFFFFF"', // 6
    'DomainInfo="int_domain","INTEGER","",""', // 7
    'DomainInfo="Name","TEXT","",""', // 8
    'DomainInfo="name","VARCHAR","",""', // 9
    '', // 10
    '[Entity]', // 11 — section 2
    'PName="orders"', // 12
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""', // 13 — plain
    'Field="NM","nm","@INT","",,"","",$FFFFFFFF,""', // 14 — system, known
    'Field="AMT","amt","@NOPE","",,"","",$FFFFFFFF,""', // 15 — system, unknown
    'Field="LV","lv","INT_DOMAIN","",,"","",$FFFFFFFF,""', // 16 — resolved
    'Field="DN","dn","NAME","",,"","",$FFFFFFFF,""', // 17 — ambiguous
    'Field="TX","tx","Integer","",,"","",$FFFFFFFF,""', // 18 — plain
    'Position="MAIN",10,10', // 19 — resolved to `Main`
    '', // 20
    '[Entity]', // 21 — section 3
    'PName="dup_use"', // 22
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""', // 23
    'Position="Dup",20,20', // 24 — ambiguous over lines 5 and 6
    '', // 25
    '[Relation]', // 26 — section 4
    'Entity1="orders"', // 27
    'Entity2="dup_use"', // 28
    'Fields1="id"', // 29
    'Fields2="id"', // 30
    'RelationType1=2', // 31
    'RelationType2=4', // 32
    'Position="Ghost",0,1,1,1,R,R,""', // 33 — dangling
    '', // 34
  ].join('\n');
  it('projects every placement, its own line and the page it resolved to', () => {
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const references = envelope.schema?.pageReferences ?? [];
      // One record per `Position`, in file order — the unsupported shapes are the only skip, and
      // this document has none.
      expect(
        references.map((reference) => [reference.span.keyLine, reference.sectionIndex]),
      ).toEqual([
        [19, 2],
        [24, 3],
        [33, 4],
      ]);
      const [main, duplicate, ghost] = references;
      if (main === undefined || duplicate === undefined || ghost === undefined) {
        throw new Error('a placement lost its reference record');
      }
      // A case-insensitive match reports both spellings: the request as written and the one
      // declaration that matched it, with that declaration's own line.
      expect(main).toEqual({
        sectionIndex: 2,
        sectionKind: 'Entity',
        declared: 'MAIN',
        raw: '"MAIN"',
        span: oneLineSpan(2, 19),
        status: 'resolved',
        resolvedPage: { name: 'Main', span: oneLineSpan(1, 4) },
        candidates: [],
      });
      // `Dup` is written exactly like the first declaration; the reference is still ambiguous,
      // so the first match is never published as the target.
      expect(duplicate).toEqual({
        sectionIndex: 3,
        sectionKind: 'Entity',
        declared: 'Dup',
        raw: '"Dup"',
        span: oneLineSpan(3, 24),
        status: 'ambiguous',
        resolvedPage: null,
        candidates: [
          { name: 'Dup', span: oneLineSpan(1, 5) },
          { name: 'dup', span: oneLineSpan(1, 6) },
        ],
      });
      expect(ghost).toEqual({
        sectionIndex: 4,
        sectionKind: 'Relation',
        declared: 'Ghost',
        raw: '"Ghost"',
        span: oneLineSpan(4, 33),
        status: 'dangling',
        resolvedPage: null,
        candidates: [],
      });
      // The declaration lists are untouched: the same three pages, the same three lines.
      expect(envelope.schema?.pages.map((page) => [page.name, page.span.keyLine])).toEqual([
        ['Main', 4],
        ['Dup', 5],
        ['dup', 6],
      ]);
    });
  });
  it('projects every domain-naming type, and leaves an ordinary type absent', () => {
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const references = envelope.schema?.domainReferences ?? [];
      // Four of the six `Field` types name a domain; `Serial` and `Integer` name none and have no
      // record at all — absence *is* `plain` (P7).
      expect(references.map((reference) => reference.dataType)).toEqual([
        '@INT',
        '@NOPE',
        'INT_DOMAIN',
        'NAME',
      ]);
      expect(
        references.map((reference) => [
          reference.column,
          reference.span.keyLine,
          reference.sectionIndex,
        ]),
      ).toEqual([
        ['nm', 14, 2],
        ['amt', 15, 2],
        ['lv', 16, 2],
        ['dn', 17, 2],
      ]);
      const [known, unknown, resolved, ambiguous] = references;
      if (
        known === undefined ||
        unknown === undefined ||
        resolved === undefined ||
        ambiguous === undefined
      ) {
        throw new Error('a domain reference is missing');
      }
      expect(known.classification).toEqual({ kind: 'system', name: '@INT', known: true });
      expect(unknown.classification).toEqual({ kind: 'system', name: '@NOPE', known: false });
      // The declared spelling is the type as written; the resolved one is the declaration's.
      expect(resolved.classification).toEqual({
        kind: 'user',
        status: 'resolved',
        name: 'INT_DOMAIN',
        resolvedDomain: { name: 'int_domain', span: oneLineSpan(1, 7) },
      });
      expect(ambiguous.classification).toEqual({
        kind: 'user',
        status: 'ambiguous',
        name: 'NAME',
        candidates: [
          { name: 'Name', span: oneLineSpan(1, 8) },
          { name: 'name', span: oneLineSpan(1, 9) },
        ],
      });
      // No target on an ambiguous reference, and no plain record anywhere.
      expect(
        ambiguous.classification.kind === 'user' && 'resolvedDomain' in ambiguous.classification,
      ).toBe(false);
      expect(references.some((reference) => reference.dataType === 'Integer')).toBe(false);
      expect(references.some((reference) => reference.dataType === 'Serial')).toBe(false);
      // The declaration list is untouched as well.
      expect(envelope.schema?.domains.map((domain) => [domain.name, domain.span.keyLine])).toEqual([
        ['int_domain', 7],
        ['Name', 8],
        ['name', 9],
      ]);
    });
  });
  it('adds records without moving one counter, one diagnostic or one placement', () => {
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const integration = integrate(input);
      const lines = text.split('\n');
      for (const reference of envelope.schema?.pageReferences ?? []) {
        // Every record addresses one physical line, and the token it claims is written there.
        expect(reference.span).toEqual(
          oneLineSpan(reference.sectionIndex, reference.span.startLine),
        );
        expect(lines[reference.span.keyLine - 1]).toContain(reference.raw);
      }
      for (const reference of envelope.schema?.domainReferences ?? []) {
        expect(reference.span).toEqual(
          oneLineSpan(reference.sectionIndex, reference.span.startLine),
        );
        const body = lines[reference.span.keyLine - 1] ?? '';
        // The line carries the column and the type the record claims; the record invents neither.
        expect(body).toContain(`"${reference.column}"`);
        expect(body).toContain(reference.dataType);
      }
      const pageLines = (envelope.schema?.pageReferences ?? []).map(
        (reference) => reference.span.keyLine,
      );
      expect(new Set(pageLines).size).toBe(pageLines.length);
      // The outcome is the semantic layer's, and the envelope's diagnostics/status are Integration's
      // unchanged: the reference records report nothing by themselves.
      expect(envelope.status).toBe(integration.status);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        integration.diagnostics.map((diagnostic) => diagnostic.code),
      );
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'V_DANGLING_PAGE',
      ]);
      expect(
        envelope.diagnostics.find((diagnostic) => diagnostic.code === 'V_DANGLING_PAGE'),
      ).toMatchObject({
        severity: 'warning',
        details: { page: 'Ghost', section: 'Relation' },
        span: oneLineSpan(4, 33),
      });
      // Nothing was dropped and nothing was re-counted: the two new lists are projections of
      // records the counters already accounted for.
      expect(envelope.completeness).toEqual({
        sections: { total: 4, parsed: 4, preservedRaw: 0, unknown: 0 },
        keys: { total: 24, parsed: 24, preservedRaw: 0 },
        lines: { total: 33, accounted: 33, dropped: 0 },
        dropped: 0,
      });
      // Both spellings reach the JSON text: the request and the declaration.
      const json = toJsonString(envelope);
      expect(json).toContain('"MAIN"');
      expect(json).toContain('"int_domain"');
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

describe('json envelope — FORMAT declarations (stage 6-B unit 4)', () => {
  /**
   * §6's five rows, as the envelope must report them: `declared` is what the header said,
   * `effective` is a version this build knows or `null`, and an unknown declaration is warned
   * about — never silently upgraded to 21 and never rejected (`format-coverage.md` F2, K2, U1).
   */
  const DECLARATIONS = [
    { label: 'absent', line: null, declared: null, known: false, effective: null, warned: true },
    { label: '19 (2.20-era)', line: 19, declared: 19, known: true, effective: 19, warned: false },
    {
      label: '20 (the hole, K2)',
      line: 20,
      declared: 20,
      known: false,
      effective: null,
      warned: true,
    },
    { label: '21 (canonical)', line: 21, declared: 21, known: true, effective: 21, warned: false },
    {
      label: '99 (future, as absent, U1)',
      line: 99,
      declared: 99,
      known: false,
      effective: null,
      warned: true,
    },
  ] as const;
  /** One minimal document per declaration: no index keys, so FORMAT is the only variable. */
  function documentWith(line: number | null): string {
    return [
      ...(line === null ? [] : [`# A5:ER FORMAT:${String(line)}`]),
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      '',
      '[Entity]',
      'PName="e"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      'Position="Main",1,1',
      '',
    ].join('\n');
  }
  it('reports declared/effective/known and warns for exactly the unknown declarations', () => {
    for (const row of DECLARATIONS) {
      withDocument(documentWith(row.line), (path, input) => {
        const envelope = serialize(input, { command: 'inspect', path });
        expect(envelope.source?.format, row.label).toEqual({
          declared: row.declared,
          effective: row.effective,
          known: row.known,
        });
        // `effective` is never a version this build does not implement: 20 and 99 keep their own
        // declaration in `declared` and report no effective version at all.
        if (!row.known) expect(envelope.source?.format.effective, row.label).toBeNull();
        const warnings = envelope.diagnostics.filter(
          (diagnostic) => diagnostic.code === 'S_HEADER_UNKNOWN_FORMAT',
        );
        expect(warnings.length, row.label).toBe(row.warned ? 1 : 0);
        if (row.warned) {
          expect(warnings[0]?.details, row.label).toEqual({ declared: row.declared });
          expect(warnings[0]?.severity, row.label).toBe('warning');
          // The declaration's own line, or line 1 when there is nothing to point at.
          expect(warnings[0]?.span, row.label).toEqual(oneLineSpan(0, 1));
        }
        // A known declaration is exactly the case with no FORMAT finding, so severity (not a
        // hard-coded status) is what decides `ok`/`degraded`.
        expect(envelope.status, row.label).toBe(row.warned ? 'degraded' : 'ok');
        // `D_BOM_MISSING` is this staged document's own missing BOM (an `info`), so the FORMAT
        // finding is the only other code either way.
        expect(
          envelope.diagnostics.map((diagnostic) => diagnostic.code),
          row.label,
        ).toEqual(row.warned ? ['D_BOM_MISSING', 'S_HEADER_UNKNOWN_FORMAT'] : ['D_BOM_MISSING']);
      });
    }
  });
  it('accepts both index spellings in every profile, and moves only their roles', () => {
    // §6: the gate decides interpretation, never acceptance. The canonical declaration is primary
    // only under `21`; every other declaration — 19, the 20 hole, 99 and absent — makes the legacy
    // spelling primary, which is the reading §6 records as this project's choice (U1, K2).
    const ROWS = [
      {
        line: null,
        primarySource: 'legacy',
        canonicalRole: 'compatibility',
        legacyRole: 'primary',
      },
      { line: 19, primarySource: 'legacy', canonicalRole: 'compatibility', legacyRole: 'primary' },
      { line: 20, primarySource: 'legacy', canonicalRole: 'compatibility', legacyRole: 'primary' },
      {
        line: 21,
        primarySource: 'canonical',
        canonicalRole: 'primary',
        legacyRole: 'compatibility',
      },
      { line: 99, primarySource: 'legacy', canonicalRole: 'compatibility', legacyRole: 'primary' },
    ] as const;
    for (const row of ROWS) {
      const text = [
        ...(row.line === null ? [] : [`# A5:ER FORMAT:${String(row.line)}`]),
        '[Manager]',
        'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
        '[Entity]',
        'PName="both"',
        'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
        'IndexInfo="ix_canonical",1,"id",""',
        'Index=ix_legacy=0,id',
        'Position="Main",1,1',
        '',
      ].join('\n');
      withDocument(text, (path, input) => {
        const envelope = serialize(input, { command: 'inspect', path });
        const object = envelope.schema?.objects[0];
        if (object === undefined || object.kind !== 'entity') throw new Error('no entity');
        const indexes = object.indexes;
        const where = `FORMAT:${String(row.line)}`;
        // Neither spelling is dropped, in any profile.
        expect(indexes?.canonical, where).toHaveLength(1);
        expect(indexes?.legacy, where).toHaveLength(1);
        expect(indexes?.primarySource, where).toBe(row.primarySource);
        expect(indexes?.canonical[0]?.role, where).toBe(row.canonicalRole);
        expect(indexes?.legacy[0]?.role, where).toBe(row.legacyRole);
      });
    }
  });
});

describe('json envelope — limits and the failure contract (stage 6-B unit 5)', () => {
  /**
   * A minimal, complete document. Every line is short and the file parses, so the only variable in
   * these tests is the limit the reader or the decoder is given.
   */
  const DOCUMENT = [
    '# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    '',
    '[Entity]',
    'PName="e"',
    'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
    'Position="Main",1,1',
    '',
  ].join('\n');
  /** Physical lines, by the same rule §10.2 uses: a trailing terminator adds no line. */
  function lineCountOf(text: string): number {
    const parts = text.split('\n');
    return text.endsWith('\n') ? parts.length - 1 : parts.length;
  }
  /** The longest line in UTF-16 code units — the unit `maxLineLength` counts. */
  function longestLineOf(text: string): number {
    return Math.max(...text.split('\n').map((line) => line.length));
  }
  /**
   * The four real stages under an explicit limit, so a *successful* read can be serialized.
   *
   * `inputFromPath` above always loads under the defaults; the limit tests need the same pipeline
   * with a cap, and a fatal read has no scan to build, so this returns `null` for it.
   */
  function pipelineWithLimits(
    path: string,
    limits: Partial<Limits>,
  ): LoadedIntegrationInput | null {
    const load = loadSource(path, { limits });
    if (!load.ok) return null;
    const scan = scanSource(load.source);
    const classification = classify(scan);
    return { load, scan, classification, semantics: derivePartialSemantics(classification) };
  }
  /** Write bytes as a staged `.a5er`, so the real reader can be pointed at them. */
  function withBytes(bytes: Uint8Array, run: (path: string, sizeBytes: number) => void): void {
    const directory = mkdtempSync(join(tmpdir(), 'a5er-limits-'));
    const path = join(directory, 'document.a5er');
    try {
      const buffer = Buffer.from(bytes);
      writeFileSync(path, buffer);
      run(path, buffer.byteLength);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  /**
   * A read boundary whose `fstat` promises bytes its `read` never returns.
   *
   * This is the only way to reach `E_TRUNCATED_INPUT` deterministically (§10.2, R12): a real file
   * cannot shrink between the stat and the read on demand, and the seam exists so the state is
   * injected instead of raced. The fake reports the *real* file's size, so nothing about the input
   * is fictional — only the read is.
   */
  function shortReadFileSystem(sizeBytes: number): FileSystem {
    const stat: SourceStat = { sizeBytes, mtimeMs: 1, ino: 1, isRegularFile: true };
    const handle: SourceHandle = {
      stat: () => stat,
      read: () => Buffer.alloc(0),
      close: () => undefined,
    };
    return { open: () => handle };
  }
  /** The shared fatal arm: ten fields, no source/schema/counts, still strict JSON. */
  function assertFatalShape(envelope: JsonEnvelope, where: string): void {
    expect(Object.keys(envelope), where).toEqual([...ENVELOPE_KEYS]);
    // No `exitPolicy` and no eleventh field: the policy is Integration's, not the envelope's.
    expect(envelope.status, where).toBe('failed');
    expect(envelope.source, where).toBeNull();
    expect(envelope.schema, where).toBeNull();
    expect(envelope.completeness, where).toBeNull();
    expect(envelope.unsupported, where).toEqual([]);
    // The keys exist with a `null` value — they are not absent (§14 row 11).
    expect(envelope, where).toHaveProperty('schema', null);
    // A rejected read still serializes: automation must never have to tell "no output" from a
    // crash (§12 rule 1), and the strict replacer must not have dropped or rewritten anything.
    const text = toJsonString(envelope);
    expect(JSON.parse(text).status, where).toBe('failed');
    expect(JSON.parse(text).limits, where).toEqual(envelope.limits);
  }
  it('refuses the whole file on a limit breach, and never calls that truncation', () => {
    const size = Buffer.byteLength(DOCUMENT);
    const lines = lineCountOf(DOCUMENT);
    const longest = longestLineOf(DOCUMENT);
    const cases = [
      {
        label: 'maxBytes',
        limits: { maxBytes: size - 1 },
        code: 'E_LIMIT_BYTES',
        details: { sizeBytes: size, maxBytes: size - 1 },
      },
      {
        label: 'maxLines',
        limits: { maxLines: lines - 1 },
        code: 'E_LIMIT_LINES',
        details: { lines, maxLines: lines - 1 },
      },
      {
        label: 'maxLineLength',
        limits: { maxLineLength: longest - 1 },
        code: 'E_LIMIT_LINE_LENGTH',
        details: { maxLineLength: longest - 1, longestLine: longest },
      },
    ] as const;
    withBytes(Buffer.from(DOCUMENT, 'utf8'), (path) => {
      for (const row of cases) {
        const context = { ...DEFAULT_LIMITS, ...row.limits };
        const load = loadSource(path, { limits: row.limits });
        if (load.ok) throw new Error(`${row.label}: the limit did not fire`);
        const input: IntegrationInput = { load };
        const envelope = serialize(input, { command: 'inspect', path, limits: context });
        // Exactly one finding: the limit that fired, with its own concrete numbers.
        expect(envelope.diagnostics.length, row.label).toBe(1);
        expect(envelope.diagnostics[0]?.code, row.label).toBe(row.code);
        expect(envelope.diagnostics[0]?.severity, row.label).toBe('fatal');
        expect(envelope.diagnostics[0]?.details, row.label).toEqual(row.details);
        expect(envelope.diagnostics[0]?.construct, row.label).toBe('Source');
        assertFatalShape(envelope, row.label);
        // A limit refusal rejects the whole file: nothing was accepted, so nothing is truncated.
        expect(envelope.limits, row.label).toEqual({
          maxBytes: context.maxBytes,
          truncated: false,
        });
        // The policy for a fatal input, from Integration, is the same for every case.
        expect(integrate(input).exitPolicy, row.label).toEqual({ inspect: 1, validate: 1 });
        expect(integrate(input).completeness, row.label).toBeNull();
      }
    });
  });
  it('reports `truncated` only for a physical short read', () => {
    withBytes(Buffer.from(DOCUMENT, 'utf8'), (path, sizeBytes) => {
      const load = loadSource(path, { fileSystem: shortReadFileSystem(sizeBytes) });
      if (load.ok) throw new Error('a short read was accepted');
      const input: IntegrationInput = { load };
      const envelope = serialize(input, { command: 'inspect', path });
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'E_TRUNCATED_INPUT',
      ]);
      expect(envelope.diagnostics[0]?.severity).toBe('fatal');
      // The size the *file* declared, not the number of bytes that arrived.
      expect(envelope.diagnostics[0]?.details).toEqual({ declaredSizeBytes: sizeBytes });
      assertFatalShape(envelope, 'short read');
      expect(envelope.limits).toEqual({
        maxBytes: DEFAULT_LIMITS.maxBytes,
        truncated: true,
      });
      expect(integrate(input).exitPolicy).toEqual({ inspect: 1, validate: 1 });
      // The same bytes through the real reader parse: the flag follows the read, not the file.
      const real = pipelineWithLimits(path, {});
      if (real === null) throw new Error('the staged document must load');
      const healthy = serialize(real, { command: 'inspect', path });
      expect(healthy.status).toBe('ok');
      expect(healthy.limits).toEqual({
        maxBytes: DEFAULT_LIMITS.maxBytes,
        truncated: false,
      });
    });
  });
  it('accepts a document exactly at each limit and refuses the unit past it', () => {
    const size = Buffer.byteLength(DOCUMENT);
    const lines = lineCountOf(DOCUMENT);
    const longest = longestLineOf(DOCUMENT);
    withBytes(Buffer.from(DOCUMENT, 'utf8'), (path) => {
      const at = [
        { label: 'maxBytes', limits: { maxBytes: size } },
        { label: 'maxLines', limits: { maxLines: lines } },
        { label: 'maxLineLength', limits: { maxLineLength: longest } },
      ] as const;
      for (const row of at) {
        // Equality is inside the limit: the comparison is `>` in every one of the three checks.
        const input = pipelineWithLimits(path, row.limits);
        if (input === null) {
          throw new Error(`${row.label}: a document exactly at the limit was refused`);
        }
        const envelope = serialize(input, {
          command: 'inspect',
          path,
          limits: { ...DEFAULT_LIMITS, ...row.limits },
        });
        expect(envelope.status, row.label).toBe('ok');
        expect(
          envelope.diagnostics.map((diagnostic) => diagnostic.code),
          row.label,
        ).toEqual(['D_BOM_MISSING']);
        expect(envelope.schema?.objects, row.label).toHaveLength(1);
        expect(envelope.limits.truncated, row.label).toBe(false);
      }
    });
  });
  it('counts `maxLineLength` in UTF-16 code units, not bytes', () => {
    // Four astral characters: 8 code units, 16 UTF-8 bytes. Every other line is shorter, so the
    // reported `longestLine` can only come from this one.
    const emoji = '😀😀😀😀';
    const text = [
      '# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="M"',
      '',
      '[Entity]',
      'PName="e"',
      `Comment="${emoji}"`,
      'Position="M",1,1',
      '',
    ].join('\n');
    const commentLine = `Comment="${emoji}"`;
    const unitCount = commentLine.length;
    const byteCount = Buffer.byteLength(commentLine);
    // Four astral characters: 8 code units, 16 UTF-8 bytes — so the byte count is 8 larger.
    expect(byteCount, 'UTF-8 bytes').toBe(unitCount + 8);
    expect(unitCount, 'the emoji line is the longest').toBe(longestLineOf(text));
    withBytes(Buffer.from(text, 'utf8'), (path) => {
      const accepted = loadSource(path, { limits: { maxLineLength: unitCount } });
      expect(accepted.ok, 'exactly at the code-unit limit').toBe(true);
      const refused = loadSource(path, { limits: { maxLineLength: unitCount - 1 } });
      if (refused.ok) throw new Error('one code unit past the limit was accepted');
      expect(refused.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'E_LIMIT_LINE_LENGTH',
      ]);
      // Code units: a byte count would have reported `unitCount + 8`, not `unitCount`.
      expect(refused.diagnostics[0]?.details).toEqual({
        maxLineLength: unitCount - 1,
        longestLine: unitCount,
      });
    });
  });
  it('echoes the caller-supplied cap, so the context must repeat what the read used', () => {
    const built = GENERATED_BUILDERS['res-01']?.() ?? [];
    const first = built[0];
    if (first === undefined) throw new Error('res-01 built no file');
    // The res-01 shape: a document larger than a 4 KiB cap, refused from its stat before any read.
    expect(first.bytes.byteLength).toBeGreaterThan(CAPPED_READ_LIMIT_BYTES);
    withBytes(first.bytes, (path, sizeBytes) => {
      const load = loadSource(path, { limits: { maxBytes: CAPPED_READ_LIMIT_BYTES } });
      if (load.ok) throw new Error('res-01 was accepted under a 4 KiB cap');
      const input: IntegrationInput = { load };
      const cap = { ...DEFAULT_LIMITS, maxBytes: CAPPED_READ_LIMIT_BYTES };
      const honest = serialize(input, { command: 'inspect', path, limits: cap });
      // The documented contract: pass the same limits that loaded the input.
      expect(honest.limits).toEqual({
        maxBytes: CAPPED_READ_LIMIT_BYTES,
        truncated: false,
      });
      expect(honest.diagnostics[0]?.details).toEqual({
        sizeBytes,
        maxBytes: CAPPED_READ_LIMIT_BYTES,
      });
      assertFatalShape(honest, 'res-01');
      // Omitting the context is the documented *claim* that the defaults applied — the envelope
      // repeats the claim, and the diagnostic still names the cap that really fired.
      const omitted = serialize(input, { command: 'inspect', path });
      expect(omitted.limits).toEqual({
        maxBytes: DEFAULT_LIMITS.maxBytes,
        truncated: false,
      });
      expect(omitted.diagnostics).toEqual(honest.diagnostics);
      // Nothing detects a mismatch: a different explicit cap is echoed verbatim, which is exactly
      // why the precondition is documented (§12) instead of being silently "fixed".
      const mismatched = serialize(input, {
        command: 'inspect',
        path,
        limits: { ...DEFAULT_LIMITS, maxBytes: 512 },
      });
      expect(mismatched.limits.maxBytes).toBe(512);
      expect(mismatched.diagnostics).toEqual(honest.diagnostics);
    });
  });
  it('treats an invalid limit override as a programmer error, before any envelope', () => {
    // `withLimits` is the only validator, and it throws: a limit is code, not input (§10.2).
    for (const [name, value] of [
      ['maxBytes', 0],
      ['maxLines', -1],
      ['maxLineLength', 1.5],
    ] as const) {
      expect(() => withLimits({ [name]: value }), name).toThrow(
        new RegExp(`limit ${name} must be a positive integer`),
      );
    }
    withBytes(Buffer.from(DOCUMENT, 'utf8'), (path) => {
      // The reader propagates it instead of turning it into a diagnostic: nothing here is a file
      // condition, so no `E_*` code may be invented for it.
      expect(() => loadSource(path, { limits: { maxBytes: 0 } })).toThrow(
        /limit maxBytes must be a positive integer/,
      );
    });
  });
});

describe('json envelope — arms no golden reaches (stage 6-C unit 3)', () => {
  // The four shapes below are correct by the model (R25/R28/R30) and tested at the semantic layer,
  // but no committed fixture carries them, so the JSON arm had no evidence. Each document here is
  // inline — no fixture, no golden, no catalog entry — and each asserts the envelope's own members.
  const MANAGER = '[Manager]\nPageInfo="M",3,"A4Landscape","$FFFFFF"\n';
  const POSITION = 'Position="M",1,1';
  const RELATION_POSITION = 'Position="M",0,1,1,1,R,R,""';
  /** The 1-based line a needle sits on, so a pinned line number cannot drift from the document. */
  function lineOf(text: string, needle: string): number {
    return text.split('\n').indexOf(needle) + 1;
  }

  it('keeps both columns of a physical-name collision and reports the collision (R30)', () => {
    const text = [
      '# A5:ER FORMAT:21', // 1
      '', // 2
      '[Manager]', // 3
      'PageInfo="M",3,"A4Landscape","$FFFFFF"', // 4
      'CommonField="共通ID","common_id","Integer",,,,,"",$FFFFFFFF', // 5
      '', // 6
      '[Entity]', // 7
      'PName="clash"', // 8
      'Field="ID","common_id","Serial","NOT NULL",0,"","",$FFFFFFFF,""', // 9
      'Position="M",1,1', // 10
      '', // 11
    ].join('\n');
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const entity = envelope.schema?.objects[0];
      if (entity === undefined || entity.kind !== 'entity') throw new Error('no entity');
      const columns = entity.effectiveColumns.columns;
      // Nothing is overridden: the declared field and the common field both stay, declared first.
      expect(columns.map((column) => [column.pname, column.source])).toEqual([
        ['common_id', 'declared'],
        ['common_id', 'common'],
      ]);
      // Both records of the collided name are flagged — the `true` arm nothing else reaches.
      expect(columns.map((column) => column.collision)).toEqual([true, true]);
      expect(columns.map((column) => column.span.keyLine)).toEqual([9, 5]);
      // … and the collision list is not empty: it names both lines that wrote the name.
      expect(entity.effectiveColumns.collisions).toEqual([
        {
          sectionIndex: 2,
          object: 'clash',
          pname: 'common_id',
          spans: [oneLineSpan(2, 9), oneLineSpan(1, 5)],
        },
      ]);
      expect(entity.effectiveColumns.status).toBe('complete');
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['D_BOM_MISSING']);
    });
  });
  it('keeps an empty relation column slot, with its index and its empty name (R28)', () => {
    const text = [
      '# A5:ER FORMAT:21',
      '',
      MANAGER,
      '[Entity]',
      'PName="parent"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      POSITION,
      '[Entity]',
      'PName="child"',
      'Field="ID","p_id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      // Both names the relation maps must exist here, or the column would be dangling rather than
      // merely unmatched — this document is about the *slot*, not about resolution.
      'Field="ID2","id","Serial","NOT NULL",1,"","",$FFFFFFFF,""',
      'Position="M",2,2',
      '[Relation]',
      'Entity1="parent"',
      'Entity2="child"',
      'Fields1="id,,id"',
      'Fields2="p_id,id"',
      'RelationType1=1',
      'RelationType2=3',
      RELATION_POSITION,
      '',
    ].join('\n');
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const relation = envelope.schema?.relations[0];
      if (relation === undefined) throw new Error('no relation');
      const slots = relation.fromColumns?.columns ?? [];
      // The slot keeps its place: an empty column is a slot, not a removal.
      expect(slots.map((slot) => [slot.index, slot.pname, slot.empty])).toEqual([
        [0, 'id', false],
        [1, '', true],
        [2, 'id', false],
      ]);
      // Every slot of one quoted list carries the whole element as its `raw` — the same
      // whole-element duplication `txt-03` shows for `"a,b"` — so the empty slot's raw is the list
      // it belongs to, and its `empty` flag (not its text) is what marks the missing name.
      expect(slots.map((slot) => slot.raw)).toEqual(['"id,,id"', '"id,,id"', '"id,,id"']);
      expect(slots[1]?.span.keyLine).toBe(lineOf(text, 'Fields1="id,,id"'));
      // The arity difference is real and reported; an empty slot is not a dangling column.
      expect(relation.columnsAligned).toBe(false);
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'V_FIELD_COUNT_MISMATCH',
      ]);
    });
  });
  it('reports an ambiguous relation endpoint with its candidates, and no target (§9.2, R25)', () => {
    const text = [
      '# A5:ER FORMAT:21',
      '',
      MANAGER,
      '[Entity]',
      'PName="twin"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      POSITION,
      '[Entity]',
      'PName="twin"',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""',
      'Position="M",2,2',
      '[Relation]',
      'Entity1="twin"',
      'Entity2="twin"',
      'Fields1="id"',
      'Fields2="id"',
      'RelationType1=1',
      'RelationType2=3',
      RELATION_POSITION,
      '',
    ].join('\n');
    withDocument(text, (path, input) => {
      const envelope = serialize(input, { command: 'inspect', path });
      const relation = envelope.schema?.relations[0];
      if (relation === undefined) throw new Error('no relation');
      for (const [side, line] of [
        [relation.from, lineOf(text, 'Entity1="twin"')],
        [relation.to, lineOf(text, 'Entity2="twin"')],
      ] as const) {
        if (side === null) throw new Error('a side is missing');
        // Two objects carry the name, so the side names no target and counts both candidates.
        expect(side.status).toBe('ambiguous');
        expect(side.candidates).toBe(2);
        expect(side.resolvedEntity).toBeNull();
        expect(side.declared).toBe('twin');
        expect(side.raw).toBe('"twin"');
        expect(side.span.keyLine).toBe(line);
      }
      // The duplicate identity is what makes it ambiguous, and it is reported as such.
      expect(envelope.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'D_BOM_MISSING',
        'V_DUPLICATE_OBJECT_NAME',
      ]);
    });
  });
});
