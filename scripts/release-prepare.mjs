#!/usr/bin/env node
/**
 * `pnpm release:prepare <X.Y.Z>` — move the package version, once, across every surface that holds it.
 *
 * It rewrites exactly three files (`package.json`, `src/index.ts`, `src/json/envelope.ts`), leaves
 * `CONTRACT_VERSION` and every golden untouched, proves the lockfile still agrees, and then prints
 * what changed and what to verify. It never runs `git`, never tags, pushes, publishes or creates a
 * release, and refuses to move backwards.
 */

import {
  compareVersions,
  consistencyReport,
  declaration,
  ENVELOPE_FILE,
  LIBRARY_VERSION_FILE,
  MANIFEST,
  manifestVersion,
  parseVersion,
  read,
  rewriteDeclaration,
  rewriteManifestVersion,
  ROOT,
  write,
} from './lib/version.mjs';

function die(message, hint) {
  process.stderr.write(`release:prepare: ${message}\n`);
  if (hint !== undefined) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
}

const argument = process.argv[2];
if (argument === undefined) {
  die('a target version is required', 'usage: pnpm release:prepare <X.Y.Z>');
}
if (process.argv.length > 3) {
  die('exactly one argument is accepted', 'usage: pnpm release:prepare <X.Y.Z>');
}
if (parseVersion(argument) === null) {
  die(
    `not a stable X.Y.Z version: ${JSON.stringify(argument)}`,
    'stable only: no v prefix, no prerelease, no build metadata, no leading zero',
  );
}

const current = manifestVersion(ROOT);
if (parseVersion(current) === null) {
  die(`the current package.json version is not a stable X.Y.Z: ${JSON.stringify(current)}`);
}
const target = argument;
if (compareVersions(target, current) < 0)
  die(`refusing to move backwards: ${current} -> ${target}`);

// The three declarations as they stand. A stale companion constant is repaired by the same run, so
// the question is "does everything already say target", not "is the manifest already bumped".
const manifestText = read(ROOT, MANIFEST);
const libraryText = read(ROOT, LIBRARY_VERSION_FILE);
const envelopeText = read(ROOT, ENVELOPE_FILE);
const libraryVersion = declaration(libraryText, 'VERSION');
const toolVersion = declaration(envelopeText, 'TOOL_VERSION');
const contractVersion = declaration(envelopeText, 'CONTRACT_VERSION');

const stale = [
  { file: MANIFEST, label: 'version', value: current },
  { file: LIBRARY_VERSION_FILE, label: 'VERSION', value: libraryVersion },
  { file: ENVELOPE_FILE, label: 'TOOL_VERSION', value: toolVersion },
].filter((entry) => entry.value !== target);

if (stale.length === 0) {
  const { facts, problems } = consistencyReport(ROOT);
  if (problems.length > 0) {
    process.stderr.write(
      `release:prepare: already at ${target}, but the version surfaces disagree:\n`,
    );
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(`release:prepare: already at ${target}; nothing to change\n`);
  process.stdout.write(`  ${facts.goldens} golden placeholder(s), lockfile consistent\n`);
  process.exit(0);
}

if (current !== target) {
  write(ROOT, MANIFEST, rewriteManifestVersion(manifestText, current, target));
}
if (libraryVersion !== target) {
  write(
    ROOT,
    LIBRARY_VERSION_FILE,
    rewriteDeclaration(libraryText, 'VERSION', libraryVersion, target),
  );
}
if (toolVersion !== target) {
  write(ROOT, ENVELOPE_FILE, rewriteDeclaration(envelopeText, 'TOOL_VERSION', toolVersion, target));
}

const after = consistencyReport(ROOT);
process.stdout.write(`release:prepare: ${current} -> ${target}\n`);
for (const entry of stale) {
  process.stdout.write(`  ${entry.file} ${entry.label}: ${entry.value} -> ${target}\n`);
}
process.stdout.write(`  unchanged: ${ENVELOPE_FILE} CONTRACT_VERSION ${contractVersion}\n`);
process.stdout.write(`  unchanged: ${after.facts.goldens} golden placeholder(s)\n`);
process.stdout.write('  unchanged: pnpm-lock.yaml (records no package version)\n');

if (after.problems.length > 0) {
  process.stderr.write('release:prepare: the version surfaces disagree after the change:\n');
  for (const problem of after.problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `release:prepare: consistent — ${after.facts.goldens} goldens, lockfile and constants agree\n`,
);
process.stdout.write('next:\n');
process.stdout.write('  pnpm release:check\n');
process.stdout.write(
  '  pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test\n',
);
process.stdout.write(
  '  review the diff, then commit; tagging, pushing and publishing stay manual\n',
);
