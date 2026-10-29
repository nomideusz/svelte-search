// ============================================================
// @nomideusz/svelte-search — Search engine
// ============================================================
// Generic search engine driven by a SchemaAdapter. Handles:
//   1. Synonym expansion
//   2. Full-text search (FTS5 for SQLite, tsvector for PostgreSQL)
//   3. Trigram fuzzy fallback (custom tables for SQLite, pg_trgm or the
//      ported custom table for PostgreSQL — see `fuzzy`)
//   4. Score blending (FTS rank + name similarity + field match + geo)
//   5. Quality gate (Levenshtein threshold for fuzzy-only results)
//   6. Relevance boundaries (distance-based result splitting)
//
// Dialect support:
//   - 'sqlite' (default): FTS5 MATCH, custom trigram tables, rowid joins
//   - 'postgres': tsvector/tsquery @@, pg_trgm similarity(), PK joins

import type { DatabaseClient, SchemaAdapter, SearchParams, SearchResult, SearchResponse, SearchLocale, SqlDialect } from './types.js';
import { normalize, trigrams, trigramSimilarity, levenshteinSimilarity, bestWordSimilarity, hasGeoIntent, stripGeoIntent, stripStopWords } from './normalize.js';
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
  /**
   * Distance cutoff, opt-in. When set and a search carries lat/lng but no
   * locationSlug, results within this radius are `results`, those out to
   * nearbyRadiusKm are `nearby`, and the rest are dropped; geo-only searches
   * stay inside it. Unset, distance only boosts the score and fills distanceKm.
   */
  primaryRadiusKm?: number;
  /** Outer radius for `nearby` results (default: 2 × primaryRadiusKm) */
  nearbyRadiusKm?: number;
  /** Max nearby results in response (default: 5) */
  maxNearby?: number;
  /** Quality gate threshold for fuzzy-only results (default: 0.75) */
  qualityThreshold?: number;
  /** Max FTS terms per query (default: 6) */
  maxFtsTerms?: number;
  /**
   * Rows each full-text and fuzzy pass fetches before scoring (default: 200,
   * or `limit * 3` when larger). Results are ranked in JS, so this pool must
   * not depend on `offset` — otherwise every page ranks a different pool and
   * pages overlap or skip rows. Results past the pool are unreachable;
   * `totalFound` counts within it.
   */
  maxCandidates?: number;
  /**
   * Per-column bm25 weights for FTS ranking, in FTS table column order
   * (SQLite only). Without this, all columns weigh equally — a term repeated
   * in a long description outranks an exact name match. Weight name-like
   * columns high and description-like columns low.
   */
  ftsColumnWeights?: number[];
  /**
   * Fuzzy fallback strategy. 'trigram-table' joins the custom trigram table
   * (SQLite default; on postgres the mechanically ported table).
   * 'pg-trgm' uses the pg_trgm extension's similarity() (postgres default).
   * 'none' is full-text only — no trigram table or extension needed.
   */
  fuzzy?: FuzzyStrategy;
}

