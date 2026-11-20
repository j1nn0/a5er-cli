/**
 * The version surfaces, in one place (`docs/architecture.md` §12 rule 5, TBD-O5).
 *
 * **Three files carry the package version and nothing else does.** `package.json` is the manifest,
 * `src/index.ts` exposes `VERSION` to library consumers, and `src/json/envelope.ts` mirrors it as
 * `TOOL_VERSION` because `src/json/` must not read the manifest or import the library surface.
 * `CONTRACT_VERSION` lives in the same file but is a different, independent number: it moves only
 * when an envelope field is added, removed or renamed, never when the package is released.
 *
 * **The goldens carry a placeholder, not a number.** Every `tests/fixtures/json-goldens/*.expected.json`
 * stores `tool.version` as `VERSION_PLACEHOLDER`; the golden test expands that one field to the
 * current manifest version at comparison time and compares everything else as authored. A golden
 * therefore never has to be edited for a release, and a release can never bless a wrong version.
 *
 * **Nothing here runs git, npm or a registry.** `release:prepare` rewrites the three declarations and
 * leaves version control to a human; `release:check` is read-only apart from the lockfile proof,
 * which pnpm performs with `--frozen-lockfile` and therefore refuses to write.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this module so a script works from any working directory. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

/** The two source files allowed (indeed required) to carry the package version. */
const VERSION_CARRYING_SOURCES = new Set([LIBRARY_VERSION_FILE, ENVELOPE_FILE]);

/** Code that must never hardcode the package version: a bump would leave it stale. */
const DRIFT_SCAN_ROOTS = ['src', 'tests'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const read = (root, relative) => readFileSync(join(root, relative), 'utf8');

export const write = (root, relative, text) => writeFileSync(join(root, relative), text);

/** `X.Y.Z` or `null`. No `v` prefix, no leading zero, no prerelease or build metadata. */
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = SEMVER.exec(text);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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

export function manifestVersion(root) {
  const version = manifest(root).version;
  if (typeof version !== 'string') throw new Error('package.json has no string version');
  return version;
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
 * Reads one `export const NAME = 'value';` declaration and requires it to be unique and literal.
 * A second declaration, a template string or a computed value is a failure, not a silent pick.
 */
export function declaration(text, name) {
  const pattern = new RegExp(`^export const ${name} = '([^']*)';$`, 'm');
  const matches = [...text.matchAll(new RegExp(pattern.source, 'gm'))];
  if (matches.length !== 1) {
    throw new Error(`${name} must be declared exactly once as a single-quoted literal`);
  }
  return matches[0][1];
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

export function rewriteDeclaration(text, name, from, to) {
  const needle = `export const ${name} = '${from}';`;
  const count = occurrences(text, needle);
  if (count !== 1) throw new Error(`${name} carries ${count} occurrences of ${needle}`);
  return text.replace(needle, `export const ${name} = '${to}';`);
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

/** Source and test files that still spell out the version, outside the two that must. */
export function versionDrift(root, version) {
  const drift = [];
  for (const relative of DRIFT_SCAN_ROOTS) {
    for (const path of walk(join(root, relative), [])) {
      const asRepositoryPath = path.slice(root.length);
      if (VERSION_CARRYING_SOURCES.has(asRepositoryPath)) continue;
      const text = readFileSync(path, 'utf8');
      if (!text.includes(version)) continue;
      const lines = text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => entry.line.includes(version))
        .map((entry) => entry.number);
      drift.push({ file: asRepositoryPath, lines });
    }
  }
  return drift;
}

/**
 * pnpm owns lockfile consistency: `--frozen-lockfile` makes a disagreement an error instead of a
 * silent rewrite, and `--lockfile-only` keeps `node_modules` out of it. The project version is not
 * recorded in the lockfile, so a release must leave it untouched, which this also proves.
 */
export function lockfileProblems(root) {
  try {
    execFileSync('pnpm', ['install', '--lockfile-only', '--frozen-lockfile', '--offline'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return [
      `pnpm install --lockfile-only --frozen-lockfile --offline failed (run \`pnpm install\` first): ${detail}`,
    ];
  }
}

/**
 * Every invariant `release:check` reports on. `facts` is what the script prints when all pass, so a
 * reader sees the values that were checked rather than a bare "ok".
 */
export function consistencyReport(root) {
  const problems = [];
  const facts = {};

  facts.package = manifestVersion(root);
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

  facts.lockfile = lockfileProblems(root);
  problems.push(...facts.lockfile);

  return { facts, problems };
}
