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
import type { Limits } from '../src/io/limits.js';
import { NO_BOM, sniffBom } from '../src/decode/bom.js';
import { decodeBytes, isCodecAvailable } from '../src/decode/decode.js';
import { NO_HEADER, parseHeader, peekHeader } from '../src/decode/header.js';
import { loadSource } from '../src/decode/load.js';
import type { LoadOptions, LoadOutcome } from '../src/decode/load.js';
import {
  hasRecognisedSection,
  isRecognisedSection,
  scanSectionHeaders,
} from '../src/decode/sections.js';
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
    // A failure carries no text at all: the type has nowhere to put lossy output. The key set is
    // enumerated, so a `source` (or any other slot that could hold text) appearing here fails.
    expect(Object.keys(outcome)).toEqual(['ok', 'diagnostics', 'limits']);
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

describe('hasRecognisedSection — one forward walk instead of a split', () => {
  /** The nine names §10.4 models; the guard must accept every one of them. */
  const RECOGNISED = [
    'Manager',
    'Entity',
    'Relation',
    'Relationship',
    'View',
    'Subtype',
    'Shape',
    'Line',
    'Comment',
  ] as const;

  it('recognises all nine kinds, with or without a trailing terminator', () => {
    for (const name of RECOGNISED) {
      expect(hasRecognisedSection(`[${name}]`), name).toBe(true);
      expect(hasRecognisedSection(`[${name}]\n`), name).toBe(true);
    }
  });

  it('recognises a header on the first, a middle and the last line', () => {
    expect(hasRecognisedSection('[Entity]')).toBe(true);
    expect(hasRecognisedSection('PName="x"\n[Entity]\nPosition="Main",1,1\n')).toBe(true);
    expect(hasRecognisedSection('# note\nkey=value\n[View]')).toBe(true);
  });

  it('refuses unknown, case-variant and malformed headers', () => {
    const refused = [
      '[entity]',
      '[Memo]',
      '[E N T I T Y]',
      '[Entity]x',
      'x[Entity]',
      'Entry="[Entity]"',
      '[]',
      '[[Entity]]',
      '[[[Entity]]]',
    ];

    for (const line of refused) {
      expect(hasRecognisedSection(line), line).toBe(false);
    }
    expect(hasRecognisedSection('[Memo]\n[Other]\n')).toBe(false);
  });

  it('recognises a padded header and one that follows comments and keys', () => {
    expect(hasRecognisedSection('  [Entity]  \n')).toBe(true);
    expect(hasRecognisedSection('\t[Line]\t')).toBe(true);
    expect(hasRecognisedSection('# comment\n\nPName="x"\nkey=value\n[Comment]\n')).toBe(true);
  });

  it('refuses empty, whitespace-only and headerless inputs', () => {
    for (const text of ['', ' ', '\n', '   \n\t\r\n  \n', 'key=value\n# note\n', '[]\n[]\n']) {
      expect(hasRecognisedSection(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('treats LF, CR and CRLF as the same terminator', () => {
    for (const terminator of ['\n', '\r', '\r\n']) {
      const document = ['# A5:ER FORMAT:21', '[Entity]', 'PName="a"', ''].join(terminator);
      expect(hasRecognisedSection(document), JSON.stringify(terminator)).toBe(true);
      expect(hasRecognisedSection(`[Memo]${terminator}[Other]${terminator}`), terminator).toBe(
        false,
      );
    }
  });

  it('walks mixed, repeated and blank-interleaved terminators', () => {
    const accepted = [
      'key=1\n[Entity]\r\nPName="x"\r',
      '\r\n[Entity]',
      '\r\r\n[Entity]\n\r',
      'a\n\n\n[Entity]\r\n\r\n',
      '[Entity]\r\r\n',
    ];
    const refused = ['\r\n\r\n[Memo]\r\n\r\n', 'a\rb\nc\r\nd', '\n\r[entity]\n\r'];

    for (const text of accepted) {
      expect(hasRecognisedSection(text), JSON.stringify(text)).toBe(true);
    }
    for (const text of refused) {
      expect(hasRecognisedSection(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('agrees with the split-based oracle on a deterministic matrix of small inputs', () => {
    // The oracle is the public helper that still splits the text into lines: this walk must return
    // exactly what it says, for every terminator mix the matrix can produce.
    const oracle = (text: string): boolean => scanSectionHeaders(text).some(isRecognisedSection);
    const LINES = [
      '',
      ' ',
      '\t',
      '[Manager]',
      '[Entity]',
      '[Relationship]',
      '[entity]',
      '[Memo]',
      '[Entity]x',
      '[[Entity]]',
      '[]',
      ' [View] ',
      '\t[Shape]\t',
      '[ Line ]',
      '[Line]x',
      'PName="x"',
      '# comment',
      'key=value',
      '[Comment]',
      '[[[Line]]]',
    ];
    const TERMINATORS = ['\n', '\r\n', '\r'];

    const cases: string[] = [];
    for (const terminator of TERMINATORS) {
      for (const line of LINES) {
        cases.push(line);
        cases.push(line + terminator);
      }
      for (const first of LINES) {
        for (const second of LINES) {
          cases.push(first + terminator + second);
          cases.push(first + terminator + second + terminator);
        }
      }
    }
    // Mixed boundaries, so a CRLF/LF/CR terminator follows a different one.
    const MIXED = ['[Memo]', '[Entity]', 'key=value', '', ' [View] '];
    for (const first of MIXED) {
      for (const second of MIXED) {
        cases.push(`${first}\n${second}\r\n[Line]\r`);
        cases.push(`${first}\r${second}\r\n[Subtype]\n`);
      }
    }

    const disagreements = cases.filter((text) => hasRecognisedSection(text) !== oracle(text));

    expect(cases).toHaveLength(
      3 * (2 * LINES.length + 2 * LINES.length ** 2) + 2 * MIXED.length ** 2,
    );
    expect(disagreements.map((text) => JSON.stringify(text))).toEqual([]);
    // The matrix must exercise both answers, or agreement would prove nothing.
    expect(cases.some(oracle)).toBe(true);
    expect(cases.some((text) => !oracle(text))).toBe(true);
  });
});

describe('hasRecognisedSection — the decode guard is unchanged', () => {
  it('keeps the accepted and refused outcomes under every terminator', () => {
    for (const terminator of ['\n', '\r', '\r\n']) {
      const accepted = loadBytes(
        Buffer.from(['# A5:ER FORMAT:21', '[Entity]', 'PName="a"'].join(terminator), 'utf8'),
        'guard-accepted.a5er',
      );
      expect(accepted.ok, JSON.stringify(terminator)).toBe(true);

      const refused = loadBytes(
        Buffer.from(['# A5:ER FORMAT:21', '[Memo]', 'Note="x"'].join(terminator), 'utf8'),
        'guard-refused.a5er',
      );
      expect(refused.ok, JSON.stringify(terminator)).toBe(false);
      assertCodes(failureCodes(refused), ['E_UNRECOGNIZED_DOCUMENT']);
    }
  });

  it('reports the same E_UNRECOGNIZED_DOCUMENT diagnostic as before the walk', () => {
    const content = '# comment\nPName="x"\n[Memo]\n';
    const outcome = loadBytes(Buffer.from(content, 'utf8'), 'no-recognised.a5er');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic?.code).toBe('E_UNRECOGNIZED_DOCUMENT');
    expect(diagnostic?.severity).toBe('fatal');
    expect(diagnostic?.message).toBe('The input contains no recognised section header');
    expect(diagnostic?.details).toEqual({
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      headers: 0,
    });
    expect(diagnostic?.span).toBeNull();
    expect(diagnostic?.construct).toBe('Document');
  });

  it('accepts a document whose header follows comments and keys', () => {
    const outcome = loadBytes(
      Buffer.from('# A5:ER FORMAT:21\n# note\nPName="x"\n[Entity]\nPName="a"\n', 'utf8'),
      'late-header.a5er',
    );

    expect(outcome.ok).toBe(true);
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
    expect(Object.keys(outcome)).toEqual(['ok', 'diagnostics', 'limits']);
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

/**
 * U3-B3-B1 — the effective `Limits` ride on **both** `LoadOutcome` arms.
 *
 * `loadSource()` resolves the override once, hands that one object to the read and the decode, and
 * returns it, so the numbers on the outcome are the numbers that actually applied — not a second
 * resolution that could disagree with what ran. Both arms carry it: a rejected read was judged
 * against `maxBytes` just as a decoded document was judged against `maxLines` and `maxLineLength`.
 *
 * Only the numbers survive. Defaults, an empty override and an explicit restatement of the
 * defaults are the same three numbers here, and telling those histories apart is out of scope.
 */
describe('LoadOutcome — the effective limits on both arms (U3-B3-B1)', () => {
  const DOCUMENT = '# A5:ER FORMAT:21\n[Entity]\nPName="x"\n';

  /** Load `DOCUMENT` with `options` and fail loudly when it unexpectedly rejects. */
  function loaded(options: LoadOptions = {}) {
    const outcome = loadBytes(encode(DOCUMENT), 'document.a5er', options);
    if (!outcome.ok) throw new Error(`load failed: ${failureCodes(outcome).join(',')}`);
    return outcome;
  }

  it('carries the documented defaults when no override is given', () => {
    const outcome = loaded();

    expect(outcome.limits).toEqual(DEFAULT_LIMITS);
    // Spelled out field by field: `toEqual(DEFAULT_LIMITS)` alone would also pass for an object
    // built from the same constants by accident, and the three numbers are the whole contract.
    expect(outcome.limits.maxBytes).toBe(64 * 1024 * 1024);
    expect(outcome.limits.maxLines).toBe(2_000_000);
    expect(outcome.limits.maxLineLength).toBe(4 * 1024 * 1024);
  });

  it('carries the defaults for an empty override', () => {
    expect(loaded({ limits: {} }).limits).toEqual(DEFAULT_LIMITS);
  });

  it('fills the omitted fields from the defaults for a partial override', () => {
    const cases: readonly (readonly [Partial<Limits>, Limits])[] = [
      [
        { maxBytes: 1024 },
        {
          maxBytes: 1024,
          maxLines: DEFAULT_LIMITS.maxLines,
          maxLineLength: DEFAULT_LIMITS.maxLineLength,
        },
      ],
      [
        { maxLines: 3 },
        {
          maxBytes: DEFAULT_LIMITS.maxBytes,
          maxLines: 3,
          maxLineLength: DEFAULT_LIMITS.maxLineLength,
        },
      ],
      // 20 units admits the 17-unit FORMAT line, so the override is exercised by the carried value
      // rather than by a refusal.
      [
        { maxLineLength: 20 },
        { maxBytes: DEFAULT_LIMITS.maxBytes, maxLines: DEFAULT_LIMITS.maxLines, maxLineLength: 20 },
      ],
    ];

    for (const [limits, expected] of cases) {
      expect(loaded({ limits }).limits, JSON.stringify(limits)).toEqual(expected);
    }
  });

  it('carries a full override unchanged', () => {
    const limits: Limits = { maxBytes: 2048, maxLines: 10, maxLineLength: 64 };
    expect(loaded({ limits }).limits).toEqual(limits);
  });

  it('accepts and carries MAX_SAFE_INTEGER in every field', () => {
    const limits: Limits = {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxLines: Number.MAX_SAFE_INTEGER,
      maxLineLength: Number.MAX_SAFE_INTEGER,
    };
    expect(loaded({ limits }).limits).toEqual(limits);
  });

  it("does not mutate the caller's override object", () => {
    const limits: Partial<Limits> = { maxLines: 5 };
    const outcome = loaded({ limits });

    expect(outcome.limits).toEqual({ ...DEFAULT_LIMITS, maxLines: 5 });
    // The caller's object holds exactly what it held: no defaulted key was written back into it.
    expect(limits).toEqual({ maxLines: 5 });
    expect(Object.keys(limits)).toEqual(['maxLines']);
    // And the outcome owns a complete object of its own, not the caller's partial one.
    expect(outcome.limits).not.toBe(limits);
  });

  it('resolves per call, so one override cannot leak into the next load', () => {
    const lowered = loadBytes(encode(DOCUMENT), 'document.a5er', { limits: { maxLines: 2 } });
    if (lowered.ok) throw new Error('two lines must reject a three-line document');
    expect(lowered.limits).toEqual({ ...DEFAULT_LIMITS, maxLines: 2 });

    // A load with no override is not affected by the previous call's numbers.
    expect(loaded().limits).toEqual(DEFAULT_LIMITS);

    const raised = loadBytes(encode(DOCUMENT), 'document.a5er', {
      limits: { maxLines: Number.MAX_SAFE_INTEGER },
    });
    if (!raised.ok) throw new Error('the raised load must succeed');
    expect(raised.limits).toEqual({ ...DEFAULT_LIMITS, maxLines: Number.MAX_SAFE_INTEGER });
  });

  it('throws for an invalid setting instead of returning an outcome, and leaves the next call alone', () => {
    let opened = 0;
    const fileSystem: FileSystem = {
      open() {
        opened += 1;
        throw new Error('the reader must not open a file for an invalid setting');
      },
    };

    // No `LoadOutcome` exists for an invalid setting, so no `limits` can be read off one.
    expect(() => loadSource('never-opened', { limits: { maxBytes: 2 ** 53 }, fileSystem })).toThrow(
      'limit maxBytes must be a positive integer, got 9007199254740992',
    );
    expect(opened).toBe(0);

    // A throw resolves nothing: the next call starts from its own override, not from a half-built
    // object left behind by the failed one.
    expect(loaded().limits).toEqual(DEFAULT_LIMITS);
  });

  describe('a rejected load still reports the limits it was judged under', () => {
    /** A handle that declares more bytes than it returns, for `E_TRUNCATED_INPUT`. */
    const truncatingFileSystem: FileSystem = {
      open() {
        let reads = 0;
        const value = encode(DOCUMENT);
        return {
          stat: () => ({ sizeBytes: 64, mtimeMs: 1_700_000_000_000, ino: 1, isRegularFile: true }),
          read: () => {
            reads += 1;
            return reads === 1 ? value : Buffer.alloc(0);
          },
          close: () => {},
        };
      },
    };

    const cases: readonly (readonly [string, string, () => LoadOutcome, Limits])[] = [
      [
        'E_LIMIT_BYTES',
        'the byte cap',
        () => loadBytes(encode(DOCUMENT), 'document.a5er', { limits: { maxBytes: 8 } }),
        { ...DEFAULT_LIMITS, maxBytes: 8 },
      ],
      [
        'E_LIMIT_LINES',
        'the line count',
        () => loadBytes(encode(DOCUMENT), 'document.a5er', { limits: { maxLines: 2 } }),
        { ...DEFAULT_LIMITS, maxLines: 2 },
      ],
      [
        'E_LIMIT_LINE_LENGTH',
        'the line length',
        () => loadBytes(encode(DOCUMENT), 'document.a5er', { limits: { maxLineLength: 5 } }),
        { ...DEFAULT_LIMITS, maxLineLength: 5 },
      ],
      [
        'E_TRUNCATED_INPUT',
        'a short read',
        () =>
          loadSource('short-read.a5er', {
            limits: { maxLines: 7 },
            fileSystem: truncatingFileSystem,
          }),
        { ...DEFAULT_LIMITS, maxLines: 7 },
      ],
      [
        'E_BINARY_INPUT',
        'the binary probe',
        () => loadBytes(Buffer.from(hst02.BYTES), 'binary.a5er', { limits: { maxLineLength: 9 } }),
        { ...DEFAULT_LIMITS, maxLineLength: 9 },
      ],
      [
        'E_UNDECODABLE',
        'no codec decodes it',
        () =>
          loadBytes(Buffer.from(enc04.BYTES), 'undecodable.a5er', { limits: { maxBytes: 4096 } }),
        { ...DEFAULT_LIMITS, maxBytes: 4096 },
      ],
      [
        'E_EMPTY_INPUT',
        'a zero-byte file',
        () => loadBytes(Buffer.alloc(0), 'empty.a5er', { limits: { maxLines: 11 } }),
        { ...DEFAULT_LIMITS, maxLines: 11 },
      ],
      [
        'E_UNRECOGNIZED_DOCUMENT',
        'no recognised section header',
        () =>
          loadBytes(encode('key=value\n'), 'unrecognised.a5er', { limits: { maxLineLength: 12 } }),
        { ...DEFAULT_LIMITS, maxLineLength: 12 },
      ],
    ];

    for (const [code, label, run, expected] of cases) {
      it(`${code} — ${label}`, () => {
        const outcome = run();
        if (outcome.ok) throw new Error(`expected ${code}`);

        assertCodes(failureCodes(outcome), [code]);
        expect(outcome.limits).toEqual(expected);
      });
    }

    it('E_IO — a path that cannot be opened', () => {
      withTempDir((directory) => {
        // A child of an existing directory that was never written: the open fails, the read is
        // still judged under its own limits.
        const outcome = loadSource(join(directory, 'absent.a5er'), { limits: { maxBytes: 1024 } });
        if (outcome.ok) throw new Error('expected E_IO');

        assertCodes(failureCodes(outcome), ['E_IO']);
        expect(outcome.limits).toEqual({ ...DEFAULT_LIMITS, maxBytes: 1024 });
      });
    });

    it('E_EMPTY_INPUT — whitespace-only keeps the override it was read with', () => {
      // The whitespace-only path is this module's own `E_EMPTY_INPUT`, after decoding. Substituting
      // `DEFAULT_LIMITS` there would pass any test that loads the same input without an override,
      // so the check names a non-default `maxLines` and compares the other two as well.
      const outcome = loadBytes(encode('  \n\n\t\n'), 'blank.a5er', { limits: { maxLines: 100 } });
      if (outcome.ok) throw new Error('expected E_EMPTY_INPUT');

      assertCodes(failureCodes(outcome), ['E_EMPTY_INPUT']);
      expect(outcome.limits).toEqual({ ...DEFAULT_LIMITS, maxLines: 100 });
      expect(outcome.limits.maxLines).toBe(100);
      expect(outcome.limits.maxBytes).toBe(DEFAULT_LIMITS.maxBytes);
      expect(outcome.limits.maxLineLength).toBe(DEFAULT_LIMITS.maxLineLength);
      // Still no place for text: the rejection carries diagnostics and limits only.
      expect(Object.keys(outcome)).toEqual(['ok', 'diagnostics', 'limits']);
      expect(outcome.diagnostics[0]?.details).toEqual({
        sizeBytes: encode('  \n\n\t\n').byteLength,
      });
    });
  });
});

/**
 * Review MAJOR 1 — `options.fileSystem` is a property read, so it must be read once.
 *
 * A `LoadOptions`-conforming getter may answer differently on every evaluation. Testing the value
 * and then reading it again to forward it can therefore hand the reader a *different* filesystem
 * from the one that was tested — reproduced below: the second evaluation refuses to open, so the
 * pre-fix code turned a readable input into `E_IO`.
 */
describe('loadSource — a getter-backed fileSystem is evaluated once (review MAJOR 1)', () => {
  const DOCUMENT = '# A5:ER FORMAT:21\n[Entity]\nPName="x"\n';

  /** A filesystem plus the seam calls it received. */
  interface RecordingSeam {
    readonly fileSystem: FileSystem;
    readonly calls: { open: number; stat: number; read: number; close: number };
  }

  /** A filesystem that serves `text` once and counts every seam call it receives. */
  function servingFileSystem(text: string): RecordingSeam {
    const bytes = encode(text);
    const calls = { open: 0, stat: 0, read: 0, close: 0 };
    let served = false;

    return {
      calls,
      fileSystem: {
        open() {
          calls.open += 1;
          return {
            stat: () => {
              calls.stat += 1;
              return {
                sizeBytes: bytes.byteLength,
                mtimeMs: 1_700_000_000_000,
                ino: 7,
                isRegularFile: true,
              };
            },
            read: () => {
              calls.read += 1;
              if (served) return Buffer.alloc(0);
              served = true;
              return bytes;
            },
            close: () => {
              calls.close += 1;
            },
          };
        },
      },
    };
  }

  /** A filesystem that would fail the load if it were ever used. */
  function refusingFileSystem(): RecordingSeam {
    const calls = { open: 0, stat: 0, read: 0, close: 0 };
    return {
      calls,
      fileSystem: {
        open() {
          calls.open += 1;
          throw Object.assign(new Error('this filesystem must never be used'), { code: 'ENOENT' });
        },
      },
    };
  }

  it('uses the first value only, and matches the plain-option run call for call', () => {
    const first = servingFileSystem(DOCUMENT);
    const second = refusingFileSystem();
    let evaluations = 0;

    const options: LoadOptions = {
      get fileSystem() {
        evaluations += 1;
        return evaluations === 1 ? first.fileSystem : second.fileSystem;
      },
    };

    const outcome = loadSource('getter.a5er', options);

    // The defect as produced: evaluating the property twice forwarded the second value, which here
    // refuses to open, so a readable input came back as `E_IO`.
    if (!outcome.ok) {
      throw new Error(
        `the first filesystem must serve the input: ${failureCodes(outcome).join(',')}`,
      );
    }
    expect(outcome.source.text).toBe(DOCUMENT);

    // The mechanism: one read of the property, so the tested value is the forwarded one.
    expect(evaluations).toBe(1);
    expect(second.calls).toEqual({ open: 0, stat: 0, read: 0, close: 0 });

    // A plain, single-valued option produces the same result through the same seam contract.
    const reference = servingFileSystem(DOCUMENT);
    const expected = loadSource('getter.a5er', { fileSystem: reference.fileSystem });

    expect(outcome).toEqual(expected);
    expect(first.calls).toEqual(reference.calls);
    // One open, two stats (before and after the read), one read, one close: the reader's contract.
    expect(first.calls).toEqual({ open: 1, stat: 2, read: 1, close: 1 });
  });

  it('still uses the default filesystem when the option is absent', () => {
    withTempDir((directory) => {
      const path = join(directory, 'document.a5er');
      writeFileSync(path, DOCUMENT);

      const outcome = loadSource(path);
      if (!outcome.ok) throw new Error('the default filesystem must read a real file');
      expect(outcome.source.text).toBe(DOCUMENT);
      expect(outcome.limits).toEqual(DEFAULT_LIMITS);
    });
  });
});

/**
 * Review MAJOR 2 — only the three validated numbers survive into the outcome.
 *
 * `withLimits()` spreads the override into its result and validates every own enumerable member, so
 * a runtime-only extra (a plain key that happens to hold a number, or a symbol key it cannot even
 * see) used to ride along into the read, the decode and `LoadOutcome.limits`. The fix keeps that
 * validation and picks the three fields afterwards; these tests pin the key set from both sides.
 */
describe('LoadOutcome — only the three validated limit fields are kept (review MAJOR 2)', () => {
  const DOCUMENT = '# A5:ER FORMAT:21\n[Entity]\nPName="x"\n';
  const LIMIT_KEYS = ['maxBytes', 'maxLines', 'maxLineLength'];
  const symbolKey = Symbol('extra');

  it('drops a string-keyed and a symbol-keyed extra on the success arm', () => {
    const source = { maxBytes: 1024, overrideMarker: 1, [symbolKey]: 'extra' };
    const overrides: Partial<Limits> = source;

    const outcome = loadBytes(encode(DOCUMENT), 'document.a5er', { limits: overrides });
    if (!outcome.ok) throw new Error('the override is a legitimate cap');

    expect(Object.keys(outcome.limits)).toEqual(LIMIT_KEYS);
    // Own keys, so the symbol is checked too: `Object.keys` alone would miss it.
    expect(Reflect.ownKeys(outcome.limits)).toEqual(LIMIT_KEYS);
    expect(outcome.limits).toEqual({
      maxBytes: 1024,
      maxLines: DEFAULT_LIMITS.maxLines,
      maxLineLength: DEFAULT_LIMITS.maxLineLength,
    });

    // The caller's object is untouched: nothing removed, nothing added, the symbol still there.
    expect(Reflect.ownKeys(source)).toEqual(['maxBytes', 'overrideMarker', symbolKey]);
    expect(source.overrideMarker).toBe(1);
    expect(source[symbolKey]).toBe('extra');
  });

  it('drops the extras on the rejection arm, and the read used the validated cap', () => {
    const source = { maxBytes: 8, overrideMarker: 1, [symbolKey]: 'extra' };
    const overrides: Partial<Limits> = source;

    const outcome = loadBytes(encode(DOCUMENT), 'document.a5er', { limits: overrides });
    if (outcome.ok) throw new Error('expected E_LIMIT_BYTES');

    assertCodes(failureCodes(outcome), ['E_LIMIT_BYTES']);
    expect(Object.keys(outcome.limits)).toEqual(LIMIT_KEYS);
    expect(Reflect.ownKeys(outcome.limits)).toEqual(LIMIT_KEYS);
    expect(outcome.limits).toEqual({ ...DEFAULT_LIMITS, maxBytes: 8 });
    // The number in the diagnostic is the number the reader was given, not the caller's object.
    expect(outcome.diagnostics[0]?.details).toEqual({
      sizeBytes: encode(DOCUMENT).byteLength,
      maxBytes: 8,
    });
    expect(Reflect.ownKeys(source)).toEqual(['maxBytes', 'overrideMarker', symbolKey]);
  });

  it('gives decode the validated maxLines, not the caller object', () => {
    const source = { maxLines: 3, overrideMarker: 1, [symbolKey]: 'extra' };
    const overrides: Partial<Limits> = source;

    expect(loadBytes(encode(DOCUMENT), 'document.a5er', { limits: overrides }).ok).toBe(true);

    const over = loadBytes(encode(`${DOCUMENT}\n`), 'four-lines.a5er', { limits: overrides });
    if (over.ok) throw new Error('expected E_LIMIT_LINES');
    assertCodes(failureCodes(over), ['E_LIMIT_LINES']);
    expect(over.diagnostics[0]?.details).toEqual({ lines: 4, maxLines: 3 });
  });

  it('still validates an extra member, so the validation was not pre-stripped', () => {
    // A pre-stripped override would never reach this member; `withLimits` does, unchanged.
    const source = { maxBytes: 1024, overrideMarker: 'not a number' };
    const overrides: Partial<Limits> = source;

    expect(() => loadBytes(encode(DOCUMENT), 'document.a5er', { limits: overrides })).toThrow(
      'limit overrideMarker must be a positive integer, got not a number',
    );
  });

  it('still rejects an out-of-range standard field that arrives with extras', () => {
    const source = { maxBytes: 2 ** 53, overrideMarker: 1 };
    const overrides: Partial<Limits> = source;

    expect(() => loadBytes(encode(DOCUMENT), 'document.a5er', { limits: overrides })).toThrow(
      'limit maxBytes must be a positive integer, got 9007199254740992',
    );
  });
});

/** Encode a string as UTF-8 bytes, so a round-trip test reads as one. */
function encode(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}
