/**
 * Type-level checks for the tables envelope (`docs/proposals/human-cli.md` §5.2, §8.4).
 *
 * Compiled by `pnpm typecheck`, whose tsconfig includes every `.ts` file under `tests/`, and never
 * run: Vitest only picks up files named `.test.ts`. Every `@ts-expect-error` here is paired with a
 * positive control without the defect, so a line cannot pass because of an unrelated error.
 * control without the defect, so a line cannot pass because of an unrelated error.
 *
 * Reading a forbidden key is allowed by TypeScript — `read.schema` has type `undefined` — so a read
 * is never marked with `@ts-expect-error`, which would itself fail as unused. The tests assert
 * **assignments** instead, and the runtime absence of the keys is checked in
 * `tests/json-tables-contract.test.ts`.
 *
 * The bindings are exported so `oxlint` sees no unused variable.
 */

import type {
  JsonCommand,
  JsonCompleteness,
  JsonEnvelope,
  JsonSchemaDocument,
  JsonSource,
  JsonTablesEnvelope,
  JsonTablesEnvelopeFailed,
  JsonTablesEnvelopeRead,
} from '../../src/json/envelope.js';

declare const failed: JsonTablesEnvelopeFailed;
declare const read: JsonTablesEnvelopeRead;
declare const inspect: JsonEnvelope;
declare const source: JsonSource;
declare const completeness: JsonCompleteness;

// Reading a forbidden key compiles and has type undefined: no @ts-expect-error on reads.
export const readSchema: undefined = read.schema;
export const readResult: undefined = (inspect as JsonSchemaDocument).result;

// A variable that carries a forbidden key is not assignable.
const withSchema = { ...read, schema: inspect.schema };
// @ts-expect-error schema is forbidden on a tables envelope
export const t1: JsonTablesEnvelope = withSchema;

const withResult = { ...inspect, result: read.result };
// @ts-expect-error result is forbidden on an inspect/validate document
export const t2: JsonSchemaDocument = withResult;

// Even `schema: undefined` is rejected. This line depends on exactOptionalPropertyTypes.
const withUndefinedSchema = { ...read, schema: undefined };
// @ts-expect-error a present schema key is rejected
export const t3: JsonTablesEnvelope = withUndefinedSchema;

// Null rules: failed needs null source/result/completeness; ok/degraded needs all three.
const failedWithSource = { ...failed, source };
// @ts-expect-error failed must have source: null
export const t4: JsonTablesEnvelope = failedWithSource;

const readWithNullResult = { ...read, result: null };
// @ts-expect-error ok/degraded must have a result
export const t5: JsonTablesEnvelope = readWithNullResult;

const failedWithCompleteness = { ...failed, completeness };
// @ts-expect-error failed must have completeness: null
export const t6: JsonTablesEnvelope = failedWithCompleteness;

// Positive controls: the same shapes without the defect compile.
export const ok1: JsonTablesEnvelope = { ...failed };
export const ok2: JsonTablesEnvelope = { ...read };
export const ok3: JsonSchemaDocument = inspect;

// Narrowing by status: `source` is null only in the failed arm.
declare const either: JsonTablesEnvelope;
if (either.status === 'failed') {
  const failedSource: null = either.source;
  void failedSource;
} else {
  const readSource: JsonSource = either.source;
  void readSource;
}

/** True only when `A` and `B` are mutually assignable. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// K-1: `JsonCommand` stays exactly the two commands that share the schema envelope.
export const k1: Exact<JsonCommand, 'inspect' | 'validate'> = true;
// @ts-expect-error JsonCommand does not include 'tables'
export const k2: Exact<JsonCommand, 'inspect' | 'validate' | 'tables'> = true;
// The tables command is its own type, and the read arm pins it.
export const k3: Exact<JsonTablesEnvelopeRead['command'], 'tables'> = true;
