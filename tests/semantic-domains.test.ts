/**
 * Domains and common columns (`architecture.md` §9.4, P12, K9; `format-coverage.md` D5, D6).
 *
 * Both features are declared in `[Manager]` and both are about *names*: a domain is a named type
 * alias, and a common column is a column other sections may inherit. Neither is a place to infer
 * SQL, and the tests below pin exactly that:
 *
 * - a domain reference resolves case-insensitively and keeps both spellings, but never substitutes
 *   the type it stands for;
 * - a plain type is not called a dangling domain, because P7 lists a real type and a user domain name
 *   as the *same* token shape;
 * - `UsingCommonColumns` composes by default with `origin: 'defaulted'`, opts out on `0`, and leaves
 *   the composition undecided on a broken token instead of assuming the default;
 * - a physical-name collision keeps both columns and reports the pair.
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../src/schema/registry.js';
import { derivePartialSemantics } from '../src/semantic/partial.js';
import { commonColumnsOf } from '../src/semantic/common-columns.js';
import {
  domainsOf,
  classifyType,
  domainTypeKindOf,
  SYSTEM_DOMAINS,
} from '../src/semantic/domains.js';
import { scanSource } from '../src/syntax/scanner.js';
import { classificationOf, semanticsOf } from './helpers/classified.js';

const MANAGER = '[Manager]\nPageInfo="M",3,"A4","$FFFFFF"\n';

/** Domain findings of an inline document. */
function domainsOfText(text: string) {
  return domainsOf(classify(scanSource({ text, format: 21 })));
}

/** Column findings of an inline document. */
function columnsOfText(text: string) {
  return commonColumnsOf(classify(scanSource({ text, format: 21 })));
}

