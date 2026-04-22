// ============================================================
// @nomideusz/svelte-search — Search engine
// ============================================================
// Generic search engine driven by a SchemaAdapter. Handles:
//   1. Synonym expansion
//   2. Full-text search (FTS5 for SQLite, tsvector for PostgreSQL)
//   3. Trigram fuzzy fallback (custom tables for SQLite, pg_trgm for PostgreSQL)
//   4. Score blending (FTS rank + name similarity + field match + geo)
//   5. Quality gate (Levenshtein threshold for fuzzy-only results)
//   6. Relevance boundaries (distance-based result splitting)
//
// Dialect support:
//   - 'sqlite' (default): FTS5 MATCH, custom trigram tables, rowid joins
//   - 'postgres': tsvector/tsquery @@, pg_trgm similarity(), PK joins

import type { DatabaseClient, SchemaAdapter, SearchParams, SearchResult, SearchResponse, SearchLocale, SqlDialect } from './types.js';
import { normalize, trigrams, trigramSimilarity, levenshteinSimilarity, hasGeoIntent, stripGeoIntent } from './normalize.js';
import { haversineKm, walkingMinutes, boundingBox } from './geo.js';

// ── Configuration ──────────────────────────────────────────

export interface SearchEngineConfig<TResult extends SearchResult = SearchResult> {
  db: DatabaseClient;
  adapter: SchemaAdapter<TResult>;
  locale?: SearchLocale;
  /** SQL dialect: 'sqlite' (default) or 'postgres' */
  dialect?: SqlDialect;
  /** FTS query timeout in ms (default: 5000) */
  ftsTimeoutMs?: number;
  /** Fuzzy query timeout in ms (default: 3000) */
  fuzzyTimeoutMs?: number;
  /** Primary result radius in km (default: 15) */
  primaryRadiusKm?: number;
  /** Nearby result radius in km (default: 30) */
  nearbyRadiusKm?: number;
  /** Max nearby results in response (default: 5) */
  maxNearby?: number;
  /** Quality gate threshold for fuzzy-only results (default: 0.75) */
  qualityThreshold?: number;
  /** Max FTS terms per query (default: 6) */
  maxFtsTerms?: number;
}

// ── Query timeout helper ───────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer!));
}

// ── Placeholder helpers ────────────────────────────────────

/** Returns $1, $2, ... for postgres or ?, ?, ... for sqlite */
function placeholders(count: number, dialect: SqlDialect, startAt = 1): string {
  if (dialect === 'postgres') {
    return Array.from({ length: count }, (_, i) => `$${startAt + i}`).join(',');
  }
  return Array(count).fill('?').join(',');
}

/** Returns the next placeholder: $N for postgres, ? for sqlite */
function ph(index: number, dialect: SqlDialect): string {
  return dialect === 'postgres' ? `$${index}` : '?';
}

// ── Create search engine ───────────────────────────────────

