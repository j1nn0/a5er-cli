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
 * **Nothing here runs git, npm, pnpm or a registry.** `release:prepare` rewrites the three
 * declarations and leaves version control to a human; `release:check` is read-only — it reads the
 * manifest, the two declarations, the goldens and `pnpm-lock.yaml` and writes nothing. The lockfile
 * is compared by parsing it, not by shelling out to pnpm: a subprocess depends on the runner's store
 * and platform, which broke the Windows CI job, while the specifier comparison a manifest edit can
 * break is a plain text comparison.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
export const LOCKFILE = 'pnpm-lock.yaml';

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
  for (const directory of DRIFT_SCAN_ROOTS) {
    for (const path of walk(join(root, directory), [])) {
      // Normalised to repository form: `relative` yields backslashes on Windows and the allowlist
      // above is written with forward slashes.
      const asRepositoryPath = relative(root, path).split(sep).join('/');
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
 * The lockfile as the one thing a release can desync: the recorded specifiers of the root importer.
 *
 * `pnpm-lock.yaml` is machine-written and shallow at the top — `importers:` → `.` → a dependency
 * section → `<name>:` → `specifier:`/`version:` — so this reads exactly that shape with a line
 * scanner and throws on anything it does not recognise instead of guessing. Nothing else in the file
 * is interpreted (resolutions, snapshots, peer sets); those are pnpm's business at install time.
 *
 * Comparing `specifier` values with the manifest is the part of `pnpm install --frozen-lockfile` that
 * a manifest edit can break. Doing it in Node rather than through a subprocess keeps the check
 * read-only, network-free and identical on Windows, macOS and Linux: an `--offline` install depends
 * on the runner's store and failed on fresh Windows runners.
 */

/** Dependency sections pnpm records for the root importer. */
const RECORDED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** One line of the lockfile: 1-based number, indentation width, trimmed text. */
function indentedLines(text) {
  return text.split(/\r?\n/).map((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const number = index + 1;
    if (/^[ ]*\t/.test(line)) throw new Error(`line ${number}: tab indentation is not YAML`);
    return { number, indent: line.length - line.trimStart().length, text: line.trim() };
  });
}

/** A YAML scalar as pnpm writes it: plain, single-quoted or double-quoted. */
function scalar(text) {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  }
  return text;
}

/** `key:` or `key: value`; a mapping key yields `value: null`. */
function entry(text, number) {
  const colon = text.indexOf(':');
  if (colon <= 0) throw new Error(`line ${number}: expected "key: value"`);
  const key = scalar(text.slice(0, colon).trim());
  const rest = text.slice(colon + 1).trim();
  return { key, value: rest === '' ? null : rest };
}

/** Rejects a mapping written inline, because only `{}` is understood. */
function requireBlock(parsed, number) {
  if (parsed.value !== null && parsed.value !== '{}') {
    throw new Error(`line ${number}: ${parsed.key} must be a block mapping`);
  }
  return parsed.value === null;
}

/** `importers` → `.` → sections → entries → fields, as nested plain objects. */
function lockfileImporter(text) {
  const significant = indentedLines(text).filter(
    (line) => line.text !== '' && !line.text.startsWith('#'),
  );
  const importersAt = significant.findIndex(
    (line) => line.indent === 0 && line.text === 'importers:',
  );
  if (importersAt === -1) throw new Error('no top-level "importers:" block');

  const block = [];
  for (let index = importersAt + 1; index < significant.length; index += 1) {
    if (significant[index].indent === 0) break;
    block.push(significant[index]);
  }
  if (block.length === 0) throw new Error('the "importers:" block is empty');

  const importerIndent = Math.min(...block.map((line) => line.indent));
  const rootAt = block.findIndex(
    (line) => line.indent === importerIndent && entry(line.text, line.number).key === '.',
  );
  if (rootAt === -1) throw new Error('no "." importer');
  requireBlock(entry(block[rootAt].text, block[rootAt].number), block[rootAt].number);

  const sections = {};
  let index = rootAt + 1;
  while (index < block.length && block[index].indent > importerIndent) {
    const section = block[index];
    const sectionEntry = entry(section.text, section.number);
    const sectionHasChildren = requireBlock(sectionEntry, section.number);
    const names = {};
    sections[sectionEntry.key] = names;
    index += 1;
    if (!sectionHasChildren) continue;
    while (index < block.length && block[index].indent > section.indent) {
      const name = block[index];
      const nameEntry = entry(name.text, name.number);
      const nameHasChildren = requireBlock(nameEntry, name.number);
      const fields = {};
      names[nameEntry.key] = fields;
      index += 1;
      if (!nameHasChildren) continue;
      while (index < block.length && block[index].indent > name.indent) {
        const field = entry(block[index].text, block[index].number);
        if (field.value === null) {
          throw new Error(`line ${block[index].number}: ${field.key} has no value`);
        }
        fields[field.key] = scalar(field.value);
        index += 1;
      }
    }
  }
  return sections;
}

/** Recorded specifiers that disagree with the manifest, or one reason the lockfile could not be read. */
export function lockfileProblems(root, document) {
  let text;
  try {
    text = read(root, LOCKFILE);
  } catch (error) {
    return [`${LOCKFILE} is unreadable (${error.code ?? error.message}); run \`pnpm install\``];
  }
  let importer;
  try {
    importer = lockfileImporter(text);
  } catch (error) {
    return [`${LOCKFILE} is not a lockfile this check understands: ${error.message}`];
  }

  // Peer dependencies are compared only when the lockfile records them: pnpm resolves a package's
  // peers per package, so a root importer often has no `peerDependencies` block to compare with.
  const sections = new Set(RECORDED_SECTIONS);
  for (const name of Object.keys(importer)) {
    if (name.endsWith('Dependencies')) sections.add(name);
  }

  const problems = [];
  for (const section of [...sections].sort()) {
    const declared = document[section];
    if (
      declared !== undefined &&
      (typeof declared !== 'object' || declared === null || Array.isArray(declared))
    ) {
      problems.push(`package.json ${section} is not an object`);
      continue;
    }
    const expected = declared ?? {};
    const recorded = importer[section] ?? {};
    for (const name of Object.keys(recorded).sort()) {
      const specifier = recorded[name]?.specifier;
      if (specifier === undefined) {
        problems.push(`${LOCKFILE}: ${section}.${name} records no specifier; run \`pnpm install\``);
        continue;
      }
      if (!Object.hasOwn(expected, name)) {
        problems.push(
          `${LOCKFILE}: ${section}.${name} is recorded but package.json does not declare it; run \`pnpm install\``,
        );
        continue;
      }
      if (specifier !== expected[name]) {
        problems.push(
          `${LOCKFILE}: ${section}.${name} records ${JSON.stringify(specifier)}, package.json declares ${JSON.stringify(expected[name])}; run \`pnpm install\``,
        );
      }
    }
    for (const name of Object.keys(expected).sort()) {
      if (!Object.hasOwn(recorded, name)) {
        problems.push(
          `${LOCKFILE}: ${section}.${name} is declared but not recorded; run \`pnpm install\``,
        );
      }
    }
  }
  return problems;
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

  facts.lockfile = lockfileProblems(root, document);
  problems.push(...facts.lockfile);

  return { facts, problems };
}
