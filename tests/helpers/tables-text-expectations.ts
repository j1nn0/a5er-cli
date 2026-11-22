/**
 * Hand-authored `--format text` expectations (`docs/proposals/human-cli.md` §4, §8.7).
 *
 * **How these strings were produced.** By hand, from the fixture **text** and the rules of §4, the
 * same derivation §8.1 describes for the row table: a section header is a line that starts with `[`
 * and ends with `]` after trimming and is counted in file order; `LINE` is the last `PName` line,
 * else the header line, counting a BOM line as line 1; `DECLARED` is the number of `Field` lines;
 * `COMMON` is the number of `[Manager]` `CommonField` lines when `UsingCommonColumns` is absent or
 * `1` and `0` when it is `0`; a view's three counts are `unknown`. The column widths are the
 * largest cell or header per column (§4.3), and the notes are §4.8's fixed formats with the
 * diagnostic messages of `architecture.md` §11.
 *
 * **Not copied from the renderer.** No string here was produced by running `tables`; a mismatch is
 * a finding about the renderer, never a reason to update the expectation. The five Examples A–E of
 * §4.12 are illustrations of the same rules, and the fixtures covered here include three of them
 * (`txt-01`, `sem-05`, `sem-09`).
 *
 * No real `.a5er` export is involved: every path below is a committed synthetic fixture or a
 * document the test writes to a `mkdtemp` directory.
 *
 * The two functions at the end are not expectations: they join the renderer's pieces and decode a
 * rendered cell, so the escape and render tests can check the round trip §4.4.1 promises.
 */

import { renderNamePieces } from '../../src/text/escape.js';

/** `txt-01-multi-table-view`: three entities, two views, both view counts `unknown`. */
export const TXT_01 = [
  '# status: ok',
  'SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME          LNAME',
  '      2     9  entity         3        0          3  users          ユーザー',
  '      3    18  entity         2        0          2  orders         注文',
  '      4    26  entity         0        0          0  audit_log      監査ログ',
  '      5    31  view     unknown  unknown    unknown  active_users   -',
  '      6    36  view     unknown  unknown    unknown  order_summary  -',
  ...NOTE_OBJECTS([3, 2, 0]),
  '# unknown: a view does not store its columns (sections 5, 6)',
  '# unsupported: 0',
  ...NOTE_DIAGNOSTICS(
    2,
    [0, 0, 0, 2],
    [
      [
        'info',
        'V_VIEW_COLUMNS_UNKNOWN',
        'A view does not store its columns',
        ['line 31', 'line 36'],
      ],
    ],
  ),
  COMPLETENESS(7, [7, 0, 0], 33, [33, 0], 49, [49, 0], 0),
].join('\n');

/** `sem-05-subtype`: one entity and one subtype, which is counted and cited but never a row. */
export const SEM_05 = [
  '# status: ok',
  'SECTION  LINE  KIND    DECLARED  COMMON  EFFECTIVE  PNAME           LNAME',
  '      2     7  entity         1       0          1  subtype_member  -',
  ...NOTE_OBJECTS([1, 0, 1]),
  "# omitted: subtypes are not listed (section 3); 'a5er inspect' reports them",
  '# unsupported: 1 (subtype-membership 1); kept verbatim, not interpreted',
  ...NOTE_DIAGNOSTICS(
    1,
    [0, 0, 0, 1],
    [
      [
        'info',
        'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP',
        'A subtype cannot declare which entities belong to it',
        ['line 12'],
      ],
    ],
  ),
  COMPLETENESS(3, [3, 0, 0], 9, [9, 0], 16, [16, 0], 0),
].join('\n');

/** `sem-08-duplicate-pname`: one entity and one view with the same name, kept as two rows. */
export const SEM_08 = [
  '# status: degraded',
  'SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME  LNAME',
  '      2     7  entity         1        0          1  twin   -',
  '      3    12  view     unknown  unknown    unknown  twin   -',
  ...NOTE_OBJECTS([1, 1, 0]),
  '# unknown: a view does not store its columns (section 3)',
  '# unsupported: 0',
  ...NOTE_DIAGNOSTICS(
    2,
    [0, 1, 0, 1],
    [
      [
        'error',
        'V_DUPLICATE_OBJECT_NAME',
        'Two objects declare the same physical name',
        ['line 12'],
      ],
      ['info', 'V_VIEW_COLUMNS_UNKNOWN', 'A view does not store its columns', ['line 12']],
    ],
  ),
  COMPLETENESS(3, [3, 0, 0], 7, [7, 0], 14, [14, 0], 0),
].join('\n');

