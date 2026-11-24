/**
 * `decode/` — detection, strict decoding and the document guard (`architecture.md` §8, §10.4).
 *
 * The fixtures decide most of these cases: every encoding row of §8.4 has a committed fixture,
 * and each assertion compares what the decoder reported with what the catalog row expects. The
 * remaining tests cover the parts a fixture cannot reach — the BOM-versus-binary ordering, codec
 * ambiguity, the exact text-limit boundaries, and the hostile-input promises (no file content in
 * a trusted field).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emit, messageOf, severityOf } from '../src/diagnostics/diagnostic.js';
import { MAX_DETAIL_LENGTH } from '../src/diagnostics/diagnostic.js';
import { nulDensity } from '../src/io/binary.js';
import type { FileSystem } from '../src/io/fs.js';
import { DEFAULT_LIMITS } from '../src/io/limits.js';
import { NO_BOM, sniffBom } from '../src/decode/bom.js';
import { decodeBytes, isCodecAvailable } from '../src/decode/decode.js';
import { NO_HEADER, parseHeader, peekHeader } from '../src/decode/header.js';
import { loadSource } from '../src/decode/load.js';
import type { LoadOptions } from '../src/decode/load.js';
import { hasRecognisedSection, scanSectionHeaders } from '../src/decode/sections.js';
import {
  CAPPED_READ_LIMIT_BYTES,
  GENERATED_BUILDERS,
  MAX_BYTES,
  SINGLE_LINE_BYTES,
} from './helpers/generated.js';
import { FIXTURES } from './helpers/fixture-registry.js';
import { assertCodes } from './helpers/assert-codes.js';
import { stage } from './helpers/stage.js';
import * as enc03 from './fixtures/bytes/enc-03-sjis.js';
import * as enc04 from './fixtures/bytes/enc-04-undecodable.js';
import * as enc05 from './fixtures/bytes/enc-05-utf16le.js';
import * as hst02 from './fixtures/bytes/hst-02-binary.js';
import * as hst05 from './fixtures/bytes/hst-05-mixed-eol.js';

/** Temporary directory that is removed even when the test throws. */
function withTempDir<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-decode-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Write `bytes` under `name` in a fresh temp directory and load it. */
function loadBytes(bytes: Uint8Array, name = 'case.a5er', options: LoadOptions = {}) {
  return withTempDir((directory) => {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    return loadSource(path, options);
  });
}

