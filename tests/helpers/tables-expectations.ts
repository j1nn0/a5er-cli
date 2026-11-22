/**
 * `tests/helpers/tables-expectations.ts` — the hand-derived `tables` rows of one fixture
 * (`docs/proposals/human-cli.md` §8.1, §8.2).
 *
 * **How these were derived.** From each fixture's own source text and the format rules alone, the
 * procedure §8.1 states: a section header is a line that starts with `[` and ends with `]` after
 * trimming and is counted in file order (unknown and lowercase headers count as sections but are
 * not objects); `LINE` is the last `PName` line, else the header line, counting a BOM line as line
 * 1; `DECLARED` is the number of `Field` lines; `COMMON` is the number of `[Manager]` `CommonField`
 * lines when `UsingCommonColumns` is absent or `1`, and `0` when it is `0`; a view's three counts
 * are `unknown`, with `view-columns-named-from-query` when `LNameByComment=1` and
 * `view-columns-not-stored` otherwise; a subtype is never a row, only a citation.
 *
 * **What did not produce these values.** `projectTables`, `toTablesEnvelope`, `serialize` and the
 * CLI were never run for them: a mismatch is a finding about the product, never a reason to update
 * this file. Their independent origin is also why they are worth pinning: §8.2's invariant tests
 * compare the projection against the inspect envelope, and this table compares it against the file.
 *
 * The three byte fixtures (`enc-03`, `enc-05`, `hst-05`) were derived from the decoded content the
 * fixture modules document; `enc-04` and `hst-02` are rejected reads, so they list no row.
 */

/** One listed row, as §5.4 defines it. `null` is "not known", never zero. */
export interface ExpectedRow {
  readonly sectionIndex: number;
  readonly line: number;
  readonly kind: 'entity' | 'view';
  readonly pname: string | null;
  readonly lname: string | null;
  readonly declared: number | null;
  readonly common: number | null;
  readonly effective: number | null;
  readonly reason:
    | null
    | 'view-columns-not-stored'
    | 'view-columns-named-from-query'
    | 'using-common-columns-unrecognised';
}

/** One fixture's rows, in file order, plus the `sectionIndex` of every omitted subtype. */
export interface ExpectedFixture {
  readonly rows: readonly ExpectedRow[];
  readonly subtypes: readonly number[];
}

/** Shorthand for one row, so the table below reads as data. */
function row(
  sectionIndex: number,
  line: number,
  kind: 'entity' | 'view',
  pname: string | null,
  lname: string | null,
  declared: number | null,
  common: number | null,
  effective: number | null,
  reason: ExpectedRow['reason'],
): ExpectedRow {
  return { sectionIndex, line, kind, pname, lname, declared, common, effective, reason };
}

