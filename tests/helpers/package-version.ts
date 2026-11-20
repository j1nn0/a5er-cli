import { readFileSync } from 'node:fs';

/**
 * The package version, read from `package.json` once, and the placeholder a golden carries in its
 * place.
 *
 * The golden files are the authored expectation of the serializer, not a transcript of it, so they
 * cannot hold a release-bound number: a bump would force 44 hand edits and let a wrong version be
 * "blessed" by regenerating them. Each golden stores `tool.version: '<package-version>'` instead,
 * and `json-goldens.test.ts` expands that one field to `PACKAGE_VERSION` at comparison time. Every
 * other field stays exactly as authored.
 *
 * Reading the manifest here is a test-only concern: `src/json/` itself must never read it (the
 * library surface and the installation layout are not the module's business).
 */
export const VERSION_PLACEHOLDER = '<package-version>';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
  throw new Error('package.json is not a JSON object');
}
const version = (manifest as Record<string, unknown>)['version'];
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`package.json version is not a stable X.Y.Z: ${JSON.stringify(version)}`);
}

/** The version every envelope must report, straight from the manifest. */
export const PACKAGE_VERSION: string = version;