/** Codes of a failure outcome. */
function failureCodes(outcome: {
  ok: boolean;
  diagnostics?: readonly { code: string }[];
}): string[] {
  return (outcome.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

/** Expected codes for a catalog entry. */
function expectedCodes(id: string): readonly string[] {
  const spec = FIXTURES.find((candidate) => candidate.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return spec.expectation.codes;
}

describe('the committed encoding fixtures (§8.4)', () => {
  it('fmt-01: UTF-8 with a BOM decodes silently and keeps CRLF', () => {
    const staged = stage('fmt-01');
    try {
      const outcome = loadSource(staged.path);
      if (!outcome.ok) throw new Error(`load failed: ${failureCodes(outcome).join(',')}`);

      const { source } = outcome;
      expect(source.encoding).toEqual({
        detected: 'utf-8',
        bom: true,
        declared: 'UTF8',
        mismatch: false,
      });
      expect(source.format).toBe(21);
      expect(source.diagnostics).toEqual([]);
      // No newline rewriting: the CRLF of the fixture survives decoding untouched.
      expect(source.text.includes('\r\n')).toBe(true);
      expect(source.sizeBytes).toBe(readFileSync(staged.path).byteLength);
      expect(source.sha256).toBe(staged.sha256);
    } finally {
      staged.cleanup();
    }
  });

  it('enc-02: UTF-8 without a BOM reports D_BOM_MISSING once', () => {
    const staged = stage('enc-02');
    try {
      const outcome = loadSource(staged.path);
      if (!outcome.ok) throw new Error('load failed');

      expect(outcome.source.encoding).toEqual({
        detected: 'utf-8',
        bom: false,
        declared: 'UTF8',
        mismatch: false,
      });
      assertCodes(
        outcome.source.diagnostics.map((diagnostic) => diagnostic.code),
        expectedCodes('enc-02'),
      );
      expect(outcome.source.diagnostics[0]?.severity).toBe('info');
    } finally {
      staged.cleanup();
    }
  });

  it('enc-03: Shift_JIS bytes under an ENCODING:UTF8 header decode correctly and mismatch', () => {
    const outcome = loadBytes(Buffer.from(enc03.BYTES));
    if (!outcome.ok) throw new Error('load failed');

    expect(outcome.source.encoding).toEqual({
      detected: 'shift_jis',
      bom: false,
      declared: 'UTF8',
      mismatch: true,
    });
    assertCodes(
      outcome.source.diagnostics.map((diagnostic) => diagnostic.code),
      expectedCodes('enc-03'),
    );
    expect(outcome.source.diagnostics[0]?.severity).toBe('warning');
    // The Japanese names are exact — no U+FFFD, no mojibake (L3).
    expect(outcome.source.text).toContain('PName="注文"');
    expect(outcome.source.text).toContain('LName="注文テーブル"');
    expect(outcome.source.text.includes('\uFFFD')).toBe(false);
  });

  it('enc-04: no candidate decodes it, so the result is E_UNDECODABLE with no text', () => {
    const outcome = loadBytes(Buffer.from(enc04.BYTES));

    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), expectedCodes('enc-04'));
    const [diagnostic] = outcome.ok ? [] : outcome.diagnostics;
    expect(diagnostic?.severity).toBe('fatal');
    // Every candidate that was tried is named, so the refusal is not a silent one.
    expect(String(diagnostic?.details['tried'])).toContain('utf-8');
    // A failure carries no text at all: the type has nowhere to put lossy output.
    expect(Object.keys(outcome)).toEqual(['ok', 'diagnostics']);
  });

  it('enc-05: a UTF-16LE BOM is decoded, not rejected as binary', () => {
    const outcome = loadBytes(Buffer.from(enc05.BYTES));
    if (!outcome.ok) throw new Error(`load failed: ${failureCodes(outcome).join(',')}`);

    expect(outcome.source.encoding).toEqual({
      detected: 'utf-16le',
      bom: true,
      declared: null,
      mismatch: false,
    });
    assertCodes(
      outcome.source.diagnostics.map((diagnostic) => diagnostic.code),
      expectedCodes('enc-05'),
    );
    expect(outcome.source.text).toContain('# A5:ER FORMAT:21');
    // Its NUL density is far above the binary threshold; the BOM check runs first (§8.1).
    expect(nulDensity(enc05.BYTES)).toBeGreaterThan(0.1);
  });
});

describe('the hostile-byte fixtures (§10.4, §14 row 15)', () => {
  it('hst-01: a single NUL inside a comment passes through untouched', () => {
    const staged = stage('hst-01');
    try {
      const outcome = loadSource(staged.path);
      if (!outcome.ok) throw new Error('load failed');

      assertCodes(
        outcome.source.diagnostics.map((diagnostic) => diagnostic.code),
        expectedCodes('hst-01'),
      );
      expect(outcome.source.text.includes('before\u0000after')).toBe(true);
      expect(nulDensity(readFileSync(staged.path))).toBeLessThan(0.01);
    } finally {
      staged.cleanup();
    }
  });

  it('hst-02: NUL density above 10 % is E_BINARY_INPUT', () => {
    const outcome = loadBytes(Buffer.from(hst02.BYTES));

    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), expectedCodes('hst-02'));
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['windowBytes']).toBe(4096);
    expect(nulDensity(hst02.BYTES)).toBeCloseTo(0.25, 5);
  });

  it('hst-05: CRLF, LF and a bare CR all survive decoding', () => {
    const outcome = loadBytes(Buffer.from(hst05.BYTES));
    if (!outcome.ok) throw new Error('load failed');

    assertCodes(
      outcome.source.diagnostics.map((diagnostic) => diagnostic.code),
      expectedCodes('hst-05'),
    );
    const withoutCrlf = outcome.source.text.replace(/\r\n/g, '');
    expect(outcome.source.text.includes('\r\n')).toBe(true);
    expect(withoutCrlf.includes('\n')).toBe(true);
    expect(withoutCrlf.includes('\r')).toBe(true);
    // Byte-faithful: the decoded text is the file minus its BOM, nothing else.
    const expected = Buffer.from(hst05.BYTES)
      .toString('utf8')
      .replace(/^\uFEFF/, '');
    expect(outcome.source.text).toBe(expected);
  });
});