/** Every fixture with committed bytes, by catalog ID: 39 synthetic and 5 byte fixtures. */
export const TABLE_EXPECTATIONS: Readonly<Record<string, ExpectedFixture>> = {
  'enc-02': {
    rows: [row(1, 5, 'entity', 'no_bom', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'enc-03': {
    rows: [row(1, 5, 'entity', '注文', '注文テーブル', 0, 0, 0, null)],
    subtypes: [],
  },
  'enc-04': {
    rows: [],
    subtypes: [],
  },
  'enc-05': {
    rows: [row(1, 4, 'entity', 'utf16', null, 0, 0, 0, null)],
    subtypes: [],
  },
  'fmt-01': {
    rows: [
      row(2, 8, 'entity', 'users', 'ユーザー', 2, 0, 2, null),
      row(3, 17, 'entity', 'orders', null, 2, 0, 2, null),
      row(5, 35, 'view', 'active_users', null, null, null, null, 'view-columns-not-stored'),
    ],
    subtypes: [],
  },
  'fmt-02': {
    rows: [row(1, 5, 'entity', 'legacy_orders', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'fmt-03': {
    rows: [row(2, 7, 'entity', 'no_header', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'fmt-04': {
    rows: [row(1, 4, 'entity', 'hole', null, 0, 0, 0, null)],
    subtypes: [],
  },
  'fmt-05': {
    rows: [row(2, 8, 'entity', 'future_format', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'hst-01': {
    rows: [row(2, 7, 'entity', 'nul_comment', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'hst-02': {
    rows: [],
    subtypes: [],
  },
  'hst-04': {
    rows: [row(2, 7, 'entity', 'hostile', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'hst-05': {
    rows: [row(2, 5, 'entity', 'mixed_eol', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'sem-01': {
    rows: [row(2, 7, 'entity', 'orders', null, 2, 0, 2, null)],
    subtypes: [],
  },
  'sem-02': {
    rows: [row(2, 7, 'entity', 'case_page', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'sem-03': {
    rows: [
      row(2, 7, 'entity', 'parent_a', null, 2, 0, 2, null),
      row(3, 13, 'entity', 'child_b', null, 3, 0, 3, null),
    ],
    subtypes: [],
  },
  'sem-04': {
    rows: [row(2, 7, 'entity', 'legacy_orders_21', null, 3, 0, 3, null)],
    subtypes: [],
  },
  'sem-05': {
    rows: [row(2, 7, 'entity', 'subtype_member', null, 1, 0, 1, null)],
    subtypes: [3],
  },
  'sem-06': {
    rows: [
      row(2, 7, 'view', 'view_with_lname', null, null, null, null, 'view-columns-named-from-query'),
      row(3, 13, 'view', 'plain_view', null, null, null, null, 'view-columns-not-stored'),
    ],
    subtypes: [],
  },
  'sem-07': {
    rows: [
      row(2, 9, 'entity', 'with_common', null, 2, 1, 3, null),
      row(3, 15, 'entity', 'without_common', null, 1, 0, 1, null),
    ],
    subtypes: [],
  },
  'sem-08': {
    rows: [
      row(2, 7, 'entity', 'twin', null, 1, 0, 1, null),
      row(3, 12, 'view', 'twin', null, null, null, null, 'view-columns-not-stored'),
    ],
    subtypes: [],
  },
  'sem-09': {
    rows: [],
    subtypes: [],
  },
  'sem-10': {
    rows: [row(2, 7, 'entity', 'no_position', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'sem-11': {
    rows: [row(2, 7, 'entity', 'no_fields', null, 0, 0, 0, null)],
    subtypes: [],
  },
  'txt-01': {
    rows: [
      row(2, 9, 'entity', 'users', 'ユーザー', 3, 0, 3, null),
      row(3, 18, 'entity', 'orders', '注文', 2, 0, 2, null),
      row(4, 26, 'entity', 'audit_log', '監査ログ', 0, 0, 0, null),
      row(5, 31, 'view', 'active_users', null, null, null, null, 'view-columns-not-stored'),
      row(6, 36, 'view', 'order_summary', null, null, null, null, 'view-columns-not-stored'),
    ],
    subtypes: [],
  },
  'txt-02': {
    rows: [
      row(2, 7, 'entity', 'parent_t', null, 1, 0, 1, null),
      row(3, 12, 'entity', 'child_t', null, 2, 0, 2, null),
    ],
    subtypes: [],
  },
  'txt-03': {
    rows: [
      row(2, 7, 'entity', 'table_a', null, 2, 0, 2, null),
      row(3, 13, 'entity', 'table_b', null, 2, 0, 2, null),
    ],
    subtypes: [],
  },
  'txt-04': {
    rows: [row(1, 4, 'entity', 'known', null, 0, 0, 0, null)],
    subtypes: [],
  },
  'txt-05': {
    rows: [row(2, 9, 'entity', 'dup_scalar', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'txt-06': {
    rows: [row(2, 8, 'entity', 'dup_manager', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'txt-07': {
    rows: [row(1, 4, 'entity', 'known_entity', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'txt-08': {
    rows: [row(2, 7, 'entity', 'spaced_header', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'txt-09': {
    rows: [row(2, 7, 'entity', 'with_empty_relation', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-01': {
    rows: [row(1, 4, 'entity', 'escapes', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-02': {
    rows: [row(1, 4, 'entity', 'users', null, 2, 0, 2, null)],
    subtypes: [],
  },
  'val-03': {
    rows: [row(1, 4, 'entity', 'legacy_shape', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-04': {
    rows: [row(2, 7, 'entity', 'future_field', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-05': {
    rows: [row(1, 4, 'entity', 'no_color', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-06': {
    rows: [row(1, 4, 'entity', 'memberships', null, 3, 0, 3, null)],
    subtypes: [],
  },
  'val-07': {
    rows: [row(2, 7, 'entity', 'colours', null, 3, 0, 3, null)],
    subtypes: [],
  },
  'val-08': {
    rows: [row(2, 7, 'view', 'split_query', null, null, null, null, 'view-columns-not-stored')],
    subtypes: [],
  },
  'val-09': {
    rows: [row(2, 7, 'entity', 'gap_pk', null, 2, 0, 2, null)],
    subtypes: [],
  },
  'val-10': {
    rows: [row(2, 7, 'entity', 'equals_value', null, 1, 0, 1, null)],
    subtypes: [],
  },
  'val-11': {
    rows: [row(2, 7, 'entity', 'unterminated', null, 1, 0, 1, null)],
    subtypes: [],
  },
};
