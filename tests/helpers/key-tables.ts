/**
 * The eight section-scoped key tables of `architecture.md` §5, as **data** (`src/schema/registry.ts`
 * — `MANAGER_KEYS`…`COMMENT_KEYS`, `:101-264`; the eight tables total 111 names).
 *
 * **Why this file exists.** `keys.parsed` / `keys.preservedRaw` are not a parser's opinion: they are
 * a lookup of the key text in the table for the line's *section kind*. Re-deriving the split from
 * source therefore needs the tables themselves — a copy of the specification's key lists — and not
 * the registry's code path. Importing `src/schema/registry.ts` here would make the parser its own
 * witness, which is exactly what `tests/helpers/source-counts.ts` exists to avoid.
 *
 * **Transcription, not interpretation.** Every name is copied verbatim, case preserved (the lookup
 * is case-sensitive, so `pname` is *not* `PName`), in the registry's own order. The counts are
 * asserted in `tests/json-keys.test.ts`, so a table that drifts from the registry (a key added to
 * one side only) shows up as a failing count rather than as a silent mismatch.
 *
 * `Relationship` is not a table of its own: `src/syntax/sections.ts` maps that header to the
 * `Relation` kind (§4.2's alias), so its keys are looked up in the `Relation` table — see
 * `sectionKindOfHeader` in `source-counts.ts`.
 */

/** The eight modelled section kinds, canonical spelling (the `[Relationship]` alias is folded in). */
export type ModelledKind =
  | 'Manager'
  | 'Entity'
  | 'Relation'
  | 'View'
  | 'Subtype'
  | 'Shape'
  | 'Line'
  | 'Comment';

/** Every key name the registry knows, per canonical section kind. */
export const KEY_TABLES: Readonly<Record<ModelledKind, readonly string[]>> = {
  Manager: [
    'PageInfo',
    'ProjectName',
    'DomainInfo',
    'CommonField',
    'LogicalView',
    'ShowTag',
    'ShowCommonAttributes',
    'ShowDisableAttributes',
    'DecodeDomain',
    'CreatePkIndex',
    'CreateFk',
    'FKParentIndex',
    'CreateFK_ParentCard1Only',
    'GenerateCommentStatement',
    'GenerateCommentStatement_LName',
    'GenerateCommentStatement_Comment',
    'GenerateCommentStatement_Separator',
    'DefaultPkName',
    'DefaultPkIndexName',
    'DefaultIndexName',
    'DefaultFkName',
    'FontSize',
    'FontSizeReal',
    'Page',
    'Domain',
    'ViewModePageIndividually',
    'ViewMode',
    'PaperSize',
    'RDBMSType',
  ],
  Entity: [
    'PName',
    'LName',
    'Comment',
    'Field',
    'IndexInfo',
    'Position',
    'UsingCommonColumns',
    'TableOption',
    'TableInnerOption',
    'NoDDL',
    'Tag',
    'Color',
    'BkColor',
    'EffectMode',
    'ZOrder',
    'ModifiedDateTime',
    'Page',
    'Left',
    'Top',
    'Index',
    'IndexOption',
  ],
  Relation: [
    'Entity1',
    'Entity2',
    'Fields1',
    'Fields2',
    'RelationType1',
    'RelationType2',
    'Cardinarity1',
    'Cardinarity2',
    'Dependence',
    'Caption',
    'PName',
    'NoDDL',
    'FkOnDeleteOption',
    'FkOnUpdateOption',
    'LineColor',
    'Position',
    'ZOrder',
    'ModifiedDateTime',
    'LineMode',
    'Bar1',
    'Bar2',
    'Bar3',
    'TermPos1',
    'TermPos2',
  ],
  View: [
    'PName',
    'LName',
    'Comment',
    'Query',
    'LNameByComment',
    'MaterializedView',
    'Position',
    'NoDDL',
    'Tag',
    'Color',
    'BkColor',
    'EffectMode',
    'ZOrder',
    'ModifiedDateTime',
    'Page',
    'Left',
    'Top',
  ],
  Subtype: ['PName', 'SharedMode', 'CompleteCategory', 'Position', 'ZOrder'],
  Shape: ['PName', 'ShapeType', 'Position', 'ZOrder'],
  Line: ['PName', 'Position', 'StartLineTermType', 'EndLineTermType', 'TermSize', 'ZOrder'],
  Comment: ['PName', 'Position', 'Width', 'Height', 'ZOrder'],
};

/** The eight canonical kinds, in the registry's own order. */
export const MODELLED_KINDS: readonly ModelledKind[] = [
  'Manager',
  'Entity',
  'Relation',
  'View',
  'Subtype',
  'Shape',
  'Line',
  'Comment',
];

/**
 * The canonical kind of a header name (`src/syntax/sections.ts`: the nine recognised names, the
 * `[Relationship]` alias, and `null` for anything else — `[entity]`, `[<script>]`, `[[Entity]]`).
 *
 * Case-sensitive on purpose: the format defines no case rule, so `[entity]` is an *unknown* section
 * and every key inside it is preserved (§10.4, `txt-07`).
 */
export function kindOfHeader(name: string): ModelledKind | null {
  if (name === 'Relationship') return 'Relation';
  const kinds: readonly string[] = MODELLED_KINDS;
  return kinds.includes(name) ? (name as ModelledKind) : null;
}

/** True when `key` is registered for `kind` — the exact, case-sensitive lookup of §5. */
export function isRegisteredKey(kind: ModelledKind, key: string): boolean {
  return KEY_TABLES[kind].includes(key);
}