describe('the generated families', () => {
  it('hst-06: each member produces its own documented outcome', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'hst-06');
    const members = spec?.expectation.files;
    if (members === undefined) throw new Error('hst-06 is not a per-file family');

    const built = GENERATED_BUILDERS['hst-06']?.() ?? [];
    expect(built).toHaveLength(members.length);

    for (const file of built) {
      const expected = members.find((member) => member.file === file.name);
      if (expected === undefined) throw new Error(`${file.name} has no expectation`);
      const outcome = loadBytes(file.bytes, file.name);
      expect(outcome.ok, file.name).toBe(false);
      assertCodes(failureCodes(outcome), expected.codes, file.name);
    }
  });

  it('hst-03: a 1 MiB line is a document, not a limit breach', () => {
    const built = GENERATED_BUILDERS['hst-03']?.() ?? [];
    const first = built[0];
    if (first === undefined) throw new Error('hst-03 built no file');

    const outcome = loadBytes(first.bytes, first.name);
    if (!outcome.ok) throw new Error('hst-03 must load under the default limits');
    assertCodes(
      outcome.source.diagnostics.map((d) => d.code),
      expectedCodes('hst-03'),
    );

    const longest = outcome.source.text
      .split(/\r\n|\n|\r/)
      .reduce((max, line) => Math.max(max, line.length), 0);
    expect(longest).toBe(SINGLE_LINE_BYTES);
    expect(outcome.source.text.length).toBeGreaterThan(SINGLE_LINE_BYTES);
  });
  it('res-01: a read stopped by the cap is E_LIMIT_BYTES', () => {
    const built = GENERATED_BUILDERS['res-01']?.() ?? [];
    const first = built[0];
    if (first === undefined) throw new Error('res-01 built no file');

    // The fixture is larger than the cap the reader is given, so the *limit* fired.
    expect(first.bytes.byteLength).toBeGreaterThan(CAPPED_READ_LIMIT_BYTES);
    // The cap is the fixture: read the same bytes with a 4 KiB limit, as the catalog expects.
    const outcome = loadBytes(first.bytes, first.name, {
      limits: { maxBytes: CAPPED_READ_LIMIT_BYTES },
    });

    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), expectedCodes('res-01'));
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['maxBytes']).toBe(
      CAPPED_READ_LIMIT_BYTES,
    );
  });

  it('res-03: one limit per file, matched against the catalog', () => {
    const spec = FIXTURES.find((candidate) => candidate.id === 'res-03');
    const members = spec?.expectation.files;
    if (members === undefined) throw new Error('res-03 is not a per-file family');

    const built = GENERATED_BUILDERS['res-03']?.() ?? [];
    const byName = new Map(built.map((file) => [file.name, file.bytes]));

    for (const member of members) {
      const expected = members.find((candidate) => candidate.file === member.file);
      if (expected === undefined) throw new Error(`${member.file} has no expectation`);

      if (member.file === 'res-03-max-bytes.a5er') {
        // 64 MiB + 1 is refused from its stat; writing the file to reach that is waste.
        const bytes = byName.get(member.file);
        if (bytes === undefined) throw new Error('res-03 built no max-bytes file');
        expect(bytes.byteLength).toBe(MAX_BYTES + 1);
        continue;
      }

      const bytes = byName.get(member.file);
      if (bytes === undefined) throw new Error(`res-03 built no ${member.file}`);
      const outcome = loadBytes(bytes, member.file);
      expect(outcome.ok, member.file).toBe(false);
      assertCodes(failureCodes(outcome), expected.codes, member.file);
    }
  });
});

describe('candidate order without a BOM (R11)', () => {
  /** The exact case from the R11 report: these UTF-8 bytes are also valid Shift_JIS. */
  const mojibakeCase = '# A5:ER FORMAT:21\n# A5:ER ENCODING:SJIS\n[Entity]\nPName=ユーザー\n';

  it('R11 premise: the bytes decode strictly under both codecs', () => {
    // Without this, the regression below could pass by luck rather than because of the order.
    const bytes = Buffer.from('ユーザー', 'utf8');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe('ユーザー');
    // Strict success, wrong text: 繝ｦ繝ｼ繧ｶ繝ｼ is the mojibake the old candidate order returned
    // as `ok: true` with no diagnostic at all.
    expect(new TextDecoder('shift_jis', { fatal: true }).decode(bytes)).toBe('繝ｦ繝ｼ繧ｶ繝ｼ');
  });

  it('R11: a UTF-8 file declaring ENCODING:SJIS decodes as UTF-8, not mojibake', () => {
    const outcome = decodeBytes(Buffer.from(mojibakeCase, 'utf8'));
    if (!outcome.ok) throw new Error('the input must decode');

    expect(outcome.decoded.encoding).toEqual({
      detected: 'utf-8',
      bom: false,
      declared: 'SJIS',
      mismatch: true,
    });
    // The Japanese string itself, not merely "ok".
    expect(outcome.decoded.text).toContain('PName=ユーザー');
    // And the Shift_JIS reading of those bytes must never reach a consumer.
    expect(outcome.decoded.text.includes('繝ｦ繝ｼ繧ｶ繝ｼ')).toBe(false);
    assertCodes(
      outcome.decoded.diagnostics.map((diagnostic) => diagnostic.code),
      ['D_BOM_MISSING', 'D_ENCODING_MISMATCH'],
    );

    // The mismatch carries both values, so a consumer can see what disagreed (§8.4).
    const mismatch = outcome.decoded.diagnostics.find(
      (diagnostic) => diagnostic.code === 'D_ENCODING_MISMATCH',
    );
    expect(mismatch?.details).toEqual({ declared: 'SJIS', detected: 'utf-8' });
    expect(mismatch?.severity).toBe('warning');
  });

  it('never lets the declaration promote a legacy codec over UTF-8', () => {
    // Same bytes, three declarations: the detected codec is utf-8 in every case, and the
    // declaration only decides whether the disagreement is reported.
    const cases: readonly (readonly [string, string | null])[] = [
      ['# A5:ER FORMAT:21\nPName=ユーザー\n', null],
      ['# A5:ER FORMAT:21\n# A5:ER ENCODING:UTF8\nPName=ユーザー\n', 'UTF8'],
      ['# A5:ER FORMAT:21\n# A5:ER ENCODING:SJIS\nPName=ユーザー\n', 'SJIS'],
    ];

    for (const [text, declared] of cases) {
      const outcome = decodeBytes(Buffer.from(text, 'utf8'));
      if (!outcome.ok) throw new Error(`decode failed for declared=${String(declared)}`);
      expect(outcome.decoded.encoding.detected, String(declared)).toBe('utf-8');
      expect(outcome.decoded.encoding.declared).toBe(declared);
      expect(outcome.decoded.encoding.mismatch).toBe(declared === 'SJIS');
      expect(outcome.decoded.text).toContain('PName=ユーザー');
    }
  });

  it('accepts a legacy codec only once UTF-8 has failed strictly', () => {
    // enc-03 is the affirmative case: its bytes are invalid UTF-8, so the Shift_JIS success is
    // evidence rather than a preference. This is the only rule by which a non-UTF-8 codec wins.
    const bytes = Buffer.from(enc03.BYTES);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
    expect(new TextDecoder('shift_jis', { fatal: true }).decode(bytes)).toContain('注文');

    const outcome = decodeBytes(bytes);
    if (!outcome.ok) throw new Error('enc-03 must decode');
    expect(outcome.decoded.encoding).toEqual({
      detected: 'shift_jis',
      bom: false,
      declared: 'UTF8',
      mismatch: true,
    });
  });

  it('does not claim uniqueness when UTF-8 succeeds', () => {
    // Both readings exist; the reader reports the one priority chose and says nothing more.
    const bytes = Buffer.from('PName=ユーザー\n', 'utf8');
    const outcome = decodeBytes(bytes);
    if (!outcome.ok) throw new Error('decode failed');

    expect(outcome.decoded.encoding.detected).toBe('utf-8');
    // No diagnostic asserts "this file is UTF-8"; only the absent BOM is reported.
    assertCodes(
      outcome.decoded.diagnostics.map((diagnostic) => diagnostic.code),
      ['D_BOM_MISSING'],
    );
    expect(outcome.decoded.encoding.mismatch).toBe(false);
  });
});