export type FuzzyStrategy = 'trigram-table' | 'pg-trgm' | 'none';

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
    primaryRadiusKm,
    nearbyRadiusKm = primaryRadiusKm != null ? primaryRadiusKm * 2 : undefined,
    maxNearby = 5,
    qualityThreshold = 0.75,
    maxFtsTerms = 6,
    maxCandidates = 200,
    ftsColumnWeights,
    fuzzy,
  } = config;

  const { tables, columns, trigramColumns } = adapter;

  // 'trigram-table' works on both dialects (the ported custom table on pg);
  // 'pg-trgm' is the postgres-native path. Defaults preserve the behavior
  // each dialect had before the flag existed.
  const fuzzyStrategy = fuzzy ?? (dialect === 'postgres' ? 'pg-trgm' : 'trigram-table');
  if (fuzzyStrategy === 'trigram-table' && (!tables.trigrams || !trigramColumns)) {
    throw new Error(
      "svelte-search: fuzzy 'trigram-table' (the SQLite default) needs adapter.tables.trigrams " +
      "and adapter.trigramColumns — or pass fuzzy: 'none' for full-text only",
    );
  }

  // ── Main search ────────────────────────────────────────

  async function search(params: SearchParams): Promise<SearchResponse<TResult>> {
    const { query, locationSlug, categorySlug, lat, lng, limit = 20, offset = 0 } = params;
    const pool = Math.max(maxCandidates, limit * 3);

    if (!query?.trim()) {
      if (locationSlug) return searchAllInLocation(locationSlug, categorySlug, lat, lng, limit, offset);
      if (lat != null && lng != null) return geoOnlySearch(lat, lng, limit, offset);
      return empty();
    }

    // Normalize + strip geo intent
    const geoIntent = hasGeoIntent(query, locale);
    const cleanQuery = geoIntent ? stripGeoIntent(query, locale) : query;
    const raw = normalize(cleanQuery, locale);

    if (geoIntent && !raw) {
      if (locationSlug) return searchAllInLocation(locationSlug, categorySlug, lat, lng, limit, offset);
      if (lat != null && lng != null) return geoOnlySearch(lat, lng, limit, offset);
      return empty();
    }

    // Stop words carry no signal ("joga" in a yoga directory) but OR into the
    // FTS query and match nearly every row, diluting rank. Drop them — unless
    // that leaves nothing, in which case the stop word IS the query.
    const normalized = stripStopWords(raw, locale) || raw;

    // Expand synonyms
    const expanded = await expandSynonyms(normalized);
    const ftsTerms = buildFtsTerms(expanded);
    const ftsQuery = buildFtsQuery(ftsTerms);

    // Full-text search
    const ftsResults = await withTimeout(
      ftsSearch(ftsQuery, ftsTerms, locationSlug, categorySlug, pool),
      ftsTimeoutMs, [],
    );

    // Trigram fallback if FTS returned few results
    let fuzzyResults: Record<string, unknown>[] = [];
    if (ftsResults.length < 5 && normalized.length >= 3) {
      fuzzyResults = await withTimeout(
        trigramFuzzySearch(normalized, locationSlug, categorySlug, pool),
        fuzzyTimeoutMs, [],
      );
    }

    // Per-term fuzziness. FTS terms are OR-ed, so one term that matches plenty
    // ("gdansk") fills the quota above while a misspelled sibling ("vinjasa")
    // matches nothing and silently drops out of the query. A term no FTS row
    // carries is treated as a typo and gets its own fuzzy pass — recall here,
    // its weight in scoreResults.
    const words = normalized.split(' ').filter(w => w.length >= 3);
    const typoTerms = words.length > 1
      ? words.filter(w => !ftsResults.some(r => rowHasWordPrefix(r, w))).slice(0, 2)
      : [];
    const typoResults = await Promise.all(typoTerms.map(term => withTimeout(
      trigramFuzzySearch(term, locationSlug, categorySlug, pool, true),
      fuzzyTimeoutMs, [],
    )));
    fuzzyResults.push(...typoResults.flat());

    // Merge, score, and rank
    const merged = deduplicateById([...ftsResults, ...fuzzyResults]);
    const scored = scoreResults(merged, normalized, lat, lng, geoIntent, typoTerms);

    // Quality gate — fuzzy-only results need high Levenshtein similarity.
    // Per-word: a typo of one word in a multi-word name ("triranta" for
    // "Triratna Warszawa ...") must qualify against the word, not the field.
    const qualified = scored.filter(r => {
      if (r._hasFts) return true;
      return Math.max(...[normalized, ...typoTerms].map(q => fieldSimilarity(q, r))) >= qualityThreshold;
    });
    qualified.sort((a, b) => b.score - a.score);

    return applyRelevanceBoundaries(qualified, lat, lng, locationSlug, limit, offset);
  }

  // ── Location-scoped search ─────────────────────────────

  async function searchAllInLocation(
    locationSlug: string, categorySlug: string | undefined,
    lat: number | undefined, lng: number | undefined, limit: number, offset: number
  ): Promise<SearchResponse<TResult>> {
    if (!columns.locationSlug) return empty();
    const args: unknown[] = [];
    const p = (v: unknown) => { args.push(v); return ph(args.length, dialect); };

    let sql = `SELECT *, COUNT(*) OVER () AS _total FROM ${tables.entities} WHERE ${columns.locationSlug} = ${p(locationSlug)}`;
    if (categorySlug && columns.categoriesNormalized) {
      const catName = normalize(categorySlug.replace(/-/g, ' '), locale);
      sql += ` AND ${columns.categoriesNormalized} LIKE ${p(`%${catName}%`)}`;
    }
    sql += ` ORDER BY ${orderBy(p, lat, lng)} LIMIT ${p(limit)} OFFSET ${p(offset)}`;

    const result = await db.execute({ sql, args });
    const rows = result.rows.map(r => adapter.toResult(r, lat, lng));
    return { results: stripInternal(rows), nearby: [], noLocalResults: false, totalFound: totalOf(result.rows) };
  }

  // ── Geo-only search ────────────────────────────────────

  async function geoOnlySearch(
    lat: number, lng: number, limit: number, offset: number
  ): Promise<SearchResponse<TResult>> {
    if (!columns.lat || !columns.lng) return empty();
    const args: unknown[] = [];
    const p = (v: unknown) => { args.push(v); return ph(args.length, dialect); };
    let where = '';
    if (primaryRadiusKm != null) {
      const bbox = boundingBox(lat, lng, primaryRadiusKm);
      where = ` WHERE ${columns.lat} BETWEEN ${p(bbox.minLat)} AND ${p(bbox.maxLat)}` +
        ` AND ${columns.lng} BETWEEN ${p(bbox.minLng)} AND ${p(bbox.maxLng)}`;
    }
    const sql = `SELECT *, COUNT(*) OVER () AS _total FROM ${tables.entities}${where}` +
      ` ORDER BY ${orderBy(p, lat, lng)} LIMIT ${p(limit)} OFFSET ${p(offset)}`;
    const result = await db.execute({ sql, args });
    const rows = result.rows.map(r => adapter.toResult(r, lat, lng));
    const totalFound = totalOf(result.rows);
    return { results: stripInternal(rows), nearby: [], noLocalResults: totalFound === 0 && offset === 0, totalFound };
  }

  /**
   * Stable SQL order for the no-query paths: nearest first when there is a
   * point (equirectangular, exact enough to rank within a city), else by name.
   * Rows without coordinates go last on both dialects (sqlite sorts NULL first).
   */
  function orderBy(p: (v: unknown) => string, lat?: number, lng?: number): string {
    const tie = `${columns.name}, ${columns.id}`;
    if (lat == null || lng == null || !columns.lat || !columns.lng) return tie;
    // Each use binds its own arg: sqlite's `?` is positional, so a placeholder
    // string cannot be repeated the way pg's `$n` can.
    const k = Math.cos((lat * Math.PI) / 180);
    const dLat = () => `(${columns.lat} - ${p(lat)})`;
    const dLng = () => `((${columns.lng} - ${p(lng)}) * ${p(k)})`;
    return `CASE WHEN ${columns.lat} IS NULL THEN 1 ELSE 0 END, ${dLat()} * ${dLat()} + ${dLng()} * ${dLng()}, ${tie}`;
  }

  /** Window-count total off any row of the page; 0 for an empty page. */
  function totalOf(rows: Record<string, unknown>[]): number {
    return rows.length ? Number(rows[0]._total) : 0;
  }

  // ── Full-text search ───────────────────────────────────

  async function ftsSearch(
    ftsQuery: string, ftsTerms: string[], locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    if (!ftsQuery) return [];

    if (dialect === 'postgres') {
      return ftsSearchPostgres(ftsQuery, ftsTerms, locationSlug, categorySlug, limit);
    }
    return ftsSearchSqlite(ftsQuery, locationSlug, categorySlug, limit);
  }

  async function ftsSearchSqlite(
    ftsQuery: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    // Weighted bm25 when configured — same semantics as rank (lower = better)
    const rankExpr = ftsColumnWeights?.length
      ? `bm25(${tables.fts}, ${ftsColumnWeights.join(', ')})`
      : 'fts.rank';
    let sql = `
      SELECT s.*, ${rankExpr} AS _ftsRank
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
    sql += ' ORDER BY _ftsRank LIMIT ?';
    args.push(limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  async function ftsSearchPostgres(
    ftsQuery: string, ftsTerms: string[], locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    // PostgreSQL: use tsvector column + tsquery
    // The FTS table name is used as the tsvector column name on the entities table
    const tsCol = tables.fts; // e.g. "search_vector"
    const q = (name: string) => `"${name}"`;
    const args: unknown[] = [ftsQuery];

    let filters = '';
    if (locationSlug && columns.locationSlug) {
      filters += ` AND s.${columns.locationSlug} = ${ph(2, dialect)}`;
      args.push(locationSlug);
    }
    if (categorySlug && columns.categoriesNormalized) {
      const catName = normalize(categorySlug.replace(/-/g, ' '), locale);
      filters += ` AND s.${columns.categoriesNormalized} ILIKE ${ph(args.length + 1, dialect)}`;
      args.push(`%${catName}%`);
    }

    let sql: string;
    if (adapter.ftsParts?.length && ftsTerms.length) {
      // Coverage rank, not ts_rank: ts_rank is dominated by term frequency,
      // so a keyword-stuffed name ("pilates" ×4) outranks an exact
      // two-token name on every query containing it — bm25 on the SQLite
      // path rewards rarity and saturates repetition instead. Here each
      // field scores as weight × (tokens matched in field / token count),
      // summed over fields — same ranking bm25's column weights produce,
      // without the frequency pathology. The stored tsvector stays the
      // indexed prefilter; per-field vectors fold from the normalized
      // columns over the prefiltered rows only.
      // ponytail: recomputes ~7 unaccent+tsvector per matched row (worst
      // queries match ~2k rows, ~100ms); trigger-maintained per-field
      // vector columns if search latency ever shows this.
      const vecs = adapter.ftsParts
        .map((p, i) => `to_tsvector('simple', unaccent(${p.expr})) AS "_p${i}"`)
        .join(', ');
      // tokens are sanitized in buildFtsTerms (quotes stripped), so the
      // literal tsquery constants are injection-safe and plan-time-folded.
      const coverage = adapter.ftsParts
        .map((p, i) =>
          `(${p.weight} * (${ftsTerms.map(t => `("_p${i}" @@ to_tsquery('simple', '${tsTerm(t)}'))::int`).join(' + ')})::real / ${ftsTerms.length})`)
        .join(' + ');
      sql = `
        WITH _c AS (
          SELECT s.*, ${vecs}
          FROM ${tables.entities} s
          WHERE s.${tsCol} @@ to_tsquery('simple', ${ph(1, dialect)})${filters}
        )
        SELECT *, (${coverage}) AS "_ftsRank" FROM _c
        ORDER BY "_ftsRank" DESC, ${q(columns.id)} ASC
        LIMIT ${ph(args.length + 1, dialect)}
      `;
    } else {
      sql = `
        SELECT s.*, ts_rank(s.${tsCol}, to_tsquery('simple', ${ph(1, dialect)})) AS "_ftsRank"
        FROM ${tables.entities} s
        WHERE s.${tsCol} @@ to_tsquery('simple', ${ph(1, dialect)})
      `;
      sql += filters;
      sql += ` ORDER BY "_ftsRank" DESC LIMIT ${ph(args.length + 1, dialect)}`;
    }
    args.push(limit);

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  // ── Trigram fuzzy search ───────────────────────────────

  async function trigramFuzzySearch(
    normalized: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number,
    /** `normalized` is one word to find inside longer fields, not a whole query */
    singleWord = false
  ): Promise<Record<string, unknown>[]> {
    if (fuzzyStrategy === 'none') return [];
    if (dialect === 'postgres') {
      if (fuzzyStrategy === 'trigram-table') {
        return trigramFuzzyTable(normalized, locationSlug, categorySlug, limit);
      }
      return trigramFuzzyPostgres(normalized, locationSlug, categorySlug, limit, singleWord);
    }
    return trigramFuzzyTable(normalized, locationSlug, categorySlug, limit);
  }

  /** Trigram fuzzy search over the custom trigram table (both dialects). */
  async function trigramFuzzyTable(
    normalized: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number
  ): Promise<Record<string, unknown>[]> {
    const queryTrigrams = trigrams(normalized, locale);
    if (queryTrigrams.length === 0) return [];
    // Both present: checked when the engine is created
    const triTable = tables.trigrams!;
    const trigramColumns = adapter.trigramColumns!;

    const like = dialect === 'postgres' ? 'ILIKE' : 'LIKE';
    const q = (name: string) => (dialect === 'postgres' ? `"${name}"` : name);
    // Postgres only allows selecting s.* when grouped by its primary key —
    // grouping by the trigram table's FK doesn't imply functional dependency.
    // And even grouping by s.id isn't enough when entities is a VIEW
    // (yoga's schools_listed): pg's functional-dependency shortcut applies
    // only to base tables. So on postgres the match resolves in two steps —
    // ids + scores first (pure aggregate), then full rows by id, re-sorted
    // in JS to keep the score order. SQLite keeps the single query it always
    // ran (its bare-column GROUP BY picks arbitrary values, but every joined
    // row in a group shares the same s.*, so the values are exact).
    const groupKey = dialect === 'postgres'
      ? `s.${columns.id}`
      : `t.${trigramColumns.entityId}`;

    const phs = placeholders(queryTrigrams.length, dialect, 2);
    // Postgres step 1 selects only the id (plus the aggregate) — see note above.
    const selectList = dialect === 'postgres'
      ? `s.${columns.id},`
      : `s.*, NULL AS ${q('_ftsRank')},`;
    let sql = `
      SELECT ${selectList}
             (COUNT(DISTINCT t.${trigramColumns.trigram}) * 1.0 / ${ph(1, dialect)}) AS ${q('_fuzzyScore')}
      FROM ${triTable} t
      JOIN ${tables.entities} s ON s.${columns.id} = t.${trigramColumns.entityId}
      WHERE t.${trigramColumns.trigram} IN (${phs})
    `;
    const args: unknown[] = [queryTrigrams.length, ...queryTrigrams];

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ${ph(args.length + 1, dialect)}`;
      args.push(locationSlug);
    }
    if (categorySlug && columns.categoriesNormalized) {
      sql += ` AND s.${columns.categoriesNormalized} ${like} ${ph(args.length + 1, dialect)}`;
      args.push(`%${normalize(categorySlug.replace(/-/g, ' '), locale)}%`);
    }

    const minOverlap = queryTrigrams.length <= 3
      ? Math.max(1, queryTrigrams.length - 1)
      // 0.4, not higher: a mid-word substitution ("vinjasa") destroys three
      // trigrams, leaving 2 of 5. The Levenshtein quality gate rejects the junk
      // a looser overlap lets in.
      // ponytail: 4-trigram words (6 letters) with a mid-word typo still share
      // only 1 and miss; overlap 1 floods the candidate pool. Add an edit-distance
      // index if that case shows up in search logs.
      : Math.max(2, Math.ceil(queryTrigrams.length * 0.4));
    // LIMIT must be the NEXT placeholder: on postgres $N names one parameter,
    // so reusing args.length+1 aliased minOverlap and limit into a single $k
    // (and left the limit arg unbound — 42P18 "could not determine data type
    // of parameter $k+1"). sqlite's anonymous ? binds positionally, which is
    // why this only broke on the pg path.
    // Tie-break on the entity id: with a real query the >= minOverlap tie pool
    // can hold hundreds of candidates at one score, and LIMIT keeps a different
    // arbitrary subset per engine (sqlite rowid order vs pg seq scan). The
    // identical (score, id) cut makes both dialects score the same batch.
    sql += ` GROUP BY ${groupKey} HAVING COUNT(DISTINCT t.${trigramColumns.trigram}) >= ${ph(args.length + 1, dialect)} ORDER BY ${q('_fuzzyScore')} DESC, s.${columns.id} ASC LIMIT ${ph(args.length + 2, dialect)}`;
    args.push(minOverlap, limit);

    const result = await db.execute({ sql, args });
    if (result.rows.length === 0 || dialect !== 'postgres') return result.rows;

    const scored = result.rows as { [k: string]: unknown }[];
    const ids = scored.map((r) => r[columns.id]);
    const scoreById = new Map(scored.map((r) => [r[columns.id], r._fuzzyScore]));
    const idPhs = placeholders(ids.length, dialect, 1);
    const full = await db.execute({
      sql: `SELECT s.*, NULL AS ${q('_ftsRank')} FROM ${tables.entities} s WHERE s.${columns.id} IN (${idPhs})`,
      args: ids,
    });
    return (full.rows as { [k: string]: unknown }[]).sort((a, b) => {
      const d = Number(scoreById.get(b[columns.id])) - Number(scoreById.get(a[columns.id]));
      if (d !== 0) return d;
      // stable through the second fetch: ties keep the (score, id) SQL order
      const ai = String(a[columns.id]), bi = String(b[columns.id]);
      return ai === bi ? 0 : (ai < bi ? -1 : 1);
    });
  }

  async function trigramFuzzyPostgres(
    normalized: string, locationSlug: string | undefined,
    categorySlug: string | undefined, limit: number, singleWord = false
  ): Promise<Record<string, unknown>[]> {
    // PostgreSQL: use pg_trgm extension's similarity() function
    // Searches against the nameNormalized column (primary) and optionally others
    const args: unknown[] = [normalized];
    let argIdx = 2;

    // Build similarity expression across searchable text columns
    const simCols = [columns.nameNormalized];
    if (columns.categoriesNormalized) simCols.push(columns.categoriesNormalized);
    if (columns.locationNormalized) simCols.push(columns.locationNormalized);

    // similarity() is whole-field: one word against a long field decays toward
    // the 0.1 floor ('vinjasa' vs a six-style list = 0.12). word_similarity()
    // scores the best-matching extent instead and holds at 0.45 either way.
    const sim = (c: string) => singleWord
      ? `word_similarity(${ph(1, dialect)}, COALESCE(${c}, ''))`
      : `similarity(COALESCE(${c}, ''), ${ph(1, dialect)})`;
    const simExpr = simCols.length === 1 ? sim(simCols[0]) : `GREATEST(${simCols.map(sim).join(', ')})`;
    const floor = singleWord ? 0.3 : 0.1;

    let sql = `
      SELECT s.*, NULL AS "_ftsRank", ${simExpr} AS "_fuzzyScore"
      FROM ${tables.entities} s
      WHERE ${simExpr} > ${floor}
    `;

    if (locationSlug && columns.locationSlug) {
      sql += ` AND s.${columns.locationSlug} = ${ph(argIdx, dialect)}`;
      args.push(locationSlug);
      argIdx++;
    }
    if (categorySlug && columns.categoriesNormalized) {
      sql += ` AND s.${columns.categoriesNormalized} ILIKE ${ph(argIdx, dialect)}`;
      args.push(`%${normalize(categorySlug.replace(/-/g, ' '), locale)}%`);
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
    if (!tables.synonyms) return tokens;
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
        // Normalized like the query: the indexed columns are normalized, and a
        // raw canonical ("Power Yoga!") would only match by tokenizer luck.
        const canonical = normalize(String(row.canonical ?? ''), locale);
        if (canonical && !expanded.includes(canonical)) expanded.push(canonical);
      }
    }

    return expanded;
  }

  // ── FTS query builder ──────────────────────────────────

  /** Sanitized query terms (no tsquery specials), capped at maxFtsTerms. */
  function buildFtsTerms(tokens: string[]): string[] {
    return tokens
      .map(t => t.replace(/['"(){}*:^~\-!&|<>\\]/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, maxFtsTerms);
  }

  function buildFtsQuery(terms: string[]): string {
    if (terms.length === 0) return '';

    if (dialect === 'postgres') {
      // PostgreSQL tsquery: term1:* | term2:*
      return terms.map(tsTerm).join(' | ');
    }
    // SQLite FTS5: "term1"* OR "term2"*
    const fts5Terms = terms.map(t => `"${t}"*`);
    return fts5Terms.length === 1 ? fts5Terms[0] : fts5Terms.join(' OR ');
  }

  /**
   * One term as tsquery source. A multi-word term (a synonym canonical like
   * "power yoga") is a phrase: bare spaces are a tsquery syntax error.
   */
  function tsTerm(term: string): string {
    return term.split(' ').map(w => `${w}:*`).join(' <-> ');
  }

  // ── Scoring ────────────────────────────────────────────

  function scoreResults(
    rows: Record<string, unknown>[], normalized: string,
    lat: number | undefined, lng: number | undefined,
    geoBoost: boolean, typoTerms: string[] = []
  ): TResult[] {
    // FTS rank is scale-dependent — bm25 magnitude grows with ftsColumnWeights
    // and ts_rank uses a different scale entirely — so a fixed divisor saturates
    // and stops separating good matches from great ones. Normalize against the
    // best rank in this batch instead. Works for both sign conventions: SQLite
    // bm25 is negative (lower = better), ts_rank positive (higher = better), and
    // dividing by the batch best puts either on 0..1 with the best at 1.
    const ranks = rows.map(r => r._ftsRank).filter((v): v is number => typeof v === 'number');
    const bestRank = ranks.length
      ? (dialect === 'postgres' ? Math.max(...ranks) : Math.min(...ranks))
      : 0;

    return rows.map(row => {
      const result = adapter.toResult(row, lat, lng);
      let score = 0;

      // FTS rank
      const ftsRank = row._ftsRank as number | null;
      if (ftsRank != null && bestRank !== 0) {
        score += Math.min(1, Math.max(0, ftsRank / bestRank)) * 0.40;
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
      // Misspelled terms (see search()): scored in JS off the row's own fields,
      // so an FTS row that also carries the typo'd word rises — the SQL fuzzy
      // score would be lost on it, since dedup keeps the FTS copy of the row.
      for (const term of typoTerms) {
        const sim = fieldSimilarity(term, result);
        if (sim >= qualityThreshold) score += sim * 0.30 / typoTerms.length;
      }

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
    limit: number, offset: number
  ): Promise<SearchResponse<TResult>> {
    if (locationSlug) {
      const capped = stripInternal(scored.slice(offset, offset + limit));
      return {
        results: capped, nearby: [], noLocalResults: capped.length === 0,
        totalFound: scored.length,
      };
    }

    if (lat == null || lng == null || primaryRadiusKm == null || nearbyRadiusKm == null) {
      const capped = stripInternal(scored.slice(offset, offset + limit));
      return {
        results: capped, nearby: [], noLocalResults: capped.length === 0,
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
        totalFound: 0,
      };
    }

    return {
      results: stripInternal(primary.slice(offset, offset + limit)),
      nearby: stripInternal(nearby.slice(0, maxNearby)),
      noLocalResults: false,
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

  /** Best per-word Levenshtein similarity of `q` across a result's text fields. */
  function fieldSimilarity(q: string, r: TResult): number {
    return Math.max(
      bestWordSimilarity(q, r._nameN || '', locale),
      bestWordSimilarity(q, r._locationN || '', locale),
      bestWordSimilarity(q, r._categoriesN || '', locale),
    );
  }

  /** Does any normalized column of this row hold a word starting with `term`? */
  function rowHasWordPrefix(row: Record<string, unknown>, term: string): boolean {
    return [columns.nameNormalized, columns.categoriesNormalized, columns.locationNormalized, columns.areaNormalized]
      .some(c => c && String(row[c] ?? '').split(/\s+/).some(w => w.startsWith(term)));
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
    return { results: [], nearby: [], noLocalResults: false, totalFound: 0 };
  }

  return { search };
}
