/**
 * hst-05 — CRLF, LF **and** bare CR in one file.
 *
 * The format defines no line endings at all (architecture §6 U4), so a mixed file must
 * parse with **no** diagnostic; the interesting part is that line numbering stays
 * correct across all three terminators. It is a byte module rather than a `.a5er.txt`
 * because `.gitattributes` normalises committed synthetic fixtures to LF, which would
 * silently delete the CRLF and CR halves of the fixture.
 *
 * Lines: CRLF, LF, CR, CRLF, LF, CRLF, LF.
 */

export const ID = 'hst-05';
export const FILE = 'hst-05-mixed-eol.ts';
export const ENCODING = 'utf-8';
export const HEX =
  'efbbbf232041353a455220464f524d41543a32310d0a5b4d616e616765725d0a50616765496e666f3d224d61696e222c332c2241344c616e647363617065222c2224464646464646220d5b456e746974795d0d0a504e616d653d226d697865645f656f6c220a4669656c643d224944222c226964222c2253657269616c222c224e4f54204e554c4c222c302c22222c22222c2446464646464646462c22222c22220d0a506f736974696f6e3d224d61696e222c31302c31300a';

/** Exact bytes of the fixture. */
export const BYTES: Uint8Array = Uint8Array.from(Buffer.from(HEX, 'hex'));
