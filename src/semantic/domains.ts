/**
 * Domains (`architecture.md` §9.4, P12, K8; `format-coverage.md` D5).
 *
 * A domain is a named type alias declared once in `[Manager]`:
 * `DomainInfo = "ドメイン名","データ型","コメント","カラム物理名"` (P12). Three rules decide what this
 * module may conclude:
 *
 * - **Names, not types.** Domain names are unique case-insensitively (P12), so a `Field` type of
 *   `int_domain` refers to the declaration `int_domain` and nothing else — the match is
 *   case-insensitive and the declared spelling is reported beside the reference. The type a domain
 *   *stands for* is never substituted: P12's system domains are mapped to SQL only at DDL time, and
 *   substituting one here would be exactly the inference the doc forbids.
 * - **No dangling claims.** A `Field` type that matches no declaration is reported as a **plain**
 *   token, not as a missing domain. `データ型` may be a real type, a user domain name or an `@`
 *   system domain (P7), and the format carries no marker to tell the first from the second — so
 *   calling `Integer` a dangling domain would be a guess dressed as a finding.
 * - **No transitivity.** A domain whose データ型 is itself another domain name keeps that name as a
 *   *kind*, never followed: P12 says a domain's type may be a user or system domain, and following
 *   it would mean recursive resolution nobody specified (and a cycle would hang).
 *
 * The カラム物理名 element is a **default** for a column that applies the domain — 「名前が強制される
 * わけではありません」 — so it is recorded and never pushed onto a declared column; composition is
 * `common-columns.ts`'s job and only for `CommonField`.
 *
 * There is no `V_` code for a domain problem in §11, so everything this module notices is reported in
 * the model and no diagnostic is invented.
 */

import type { Span } from '../model/span.js';
import type { ComplexPart } from '../syntax/complex.js';
import type { Classification } from '../schema/registry.js';
import { partRaw, unescapeEscaped } from '../schema/values.js';
import type { RawElement } from '../schema/position.js';

/** The ten system domains the specification enumerates (P12), in its spelling. */
export const SYSTEM_DOMAINS: readonly string[] = [
  '@VARCHAR',
  '@CHAR',
  '@DECIMAL',
  '@INT',
  '@FLOAT',
  '@DOUBLE',
  '@DATE',
  '@TIME',
  '@DATETIME',
  '@BOOLEAN',
];

/**
 * How a `Field`'s データ型 relates to the documented domain kinds — no SQL type is inferred.
 *
 * The `user` arm is a **discriminated** pair, because "this names a domain" and "this names which
 * domain" are different answers and a single shape cannot tell them apart: the previous shape put
 * `resolvedDomain: matches[0].name` on an ambiguous reference too, which published the first
 * declaration as if the file had chosen it. Neither arm carries the other's field — a consumer must
 * narrow on `status` before it can read a target, so "ambiguous" cannot be read as "resolved to
 * something".
 */
export type TypeClassification =
  /** A token that names no declared domain: a plain type, as far as this stage can tell (P7). */
  | { readonly kind: 'plain' }
  /** `@`-prefixed: a system domain. `known` is false for one outside the documented ten. */
  | { readonly kind: 'system'; readonly name: string; readonly known: boolean }
  /** One declaration matched case-insensitively: the only case where a target exists. */
  | {
      readonly kind: 'user';
      readonly status: 'resolved';
      /** The type exactly as the `Field` wrote it — never rewritten to the declared spelling. */
      readonly name: string;
      /** The declared spelling of the one domain this names (P12: names are unique without case). */
      readonly resolvedDomain: string;
    }
  /**
   * Two or more declarations share this name case-insensitively. The format forbids it, so the
   * reference has **no** target: every candidate is kept, none is selected, and no `resolvedDomain`
   * field exists to be read by mistake.
   */
  | {
      readonly kind: 'user';
      readonly status: 'ambiguous';
      /** The type exactly as the `Field` wrote it. */
      readonly name: string;
      /** Every declaration that matched, in file order, each with its own spelling and span. */
      readonly candidates: readonly DomainDeclaration[];
    };

/** The shape of a *domain declaration's* own データ型 — deliberately not resolved (see above). */
export type DomainTypeKind = 'empty' | 'system' | 'name';

/** One `DomainInfo` declaration. */
export interface DomainDeclaration {
  /** ドメイン名, escapes applied; the spelling the file used. */
  readonly name: string;
  /** データ型 as written — a type token or another domain name, never substituted. */
  readonly dataType: string;
  /** Whether that データ型 is empty, an `@`-system domain, or a bare name — one level only. */
  readonly dataTypeKind: DomainTypeKind;
  /** コメント, escapes applied. */
  readonly comment: string;
  /** カラム物理名: a **default** name for applying columns, never forced (P12). */
  readonly defaultColumn: string;
  readonly raw: string;
  readonly span: Span;
  readonly elementsSeen: number;
  readonly shape: 'documented' | 'unexpected-element-count';
  readonly rawElements: readonly RawElement[];
}

/** Two or more declarations that share one case-insensitive name. */
export interface DuplicateDomain {
  readonly name: string;
  readonly declarations: readonly DomainDeclaration[];
}

