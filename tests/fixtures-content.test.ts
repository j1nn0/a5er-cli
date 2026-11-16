/**
 * Structural assertions over the 14 initial fixtures.
 *
 * Scope: this is deliberately **not** a parser. It reads raw bytes and raw
 * text, counts section headers and `key=value` lines, splits a Complex value on
 * commas that are outside quotes, and checks that each registry entry's
 * expectations are traceable to something present in the file. Values are never
 * interpreted, resolved or validated against the specification beyond what the
 * fixture itself must contain (test-strategy §7 T1).
 *
 * A fixture whose asserted construct is missing fails here, before any parser
 * exists.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FixtureSpec } from './helpers/fixture-registry.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { BYTES_DIR, SYNTHETIC_DIR, sha256File, stageSource } from './helpers/stage.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

interface ByteModule {
  readonly bytes: Uint8Array;
  /** Encoding a reader would use for this file; absent when none succeeds. */
  readonly encoding?: string;
}

const BYTE_MODULES: Readonly<Record<string, ByteModule>> = {
  'enc-03': { bytes: enc03.BYTES, encoding: 'shift_jis' },
  'enc-04': { bytes: enc04.BYTES },
  'enc-05': { bytes: enc05.BYTES, encoding: 'utf-16le' },
};

const KNOWN_SECTIONS = ['[Manager]', '[Entity]', '[Relation]', '[Relationship]', '[View]'];

interface ParsedText {
  readonly raw: Buffer;
  readonly text: string;
  readonly lines: readonly string[];
  readonly sectionLines: readonly number[];
  readonly keyLines: readonly number[];
}

/** Strip a UTF-8 BOM and split on CRLF/LF/CR, preserving line order. */
function readText(path: string): ParsedText {
  return parseText(readFileSync(path));
}

