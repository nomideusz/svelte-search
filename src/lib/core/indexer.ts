// ============================================================
// @nomideusz/svelte-search — Indexer
// ============================================================
// Generic trigram indexing and FTS maintenance, driven by SchemaAdapter.
//
// Dialect support:
//   - 'sqlite' (default): custom trigram tables, FTS5 rebuild
//   - 'postgres': pg_trgm extension (no custom trigram tables needed),
//                 tsvector column update

import type { DatabaseClient, SchemaAdapter, SearchResult, SearchLocale, SqlDialect, ResolverLookups } from './types.js';
import { normalize as normalizeText, trigrams } from './normalize.js';

// ── Configuration ──────────────────────────────────────────

export interface IndexerConfig<TResult extends SearchResult = SearchResult> {
  db: DatabaseClient;
  adapter: SchemaAdapter<TResult>;
  locale?: SearchLocale;
  /** SQL dialect: 'sqlite' (default) or 'postgres' */
  dialect?: SqlDialect;
}

// ── Create indexer ─────────────────────────────────────────

export function createIndexer<TResult extends SearchResult = SearchResult>(
  config: IndexerConfig<TResult>
) {
  const { db, adapter, locale, dialect = 'sqlite' } = config;
  const { tables, columns, trigramColumns } = adapter;

  // ── SQLite trigram indexing ─────────────────────────────

  /**
   * Index trigrams for a single entity (SQLite only).
   * For PostgreSQL, pg_trgm handles this automatically via GIN indexes.
   */
  async function indexTrigrams(entityId: string | number, entity: Record<string, unknown>): Promise<void> {
    if (dialect === 'postgres') return; // pg_trgm handles this

    await db.execute({
      sql: `DELETE FROM ${tables.trigrams} WHERE ${trigramColumns.entityId} = ?`,
      args: [entityId],
    });

    const entries: { trigram: string; field: string }[] = [];
    for (const { text, field } of adapter.trigramFields(entity)) {
      if (!text) continue;
      for (const t of trigrams(text, locale)) {
        entries.push({ trigram: t, field });
      }
    }

    const BATCH = 100;
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH);
      const ph = chunk.map(() => '(?,?,?)').join(',');
      const args = chunk.flatMap(e => [e.trigram, entityId, e.field]);
      await db.execute({
        sql: `INSERT OR IGNORE INTO ${tables.trigrams} (${trigramColumns.trigram}, ${trigramColumns.entityId}, ${trigramColumns.field}) VALUES ${ph}`,
        args,
      });
    }
  }

  /** Rebuild all trigrams from scratch (SQLite only). */
  async function reindexAllTrigrams(): Promise<number> {
    if (dialect === 'postgres') return 0; // pg_trgm handles this

    const result = await db.execute({ sql: `SELECT * FROM ${tables.entities}`, args: [] });
    let count = 0;
    for (const row of result.rows) {
      const id = row[columns.id] as string | number;
      await indexTrigrams(id, row);
      count++;
    }
    return count;
  }

  /** Rebuild FTS index. */
  async function rebuildFts(): Promise<void> {
    if (dialect === 'postgres') {
      // PostgreSQL: no separate FTS rebuild needed — tsvector column is maintained
      // by triggers or updated via updateSearchVector()
      return;
    }
    // SQLite FTS5 rebuild
    await db.execute({
      sql: `INSERT INTO ${tables.fts}(${tables.fts}) VALUES('rebuild')`,
      args: [],
    });
  }

  /** Check if FTS index is in sync with entities table. */
  async function checkFtsSync(): Promise<{
    inEntities: number;
    inFts: number;
    missingFromFts: number;
    orphanedInFts: number;
  }> {
    if (dialect === 'postgres') {
      // PostgreSQL: check for entities with NULL search vectors
      const tsCol = tables.fts;
      const [entityCount, missingCount] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.entities}`, args: [] }),
        db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.entities} WHERE ${tsCol} IS NULL`, args: [] }),
      ]);
      const total = Number((entityCount.rows[0] as Record<string, unknown>).c);
      const missing = Number((missingCount.rows[0] as Record<string, unknown>).c);
      return {
        inEntities: total,
        inFts: total - missing,
        missingFromFts: missing,
        orphanedInFts: 0,
      };
    }

    // SQLite FTS5 sync check
    const [entityCount, ftsCount, missing, orphaned] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.entities}`, args: [] }),
      db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.fts}`, args: [] }),
      db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.entities} s LEFT JOIN ${tables.fts} f ON s.rowid = f.rowid WHERE f.rowid IS NULL`, args: [] }),
      db.execute({ sql: `SELECT COUNT(*) as c FROM ${tables.fts} f LEFT JOIN ${tables.entities} s ON f.rowid = s.rowid WHERE s.rowid IS NULL`, args: [] }),
    ]);
    return {
      inEntities: Number((entityCount.rows[0] as Record<string, unknown>).c),
      inFts: Number((ftsCount.rows[0] as Record<string, unknown>).c),
      missingFromFts: Number((missing.rows[0] as Record<string, unknown>).c),
      orphanedInFts: Number((orphaned.rows[0] as Record<string, unknown>).c),
    };
  }

  /**
   * Update the tsvector search column for a single entity (PostgreSQL only).
   * Call after inserting/updating an entity.
   *
   * @param entityId - Primary key value
   * @param searchText - Concatenated text to index (name + description + location + categories etc.)
   * @param tsConfig - PostgreSQL text search config (default: 'simple')
   */
  async function updateSearchVector(
    entityId: string | number,
    searchText: string,
    tsConfig = 'simple'
  ): Promise<void> {
    if (dialect !== 'postgres') return;

    const tsCol = tables.fts;
    await db.execute({
      sql: `UPDATE ${tables.entities} SET ${tsCol} = to_tsvector($1, $2) WHERE ${columns.id} = $3`,
      args: [tsConfig, searchText, entityId],
    });
  }

  /**
   * Rebuild all search vectors (PostgreSQL only).
   * Uses the adapter's trigramFields to build search text.
   */
  async function rebuildAllSearchVectors(tsConfig = 'simple'): Promise<number> {
    if (dialect !== 'postgres') return 0;

    const result = await db.execute({ sql: `SELECT * FROM ${tables.entities}`, args: [] });
    let count = 0;
    for (const row of result.rows) {
      const id = row[columns.id] as string | number;
      const textParts = adapter.trigramFields(row).map(f => f.text).filter(Boolean);
      const searchText = textParts.join(' ');
      await updateSearchVector(id, searchText, tsConfig);
      count++;
    }
    return count;
  }

  /**
   * Re-derive all normalized columns from source data.
   * Call after changing the normalize() function or locale.
   */
  async function renormalizeAll(
    updateRow: (db: DatabaseClient, row: Record<string, unknown>) => Promise<void>
  ): Promise<number> {
    const result = await db.execute({ sql: `SELECT * FROM ${tables.entities}`, args: [] });
    let count = 0;
    for (const row of result.rows) {
      await updateRow(db, row);
      if (dialect === 'sqlite') {
        const id = row[columns.id] as string | number;
        await indexTrigrams(id, row);
      }
      count++;
    }
    if (dialect === 'sqlite') {
      await rebuildFts();
    } else {
      await rebuildAllSearchVectors();
    }
    return count;
  }

  /**
   * Set up PostgreSQL extensions and indexes needed for search.
   * Call once during schema setup / migration.
   */
  async function setupPostgresExtensions(): Promise<void> {
    if (dialect !== 'postgres') return;

    // Enable pg_trgm extension
    await db.execute({ sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm', args: [] });

    // Create GIN index on the tsvector column for full-text search
    const tsCol = tables.fts;
    await db.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_${tables.entities}_fts ON ${tables.entities} USING GIN (${tsCol})`,
      args: [],
    });

    // Create GIN trigram indexes on normalized text columns
    const trgmCols = [columns.nameNormalized];
    if (columns.categoriesNormalized) trgmCols.push(columns.categoriesNormalized);
    if (columns.locationNormalized) trgmCols.push(columns.locationNormalized);

    for (const col of trgmCols) {
      await db.execute({
        sql: `CREATE INDEX IF NOT EXISTS idx_${tables.entities}_${col}_trgm ON ${tables.entities} USING GIN (${col} gin_trgm_ops)`,
        args: [],
      });
    }
  }

  return {
    indexTrigrams,
    reindexAllTrigrams,
    rebuildFts,
    checkFtsSync,
    updateSearchVector,
    rebuildAllSearchVectors,
    renormalizeAll,
    setupPostgresExtensions,
  };
}