describe('the catalog, decoded end to end', () => {
  it('produces exactly the decode-stage codes each committed fixture declares', () => {
    // Every synthetic fixture must load, and its observed D_*/E_* codes must be exactly the
    // decode-stage subset of its catalog row: no fixture may quietly gain a decode diagnostic,
    // and none may declare one the decoder never produces.
    const synthetic = FIXTURES.filter((spec) => spec.fixtureClass === 'synthetic');
    expect(synthetic.length).toBeGreaterThan(30);

    for (const spec of synthetic) {
      const staged = stage(spec.id);
      try {
        const outcome = loadSource(staged.path);
        expect(outcome.ok, `${spec.id} must load`).toBe(true);
        if (!outcome.ok) continue;

        const observed = outcome.source.diagnostics.map((diagnostic) => diagnostic.code);
        const declared = spec.expectation.codes.filter(
          (code) => code.startsWith('D_') || code.startsWith('E_'),
        );
        assertCodes(observed, declared, spec.id);
      } finally {
        staged.cleanup();
      }
    }
  });

  it('reports the FORMAT each fixture declares', () => {
    // FORMAT is a decode-stage fact; the F2 gate (syntax stage) turns 20/99/absent into
    // S_HEADER_UNKNOWN_FORMAT, and no fixture may depend on decode for that code.
    const cases: readonly (readonly [string, number | null])[] = [
      ['fmt-01', 21],
      ['fmt-02', 19],
      ['fmt-03', null],
      ['fmt-04', 20],
      ['fmt-05', 99],
    ];
    for (const [id, expected] of cases) {
      const staged = stage(id);
      try {
        const outcome = loadSource(staged.path);
        if (!outcome.ok) throw new Error(`${id} failed to load`);
        expect(outcome.source.format, id).toBe(expected);
      } finally {
        staged.cleanup();
      }
    }
  });
});

describe('the document guard (§10.4)', () => {
  it('reports an empty file as E_EMPTY_INPUT and a whitespace-only file the same way', () => {
    for (const [name, content] of [
      ['empty.a5er', ''],
      ['whitespace.a5er', '  \n\t\r\n  \n'],
    ] as const) {
      const outcome = loadBytes(Buffer.from(content, 'utf8'), name);
      expect(outcome.ok, name).toBe(false);
      assertCodes(failureCodes(outcome), ['E_EMPTY_INPUT'], name);
    }
  });

  it('reports a file with content but no recognised header as E_UNRECOGNIZED_DOCUMENT', () => {
    const json = '{\n  "not": "an a5er file"\n}\n';
    const outcome = loadBytes(Buffer.from(json, 'utf8'), 'not-a-diagram.a5er');

    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), ['E_UNRECOGNIZED_DOCUMENT']);
    expect(outcome.ok ? null : outcome.diagnostics[0]?.details['headers']).toBe(0);
  });

  it('treats a file with only unknown sections as unrecognised', () => {
    // `[Memo]` is a header, but not one this project models: zero *recognised* headers (§10.4).
    const outcome = loadBytes(Buffer.from('# A5:ER FORMAT:21\n[Memo]\nNote="x"\n', 'utf8'));
    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), ['E_UNRECOGNIZED_DOCUMENT']);
  });

  it('accepts every recognised header name, case-sensitively', () => {
    const recognised = [
      'Manager',
      'Entity',
      'Relation',
      'Relationship',
      'View',
      'Subtype',
      'Shape',
      'Line',
      'Comment',
    ];
    for (const name of recognised) {
      expect(hasRecognisedSection(`[${name}]`), name).toBe(true);
    }
    // §6 P3: the registry is case-sensitive and defines no case rule.
    expect(hasRecognisedSection('[entity]')).toBe(false);
    expect(hasRecognisedSection('[Memo]')).toBe(false);
  });

  it('scans headers with the outer pair as the delimiter only', () => {
    expect(scanSectionHeaders('[Manager]\n  [Entity]  \n[Entity]x\n[[Entity]]\n')).toEqual([
      'Manager',
      'Entity',
      '[Entity]',
    ]);
  });
});

