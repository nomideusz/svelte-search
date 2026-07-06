## What does this PR do?

<!-- A short description of the change and the motivation. Link the related issue if there is one. -->

Closes #

## Checklist

- [ ] `pnpm check` passes (no type errors)
- [ ] `pnpm test` passes
- [ ] Added/updated tests for logic changes (or explained why not needed)
- [ ] Added a `CHANGELOG.md` entry under "Unreleased"
- [ ] `src/lib/core/` stays framework- and driver-free (DB access only via `DatabaseClient`)
- [ ] Both `sqlite` and `postgres` dialects still work (or the limitation is called out below)
- [ ] Does **not** change `SchemaAdapter`, `SearchLocale`, `SearchParams`, or `SearchResult` (or the change is called out below)

## Notes for the reviewer

<!-- Anything non-obvious: behavior changes, migration steps for adapter authors, benchmarks. -->
