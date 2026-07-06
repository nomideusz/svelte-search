# Changelog

## 0.2.0 — 2026-07-06

### Fixed
- **Fuzzy quality gate is now per-word** — typo queries against multi-word entity names could never pass the Levenshtein gate (the query was compared to the whole field, so `"triranta"` vs `"Triratna Warszawa - Buddyzm i medytacja Mokotów"` scored ~0.17 and was rejected). The gate now uses the best of whole-field and per-word similarity; false-positive protection is unchanged (`"inowroclaw"` still does not match `"wroclaw"`).

### Added
- **`ftsColumnWeights` engine option** (SQLite) — per-column bm25 weights for FTS ranking, in FTS table column order. Without it all columns weigh equally, so a term repeated in a long description column outranks an exact name match before the result limit is applied. Weight name-like columns high and description-like columns low, e.g. `ftsColumnWeights: [10, 4, 4, 4, 3, 2, 0.5]`. Opt-in; behavior is unchanged when unset.
- **`bestWordSimilarity(query, field, locale?)`** exported from the package — max of whole-field and per-word normalized Levenshtein similarity.
- Community health files: code of conduct, contributing guide, security policy, issue and PR templates.

## 0.1.3 — 2026-06-29

### Security
- Bump vulnerable devDependencies to clear npm High CVE alerts: `vite` ^7.3.1 → ^7.3.5, `vitest` ^4.0.18 → ^4.1.0, `@sveltejs/kit` ^2.50.2 → ^2.60.1. No runtime deps affected.

## 0.1.2 — 2026-06-17

### Changed
- Add `homepage` field pointing to the live demo (now shown as Homepage on npm).
- Add a live-demo link to the README.
- Ship the MIT `LICENSE` file in the published tarball (previously absent).

## 0.1.1 — 2026-04-23

### Fixed
- **Repository metadata** — `repository` field now points at the standalone `github.com/nomideusz/svelte-search` repo instead of the monorepo, so the npm package page links to the right place.
- **CHANGELOG included in tarball** — `CHANGELOG.md` is now part of the published package (0.1.0 shipped without it).

## 0.1.0 — 2026-04-23

Initial public release.

### Added
- **Search engine** — `createSearchEngine({ db, adapter, locale?, dialect? })` with synonym expansion, full-text search, trigram fuzzy fallback, score blending, quality gate, and primary/nearby relevance boundaries.
- **Dialect support** — `sqlite` (FTS5 `MATCH` + custom trigram tables) and `postgres` (`tsvector` + `pg_trgm`).
- **Schema adapter** — `SchemaAdapter` interface for mapping any DB schema to the engine's concepts (entities, trigrams, FTS, synonyms).
- **Indexer** — `createIndexer()` with `indexTrigrams()`, `reindexAllTrigrams()`, `rebuildFts()`, `checkFtsSync()`, `updateSearchVector()` (Postgres).
- **Query resolver** — `parseQuery()` classifies tokens into location / category / area / rest; `findMatchingArea()` and `findNearestLocationWithEntities()` helpers.
- **Geo helpers** — `haversineKm`, `walkingMinutes`, `boundingBox`, `formatDistance`, `formatWalkingTime`, `walkingRoute` (OSRM).
- **Normalization & similarity** — `normalize`, `stripDiacriticsGeneric`, `trigrams`, `trigramSimilarity`, `levenshtein`, `levenshteinSimilarity`, `isPostcode`, `hasGeoIntent`, `stripGeoIntent`, `stripStopWords`.
- **Polish locale** (`@nomideusz/svelte-search/locales/pl`) — diacritics, stop words and phrases, geo-intent patterns (`blisko mnie`, `niedaleko`, `w okolicy`, …), and nominative-form stemming.
- **Tracker** — `createTracker()` fire-and-forget analytics via `navigator.sendBeacon`, session ID in `sessionStorage`.
- **Types** — `SearchParams`, `SearchResult`, `SearchResponse`, `AutocompleteResult`, `SearchLocale`, `ResolverLookups`, `ResolverAction`, `TrackSearchEvent`, `DatabaseClient`, `SqlDialect`.
- 67 unit tests across core (geo, normalize, resolver) and the Polish locale.