describe('decoding decisions', () => {
  it('reports a BOM before the binary probe: UTF-16LE is text', () => {
    const bytes = Buffer.from(enc05.BYTES);
    // The same bytes without their BOM would be binary by density and undecodable as UTF-8.
    const withoutBom = bytes.subarray(2);
    expect(nulDensity(withoutBom)).toBeGreaterThan(0.1);

    const outcome = loadBytes(bytes);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.source.encoding.detected).toBe('utf-16le');
  });

  it('a strict success alone does not identify the codec, so priority decides', () => {
    // 18 bytes: even, so UTF-16LE also decodes it and all three candidates genuinely succeed.
    const ascii = Buffer.from('# A5:ER FORMAT:21\n', 'utf8');

    // All three decode the same ASCII bytes without error — the input is genuinely ambiguous.
    const decoded = (['utf-8', 'shift_jis', 'utf-16le'] as const).map((codec) =>
      new TextDecoder(codec, { fatal: true }).decode(ascii),
    );
    expect(decoded[0]).toBe(decoded[1]);
    expect(decoded.every((text) => text.length > 0)).toBe(true);

    // Priority is §8.2's fixed order, and §8.4 row 1 motivates utf-8 first: the spec's
    // preferred form, and an ASCII superset, so a legacy file is never read as mojibake.
    const outcome = decodeBytes(ascii);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.decoded.encoding.detected).toBe('utf-8');
    // Three characters, nine bytes: the decoder produced characters, not bytes.
    expect(encode('テスト').byteLength).toBe(9);
  });

  it('round-trips Japanese text with no replacement character', () => {
    const body = '# A5:ER FORMAT:21\n# A5:ER ENCODING:UTF8\n\n[Entity]\nPName="テスト"\n';
    const outcome = decodeBytes(Buffer.from(`\uFEFF${body}`, 'utf8'));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.decoded.text).toBe(body);
    expect(outcome.decoded.text.includes('\uFFFD')).toBe(false);
    expect(outcome.decoded.encoding.declared).toBe('UTF8');
    expect(outcome.decoded.encoding.bom).toBe(true);
    expect(outcome.decoded.diagnostics).toEqual([]);
  });

  it('uses the bytes when the header declares a different codec', () => {
    // §8.4 row 4: declared SJIS, bytes UTF-8. The bytes win and both values are reported.
    const text = '# A5:ER FORMAT:21\n# A5:ER ENCODING:SJIS\n\n[Entity]\nPName="テスト"\n';
    const outcome = decodeBytes(Buffer.from(text, 'utf8'));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.decoded.encoding).toEqual({
      detected: 'utf-8',
      bom: false,
      declared: 'SJIS',
      mismatch: true,
    });
    expect(outcome.decoded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'D_BOM_MISSING',
      'D_ENCODING_MISMATCH',
    ]);
    expect(outcome.decoded.text).toContain('テスト');
  });

  it('does not treat a Shift_JIS declaration as evidence when UTF-8 decodes strictly', () => {
    // Same bytes, declared SJIS: decoding still succeeds as UTF-8, never as Shift_JIS mojibake.
    const text = '# A5:ER FORMAT:21\n# A5:ER ENCODING:SJIS\nPName="テスト"\n';
    const outcome = decodeBytes(Buffer.from(text, 'utf8'));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.decoded.text.includes('テスト')).toBe(true);
  });

  it('takes the header from the decoded text, not from the byte peek', () => {
    const bytes = Buffer.from(enc05.BYTES);
    // The ASCII peek cannot see a UTF-16LE header; the decoded text can, and it is authoritative.
    expect(peekHeader(bytes)).toEqual(NO_HEADER);
    const outcome = decodeBytes(bytes);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.decoded.format).toBe(21);
  });

  it('reports an unknown FORMAT without failing the decode', () => {
    for (const declared of [19, 20, 99]) {
      const text = `# A5:ER FORMAT:${String(declared)}\n[Entity]\nPName="x"\n`;
      const outcome = decodeBytes(Buffer.from(text, 'utf8'));
      expect(outcome.ok, String(declared)).toBe(true);
      if (outcome.ok) {
        expect(outcome.decoded.format).toBe(declared);
        // The F2 gate owns that verdict; decode reports no syntax code.
        expect(outcome.decoded.diagnostics.every((d) => !d.code.startsWith('S_'))).toBe(true);
      }
    }
  });

  it('sniffs the three BOMs and nothing else', () => {
    expect(sniffBom(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ codec: 'utf-8', length: 3 });
    expect(sniffBom(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toEqual({
      codec: 'utf-16le',
      length: 2,
    });
    expect(sniffBom(Buffer.from([0xfe, 0xff, 0x00, 0x41]))).toEqual({
      codec: 'utf-16be',
      length: 2,
    });
    expect(sniffBom(Buffer.from([0x41, 0x42]))).toBe(NO_BOM);
    expect(sniffBom(Buffer.alloc(0))).toBe(NO_BOM);
  });

  it('probes the legacy codec instead of assuming it (§8.3)', () => {
    expect(isCodecAvailable('shift_jis')).toBe(true);
    expect(isCodecAvailable('utf-8')).toBe(true);
  });

  it('parses both header lines and ignores a non-numeric FORMAT', () => {
    expect(parseHeader('# A5:ER FORMAT:21\n# A5:ER ENCODING:SJIS\n')).toEqual({
      format: 21,
      encoding: 'SJIS',
    });
    expect(parseHeader('# A5:ER FORMAT:abc\n')).toEqual({ format: null, encoding: null });
    expect(parseHeader('')).toEqual(NO_HEADER);
    // The documented spelling tolerates whitespace after `#` (§8.1's pattern).
    expect(parseHeader('#   A5:ER   FORMAT:19\n').format).toBe(19);
  });
});

