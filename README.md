# @nomideusz/svelte-search

A full-text search engine for Svelte 5 apps backed by your own database. Combines FTS5 (SQLite) or `tsvector` (PostgreSQL) with trigram fuzzy matching, geo proximity, synonym expansion, and a pluggable schema adapter. Ships with a Polish locale that handles diacritics, stop words, and locative-case stemming.

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
// { location: 'warsaw', category: 'hatha', rest: ['mokotow'], geoIntent: false, ... }
```

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
```

## Normalization & similarity

```ts
import {
  normalize, stripDiacriticsGeneric,
  trigrams, trigramSimilarity,
  levenshtein, levenshteinSimilarity,
  isPostcode, hasGeoIntent, stripGeoIntent, stripStopWords,
} from '@nomideusz/svelte-search';

normalize('Łódź, ulica Piotrkowska', plLocale); // 'lodz ulica piotrkowska'
trigrams('hatha');                              // ['hat','ath','tha']
trigramSimilarity('hatha', 'hata');             // ~0.67
levenshteinSimilarity('vinyasa', 'vinjasa');    // ~0.86
isPostcode('00-001');                           // true
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

Bring your own locale by implementing the `SearchLocale` interface — `stripDiacritics`, `stopTokens`, `stopPhrases`, `geoPatterns`, and optionally `locationStems`. No locale = generic NFD diacritic stripping and no stop words.

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
