/**
 * The version surfaces, in one place (`docs/architecture.md` §12 rule 5, TBD-O5).
 *
 * **Three files carry the package version and nothing else does.** `package.json` is the manifest,
 * `src/index.ts` exposes `VERSION` to library consumers, and `src/json/envelope.ts` mirrors it as
 * `TOOL_VERSION` because `src/json/` must not read the manifest or import the library surface.
 * `CONTRACT_VERSION` lives in the same file but is a different, independent number: it moves only
 * when a field of an existing command's envelope changes meaning, is added, removed, renamed or
 * reordered — never when the package is released. A new command with its own envelope shape,
 * selected by `(command, contractVersion)`, is additive and does not move it (architecture.md §12
 * rule 6).
 *
 * **The goldens carry a placeholder, not a number.** Every `tests/fixtures/json-goldens/*.expected.json`
 * stores `tool.version` as `VERSION_PLACEHOLDER`; the golden test expands that one field to the
 * current manifest version at comparison time and compares everything else as authored. A golden
 * therefore never has to be edited for a release, and a release can never bless a wrong version.
 *
 * **Nothing here runs git, npm, pnpm or a registry.** `release:prepare` rewrites the three
 * declarations and leaves version control to a human; `release:check` is read-only — it reads the
 * manifest, the two declarations and the goldens and writes nothing. The lockfile is deliberately not
 * part of this module: `pnpm install --frozen-lockfile` is the gate that proves it, and that command
 * runs in every documented gate list and in CI before this check.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root, resolved from this module so a script works from any working directory.
 * `A5ER_RELEASE_ROOT` points the same scripts at a throwaway copy, which is how the tests exercise
 * a bump without touching this checkout; unset, the default is this repository.
 */
export const ROOT =
  process.env.A5ER_RELEASE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));

export const PACKAGE_NAME = '@j1nn0/a5er-cli';

/** What a golden stores instead of the package version. */
export const VERSION_PLACEHOLDER = '<package-version>';

/**
 * The envelope contract version, held as the documented literal on purpose: a contract change is a
 * reviewed edit here and in `tests/json-contract.test.ts`, never a side effect of a release.
 */
export const CONTRACT_VERSION = '0.1.0';

export const MANIFEST = 'package.json';
export const LIBRARY_VERSION_FILE = 'src/index.ts';
export const ENVELOPE_FILE = 'src/json/envelope.ts';
export const GOLDEN_DIR = 'tests/fixtures/json-goldens';

/** The one declaration each version-carrying file is allowed to spell the version in. */
const CARRYING_DECLARATIONS = {
  [LIBRARY_VERSION_FILE]: 'VERSION',
  [ENVELOPE_FILE]: 'TOOL_VERSION',
};

