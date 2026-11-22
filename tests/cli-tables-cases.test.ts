/**
 * `tests/cli-tables-cases.test.ts` — the CLI cases that no committed fixture reaches
 * (`docs/proposals/human-cli.md` §8.6, §4.4.1, §4.7, §4.9).
 *
 * Each case writes a small synthetic document to a `mkdtemp` directory, runs the built CLI and
 * asserts the facts §8.6 names. The whole-text expectations for the committed fixtures are in
 * `tests/cli-tables-text.test.ts`; this file covers the shapes that only a generated document can
 * have — a partial entity, an absent or empty `PName`, a name that is exactly `-`, terminal controls
 * in a name, the same name on three kinds, case-different names, subtypes only, and a duplicated
 * `PName` key.
 *
 * Documents are synthetic, written at run time and removed in `finally`.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `stdout` as raw bytes, for the control-character assertions. */
  readonly stdoutBytes: Buffer;
}

/** Run the built CLI with a fixed environment. */
function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { encoding: 'buffer', timeout: 20_000, env: { ...process.env, TZ: 'UTC', LANG: 'C' } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          code,
          stdout: stdout.toString('utf8'),
          stdoutBytes: Buffer.from(stdout),
          stderr: Buffer.from(stderr).toString('utf8'),
        });
      },
    );
  });
}

