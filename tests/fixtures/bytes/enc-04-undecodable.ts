/**
 * enc-04 — bytes that no strict decoding candidate accepts.
 *
 * The content is a plausible header and section, followed by `0x41 0xFF`:
 * 0xFF is invalid UTF-8 and invalid Shift_JIS, and the odd byte count makes a
 * strict UTF-16LE decode fail as well. The reader must report `E_UNDECODABLE`
 * (architecture §11) and emit no schema — never mojibake.
 *
 * Verified at test time: all three strict decoders throw on these bytes.
 */

export const ID = 'enc-04';
export const FILE = 'enc-04-undecodable.ts';
export const HEX = '232041353a455220464f524d41543a32310a5b456e746974795d0a504e616d653d2278220a41ff';

/** Exact bytes of the fixture. */
export const BYTES: Uint8Array = Uint8Array.from(Buffer.from(HEX, 'hex'));
