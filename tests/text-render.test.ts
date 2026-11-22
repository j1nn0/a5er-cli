/**
 * `src/text/tables.ts` — the `--format text` renderer
 * (`docs/proposals/human-cli.md` §4, §7.4 S-4/S-5, §7.7 W-2 to W-4 and B-1 to B-4, §8.3).
 *
 * Two kinds of assertion, kept apart on purpose:
 *
 * - **Whole-output byte equality** for eight committed fixtures, an empty input and two generated
 *   documents, against the hand-authored strings of `tests/helpers/tables-text-expectations.ts` and
 *   the literals below. Those are derived from the fixture text and §4's rules, never from the
 *   renderer (§8.7).
 * - **Properties** for what a table cannot show by being read once: the 48-cell alignment cap and
 *   its boundary, the full-width of a 10,000-character name, the 65,536/262,144 chunk bounds,
 *   surrogate boundaries, and the two 30,000-item streams.
 *
 * Fixtures are staged as disposable copies (`tests/helpers/stage.ts`); generated documents live in a
 * `mkdtemp` directory and are removed in `finally`. No real `.a5er` export is read, and no
 * expectation is regenerated from this run.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/decode/load.js';
import type {
  JsonCompleteness,
  JsonDiagnostic,
  JsonEnvelope,
  JsonLimits,
  JsonSource,
  JsonTableRow,
  JsonTablesEnvelope,
  JsonTablesEnvelopeRead,
} from '../src/json/index.js';
import { CONTRACT_VERSION, TOOL_NAME, TOOL_VERSION, serialize } from '../src/json/index.js';
import { classify } from '../src/schema/index.js';
import { derivePartialSemantics } from '../src/semantic/index.js';
import { scanSource } from '../src/syntax/index.js';
import {
  CHUNK_FLUSH_UNITS,
  CHUNK_LIMIT_UNITS,
  displayWidth,
  renderTablesText,
} from '../src/text/index.js';
import { toTablesEnvelope } from '../src/view/tables.js';
import { stage } from './helpers/stage.js';
import {
  FAILED_EMPTY,
  FMT_01,
  HST_04,
  SEM_05,
  SEM_08,
  SEM_09,
  TXT_01,
  TXT_04,
  VAL_08,
} from './helpers/tables-text-expectations.js';
import { decodeRendered } from './helpers/tables-text-expectations.js';

/** The real four stages over a path — the same composition `src/cli.ts` runs. */
function envelopeOf(path: string): JsonEnvelope {
  const load = loadSource(path);
  if (!load.ok) {
    return serialize({ load }, { command: 'inspect', path });
  }
  const scan = scanSource(load.source);
  const classification = classify(scan);
  return serialize(
    { load, scan, classification, semantics: derivePartialSemantics(classification) },
    { command: 'inspect', path },
  );
}

/** The tables document of the file at `path`, and its text rendering joined. */
function tablesOf(path: string): JsonTablesEnvelope {
  return toTablesEnvelope(envelopeOf(path));
}

/** Every chunk of a rendering, in order. */
function chunksOf(envelope: JsonTablesEnvelope): string[] {
  return [...renderTablesText(envelope)];
}

/** The whole text rendering, joined — the tests may join; the renderer must not. */
function textOf(envelope: JsonTablesEnvelope): string {
  return chunksOf(envelope).join('');
}

/** Stage a committed synthetic fixture, probe it, and always clean up. */
function withFixture<T>(id: string, probe: (path: string) => T): T {
  const staged = stage(id);
  try {
    return probe(staged.path);
  } finally {
    staged.cleanup();
  }
}

/** Write a document to a throwaway `.a5er` path, probe it, and always clean up. */
function withDocument<T>(content: string, probe: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-text-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, content, 'utf8');
    return probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A tables document with the given rows and nothing else to say (§5.2 key order). */