describe('the text limits (§10.2)', () => {
  it('accepts exactly maxLines and rejects maxLines + 1', () => {
    const atLimit = decodeBytes(Buffer.from('a\nb\nc', 'utf8'), { limits: { maxLines: 3 } });
    expect(atLimit.ok).toBe(true);

    const over = decodeBytes(Buffer.from('a\nb\nc\nd', 'utf8'), { limits: { maxLines: 3 } });
    expect(over.ok).toBe(false);
    assertCodes(failureCodes(over), ['E_LIMIT_LINES']);
    expect(over.ok ? {} : over.diagnostics[0]?.details).toEqual({ lines: 4, maxLines: 3 });
  });

  it('counts CRLF as one line break', () => {
    const text = 'a\r\nb\r\nc';
    const outcome = decodeBytes(Buffer.from(text, 'utf8'), { limits: { maxLines: 3 } });
    expect(outcome.ok).toBe(true);
  });

  it('accepts exactly maxLineLength and rejects one character more', () => {
    const atLimit = decodeBytes(Buffer.from('abcde', 'utf8'), { limits: { maxLineLength: 5 } });
    expect(atLimit.ok).toBe(true);

    const over = decodeBytes(Buffer.from('abcdef', 'utf8'), { limits: { maxLineLength: 5 } });
    expect(over.ok).toBe(false);
    assertCodes(failureCodes(over), ['E_LIMIT_LINE_LENGTH']);
    expect(over.ok ? {} : over.diagnostics[0]?.details).toEqual({
      maxLineLength: 5,
      longestLine: 6,
    });
  });

  it('reports the first breach of the documented order', () => {
    // A file breaching lines *and* line length reports the line count, the earlier check.
    const outcome = decodeBytes(Buffer.from('abcdef\nabcdef\n', 'utf8'), {
      limits: { maxLines: 1, maxLineLength: 3 },
    });
    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), ['E_LIMIT_LINES']);
  });
});

/**
 * U3-B2 — the text limits are validated in the safe-integer range, and the decode contract around
 * them does not move: the boundary is still inclusive, the refusal still happens before any codec
 * runs, and a legitimate override still produces exactly the diagnostics it produced before.
 */
