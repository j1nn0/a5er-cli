/**
 * `view/` — the `tables` projection (`docs/proposals/human-cli.md` §5.2–§5.5, §6).
 *
 * `tables.ts` owns the whole layer: `projectTables` turns an inspect envelope's `schema` into the
 * small result, `toTablesEnvelope` builds the tables document, and the key lists of §5.3 live
 * beside them so the renderer, the encoder and the tests read one statement of the shape.
 *
 * The layer is pure — no stage, no I/O, no clock — so a projection can never disagree with the
 * envelope it came from.
 */

export {
  NOTE_PREFIX,
  TABLE_COLUMNS_KEYS,
  TABLE_ROW_KEYS,
  TABLE_SPAN_KEYS,
  TABLES_COMMAND,
  TABLES_ENVELOPE_KEYS,
  TABLES_OMITTED_KEYS,
  TABLES_OMITTED_SUBTYPES_KEYS,
  TABLES_RESULT_KEYS,
  projectTables,
  toTablesEnvelope,
} from './tables.js';
