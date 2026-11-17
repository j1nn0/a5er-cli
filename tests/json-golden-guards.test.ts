/**
 * Stage 6 — golden-harness guards (`test-strategy.md` §10 G-3, G-6; §9 determinism).
 *
 * These are cross-cutting checks that a per-fixture sweep cannot express:
 *
 * - **G-3:** every non-fatal code in the taxonomy is produced by at least one golden. The golden
 *   directory is the only input, so a fixture that silently stops raising a code fails here even
 *   if its own expected codes file were edited.
 * - **G-6:** no `__snapshots__` directory and no `*.snap` file exists anywhere in `src/` or
 *   `tests/`. Goldens are authored files, never auto-updated output (`vitest -u` is not used).
 * - **No new skips:** the two new golden files contain no `skip`/`todo`/`only` calls. The existing
 *   `imm-01` CLI skip is untouched and is the only skip allowed in the suite.
 * - **Golden-level determinism:** serializing the same input twice produces identical strings;
 *   a deeply frozen input serializes; and two different staging directories produce the same
 *   envelope once `source.path` is scrubbed to `<tmp>/<id>.a5er`.
 *
 * Strict-stringification (`undefined`/non-finite/…) is covered in `tests/json-contract.test.ts`
 * and is deliberately not duplicated here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type { JsonEnvelope } from '../src/json/index.js';
import { serialize, toJsonString } from '../src/json/index.js';
import { classify } from '../src/schema/registry.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { scanSource } from '../src/syntax/scanner.js';
import type { IntegrationInput } from '../src/validate/index.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { stage } from './helpers/stage.js';

const TESTS_ROOT = fileURLToPath(new URL('./', import.meta.url));
const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const GOLDEN_DIR = join(TESTS_ROOT, 'fixtures', 'json-goldens');
const NEW_FILES = [
  join(TESTS_ROOT, 'json-goldens.test.ts'),
  join(TESTS_ROOT, 'json-golden-guards.test.ts'),
];

/** The 22 non-fatal codes: 3 `D_`, 9 `S_` and 10 `V_` (§11). */
const NONFATAL_CODES: readonly string[] = [
  'D_BOM_MISSING',
  'D_ENCODING_ASSUMED',
  'D_ENCODING_MISMATCH',
  'S_HEADER_UNKNOWN_FORMAT',
  'S_UNKNOWN_SECTION',
  'S_UNKNOWN_KEY',
  'S_LEGACY_KEY',
  'S_MALFORMED_LINE',
  'S_DUPLICATE_KEY',
  'S_FIELD_TOO_FEW_ELEMENTS',
  'S_FIELD_TOO_MANY_ELEMENTS',
  'S_COMPLEX_UNTERMINATED_QUOTE',
  'V_MISSING_REQUIRED_KEY',
  'V_DUPLICATE_OBJECT_NAME',
  'V_DANGLING_ENTITY',
  'V_DANGLING_COLUMN',
  'V_DANGLING_PAGE',
  'V_FIELD_COUNT_MISMATCH',
  'V_PK_ORDER_CONFLICT',
  'V_INDEX_LEGACY_ONLY',
  'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
  'V_VIEW_COLUMNS_UNKNOWN',
];

const GOLDEN_IDS = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.expected.json'))
  .map((name) => name.slice(0, -'.expected.json'.length))
  .sort();

function goldenOf(id: string): JsonEnvelope {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, `${id}.expected.json`), 'utf8')) as JsonEnvelope;
}

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

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function scrub(envelope: JsonEnvelope, id: string): JsonEnvelope {
  if (envelope.source === null) return envelope;
  return { ...envelope, source: { ...envelope.source, path: `<tmp>/${id}.a5er` } };
}

/** Every directory below `root` whose name matches. */
function directoriesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name === name) found.push(path);
    found.push(...directoriesNamed(path, name));
  }
  return found;
}

