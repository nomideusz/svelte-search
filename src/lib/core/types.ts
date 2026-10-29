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
    /** Trigram index table — only for the 'trigram-table' fuzzy strategy */
    trigrams?: string;
    /**
     * SQLite: the FTS5 virtual table (e.g. "schools_fts"). Postgres: the
     * tsvector column on the entities table (e.g. "search_vector").
     */
    fts: string;
    /**
     * Synonyms table with `alias` and `canonical` columns (a view works for
     * other names). Optional: without it no synonym lookup runs.
     */
    synonyms?: string;
  };

  /**
   * Postgres-only: per-field tsvector parts used to rank full-text matches by
   * token coverage instead of ts_rank. ts_rank is dominated by term
   * frequency — a keyword-stuffed name ("pilates" ×4) outranks an exact
   * two-token name — while the SQLite path's bm25 rewards rarity and
   * saturates repetition. Each part is a SQL expression over the entity row
   * (alias `s.`, normalized columns) that the engine folds into a vector and
   * scores as weight × tokens-matched / token-count. When absent, the pg
   * path keeps plain ts_rank.
   */
  ftsParts?: { /** SQL expression over the entity row, e.g. "coalesce(s.name_n, '')" */ expr: string; /** Field weight, mirroring ftsColumnWeights for SQLite */ weight: number }[];

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

  /** Trigram table columns — only for the 'trigram-table' fuzzy strategy */
  trigramColumns?: {
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

  /**
   * Fields the full-text vector is built over (postgres tsvector rebuild).
   * Order matters: whatever maintains the vector (trigger or rebuild) must
   * concatenate exactly these texts in this order. Falls back to
   * trigramFields when absent.
   */
  ftsFields?(entity: Record<string, unknown>): Array<{ text: string | null | undefined; field: string }>;

  /**
   * Per-field tsvector weight ('A'..'D') for the postgres vector rebuild —
   * the ts_rank equivalent of the sqlite bm25 ftsColumnWeights. Unweighted
   * vectors let a description mention outrank an exact name match. Fields
   * mapped to undefined go into the vector unweighted. Without this hook the
   * rebuild stays unweighted (the pre-hook behavior).
   */
  ftsWeight?(field: string): 'A' | 'B' | 'C' | 'D' | undefined;
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
  // Set by your mapRow, read by the quality gate, stripped before results
  // leave search().
  /** Did full text match this row? (`row._ftsRank != null`) */
  _hasFts?: boolean;
  /** Normalized name, for the typo check of fuzzy-only rows */
  _nameN?: string;
  /** Normalized location, for the typo check */
  _locationN?: string;
  /** Normalized categories, for the typo check */
  _categoriesN?: string;
}

export interface SearchResponse<TResult extends SearchResult = SearchResult> {
  /** Primary results (within relevance boundary) */
  results: TResult[];
  /** "Also within reach" results (just outside primary radius) */
  nearby: TResult[];
  /** True if we had location intent but found nothing nearby */
  noLocalResults: boolean;
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
  /**
   * Postcode pattern for this locale, matched anywhere in the query (use `\b`
   * bounds). Without one, postcode detection is off. Examples:
   *   PL      /\b(\d{2})-?(\d{3})\b/   (plLocale)
   *   UK      /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i
   *   US ZIP  /\b\d{5}(?:-\d{4})?\b/
   *   DE/FR   /\b\d{5}\b/
   */
  postcodePattern?: RegExp;
  /**
   * Canonical form of a postcode match. Defaults to joining the first two
   * capture groups with a hyphen (so with plLocale "30001" becomes "30-001"),
   * or the raw match when the pattern has no groups.
   */
  formatPostcode?(match: RegExpMatchArray): string;
}

// ── Resolver types ─────────────────────────────────────────

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

// ── Tracking types ─────────────────────────────────────────

export interface TrackSearchEvent {
  query: string;
  queryNormalized?: string;
  page: string;
  locationContext?: string;
  action: string;
  /** Which layer answered, e.g. 'client' | 'server' — app-defined */
  layer?: string;
  resultCount?: number;
  clickedType?: string;
  clickedId?: string;
}
