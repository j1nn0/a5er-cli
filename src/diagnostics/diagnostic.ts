/**
 * Diagnostics: the closed code enum, the severity table, and the factory.
 *
 * `architecture.md` §11 defines the contract this module implements:
 *
 * 1. **Trusted codes, untrusted details.** A file can never influence `code` or `message`;
 *    every string taken from the input goes into `details`, truncated to 200 characters. That
 *    is what stops a hostile `.a5er` from forging a diagnostic code.
 * 2. **No silent branch.** A path that decides not to model something emits a record — a
 *    `Diagnostic` or a `RawEntry` — never nothing.
 *
 * A code gains its fixed message and severity when the stage that raises it lands, and each
 * stage gets its own narrow entry point: `emit` for the fatal/decode families, `emitSyntax` for
 * the syntax layer (§7), so a call site can never raise a code its stage cannot justify.
 */

import type { Span } from '../model/span.js';

/** Severity classes from `architecture.md` §11. */
export type Severity = 'fatal' | 'error' | 'warning' | 'info';

/**
 * The closed diagnostic code enum (`architecture.md` §11).
 *
 * Declaring the whole taxonomy in one place keeps the codes stable and greppable before the
 * later stages exist; adding a code is a documented change, never an ad-hoc string.
 */
export type DiagnosticCode =
  // Cannot treat the input as text.
  | 'E_IO'
  | 'E_NOT_A_FILE'
  | 'E_EMPTY_INPUT'
  | 'E_BINARY_INPUT'
  // Stopped early — never a partial result.
  | 'E_TRUNCATED_INPUT'
  | 'E_LIMIT_BYTES'
  | 'E_LIMIT_LINES'
  | 'E_LIMIT_LINE_LENGTH'
  // No strict decoder succeeded, or the codec is missing from this build.
  | 'E_UNDECODABLE'
  | 'E_CODEC_UNAVAILABLE'
  // Not an a5er, or an unstable input.
  | 'E_UNRECOGNIZED_DOCUMENT'
  | 'E_FILE_CHANGED_DURING_READ'
  // Encoding was inferred, mismatched, or a BOM was absent.
  | 'D_BOM_MISSING'
  | 'D_ENCODING_ASSUMED'
  | 'D_ENCODING_MISMATCH'
  // Syntax layer (§7) — declared here, raised from stage 3 on.
  | 'S_HEADER_UNKNOWN_FORMAT'
  | 'S_UNKNOWN_SECTION'
  | 'S_UNKNOWN_KEY'
  | 'S_LEGACY_KEY'
  | 'S_MALFORMED_LINE'
  | 'S_DUPLICATE_KEY'
  | 'S_FIELD_TOO_FEW_ELEMENTS'
  | 'S_FIELD_TOO_MANY_ELEMENTS'
  | 'S_COMPLEX_UNTERMINATED_QUOTE'
  // Semantic layer (§9) — declared here, raised from stage 4/5 on.
  | 'V_MISSING_REQUIRED_KEY'
  | 'V_DUPLICATE_OBJECT_NAME'
  | 'V_DANGLING_ENTITY'
  | 'V_DANGLING_COLUMN'
  | 'V_DANGLING_PAGE'
  | 'V_FIELD_COUNT_MISMATCH'
  | 'V_PK_ORDER_CONFLICT'
  | 'V_INDEX_LEGACY_ONLY'
  | 'V_UNSUPPORTED_SUBTYPE_MEMBERSHIP'
  | 'V_VIEW_COLUMNS_UNKNOWN';

/** A code `io/` or `decode/` can raise: the fatal and decode families. */
export type SourceStageCode =
  | 'E_IO'
  | 'E_NOT_A_FILE'
  | 'E_EMPTY_INPUT'
  | 'E_BINARY_INPUT'
  | 'E_TRUNCATED_INPUT'
  | 'E_LIMIT_BYTES'
  | 'E_LIMIT_LINES'
  | 'E_LIMIT_LINE_LENGTH'
  | 'E_UNDECODABLE'
  | 'E_CODEC_UNAVAILABLE'
  | 'E_UNRECOGNIZED_DOCUMENT'
  | 'E_FILE_CHANGED_DURING_READ'
  | 'D_BOM_MISSING'
  | 'D_ENCODING_ASSUMED'
  | 'D_ENCODING_MISMATCH';

/**
 * A code the syntax stage can raise (§7).
 *
 * Only the codes a line scan can justify are here. `S_UNKNOWN_KEY`, `S_LEGACY_KEY`,
 * `S_DUPLICATE_KEY` and `S_FIELD_TOO_FEW_ELEMENTS`/`S_FIELD_TOO_MANY_ELEMENTS` need the
 * section-scoped key registry (§5, §7.2), so they join this list when that stage lands rather
 * than being emitted from a place that cannot know whether a key exists.
 */
export type SyntaxStageCode =
  | 'S_HEADER_UNKNOWN_FORMAT'
  | 'S_UNKNOWN_SECTION'
  | 'S_MALFORMED_LINE'
  | 'S_COMPLEX_UNTERMINATED_QUOTE';

/**
 * Detail values, per `architecture.md` §11.
 *
 * Untrusted text lives here and nowhere else: `code` and `message` are fixed strings, so a
 * file cannot forge a diagnostic or inject prose into a trusted field.
 */
export type DiagnosticDetail = string | number | boolean | null;

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly details: Readonly<Record<string, DiagnosticDetail>>;
  readonly span: Span | null;
  readonly construct: string | null;
}

/** `architecture.md` §11 rule 1: every string taken from the input is cut at 200 characters. */
export const MAX_DETAIL_LENGTH = 200;

