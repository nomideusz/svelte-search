# Contributing

Thanks for your interest in improving `@nomideusz/svelte-search`!

## How this repo works

This repository is synced from a private monorepo, where primary development happens. Issues and pull requests here are very welcome — accepted PRs are applied upstream by the maintainer and flow back with the next sync, so your commit may land squashed or slightly rearranged (you'll be credited in the changelog).

## Getting started

```bash
pnpm install
pnpm dev          # demo site at localhost:5173
pnpm check        # svelte-check (types)
pnpm test         # vitest
pnpm run package  # build the library into dist/
```

Requires Node >= 20 and pnpm.

## Guidelines

- **Bugs**: open an issue with a minimal reproduction — the query, the relevant rows/schema (a few `SchemaAdapter` fields are enough), expected vs actual results.
- **Features**: open an issue first so we can agree on the API before you invest time.
- **PRs**: keep them focused; include a test when the change has testable logic; run `pnpm check` and `pnpm test` before submitting; add a line to `CHANGELOG.md` under an "Unreleased" heading.
- **Core stays generic**: `src/lib/core/` must not import Svelte, any framework, or any DB driver — databases are reached only through the `DatabaseClient` interface, and both `sqlite` and `postgres` dialects must keep working.
- **Language-specific logic** (diacritics, stop words, stemming, geo-intent phrases) belongs in `src/lib/locales/`, injected via `SearchLocale` — never hardcoded in core.
- **Types**: `SchemaAdapter`, `SearchLocale`, `SearchParams`, and `SearchResult` are stable public contracts — flag any change to them explicitly in your PR description.

## Code of Conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).
