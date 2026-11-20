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
- When a test passes a synthetic `.a5er` path to the code under test, it uses a disposable staged
  copy (`tests/helpers/stage.ts`), never the committed source. Read-only access to committed
  sources for staging and integrity checks (bytes, hashes) is fine; in-memory byte fixtures need no
  staging. Tests never modify committed fixtures; keep the input-immutability guarantees intact.
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

## Versioning and releases

Facts live in `package.json`, `scripts/release-*.mjs`, `.github/workflows/release.yml` and
`.github/workflows/ci.yml`; read them rather than trusting this summary if they disagree.

### Versions

- `package.json#version` is the source of truth. Move it only with `pnpm release:prepare X.Y.Z`
  (stable `X.Y.Z`, no `v` prefix, never backwards); it rewrites `package.json`, `VERSION` in
  `src/index.ts` and `TOOL_VERSION` in `src/json/envelope.ts`, and never runs `git`. Do not edit
  these by hand.
- Run `pnpm release:check` to detect disagreement across those declarations, the goldens, hardcoded
  package versions and the lockfile. It is not a quality gate: still run `pnpm build`, `typecheck`,
  `lint`, `format:check` and `test`.
- Goldens store `tool.version` as the `<package-version>` placeholder. Keep it; never hand-edit
  goldens for a routine bump or regenerate them from implementation output.
- `CONTRACT_VERSION` is independent of the package version. Change it only for an envelope contract
  change, never as part of a version bump.

### Release preparation and integration

- Prepare the bump on a dedicated branch and open a PR. Every job of the `ci.yml` matrix must pass
  on the exact head SHA.
- Integration into `main` needs independent review and explicit approval. Preparation, integration
  and publication are separate permissions; holding one grants none of the others.
- Before any tag, verify on `main`: the commit SHA is the approved one, `package.json#version` is
  the intended version, CI passed for that SHA, and the working tree is clean.

### Publication

- A release is a stable `vX.Y.Z` tag that equals `package.json#version` and points to an approved
  commit on `main`. Creating or pushing the tag needs explicit authorization.
- Pushing the matching tag starts `release.yml` automatically: it reruns the quality gates, refuses
  an already-published version, publishes to npm by OIDC Trusted Publishing, then creates the
  GitHub Release in a second job. Nothing is published by hand, and the environment has no manual
  approval step, so the tag push is the publication decision.
- The `release:prepare` closing line says tagging, pushing and publishing "stay manual"; that
  wording is outdated for publishing. Do not follow it, and do not run `npm publish`.
- Do not add long-lived npm credentials, manual publishing paths or workflow changes without
  separate approval.

### After a release

Verify each item against the real system and report only what you observed:

- the `release.yml` jobs, both `release` and `github-release`;
- the published npm version, its `latest` dist-tag, and its integrity and provenance metadata;
- the GitHub Release;
- installation of the published package and a CLI smoke test on a supported Node.js version.

### Release failures

- npm publication and GitHub Release creation succeed or fail independently. If npm succeeded and
  the Release did not, report partial success.
- Do not rerun the workflow or republish the same version, and do not read a registry error as
  "not published". Investigate, verify the registry's integrity data, and get separate approval
  before any recovery action.
- Never bypass a security or release gate to obtain a green result.
