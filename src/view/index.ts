/**
 * `view/` — the `tables` projection (`docs/proposals/human-cli.md` §5.2–§5.5, §6).
 *
 * `tables.ts` owns the whole layer: `buildTablesEnvelope` builds the tables document from the
 * stage results `tables` already holds, `projectTables` and `toTablesEnvelope` are the same
 * document taken from the inspect envelope and stand as the oracle that builder is compared
 * against, and the key lists of §5.3 live beside them so the renderer, the encoder and the tests
 * read one statement of the shape.
 *
 * The layer is pure — no I/O, no clock — so a projection can never disagree with the records it
 * came from.
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
  buildTablesEnvelope,
  projectTables,
  toTablesEnvelope,
} from './tables.js';
