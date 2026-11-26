/**
 * `syntax/` — the line scan and the Complex value splitter (`architecture.md` §7, §4.4, §6).
 *
 * Two pure functions, split on purpose:
 *
 * - `scanSource` turns decoded text into lossless line facts: sections in file order with their
 *   spans, keys verbatim, comments, blank positions, raw lines, and §13's counters resolved over
 *   the records instead of asserted.
 * - `splitComplex` tokenises one Complex value. It records escapes but never applies them, so
 *   the unescaping stage cannot be confused with the splitting stage.
 *
 * Neither reaches outside its input: no filesystem, no clock, no environment. The registry
 * (§5), `Field` decode (§7.2) and `Value` decoding (§4.2) all build on top of these and are not
 * part of this layer.
 */

export type { ComplexPart, ComplexParts } from './complex.js';
export { splitComplex } from './complex.js';
export type { LineEnding, SourceLine } from './lines.js';
export { forEachLine, splitLines } from './lines.js';
export type {
  CommentRecord,
  FormatFact,
  HeaderRegion,
  KeyRecord,
  RawLineRecord,
  ScanInput,
  SectionEntry,
  SectionScan,
  SyntaxAccounting,
  SyntaxScan,
} from './scanner.js';
export { scanSource } from './scanner.js';
export type { SectionKind } from './sections.js';
export { sectionKindOf } from './sections.js';
export type { SourceShape } from './shape.js';
export { measureSourceShape } from './shape.js';