/** `sem-09-zero-pages`: no objects at all, so there is no table header either. */
export const SEM_09 = [
  '# status: degraded',
  ...NOTE_OBJECTS([0, 0, 0]),
  '# unsupported: 0',
  ...NOTE_DIAGNOSTICS(
    1,
    [0, 1, 0, 0],
    [['error', 'V_MISSING_REQUIRED_KEY', 'A key the specification requires is absent', ['line 3']]],
  ),
  COMPLETENESS(1, [1, 0, 0], 1, [1, 0], 4, [4, 0], 0),
].join('\n');

/** `txt-04-unknown-section-key`: an unknown section and two unknown keys, all preserved raw. */
export const TXT_04 = [
  '# status: ok',
  'SECTION  LINE  KIND    DECLARED  COMMON  EFFECTIVE  PNAME  LNAME',
  '      1     4  entity         0       0          0  known  -',
  ...NOTE_OBJECTS([1, 0, 0]),
  '# unsupported: 4 (unknown-key 3, unknown-section 1); kept verbatim, not interpreted',
  ...NOTE_DIAGNOSTICS(
    3,
    [0, 0, 0, 3],
    [
      [
        'info',
        'S_UNKNOWN_KEY',
        'A key this section does not define was preserved verbatim',
        ['line 5', 'line 6'],
      ],
      [
        'info',
        'S_UNKNOWN_SECTION',
        'A section this tool does not model was preserved verbatim',
        ['line 9'],
      ],
    ],
  ),
  COMPLETENESS(3, [2, 1, 1], 6, [3, 3], 13, [13, 0], 0),
].join('\n');

/** `val-08-continuation-line`: a degraded view, a malformed continuation line, unsupported evidence. */
export const VAL_08 = [
  '# status: degraded',
  'SECTION  LINE  KIND  DECLARED   COMMON  EFFECTIVE  PNAME        LNAME',
  '      2     7  view   unknown  unknown    unknown  split_query  -',
  ...NOTE_OBJECTS([0, 1, 0]),
  '# unknown: a view does not store its columns (section 2)',
  '# unsupported: 1 (multiline-value 1); kept verbatim, not interpreted',
  ...NOTE_DIAGNOSTICS(
    2,
    [0, 0, 1, 1],
    [
      ['info', 'V_VIEW_COLUMNS_UNKNOWN', 'A view does not store its columns', ['line 7']],
      [
        'warning',
        'S_MALFORMED_LINE',
        'A line is not a section header, a key, a comment, or blank',
        ['line 9'],
      ],
    ],
  ),
  COMPLETENESS(2, [2, 0, 0], 4, [4, 0], 10, [10, 0], 0),
].join('\n');

/** `hst-04-hostile-names`: hostile section headers, all inert; only the entity is a row. */
export const HST_04 = [
  '# status: degraded',
  'SECTION  LINE  KIND    DECLARED  COMMON  EFFECTIVE  PNAME    LNAME',
  '      2     7  entity         1       0          1  hostile  -',
  ...NOTE_OBJECTS([1, 0, 0]),
  '# unsupported: 6 (unknown-section 3, unknown-key 2, multiline-value 1); kept verbatim, not interpreted',
  ...NOTE_DIAGNOSTICS(
    4,
    [0, 0, 1, 3],
    [
      [
        'info',
        'S_UNKNOWN_SECTION',
        'A section this tool does not model was preserved verbatim',
        ['line 11', 'line 14', 'line 19'],
      ],
      [
        'warning',
        'S_MALFORMED_LINE',
        'A line is not a section header, a key, a comment, or blank',
        ['line 17'],
      ],
    ],
  ),
  COMPLETENESS(5, [2, 3, 3], 6, [4, 2], 19, [19, 0], 0),
].join('\n');

/** `fmt-01-baseline`: the CRLF fixture; two entities and one view. */
export const FMT_01 = [
  '# status: ok',
  'SECTION  LINE  KIND    DECLARED   COMMON  EFFECTIVE  PNAME         LNAME',
  '      2     8  entity         2        0          2  users         ユーザー',
  '      3    17  entity         2        0          2  orders        -',
  '      5    35  view     unknown  unknown    unknown  active_users  -',
  ...NOTE_OBJECTS([2, 1, 0]),
  '# unknown: a view does not store its columns (section 5)',
  '# unsupported: 0',
  ...NOTE_DIAGNOSTICS(
    1,
    [0, 0, 0, 1],
    [['info', 'V_VIEW_COLUMNS_UNKNOWN', 'A view does not store its columns', ['line 35']]],
  ),
  COMPLETENESS(5, [5, 0, 0], 25, [25, 0], 37, [37, 0], 0),
].join('\n');