export function createSearchEngine<TResult extends SearchResult = SearchResult>(
  config: SearchEngineConfig<TResult>
) {
  const {
    db, adapter, locale,
    dialect = 'sqlite',
    ftsTimeoutMs = 5000,
    fuzzyTimeoutMs = 3000,
    primaryRadiusKm = 15,
    nearbyRadiusKm = 30,
    maxNearby = 5,
    qualityThreshold = 0.75,
    maxFtsTerms = 6,
  } = config;

  const { tables, columns, trigramColumns } = adapter;

  // ── Main search ────────────────────────────────────────

  async function search(params: SearchParams): Promise<SearchResponse<TResult>> {
    const { query, locationSlug, categorySlug, lat, lng, limit = 20, offset = 0 } = params;

    if (!query?.trim()) {
      if (locationSlug) return searchAllInLocation(locationSlug, categorySlug, lat, lng, limit);
      if (lat != null && lng != null) return geoOnlySearch(lat, lng, limit);
      return empty();
    }

    // Normalize + strip geo intent
    const geoIntent = hasGeoIntent(query, locale);
    const cleanQuery = geoIntent ? stripGeoIntent(query, locale) : query;
    const normalized = normalize(cleanQuery, locale);

    if (geoIntent && !normalized) {
      if (locationSlug) return searchAllInLocation(locationSlug, categorySlug, lat, lng, limit);
      if (lat != null && lng != null) return geoOnlySearch(lat, lng, limit);
      return empty();
    }

    // Expand synonyms
    const expanded = await expandSynonyms(normalized);
    const ftsQuery = buildFtsQuery(expanded);

    // Full-text search
    const ftsResults = await withTimeout(
      ftsSearch(ftsQuery, locationSlug, categorySlug, limit * 3),
      ftsTimeoutMs, [],
    );

    // Trigram fallback if FTS returned few results
    let fuzzyResults: Record<string, unknown>[] = [];
    if (ftsResults.length < 5 && normalized.length >= 3) {
      fuzzyResults = await withTimeout(
        trigramFuzzySearch(normalized, locationSlug, limit * 2),
        fuzzyTimeoutMs, [],
      );
    }

    // Merge, score, and rank
    const merged = deduplicateById([...ftsResults, ...fuzzyResults]);
    const scored = scoreResults(merged, normalized, lat, lng, geoIntent);

    // Quality gate — fuzzy-only results need high Levenshtein similarity
    const qualified = scored.filter(r => {
      if (r._hasFts) return true;
      const best = Math.max(
        levenshteinSimilarity(normalized, r._nameN || '', locale),
        levenshteinSimilarity(normalized, r._locationN || '', locale),
        levenshteinSimilarity(normalized, r._categoriesN || '', locale),
      );
      return best >= qualityThreshold;
    });
    qualified.sort((a, b) => b.score - a.score);

    return applyRelevanceBoundaries(qualified, lat, lng, locationSlug, normalized, limit, offset);
  }

  // ── Location-scoped search ─────────────────────────────

  async function searchAllInLocation(
    locationSlug: string, categorySlug: string | undefined,
    lat: number | undefined, lng: number | undefined, limit: number
  ): Promise<SearchResponse<TResult>> {
    const args: unknown[] = [locationSlug];
    let argIdx = 2;

    let sql = `SELECT * FROM ${tables.entities} WHERE ${columns.locationSlug} = ${ph(1, dialect)}`;

    if (categorySlug && columns.categoriesNormalized) {
      const catName = normalize(categorySlug.replace(/-/g, ' '), locale);
      sql += ` AND ${columns.categoriesNormalized} LIKE ${ph(argIdx++, dialect)}`;
      args.push(`%${catName}%`);
    }
    sql += ` LIMIT ${ph(argIdx, dialect)}`;
    args.push(limit);

    const result = await db.execute({ sql, args });
    const rows = (result.rows).map(r => adapter.toResult(r, lat, lng));

    if (lat != null && lng != null) {
      rows.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    }
    return { results: rows, nearby: [], noLocalResults: false, searchedPlace: null, nearestLocationWithEntities: null, totalFound: rows.length };
  }

  // ── Geo-only search ────────────────────────────────────

  async function geoOnlySearch(
    lat: number, lng: number, limit: number
  ): Promise<SearchResponse<TResult>> {
    if (!columns.lat || !columns.lng) return empty();
    const bbox = boundingBox(lat, lng, primaryRadiusKm);
    const result = await db.execute({
      sql: `SELECT * FROM ${tables.entities} WHERE ${columns.lat} BETWEEN ${ph(1, dialect)} AND ${ph(2, dialect)} AND ${columns.lng} BETWEEN ${ph(3, dialect)} AND ${ph(4, dialect)} LIMIT ${ph(5, dialect)}`,
      args: [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, limit * 2],
    });
    const rows = (result.rows).map(r => adapter.toResult(r, lat, lng));
    rows.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    const capped = rows.slice(0, limit);

    if (capped.length === 0) {
      return { results: [], nearby: [], noLocalResults: true, searchedPlace: null, nearestLocationWithEntities: null, totalFound: 0 };
    }
    return { results: capped, nearby: [], noLocalResults: false, searchedPlace: null, nearestLocationWithEntities: null, totalFound: capped.length };
  }

  // ── Full-text search ───────────────────────────────────

  async function ftsSearch(
    ftsQuery: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    if (!ftsQuery) return [];

    if (dialect === 'postgres') {
      return ftsSearchPostgres(ftsQuery, locationSlug, categorySlug, limit);
    }
    return ftsSearchSqlite(ftsQuery, locationSlug, categorySlug, limit);
  }

  async function ftsSearchSqlite(
    ftsQuery: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    let sql = `
      SELECT s.*, fts.rank AS _ftsRank
      FROM ${tables.fts} fts
      JOIN ${tables.entities} s ON s.rowid = fts.rowid
      WHERE ${tables.fts} MATCH ?
    `;
    const args: unknown[] = [ftsQuery];

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ?`;
      args.push(locationSlug);
    }
    if (categorySlug && columns.categoriesNormalized) {
      const catName = normalize(categorySlug.replace(/-/g, ' '), locale);
      sql += ` AND s.${columns.categoriesNormalized} LIKE ?`;
      args.push(`%${catName}%`);
    }
    sql += ' ORDER BY fts.rank LIMIT ?';
    args.push(limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  async function ftsSearchPostgres(
    ftsQuery: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    // PostgreSQL: use tsvector column + tsquery
    // The FTS table name is used as the tsvector column name on the entities table
    const tsCol = tables.fts; // e.g. "search_vector"
    const args: unknown[] = [ftsQuery];
    let argIdx = 2;

    let sql = `
      SELECT s.*, ts_rank(s.${tsCol}, to_tsquery('simple', ${ph(1, dialect)})) AS "_ftsRank"
      FROM ${tables.entities} s
      WHERE s.${tsCol} @@ to_tsquery('simple', ${ph(1, dialect)})
    `;

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ${ph(argIdx, dialect)}`;
      args.push(locationSlug);
      argIdx++;
    }
    if (categorySlug && columns.categoriesNormalized) {
      const catName = normalize(categorySlug.replace(/-/g, ' '), locale);
      sql += ` AND s.${columns.categoriesNormalized} ILIKE ${ph(argIdx, dialect)}`;
      args.push(`%${catName}%`);
      argIdx++;
    }
    sql += ` ORDER BY "_ftsRank" DESC LIMIT ${ph(argIdx, dialect)}`;
    args.push(limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  // ── Trigram fuzzy search ───────────────────────────────

  async function trigramFuzzySearch(
    normalized: string, locationSlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    if (dialect === 'postgres') {
      return trigramFuzzyPostgres(normalized, locationSlug, limit);
    }
    return trigramFuzzySqlite(normalized, locationSlug, limit);
  }

  async function trigramFuzzySqlite(
    normalized: string, locationSlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    const queryTrigrams = trigrams(normalized, locale);
    if (queryTrigrams.length === 0) return [];

    const phs = queryTrigrams.map(() => '?').join(',');
    let sql = `
      SELECT s.*, NULL AS _ftsRank,
             (COUNT(DISTINCT t.${trigramColumns.trigram}) * 1.0 / ?) AS _fuzzyScore
      FROM ${tables.trigrams} t
      JOIN ${tables.entities} s ON s.${columns.id} = t.${trigramColumns.entityId}
      WHERE t.${trigramColumns.trigram} IN (${phs})
    `;
    const args: unknown[] = [queryTrigrams.length, ...queryTrigrams];

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ?`;
      args.push(locationSlug);
    }

    const minOverlap = queryTrigrams.length <= 3
      ? Math.max(1, queryTrigrams.length - 1)
      : Math.max(2, Math.ceil(queryTrigrams.length * 0.45));
    sql += ` GROUP BY t.${trigramColumns.entityId} HAVING COUNT(DISTINCT t.${trigramColumns.trigram}) >= ? ORDER BY _fuzzyScore DESC LIMIT ?`;
    args.push(minOverlap, limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  async function trigramFuzzyPostgres(
    normalized: string, locationSlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    // PostgreSQL: use pg_trgm extension's similarity() function
    // Searches against the nameNormalized column (primary) and optionally others
    const args: unknown[] = [normalized];
    let argIdx = 2;

    // Build similarity expression across searchable text columns
    const simCols = [columns.nameNormalized];
    if (columns.categoriesNormalized) simCols.push(columns.categoriesNormalized);
    if (columns.locationNormalized) simCols.push(columns.locationNormalized);

    const simExpr = simCols.length === 1
      ? `similarity(${simCols[0]}, ${ph(1, dialect)})`
      : `GREATEST(${simCols.map(c => `similarity(COALESCE(${c}, ''), ${ph(1, dialect)})`).join(', ')})`;

    let sql = `
      SELECT s.*, NULL AS "_ftsRank", ${simExpr} AS "_fuzzyScore"
      FROM ${tables.entities} s
      WHERE ${simExpr} > 0.1
    `;

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ${ph(argIdx, dialect)}`;
      args.push(locationSlug);
      argIdx++;
    }

    sql += ` ORDER BY "_fuzzyScore" DESC LIMIT ${ph(argIdx, dialect)}`;
    args.push(limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  // ── Synonym expansion ──────────────────────────────────

  async function expandSynonyms(normalized: string): Promise<string[]> {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const expanded: string[] = [...tokens];

    const aliases: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      aliases.push(`${tokens[i]} ${tokens[i + 1]}`);
    }

    if (aliases.length > 0) {
      const phs = placeholders(aliases.length, dialect);
      const result = await db.execute({
        sql: `SELECT canonical FROM ${tables.synonyms} WHERE alias IN (${phs})`,
        args: aliases,
      });
      for (const row of result.rows) {
        const canonical = row.canonical as string;
        if (!expanded.includes(canonical)) expanded.push(canonical);
      }
    }

    return expanded;
  }

  // ── FTS query builder ──────────────────────────────────

  function buildFtsQuery(tokens: string[]): string {
    const terms = tokens
      .map(t => t.replace(/['"(){}*:^~\-!&|<>]/g, ''))
      .filter(Boolean)
      .slice(0, maxFtsTerms);

    if (terms.length === 0) return '';

    if (dialect === 'postgres') {
      // PostgreSQL tsquery: term1:* | term2:*
      return terms.map(t => `${t}:*`).join(' | ');
    }
    // SQLite FTS5: "term1"* OR "term2"*
    const fts5Terms = terms.map(t => `"${t}"*`);
    return fts5Terms.length === 1 ? fts5Terms[0] : fts5Terms.join(' OR ');
  }

  // ── Scoring ────────────────────────────────────────────

  function scoreResults(
    rows: Record<string, unknown>[], normalized: string,
    lat: number | undefined, lng: number | undefined,
    geoBoost: boolean
  ): TResult[] {
    return rows.map(row => {
      const result = adapter.toResult(row, lat, lng);
      let score = 0;

      // FTS rank
      const ftsRank = row._ftsRank as number | null;
      if (ftsRank != null) {
        if (dialect === 'postgres') {
          // PostgreSQL ts_rank returns positive values, higher = better
          score += Math.min(1, ftsRank) * 0.40;
        } else {
          // SQLite FTS5 rank is negative, lower = better
          score += Math.min(1, Math.max(0, -ftsRank / 20)) * 0.40;
        }
      }
      // Name similarity
      score += Math.max(
        trigramSimilarity(normalized, result._nameN || '', locale),
        levenshteinSimilarity(normalized, result._nameN || '', locale)
      ) * 0.25;
      // Field match (categories/location/area)
      score += Math.max(
        trigramSimilarity(normalized, result._categoriesN || '', locale),
        trigramSimilarity(normalized, result._locationN || '', locale),
      ) * 0.15;
      // Fuzzy score from trigram search
      const fuzzyScore = row._fuzzyScore as number | null;
      if (fuzzyScore != null) score += fuzzyScore * 0.30;

      // Geo proximity
      if (lat != null && lng != null && result.lat != null && result.lng != null) {
        const distanceKm = haversineKm(lat, lng, result.lat, result.lng);
        result.distanceKm = distanceKm;
        result.walkingMin = walkingMinutes(distanceKm);
        const proxScore = Math.max(0, 1 - distanceKm / 30);
        score += proxScore * 0.15;
        if (geoBoost) score += proxScore * 0.25;
      }

      result.score = score;
      result._hasFts = ftsRank != null;
      return result;
    });
  }

  // ── Relevance boundaries ───────────────────────────────

  async function applyRelevanceBoundaries(
    scored: TResult[],
    lat: number | undefined, lng: number | undefined,
    locationSlug: string | undefined,
    searchedPlace: string | null,
    limit: number, offset: number
  ): Promise<SearchResponse<TResult>> {
    if (locationSlug) {
      const capped = stripInternal(scored.slice(offset, offset + limit));
      return {
        results: capped, nearby: [], noLocalResults: capped.length === 0,
        searchedPlace, nearestLocationWithEntities: null,
        totalFound: scored.length,
      };
    }

    if (lat == null || lng == null) {
      const capped = stripInternal(scored.slice(offset, offset + limit));
      return {
        results: capped, nearby: [], noLocalResults: capped.length === 0,
        searchedPlace, nearestLocationWithEntities: null,
        totalFound: scored.length,
      };
    }

    const primary: TResult[] = [];
    const nearby: TResult[] = [];

    for (const r of scored) {
      if (r.distanceKm == null) { primary.push(r); continue; }
      if (r.distanceKm <= primaryRadiusKm) primary.push(r);
      else if (r.distanceKm <= nearbyRadiusKm) nearby.push(r);
    }

    if (primary.length === 0 && nearby.length === 0) {
      return {
        results: [], nearby: [], noLocalResults: true,
        searchedPlace, nearestLocationWithEntities: null,
        totalFound: 0,
      };
    }

    return {
      results: stripInternal(primary.slice(offset, offset + limit)),
      nearby: stripInternal(nearby.slice(0, maxNearby)),
      noLocalResults: false, searchedPlace,
      nearestLocationWithEntities: null,
      totalFound: primary.length + nearby.length,
    };
  }

  // ── Helpers ────────────────────────────────────────────

  function stripInternal(results: TResult[]): TResult[] {
    return results.map(r => {
      const { _hasFts, _nameN, _locationN, _categoriesN, ...rest } = r as SearchResult & Record<string, unknown>;
      return rest as unknown as TResult;
    });
  }

  function deduplicateById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const seen = new Set<unknown>();
    return rows.filter(r => {
      const id = r[columns.id];
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function empty(): SearchResponse<TResult> {
    return { results: [], nearby: [], noLocalResults: false, searchedPlace: null, nearestLocationWithEntities: null, totalFound: 0 };
  }

  return { search };
}
