# @nomideusz/svelte-search

[![npm](https://badgen.net/npm/v/@nomideusz/svelte-search)](https://www.npmjs.com/package/@nomideusz/svelte-search) [![license](https://badgen.net/badge/license/MIT/blue)](./LICENSE)

A full-text search engine for Svelte 5 apps backed by your own database. Combines FTS5 (SQLite) or `tsvector` (PostgreSQL) with trigram fuzzy matching, geo proximity, synonym expansion, and a pluggable schema adapter. Ships with a Polish locale that handles diacritics, stop words, and locative-case stemming.

**[Live demo → svelte-search-eight.vercel.app](https://svelte-search-eight.vercel.app/)**

## Install

```bash
pnpm add @nomideusz/svelte-search
```

> Requires Svelte 5 (`^5.0.0`). Works with any SQL client that exposes an `execute()` method — libsql, better-sqlite3, postgres.js, etc.

## Why

Most Svelte search libraries index in-memory or hit an external service. This one pushes the query down to your database so it stays fast at any table size, but stays generic: you provide a `SchemaAdapter` that maps the engine's concepts (entities, trigrams, FTS, synonyms) onto your tables. The engine then handles:

1. Synonym expansion
2. Full-text search (FTS5 `MATCH` / Postgres `tsvector @@ tsquery`)
3. Trigram fuzzy fallback (custom tables on SQLite, `pg_trgm` on Postgres)
4. Score blending (FTS rank + name similarity + field match + geo)
5. Quality gate (Levenshtein threshold to reject junk fuzzy hits)
6. Relevance boundaries (primary radius + "also within reach" list)

## Quick Start

Define a `SchemaAdapter` that points at your tables and columns, then create an engine:

```ts
import { createSearchEngine, type SchemaAdapter, type SearchResult } from '@nomideusz/svelte-search';
import { plLocale } from '@nomideusz/svelte-search/locales/pl';

interface SchoolResult extends SearchResult {
  city: string;
  styles: string[];
}

const schema: SchemaAdapter<SchoolResult> = {
  tables: {
    entities: 'schools',
    trigrams: 'school_trigrams',
    fts:      'schools_fts',
    synonyms: 'search_synonyms',
  },
  columns: {
    id:                   'id',
    name:                 'name',
    nameNormalized:       'name_n',
    slug:                 'slug',
    lat:                  'latitude',
    lng:                  'longitude',
    locationSlug:         'city_slug',
    categoriesNormalized: 'styles_n',
    locationNormalized:   'city_n',
    areaNormalized:       'district_n',
  },
  trigramColumns: { trigram: 'trigram', entityId: 'school_id', field: 'field' },
  toResult(row, lat, lng) {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      city: row.city as string,
      styles: JSON.parse((row.styles as string) || '[]'),
      lat: row.latitude as number | null,
      lng: row.longitude as number | null,
      distanceKm: null,
      walkingMin: null,
      score: 0,
    };
  },
  trigramFields(row) {
    return [
      { text: row.name as string, field: 'name' },
      { text: row.city as string, field: 'city' },
    ];
  },
};

const engine = createSearchEngine<SchoolResult>({
  db,               // any client with .execute({ sql, args })
  adapter: schema,
  locale: plLocale, // optional
});

const response = await engine.search({
  query: 'hatha w poblizu',
  lat: 52.229, lng: 21.012,
  limit: 20,
});
```

`response.results` has your primary hits, `response.nearby` has matches just outside the primary radius, and `response.nearestLocationWithEntities` suggests where to look if the user's area has none.

## Schema requirements

The adapter maps onto tables you create. This is the SQLite shape the engine
expects — the same one running in production for a ~700-entity directory:

```sql
-- 1. Normalized shadow columns on your entities table. Populate them with
--    normalize(); the engine matches against these, never the display values.
ALTER TABLE items ADD COLUMN name_n       TEXT;
ALTER TABLE items ADD COLUMN location_n   TEXT;
ALTER TABLE items ADD COLUMN categories_n TEXT;
ALTER TABLE items ADD COLUMN area_n       TEXT;

-- 2. Trigram table for the fuzzy fallback. The composite index is what keeps
--    the `trigram IN (...)` lookup fast — without it the fallback table-scans.
CREATE TABLE item_trigrams (
  trigram TEXT NOT NULL,
  item_id TEXT NOT NULL,
  field   TEXT NOT NULL
);
CREATE INDEX idx_item_trigrams_lookup ON item_trigrams(trigram, field);

-- 3. FTS5 over the normalized columns, external-content so it stores no copy.
--    Column order here is the order ftsColumnWeights expects.
CREATE VIRTUAL TABLE items_fts USING fts5(
  name_n, categories_n, location_n, area_n,
  content='items', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- 4. Synonyms. `category` routes an alias to the right lookup map:
--    'location'/'city' → locationMap, 'category'/'style' → categoryMap.
CREATE TABLE search_synonyms (
  alias     TEXT NOT NULL,
  canonical TEXT NOT NULL,
  category  TEXT NOT NULL,
  PRIMARY KEY (alias, canonical)
);
CREATE INDEX idx_synonyms_alias ON search_synonyms(alias);
```

Keep the FTS table in sync with `AFTER INSERT/UPDATE/DELETE` triggers on the
entities table (use `rowid`, since external-content FTS5 joins on it and your
primary key may be `TEXT`), or call `indexer.rebuildFts()` after bulk writes.

## Dialects

Pick a dialect when you create the engine — defaults to SQLite:

```ts
createSearchEngine({ db, adapter, dialect: 'sqlite' });   // FTS5 + custom trigram tables
createSearchEngine({ db, adapter, dialect: 'postgres' }); // tsvector + pg_trgm
```

On SQLite, you're expected to maintain your own trigram table and FTS5 virtual table — the indexer helps with that. On Postgres, `pg_trgm` handles trigrams automatically; just keep a `tsvector` column updated (via trigger or `indexer.updateSearchVector()`).

## Indexer

The indexer rebuilds trigrams and FTS from your entities table:

```ts
import { createIndexer } from '@nomideusz/svelte-search';

const indexer = createIndexer({ db, adapter: schema, locale: plLocale });

await indexer.indexTrigrams(schoolId, schoolRow); // one entity
await indexer.reindexAllTrigrams();               // full rebuild
await indexer.rebuildFts();                       // SQLite FTS5 rebuild
const stats = await indexer.checkFtsSync();       // diagnose drift
```

On Postgres, `indexTrigrams` and `rebuildFts` are no-ops — use your trigger or `updateSearchVector()` instead.

Full-table scans (`reindexAllTrigrams`, `rebuildAllSearchVectors`, `renormalizeAll`) are paged internally, so they keep working past the point where a single `SELECT *` would exceed a libsql/sqld HTTP response.

> **`checkFtsSync` caveat.** With an external-content FTS5 table (`content='entities'`) its counts read through to the content table, so they stay equal even when the index holds nothing. It catches rows drifting in and out of sync, not an index that was never built. Pair it with the [health canary](#health-canary) below, which probes the real search path instead of counting rows.

## Health canary

Row counts cannot tell you whether search works. `checkFtsSync` compares them,
but on an external-content FTS5 table they stay equal even when the index is
empty, and they say nothing about blank normalized columns or an over-filtering
view. The canary probes the real path instead — sample entities, search for each
by its own name, assert it comes back:

```ts
import { createCanary } from '@nomideusz/svelte-search';

const canary = createCanary({
  db, adapter: schema,
  search: (params) => engine.search(params),
  where: 'is_listed = 1',   // scope: which rows are expected to be findable
  sampleSize: 5,
});

const { sampled, passed, failures, unindexed } = await canary.run();
```

`unindexed` counts in-scope entities whose normalized name is empty — those are
invisible to both FTS and trigram search and cannot even be sampled, so a
non-zero value means indexing broke upstream. Entities whose every name token is
common (`"Studio Jogi Kraków"`) are skipped rather than failed: no healthy index
can single them out by name. Wire it into a health endpoint and alert on
`failures.length > 0 || unindexed > 0`.

## Search parameters

```ts
engine.search({
  query: 'hatha near me',   // raw user input
  locationSlug: 'warsaw',   // restrict to city
  categorySlug: 'hatha',    // restrict to style
  lat: 52.229, lng: 21.012, // user coords for proximity
  limit: 20, offset: 0,
});
```

The engine automatically detects geo intent (`"near me"`, `"blisko"`) and strips it before the FTS/trigram step, then uses the supplied coordinates for proximity sorting. Empty queries with coordinates fall back to pure geo search.

It also drops your locale's stop words before building the FTS query. Terms like `joga` in a yoga directory match nearly every row, and because FTS terms are OR-ed they flatten ranking rather than narrowing it. If stripping would leave the query empty, the stop word is kept and treated as the query.

### Tunables

| Option | Default | Description |
|--------|---------|-------------|
| `ftsTimeoutMs` | `5000` | FTS query timeout (returns empty on overrun) |
| `fuzzyTimeoutMs` | `3000` | Trigram fallback timeout |
| `primaryRadiusKm` | `15` | Max distance for primary results |
| `nearbyRadiusKm` | `30` | Max distance for "also within reach" results |
| `maxNearby` | `5` | Cap on nearby entries |
| `qualityThreshold` | `0.75` | Min Levenshtein similarity for fuzzy-only hits |
| `maxFtsTerms` | `6` | Cap on terms sent to FTS |
| `ftsColumnWeights` | — | Per-column bm25 weights, in FTS column order (SQLite) |

Without `ftsColumnWeights` every FTS column counts equally, so a term repeated
in a long description column outranks an exact name match. Weight name-like
columns high and description-like columns low:

```ts
createSearchEngine({ db, adapter, ftsColumnWeights: [10, 4, 4, 4, 3, 2, 0.5] });
```

## Autocomplete

Autocomplete is app-specific (every app wants different suggestion types: cities, styles, neighborhoods, products, …), so the package exports only the `AutocompleteResult` type — you write the query logic against your tables. A typical shape:

```ts
export interface AutocompleteResult {
  text: string;
  type: string;   // 'school' | 'city' | 'style' | …
  slug?: string;
}
```

## Query resolver

`parseQuery()` classifies tokens into location / category / area / rest using lookup maps you build from your DB. It's the parsing half of a full resolver — apps provide the dispatch rules:

```ts
import { parseQuery, type ResolverLookups } from '@nomideusz/svelte-search';

const lookups: ResolverLookups = {
  locationMap: new Map([['warszawa', 'warsaw'], ['krakow', 'krakow']]),
  categoryMap: new Map([['hatha', 'hatha'], ['vinyasa', 'vinyasa']]),
  areaMap:     new Map([['warsaw', ['mokotow', 'praga']]]),
};

const parsed = parseQuery('hatha w warszawie mokotow', lookups, plLocale);
// {
//   location: { matched: 'warszawie', slug: 'warsaw', original: 'warszawie' },
//   category: { matched: 'hatha',     slug: 'hatha',  original: 'hatha' },
//   rest: ['mokotow'], geoIntent: false, postal: undefined, ...
// }
```

`location` and `category` are match objects, not bare slugs — `matched` is the
token as it appeared (possibly inflected), `slug` is the lookup value. Words
consumed by a multi-word match are removed from `rest`, so a two-word city name
does not come back looking like a street address.

`findMatchingArea()` and `findNearestLocationWithEntities()` are helpers for "did they type a neighborhood?" and "what's the nearest populated city?" resolutions.

## Geo helpers

Pure functions — no DB:

```ts
import {
  haversineKm, walkingMinutes, boundingBox,
  formatDistance, formatWalkingTime, walkingRoute,
} from '@nomideusz/svelte-search';

haversineKm(52.229, 21.012, 50.062, 19.937); // km between Warsaw and Kraków
walkingMinutes(0.8);                         // ~13 (min)
formatDistance(0.85);                        // "850 m"
formatWalkingTime(72);                       // "1 hr 12 min walk"

// Fast SQL pre-filter before exact Haversine:
const bb = boundingBox(52.229, 21.012, 5); // 5 km box
// WHERE lat BETWEEN bb.minLat AND bb.maxLat AND lng BETWEEN bb.minLng AND bb.maxLng

// Optional real walking route via OSRM (self-host for production):
const route = await walkingRoute(52.229, 21.012, 52.237, 21.017);
// { distanceM, durationS } | null

// Times out after 5s by default and returns null rather than hanging the
// caller — the public OSRM instance is rate-limited and best-effort.
await walkingRoute(52.229, 21.012, 52.237, 21.017, 'https://osrm.internal', 2000);
```

## Normalization & similarity

```ts
import {
  normalize, stripDiacriticsGeneric,
  trigrams, trigramSimilarity,
  levenshtein, levenshteinSimilarity,
  isPostcode, findPostcode, hasGeoIntent, stripGeoIntent, stripStopWords,
} from '@nomideusz/svelte-search';

normalize('Łódź, ulica Piotrkowska', plLocale); // 'lodz ulica piotrkowska'
trigrams('hatha');                              // ['hat','ath','tha']
trigramSimilarity('hatha', 'hata');             // 0.25 (Jaccard over trigram sets)
levenshteinSimilarity('vinyasa', 'vinjasa');    // ~0.86
isPostcode('00-001');                           // true (locale-aware)
findPostcode('hatha 30001 krakow');             // { postcode: '30-001', raw: '30001' }
hasGeoIntent('yoga near me');                   // true
stripGeoIntent('yoga near me');                 // 'yoga'
```

## Locales

The package ships a Polish locale handling:

- diacritics (`ą → a`, `ł → l`, `ó → o`, …)
- stop words and phrases (`w`, `na`, `joga`, `szkoła jogi`, …)
- geo-intent patterns (`blisko mnie`, `niedaleko`, `w okolicy`, …)
- nominative-form stemming (`warszawie → warszawa`, `krakowie → krakow`, …)

```ts
import { plLocale } from '@nomideusz/svelte-search/locales/pl';
```

Bring your own locale by implementing the `SearchLocale` interface — `stripDiacritics`, `stopTokens`, `stopPhrases`, `geoPatterns`, and optionally `locationStems`.

With no locale you get generic NFD diacritic stripping, no stop words, and a small built-in set of English geo phrases (`near me`, `nearby`, `around me`, `close to me`, `closest`) so `hasGeoIntent` is useful out of the box. Supplying a locale replaces those patterns rather than merging with them.

`locationStems` matters more than it looks: stems are matched against your `locationMap` keys, so returning a shorter prefix is not enough. The Polish locale returns candidate nominatives (`Katowicach → katowice`, `Gdyni → gdynia`, `Warszawie → warszawa`), over-generating on purpose — candidates that spell nothing simply never match a real key.

`postcodePattern` and `formatPostcode` control postcode detection, used by both `isPostcode()` and the resolver's postcode extraction. The default is the Polish `NN-NNN` form, so set your own outside Poland:

```ts
const ukLocale: SearchLocale = {
  // …
  postcodePattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i,
  formatPostcode: (m) => m[0].toUpperCase().replace(/\s+/g, ' '),
};
```

## Tracking

A minimal analytics helper that fire-and-forgets search events via `navigator.sendBeacon`, never throwing:

```ts
import { createTracker } from '@nomideusz/svelte-search';

const { track } = createTracker({ endpoint: '/api/search-events' });

track({
  query: 'hatha warszawa',
  queryNormalized: 'hatha warszawa',
  page: 'home',
  action: 'filter',
  layer: 'server',
  resultCount: 12,
});
```

A session ID is stored in `sessionStorage` (no PII). The server endpoint shape is up to you.

## Database client interface

Any client with an `execute()` matching this shape works:

```ts
interface DatabaseClient {
  execute(query: { sql: string; args: unknown[] } | string): Promise<{
    rows: Record<string, unknown>[];
    lastInsertRowid?: bigint | number;
  }>;
}
```

libsql's `Client` matches directly. For other drivers, wrap them:

```ts
function wrapClient(client: MyClient): DatabaseClient {
  return {
    execute: (query) => typeof query === 'string'
      ? client.execute(query)
      : client.execute({ sql: query.sql, args: query.args as any }),
  };
}
```

## Development

```bash
pnpm install
pnpm dev             # SvelteKit dev server (demo)
pnpm check           # Typecheck
pnpm test            # Vitest
pnpm run package     # Build the library
```

## License

MIT