/** Parse already-decoded text, so byte fixtures can be inspected after decoding. */
function parseText(raw: Buffer, decoded?: string): ParsedText {
  const text = decoded ?? (raw.subarray(0, 3).equals(BOM) ? raw.subarray(3) : raw).toString('utf8');
  const lines = text.split(/\r\n|\n|\r/);
  const sectionLines: number[] = [];
  const keyLines: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^\[[^\]]+\]$/.test(line)) {
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
function splitComplex(value: string): string[] {
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

function lineAt(parsed: ParsedText, line: number): string {
  const value = parsed.lines[line - 1];
  if (value === undefined) throw new Error(`line ${String(line)} does not exist`);
  return value;
}

function keyAt(parsed: ParsedText, line: number): string {
  const value = lineAt(parsed, line);
  const equals = value.indexOf('=');
  if (equals < 1) throw new Error(`line ${String(line)} is not a key=value line: ${value}`);
  return value.slice(0, equals);
}

function valueAt(parsed: ParsedText, line: number): string {
  const value = lineAt(parsed, line);
  const equals = value.indexOf('=');
  if (equals < 1) throw new Error(`line ${String(line)} is not a key=value line: ${value}`);
  return value.slice(equals + 1);
}

/** Line numbers of the `key` occurrences inside the n-th `[Entity]` section. */
function entityKeyLines(parsed: ParsedText, entity: number, key: string): number[] {
  const headers = parsed.sectionLines.filter((line) => lineAt(parsed, line) === '[Entity]');
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

function unquote(value: string): string {
  return /^".*"$/.test(value) ? value.slice(1, -1) : value;
}

/** Evaluate the small, documented fact vocabulary the registry uses. */
function factValue(path: string, parsed: ParsedText | null, bytes: Uint8Array | null): unknown {
  if (path === 'bytes.length') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    return bytes.byteLength;
  }
  if (path === 'bytes.prefix') {
    if (bytes === null) throw new Error('bytes fact on a text fixture');
    return Buffer.from(bytes.subarray(0, 2)).toString('hex');
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
  if (path === 'encoding.bom') return parsed.raw.subarray(0, 3).equals(BOM);
  if (path === 'encoding.crlf') return parsed.text.includes('\r\n');
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
    return parsed.sectionLines.filter((l) => lineAt(parsed, l) === '[Entity]').length;
  if (path === 'view.count')
    return parsed.sectionLines.filter((l) => lineAt(parsed, l) === '[View]').length;
  if (path === 'relation.count') {
    return parsed.sectionLines.filter((l) => lineAt(parsed, l) === '[Relation]').length;
  }
  if (path === 'field.1.keyOrders') {
    return entityKeyLines(parsed, 1, 'Field')
      .map((line) => unquote((splitComplex(valueAt(parsed, line))[4] ?? '').trim()))
      .join(',');
  }

  const lineKey = /^line\.(\d+)\.key$/.exec(path);
  if (lineKey?.[1] !== undefined) return keyAt(parsed, Number(lineKey[1]));

  const sectionHeader = /^section\.(\d+)\.header$/.exec(path);
  if (sectionHeader?.[1] !== undefined) {
    const line = parsed.sectionLines[Number(sectionHeader[1]) - 1];
    if (line === undefined) throw new Error(`section ${sectionHeader[1]} does not exist`);
    return lineAt(parsed, line);
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

function evaluateFact(
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

/**
 * True when git knows the path as tracked, or as an untracked file that is not
 * ignored. Before the fixture's first commit it is the latter, afterwards the
 * former; an ignored path returns false in both cases.
 */
function isKnownToGit(relativePath: string): boolean {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', relativePath],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === relativePath);
}

describe('fixture content', () => {
  it('registers exactly the 14 initial fixtures', () => {
    expect(FIXTURES).toHaveLength(14);
    expect(FIXTURES.map((spec) => spec.id)).toEqual([
      'fmt-01',
      'fmt-02',
      'fmt-04',
      'enc-02',
      'enc-03',
      'enc-04',
      'enc-05',
      'txt-04',
      'val-01',
      'val-02',
      'val-03',
      'val-05',
      'val-06',
      'sem-01',
    ]);
  });

  for (const spec of FIXTURES) {
    describe(`${spec.id} — ${spec.file}`, () => {
      const path = join(spec.fixtureClass === 'bytes' ? BYTES_DIR : SYNTHETIC_DIR, spec.file);

      it('is known to git and not ignored', () => {
        const relativePath = `tests/fixtures/${spec.fixtureClass}/${spec.file}`;
        expect(isKnownToGit(relativePath)).toBe(true);
      });

      it('declares no impossible span', () => {
        const parsed = spec.fixtureClass === 'bytes' ? null : readText(path);
        const lineCount = parsed === null ? 0 : parsed.lines.length;
        for (const span of spec.expectation.spans) {
          expect(span.endLine).toBeGreaterThanOrEqual(span.startLine);
          if (parsed === null) continue;
          expect(lineCount).toBeGreaterThanOrEqual(span.endLine);
          // A span must point at a key line or at a section header.
          const line = lineAt(parsed, span.keyLine);
          expect(/^\[[^\]]+\]$/.test(line) || line.includes('=')).toBe(true);
        }
      });

      if (spec.fixtureClass === 'bytes') {
        it('exports the declared bytes and satisfies its facts', () => {
          const module = BYTE_MODULES[spec.id];
          if (module === undefined) throw new Error(`no byte module for ${spec.id}`);
          expect(module.bytes).toBeInstanceOf(Uint8Array);
          const decoded =
            module.encoding === undefined
              ? null
              : new TextDecoder(module.encoding, { fatal: true }).decode(module.bytes);
          const parsed = decoded === null ? null : parseText(Buffer.from(module.bytes), decoded);
          for (const fact of spec.expectation.facts) {
            evaluateFact(spec, parsed, module.bytes, fact);
          }
        });
        return;
      }

      it('stages byte-identically and leaves the source untouched', () => {
        const before = sha256File(path);
        const staged = stageSource(path, { verifyBytes: true });
        try {
          expect(staged.sha256).toBe(before);
          expect(readFileSync(staged.path).equals(readFileSync(path))).toBe(true);
          expect(staged.path.endsWith('.a5er')).toBe(true);
        } finally {
          staged.cleanup();
        }
        expect(sha256File(path)).toBe(before);
      });

      it('matches the declared section and key totals', () => {
        const parsed = readText(path);
        expect(parsed.sectionLines.length, 'section headers').toBe(
          spec.expectation.counts.sections.total,
        );
        expect(parsed.keyLines.length, 'key=value lines').toBe(spec.expectation.counts.keys.total);
        const { sections, keys } = spec.expectation.counts;
        expect(sections.parsed + sections.preservedRaw).toBe(sections.total);
        expect(keys.parsed + keys.preservedRaw).toBe(keys.total);
      });

      it('contains every construct its facts assert', () => {
        const parsed = readText(path);
        expect(spec.expectation.facts.length).toBeGreaterThan(0);
        for (const fact of spec.expectation.facts) {
          evaluateFact(spec, parsed, null, fact);
        }
      });

      it('contains the raw markers its diagnostic codes depend on', () => {
        const parsed = readText(path);
        const codes = spec.expectation.codes;

        if (codes.includes('S_LEGACY_KEY') || codes.includes('V_INDEX_LEGACY_ONLY')) {
          expect(parsed.text).toMatch(/^Index=/m);
          expect(parsed.text).not.toMatch(/^IndexInfo=/m);
        }
        if (codes.includes('S_HEADER_UNKNOWN_FORMAT')) {
          expect(parsed.text).toMatch(/^# A5:ER FORMAT:(20|9\d+)$/m);
        }
        if (codes.includes('D_BOM_MISSING')) {
          expect(parsed.raw.subarray(0, 3).equals(BOM)).toBe(false);
        }
        if (codes.includes('S_FIELD_TOO_FEW_ELEMENTS')) {
          const tooFew = entityKeyLines(parsed, 1, 'Field').some(
            (line) => splitComplex(valueAt(parsed, line)).length < 8,
          );
          expect(tooFew).toBe(true);
        }
        if (codes.includes('V_DANGLING_ENTITY') || codes.includes('V_DANGLING_COLUMN')) {
          const entity1 = /^Entity1="([^"]+)"$/m.exec(parsed.text)?.[1];
          const entity2 = /^Entity2="([^"]+)"$/m.exec(parsed.text)?.[1];
          const declared = new Set(
            [...parsed.text.matchAll(/^PName="([^"]+)"$/gm)].map((match) => match[1]),
          );
          expect(entity1).toBeDefined();
          expect(entity2).toBeDefined();
          expect(declared.has(entity2 ?? '')).toBe(false);
        }
        if (codes.includes('V_DANGLING_PAGE')) {
          const pages = new Set(
            [...parsed.text.matchAll(/^PageInfo="([^"]+)"/gm)].map((m) => m[1]),
          );
          const referenced = [...parsed.text.matchAll(/^Position="([^"]+)"/gm)].map((m) => m[1]);
          expect(referenced.some((page) => !pages.has(page ?? ''))).toBe(true);
        }
        if (codes.includes('S_UNKNOWN_KEY') || codes.includes('S_UNKNOWN_SECTION')) {
          const sections = parsed.sectionLines.map((line) => lineAt(parsed, line));
          expect(sections.some((section) => !KNOWN_SECTIONS.includes(section))).toBe(true);
        }
        if (codes.includes('E_UNDECODABLE')) {
          expect(spec.fixtureClass).toBe('bytes');
        }
      });
    });
  }
});
