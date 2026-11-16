/**
 * enc-03 — Shift_JIS bytes under a `# A5:ER ENCODING:UTF8` header.
 *
 * The file is valid Shift_JIS and invalid UTF-8, so a reader that trusts the
 * header produces mojibake while a strict decoder chain reports
 * `D_ENCODING_MISMATCH` (architecture §11) and decodes the Japanese names
 * correctly. Stored as hex because Node has no Shift_JIS encoder — the bytes
 * were produced once and are asserted as-is.
 *
 * Decoded content (Shift_JIS):
 *
 *   # A5:ER FORMAT:21
 *   # A5:ER ENCODING:UTF8
 *
 *   [Entity]
 *   PName="注文"
 *   LName="注文テーブル"
 *   Position="Main",10,10
 */

export const ID = 'enc-03';
export const FILE = 'enc-03-sjis.ts';
export const ENCODING = 'shift_jis';
export const HEX =
  '232041353a455220464f524d41543a32310a232041353a455220454e434f44494e473a555446380a0a5b456e746974795d0a504e616d653d22928d95b6220a4c4e616d653d22928d95b68365815b8375838b220a506f736974696f6e3d224d61696e222c31302c31300a';

/** Exact bytes of the fixture. */
export const BYTES: Uint8Array = Uint8Array.from(Buffer.from(HEX, 'hex'));
