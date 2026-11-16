/**
 * Fixture → classification, memoised for the semantic tests.
 *
 * The semantic modules all take the same input, so the loader lives in one place instead of being
 * copied five times. Nothing is interpreted here: a fixture is staged, loaded with the real decoder,
 * scanned and classified, and the result is cached because every test in a file wants the same one.
 */

import { loadSource } from '../../src/decode/load.js';
import { classify } from '../../src/schema/registry.js';
import type { Classification } from '../../src/schema/registry.js';
import { scanSource } from '../../src/syntax/scanner.js';
import { derivePartialSemantics } from '../../src/semantic/partial.js';
import type { PartialSemantics } from '../../src/semantic/partial.js';
import { FIXTURES } from './fixture-registry.js';
import type { FixtureSpec } from './fixture-registry.js';
import { stage } from './stage.js';

const CLASSIFICATIONS = new Map<string, Classification>();
const SEMANTICS = new Map<string, PartialSemantics>();

/** The registry entry for a fixture id, or a thrown error naming the typo. */
export function specOf(id: string): FixtureSpec {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not a registered fixture`);
  return spec;
}

/** The classification of a committed synthetic fixture. */
export function classificationOf(id: string): Classification {
  const cached = CLASSIFICATIONS.get(id);
  if (cached !== undefined) return cached;
  const spec = specOf(id);
  if (spec.fixtureClass !== 'synthetic') throw new Error(`${id} is not a synthetic fixture`);
  const staged = stage(spec.id);
  try {
    const outcome = loadSource(staged.path);
    if (!outcome.ok) throw new Error(`${id} did not load`);
    const classification = classify(scanSource(outcome.source));
    CLASSIFICATIONS.set(id, classification);
    return classification;
  } finally {
    staged.cleanup();
  }
}

/** The bounded semantics of a committed synthetic fixture. */
export function semanticsOf(id: string): PartialSemantics {
  const cached = SEMANTICS.get(id);
  if (cached !== undefined) return cached;
  const semantics = derivePartialSemantics(classificationOf(id));
  SEMANTICS.set(id, semantics);
  return semantics;
}
