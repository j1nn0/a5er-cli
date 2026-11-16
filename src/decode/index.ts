/**
 * `decode/` — charset detection and strict decoding.
 *
 * `loadSource` is the composition the syntax stage calls: bounded read, BOM sniff, binary
 * probe, strict decode, text limits, and the "is this a document at all" guard
 * (`architecture.md` §8, §10). Nothing here rewrites text or substitutes characters.
 */

export type { BomDetection, Codec } from './bom.js';
export { CANDIDATE_ORDER, NO_BOM, sniffBom } from './bom.js';
export type { DecodedText, DecodeOptions, DecodeOutcome, EncodingInfo } from './decode.js';
export { decodeBytes, isCodecAvailable } from './decode.js';
export type { HeaderHint } from './header.js';
export { HEADER_PEEK_BYTES, NO_HEADER, parseHeader, peekHeader } from './header.js';
export type { DecodedSource, LoadOptions, LoadOutcome } from './load.js';
export { loadSource } from './load.js';
export type { RecognisedSection } from './sections.js';
export { RECOGNISED_SECTIONS, hasRecognisedSection, scanSectionHeaders } from './sections.js';