describe('the text limits — the safe-integer range (U3-B2)', () => {
  it('accepts MAX_SAFE_INTEGER for both text limits', () => {
    const outcome = decodeBytes(Buffer.from('a\nb', 'utf8'), {
      limits: { maxLines: Number.MAX_SAFE_INTEGER, maxLineLength: Number.MAX_SAFE_INTEGER },
    });
    expect(outcome.ok).toBe(true);
  });

  it('refuses a limit one past the safe range instead of comparing with it', () => {
    const bytes = Buffer.from('a\nb', 'utf8');
    expect(() => decodeBytes(bytes, { limits: { maxLines: 2 ** 53 } })).toThrow(
      'limit maxLines must be a positive integer, got 9007199254740992',
    );
    expect(() => decodeBytes(bytes, { limits: { maxLineLength: 2 ** 53 } })).toThrow(
      'limit maxLineLength must be a positive integer, got 9007199254740992',
    );
    // A limit of 1 is still the boundary it always was: valid, and it refuses a longer document.
    expect(decodeBytes(bytes, { limits: { maxLines: 1 } }).ok).toBe(false);
  });

  it('judges an invalid limit before decoding, so it outranks an undecodable input', () => {
    // enc-04's committed bytes have no decoding candidate at all; the setting is still what reports
    // first, because `withLimits` runs before the BOM sniff and every codec probe.
    const bytes = Buffer.from(enc04.BYTES);
    expect(failureCodes(decodeBytes(bytes))).toEqual(expectedCodes('enc-04'));
    expect(() => decodeBytes(bytes, { limits: { maxLines: 2 ** 53 } })).toThrow(
      /limit maxLines must be a positive integer/,
    );
  });

  it('decodes identically for an explicit default as for an omitted override', () => {
    const bytes = Buffer.from('# A5:ER FORMAT:21\n[Entity]\nPName="x"\n', 'utf8');
    // Naming the defaults is not a different request: same text, same diagnostics, same order.
    expect(decodeBytes(bytes, { limits: { ...DEFAULT_LIMITS } })).toEqual(decodeBytes(bytes));
  });
});

describe('loadSource — the limits it forwards (§10.2)', () => {
  const DOCUMENT = '# A5:ER FORMAT:21\n[Entity]\nPName="x"\n';

  it('forwards a legitimate partial override to decode and keeps its diagnostic', () => {
    // Three physical lines, as §4.1 counts them: the trailing terminator adds none.
    const atLimit = loadBytes(Buffer.from(DOCUMENT, 'utf8'), 'three-lines.a5er', {
      limits: { maxLines: 3 },
    });
    expect(atLimit.ok).toBe(true);

    const over = loadBytes(Buffer.from(DOCUMENT, 'utf8'), 'three-lines.a5er', {
      limits: { maxLines: 2 },
    });
    expect(over.ok).toBe(false);
    assertCodes(failureCodes(over), ['E_LIMIT_LINES']);
    expect(over.ok ? {} : over.diagnostics[0]?.details).toEqual({ lines: 3, maxLines: 2 });
  });

  it('leaves the decode diagnostics and their order alone when a limit is overridden', () => {
    const omitted = loadBytes(Buffer.from(DOCUMENT, 'utf8'), 'document.a5er');
    const overridden = loadBytes(Buffer.from(DOCUMENT, 'utf8'), 'document.a5er', {
      limits: { maxBytes: 1024 },
    });
    if (!omitted.ok || !overridden.ok) throw new Error('the document must load');

    expect(overridden.source.diagnostics).toEqual(omitted.source.diagnostics);
    expect(overridden.source.text).toBe(omitted.source.text);
  });

  it('rejects an out-of-range limit before opening the file', () => {
    let opened = 0;
    const fileSystem: FileSystem = {
      open() {
        opened += 1;
        throw new Error('the reader must not open a file for an invalid setting');
      },
    };

    for (const field of ['maxBytes', 'maxLines', 'maxLineLength'] as const) {
      expect(
        () => loadSource('never-opened', { limits: { [field]: 2 ** 53 }, fileSystem }),
        field,
      ).toThrow(`limit ${field} must be a positive integer, got 9007199254740992`);
    }
    expect(opened).toBe(0);
  });
});

describe('the maxLineLength unit (R14)', () => {
  it('counts maxLineLength in UTF-16 code units for BMP Japanese', () => {
    // テスト is three BMP characters: three code units, nine UTF-8 bytes. The limit counts units.
    const text = 'テスト';
    expect(text.length).toBe(3);
    expect(Buffer.byteLength(text, 'utf8')).toBe(9);

    const atLimit = decodeBytes(Buffer.from(text, 'utf8'), { limits: { maxLineLength: 3 } });
    expect(atLimit.ok).toBe(true);

    const over = decodeBytes(Buffer.from(text, 'utf8'), { limits: { maxLineLength: 2 } });
    expect(over.ok).toBe(false);
    assertCodes(failureCodes(over), ['E_LIMIT_LINE_LENGTH']);
    // The reported length is in the same unit as the limit.
    expect(over.ok ? {} : over.diagnostics[0]?.details).toEqual({
      maxLineLength: 2,
      longestLine: 3,
    });
  });

  it('counts a surrogate pair as two code units, so a glyph is not a unit', () => {
    // U+2000B: one code point, two UTF-16 code units, four UTF-8 bytes.
    const glyph = '\u{2000B}';
    expect([...glyph]).toHaveLength(1);
    expect(glyph.length).toBe(2);
    expect(Buffer.byteLength(glyph, 'utf8')).toBe(4);

    // Two units fit a limit of two and not a limit of one.
    expect(decodeBytes(Buffer.from(glyph, 'utf8'), { limits: { maxLineLength: 2 } }).ok).toBe(true);
    const overOne = decodeBytes(Buffer.from(glyph, 'utf8'), { limits: { maxLineLength: 1 } });
    expect(overOne.ok).toBe(false);
    expect(overOne.ok ? {} : overOne.diagnostics[0]?.details['longestLine']).toBe(2);

    // Two glyphs are four units, so a limit of three breaches although only two glyphs exist.
    const twoGlyphs = decodeBytes(Buffer.from(glyph + glyph, 'utf8'), {
      limits: { maxLineLength: 3 },
    });
    expect(twoGlyphs.ok).toBe(false);
    expect(twoGlyphs.ok ? {} : twoGlyphs.diagnostics[0]?.details['longestLine']).toBe(4);
  });

  it('applies the unit to the longest line, not the whole text', () => {
    // Two lines of three units each fit a limit of three; the line count is what would breach.
    const outcome = decodeBytes(Buffer.from('テスト\nテスト', 'utf8'), {
      limits: { maxLineLength: 3, maxLines: 2 },
    });
    expect(outcome.ok).toBe(true);
  });
});