describe('DomainInfo is the documented four elements (P12)', () => {
  it('decodes the declaration of the fixture (sem-07)', () => {
    const semantics = semanticsOf('sem-07');
    const domain = semantics.domains[0];

    expect(semantics.domains).toHaveLength(1);
    expect(domain).toMatchObject({
      name: 'int_domain',
      dataType: 'INTEGER',
      dataTypeKind: 'name',
      comment: '整数ドメイン',
      defaultColumn: '',
      elementsSeen: 4,
      shape: 'documented',
    });
    expect(domain?.span.keyLine).toBe(5);
    expect(domain?.raw).toBe('"int_domain","INTEGER","整数ドメイン",""');
  });

  it('records the default column name without forcing it onto any column', () => {
    const semantics = semanticsOf('sem-07');

    expect(semantics.domains[0]?.defaultColumn).toBe('');
    // `value_int` declares `@INT`; no domain default ever rewrites a Field.
    const entity = semantics.entityColumns.find((entry) => entry.object === 'with_common');
    expect(entity?.declared.map((column) => column.pname)).toEqual(['id', 'value_int']);
  });

  it('marks a declaration that is not four elements, keeping every element', () => {
    const domain = domainsOfText(`${MANAGER}DomainInfo="d","INTEGER"\n`).domains[0];

    expect(domain?.shape).toBe('unexpected-element-count');
    expect(domain?.elementsSeen).toBe(2);
    expect(domain?.rawElements).toHaveLength(2);
  });

  it('keeps duplicate names and reports them, without choosing one', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="d","INTEGER","one",""\nDomainInfo="D","TEXT","two",""\n` +
        '[Entity]\nPName="e"\nField="L","c","d","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );

    expect(result.domains).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.declarations.map((domain) => domain.name)).toEqual(['d', 'D']);
    expect(result.references[0]?.classification).toEqual({
      kind: 'user',
      status: 'ambiguous',
      name: 'd',
      candidates: result.domains,
    });
  });
});

describe('field types are classified, never resolved (P7, P12)', () => {
  it('matches a declared domain case-insensitively and keeps both spellings', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="int_domain","INTEGER","",""\n` +
        '[Entity]\nPName="e"\nField="L","c","INT_DOMAIN","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );
    const reference = result.references[0];

    expect(reference?.dataType).toBe('INT_DOMAIN');
    expect(reference?.classification).toMatchObject({
      kind: 'user',
      name: 'INT_DOMAIN',
      status: 'resolved',
      resolvedDomain: 'int_domain',
    });
    // The type the domain stands for is never substituted into the column.
    expect(
      classify(
        scanSource({
          text: `${MANAGER}[Entity]\nPName="e"\nField="L","c","INT_DOMAIN","",,"","",$FFFFFFFF,""\n`,
          format: 21,
        }),
      ).sections[1]?.decoded.fields[0]?.dataType.value,
    ).toBe('INT_DOMAIN');
  });

  it('classifies @-prefixed types as system domains, known or not (P12)', () => {
    const result = domainsOfText(
      `${MANAGER}[Entity]\nPName="e"\n` +
        'Field="L","a","@INT","",,"","",$FFFFFFFF,""\n' +
        'Field="L","b","@INTEGER","",,"","",$FFFFFFFF,""\n' +
        'Position="M",1,1\n',
    );

    expect(result.references.map((reference) => reference.classification)).toEqual([
      { kind: 'system', name: '@INT', known: true },
      { kind: 'system', name: '@INTEGER', known: false },
    ]);
    expect(SYSTEM_DOMAINS).toHaveLength(10);
  });

  it('does not call a plain type a dangling domain (P7 lists the same token shape)', () => {
    const result = domainsOfText(
      `${MANAGER}[Entity]\nPName="e"\n` +
        'Field="L","a","Integer","",,"","",$FFFFFFFF,""\n' +
        'Field="L","b","varchar(20)","",,"","",$FFFFFFFF,""\n' +
        'Field="L","c","","",,"","",$FFFFFFFF,""\n' +
        'Position="M",1,1\n',
    );

    expect(result.references).toEqual([]);
    expect(classifyType('Integer', new Map())).toEqual({ kind: 'plain' });
  });

  it('keeps a domain-typed domain as a name, never followed (no transitivity)', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="outer","inner","",""\nDomainInfo="inner","INTEGER","",""\n`,
    );

    expect(
      result.domains.map((domain) => [domain.name, domain.dataType, domain.dataTypeKind]),
    ).toEqual([
      ['outer', 'inner', 'name'],
      ['inner', 'INTEGER', 'name'],
    ]);
    // The kind is a shape, not a resolved target: `outer` is not reported as standing for INTEGER.
    expect(domainTypeKindOf('@INT')).toBe('system');
    expect(domainTypeKindOf('')).toBe('empty');
  });
});

/**
 * R29: the `user` arm is discriminated, so "this names a domain" and "this names *which* domain"
 * cannot be confused.
 *
 * Before the fix an ambiguous reference still carried `resolvedDomain: matches[0].name`, which
 * published the first declaration as if the file had chosen it. The four cases below are exactly the
 * four answers the format permits: one match, a case variant of one match, more than one match, and
 * no match at all.
 */
describe('a domain reference resolves or is ambiguous, never half of each (R29)', () => {
  it('reports the declared spelling beside a unique match, and no candidate list', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="int_domain","INTEGER","",""\n` +
        '[Entity]\nPName="e"\nField="L","c","int_domain","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );
    const classification = result.references[0]?.classification;

    expect(classification).toEqual({
      kind: 'user',
      status: 'resolved',
      name: 'int_domain',
      resolvedDomain: 'int_domain',
      // The one declaration's own line travels with its spelling, so a consumer can find it in
      // `domains` without matching names again.
      resolvedSpan: result.domains[0]?.span,
    });
    // A resolved reference has no `candidates` member at all — there is nothing to choose between.
    expect(classification === undefined ? null : 'candidates' in classification).toBe(false);
  });

  it('resolves a case variant to the declaration and keeps both spellings', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="Main","INTEGER","",""\n` +
        '[Entity]\nPName="e"\n' +
        'Field="L","a","MAIN","",,"","",$FFFFFFFF,""\n' +
        'Field="L","b","Main","",,"","",$FFFFFFFF,""\n' +
        'Field="L","c","mAiN","",,"","",$FFFFFFFF,""\n' +
        'Position="M",1,1\n',
    );

    expect(result.references.map((reference) => reference.dataType)).toEqual([
      'MAIN',
      'Main',
      'mAiN',
    ]);
    // The reference keeps the file's spelling; the declaration's spelling is reported beside it.
    expect(
      result.references.map((reference) =>
        reference.classification.kind === 'user'
          ? [reference.classification.name, reference.classification.status]
          : null,
      ),
    ).toEqual([
      ['MAIN', 'resolved'],
      ['Main', 'resolved'],
      ['mAiN', 'resolved'],
    ]);
    expect(
      result.references.map((reference) =>
        reference.classification.kind === 'user' ? reference.classification.status : null,
      ),
    ).toEqual(['resolved', 'resolved', 'resolved']);
    for (const reference of result.references) {
      const { classification } = reference;
      if (classification.kind !== 'user' || classification.status !== 'resolved') continue;
      expect(classification.resolvedDomain).toBe('Main');
    }
  });

  it('keeps every candidate with its span and selects none when the name is duplicated', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="d","INTEGER","one",""\nDomainInfo="D","TEXT","two",""\n` +
        '[Entity]\nPName="e"\nField="L","c","D","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );
    const classification = result.references[0]?.classification;

    // Two declarations, two spellings: the reference's own spelling is `D`, the declaration it most
    // resembles is `D`, and neither may be published as *the* target.
    expect(classification?.kind).toBe('user');
    expect(classification).toMatchObject({ kind: 'user', status: 'ambiguous', name: 'D' });
    expect(classification === undefined ? null : 'resolvedDomain' in classification).toBe(false);
    expect(
      classification?.kind === 'user' && classification.status === 'ambiguous'
        ? classification.candidates.map((candidate) => [candidate.name, candidate.span.keyLine])
        : null,
    ).toEqual([
      ['d', 3],
      ['D', 4],
    ]);
    // The reference is also listed as ambiguous, and no code is invented for it (§11 has none).
    expect(result.ambiguous.map((reference) => reference.column)).toEqual(['c']);
    expect(
      derivePartialSemantics(
        classify(
          scanSource({
            text:
              `${MANAGER}DomainInfo="d","INTEGER","one",""\nDomainInfo="D","TEXT","two",""\n` +
              '[Entity]\nPName="e"\nField="L","c","D","",,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
            format: 21,
          }),
        ),
      ).diagnostics,
    ).toEqual([]);
  });

  it('calls an unmatched type plain, not dangling', () => {
    const result = domainsOfText(
      `${MANAGER}DomainInfo="known","INTEGER","",""\n` +
        '[Entity]\nPName="e"\n' +
        'Field="L","a","Integer","",,"","",$FFFFFFFF,""\n' +
        'Field="L","b","unknown_domain","",,"","",$FFFFFFFF,""\n' +
        'Position="M",1,1\n',
    );

    // Neither token produced a `user` reference: P7's token shape carries no marker, so calling one
    // of them a dangling domain would be a guess dressed as a finding.
    expect(result.references).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(classifyType('unknown_domain', new Map())).toEqual({ kind: 'plain' });
    expect(classifyType('Integer', new Map())).toEqual({ kind: 'plain' });
  });
});

