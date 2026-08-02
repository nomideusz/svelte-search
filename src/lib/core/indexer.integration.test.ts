// Indexer against real in-memory SQLite + FTS5. Covers the write paths the
// engine tests can't: trigram (re)indexing, FTS rebuild, sync diagnosis, and
// the paged full-table scan that a single SELECT * would blow past.
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createIndexer, createLookupsLoader } from './indexer.js';
import { createSearchEngine } from './engine.js';
import type { DatabaseClient, SchemaAdapter, SearchResult } from './types.js';
import { plLocale } from '../locales/pl.js';

function sqliteClient(db: DatabaseSync): DatabaseClient {
  return {
    async execute(q) {
      const { sql, args } = typeof q === 'string' ? { sql: q, args: [] as unknown[] } : q;
      const stmt = db.prepare(sql);
      // node:sqlite rejects .all() on statements that return nothing
      const rows = /^\s*(select|with)/i.test(sql)
        ? (stmt.all(...(args as never[])) as Record<string, unknown>[])
        : (stmt.run(...(args as never[])), []);
      return { rows };
    },
  };
}

const adapter: SchemaAdapter<SearchResult> = {
  tables: { entities: 'items', trigrams: 'item_trigrams', fts: 'items_fts', synonyms: 'synonyms' },
  columns: {
    id: 'id', name: 'name', nameNormalized: 'name_n', slug: 'slug',
    lat: null, lng: null, locationSlug: 'city_slug',
    categoriesNormalized: null, locationNormalized: 'city_n', areaNormalized: null,
  },
  trigramColumns: { trigram: 'trigram', entityId: 'item_id', field: 'field' },
  toResult(row) {
    return {
      id: row.id as string, name: row.name as string, slug: row.slug as string,
      lat: null, lng: null, distanceKm: null, walkingMin: null, score: 0,
      _hasFts: row._ftsRank != null,
      _nameN: (row.name_n as string) ?? '',
      _locationN: (row.city_n as string) ?? '',
    };
  },
  trigramFields(e) {
    return [{ text: e.name as string, field: 'name' }, { text: e.city_n as string, field: 'city' }];
  },
};

let db: DatabaseSync;
let client: DatabaseClient;
let indexer: ReturnType<typeof createIndexer>;

function seed(count: number) {
  const ins = db.prepare('INSERT INTO items (id,name,slug,city_slug,name_n,city_n) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < count; i++) {
    ins.run(`id-${String(i).padStart(5, '0')}`, `Studio ${i}`, `studio-${i}`, 'krakow', `studio ${i}`, 'krakow');
  }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, city_slug TEXT, name_n TEXT, city_n TEXT
    );
    CREATE TABLE item_trigrams (
      item_id TEXT, trigram TEXT, field TEXT,
      UNIQUE(item_id, trigram, field)
    );
    CREATE TABLE synonyms (alias TEXT, canonical TEXT, category TEXT);
    CREATE VIRTUAL TABLE items_fts USING fts5(
      name_n, city_n, content='items', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  client = sqliteClient(db);
  indexer = createIndexer({ db: client, adapter, locale: plLocale });
});

describe('indexer — trigrams', () => {
  it('indexes one entity', async () => {
    seed(1);
    await indexer.indexTrigrams('id-00000', { name: 'Studio 0', city_n: 'krakow' });
    const n = db.prepare('SELECT COUNT(*) c FROM item_trigrams').get() as { c: number };
    expect(n.c).toBeGreaterThan(0);
  });

  it('is idempotent — reindexing does not duplicate', async () => {
    seed(1);
    const row = { name: 'Studio 0', city_n: 'krakow' };
    await indexer.indexTrigrams('id-00000', row);
    const first = (db.prepare('SELECT COUNT(*) c FROM item_trigrams').get() as { c: number }).c;
    await indexer.indexTrigrams('id-00000', row);
    const second = (db.prepare('SELECT COUNT(*) c FROM item_trigrams').get() as { c: number }).c;
    expect(second).toBe(first);
  });

  it('pages a full reindex past a single response worth of rows', async () => {
    // Larger than the 500-row scan page — an unpaged SELECT * would silently
    // stop at whatever one response returns.
    seed(1200);
    expect(await indexer.reindexAllTrigrams()).toBe(1200);
    const distinct = db.prepare('SELECT COUNT(DISTINCT item_id) c FROM item_trigrams').get() as { c: number };
    expect(distinct.c).toBe(1200);
  });
});