function envelopeWithRows(rows: readonly JsonTableRow[]): JsonTablesEnvelopeRead {
  const source: JsonSource = {
    path: '/tmp/generated.a5er',
    sizeBytes: 0,
    sha256: '0'.repeat(64),
    encoding: { detected: 'utf-8', bom: false, declared: null, mismatch: false },
    format: { declared: 21, effective: 21, known: true },
  };
  const limits: JsonLimits = { maxBytes: 67_108_864, truncated: false };
  const completeness: JsonCompleteness = {
    sections: { total: 1, parsed: 1, preservedRaw: 0, unknown: 0 },
    keys: { total: 0, parsed: 0, preservedRaw: 0 },
    lines: { total: 1, accounted: 1, dropped: 0 },
    dropped: 0,
  };
  // A row is an entity or a view; subtypes are omitted, so they are counted separately (§4.7).
  const subtypes = 0;
  return {
    contractVersion: CONTRACT_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    command: 'tables',
    status: 'ok',
    source,
    limits,
    result: {
      objects: rows.length,
      tables: rows,
      omitted: { subtypes: { count: subtypes, sectionIndexes: [] } },
    },
    unsupported: [],
    diagnostics: [],
    completeness,
  };
}

/** One row for a hand-built envelope, with every member spelled out. */
function row(overrides: {
  readonly objectIndex: number;
  readonly sectionIndex: number;
  readonly startLine: number;
  readonly kind: 'entity' | 'view';
  readonly pname: string | null;
  readonly lname: string | null;
  readonly declared?: number | null;
  readonly common?: number | null;
  readonly effective?: number | null;
  /** `unknown` arm only: which reason the counts are unknown for (§4.8). */
  readonly reason?: 'view-columns-not-stored' | 'view-columns-named-from-query';
  /** The partial arm: declared columns known, composition withheld (§4.5). */
  readonly partial?: boolean;
}): JsonTableRow {
  const declared = overrides.declared === undefined ? null : overrides.declared;
  const common = overrides.common === undefined ? null : overrides.common;
  const effective = overrides.effective === undefined ? null : overrides.effective;
  return {
    objectIndex: overrides.objectIndex,
    sectionIndex: overrides.sectionIndex,
    span: {
      sectionIndex: overrides.sectionIndex,
      startLine: overrides.startLine,
      endLine: overrides.startLine,
      keyLine: overrides.startLine,
    },
    kind: overrides.kind,
    pname: overrides.pname,
    lname: overrides.lname,
    columns:
      overrides.partial === true
        ? {
            status: 'partial',
            reason: 'using-common-columns-unrecognised',
            declared: declared ?? 0,
            common: null,
            effective: null,
            collisions: null,
          }
        : declared === null || common === null || effective === null
          ? {
              status: 'unknown',
              reason: overrides.reason ?? 'view-columns-not-stored',
              declared: null,
              common: null,
              effective: null,
              collisions: null,
            }
          : {
              status: 'complete',
              reason: null,
              declared,
              common,
              effective,
              collisions: 0,
            },
  };
}

/** Every chunk under the limit, and no chunk boundary inside a surrogate pair (§7.7 B-3). */
function expectChunksBounded(chunks: readonly string[]): void {
  expect(chunks.length).toBeGreaterThan(0);

  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThan(CHUNK_LIMIT_UNITS);

    const last = chunk.charCodeAt(chunk.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);

    if (index > 0) {
      const first = chunk.charCodeAt(0);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
  }
}

