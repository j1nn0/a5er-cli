#!/usr/bin/env node
/**
 * `pnpm release:check` — read-only proof that every version surface agrees.
 *
 * Exit 0 prints the values it checked; exit 1 prints one line per disagreement. It never writes a file
 * and never spawns a process: every check is a comparison of files this repository already commits.
 */

import {
  consistencyReport,
  GOLDEN_DIR,
  MANIFEST,
  PACKAGE_NAME,
  ROOT,
  VERSION_PLACEHOLDER,
} from './lib/version.mjs';

function report(problems) {
  process.stdout.write(`version check: ${problems.length === 0 ? 'ok' : 'failed'}\n`);
  for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
  process.exit(problems.length === 0 ? 0 : 1);
}

let result;
try {
  result = consistencyReport(ROOT);
} catch (error) {
  report([`the version surfaces could not be read: ${error.message}`]);
}

const { facts, problems } = result;
process.stdout.write(`version check: ${PACKAGE_NAME} ${facts.package}\n`);
process.stdout.write(`  ${MANIFEST} version ${facts.package}\n`);
process.stdout.write(`  src/index.ts VERSION ${facts.version}\n`);
process.stdout.write(`  src/json/envelope.ts TOOL_VERSION ${facts.toolVersion}\n`);
process.stdout.write(
  `  src/json/envelope.ts CONTRACT_VERSION ${facts.contractVersion} (independent of the package version)\n`,
);
process.stdout.write(
  `  ${GOLDEN_DIR} ${facts.goldens} golden(s), tool.version ${JSON.stringify(VERSION_PLACEHOLDER)}, contractVersion ${facts.contractVersion}\n`,
);
process.stdout.write(
  `  hardcoded package versions in src/ and tests/ ${facts.drift === 0 ? 'none' : `${facts.drift} file(s)`}\n`,
);
// The lockfile is deliberately not reported here: `pnpm install --frozen-lockfile` is the gate that
// proves it, and every documented gate list and CI runs that command before this one.
report(problems);
