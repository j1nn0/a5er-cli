# AGENTS.md

Rules for agents working in this repository.

- Write to the user in Japanese; write code, commits, comments and documentation in English.
- Respect the existing specifications and changes: `docs/format-coverage.md`,
  `docs/architecture.md`, `docs/parser-evaluation.md`, `docs/test-strategy.md` and the accepted
  code. Do not silently renegotiate them; if a change is needed, say so and get agreement first.
- Never silently drop unknown or unparseable information. Preserve it, report it, and say what
  was skipped.
- Never skip tests or verification. Run the gates (`pnpm build`, `typecheck`, `lint`,
  `format:check`, `test`) and report the real result, including failures.
- Protect the user's uncommitted changes: never discard, overwrite or revert work you did not
  make. Ask before touching a dirty working tree.
- Treat ER diagrams as confidential. `.a5er` files are gitignored for that reason; never commit,
  paste or quote a real `.a5er` file or its schema.
- Push normally to the branch you were assigned. Direct pushes to `main`, force pushes, `npm
  publish` and Release creation still need separate approval.
- Stay within the assigned scope. Do not add features, refactors, dependencies or files that the
  task did not ask for.
