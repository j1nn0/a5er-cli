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
 * The three line-level codes are raised by the scanner; the two `Field`-arity codes are raised by
 * the per-section decoders in `src/schema/` (§7.2's "S_ never becomes V_" split). `S_UNKNOWN_KEY`,
 * `S_LEGACY_KEY` and `S_DUPLICATE_KEY` need the section-scoped key registry (§5) and have their own
 * stage below.
 */
export type SyntaxStageCode =
  | 'S_HEADER_UNKNOWN_FORMAT'
  | 'S_UNKNOWN_SECTION'
  | 'S_MALFORMED_LINE'
  | 'S_COMPLEX_UNTERMINATED_QUOTE'
  | 'S_FIELD_TOO_FEW_ELEMENTS'
  | 'S_FIELD_TOO_MANY_ELEMENTS';

/**
 * A code the registry stage can raise (§5, F1).
 *
 * These three are the ones that need to know whether a key exists *for this section kind*, which
 * a line scan cannot. The `Field`-arity codes stay with the per-section decoders (§7.2).
 */
export type RegistryStageCode = 'S_UNKNOWN_KEY' | 'S_LEGACY_KEY' | 'S_DUPLICATE_KEY';

/**
 * A code the semantic stage can raise (§9, §11).
 *
 * Only the four findings this unit derives: object identity, required keys, key order and legacy-only
 * index data. The remaining `V_` codes (dangling references, field counts, view columns, subtype
 * membership) belong to the resolution work that is still open, and are not raised from anywhere yet.
 */
export type SemanticStageCode =
  | 'V_DUPLICATE_OBJECT_NAME'
  | 'V_MISSING_REQUIRED_KEY'
  | 'V_PK_ORDER_CONFLICT'
  | 'V_INDEX_LEGACY_ONLY';

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
  S_FIELD_TOO_FEW_ELEMENTS: {
    severity: 'warning',
    message: 'A Field value has fewer elements than its required shape needs',
  },
  S_FIELD_TOO_MANY_ELEMENTS: {
    severity: 'warning',
    message: 'A Field value has more elements than this format defines',
  },
};

/**
 * Registry-stage definitions (§11's table).
 *
 * `S_UNKNOWN_KEY` and `S_LEGACY_KEY` are `info` on purpose (§14 row 9): a file that uses keys this
 * tool does not model is preserved and reported, not degraded. `S_DUPLICATE_KEY` is a `warning`
 * because the file states two values for one slot and the reader had to choose between them (U6).
 */
const REGISTRY_DEFINITIONS: Readonly<Record<RegistryStageCode, Definition>> = {
  S_UNKNOWN_KEY: {
    severity: 'info',
    message: 'A key this section does not define was preserved verbatim',
  },
  S_LEGACY_KEY: {
    severity: 'info',
    message: 'A key superseded by a canonical spelling was decoded as legacy',
  },
  S_DUPLICATE_KEY: {
    severity: 'warning',
    message: 'A non-repeatable key appears more than once; the last occurrence is selected',
  },
};

/**
 * Semantic-stage definitions (§11's table).
 *
 * `V_MISSING_REQUIRED_KEY` is the one code §11 types as "warning **or** error" — error for identity
 * and `PageInfo`, warning otherwise — so its severity travels with the finding instead of living in
 * this table; see `emitMissingRequiredKey`.
 */
const SEMANTIC_DEFINITIONS: Readonly<Record<SemanticStageCode, Definition>> = {
  V_DUPLICATE_OBJECT_NAME: {
    severity: 'error',
    message: 'Two objects declare the same physical name',
  },
  V_MISSING_REQUIRED_KEY: {
    severity: 'warning',
    message: 'A key the specification requires is absent',
  },
  V_PK_ORDER_CONFLICT: {
    severity: 'warning',
    message: 'The declared key ordinals are not a unique zero-based sequence',
  },
  V_INDEX_LEGACY_ONLY: {
    severity: 'warning',
    message: 'The only index data this object declares uses the legacy spelling',
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

/**
 * Build a `Diagnostic` for a code the registry stage can raise (§5).
 *
 * Same contract as `emit`: the severity and the message come from the table, and file text may
 * only reach bounded `details`, never `code` or `message` (§11 rule 1).
 */
export function emitRegistry(code: RegistryStageCode, options: EmitOptions = {}): Diagnostic {
  return build(code, REGISTRY_DEFINITIONS[code], options);
}

/**
 * Build a `Diagnostic` for a code the semantic stage can raise (§9).
 *
 * Same contract as `emit`; `V_MISSING_REQUIRED_KEY` is emitted through
 * `emitMissingRequiredKey`, which is the only place a severity may be chosen.
 */
export function emitSemantic(code: SemanticStageCode, options: EmitOptions = {}): Diagnostic {
  return build(code, SEMANTIC_DEFINITIONS[code], options);
}

/**
 * Build the `V_MISSING_REQUIRED_KEY` diagnostic, whose severity §11 defines per subject:
 * `error` when the absent key is an identity key (`PName`) or `PageInfo`, `warning` otherwise.
 *
 * The finding supplies the severity because the specification assigns it per key; a call site can
 * still only pick one of the two values §11 allows, never a third.
 */
export function emitMissingRequiredKey(
  options: EmitOptions & { readonly severity: 'warning' | 'error' },
): Diagnostic {
  const definition = SEMANTIC_DEFINITIONS.V_MISSING_REQUIRED_KEY;
  return build(
    'V_MISSING_REQUIRED_KEY',
    { severity: options.severity, message: definition.message },
    options,
  );
}

/** Shared body of the stage emitters; the definition is already resolved by the caller. */
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