/** A `Field` whose type is a domain reference. */
export interface DomainReference {
  readonly sectionIndex: number;
  /** The column's physical name, so the reference is addressable. */
  readonly column: string;
  /** The declared type text, verbatim. */
  readonly dataType: string;
  readonly classification: TypeClassification;
  readonly span: Span;
}

export interface DomainResult {
  readonly domains: readonly DomainDeclaration[];
  readonly duplicates: readonly DuplicateDomain[];
  /** Every `Field` whose type is a domain reference (user or system), in file order. */
  readonly references: readonly DomainReference[];
  /** References that match more than one declaration; retained, never force-resolved (P12). */
  readonly ambiguous: readonly DomainReference[];
}

/** The `@`-shape of a declared type, used for a domain's own データ型 (no lookup, no recursion). */
export function domainTypeKindOf(dataType: string): DomainTypeKind {
  if (dataType === '') return 'empty';
  return dataType.startsWith('@') ? 'system' : 'name';
}

/**
 * Classify one `Field` type against the document's domain names (§P7, P12).
 *
 * `name` is always the type text as the `Field` wrote it, so the reference keeps its own spelling;
 * the resolved spelling is reported *beside* it, never instead of it. Ambiguity returns every
 * candidate and no target (R29) — there is no §11 code for a duplicated domain name, so nothing is
 * diagnosed here and the records are the whole report.
 */
export function classifyType(
  dataType: string,
  domains: Map<string, readonly DomainDeclaration[]>,
): TypeClassification {
  if (dataType === '') return { kind: 'plain' };
  if (dataType.startsWith('@')) {
    return { kind: 'system', name: dataType, known: SYSTEM_DOMAINS.includes(dataType) };
  }
  const matches = domains.get(dataType.toLowerCase()) ?? [];
  const first = matches[0];
  if (first === undefined) return { kind: 'plain' };
  if (matches.length > 1)
    return { kind: 'user', status: 'ambiguous', name: dataType, candidates: matches };
  return { kind: 'user', status: 'resolved', name: dataType, resolvedDomain: first.name };
}

/** One element of a `DomainInfo` as written. */
function element(parts: readonly ComplexPart[], index: number): string {
  const part = parts[index];
  return part === undefined ? '' : unescapeEscaped(part.value);
}

/** Every `DomainInfo` of the document, in file order. */
function declarationsOf(classification: Classification): DomainDeclaration[] {
  const declarations: DomainDeclaration[] = [];
  for (const section of classification.sections) {
    if (section.kind !== 'Manager') continue;
    for (const entry of section.entries) {
      if (entry.kind !== 'parsed') continue;
      const { occurrence } = entry;
      if (occurrence.spec.key !== 'DomainInfo' || occurrence.span === null) continue;
      const decoded = occurrence.decoded;
      if (!decoded.ok) continue;
      const value = decoded.value.value;
      if (typeof value !== 'object') continue;

      const parts = value.parts;
      const dataType = element(parts, 1);
      declarations.push({
        name: element(parts, 0),
        dataType,
        dataTypeKind: domainTypeKindOf(dataType),
        comment: element(parts, 2),
        defaultColumn: element(parts, 3),
        raw: occurrence.raw,
        span: occurrence.span,
        elementsSeen: parts.length,
        shape: parts.length === 4 ? 'documented' : 'unexpected-element-count',
        rawElements: parts.map((part, index) => ({
          index,
          raw: partRaw(part),
          quoted: part.quoted,
        })),
      });
    }
  }
  return declarations;
}

/** Group declarations by case-insensitive name, keeping every one (P12). */
function groupByName(declarations: readonly DomainDeclaration[]): Map<string, DomainDeclaration[]> {
  const groups = new Map<string, DomainDeclaration[]>();
  for (const declaration of declarations) {
    if (declaration.name === '') continue;
    const key = declaration.name.toLowerCase();
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [declaration]);
    else existing.push(declaration);
  }
  return groups;
}

/** Every `Field` whose declared type names a domain. */
function referencesOf(
  classification: Classification,
  groups: Map<string, DomainDeclaration[]>,
): DomainReference[] {
  const references: DomainReference[] = [];
  for (const section of classification.sections) {
    for (const field of section.decoded.fields) {
      const classificationOfType = classifyType(field.dataType.value, groups);
      if (classificationOfType.kind === 'plain') continue;
      references.push({
        sectionIndex: section.index,
        column: field.physicalName.value,
        dataType: field.dataType.value,
        classification: classificationOfType,
        span: field.span,
      });
    }
  }
  return references;
}

/**
 * Decode the document's domains and every field type that refers to one.
 *
 * Pure: reads the classification, returns new records; nothing is substituted into a `Field`.
 */
export function domainsOf(classification: Classification): DomainResult {
  const declarations = declarationsOf(classification);
  const groups = groupByName(declarations);

  const duplicates: DuplicateDomain[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length < 2 || first === undefined) continue;
    duplicates.push({ name: first.name, declarations: group });
  }

  const references = referencesOf(classification, groups);

  return {
    domains: declarations,
    duplicates,
    references,
    ambiguous: references.filter(
      (reference) =>
        reference.classification.kind === 'user' && reference.classification.status === 'ambiguous',
    ),
  };
}
