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
import { FIXTURES } from './helpers/fixture-registry.js';
import {
  BOM,
  entityKeyLines,
  evaluateFact,
  keyAt,
  lineAt,
  parseText,
  readText,
  splitComplex,
  unquote,
  valueAt,
} from './helpers/fixture-text.js';
import { BYTES_DIR, SYNTHETIC_DIR, sha256File, stageSource } from './helpers/stage.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface ByteModule {
  readonly bytes: Uint8Array;
  /** Encoding a reader would use for this file; absent when none succeeds. */
  readonly encoding?: string;
}

const BYTE_MODULES: Readonly<Record<string, ByteModule>> = {
  'enc-03': { bytes: enc03.BYTES, encoding: 'shift_jis' },
  'enc-04': { bytes: enc04.BYTES },
  'enc-05': { bytes: enc05.BYTES, encoding: 'utf-16le' },
  // Binary input: no decoder is ever asked, so no encoding is declared.
  'hst-02': { bytes: hst02.BYTES },
  'hst-05': { bytes: hst05.BYTES, encoding: 'utf-8' },
};

const KNOWN_SECTIONS = ['[Manager]', '[Entity]', '[Relation]', '[Relationship]', '[View]'];

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
  it('registers exactly the 51 catalog fixtures', () => {
    expect(FIXTURES).toHaveLength(51);
    expect(FIXTURES.map((spec) => spec.id)).toEqual([
      'fmt-01',
      'fmt-02',
      'fmt-03',
      'fmt-04',
      'fmt-05',
      'enc-02',
      'enc-03',
      'enc-04',
      'enc-05',
      'txt-01',
      'txt-02',
      'txt-03',
      'txt-04',
      'txt-05',
      'txt-06',
      'txt-07',
      'txt-08',
      'txt-09',
      'val-01',
      'val-02',
      'val-03',
      'val-04',
      'val-05',
      'val-06',
      'val-07',
      'val-08',
      'val-09',
      'val-10',
      'val-11',
      'sem-01',
      'sem-02',
      'sem-03',
      'sem-04',
      'sem-05',
      'sem-06',
      'sem-07',
      'sem-08',
      'sem-09',
      'sem-10',
      'sem-11',
      'hst-01',
      'hst-02',
      'hst-03',
      'hst-04',
      'hst-05',
      'hst-06',
      'res-01',
      'res-02',
      'res-03',
      'imm-01',
      'fuzz-01',
    ]);
  });

  for (const spec of FIXTURES) {
    // Generated, injected and catalog-wide entries have no committed file. Their bytes come
    // from a builder (`fixtures-generated.test.ts`) or do not exist at all yet, so asserting
    // a git-tracked path here would be a lie and an empty suite would be a second one.
    if (spec.fixtureClass !== 'synthetic' && spec.fixtureClass !== 'bytes') continue;

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
          // The header shape may carry inner brackets, as the section scanner allows.
          expect(/^\s*\[.+\]\s*$/.test(line) || line.includes('=')).toBe(true);
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
          for (const fact of spec.expectation.sourceFacts) {
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

      it('names only declared columns in its index definitions', () => {
        // R3: an index that references a column no `Field` declares is a dangling
        // reference in a fixture that claims to be healthy. This asserts name
        // existence only — resolution and the `V_DANGLING_*` codes belong to the
        // semantic stage, never to a byte-level content test.
        if (spec.expectation.codes.some((code) => code.startsWith('V_DANGLING'))) return;
        const parsed = readText(path);
        const declared = new Set(
          parsed.keyLines
            .filter((line) => keyAt(parsed, line) === 'Field')
            .map((line) => unquote((splitComplex(valueAt(parsed, line))[1] ?? '').trim())),
        );

        const referenced: { column: string; where: string }[] = [];
        for (const line of parsed.keyLines) {
          const key = keyAt(parsed, line);
          if (key === 'IndexInfo') {
            const columns = unquote((splitComplex(valueAt(parsed, line))[2] ?? '').trim());
            for (const column of columns.split(',')) {
              referenced.push({
                column: column.trim(),
                where: `IndexInfo on line ${String(line)}`,
              });
            }
          }
          if (key === 'Index') {
            // Legacy payload is `name=flag,columns`; the flag is not a column name.
            const payload = valueAt(parsed, line).split('=').at(-1) ?? '';
            for (const column of payload.split(',').slice(1)) {
              referenced.push({ column: column.trim(), where: `Index on line ${String(line)}` });
            }
          }
        }

        const dangling = referenced.filter(
          (entry) => entry.column !== '' && !declared.has(entry.column),
        );
        expect(dangling.map((entry) => `${entry.where}: ${entry.column}`)).toEqual([]);
      });

      it('contains every construct its facts assert', () => {
        const parsed = readText(path);
        expect(spec.expectation.sourceFacts.length).toBeGreaterThan(0);
        for (const fact of spec.expectation.sourceFacts) {
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
          // The code covers three cases: no header at all, FORMAT:20 (the documented
          // hole) and FORMAT above 21. A known version here would contradict the code.
          const declared = /^# A5:ER FORMAT:(.+)$/m.exec(parsed.text)?.[1];
          expect(declared === undefined || declared === '20' || Number(declared) > 21).toBe(true);
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
