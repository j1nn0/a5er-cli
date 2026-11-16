/**
 * Byte- and text-level inspection shared by the fixture tests.
 *
 * This is deliberately **not** a parser: it strips a BOM, splits lines, splits a
 * Complex value on commas outside quotes, resolves a handful of documented fact
 * paths and evaluates them. Values are never interpreted, resolved or validated
 * against the specification beyond what a fixture must contain (test-strategy §7 T1).
 *
 * Shared so committed fixtures (`fixtures-content.test.ts`) and generated ones
 * (`fixtures-generated.test.ts`) are checked by exactly the same code.
 */

import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { FixtureSpec } from './fixture-registry.js';

/** UTF-8 byte-order mark. */
export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface ParsedText {
  readonly raw: Buffer;
  readonly text: string;
  readonly lines: readonly string[];
  readonly sectionLines: readonly number[];
  readonly keyLines: readonly number[];
}

/** Strip a UTF-8 BOM and split on CRLF/LF/CR, preserving line order. */
export function readText(path: string): ParsedText {
  return parseText(readFileSync(path));
}

/** Parse already-decoded text, so byte fixtures can be inspected after decoding. */
export function parseText(raw: Buffer, decoded?: string): ParsedText {
  const text = decoded ?? (raw.subarray(0, 3).equals(BOM) ? raw.subarray(3) : raw).toString('utf8');
  const lines = text.split(/\r\n|\n|\r/);
  const sectionLines: number[] = [];
  const keyLines: number[] = [];
  for (const [index, line] of lines.entries()) {
    // P3: whitespace around a header is trimmed for recognition; the raw line keeps it.
    // P3: whitespace around a header is trimmed for recognition and the raw line keeps
    // it. The name may itself contain brackets (`[[Entity]]`), so the match is greedy on
    // the outer pair — the same reading a `^\[(.*)\]$` header scanner uses.
    if (/^\s*\[.+\]\s*$/.test(line)) {
      sectionLines.push(index + 1);
      continue;
    }
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^[^=]+?=/.test(line)) keyLines.push(index + 1);
  }
  return { raw, text, lines, sectionLines, keyLines };
}

/**
 * Split a Complex value on commas that are not inside double quotes. Escape
 * sequences are not interpreted — the fixtures that carry them assert their
 * presence as raw text instead.
 */