/** Every line is one of §4.1's three classes, has no trailing space, and holds no CR or tab. */
function expectWellFormed(text: string): void {
  expect(text.endsWith('\n')).toBe(true);
  expect(text).not.toContain('\r');
  expect(text).not.toContain('\t');
  expect(text).not.toContain('\u0000');
  expect(text).not.toContain('\u001b');

  for (const line of text.slice(0, -1).split('\n')) {
    expect(line).not.toBe('');
    expect(line).not.toMatch(/\s$/);
    expect(line).toMatch(/^(# .*|SECTION .*|[ 0-9].*)$/);
  }
}

describe('text/tables — whole-output byte equality', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['txt-01', 'txt-01', TXT_01],
    ['sem-05', 'sem-05', SEM_05],
    ['sem-08', 'sem-08', SEM_08],
    ['sem-09', 'sem-09', SEM_09],
    ['txt-04', 'txt-04', TXT_04],
    ['val-08', 'val-08', VAL_08],
    ['hst-04', 'hst-04', HST_04],
    ['fmt-01', 'fmt-01', FMT_01],
  ];

  for (const [label, id, expected] of cases) {
    it(`renders ${label} exactly as §4 prescribes`, () => {
      withFixture(id, (path) => {
        const text = textOf(tablesOf(path));

        expect(text).toBe(`${expected}\n`);
        expectWellFormed(text);
        expectChunksBounded(chunksOf(tablesOf(path)));
      });
    });
  }

  it('renders an empty input as the failed shape of §4.8', () => {
    withDocument('', (path) => {
      const envelope = tablesOf(path);

      expect(envelope.status).toBe('failed');
      expect(envelope.result).toBeNull();
      expect(textOf(envelope)).toBe(`${FAILED_EMPTY}\n`);
    });
  });
});

describe('text/tables — a generated document with every awkward name', () => {
  /**
   * The document of §4.12 Example B, written out here: a partial entity, an entity without a
   * `PName`, the same name on an entity and a view, a subtype, a CJK physical name, a name over the
   * 48-cell cap, terminal controls, a name that is exactly `-`, an empty logical name and an
   * unknown section. Every expectation below is derived from this text and §4's rules.
   */
  const DOCUMENT = [
    '# A5:ER FORMAT:21',
    '# A5:ER ENCODING:UTF8',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    'CommonField="作成日時","created_at","Timestamp",,,,"",$FFFFFFFF',
    '',
    '[Entity]',
    'PName="customers"',
    'LName="顧客"',
    'Field="顧客ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
    'Field="氏名","name","varchar(100)","",,"","",$FFFFFFFF,"",""',
    'Position="Main",10,10',
    '',
    '[Entity]',
    'PName="order_lines_with_a_deliberately_long_physical_name"',
    'LName="受注明細"',
    'UsingCommonColumns=2',
    'Field="明細ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
    'Position="Main",10,10',
    '',
    '[Entity]',
    'LName="名前のない表"',
    'UsingCommonColumns=0',
    'Position="Main",10,10',
    '',
    '[View]',
    'PName="customers"',
    'LName="顧客 一覧"',
    'Query="SELECT id FROM customers"',
    'Position="Main",10,10',
    '',
    '[Entity]',
    'PName="社員マスタ"',
    'LName="社員"',
    'UsingCommonColumns=0',
    'Field="社員番号","emp_no","Integer","NOT NULL",0,"","",$FFFFFFFF,"",""',
    'Position="Main",10,10',
    '',
    '[Subtype]',
    'PName="customer_kind"',
    'Position="Main",10,10',
    '',
    '[Entity]',
    'PName="evil\u001b[2J\u202etxt.exe"',
    'LName="-"',
    'UsingCommonColumns=0',
    'Position="Main",10,10',
    '',
    '[Memo]',
    'Text="not modelled"',
  ].join('\n');

  const EXPECTED = [
    '# status: degraded',
    'SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME                             LNAME',
    '      2     9  entity         2        1          3  customers                         顧客',
    '      3    16  entity         1  unknown    unknown  order_lines_with_a_deliberately_long_physical_name  受注明細',
    '      4    22  entity         0        0          0  -                                 名前のない表',
    '      5    28  view     unknown  unknown    unknown  customers                         "顧客 一覧"',
    '      6    34  entity         1        0          1  社員マスタ                        社員',
    '      8    45  entity         0        0          0  "evil\\u{001B}[2J\\u{202E}txt.exe"  "-"',
    '# objects: 7 (entity 5, view 1, subtype 1); listed 6, omitted 1',
    "# omitted: subtypes are not listed (section 7); 'a5er inspect' reports them",
    '# unknown: a view does not store its columns (section 5)',
    '# unknown: UsingCommonColumns is neither 1 nor 0, so common columns are not composed (section 3)',
    '# unsupported: 3 (subtype-membership 1, unknown-section 1, unknown-key 1); kept verbatim, not interpreted',
    '# diagnostics: 5 (fatal 0, error 2, warning 0, info 3)',
    '#   error V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 22)',
    '#   error V_DUPLICATE_OBJECT_NAME: Two objects declare the same physical name (line 28)',
    '#   info V_VIEW_COLUMNS_UNKNOWN: A view does not store its columns (line 28)',
    '#   info V_UNSUPPORTED_SUBTYPE_MEMBERSHIP: A subtype cannot declare which entities belong to it (line 41)',
    '#   info S_UNKNOWN_SECTION: A section this tool does not model was preserved verbatim (line 50)',
    '# completeness: sections 9 (parsed 8, preservedRaw 1, unknown 1); keys 31 (parsed 30, preservedRaw 1); lines 51 (accounted 51, dropped 0); dropped 0',
  ].join('\n');

  it('prints the six rows, the reason-ordered notes and the escaped names', () => {
    withDocument(`\ufeff${DOCUMENT}`, (path) => {
      const text = textOf(tablesOf(path));

      expect(text).toBe(`${EXPECTED}\n`);
      expectWellFormed(text);
    });
  });

  it('prints no code point of the escape set and keeps every name decodable', () => {
    withDocument(`\ufeff${DOCUMENT}`, (path) => {
      const text = textOf(tablesOf(path));

      for (const codePoint of ['\u001b', '\u202e']) expect(text).not.toContain(codePoint);

      // Both name cells decode back to the values the file declares (§4.4.1's inverse).
      const escaped = '"evil\\u{001B}[2J\\u{202E}txt.exe"';
      expect(text).toContain(`${escaped}  "-"`);
      expect(decodeRendered(escaped)).toBe('evil\u001b[2J\u202etxt.exe');
      expect(text).toContain('"顧客 一覧"');
      expect(decodeRendered('"顧客 一覧"')).toBe('顧客 一覧');
    });
  });
});