/** An empty input: no objects, no counts, and the fatal diagnostic reported at `file`. */
export const FAILED_EMPTY = [
  '# status: failed',
  '# objects: none (status failed)',
  '# unsupported: 0',
  ...NOTE_DIAGNOSTICS(
    1,
    [1, 0, 0, 0],
    [['fatal', 'E_EMPTY_INPUT', 'The input is empty', ['file']]],
  ),
  '# completeness: none (status failed)',
].join('\n');

/** The objects note: `<entity>`, `<view>`, `<subtype>` counts derived from the fixture text. */
function NOTE_OBJECTS([entities, views, subtypes]: readonly [number, number, number]): string[] {
  const total = entities + views + subtypes;
  const listed = entities + views;
  return [
    `# objects: ${total} (entity ${entities}, view ${views}, subtype ${subtypes}); listed ${listed}, omitted ${subtypes}`,
  ];
}

/** The diagnostics summary plus one group line per `(severity, code)` in order of appearance. */
function NOTE_DIAGNOSTICS(
  total: number,
  [fatal, error, warning, info]: readonly [number, number, number, number],
  groups: readonly (readonly [
    severity: string,
    code: string,
    message: string,
    locations: readonly string[],
  ])[],
): string[] {
  return [
    `# diagnostics: ${total} (fatal ${fatal}, error ${error}, warning ${warning}, info ${info})`,
    ...groups.map(
      ([severity, code, message, locations]) =>
        `#   ${severity} ${code}: ${message} (${locations.join(', ')})`,
    ),
  ];
}

/** The completeness note, one line, with the counted partitions of the fixture. */
function COMPLETENESS(
  sectionTotal: number,
  [sectionsParsed, sectionsPreserved, sectionsUnknown]: readonly [number, number, number],
  keyTotal: number,
  [keysParsed, keysPreserved]: readonly [number, number],
  lineTotal: number,
  [linesAccounted, linesDropped]: readonly [number, number],
  dropped: number,
): string {
  return `# completeness: sections ${sectionTotal} (parsed ${sectionsParsed}, preservedRaw ${sectionsPreserved}, unknown ${sectionsUnknown}); keys ${keyTotal} (parsed ${keysParsed}, preservedRaw ${keysPreserved}); lines ${lineTotal} (accounted ${linesAccounted}, dropped ${linesDropped}); dropped ${dropped}`;
}

/* ── the two round-trip helpers the escape and render tests share (§4.4.1, S-2) ─────────────── */

/**
 * The rendered cell for a name value, joined from the renderer's pieces.
 *
 * A test may join what it is checking; only the renderer is forbidden to. It is here rather than
 * in a separate helper file so that `tests/helpers/` keeps the inventory of `human-cli.md` §9.
 */
export function renderName(value: string | null): string {
  let rendered = '';
  for (const piece of renderNamePieces(value)) rendered += piece;
  return rendered;
}

/**
 * Decode a rendered cell back to its value (§4.4.1) — the inverse the format promises.
 *
 * `-` is a missing value, a quoted cell is unescaped, and a bare cell is itself. An escape this
 * format never produces throws, so a malformed rendering fails loudly instead of being read as
 * text.
 */
export function decodeRendered(rendered: string): string | null {
  if (rendered === '-') return null;
  if (!rendered.startsWith('"') || !rendered.endsWith('"') || rendered.length < 2) {
    return rendered;
  }

  const body = rendered.slice(1, -1);
  let decoded = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const next = body[index + 1];
    if (next === '"') {
      decoded += '"';
      index += 1;
      continue;
    }
    if (next === '\\') {
      decoded += '\\';
      index += 1;
      continue;
    }
    if (next === 'u') {
      // `\u{XXXX}`: `{` at index + 2, the hex digits from index + 3.
      if (body[index + 2] !== '{') throw new Error(`bad escape in ${rendered}`);
      const close = body.indexOf('}', index + 3);
      if (close === -1) throw new Error(`unterminated escape in ${rendered}`);
      const hex = body.slice(index + 3, close);
      if (!/^[0-9A-F]{4,6}$/.test(hex)) throw new Error(`bad escape ${hex} in ${rendered}`);
      decoded += String.fromCodePoint(Number.parseInt(hex, 16));
      index = close;
      continue;
    }
    throw new Error(`unexpected escape in ${rendered}`);
  }
  return decoded;
}
