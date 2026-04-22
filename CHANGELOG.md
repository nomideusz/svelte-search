# Changelog

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