describe('CommonField is the documented eight elements (P12, K9)', () => {
  it('decodes the declaration with its empty middle slots (sem-07)', () => {
    const semantics = semanticsOf('sem-07');
    const common = semantics.commonFields[0];

    expect(semantics.commonFields).toHaveLength(1);
    expect(common).toMatchObject({
      logicalName: '共通ID',
      physicalName: 'common_id',
      dataType: 'Integer',
      notNull: false,
      notNullToken: 'nullable',
      keyOrder: null,
      defaultValue: '',
      comment: '共通列',
      color: '$FFFFFFFF',
      elementsSeen: 8,
      shape: 'documented',
    });
    expect(common?.span.keyLine).toBe(6);
  });

  it('reads the literal NotNull token this section uses (P12)', () => {
    const result = columnsOfText(
      `${MANAGER}CommonField="L","c","Integer",NotNull,0,"","",$FFFFFFFF\n`,
    );

    expect(result.commonFields[0]).toMatchObject({ notNull: true, notNullToken: 'not-null' });
  });

  it('does not coerce an unrecognised NOT NULL token (R20 rule)', () => {
    const result = columnsOfText(
      `${MANAGER}CommonField="L","c","Integer","NOT NULL",,"","",$FFFFFFFF\n`,
    );

    expect(result.commonFields[0]).toMatchObject({ notNull: null, notNullToken: 'unrecognised' });
  });

  it('keeps a duplicate physical name and reports it, case-insensitively (P12)', () => {
    const result = columnsOfText(
      `${MANAGER}CommonField="L","dup","Integer",,,,,"",$FFFFFFFF\n` +
        'CommonField="L2","DUP","TEXT",,,,,"",$FFFFFFFF\n',
    );

    expect(result.commonFields).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.declarations.map((entry) => entry.physicalName)).toEqual([
      'dup',
      'DUP',
    ]);
  });
});