describe('text/tables — only subtypes, and the header rule', () => {
  it('prints no header when there is no row', () => {
    // Two [Subtype] sections and nothing else: no table, no rows, both omissions stated (§4.1).
    const document = [
      '# A5:ER FORMAT:21',
      '',
      '[Subtype]',
      'PName="first"',
      'Position="Main",10,10',
      '',
      '[Subtype]',
      'PName="second"',
      'Position="Main",20,20',
    ].join('\n');

    withDocument(document, (path) => {
      const text = textOf(tablesOf(path));

      expect(text.startsWith('# status: ')).toBe(true);
      expect(text).not.toContain('SECTION');
      expect(text).not.toContain('first');
      expect(text).not.toContain('second');
      expect(text).toContain('# objects: 2 (entity 0, view 0, subtype 2); listed 0, omitted 2');
      expect(text).toContain(
        "# omitted: subtypes are not listed (sections 1, 2); 'a5er inspect' reports them",
      );
    });
  });
});

describe('text/tables — §4.4.1 names in a row', () => {
  /** The fixed part of a row for `section 2 / line 7 / entity / 1/0/1`, 52 cells wide. */
  const PREFIX = '      2     7  entity         1       0          1  ';

  const cases: readonly (readonly [string | null, string])[] = [
    [null, '-'],
    ['', '""'],
    ['-', '"-"'],
    ['plain', 'plain'],
    ['a b', '"a b"'],
    ['a"b', '"a\\"b"'],
    ['a\\b', '"a\\\\b"'],
    ['\u001b[2J', '"\\u{001B}[2J"'],
    ['顧客\u3000一覧', '"顧客\u3000一覧"'],
  ];

  for (const [value, rendered] of cases) {
    it(`renders ${JSON.stringify(value)} as ${rendered}`, () => {
      const envelope = envelopeWithRows([
        row({
          objectIndex: 0,
          sectionIndex: 2,
          startLine: 7,
          kind: 'entity',
          pname: value,
          lname: null,
          declared: 1,
          common: 0,
          effective: 1,
        }),
      ]);

      const rows = textOf(envelope)
        .split('\n')
        .filter((line) => /^[ 0-9]/.test(line));

      // `PNAME` is padded to `W = max(5, width)`; `plain`-sized values share the header's width.
      const padding = ' '.repeat(Math.max(0, 5 - displayWidth(rendered)));
      expect(rows).toEqual([`${PREFIX}${rendered}${padding}  -`]);
    });
  }
});

