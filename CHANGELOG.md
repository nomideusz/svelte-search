# Changelog

## 0.3.0 — 2026-08-02

### Fixed
- **Polish locative forms now reach the nominative.** `locationStems` could only shorten a word, but a Polish nominative is often not a prefix of the inflected form — "Katowicach" needs "katowice", "Gdyni" needs "gdynia", "Warszawie" needs "warszawa". 13 of the 21 most common Polish city locatives failed to resolve, including "w Warszawie", "w Poznaniu", "w Katowicach" and "w Opolu". Stems now also offer common nominative endings (and the fleeting-e form, "Sosnowcu" → "sosnowiec"); candidates are matched against the caller's lookup map, so over-generated ones never match. Adds `wie$`, `rze$`, `iu$`, `ej$`, `ym$`, `em$` rules and an irregular entry for Białystok.
- **`parseQuery` left bigram-matched words in `rest`.** A multi-word location ("Zielona Góra", "Nowy Sącz") matched correctly but both of its words also survived into `rest`, so callers read the location itself as an unclassified address.
- **Trigram fuzzy fallback ignored `categorySlug`.** A category-constrained search could return entities without that category once FTS produced fewer than 5 rows.
- **FTS rank saturated once `ftsColumnWeights` was set.** The score divided rank by a fixed 20, but bm25 magnitude scales with the weights, so the term pinned to 1.0 and stopped separating good matches from great ones. It is now normalized against the best rank in the batch — scale-independent, and correct for both the SQLite (negative) and Postgres (positive) conventions.
- **`searchAllInLocation` and `geoOnlySearch` leaked internal fields** (`_nameN`, `_hasFts`, …) that the main search path strips.
- **`parseQuery` reported `geoIntent: false` for a pure geo query.** `stripStopWords` also strips geo phrases, so "blisko mnie" / "near me" emptied `working` and returned through an early exit that hardcoded the flag to `false` — callers saw a blank, non-geo query and fell back to "show everything" instead of sorting by distance. Geo intent is now detected before stripping.
- **Polish `-e` preposition variants are stop words.** `we`, `pode`, `nade`, `przede` are obligatory before consonant clusters, so "joga we Wrocławiu" — the only correct way to say it — left `we` as an unclassified token and turned a city search into a street geocode.

### Changed
- **`walkingRoute()` now times out (5s default, configurable).** It fetched OSRM with no abort signal, so a stalled router hung the caller indefinitely — the documented "falls back gracefully to null on any error" never applied, because a hang is not an error. On an SSR path that was a hung request instead of a fall back to the straight-line `walkingMinutes()` estimate.
- **`sideEffects: false`** in package.json, so bundlers can tree-shake unused exports. Every module is pure; consumers were shipping the whole library to use one helper.
- **Stop words are dropped from the FTS query.** They are OR-ed with the real terms, so a term like `joga` in a yoga directory matched nearly every row and flattened ranking. Kept when stripping would leave the query empty.
- **English geo phrases are the no-locale default.** `hasGeoIntent`/`stripGeoIntent` previously returned `false`/no-op without a locale, making them inert unless you wrote a full locale. They now recognize `near me`, `nearby`, `around me`, `close to me`, `closest`. A supplied locale replaces these, as before.

- **`reindexAllTrigrams` and `rebuildAllSearchVectors` scanned the whole table in one `SELECT *`.** `renormalizeAll` already paged its scan to stay under the libsql/sqld HTTP response-size cap; the other two full scans had the same hazard and no paging. All three now share one paged scan helper.

### Added
- **`postcodePattern` / `formatPostcode` on `SearchLocale`, plus a `findPostcode()` export.** Postcode handling was hardcoded to the Polish `NN-NNN` shape in two places that had drifted apart — `isPostcode()` used an anchored regex while the resolver used its own `\b`-bounded copy inline and never called `isPostcode` at all (the import was dead). Both now go through the locale's pattern, so the package is usable outside Poland; the Polish form remains the default when a locale supplies nothing.

- First tests for `engine.ts` and `indexer.ts`, the two largest and previously untested files. `engine.test.ts` asserts SQL shape against a fake `DatabaseClient`; `engine.integration.test.ts` and `indexer.integration.test.ts` run the generated SQL against real in-memory SQLite with FTS5 via `node:sqlite` — no new dependency, and a worked schema example for adopters. 72 → 149 tests.
- Documented that `checkFtsSync` cannot detect an unbuilt index on an external-content FTS5 table, with a test pinning that behaviour so it is not mistaken for a regression later.

### Docs
- README corrections: `parseQuery` returns match objects rather than bare slugs, `trigramSimilarity('hatha','hata')` is 0.25 (Jaccard) not 0.67, and `ftsColumnWeights` is now in the tunables table.

## 0.2.1 — 2026-07-19

### Fixed
- **`polishLocative` no longer mangles the long tail of Polish town names.** The suffix rules cannot infer gender/number, so forms like "Dębicie" (correct: "Dębicy"), "Bolesławiecie" ("Bolesławcu"), "Bielskie-Białej" ("Bielsku-Białej"), and "Wrześniie" ("Wrześni") were produced for hundreds of towns. `LOCATIVE_IRREGULARS` now carries a hand-verified table of 487 localities — every Polish town with 10+ points in the kompi-recycling directory plus the yoga-directory localities — checked full-name-first before any suffix rule. Unlisted names still fall through to the rules as a best guess.

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