/**
 * Bound an untrusted string for `details`.
 *
 * The marker is a plain `…` so a truncated value cannot be mistaken for the full one; the
 * result never exceeds `MAX_DETAIL_LENGTH` characters.
 */
export function boundedDetail(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH) return value;
  return `${value.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}

interface Definition {
  readonly severity: Severity;
  /** Fixed English text. File content is never interpolated (rule 1). */
  readonly message: string;
}

const DEFINITIONS: Readonly<Record<SourceStageCode, Definition>> = {
  E_IO: { severity: 'fatal', message: 'The input could not be read' },
  E_NOT_A_FILE: { severity: 'fatal', message: 'The input is not a regular file' },
  E_EMPTY_INPUT: { severity: 'fatal', message: 'The input is empty' },
  E_BINARY_INPUT: {
    severity: 'fatal',
    message: 'The input is binary and cannot be treated as text',
  },
  E_TRUNCATED_INPUT: {
    severity: 'fatal',
    message: 'The input ended before its declared size',
  },
  E_LIMIT_BYTES: { severity: 'fatal', message: 'The input is larger than the byte limit' },
  E_LIMIT_LINES: { severity: 'fatal', message: 'The input has more lines than the limit' },
  E_LIMIT_LINE_LENGTH: {
    severity: 'fatal',
    message: 'The input has a line longer than the limit',
  },
  E_UNDECODABLE: {
    severity: 'fatal',
    message: 'No supported encoding decodes the input without loss',
  },
  E_CODEC_UNAVAILABLE: {
    severity: 'fatal',
    message: 'A required character encoding is unavailable in this build',
  },
  E_UNRECOGNIZED_DOCUMENT: {
    severity: 'fatal',
    message: 'The input contains no recognised section header',
  },
  E_FILE_CHANGED_DURING_READ: {
    severity: 'fatal',
    message: 'The input changed while it was being read',
  },
  D_BOM_MISSING: {
    severity: 'info',
    message: 'The input has no byte-order mark; UTF-8 without one is tolerated',
  },
  D_ENCODING_ASSUMED: {
    severity: 'info',
    message: 'The encoding was inferred because the input does not declare one',
  },
  D_ENCODING_MISMATCH: {
    severity: 'warning',
    message: 'The declared encoding differs from the bytes; the bytes were used',
  },
};

/**
 * Syntax-stage definitions (§11's table, §7's rules).
 *
 * The two messages §12 prints are used verbatim; the other two say what §11's table says in its
 * "Meaning" column. Both `S_HEADER_UNKNOWN_FORMAT` and `S_MALFORMED_LINE` are warnings, and
 * `S_UNKNOWN_SECTION` is info — which is why txt-04 is `ok` with an unknown section while
 * val-08 is `degraded` with a broken line (§14's status derivation).
 */
const SYNTAX_DEFINITIONS: Readonly<Record<SyntaxStageCode, Definition>> = {
  S_HEADER_UNKNOWN_FORMAT: {
    severity: 'warning',
    message: 'The file declares no FORMAT, or one this tool does not know',
  },
  S_UNKNOWN_SECTION: {
    severity: 'info',
    message: 'A section this tool does not model was preserved verbatim',
  },
  S_MALFORMED_LINE: {
    severity: 'warning',
    message: 'A line is not a section header, a key, a comment, or blank',
  },
  S_COMPLEX_UNTERMINATED_QUOTE: {
    severity: 'warning',
    message: 'A Complex value ends inside a quote that is never closed',
  },
};

export interface EmitOptions {
  /** Untrusted values; strings are bounded here, not at the call site. */
  readonly details?: Readonly<Record<string, DiagnosticDetail>>;
  /** The construct the diagnostic is about, e.g. `'Header'`; never file content. */
  readonly construct?: string | null;
  /** Set by the stage that owns line numbers; `null` before the syntax stage. */
  readonly span?: Span | null;
}

/** Severity a code carries, from the §11 table. */
export function severityOf(code: SourceStageCode): Severity {
  return DEFINITIONS[code].severity;
}

/** Fixed message for a code, from the §11 table. */
export function messageOf(code: SourceStageCode): string {
  return DEFINITIONS[code].message;
}

/**
 * Build a `Diagnostic` for a code this layer can raise.
 *
 * String details are bounded to `MAX_DETAIL_LENGTH`; the severity and the message come from
 * the table, so a call site cannot pick a friendlier severity for a fatal code.
 */
export function emit(code: SourceStageCode, options: EmitOptions = {}): Diagnostic {
  return build(code, DEFINITIONS[code], options);
}

/**
 * Build a `Diagnostic` for a code the syntax stage can raise (§7).
 *
 * Same contract as `emit`: the code and the message are trusted, file text may only reach
 * `details`, and the severity comes from the table. A separate entry point keeps `emit`'s
 * accepted codes exactly as narrow as the stage that owns them.
 */
export function emitSyntax(code: SyntaxStageCode, options: EmitOptions = {}): Diagnostic {
  return build(code, SYNTAX_DEFINITIONS[code], options);
}

/** Shared body of `emit`/`emitSyntax`; the definition is already resolved by the caller. */
function build(code: DiagnosticCode, definition: Definition, options: EmitOptions): Diagnostic {
  const details: Record<string, DiagnosticDetail> = {};
  for (const [key, value] of Object.entries(options.details ?? {})) {
    details[key] = typeof value === 'string' ? boundedDetail(value) : value;
  }

  return {
    code,
    severity: definition.severity,
    message: definition.message,
    details,
    span: options.span ?? null,
    construct: options.construct ?? null,
  };
}
