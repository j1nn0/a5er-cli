/**
 * Diagnostic-code assertions (test-strategy §7 T2, §10 G-2).
 *
 * Codes are a **multiset**, never a set and never a "contains" check: two unknown keys
 * are two `S_UNKNOWN_KEY` occurrences, so a fixture that gains one more of the same code
 * must fail. `codesMatch` is the pure predicate; `assertCodes` adds a readable diff when
 * the comparison fails.
 *
 * Parser tests import `assertCodes` and nothing else, which is why the predicate stays in
 * the registry module: one definition of "the same codes", used by the gate and the tests.
 */

import { expect } from 'vitest';
import { codesMatch } from './fixture-registry.js';

/**
 * Assert that `actual` and `expected` are the same code multiset, ignoring order.
 *
 * On failure this falls through to `expect` with both sides sorted, so the diff shows
 * which occurrence vanished or appeared instead of just "false is not true".
 */
export function assertCodes(
  actual: readonly string[],
  expected: readonly string[],
  label = 'codes',
): void {
  if (codesMatch(actual, expected)) return;
  expect([...actual].sort(), label).toEqual([...expected].sort());
}