describe('text/tables — §4.3 alignment and the 48-cell cap', () => {
  /** A row whose fixed cells are `section 2 / line 7 / entity / 1/0/1`, before `PNAME`. */
  const PREFIX = '      2     7  entity         1       0          1  ';

  it('aligns every row inside the cap to the same width (W-3)', () => {
    const envelope = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname: 'users',
        lname: 'ユーザー',
        declared: 1,
        common: 0,
        effective: 1,
      }),
      row({
        objectIndex: 1,
        sectionIndex: 3,
        startLine: 7,
        kind: 'entity',
        pname: '顧客',
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
      row({
        objectIndex: 2,
        sectionIndex: 4,
        startLine: 7,
        kind: 'entity',
        pname: 'a b',
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
      row({
        objectIndex: 3,
        sectionIndex: 5,
        startLine: 7,
        kind: 'entity',
        pname: 'evil\u001b',
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);

    const lines = textOf(envelope).split('\n');
    // `"evil\u{001B}"` is 14 cells, the widest cell inside the cap, so W = 14.
    const expected = [
      `${PREFIX}users           ユーザー`,
      '      3     7  entity         1       0          1  顧客            -',
      '      4     7  entity         1       0          1  "a b"           -',
      '      5     7  entity         1       0          1  "evil\\u{001B}"  -',
    ];

    expect(lines[2]).toBe(expected[0]);
    expect(lines[3]).toBe(expected[1]);
    expect(lines[4]).toBe(expected[2]);
    expect(lines[5]).toBe(expected[3]);

    // Every `LNAME` starts at the same display column: 52 fixed cells, W = 14, then two spaces.
    const names = ['ユーザー', '-', '-', '-'];
    for (const [index, line] of lines.slice(2, 6).entries()) {
      const name = names[index] ?? '';
      expect(line.endsWith(name)).toBe(true);
      expect(displayWidth(line) - displayWidth(name)).toBe(52 + 14 + 2);
    }
  });

  it('relaxes alignment for a row over the cap and keeps W for the others (W-4)', () => {
    const name47 = 'a'.repeat(47);
    const name48 = 'b'.repeat(48);
    const name49 = 'c'.repeat(49);
    const envelope = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname: name47,
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
      row({
        objectIndex: 1,
        sectionIndex: 3,
        startLine: 7,
        kind: 'entity',
        pname: name48,
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
      row({
        objectIndex: 2,
        sectionIndex: 4,
        startLine: 7,
        kind: 'entity',
        pname: name49,
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);

    const lines = textOf(envelope).split('\n');

    // With the 48-cell name present, W = 48: 47 is padded by one cell, 48 by none.
    expect(lines[2]).toBe(`${PREFIX}${name47}   -`);
    expect(lines[3]).toBe(`${PREFIX.replace('      2', '      3')}${name48}  -`);
    // 49 cells is written in full, followed by exactly two spaces, and does not widen W.
    expect(lines[4]).toBe(`${PREFIX.replace('      2', '      4')}${name49}  -`);
  });

  it('keeps a 10,000-character ASCII name and a 2,000-character CJK name in full (W-2)', () => {
    const pname = 'p'.repeat(10_000);
    const lname = '名'.repeat(2_000);
    const envelope = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname,
        lname,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);

    const texts = textOf(envelope);
    const lines = texts.split('\n');
    const rowLine = lines[2] ?? '';

    expect(rowLine).toContain(pname);
    expect(rowLine).toContain(lname);
    // The row is the fixed prefix, the whole name, exactly two spaces and the whole logical name.
    expect(displayWidth(rowLine)).toBe(52 + 10_000 + 2 + 4_000);
    expect(rowLine.endsWith(`  ${lname}`)).toBe(true);
    expectChunksBounded(chunksOf(envelope));
  });

  it('expands 400,000 escapes without ever building one name string (B-2)', () => {
    const pname = '\u001b'.repeat(400_000);
    const envelope = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname,
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);

    const chunks = chunksOf(envelope);
    expectChunksBounded(chunks);

    const texts = chunks.join('');
    const rowLine = texts.split('\n')[2] ?? '';
    const escaped = `"${'\\u{001B}'.repeat(400_000)}"`;

    // 400,000 escapes of 8 code units each, plus the two quotes (§7.7 B-2).
    expect(escaped.length).toBe(3_200_002);
    expect(rowLine).toBe(`      2     7  entity         1       0          1  ${escaped}  -`);
    expect(decodeRendered(escaped)).toBe(pname);
    // The escaped contract is many chunks, not one string.
    expect(chunks.length).toBeGreaterThan(10);
  });
});

describe('text/tables — surrogate boundaries (B-4)', () => {
  it('keeps astral code points whole at the slice and chunk boundaries', () => {
    const boundaries = [16_383, 16_384, 65_535];

    for (const at of boundaries) {
      const pname = `${'a'.repeat(at)}\u{1f600}${'b'.repeat(10)}`;
      const envelope = envelopeWithRows([
        row({
          objectIndex: 0,
          sectionIndex: 2,
          startLine: 7,
          kind: 'entity',
          pname,
          lname: null,
          declared: 1,
          common: 0,
          effective: 1,
        }),
      ]);

      const chunks = chunksOf(envelope);
      expectChunksBounded(chunks);

      const texts = chunks.join('');
      expect(texts).not.toContain('\ufffd');
      expect(texts).toContain(`\u{1f600}`);
      expect(decodeRendered(pname)).toBe(pname);
      // The rendered cell is the bare name: no quoting, no escaping, nothing truncated.
      expect(texts.split('\n')[2] ?? '').toBe(
        `      2     7  entity         1       0          1  ${pname}  -`,
      );
    }
  });
});

describe('text/tables — long notes stay streamed (N-1, N-3)', () => {
  it('lists 30,000 locations of one diagnostic code, in order, across chunks', () => {
    const diagnostics: JsonDiagnostic[] = [];
    for (let line = 1; line <= 30_000; line += 1) {
      diagnostics.push({
        code: 'S_UNKNOWN_KEY',
        severity: 'info',
        message: 'A key this section does not define was preserved verbatim',
        details: {},
        span: { sectionIndex: 2, startLine: line, endLine: line, keyLine: line },
        construct: null,
      });
    }

    const base = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname: 'wide',
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);
    const envelope: JsonTablesEnvelope = {
      ...base,
      status: 'degraded',
      diagnostics,
    };

    const chunks = chunksOf(envelope);
    expectChunksBounded(chunks);

    const texts = chunks.join('');
    const expectedLine = `#   info S_UNKNOWN_KEY: A key this section does not define was preserved verbatim (${Array.from(
      { length: 30_000 },
      (_, index) => `line ${index + 1}`,
    ).join(', ')})`;

    expect(texts).toContain(expectedLine);
    expect(texts).toContain('# diagnostics: 30000 (fatal 0, error 0, warning 0, info 30000)');
    // The group line alone is longer than one chunk, so it must be split.
    expect(expectedLine.length).toBeGreaterThan(CHUNK_LIMIT_UNITS);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('lists 30,000 sections of one unknown reason, in file order, across chunks', () => {
    const rows: JsonTableRow[] = [];
    for (let index = 0; index < 30_000; index += 1) {
      rows.push(
        row({
          objectIndex: index,
          sectionIndex: index + 2,
          startLine: 7,
          kind: 'view',
          pname: `view_${index}`,
          lname: null,
        }),
      );
    }

    const envelope = envelopeWithRows(rows);
    const chunks = chunksOf(envelope);
    expectChunksBounded(chunks);

    const texts = chunks.join('');
    const expectedSections = Array.from({ length: 30_000 }, (_, index) => index + 2);
    const expectedLine = `# unknown: a view does not store its columns (sections ${expectedSections.join(', ')})`;

    expect(texts).toContain(expectedLine);
    expect(expectedLine.length).toBeGreaterThan(CHUNK_FLUSH_UNITS);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('text/tables — the notes that depend on a reason (§4.8)', () => {
  it('orders the unknown notes by reason, not by row order', () => {
    const envelope = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname: 'partial_entity',
        lname: null,
        declared: 1,
        partial: true,
      }),
      row({
        objectIndex: 1,
        sectionIndex: 3,
        startLine: 7,
        kind: 'view',
        pname: 'named_from_query',
        lname: null,
        reason: 'view-columns-named-from-query',
      }),
      row({
        objectIndex: 2,
        sectionIndex: 4,
        startLine: 7,
        kind: 'view',
        pname: 'not_stored',
        lname: null,
        reason: 'view-columns-not-stored',
      }),
    ]);

    const notes = textOf(envelope)
      .split('\n')
      .filter((line) => line.startsWith('# unknown: '));

    // Definition order of the reason, not the order the rows appear in: `view-columns-not-stored`,
    // `view-columns-named-from-query`, then the partial entity's reason.
    expect(notes).toEqual([
      '# unknown: a view does not store its columns (section 4)',
      '# unknown: a view names its columns from its query (LNameByComment=1) and does not store them (section 3)',
      '# unknown: UsingCommonColumns is neither 1 nor 0, so common columns are not composed (section 2)',
    ]);

    // A partial entity keeps its declared count and says `unknown` for the other two.
    expect(textOf(envelope)).toContain(
      '      2     7  entity         1  unknown    unknown  partial_entity    -',
    );
  });

  it('warns when completeness.dropped is not 0', () => {
    const base = envelopeWithRows([
      row({
        objectIndex: 0,
        sectionIndex: 2,
        startLine: 7,
        kind: 'entity',
        pname: 'kept',
        lname: null,
        declared: 1,
        common: 0,
        effective: 1,
      }),
    ]);
    const envelope: JsonTablesEnvelope = {
      ...base,
      completeness: { ...base.completeness, dropped: 2 },
    };

    const lines = textOf(envelope).trimEnd().split('\n');

    expect(lines.at(-1)).toBe(
      '# warning: completeness.dropped is 2; some lines are not accounted for',
    );
    expect(lines.at(-2)).toContain('dropped 2');
  });
});

describe('text/tables — determinism and the environment (§3.3)', () => {
  it('renders the same envelope to the same chunks twice', () => {
    withFixture('txt-01', (path) => {
      const envelope = tablesOf(path);

      expect(chunksOf(envelope)).toEqual(chunksOf(envelope));
    });
  });

  it('writes LF only and never a blank line, whatever the document', () => {
    for (const id of ['fmt-01', 'txt-01', 'sem-08', 'hst-04']) {
      withFixture(id, (path) => {
        const text = textOf(tablesOf(path));

        expectWellFormed(text);
        expect(text.split('\n').some((line) => line === '')).toBe(true); // only the final empty
        expect(
          text
            .slice(0, -1)
            .split('\n')
            .filter((line) => line === ''),
        ).toEqual([]);
      });
    }
  });

  it('does not print the path, the query, the comment or unsupported raw text', () => {
    withFixture('txt-04', (path) => {
      const text = textOf(tablesOf(path));

      expect(text).not.toContain(path);
      expect(text).not.toContain('MysteryKey');
      expect(text).not.toContain('自由メモ');
      expect(text).not.toContain('not modelled');
    });
  });
});
