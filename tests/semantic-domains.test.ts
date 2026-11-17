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
    expect(result.references[0]?.classification).toMatchObject({
      kind: 'user',
      status: 'ambiguous',
      resolvedDomain: 'd',
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
