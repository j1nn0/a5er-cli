/**
 * Section kinds (`architecture.md` §4.4, §5).
 *
 * The list of recognised names is **not** repeated here: it comes from `decode/sections.ts`,
 * which is the single definition of what a header is and which names are modelled (§10.4).
 * What this module adds is the one normalisation §5 requires — `[Relationship]` is the same
 * section as `[Relation]` — plus the `'unknown'` kind that lets the AST keep every header.
 *
 * The header *text* is never normalised: `[Relationship]` keeps its spelling in `headerRaw`
 * and only `kind` says it means a relation (txt-02).
 */

import { RECOGNISED_SECTIONS } from '../decode/sections.js';
import type { RecognisedSection } from '../decode/sections.js';

/**
 * A section this project models, or `'unknown'`.
 *
 * `'Relationship'` is deliberately absent: it is a spelling of `Relation`, not a second kind
 * (§5), so nothing downstream has to remember the alias.
 */
export type SectionKind =
  | 'Manager'
  | 'Entity'
  | 'Relation'
  | 'View'
  | 'Subtype'
  | 'Shape'
  | 'Line'
  | 'Comment'
  | 'unknown';

/**
 * Canonical kind for each recognised header name.
 *
 * Typed as a total `Record` on purpose: adding a name to `RECOGNISED_SECTIONS` stops compiling
 * until someone decides which kind it is, so the alias table cannot silently fall behind the
 * header list.
 */
const CANONICAL_KIND: Readonly<Record<RecognisedSection, Exclude<SectionKind, 'unknown'>>> = {
  Manager: 'Manager',
  Entity: 'Entity',
  Relation: 'Relation',
  Relationship: 'Relation',
  View: 'View',
  Subtype: 'Subtype',
  Shape: 'Shape',
  Line: 'Line',
  Comment: 'Comment',
};

/** Name-to-kind lookup, built once from the shared list. */
const KIND_BY_NAME: ReadonlyMap<string, Exclude<SectionKind, 'unknown'>> = new Map(
  RECOGNISED_SECTIONS.map((name) => [name, CANONICAL_KIND[name]] as const),
);

/**
 * Kind of a header name, or `'unknown'`.
 *
 * Case-sensitive, because the format defines no case rule and folding would turn `[entity]`
 * into a second `[Entity]` section (txt-07).
 */
export function sectionKindOf(name: string): SectionKind {
  return KIND_BY_NAME.get(name) ?? 'unknown';
}