// ── Resolver lookups loader ────────────────────────────────

export interface LoadLookupsConfig {
  db: DatabaseClient;
  locale?: SearchLocale;
  /** SQL dialect: 'sqlite' (default) or 'postgres' */
  dialect?: SqlDialect;
  /** SQL + column mapping for locations */
  locations: {
    sql: string;
    slugCol: string;
    nameNormalizedCol: string;
    countCol?: string;
    latCol?: string;
    lngCol?: string;
    nameCol?: string;
  };
  /** SQL + column mapping for categories */
  categories: {
    sql: string;
    slugCol: string;
    nameNormalizedCol: string;
    aliasesNormalizedCol?: string;
  };
  /** SQL + column mapping for areas/districts */
  areas?: {
    sql: string;
    locationSlugCol: string;
    areasJsonCol: string;
  };
  /** SQL for synonym aliases */
  synonymsSql?: string;
  /** Cache TTL in ms (default: 5 minutes) */
  cacheTtlMs?: number;
}

export function createLookupsLoader(config: LoadLookupsConfig) {
  let _cached: ResolverLookups | null = null;
  let _cacheTime = 0;
  let _pending: Promise<ResolverLookups> | null = null;
  const ttl = config.cacheTtlMs ?? 5 * 60 * 1000;

  async function load(): Promise<ResolverLookups> {
    const now = Date.now();
    if (_cached && (now - _cacheTime) < ttl) return _cached;
    if (_pending) return _pending;
    _pending = reload();
    try { return await _pending; } finally { _pending = null; }
  }

  async function reload(): Promise<ResolverLookups> {
    const { db, locale } = config;

    // Locations
    const locationMap = new Map<string, string>();
    const locationEntityCount = new Map<string, number>();
    const locationGeo = new Map<string, { lat: number; lng: number; name: string }>();
    const locRows = await db.execute({ sql: config.locations.sql, args: [] });
    for (const row of locRows.rows) {
      locationMap.set(row[config.locations.nameNormalizedCol] as string, row[config.locations.slugCol] as string);
      if (config.locations.countCol) {
        locationEntityCount.set(row[config.locations.slugCol] as string, (row[config.locations.countCol] as number) ?? 0);
      }
      if (config.locations.latCol && config.locations.lngCol && config.locations.nameCol) {
        const lat = row[config.locations.latCol] as number | null;
        const lng = row[config.locations.lngCol] as number | null;
        if (lat != null && lng != null) {
          locationGeo.set(row[config.locations.slugCol] as string, {
            lat, lng, name: row[config.locations.nameCol] as string,
          });
        }
      }
    }

    // Categories
    const categoryMap = new Map<string, string>();
    const catRows = await db.execute({ sql: config.categories.sql, args: [] });
    for (const row of catRows.rows) {
      const nameN = row[config.categories.nameNormalizedCol] as string;
      const slug = row[config.categories.slugCol] as string;
      categoryMap.set(nameN, slug);
      for (const word of nameN.split(/\s+/)) {
        if (word && word.length > 2 && !categoryMap.has(word)) {
          categoryMap.set(word, slug);
        }
      }
      if (config.categories.aliasesNormalizedCol) {
        const aliasesN = row[config.categories.aliasesNormalizedCol] as string || '';
        for (const alias of aliasesN.split(/\s+/)) {
          if (alias) categoryMap.set(alias, slug);
        }
      }
    }

    // Synonym expansion
    if (config.synonymsSql) {
      const synRows = await db.execute({ sql: config.synonymsSql, args: [] });
      for (const row of synRows.rows) {
        const alias = normalize(row.alias as string, locale);
        const canonical = normalize(row.canonical as string, locale);
        const category = row.category as string;
        if (category === 'city' || category === 'location') {
          const slug = locationMap.get(canonical);
          if (slug) locationMap.set(alias, slug);
        } else if (category === 'style' || category === 'category') {
          const slug = categoryMap.get(canonical);
          if (slug) categoryMap.set(alias, slug);
        }
      }
    }

    // Areas/districts
    const areaMap = new Map<string, string[]>();
    if (config.areas) {
      const areaRows = await db.execute({ sql: config.areas.sql, args: [] });
      for (const row of areaRows.rows) {
        const locSlug = row[config.areas.locationSlugCol] as string;
        const areasJson = row[config.areas.areasJsonCol] as string || '[]';
        const areas = JSON.parse(areasJson) as string[];
        areaMap.set(locSlug, areas.map(a => normalize(a, locale)));
      }
    }

    _cached = { locationMap, categoryMap, areaMap, locationEntityCount, locationGeo };
    _cacheTime = Date.now();
    return _cached;
  }

  function invalidate() {
    _cached = null;
    _cacheTime = 0;
  }

  return { load, invalidate };
}

const normalize = normalizeText;
