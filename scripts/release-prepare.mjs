#!/usr/bin/env node
/**
 * `pnpm release:prepare <X.Y.Z>` — move the package version, once, across every surface that holds it.
 *
 * **Nothing is written until everything checks out.** The run reads the three files first, validates
 * the current state and the target, refuses to prepare when some other file still spells out the
 * version the bump would leave behind (or already spells out the target), computes all three
 * replacements in memory, validates the proposed texts, and only then writes. A predictable
 * validation failure therefore leaves every file byte-identical.
 *
 * A write that fails unexpectedly is not retried or papered over: the files this run already wrote are
 * restored from the bytes it read, and anything that could not be restored is reported by path. There
 * is no journal, no backup on disk and no `git` call — restoring from `git` would throw away changes
 * this command never made.
 *
 * It rewrites exactly three files (`package.json`, `src/index.ts`, `src/json/envelope.ts`), leaves
 * `CONTRACT_VERSION` and every golden untouched, and never tags, pushes, publishes or creates a
 * release: an approved, matching tag push is what starts the automated publication.
 */

import {
  compareVersions,
  consistencyReport,
  declaration,
  ENVELOPE_FILE,
  LIBRARY_VERSION_FILE,
  MANIFEST,
  manifestVersion,
  read,
  rewriteDeclaration,
  rewriteManifestVersion,
  ROOT,
  versionDrift,
  versionProblem,
  write,
} from './lib/version.mjs';

/** The three files this command may modify, in the order it validates and writes them. */
const FILES = [MANIFEST, LIBRARY_VERSION_FILE, ENVELOPE_FILE];

/** The declarations each file must carry, and how they are reported. */
const DECLARATIONS = [
  { file: LIBRARY_VERSION_FILE, name: 'VERSION', role: 'carried' },
  { file: ENVELOPE_FILE, name: 'TOOL_VERSION', role: 'carried' },
  { file: ENVELOPE_FILE, name: 'CONTRACT_VERSION', role: 'independent' },
];

function die(message, hint) {
  process.stderr.write(`release:prepare: ${message}\n`);
  if (hint !== undefined) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
}

/** Line numbers that differ between two texts, or `null` when the line count changed. */
function changedLines(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  if (left.length !== right.length) return null;
  const lines = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) lines.push(index + 1);
  }
  return lines;
}