describe('indexer — FTS maintenance', () => {
  it('reports counts in sync after a rebuild', async () => {
    seed(10);
    await indexer.rebuildFts();
    const after = await indexer.checkFtsSync();
    expect(after.inEntities).toBe(10);
    expect(after.inFts).toBe(10);
    expect(after.missingFromFts).toBe(0);
    expect(after.orphanedInFts).toBe(0);
  });

  it('cannot see an unbuilt index on an external-content table', async () => {
    // Documents a real limitation rather than asserting a wish: with
    // content='items' the FTS5 counts read through to the content table, so
    // they match even when the index holds nothing. Only a MATCH can tell.
    seed(10);
    const stats = await indexer.checkFtsSync();
    expect(stats.missingFromFts).toBe(0);      // looks healthy...
    const engine = createSearchEngine({ db: client, adapter, locale: plLocale });
    const { results } = await engine.search({ query: 'studio' });
    expect(results).toEqual([]);               // ...but nothing is findable

    await indexer.rebuildFts();
    const { results: after } = await engine.search({ query: 'studio' });
    expect(after.length).toBeGreaterThan(0);
  });

  it('makes rows findable through the engine once rebuilt', async () => {
    seed(3);
    await indexer.rebuildFts();
    await indexer.reindexAllTrigrams();
    const engine = createSearchEngine({ db: client, adapter, locale: plLocale });
    const { results } = await engine.search({ query: 'studio' });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('indexer — renormalizeAll', () => {
  it('visits every row across pages and rebuilds FTS', async () => {
    seed(600);
    const seen: string[] = [];
    const count = await indexer.renormalizeAll(async (_db, row) => {
      seen.push(row.id as string);
    });
    expect(count).toBe(600);
    expect(new Set(seen).size).toBe(600);
    expect((await indexer.checkFtsSync()).missingFromFts).toBe(0);
  });
});

describe('createLookupsLoader', () => {
  it('builds maps and caches them', async () => {
    db.exec(`
      CREATE TABLE cities (slug TEXT, name TEXT, name_n TEXT, lat REAL, lng REAL, item_count INT, areas TEXT);
      CREATE TABLE styles (slug TEXT, name_n TEXT, aliases_n TEXT);
      INSERT INTO cities VALUES ('krakow','Kraków','krakow',50.06,19.94,12,'["zwierzyniec","podgorze"]');
      INSERT INTO cities VALUES ('warszawa','Warszawa','warszawa',52.23,21.01,30,'["mokotow"]');
      INSERT INTO styles VALUES ('hatha-yoga','hatha','joga hatha');
      INSERT INTO synonyms VALUES ('Kraken','Kraków','city');
    `);

    let queries = 0;
    const counting: DatabaseClient = {
      async execute(q) { queries++; return client.execute(q); },
    };

    const loader = createLookupsLoader({
      db: counting,
      locale: plLocale,
      locations: {
        sql: 'SELECT slug, name, name_n, lat, lng, item_count FROM cities',
        slugCol: 'slug', nameNormalizedCol: 'name_n', countCol: 'item_count',
        latCol: 'lat', lngCol: 'lng', nameCol: 'name',
      },
      categories: { sql: 'SELECT slug, name_n, aliases_n FROM styles', slugCol: 'slug', nameNormalizedCol: 'name_n', aliasesNormalizedCol: 'aliases_n' },
      areas: { sql: 'SELECT slug, areas FROM cities', locationSlugCol: 'slug', areasJsonCol: 'areas' },
      synonymsSql: 'SELECT alias, canonical, category FROM synonyms',
    });

    const lookups = await loader.load();
    expect(lookups.locationMap.get('krakow')).toBe('krakow');
    expect(lookups.categoryMap.get('hatha')).toBe('hatha-yoga');
    expect(lookups.areaMap.get('krakow')).toEqual(['zwierzyniec', 'podgorze']);
    expect(lookups.locationEntityCount?.get('warszawa')).toBe(30);
    expect(lookups.locationGeo?.get('krakow')?.name).toBe('Kraków');
    // Synonym alias resolves to the canonical slug
    expect(lookups.locationMap.get('kraken')).toBe('krakow');

    const after = queries;
    await loader.load();
    expect(queries, 'second load should be served from cache').toBe(after);
  });

  it('serves concurrent cold loads from a single reload', async () => {
    db.exec(`
      CREATE TABLE cities (slug TEXT, name_n TEXT);
      CREATE TABLE styles (slug TEXT, name_n TEXT);
      INSERT INTO cities VALUES ('krakow','krakow');
    `);
    let locationQueries = 0;
    const counting: DatabaseClient = {
      async execute(q) {
        const sql = typeof q === 'string' ? q : q.sql;
        if (sql.includes('FROM cities')) locationQueries++;
        return client.execute(q);
      },
    };
    const loader = createLookupsLoader({
      db: counting,
      locations: { sql: 'SELECT slug, name_n FROM cities', slugCol: 'slug', nameNormalizedCol: 'name_n' },
      categories: { sql: 'SELECT slug, name_n FROM styles', slugCol: 'slug', nameNormalizedCol: 'name_n' },
    });

    await Promise.all([loader.load(), loader.load(), loader.load()]);
    expect(locationQueries).toBe(1);
  });
});
