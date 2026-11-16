/**
 * `io/` — bounded read-only input.
 *
 * `readSource` is the whole surface: open, stat, read within `maxBytes`, stat again, hash. It
 * never writes and never returns a partial buffer (`architecture.md` §10.1, §10.2).
 */

export { BINARY_WINDOW_BYTES, NUL_DENSITY_THRESHOLD, looksBinary, nulDensity } from './binary.js';
export type { FileSystem, SourceHandle, SourceStat } from './fs.js';
export { nodeFileSystem } from './fs.js';
export type { Limits } from './limits.js';
export { DEFAULT_LIMITS, withLimits } from './limits.js';
export type { ReadOptions, ReadOutcome, ReadSource } from './read.js';
export { READ_CHUNK_BYTES, readSource } from './read.js';
