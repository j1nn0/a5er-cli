# AGENTS.md

Rules for agents working in this repository.

## General

- Write to the user in Japanese; write code, comments, documentation, commits and issues in English.
- Stay within the assigned scope. Add no feature, refactor, dependency or file the task did not ask
  for.
- Never discard, overwrite or revert uncommitted work you did not make. Ask before touching a dirty
  working tree.
- Respect `docs/architecture.md`, `docs/format-coverage.md`, `docs/parser-evaluation.md`,
  `docs/test-strategy.md` and the accepted code. If one must change, say so and get agreement first.
- Never silently drop, invent or reinterpret unknown or unparseable information. Preserve it with its
  source provenance, report it as a diagnostic or unsupported construct, keep completeness counts
  honest, and say what was skipped.
- The CLI is the source of truth for parsing and validation. The Agent Skill (`skills/a5er-cli/`)
  only invokes it and interprets its envelope; it must not duplicate the parser or file grammar.
- Document only shipped, verified behaviour. Mark unverified or unavailable install paths (see
  `README.md`) as such.

## Data & Testing

- ER diagrams are confidential. Never commit, paste, quote or send a real `.a5er` file, its schema
  or anything derived from it (including JSON envelopes) to commits, issues, logs, docs or external
  services.
- Track only the synthetic fixtures in `tests/helpers/fixture-registry.ts`, each through its own
  exact-file `.gitignore` negation. Keep the blanket `*.a5er` ignore, allow no directory wildcard,
  and never `git add -f` an unregistered `.a5er` (guards G-8/G-9; see `docs/test-strategy.md`).
- Tests pass a disposable staged copy (`tests/helpers/stage.ts`) of a synthetic `.a5er`, never the
  committed source. Read-only access for staging and integrity checks is fine. Never modify
  committed fixtures.
- Derive golden expectations independently from the specifications and fixture evidence
  (`docs/json-golden-provenance.md`). Never copy serializer output, regenerate goldens, or edit
  expected diagnostics to make a test pass.
- Never skip tests, weaken an assertion, add an unjustified skip or bypass a gate.
- After `pnpm install --frozen-lockfile`, run the gates in `package.json`: `build`, `typecheck`,
  `lint`, `format:check`, `test`. Report real results, including failures and platform-specific
  skips.
- Check CI against the exact pushed commit SHA, covering every job of the `.github/workflows/ci.yml`
  matrix. Claim a check passed only if you ran or inspected it; separate measured evidence from
  assumptions.

## Git & Review

- Search existing issues before opening one.
- Implementation completion is not acceptance. Where independent review is required, keep the issue
  open until a reviewer records an explicit PASS; never self-certify.
- Push normally to your assigned branch. Direct pushes to `main`, merges into it, force pushes and
  other exceptional Git operations, tags, `npm publish` and Release creation each need separate
  explicit approval.
- Never bypass branch protection or any other repository safeguard.

## Versioning & Releases

- `package.json#version` is the version's source of truth. Change it only with
  `pnpm release:prepare X.Y.Z`; never synchronize other declarations by hand. Run
  `pnpm release:check` plus the quality gates; the checker replaces neither.
- Keep `CONTRACT_VERSION` independent of the package version and the `<package-version>` golden
  placeholder intact; a routine bump never edits goldens.
- Prepare a bump on a dedicated branch through a reviewed PR with the full CI matrix green.
  Preparation, integration and publication are separate authorizations; one grants none of the others.
- A release is a stable `vX.Y.Z` tag equal to `package.json#version` on an approved `main` commit.
  Verify the `main` SHA, version, CI status and a clean working tree first. Creating or pushing the
  tag needs explicit approval.
- Pushing the tag automatically runs `.github/workflows/release.yml`: it publishes to npm through
  OIDC Trusted Publishing, then creates the GitHub Release. Never publish manually, add long-lived
  npm credentials or change the workflow without separate approval.
- Afterwards verify the workflow jobs, npm version, dist-tag, integrity, provenance, the GitHub
  Release, and an install plus CLI smoke test on a supported Node.js. Report only what you observed.
- npm publication and the GitHub Release can fail independently; report partial success as such. Do
  not rerun the workflow, republish a version or read a registry error as "unpublished".
  Investigate, verify integrity and get separate approval before any recovery.
