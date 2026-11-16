/**
 * Source positions.
 *
 * `architecture.md` §4.4/§12 rule 3: every node that exists in the file carries a `Span`, and
 * `sectionIndex` is 1-based over section headers with `0` reserved for the header block.
 *
 * The syntax stage produces spans; `io/` and `decode/` run before any line model exists, so
 * their diagnostics carry `span: null` rather than a fabricated position.
 */
export interface Span {
  /** 1-based section ordinal; `0` is the header block. */
  readonly sectionIndex: number;
  /** 1-based first line of the construct. */
  readonly startLine: number;
  /** 1-based last line of the construct, inclusive. */
  readonly endLine: number;
  /** 1-based line the construct's key sits on; always within `startLine`..`endLine`. */
  readonly keyLine: number;
}