describe('R13 — a BOM-less UTF-16 file is refused, never guessed at', () => {
  const documentText = '# A5:ER FORMAT:21\n[Entity]\nPName=テスト\n';

  it('refuses a BOM-less UTF-16LE document as binary instead of decoding it', () => {
    const bytes = Buffer.from(documentText, 'utf16le');
    // The mechanism: the ASCII half of a UTF-16 document is NUL bytes, so §10.4's probe fires.
    expect(nulDensity(bytes)).toBeGreaterThan(0.1);

    const outcome = loadBytes(bytes, 'utf16le-without-bom.a5er');

    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), ['E_BINARY_INPUT']);
    // Neither a guessed UTF-16 decode nor a silent mis-decode: a failure carries no text at all.
    expect(Object.keys(outcome)).toEqual(['ok', 'diagnostics']);
  });

  it('decodes the same document once it carries a BOM', () => {
    // The contrast that stops the test above passing for the wrong reason: the BOM is what makes
    // UTF-16 readable, and it is checked before the binary probe.
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(documentText, 'utf16le')]);
    const outcome = loadBytes(bytes, 'utf16le-with-bom.a5er');

    if (!outcome.ok) throw new Error('a BOM-carrying UTF-16LE document must load');
    expect(outcome.source.encoding.detected).toBe('utf-16le');
    expect(outcome.source.text).toContain('PName=テスト');
  });

  it('records the gap for a payload with no ASCII: no NUL bytes, so no probe', () => {
    // Documented gap, not a contract. A payload of BMP Japanese has no NUL bytes at all, so the
    // density probe cannot fire and the unimplemented heuristic would be the only detector. The
    // input is still refused — a fatal code and no schema — which is why the gap is survivable.
    // When the heuristic or a threshold lands, this expectation must be updated deliberately.
    const bytes = Buffer.from('テスト', 'utf16le');
    expect(nulDensity(bytes)).toBe(0);

    const outcome = loadBytes(bytes, 'japanese-only-utf16le.a5er');
    expect(outcome.ok).toBe(false);
    assertCodes(failureCodes(outcome), ['E_UNRECOGNIZED_DOCUMENT']);
  });
});

describe('trusted codes, untrusted details (§11 rule 1)', () => {
  it('never lets file content reach a code or a message', () => {
    const hostile = '# A5:ER FORMAT:21\n[Entity]\nPName="<script>alert(1)</script>"\n';
    const outcome = decodeBytes(Buffer.from(hostile, 'utf8'));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const diagnostic of outcome.decoded.diagnostics) {
      expect(diagnostic.message).not.toContain('<script>');
      expect(diagnostic.code).toMatch(/^[EDS]_[A-Z_]+$/);
    }
    // The hostile text is in the decoded text, which is untrusted data by design.
    expect(outcome.decoded.text).toContain('<script>');
  });

  it('bounds every string detail at 200 characters', () => {
    const long = 'x'.repeat(400);
    const diagnostic = emit('E_IO', { details: { path: long, errno: 'ENOENT' } });

    expect(String(diagnostic.details['path']).length).toBe(MAX_DETAIL_LENGTH);
    expect(String(diagnostic.details['path']).endsWith('…')).toBe(true);
    expect(diagnostic.details['errno']).toBe('ENOENT');
    // The fixed message and the code are untouched by the input.
    expect(diagnostic.message).toBe('The input could not be read');
    expect(diagnostic.code).toBe('E_IO');
  });

  it('assigns severity and message from the table, not from the call site', () => {
    expect(severityOf('E_LIMIT_BYTES')).toBe('fatal');
    expect(severityOf('D_BOM_MISSING')).toBe('info');
    expect(severityOf('D_ENCODING_MISMATCH')).toBe('warning');
    // The emitted diagnostic carries the same values, with no span before the syntax stage.
    expect(emit('E_LIMIT_BYTES').severity).toBe(severityOf('E_LIMIT_BYTES'));
    expect(emit('E_LIMIT_BYTES').message).toBe(messageOf('E_LIMIT_BYTES'));
    expect(emit('E_EMPTY_INPUT').span).toBeNull();
  });
});

/** Encode a string as UTF-8 bytes, so a round-trip test reads as one. */
function encode(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}
