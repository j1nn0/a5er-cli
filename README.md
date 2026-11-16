# a5er-cli

A command-line tool for parsing, inspecting, validating, and querying A5:SQL Mk-2 ER diagram (`.a5er`) files.

> **Status:** Phase 1 complete — format investigation, parser evaluation, architecture, test
> strategy and the TypeScript/ESM development scaffold are in place. The current build exposes
> **only** `--help` and `--version`; the `.a5er` parser and every analysis command (`inspect`,
> `tables`, `relations`, `search`, `validate`, `export`) are **not yet implemented** and are
> planned for Phase 2.

## Overview

a5er-cli aims to provide reliable, structured access to A5:SQL Mk-2 ER diagram files for developers, automation tools, and AI agents.

The project focuses on accurate parsing, machine-readable output, and traceability to the original file.

## Goals

- Parse `.a5er` files according to the documented format.
- Inspect entities, columns, indexes, and relationships.
- Search schema definitions by name or comment.
- Validate file structure and reference consistency.
- Produce structured JSON output.
- Preserve source information and report unsupported constructs.
- Support read-only operations without modifying input files.

## Planned CLI

```bash
a5er inspect schema.a5er
a5er tables schema.a5er --format json
a5er table schema.a5er users --format json
a5er relations schema.a5er users
a5er search schema.a5er "email"
a5er validate schema.a5er
a5er export schema.a5er --format json
```

These commands are proposals and are not yet implemented.

## Design Principles

- **Accuracy first:** Never silently invent or discard schema information.
- **Read-only:** Do not modify the original ER diagram.
- **Traceability:** Make parsed definitions traceable to their source.
- **Machine-readable:** Provide predictable output for automated consumers.
- **Portability:** Avoid dependencies on specific AI agent environments.

## Phase 1 documents

- [Format coverage](docs/format-coverage.md) — what the v2.21 specification defines, item by item, and what remains unconfirmed.
- [Parser evaluation](docs/parser-evaluation.md) — why the parser is built from the specification instead of depending on an existing one.
- [Architecture](docs/architecture.md) — modules, data model, diagnostics and the initial JSON contract.
- [Test strategy](docs/test-strategy.md) — test levels, fixture policy and the gates a change must pass.

## Documentation

- [A5:SQL Mk-2 ER Diagram File Specification](https://a5m2.mmatsubara.com/document/v2.21/a5er_specification.html)
- [Related Agent Skills](https://github.com/j1nn0/skills)

## License

MIT License. See [LICENSE](LICENSE).