export function splitComplex(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

export function lineAt(parsed: ParsedText, line: number): string {
  const value = parsed.lines[line - 1];
  if (value === undefined) throw new Error(`line ${String(line)} does not exist`);
  return value;
}

export function keyAt(parsed: ParsedText, line: number): string {
  const value = lineAt(parsed, line);
  const equals = value.indexOf('=');
  if (equals < 1) throw new Error(`line ${String(line)} is not a key=value line: ${value}`);
  return value.slice(0, equals);
}

export function valueAt(parsed: ParsedText, line: number): string {
  const value = lineAt(parsed, line);
  const equals = value.indexOf('=');
  if (equals < 1) throw new Error(`line ${String(line)} is not a key=value line: ${value}`);
  return value.slice(equals + 1);
}

/** Section header text with surrounding whitespace trimmed; the raw line keeps it. */
export function headerName(parsed: ParsedText, line: number): string {
  return lineAt(parsed, line).trim();
}

/** Line numbers of the `key` occurrences inside the n-th `[Entity]` section. */
export function entityKeyLines(parsed: ParsedText, entity: number, key: string): number[] {
  const headers = parsed.sectionLines.filter((line) => headerName(parsed, line) === '[Entity]');
  const start = headers[entity - 1];
  if (start === undefined) throw new Error(`entity ${String(entity)} does not exist`);
  const next = parsed.sectionLines.find((line) => line > start) ?? parsed.lines.length + 1;
  const found: number[] = [];
  for (const line of parsed.keyLines) {
    if (line <= start || line >= next) continue;
    if (keyAt(parsed, line) === key) found.push(line);
  }
  return found;
}

export function unquote(value: string): string {
  return /^".*"$/.test(value) ? value.slice(1, -1) : value;
}

/** Evaluate the small, documented fact vocabulary the registry uses. */
export function factValue(
  path: string,
  parsed: ParsedText | null,
  bytes: Uint8Array | null,
): unknown {
  if (path === 'bytes.length') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    return bytes.byteLength;
  }
  if (path === 'bytes.prefix') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    return Buffer.from(bytes.subarray(0, 2)).toString('hex');
  }
  if (path === 'bytes.nulRatio') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    // architecture §10.3: the binary verdict looks at the first 4 KiB only.
    const window = bytes.subarray(0, 4096);
    let nuls = 0;
    for (const byte of window) if (byte === 0) nuls += 1;
    return window.length === 0 ? 0 : nuls / window.length;
  }
  if (path === 'strict.allReject') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    const rejected = (['utf-8', 'shift_jis', 'utf-16le'] as const).every((encoding) => {
      try {
        new TextDecoder(encoding, { fatal: true }).decode(bytes);
        return false;
      } catch {
        return true;
      }
    });
    return rejected;
  }

  if (parsed === null) throw new Error(`text fact ${path} on a bytes fixture`);

  if (path === 'text.contains') throw new Error('text.contains needs its argument in equals');
  if (path === 'header.format') {
    const match = /^# A5:ER FORMAT:(\d+)$/m.exec(parsed.text);
    if (match?.[1] === undefined) throw new Error('no FORMAT header');
    return Number(match[1]);
  }
  if (path === 'header.absent') return /^# A5:ER FORMAT:/m.test(parsed.text) === false;
  if (path === 'encoding.bom') return parsed.raw.subarray(0, 3).equals(BOM);
  if (path === 'encoding.crlf') return parsed.text.includes('\r\n');
  if (path === 'encoding.mixedEol') {
    // U4: the format defines no line endings, so all three forms in one file is legal.
    const withoutCrlf = parsed.text.replace(/\r\n/g, '');
    return parsed.text.includes('\r\n') && withoutCrlf.includes('\n') && withoutCrlf.includes('\r');
  }
  if (path === 'encoding.declared') {
    const match = /^# A5:ER ENCODING:(\S+)$/m.exec(parsed.text);
    return match?.[1] ?? null;
  }
  if (path === 'escape.sequences') {
    const sequences = ['\\Q', '\\\\', '\\q', '\\t', '\\n'];
    return sequences.filter((sequence) => !parsed.text.includes(sequence)).length === 0
      ? sequences.join(',')
      : 'missing';
  }
  if (path === 'entity.count')
    return parsed.sectionLines.filter((l) => headerName(parsed, l) === '[Entity]').length;
  if (path === 'view.count')
    return parsed.sectionLines.filter((l) => headerName(parsed, l) === '[View]').length;
  if (path === 'relation.count') {
    // P3: `[Relationship]` is the alias of `[Relation]`, so both spellings count as a relation.
    return parsed.sectionLines.filter((l) =>
      ['[Relation]', '[Relationship]'].includes(headerName(parsed, l)),
    ).length;
  }
  if (path === 'page.count') {
    return parsed.keyLines.filter((line) => keyAt(parsed, line) === 'PageInfo').length;
  }
  if (path === 'pname.unique') {
    // P6: PName is the identity and must be unique across every object in the diagram.
    const names = parsed.keyLines
      .filter((line) => keyAt(parsed, line) === 'PName')
      .map((line) => unquote(valueAt(parsed, line)));
    return new Set(names).size === names.length;
  }
  if (path === 'field.count') {
    // Document-wide: a fixture with no [Entity] at all still has zero Field keys.
    return parsed.keyLines.filter((line) => keyAt(parsed, line) === 'Field').length;
  }
  const fieldCount = /^field\.(\d+)\.count$/.exec(path);
  if (fieldCount?.[1] !== undefined) {
    return entityKeyLines(parsed, Number(fieldCount[1]), 'Field').length;
  }
  if (path === 'field.1.keyOrders') {
    return entityKeyLines(parsed, 1, 'Field')
      .map((line) => unquote((splitComplex(valueAt(parsed, line))[4] ?? '').trim()))
      .join(',');
  }

  const lineKey = /^line\.(\d+)\.key$/.exec(path);
  if (lineKey?.[1] !== undefined) return keyAt(parsed, Number(lineKey[1]));

  const lineValue = /^line\.(\d+)\.value$/.exec(path);
  if (lineValue?.[1] !== undefined) return valueAt(parsed, Number(lineValue[1]));

  const sectionHeader = /^section\.(\d+)\.header$/.exec(path);
  if (sectionHeader?.[1] !== undefined) {
    const line = parsed.sectionLines[Number(sectionHeader[1]) - 1];
    if (line === undefined) throw new Error(`section ${sectionHeader[1]} does not exist`);
    return lineAt(parsed, line);
  }

  const sectionHeaderLength = /^section\.(\d+)\.headerLength$/.exec(path);
  if (sectionHeaderLength?.[1] !== undefined) {
    const line = parsed.sectionLines[Number(sectionHeaderLength[1]) - 1];
    if (line === undefined) throw new Error(`section ${sectionHeaderLength[1]} does not exist`);
    return lineAt(parsed, line).length;
  }

  const fieldElements = /^field\.(\d+)\.(\d+)\.elements$/.exec(path);
  if (fieldElements?.[1] !== undefined && fieldElements[2] !== undefined) {
    const lines = entityKeyLines(parsed, Number(fieldElements[1]), 'Field');
    const line = lines[Number(fieldElements[2]) - 1];
    if (line === undefined) throw new Error(`field ${path} does not exist`);
    return splitComplex(valueAt(parsed, line)).length;
  }

  const indexColumns = /^index\.(\d+)\.(\d+)\.columns$/.exec(path);
  if (indexColumns?.[1] !== undefined && indexColumns[2] !== undefined) {
    const lines = entityKeyLines(parsed, Number(indexColumns[1]), 'IndexInfo');
    const line = lines[Number(indexColumns[2]) - 1];
    if (line === undefined) throw new Error(`index ${path} does not exist`);
    const parts = splitComplex(valueAt(parsed, line));
    if (parts.length < 3)
      throw new Error(`IndexInfo on line ${String(line)} has no column element`);
    return unquote((parts[2] ?? '').trim());
  }

  throw new Error(`unknown fact path: ${path}`);
}

export function evaluateFact(
  spec: FixtureSpec,
  parsed: ParsedText | null,
  bytes: Uint8Array | null,
  fact: { path: string; equals: unknown },
): void {
  if (fact.path === 'text.contains') {
    if (typeof fact.equals !== 'string') throw new Error('text.contains needs a string');
    if (parsed === null) throw new Error('text.contains on a bytes fixture');
    expect(parsed.text).toContain(fact.equals);
    return;
  }
  expect(factValue(fact.path, parsed, bytes), `${spec.id}: ${fact.path}`).toEqual(fact.equals);
}