/** Every regular file below `root` whose name ends with `suffix`. */
function filesEndingWith(root: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesEndingWith(path, suffix));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

describe('json golden guards — registry coverage', () => {
  it('covers every committed synthetic and byte fixture exactly once', () => {
    const expected = FIXTURES.filter(
      (spec) => spec.fixtureClass === 'synthetic' || spec.fixtureClass === 'bytes',
    )
      .map((spec) => spec.id)
      .sort();

    expect(expected).toHaveLength(44);
    expect(GOLDEN_IDS).toEqual(expected);
  });

  it('G-3: every non-fatal code appears in at least one golden', () => {
    const observed = new Set<string>();
    for (const id of GOLDEN_IDS) {
      for (const diagnostic of goldenOf(id).diagnostics) {
        if (diagnostic.severity !== 'fatal') observed.add(diagnostic.code);
      }
    }

    expect([...observed].sort()).toEqual([...NONFATAL_CODES].sort());
  });

  it('the fatal fixtures exercise the two fatal codes those goldens claim', () => {
    expect(goldenOf('enc-04').diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'E_UNDECODABLE',
    ]);
    expect(goldenOf('hst-02').diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'E_BINARY_INPUT',
    ]);
  });
});

describe('json golden guards — G-6 and no new skips', () => {
  it('G-6: ships no snapshot directory and no .snap file', () => {
    expect(directoriesNamed(SRC_ROOT, '__snapshots__')).toEqual([]);
    expect(directoriesNamed(TESTS_ROOT, '__snapshots__')).toEqual([]);
    expect(filesEndingWith(SRC_ROOT, '.snap')).toEqual([]);
    expect(filesEndingWith(TESTS_ROOT, '.snap')).toEqual([]);
  });

  it('adds no skip, todo or only to the new golden files', () => {
    // Built as a string so this guard's own source cannot match itself.
    const forbidden = new RegExp('\\b(?:it|test|describe)\\.(?:skip|todo|only)\\s*\\(');
    for (const file of NEW_FILES) {
      expect(statSync(file).isFile(), file).toBe(true);
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(forbidden);
    }
  });
});

describe('json golden guards — determinism and path scrubbing', () => {
  it('serializes the same input to the same string twice', () => {
    const staged = stage('fmt-01');
    try {
      const input = inputFromPath(staged.path);
      const first = toJsonString(serialize(input, { command: 'inspect', path: staged.path }));
      const second = toJsonString(serialize(input, { command: 'inspect', path: staged.path }));
      expect(second).toBe(first);
    } finally {
      staged.cleanup();
    }
  });

  it('serializes a deeply frozen input without mutating it', () => {
    const staged = stage('sem-05');
    try {
      const input = inputFromPath(staged.path);
      const frozen = deepFreeze(inputFromPath(staged.path));
      const plan = toJsonString(
        scrub(serialize(input, { command: 'inspect', path: staged.path }), 'sem-05'),
      );
      const frozenPlan = toJsonString(
        scrub(serialize(frozen, { command: 'inspect', path: staged.path }), 'sem-05'),
      );
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(frozenPlan).toBe(plan);
    } finally {
      staged.cleanup();
    }
  });

  it('two staging directories produce the same envelope after the path scrub', () => {
    for (const id of ['fmt-01', 'sem-05']) {
      const first = stage(id);
      const second = stage(id);
      try {
        const firstPlan = toJsonString(
          scrub(serialize(inputFromPath(first.path), { command: 'inspect', path: first.path }), id),
        );
        const secondPlan = toJsonString(
          scrub(
            serialize(inputFromPath(second.path), { command: 'inspect', path: second.path }),
            id,
          ),
        );
        expect(first.path).not.toBe(second.path);
        expect(secondPlan).toBe(firstPlan);
        expect(firstPlan).not.toContain(first.path);
      } finally {
        first.cleanup();
        second.cleanup();
      }
    }
  });
});