/** Write one document, run `probe` over its path, and always clean up. */
async function withDocument<T>(
  lines: readonly string[],
  probe: (path: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'a5er-cases-'));
  try {
    const path = join(directory, 'case.a5er');
    writeFileSync(path, lines.join('\n'), 'utf8');
    return await probe(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The one header every document needs, with a Manager section and optional extra sections.
 *
 * Written with a BOM and a FORMAT declaration, so the only findings are the ones the case is about;
 * a document without a BOM would add an unrelated `D_BOM_MISSING` info line to every note.
 */
function documentOf(...sections: readonly string[]): string[] {
  return [
    '\ufeff# A5:ER FORMAT:21',
    '',
    '[Manager]',
    'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
    ...sections,
  ];
}

/** The row lines of a text listing. */
function rowsOf(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /^[ 0-9]/.test(line));
}

describe('a5er tables — §8.6 cases that need a generated document', () => {
  it('reports a partial entity as unknown, with its note, and still exits 0', async () => {
    // One [Manager] section that declares the common field, then the entity that cannot compose it.
    const document = [
      '\ufeff# A5:ER FORMAT:21',
      '',
      '[Manager]',
      'PageInfo="Main",3,"A4Landscape","$FFFFFF"',
      'CommonField="作成日時","created_at","Timestamp",,,,"",$FFFFFFFF',
      '',
      '[Entity]',
      'PName="partial_one"',
      'UsingCommonColumns=2',
      'Field="ID","id","Serial","NOT NULL",0,"","",$FFFFFFFF,"",""',
      'Position="Main",10,10',
    ];

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);
      const json = await runCli(['tables', '--format', 'json', path]);

      expect(text.code).toBe(0);
      expect(rowsOf(text.stdout)[0]).toContain('partial_one');
      // Declared is known; common and effective are not, and the note says why.
      expect(rowsOf(text.stdout)[0]).toMatch(/partial_one.*|.*unknown.*unknown.*partial_one/);
      expect(text.stdout).toContain(
        '# unknown: UsingCommonColumns is neither 1 nor 0, so common columns are not composed (section 2)',
      );

      const parsed = JSON.parse(json.stdout) as {
        result: { tables: { columns: Record<string, unknown> }[] };
      };
      expect(parsed.result.tables[0]?.columns).toEqual({
        status: 'partial',
        reason: 'using-common-columns-unrecognised',
        declared: 1,
        common: null,
        effective: null,
        collisions: null,
      });
    });
  });

  it('prints a missing PName as -, reports the error, and keeps the read non-fatal', async () => {
    const document = documentOf('', '[Entity]', 'LName="名前のない表"', 'Position="Main",10,10');

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      expect(text.code).toBe(0);
      expect(rowsOf(text.stdout)[0]).toContain('名前のない表');
      expect(text.stdout).toContain('# diagnostics: 1 (fatal 0, error 1, warning 0, info 0)');
      expect(text.stderr).toBe(
        'a5er: error: V_MISSING_REQUIRED_KEY: A key the specification requires is absent (line 6)\n',
      );
    });
  });

  it('distinguishes a declared empty PName from a name that is exactly -', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      'PName=""',
      'UsingCommonColumns=0',
      'Position="Main",10,10',
      '',
      '[Entity]',
      'PName="dashy"',
      'LName="-"',
      'UsingCommonColumns=0',
      'Position="Main",20,20',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);
      const rows = rowsOf(text.stdout);

      // `""` is a declared empty value; `"-"` is the name `-`; a missing value would be a bare `-`.
      expect(rows[0]).toContain('""');
      expect(rows[1]).toMatch(/"-"$/);
    });
  });

  /**
   * S-4 / S-5 (§7.4): every control and invisible code point the current scanner keeps inside a
   * value — CSI, OSC 8, BEL, TAB, DEL, one NUL, C1, the line/paragraph separators, the bidi
   * controls, ZWJ, BOM and a tag sequence — in one `PName` and one `LName`.
   */
  const HOSTILE =
    'evil\u001b[2J\u001b]8;;x\u001b\\\u0007\u0009\u007f\u0000\u0085\u009b\u2028\u2029\u202e\u2066\u2069\u200d\ufeff\u{e0001}\u{e0041}txt.exe';

  it('neutralises every control in a name and keeps the line shape (S-4, S-5)', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      `PName="${HOSTILE}"`,
      `LName="${HOSTILE}"`,
      'UsingCommonColumns=0',
      'Position="Main",10,10',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);
      const json = await runCli(['tables', '--format', 'json', path]);
      const inspect = await runCli(['inspect', path]);

      // Not one C0 byte reaches the stream.
      for (const forbidden of [0x00, 0x07, 0x09, 0x1b]) {
        expect(text.stdoutBytes.includes(forbidden), `byte ${String(forbidden)}`).toBe(false);
      }
      // None of the invisible code points is written raw, as a character or as its UTF-8 bytes.
      for (const character of [
        '\u007f',
        '\u0085',
        '\u009b',
        '\u2028',
        '\u2029',
        '\u202e',
        '\u2066',
        '\u2069',
        '\u200d',
        '\ufeff',
        '\u{e0001}',
        '\u{e0041}',
      ]) {
        expect(text.stdout, JSON.stringify(character)).not.toContain(character);
      }

      // The escaped forms are what the renderer wrote instead (§4.4.1).
      for (const escaped of [
        '\\u{001B}[2J',
        '\\u{0007}',
        '\\u{0009}',
        '\\u{007F}',
        '\\u{0000}',
        '\\u{0085}',
        '\\u{009B}',
        '\\u{2028}',
        '\\u{2029}',
        '\\u{202E}',
        '\\u{2066}',
        '\\u{2069}',
        '\\u{200D}',
        '\\u{FEFF}',
        '\\u{E0001}',
        '\\u{E0041}',
      ]) {
        expect(text.stdout, escaped).toContain(escaped);
      }

      // S-5: every line is one of the three classes, none ends in whitespace, none holds CR or TAB.
      expect(text.stdout.endsWith('\n')).toBe(true);
      expect(text.stdout).not.toContain('\r');
      expect(text.stdout).not.toContain('\t');
      for (const line of text.stdout.slice(0, -1).split('\n')) {
        expect(line).not.toBe('');
        expect(line).not.toMatch(/\s$/);
        expect(line).toMatch(/^(# .*|SECTION .*|[ 0-9].*)$/);
      }

      // S-4: the JSON keeps the interpreted value `inspect` reports, not the text the generator
      // wrote — the CLI never re-reads its own rendering.
      const tablesDocument = JSON.parse(json.stdout) as {
        result: { tables: { pname: string | null; lname: string | null }[] };
      };
      const inspectDocument = JSON.parse(inspect.stdout) as {
        schema: { objects: { pname: { value: string } | null; lname: { value: string } | null }[] };
      };
      expect(tablesDocument.result.tables[0]?.pname).toBe(
        inspectDocument.schema.objects[0]?.pname?.value,
      );
      expect(tablesDocument.result.tables[0]?.lname).toBe(
        inspectDocument.schema.objects[0]?.lname?.value,
      );
      expect(tablesDocument.result.tables[0]?.pname).toBe(HOSTILE);
    });
  });

  it('keeps one entity, one view and one subtype with the same name as two rows and one omission', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      'PName="x"',
      'UsingCommonColumns=0',
      'Position="Main",10,10',
      '',
      '[View]',
      'PName="x"',
      'Position="Main",20,20',
      '',
      '[Subtype]',
      'PName="x"',
      'Position="Main",30,30',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      expect(rowsOf(text.stdout)).toHaveLength(2);
      expect(text.stdout).toContain(
        '# objects: 3 (entity 1, view 1, subtype 1); listed 2, omitted 1',
      );
      expect(text.stdout).toContain(
        "# omitted: subtypes are not listed (section 4); 'a5er inspect' reports them",
      );
      expect(text.stderr).toContain('V_DUPLICATE_OBJECT_NAME');
    });
  });

  it('keeps case-different names as two rows and reports no duplicate', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      'PName="Users"',
      'UsingCommonColumns=0',
      'Position="Main",10,10',
      '',
      '[Entity]',
      'PName="users"',
      'UsingCommonColumns=0',
      'Position="Main",20,20',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      expect(rowsOf(text.stdout)).toHaveLength(2);
      // Uniqueness is an exact match in the semantic layer (§9.1), so case alone is not a duplicate.
      expect(text.stderr).toBe('');
      expect(text.stdout).not.toContain('V_DUPLICATE_OBJECT_NAME');
    });
  });

  it('prints no table at all when the document has only subtypes', async () => {
    const document = documentOf(
      '',
      '[Subtype]',
      'PName="first"',
      'Position="Main",10,10',
      '',
      '[Subtype]',
      'PName="second"',
      'Position="Main",20,20',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      expect(text.stdout).not.toContain('SECTION');
      expect(text.stdout).toContain(
        '# objects: 2 (entity 0, view 0, subtype 2); listed 0, omitted 2',
      );
      expect(text.stdout).toContain(
        "# omitted: subtypes are not listed (sections 2, 3); 'a5er inspect' reports them",
      );
      expect(rowsOf(text.stdout)).toEqual([]);
    });
  });

  it('shows the last PName when an entity declares it twice, and reports S_DUPLICATE_KEY', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      'PName="first_name"',
      'PName="second_name"',
      'UsingCommonColumns=0',
      'Position="Main",10,10',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      expect(rowsOf(text.stdout)[0]).toContain('second_name');
      expect(rowsOf(text.stdout)[0]).not.toContain('first_name');
      expect(text.stdout).toContain('S_DUPLICATE_KEY');
    });
  });

  it('counts unsupported constructs by kind in first-appearance order', async () => {
    const document = documentOf(
      '',
      '[Entity]',
      'PName="known"',
      'MysteryKey="value"',
      'Position="Main",10,10',
      '',
      '[Memo]',
      'Note="not modelled"',
    );

    await withDocument(document, async (path) => {
      const text = await runCli(['tables', path]);

      // Two unknown keys — the entity's own and the [Memo] key line — plus the unmodelled section.
      expect(text.stdout).toContain(
        '# unsupported: 3 (unknown-key 2, unknown-section 1); kept verbatim, not interpreted',
      );
      expect(rowsOf(text.stdout)).toHaveLength(1);
    });
  });
});
