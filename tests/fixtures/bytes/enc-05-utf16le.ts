/**
 * enc-05 — UTF-16LE with a BOM and no `ENCODING` hint.
 *
 * The BOM is the only evidence of the encoding, so the reader reports
 * `D_ENCODING_ASSUMED` (info, architecture §11) and decodes with the BOM
 * detector rather than the header.
 *
 * Decoded content:
 *
 *   # A5:ER FORMAT:21
 *
 *   [Entity]
 *   PName="utf16"
 *   Position="Main",10,10
 */

export const ID = 'enc-05';
export const FILE = 'enc-05-utf16le.ts';
export const ENCODING = 'utf-16le';
/** BOM (FF FE) followed by the UTF-16LE body. */
export const HEX =
  'fffe23002000410035003a0045005200200046004f0052004d00410054003a00320031000a000a005b0045006e0074006900740079005d000a0050004e0061006d0065003d0022007500740066003100360022000a0050006f0073006900740069006f006e003d0022004d00610069006e0022002c00310030002c00310030000a00';

/** Exact bytes of the fixture. */
export const BYTES: Uint8Array = Uint8Array.from(Buffer.from(HEX, 'hex'));
