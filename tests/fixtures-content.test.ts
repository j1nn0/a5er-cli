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
import type { ParsedText } from './helpers/fixture-text.js';
import {
  BOM,
  entityKeyLines,
  evaluateFact,
  headerName,
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
/**
 * The catalog's section and key totals, counted from the fixture's own text.
 *
 * `parseText` is a line-level reader, not a parser (`test-strategy` §7 T1): a section header is
 * `[…]` after trimming, a key line has an `=` after at least one other character, and blank lines
 * and `#` comments are neither. Byte fixtures use the same reader on their decoded text, so the
 * number a catalog entry claims is checked against the bytes instead of against a parser's opinion
 * — which is what caught `enc-05`'s stale `keys.total`.
 */
function assertDeclaredTotals(spec: FixtureSpec, parsed: ParsedText): void {
  expect(parsed.sectionLines.length, 'section headers').toBe(
    spec.expectation.counts.sections.total,
  );
  expect(parsed.keyLines.length, 'key=value lines').toBe(spec.expectation.counts.keys.total);
  const { sections, keys } = spec.expectation.counts;
  expect(sections.parsed + sections.preservedRaw).toBe(sections.total);
  expect(keys.parsed + keys.preservedRaw).toBe(keys.total);
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
        it('matches the declared section and key totals in its decoded bytes', () => {
          const module = BYTE_MODULES[spec.id];
          if (module === undefined) throw new Error(`no byte module for ${spec.id}`);
          // Binary and invalid input have no decoded text to count, and their entries say 0/0.
          if (module.encoding === undefined) {
            expect(spec.expectation.counts.sections.total, 'sections').toBe(0);
            expect(spec.expectation.counts.keys.total, 'keys').toBe(0);
            return;
          }
          const decoded = new TextDecoder(module.encoding, { fatal: true }).decode(module.bytes);
          assertDeclaredTotals(spec, parseText(Buffer.from(module.bytes), decoded));
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
        assertDeclaredTotals(spec, readText(path));
      });

      it('resolves every reference when no dangling code is expected', () => {
        // R9: a fixture that reports no V_DANGLING_* must be referentially clean — pages,
        // relation endpoints and every column a relation or index names. This is name
        // resolution over text, not the semantic layer: it proves the names exist, and
        // that is what keeps a "normal" fixture from quietly becoming an abnormal one.
        if (spec.expectation.codes.some((code) => code.startsWith('V_DANGLING'))) return;
        const parsed = readText(path);

        /** One `[Entity]` section as the names and columns it declares. */
        const entities = new Map<string, Set<string>>();
        for (const [index, header] of parsed.sectionLines.entries()) {
          if (headerName(parsed, header) !== '[Entity]') continue;
          const next = parsed.sectionLines[index + 1] ?? parsed.lines.length + 1;
          const inside = parsed.keyLines.filter((line) => line > header && line < next);
          const pname = inside
            .filter((line) => keyAt(parsed, line) === 'PName')
            .map((line) => unquote(valueAt(parsed, line)))[0];
          if (pname === undefined) continue;
          const columns = new Set(
            inside
              .filter((line) => keyAt(parsed, line) === 'Field')
              .map((line) => unquote((splitComplex(valueAt(parsed, line))[1] ?? '').trim())),
          );
          entities.set(pname, columns);
        }

        const declaredPages = new Set(
          parsed.keyLines
            .filter((line) => keyAt(parsed, line) === 'PageInfo')
            .map((line) => unquote(valueAt(parsed, line).split(',')[0] ?? '').toLowerCase()),
        );

        const problems: string[] = [];
        const checkPage = (page: string, where: string): void => {
          if (page !== '' && !declaredPages.has(page.toLowerCase())) {
            problems.push(`${where}: page ${page} is not declared`);
          }
        };

        for (const line of parsed.keyLines) {
          const key = keyAt(parsed, line);
          if (key === 'Position') {
            const page = unquote((splitComplex(valueAt(parsed, line))[0] ?? '').trim());
            checkPage(page, `Position on line ${String(line)}`);
          }
          if (key === 'IndexInfo') {
            const columns = unquote((splitComplex(valueAt(parsed, line))[2] ?? '').trim());
            for (const column of columns.split(',')) {
              const name = column.trim();
              const declared = [...entities.values()].some((set) => set.has(name));
              if (name !== '' && !declared) {
                problems.push(`IndexInfo on line ${String(line)}: column ${name} is not declared`);
              }
            }
          }
          if (key === 'Index') {
            // Legacy payload is `name=flag,columns`; the flag is not a column name.
            const payload = valueAt(parsed, line).split('=').at(-1) ?? '';
            for (const column of payload.split(',').slice(1)) {
              const name = column.trim();
              const declared = [...entities.values()].some((set) => set.has(name));
              if (name !== '' && !declared) {
                problems.push(`Index on line ${String(line)}: column ${name} is not declared`);
              }
            }
          }
        }

        // Relations: both endpoints must be declared entities, and each column list must
        // name columns that its own endpoint declares.
        for (const [index, header] of parsed.sectionLines.entries()) {
          if (
            headerName(parsed, header) !== '[Relation]' &&
            headerName(parsed, header) !== '[Relationship]'
          )
            continue;
          const next = parsed.sectionLines[index + 1] ?? parsed.lines.length + 1;
          const inside = parsed.keyLines.filter((line) => line > header && line < next);
          const value = (key: string): string | undefined => {
            const line = inside.filter((candidate) => keyAt(parsed, candidate) === key)[0];
            return line === undefined ? undefined : unquote(valueAt(parsed, line));
          };
          for (const [side, nameKey] of [
            ['1', 'Entity1'],
            ['2', 'Entity2'],
          ] as const) {
            const entity = value(nameKey);
            const columns = value(`Fields${side}`);
            const declared = entity === undefined ? undefined : entities.get(entity);
            if (entity !== undefined && declared === undefined) {
              problems.push(
                `${nameKey} on line ${String(header)}: entity ${entity} is not declared`,
              );
              continue;
            }
            for (const column of (columns ?? '').split(',')) {
              const name = column.trim();
              if (name !== '' && declared !== undefined && !declared.has(name)) {
                problems.push(
                  `Fields${side} on line ${String(header)}: column ${name} is not declared`,
                );
              }
            }
          }
        }

        expect(problems).toEqual([]);
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
        if (codes.includes('V_VIEW_COLUMNS_UNKNOWN')) {
          // Architecture §9.6: every view whose columns cannot be obtained reports it once,
          // whether they are merely not stored or named from the query. One view, one code.
          const views = parsed.sectionLines.filter(
            (line) => headerName(parsed, line) === '[View]',
          ).length;
          expect(views, `${spec.id}: views`).toBeGreaterThan(0);
          expect(
            codes.filter((code) => code === 'V_VIEW_COLUMNS_UNKNOWN'),
            `${spec.id}: one info per view`,
          ).toHaveLength(views);
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