function printProblems(heading, problems, hint) {
  process.stderr.write(`release:prepare: ${heading}\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  if (hint !== undefined) process.stderr.write(`  ${hint}\n`);
}

// ---- 1. arguments, before anything is read ----------------------------------

const argument = process.argv[2];
if (argument === undefined) {
  die('a target version is required', 'usage: pnpm release:prepare <X.Y.Z>');
}
if (process.argv.length > 3) {
  die('exactly one argument is accepted', 'usage: pnpm release:prepare <X.Y.Z>');
}
const targetProblem = versionProblem(argument);
if (targetProblem !== null) {
  die(`not a usable version: ${JSON.stringify(argument)}`, targetProblem);
}
const target = argument;

// ---- 2. read every file this command can modify, then validate --------------

const original = new Map();
for (const file of FILES) {
  try {
    original.set(file, read(ROOT, file));
  } catch (error) {
    die(`cannot read ${file}: ${error.code ?? error.message}`, 'nothing was written');
  }
}

let current;
try {
  current = manifestVersion(ROOT);
} catch (error) {
  die(
    `cannot determine the current version from ${MANIFEST}: ${error.message}`,
    'nothing was written',
  );
}

const currentProblem = versionProblem(current);
if (currentProblem !== null) {
  die(
    `the current ${MANIFEST} version is not usable: ${JSON.stringify(current)}`,
    `${currentProblem}; nothing was written`,
  );
}
if (compareVersions(target, current) < 0) {
  die(`refusing to move backwards: ${current} -> ${target}`, 'nothing was written');
}

/** The live declaration values, or a die() naming the file that has none / too many / a comment. */
const declared = new Map();
for (const { file, name } of DECLARATIONS) {
  try {
    declared.set(name, declaration(original.get(file), name));
  } catch (error) {
    die(`${file}: ${error.message}`, 'nothing was written');
  }
}
const contractVersion = declared.get('CONTRACT_VERSION');

// ---- 3. no other file may spell out either version --------------------------

// The bump leaves every mention of the current version stale, and a mention of the target version
// would already be wrong today. Both are checked before anything is computed or written.
const drift = [];
try {
  for (const version of current === target ? [current] : [current, target]) {
    for (const hit of versionDrift(ROOT, version)) drift.push({ ...hit, version });
  }
} catch (error) {
  die(
    `cannot scan for stale version references: ${error.code ?? error.message}`,
    'nothing was written',
  );
}
if (drift.length > 0) {
  printProblems(
    `refusing to prepare ${target}; files outside the two version declarations spell out a version`,
    drift.map(
      (hit) =>
        `${hit.file} line(s) ${hit.lines.join(', ')}: ${hit.version}${
          hit.version === current
            ? ' (this bump would leave it stale)'
            : ' (the version being prepared)'
        }`,
    ),
    'remove or parameterise those references first; nothing was written',
  );
  process.exit(1);
}

// ---- 4. compute every replacement in memory, then validate the result -------

const proposed = new Map(original);
const changes = [];
try {
  if (current !== target) {
    proposed.set(MANIFEST, rewriteManifestVersion(original.get(MANIFEST), current, target));
    changes.push({ file: MANIFEST, label: 'version', from: current });
  }
  if (declared.get('VERSION') !== target) {
    const file = LIBRARY_VERSION_FILE;
    proposed.set(
      file,
      rewriteDeclaration(original.get(file), 'VERSION', declared.get('VERSION'), target),
    );
    changes.push({ file, label: 'VERSION', from: declared.get('VERSION') });
  }
  if (declared.get('TOOL_VERSION') !== target) {
    const file = ENVELOPE_FILE;
    proposed.set(
      file,
      rewriteDeclaration(original.get(file), 'TOOL_VERSION', declared.get('TOOL_VERSION'), target),
    );
    changes.push({ file, label: 'TOOL_VERSION', from: declared.get('TOOL_VERSION') });
  }
} catch (error) {
  die(`cannot compute the replacement: ${error.message}`, 'nothing was written');
}

const proposalProblems = [];
let proposedManifest;
try {
  proposedManifest = JSON.parse(proposed.get(MANIFEST));
} catch (error) {
  proposalProblems.push(`${MANIFEST} would no longer be valid JSON: ${error.message}`);
}
if (proposedManifest !== undefined && proposedManifest?.version !== target) {
  proposalProblems.push(`${MANIFEST} would read ${JSON.stringify(proposedManifest?.version)}`);
}
for (const { file, name, role } of DECLARATIONS) {
  try {
    const value = declaration(proposed.get(file), name);
    const expected = role === 'independent' ? contractVersion : target;
    if (value !== expected) proposalProblems.push(`${file}: ${name} would read ${value}`);
  } catch (error) {
    proposalProblems.push(`${file}: ${error.message}`);
  }
}
for (const { file, label } of changes) {
  const lines = changedLines(original.get(file), proposed.get(file));
  if (lines === null) {
    proposalProblems.push(`${file} would change its line count`);
  } else if (lines.length !== 1) {
    proposalProblems.push(
      `${file} would change ${lines.length} lines (${lines.join(', ')}); the ${label} line alone is expected`,
    );
  }
}
if (proposalProblems.length > 0) {
  printProblems(
    'the proposed replacement is not safe; refusing to write it',
    proposalProblems,
    'nothing was written',
  );
  process.exit(1);
}

// ---- 5. an already-prepared target is a no-op, not a rewrite ----------------

if (changes.length === 0) {
  const { facts, problems } = consistencyReport(ROOT);
  if (problems.length > 0) {
    printProblems(`already at ${target}, but the version surfaces disagree`, problems);
    process.exit(1);
  }
  process.stdout.write(`release:prepare: already at ${target}; nothing to change\n`);
  process.stdout.write(`  ${facts.goldens} golden placeholder(s)\n`);
  process.stdout.write('  next: pnpm release:check\n');
  process.exit(0);
}

// ---- 5b. the current tree must already agree before anything is written ----
// The proposal validation above covers the three version files, but the golden and contract
// invariants are checked by consistencyReport() only after writing. A corrupted golden must not
// cost the version files their contents, so the complete existing check runs here instead.
let preexisting;
try {
  preexisting = consistencyReport(ROOT);
} catch (error) {
  die(`cannot verify the current tree: ${error.code ?? error.message}`, 'nothing was written');
}
if (preexisting.problems.length > 0) {
  printProblems(
    `refusing to prepare ${target}; the version surfaces already disagree`,
    preexisting.problems,
    'nothing was written',
  );
  process.exit(1);
}

// ---- 6. write, restoring this run's own writes if one of them fails ---------

const written = [];
let writing;
try {
  for (const { file } of changes) {
    writing = file;
    write(ROOT, file, proposed.get(file));
    written.push(file);
    writing = undefined;
  }
} catch (error) {
  process.stderr.write(
    `release:prepare: writing ${writing ?? 'a file'} failed: ${error.code ?? error.message}\n`,
  );
  const restored = [];
  const unrecovered = [];
  for (const file of written) {
    try {
      write(ROOT, file, original.get(file));
      restored.push(file);
    } catch (restoreError) {
      unrecovered.push({ file, error: restoreError });
    }
  }
  // A failing write may still have modified its target, so the file that threw is verified
  // against the bytes this run read, using the same restore path as the files above.
  if (writing !== undefined) {
    let current;
    try {
      current = read(ROOT, writing);
    } catch {
      current = undefined;
    }
    if (current !== original.get(writing)) {
      try {
        write(ROOT, writing, original.get(writing));
        restored.push(writing);
      } catch (restoreError) {
        unrecovered.push({ file: writing, error: restoreError });
      }
    }
  }
  if (restored.length > 0) process.stderr.write(`  restored: ${restored.join(', ')}\n`);
  if (written.length === 0) process.stderr.write('  no file had been written yet\n');
  if (unrecovered.length > 0) {
    for (const { file, error: restoreError } of unrecovered) {
      process.stderr.write(
        `  could not restore ${file}: ${restoreError.code ?? restoreError.message}\n`,
      );
    }
    process.stderr.write(`  still modified: ${unrecovered.map(({ file }) => file).join(', ')}\n`);
  }
  process.stderr.write('  fix the cause and run pnpm release:check\n');
  process.exit(1);
}

// ---- 7. prove the result and report ----------------------------------------

const after = consistencyReport(ROOT);
process.stdout.write(`release:prepare: ${current} -> ${target}\n`);
for (const { file, label, from } of changes) {
  process.stdout.write(`  ${file} ${label}: ${from} -> ${target}\n`);
}
process.stdout.write(`  unchanged: ${ENVELOPE_FILE} CONTRACT_VERSION ${contractVersion}\n`);
process.stdout.write(`  unchanged: ${after.facts.goldens} golden placeholder(s)\n`);
// The lockfile is not touched by this command and is not reported as verified: `pnpm install
// --frozen-lockfile` is the gate that proves it.

if (after.problems.length > 0) {
  printProblems('the version surfaces disagree after the change', after.problems);
  process.exit(1);
}

process.stdout.write(
  `release:prepare: consistent — ${after.facts.goldens} goldens and constants agree\n`,
);
process.stdout.write('next:\n');
process.stdout.write('  pnpm release:check\n');
process.stdout.write(
  '  pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test\n',
);
process.stdout.write(
  '  review the diff and commit it; this command never tags, pushes or publishes\n',
);
process.stdout.write(
  '  creating and pushing a release tag needs separate authorization, and an approved matching\n',
);
process.stdout.write('  tag push starts the automated npm publish and GitHub Release\n');
