/**
 * The one pipeline composition (`architecture.md` §11, §13; F4 U5-ADMIT1).
 *
 * Every command runs the same sequence over one path, in this order:
 *
 * 1. `loadSource` — read, decode and take the byte/line limits (§8, §10);
 * 2. `scanSource` — lossless line facts (§7);
 * 3. `measure` — the structural counters and the two bounds (§13);
 * 4. `admit` — this composition's ceilings;
 * 5. `classify` → `derivePartialSemantics`, only once the document is admitted.
 *
 * The order is the point. Steps 3 and 4 are the cheap ones and step 5 is not: the composed-column
 * work grows with `[Entity]` sections × `CommonField` declarations, which is exactly what the
 * admission bound measures, so a document is refused **before** the stage it would make expensive
 * runs, and no scan, classification or semantics of a refused document is retained.
 *
 * A rejected read stops at step 1 with its own fatal diagnostics and is returned unchanged. A refused
 * document is returned on the same arm as a rejected read — `{ load: { ok: false, … } }`, no `scan`,
 * no `classification`, no `semantics` — carrying exactly one `E_LIMIT_BUDGET` fatal and the limits the
 * read actually applied, so `integrate()` and `serialize()` need no new case: the document is
 * `failed` with `source`, `schema` and `completeness` null, `unsupported` empty and exit `1`. Nothing
 * partial ever leaves this module.
 *
 * **One composition, two budgets.** Before this module the CLI and `a5er tables` each spelled the
 * four stages out; two copies of a pipeline are two places for the order to drift. The profile is the
 * only difference between the callers (`src/budget/admission.ts` explains it), and it is a parameter
 * rather than a second function body. `createPipeline()` is what both call sites use, and each of
 * them resolves its ceilings once, when the pipeline is built.
 *
 * **Internal errors stay internal.** `ResourceMeasureError` and `ResourceAdmissionError` are not
 * caught here: they mean this tool cannot prove its own figures, which is a defect rather than a
 * property of the file, so they leave the pipeline as they are. `tables` reports that as its Phase A
 * exit `70`; `inspect` and `validate` keep their existing handling.
 */

import type { ResourceBudget } from './budget/index.js';
import { admit, measure, withResourceBudget } from './budget/index.js';
import { loadSource } from './decode/load.js';
import { emit } from './diagnostics/diagnostic.js';
import { classify } from './schema/index.js';
import { derivePartialSemantics } from './semantic/index.js';
import { scanSource } from './syntax/index.js';
import type { IntegrationInput } from './validate/index.js';

/** One path in, the stage results or the one outcome that stopped the pipeline out. */
export type IntegrationPipeline = (path: string) => IntegrationInput;

/** The construct an admission refusal names: the whole source, never a section, a line or a key. */
const LIMIT_CONSTRUCT = 'Source';

/**
 * Build the pipeline for one budget.
 *
 * **One argument, one source of truth.** The budget is the whole configuration: its own `profile`
 * decides which counters are compared and it carries exactly those ceilings, so there is no second
 * value a caller could pair with it and no way for a profile and a set of ceilings to disagree.
 * `src/budget/admission.ts` explains why the profile is a member of the budget rather than a
 * separate parameter.
 *
 * The budget is resolved once, through `withResourceBudget()`, so every invocation of the returned
 * function is judged against the same validated ceilings, and a budget this module cannot apply — an
 * unknown or missing `profile`, a ceiling that is not a positive safe integer — throws **at
 * construction**, before any path is known and therefore before any file could be read. The CLI and
 * `a5er tables` each pass the one default profile they ship; tests inject a small budget the same
 * single-argument way, because the ceilings this build ships sit far above every committed fixture
 * (at most 277 and 2).
 */
export function createPipeline(budget: ResourceBudget): IntegrationPipeline {
  const applied = withResourceBudget(budget);

  return (path: string): IntegrationInput => {
    const load = loadSource(path);
    // A rejected read is reported by the diagnostics it already carries, as before.
    if (!load.ok) return { load };

    const scan = scanSource(load.source);

    // Admission reads the measurement, and the measurement reads the scan: the scan is the only
    // figure the decision needs, so it is taken before the expensive stage can run.
    const admission = admit(measure(scan), applied);
    if (!admission.admitted) {
      // The refused arm: one fatal, the limits the read applied, and no stage result at all. The
      // decode diagnostics are not carried over — this is not a report about the document's content
      // but a statement about the work it would cost, and `E_LIMIT_BUDGET` says so on its own.
      return {
        load: {
          ok: false,
          diagnostics: [
            emit('E_LIMIT_BUDGET', {
              details: {
                counter: admission.counter,
                observed: admission.observed,
                ceiling: admission.ceiling,
              },
              construct: LIMIT_CONSTRUCT,
            }),
          ],
          limits: load.limits,
        },
      };
    }

    const classification = classify(scan);
    return { load, scan, classification, semantics: derivePartialSemantics(classification) };
  };
}
