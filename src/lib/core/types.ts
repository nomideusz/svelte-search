// ============================================================
// @nomideusz/svelte-search — Core types
// ============================================================
// Generic search types. Apps provide a SchemaAdapter to map
// their DB schema to these interfaces.

// ── Database client interface ──────────────────────────────
// Subset of @libsql/client's Client. Any SQL client that
// implements execute() works (libsql, better-sqlite3, etc.)

/** SQL dialect for query generation. */
export type SqlDialect = 'sqlite' | 'postgres';

export interface DatabaseClient {
  execute(query: { sql: string; args: unknown[] } | string): Promise<{
    rows: Record<string, unknown>[];
    lastInsertRowid?: bigint | number;
  }>;
}

// ── Schema adapter ─────────────────────────────────────────
// Maps your DB schema to the generic search engine.

export interface SchemaAdapter<TResult extends SearchResult = SearchResult> {
  /** Table names in your database */
  tables: {
    /** Main entities table (e.g. "schools", "tours", "listings") */
    entities: string;
    /** Trigram index table (e.g. "school_trigrams", "tour_trigrams") */
    trigrams: string;
    /** FTS5 virtual table (e.g. "schools_fts", "tours_fts") */
    fts: string;
    /** Synonyms table (e.g. "search_synonyms") */
    synonyms: string;
  };

  /** Column names in the entities table */
  columns: {
    /** Primary key column */
    id: string;
    /** Display name column */
    name: string;
    /** Normalized name column (for matching) */
    nameNormalized: string;
    /** URL slug column */
    slug: string;
    /** Latitude column (null if no geo) */
    lat: string | null;
    /** Longitude column (null if no geo) */
    lng: string | null;
    /** Location slug column (e.g. "city_slug", "destination_slug") */
    locationSlug: string | null;
    /** Normalized categories column (e.g. "styles_n", "categories_n") */
    categoriesNormalized: string | null;
    /** Normalized location name (e.g. "city_n", "destination_n") */
    locationNormalized: string | null;
    /** Normalized district/area column (e.g. "district_n", "area_n") */
    areaNormalized: string | null;
  };

  /** Trigram table columns */
  trigramColumns: {
    /** Trigram value column */
    trigram: string;
    /** Foreign key to entity */
    entityId: string;
    /** Field name column (e.g. "name", "city", "style") */
    field: string;
  };

  /** Convert a raw DB row to a typed SearchResult */
  toResult(row: Record<string, unknown>, lat?: number, lng?: number): TResult;

  /** Fields to extract trigrams from when indexing an entity */
  trigramFields(entity: Record<string, unknown>): Array<{ text: string | null | undefined; field: string }>;
}

// ── Search types ───────────────────────────────────────────

export interface SearchParams {
  /** User's search query */
  query: string;
  /** Restrict to this location slug (e.g. city) */
  locationSlug?: string;
  /** Restrict to this category slug (e.g. style) */
  categorySlug?: string;
  /** User's latitude for geo proximity */
  lat?: number;
  /** User's longitude for geo proximity */
  lng?: number;
  /** Max results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface SearchResult {
  id: string;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  walkingMin: number | null;
  score: number;
  /** @internal FTS match flag for quality gate */
  _hasFts?: boolean;
  /** @internal Normalized name for quality check */
  _nameN?: string;
  /** @internal Normalized location for quality check */
  _locationN?: string;
  /** @internal Normalized categories for quality check */
  _categoriesN?: string;
}

export interface SearchResponse<TResult extends SearchResult = SearchResult> {
  /** Primary results (within relevance boundary) */
  results: TResult[];
  /** "Also within reach" results (just outside primary radius) */
  nearby: TResult[];
  /** True if we had location intent but found nothing nearby */
  noLocalResults: boolean;
  /** The place the user searched for */
  searchedPlace: string | null;
  /** Nearest location that has entities (when noLocalResults=true) */
  nearestLocationWithEntities: { name: string; slug: string; distanceKm: number; count: number } | null;
  /** Total matched before pagination */
  totalFound: number;
}

// ── Autocomplete types ─────────────────────────────────────

export interface AutocompleteResult {
  text: string;
  type: string;  // app-defined: 'school' | 'city' | 'style' | 'tour' | etc.
  slug?: string;
}

// ── Locale types ───────────────────────────────────────────

export interface SearchLocale {
  /** Strip diacritics specific to this locale */
  stripDiacritics(text: string): string;
  /** Stop words to remove from queries */
  stopTokens: Set<string>;
  /** Multi-word stop phrases (checked before single tokens) */
  stopPhrases: string[];
  /** Geo intent patterns (e.g. "near me", "blisko") */
  geoPatterns: RegExp[];
  /** Stem location names to nominative form. Returns [original, ...stems] */
  locationStems?(token: string): string[];
}

// ── Resolver types ─────────────────────────────────────────

export interface ResolverContext {
  page: string;
  [key: string]: unknown;
}

export interface ResolverLookups {
  /** Normalized location name → slug */
  locationMap: Map<string, string>;
  /** Normalized category name/alias → slug */
  categoryMap: Map<string, string>;
  /** locationSlug → list of normalized area/district names */
  areaMap: Map<string, string[]>;
  /** locationSlug → entity count */
  locationEntityCount?: Map<string, number>;
  /** locationSlug → { lat, lng, name } */
  locationGeo?: Map<string, { lat: number; lng: number; name: string }>;
}

export type ResolverAction =
  | { action: 'route_to_location'; locationSlug: string; categoryFilter?: string }
  | { action: 'route_to_category'; categorySlug: string; locationFilter?: string }
  | { action: 'route_to_entity'; entitySlug: string }
  | { action: 'filter'; query: string }
  | { action: 'filter_area'; area: string }
  | { action: 'filter_postcode'; postcode: string; filter?: string }
  | { action: 'sort_by_distance'; filter?: string }
  | { action: 'show_all' }
  | { action: 'location_switch_prompt'; targetName: string; targetSlug: string; categoryFilter?: string; address?: string }
  | { action: 'already_here' }
  | { action: 'needs_server'; query: string }
  | { action: 'geocode_address'; address: string; locationSlug: string };

// ── Tracking types ─────────────────────────────────────────

export interface TrackSearchEvent {
  query: string;
  queryNormalized?: string;
  page: string;
  locationContext?: string;
  action: string;
  layer?: 'client' | 'server' | 'google' | 'none';
  resultCount?: number;
  clickedType?: string;
  clickedId?: string;
}