describe('effective columns compose by opt-in, never by override (P6, §9.4)', () => {
  it('adds the common columns when the entity says nothing, with origin defaulted (sem-07)', () => {
    const entities = semanticsOf('sem-07').entityColumns;
    const withCommon = entities.find((entity) => entity.object === 'with_common');

    expect(withCommon?.usingCommonColumns).toEqual({
      value: 1,
      origin: 'defaulted',
      raw: '',
      span: null,
      token: 'absent',
    });
    expect(withCommon?.declared.map((column) => column.pname)).toEqual(['id', 'value_int']);
    expect(withCommon?.common.map((column) => [column.pname, column.source])).toEqual([
      ['common_id', 'common'],
    ]);
    expect(withCommon?.effective.map((column) => [column.pname, column.source])).toEqual([
      ['id', 'declared'],
      ['value_int', 'declared'],
      ['common_id', 'common'],
    ]);
    expect(withCommon?.collisions).toEqual([]);
  });

  it('composes nothing when the entity opts out (sem-07)', () => {
    const withoutCommon = semanticsOf('sem-07').entityColumns.find(
      (entity) => entity.object === 'without_common',
    );

    expect(withoutCommon?.usingCommonColumns).toMatchObject({
      value: 0,
      origin: 'declared',
      raw: '0',
      token: 'zero',
    });
    expect(withoutCommon?.common).toEqual([]);
    expect(withoutCommon?.effective.map((column) => column.pname)).toEqual(['id']);
  });

  it('composes on an explicit 1 and keeps the declared opt-in', () => {
    const entity = columnsOfText(
      `${MANAGER}CommonField="L","c","Integer",,,,,"",$FFFFFFFF\n` +
        '[Entity]\nPName="e"\nUsingCommonColumns=1\nField="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    ).entities[0];

    expect(entity?.usingCommonColumns).toMatchObject({ value: 1, origin: 'declared', raw: '1' });
    expect(entity?.effective.map((column) => column.pname)).toEqual(['id', 'c']);
  });

  it('leaves a broken opt-in undecided instead of assuming the default', () => {
    const result = columnsOfText(
      `${MANAGER}CommonField="L","c","Integer",,,,,"",$FFFFFFFF\n` +
        '[Entity]\nPName="e"\nUsingCommonColumns=maybe\nField="I","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );

    expect(result.entities[0]?.usingCommonColumns).toMatchObject({
      value: null,
      token: 'unrecognised',
      raw: 'maybe',
    });
    expect(result.entities[0]?.indeterminate).toBe(true);
    expect(result.entities[0]?.common).toEqual([]);
    expect(result.indeterminate.map((entity) => entity.object)).toEqual(['e']);
  });

  it('keeps both columns when a physical name arrives from both sources', () => {
    const result = columnsOfText(
      `${MANAGER}CommonField="共通ID","common_id","Integer",,,,,"",$FFFFFFFF\n` +
        '[Entity]\nPName="clash"\nField="ID","common_id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
    );
    const entity = result.entities[0];

    expect(entity?.effective.map((column) => [column.pname, column.source])).toEqual([
      ['common_id', 'declared'],
      ['common_id', 'common'],
    ]);
    expect(entity?.collisions).toHaveLength(1);
    expect(entity?.collisions[0]).toMatchObject({ object: 'clash', pname: 'common_id' });
    // Effective order: the declared `Field` line first, then the `CommonField` declaration.
    expect(entity?.collisions[0]?.spans.map((span) => span.keyLine)).toEqual([6, 3]);
    expect(entity?.effective.every((column) => column.collision)).toBe(true);
  });

  it('does not modify the classification it reads', () => {
    const classification = classificationOf('sem-07');
    const before = JSON.stringify(classification);
    derivePartialSemantics(classification);
    commonColumnsOf(classification);
    domainsOf(classification);

    expect(JSON.stringify(classification)).toBe(before);
  });

  it('composes per entity, leaving a view or a subtype out of it', () => {
    const semantics = semanticsOf('sem-07');

    expect(semantics.entityColumns.map((entity) => entity.object)).toEqual([
      'with_common',
      'without_common',
    ]);
    expect(semantics.indeterminateColumnLists).toEqual([]);
    // No diagnostic code exists for a domain or a common column, so none is invented.
    expect(semantics.diagnostics).toEqual([]);
  });
});

/**
 * R30: `CommonField`'s キー順 obeys the rule `schema/field.ts` already applies (R19).
 *
 * The old read was `keyOrderText === '' ? null : decodeInteger(...)` and then `keyOrder.ok ? value :
 * null`, which collapsed three different answers into one `null`: an empty slot, a token that is not
 * an integer, and a token that is an integer but not a `0`-based ordinal. It also published nothing
 * about which of them it was, so "no ordinal" and "unreadable ordinal" were the same record.
 *
 * The parity test at the end is the point: one ordinal rule for the whole format, checked by giving
 * a `Field` and a `CommonField` the same token and requiring the same answer.
 */
describe('CommonField キー順 uses the Field ordinal rule (R30)', () => {
  /** The single `CommonField` of a one-line document, with キー順 set to `token`. */
  function commonWith(token: string) {
    return columnsOfText(`${MANAGER}CommonField="L","c","Integer",,${token},"","",$FFFFFFFF\n`)
      .commonFields[0];
  }

  /** The single `Field` of a one-line document, with キー順 set to `token`. */
  function fieldWith(token: string) {
    const classification = classify(
      scanSource({
        text: `${MANAGER}[Entity]\nPName="e"\nField="L","c","Integer","",${token},"","",$FFFFFFFF,""\nPosition="M",1,1\n`,
        format: 21,
      }),
    );
    return classification.sections[1]?.decoded.fields[0];
  }

  it('reads an empty slot as empty, not as an invalid token', () => {
    expect(commonWith('')).toMatchObject({
      keyOrder: null,
      keyOrderToken: 'empty',
      keyOrderRaw: '',
    });
  });

  it('reads a slot the writer never emitted as empty, with no raw text', () => {
    // Four elements and nothing more: `キー順` has no position at all (§7.1: absent ≠ empty).
    const declaration = columnsOfText(`${MANAGER}CommonField="L","c","Integer","NotNull"\n`)
      .commonFields[0];

    expect(declaration).toMatchObject({
      keyOrder: null,
      keyOrderToken: 'empty',
      keyOrderRaw: null,
      elementsSeen: 4,
      shape: 'unexpected-element-count',
    });
  });

  it('accepts 0 and 1 as zero-based ordinals', () => {
    expect(commonWith('0')).toMatchObject({ keyOrder: 0, keyOrderToken: 'ordinal' });
    expect(commonWith('1')).toMatchObject({ keyOrder: 1, keyOrderToken: 'ordinal' });
  });

  it('accepts MAX_SAFE_INTEGER and rejects one past it', () => {
    expect(commonWith('9007199254740991')).toMatchObject({
      keyOrder: 9007199254740991,
      keyOrderToken: 'ordinal',
      keyOrderRaw: '9007199254740991',
    });
    // `Number('9007199254740992')` is exactly representable but not a safe integer, and a 19-digit
    // token would round: the ordinal is withheld and the text kept.
    expect(commonWith('9007199254740992')).toMatchObject({
      keyOrder: null,
      keyOrderToken: 'unrecognised',
      keyOrderRaw: '9007199254740992',
    });
  });

  it('keeps the token for a negative ordinal and refuses to make it a key column', () => {
    // `-1` is a valid integer but not a `0`-based ordinal, so it is unrecognised rather than `-1`.
    expect(commonWith('-1')).toMatchObject({
      keyOrder: null,
      keyOrderToken: 'unrecognised',
      keyOrderRaw: '-1',
    });
  });

  it('keeps the token for every malformed spelling', () => {
    for (const token of ['+1', '1.5', '0x10', 'abc', '01', '1e3']) {
      expect(commonWith(token), token).toMatchObject({
        keyOrder: null,
        keyOrderToken: 'unrecognised',
        keyOrderRaw: token,
      });
    }
  });

  it('agrees with `Field` on every token the audit named', () => {
    const tokens = [
      '',
      '0',
      '1',
      '-1',
      '+1',
      '1.5',
      '0x10',
      'abc',
      '9007199254740991',
      '9007199254740992',
    ];
    for (const token of tokens) {
      const common = commonWith(token);
      const field = fieldWith(token);
      expect(
        [common?.keyOrder, common?.keyOrderToken, common?.keyOrderRaw],
        `CommonField キー順=${token}`,
      ).toEqual([field?.keyOrder?.value ?? null, field?.keyOrderToken, field?.keyOrderRaw]);
    }
  });

  it('does not make a common column part of a primary key (matcher only)', () => {
    const semantics = derivePartialSemantics(
      classify(
        scanSource({
          text:
            `${MANAGER}CommonField="共通ID","common_id","Integer","NotNull",0,"","",$FFFFFFFF\n` +
            '[Entity]\nPName="e"\nField="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,""\nPosition="M",1,1\n',
          format: 21,
        }),
      ),
    );

    // The composed column is in the effective list, with its ordinal carried...
    const entity = semantics.entityColumns[0];
    expect(entity?.effective.map((column) => column.pname)).toEqual(['id', 'common_id']);
    // ...but the key is inferred from `Field` lines only: one column, and it is not the common one.
    expect(semantics.primaryKeys).toHaveLength(1);
    expect(semantics.primaryKeys[0]?.columns.map((column) => column.pname)).toEqual(['id']);
    expect(semantics.pkConflicts).toEqual([]);
  });
});