/** Code that must never hardcode the package version: a bump would leave it stale. */
const DRIFT_SCAN_ROOTS = ['src', 'tests'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const read = (root, relative) => readFileSync(join(root, relative), 'utf8');

/**
 * Writes one file of the version surface.
 *
 * `A5ER_RELEASE_FAIL_WRITE=<repo-relative path>` makes the first matching write throw, so the recovery
 * path in `release:prepare` can be exercised on every platform. With a `:partial` suffix the write
 * first stores a truncated prefix, standing in for a real write that fails after modifying its
 * target, so recovery of the failing file itself is exercised too. Only the first matching write
 * fails, modelling a transient fault: the restore that follows must succeed. Nothing in CI sets it.
 */
const failedWrites = new Set();
export const write = (root, relative, text) => {
  const failWrite = process.env.A5ER_RELEASE_FAIL_WRITE;
  const partial = failWrite === `${relative}:partial`;
  if ((failWrite === relative || partial) && !failedWrites.has(failWrite)) {
    failedWrites.add(failWrite);
    if (partial) {
      writeFileSync(join(root, relative), text.slice(0, Math.max(1, Math.floor(text.length / 2))));
    }
    throw new Error(
      `simulated ${partial ? 'partial ' : ''}write failure for ${relative} (A5ER_RELEASE_FAIL_WRITE)`,
    );
  }
  writeFileSync(join(root, relative), text);
};

/**
 * Why `text` is not a usable version, or `null` when it is. Stable `X.Y.Z` syntax, and every component
 * a safe integer: a number past 2^53-1 cannot round-trip through `Number`, so a version built from it
 * could be compared or written out as a different number than it spells.
 */
export function versionProblem(text) {
  if (typeof text !== 'string' || !SEMVER.test(text)) {
    return 'must be a stable X.Y.Z (no prefix, no prerelease, no build metadata, no leading zero)';
  }
  for (const part of text.split('.')) {
    if (!Number.isSafeInteger(Number(part))) {
      return `each component must be a safe integer (at most ${Number.MAX_SAFE_INTEGER})`;
    }
  }
  return null;
}

/** `X.Y.Z` as a numeric triple, or `null` when `versionProblem` reports one. */
export function parseVersion(text) {
  if (versionProblem(text) !== null) return null;
  return text.split('.').map((part) => Number(part));
}

/** Numeric triple comparison; `release:prepare` uses it to refuse a downgrade. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) throw new Error(`not a stable version: ${left} / ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function manifest(root) {
  const parsed = JSON.parse(read(root, MANIFEST));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json is not a JSON object');
  }
  return parsed;
}

/** The manifest's `version` string, or a throw. */
function versionOf(document) {
  const version = document.version;
  if (typeof version !== 'string') throw new Error('package.json has no string version');
  return version;
}

export function manifestVersion(root) {
  return versionOf(manifest(root));
}

function occurrences(text, needle) {
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * `text` with comments and template literals blanked to spaces, newlines kept.
 *
 * Line-based, not a TypeScript parser: a small state machine blanks `//` tails, block-comment spans,
 * and backtick spans (with `\\` escapes and `${ … }` expressions understood, including nesting).
 * Single- and double-quoted strings are copied through so their contents cannot start a comment
 * or a template literal; no output line is hidden or faked by them because a plain string cannot
 * span lines (a backslash-newline continuation or a regex literal containing a backtick, brace or
 * comment marker would desync the scan, and these version files contain none of those).
 */
function maskIgnored(text) {
  const out = new Array(text.length);
  const stack = [{ template: false, braces: 0 }];
  let index = 0;
  const blankTo = (to) => {
    while (index < to) {
      out[index] = text[index] === '\n' ? '\n' : ' ';
      index += 1;
    }
  };
  const copyTo = (to) => {
    while (index < to) {
      out[index] = text[index];
      index += 1;
    }
  };
  while (index < text.length) {
    const frame = stack[stack.length - 1];
    const char = text[index];
    const next = text[index + 1] ?? '';
    if (!frame.template) {
      if (char === "'" || char === '"') {
        // A quoted string cannot start a comment or a template literal, so skip it verbatim:
        // the declaration's own quotes stay intact for the line match below.
        const quote = char;
        copyTo(index + 1);
        while (index < text.length && text[index] !== quote && text[index] !== '\n') {
          if (text[index] === '\\') copyTo(Math.min(index + 2, text.length));
          else copyTo(index + 1);
        }
        copyTo(Math.min(index + 1, text.length));
        continue;
      }
      if (char === '/' && next === '/') {
        const end = text.indexOf('\n', index);
        blankTo(end === -1 ? text.length : end);
        continue;
      }
      if (char === '/' && next === '*') {
        const end = text.indexOf('*/', index + 2);
        blankTo(end === -1 ? text.length : end + 2);
        continue;
      }
      if (char === '`') {
        blankTo(index + 1);
        stack.push({ template: true, braces: 0 });
        continue;
      }
      if (frame.braces > 0) {
        if (char === '{') frame.braces += 1;
        else if (char === '}') {
          frame.braces -= 1;
          if (frame.braces === 0) {
            copyTo(index + 1);
            stack.pop();
            continue;
          }
        }
      }
      copyTo(index + 1);
      continue;
    }
    if (char === '\\') {
      blankTo(index + 2);
      continue;
    }
    if (char === '`') {
      blankTo(index + 1);
      stack.pop();
      continue;
    }
    if (char === '$' && next === '{') {
      blankTo(index + 2);
      stack.push({ template: false, braces: 1 });
      continue;
    }
    blankTo(index + 1);
  }
  return out.join('');
}

/** Where the one live `export const NAME = '…';` line sits, or a reason it is not usable. */
function declarationLine(text, name) {
  const lines = maskIgnored(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  const literal = new RegExp(`^export const ${name} = '([^']*)';$`);
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = literal.exec(lines[index]);
    if (match !== null) found.push({ index, value: match[1] });
  }
  if (found.length === 1) {
    const extra = lines.findIndex(
      (line, index) =>
        index !== found[0].index && new RegExp(`^[ \t]*export const ${name}\\b`).test(line),
    );
    if (extra !== -1) {
      throw new Error(
        `${name} has an additional non-plain declaration on line ${extra + 1}; exactly one plain declaration is required`,
      );
    }
    return found[0];
  }
  if (found.length > 1) {
    throw new Error(
      `${name} is declared ${found.length} times; exactly one plain declaration is required`,
    );
  }
  if (new RegExp(`^[ \t]*export const ${name}\\b`, 'm').test(lines.join('\n'))) {
    throw new Error(
      `${name} is not a plain single-quoted string literal (expected \`export const ${name} = 'X.Y.Z';\`)`,
    );
  }
  if (new RegExp(`\\b${name}\\b`).test(text)) {
    throw new Error(
      `${name} is only mentioned inside a comment or string; a live declaration is required`,
    );
  }
  throw new Error(`${name} is not declared`);
}

/**
 * Reads one `export const NAME = 'value';` declaration: exactly one, a plain string literal, and code
 * rather than a comment. A commented-out copy is ignored, so documenting an old value does not block a
 * release; a second live declaration or a computed value is a failure, not a silent pick.
 */
export function declaration(text, name) {
  return declarationLine(text, name).value;
}

export function rewriteManifestVersion(text, from, to) {
  const needle = `"version": ${JSON.stringify(from)}`;
  const count = occurrences(text, needle);
  if (count !== 1) throw new Error(`package.json carries ${count} occurrences of ${needle}`);
  const next = text.replace(needle, `"version": ${JSON.stringify(to)}`);
  const parsed = JSON.parse(next);
  if (parsed.version !== to) {
    throw new Error(`package.json rewrite did not take: ${parsed.version}`);
  }
  return next;
}

/**
 * Rewrites the live declaration line and nothing else, so a commented-out copy of the old value stays
 * exactly where it is and the rest of the file is untouched byte for byte.
 */
export function rewriteDeclaration(text, name, from, to) {
  const at = declarationLine(text, name);
  const lines = text.split('\n');
  const needle = `export const ${name} = '${from}';`;
  const current = lines[at.index];
  if (!current.startsWith(needle)) {
    throw new Error(`${name} line is not the expected literal: ${JSON.stringify(current)}`);
  }
  lines[at.index] = `export const ${name} = '${to}';` + current.slice(needle.length);
  return lines.join('\n');
}

/** Every committed golden, sorted, with its parsed document. */
export function goldens(root) {
  const directory = join(root, GOLDEN_DIR);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.expected.json'))
    .sort()
    .map((name) => {
      const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      return { name, document: parsed };
    });
}

function walk(directory, out) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Source and test files that still spell out the version, outside the two authorized declarations. */
export function versionDrift(root, version) {
  const drift = [];
  for (const directory of DRIFT_SCAN_ROOTS) {
    for (const path of walk(join(root, directory), [])) {
      // Normalised to repository form: `relative` yields backslashes on Windows and the allowlist
      // above is written with forward slashes.
      const asRepositoryPath = relative(root, path).split(sep).join('/');
      const text = readFileSync(path, 'utf8');
      if (!text.includes(version)) continue;
      // A version-carrying file still scans: only the exact source range of its authorized version
      // literal is excused. The rest of that line stays subject to the drift check, so a trailing
      // comment that spells out the version is reported. If the literal cannot be located,
      // nothing is excused and the file is reported as drift.
      let excused = null;
      const declared = CARRYING_DECLARATIONS[asRepositoryPath];
      if (declared !== undefined) {
        try {
          const found = declarationLine(text, declared);
          const literal = `'${found.value}'`;
          const start = text.split('\n')[found.index].indexOf(literal);
          if (start !== -1) excused = { line: found.index + 1, start, end: start + literal.length };
        } catch {
          excused = null;
        }
      }
      const lines = text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => {
          if (excused === null || entry.number !== excused.line)
            return entry.line.includes(version);
          return (
            entry.line.slice(0, excused.start).includes(version) ||
            entry.line.slice(excused.end).includes(version)
          );
        })
        .map((entry) => entry.number);
      if (lines.length > 0) drift.push({ file: asRepositoryPath, lines });
    }
  }
  return drift;
}

/**
 * Every invariant `release:check` reports on. `facts` is what the script prints when all pass, so a
 * reader sees the values that were checked rather than a bare "ok".
 */
export function consistencyReport(root) {
  const problems = [];
  const facts = {};

  const document = manifest(root);
  facts.package = versionOf(document);
  if (parseVersion(facts.package) === null) {
    problems.push(`package.json version is not a stable X.Y.Z: ${JSON.stringify(facts.package)}`);
  }

  facts.version = declaration(read(root, LIBRARY_VERSION_FILE), 'VERSION');
  if (facts.version !== facts.package) {
    problems.push(
      `${LIBRARY_VERSION_FILE} VERSION is ${facts.version}, package.json is ${facts.package}`,
    );
  }

  const envelope = read(root, ENVELOPE_FILE);
  facts.toolVersion = declaration(envelope, 'TOOL_VERSION');
  if (facts.toolVersion !== facts.package) {
    problems.push(
      `${ENVELOPE_FILE} TOOL_VERSION is ${facts.toolVersion}, package.json is ${facts.package}`,
    );
  }

  facts.contractVersion = declaration(envelope, 'CONTRACT_VERSION');
  if (facts.contractVersion !== CONTRACT_VERSION) {
    problems.push(
      `${ENVELOPE_FILE} CONTRACT_VERSION is ${facts.contractVersion}, documented contract is ${CONTRACT_VERSION}`,
    );
  }
  if (facts.contractVersion === facts.package) {
    problems.push(
      `CONTRACT_VERSION equals the package version (${facts.package}); the two numbers are independent`,
    );
  }

  const goldenEntries = goldens(root);
  facts.goldens = goldenEntries.length;
  if (goldenEntries.length === 0) problems.push(`${GOLDEN_DIR} holds no golden`);
  for (const { name, document } of goldenEntries) {
    const tool = document?.tool;
    if (typeof tool !== 'object' || tool === null) {
      problems.push(`${name}: no tool object`);
      continue;
    }
    if (tool.name !== PACKAGE_NAME)
      problems.push(`${name}: tool.name is ${JSON.stringify(tool.name)}`);
    if (tool.version !== VERSION_PLACEHOLDER) {
      problems.push(
        `${name}: tool.version is ${JSON.stringify(tool.version)}, expected ${VERSION_PLACEHOLDER}`,
      );
    }
    if (document.contractVersion !== facts.contractVersion) {
      problems.push(
        `${name}: contractVersion is ${JSON.stringify(document.contractVersion)}, expected ${facts.contractVersion}`,
      );
    }
  }

  const drift = versionDrift(root, facts.package);
  facts.drift = drift.length;
  for (const { file, lines } of drift) {
    problems.push(`${file}: hardcodes the package version on line(s) ${lines.join(', ')}`);
  }

  return { facts, problems };
}
