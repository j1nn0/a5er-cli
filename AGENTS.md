# AGENTS.md

Rules for agents working in this repository.

- Write to the user in Japanese; write code, commits, comments, documentation and issues in English.
- Stay within the assigned scope. Do not add features, refactors, dependencies or files that the
  task did not ask for.
- Protect the user's uncommitted changes: never discard, overwrite or revert work you did not
  make. Ask before touching a dirty working tree.
- Respect `docs/architecture.md`, `docs/format-coverage.md`, `docs/parser-evaluation.md`,
  `docs/test-strategy.md` and the accepted code. Do not silently renegotiate them; if a change is
  needed, say so and get agreement first.
- Never silently drop, invent or reinterpret unknown or unparseable information. Preserve it with
  its source provenance, report it as a diagnostic or unsupported construct, keep the completeness
  counts honest, and say what was skipped.
- ER diagrams are confidential. `*.a5er` is gitignored for that reason; never commit, paste, quote
  or send a real `.a5er` file, its schema or anything derived from it (including JSON envelopes) to
  commits, issues, logs, docs or external services.
- Only the synthetic fixtures catalogued in `tests/helpers/fixture-registry.ts` are tracked, each
  through its own exact-file negation in `.gitignore`. Keep the blanket ignore and the per-file
  allowlist (no directory wildcard); never `git add -f` an unregistered `.a5er`. The G-8/G-9
  guards in `tests/catalog.test.ts` enforce this; see `docs/test-strategy.md`.
- Tests that touch a fixture use a disposable staged copy (`tests/helpers/stage.ts`), never the
  committed source. Keep the input-immutability guarantees intact.
- Derive golden expectations independently from the specifications and fixture evidence
  (`docs/json-golden-provenance.md`), never by copying serializer output. Do not regenerate
  goldens or edit expected diagnostics just to make a test pass.
- Never skip tests or verification, weaken an assertion, bypass a gate or add an unjustified skip.
- Run the gates from `package.json` after `pnpm install --frozen-lockfile`: `pnpm build`,
  `typecheck`, `lint`, `format:check`, `test`. Report the real result, including failures and
  platform-specific skips.
- CI is checked against the exact pushed commit SHA, with every job of the matrix in
  `.github/workflows/ci.yml`. Never claim a check passed unless you ran or inspected it; separate
  measured evidence from assumptions.
- Search existing issues before opening one. Implementation completion is not acceptance: where
  independent review is required, keep the issue open until a reviewer records an explicit PASS;
  do not self-certify.
- Push normally to the branch you were assigned. Direct pushes to `main`, force pushes, `npm
  publish`, tags and Release creation each need separate approval.
- The CLI is the source of truth for parsing and validation. The Agent Skill (`skills/a5er-cli/`)
  only invokes the CLI and interprets its envelope; it must not duplicate the parser or the file
  grammar.
- Document only shipped behaviour. Mark install paths that were not verified or are unavailable
  (see `README.md`) as such; do not present them as working.
