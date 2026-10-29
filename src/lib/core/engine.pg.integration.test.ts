// Postgres twin of engine.integration.test.ts, for the paths SQLite cannot
// exercise: tsvector FTS and pg_trgm (similarity / word_similarity). Skipped
// unless SEARCH_TEST_PG_URL points at a scratch database that has pg_trgm:
//   SEARCH_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/svelte_search_test pnpm test
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createSearchEngine } from './engine.js';
import { normalize, trigrams } from './normalize.js';
import type { DatabaseClient, SchemaAdapter, SearchResult } from './types.js';
import { plLocale } from '../locales/pl.js';

const url = process.env.SEARCH_TEST_PG_URL;

interface Item extends SearchResult { styles: string }

const adapter: SchemaAdapter<Item> = {
  tables: { entities: 'ss_items', trigrams: 'ss_trigrams', fts: 'search_vector', synonyms: 'ss_synonyms' },
  columns: {
    id: 'id', name: 'name', nameNormalized: 'name_n', slug: 'slug',
    lat: 'lat', lng: 'lng', locationSlug: 'city_slug',
    categoriesNormalized: 'styles_n', locationNormalized: 'city_n', areaNormalized: 'district_n',
  },
  trigramColumns: { trigram: 'trigram', entityId: 'item_id', field: 'field' },
  toResult(row) {
    return {
      id: row.id as string, name: row.name as string, slug: row.slug as string,
      styles: (row.styles_n as string) ?? '', lat: null, lng: null,
      distanceKm: null, walkingMin: null, score: 0,
      _hasFts: row._ftsRank != null,
      _nameN: (row.name_n as string) ?? '',
      _locationN: (row.city_n as string) ?? '',
      _categoriesN: (row.styles_n as string) ?? '',
    };
  },
  trigramFields: () => [],
};

// Six schools in one city so "gdansk" alone fills the FTS quota; only g0
// teaches vinyasa, and its name is the least query-like of the six.
const NAMES = ['Przestrzen Ruchu', 'Dom Praktyki', 'Pracownia Oddechu', 'Cicha Sala', 'Mata i Spokoj', 'Szkola Nad Motlawa'];

// Both fuzzy strategies: 'pg-trgm' is the postgres default, 'trigram-table' is
// what yoga runs in production.
describe.skipIf(!url).each(['pg-trgm', 'trigram-table'] as const)('engine against real Postgres (%s)', (fuzzy) => {
  let sql: ReturnType<typeof postgres>;
  let engine: ReturnType<typeof createSearchEngine<Item>>;

  beforeAll(async () => {
    sql = postgres(url!, { onnotice: () => {} });
    await sql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      DROP TABLE IF EXISTS ss_items, ss_synonyms, ss_trigrams;
      CREATE TABLE ss_trigrams (trigram TEXT NOT NULL, item_id TEXT NOT NULL, field TEXT NOT NULL);
      CREATE TABLE ss_synonyms (alias TEXT, canonical TEXT, category TEXT);
      CREATE TABLE ss_items (
        id TEXT PRIMARY KEY, name TEXT, slug TEXT, city_slug TEXT,
        name_n TEXT, city_n TEXT, styles_n TEXT, district_n TEXT, lat REAL, lng REAL,
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',
          coalesce(name_n,'') || ' ' || coalesce(styles_n,'') || ' ' || coalesce(city_n,'') || ' ' || coalesce(district_n,''))) STORED
      );
    `);
    for (const [i, name] of NAMES.entries()) {
      await sql`INSERT INTO ss_items (id, name, slug, city_slug, name_n, city_n, styles_n, district_n)
        VALUES (${`g${i}`}, ${name}, ${`slug-g${i}`}, 'gdansk', ${normalize(name, plLocale)}, 'gdansk',
                ${i === 0 ? 'vinyasa power' : 'hatha'}, 'wrzeszcz')`;
    }
    await sql`INSERT INTO ss_items (id, name, slug, city_slug, name_n, city_n, styles_n, district_n)
      VALUES ('k1', 'Studio Ruchu', 'slug-k1', 'krakow', 'studio ruchu', 'krakow', 'hatha ashtanga yin vinyasa power flow', 'podgorze')`;

    const rows = await sql`SELECT id, name_n, city_n, styles_n FROM ss_items`;
    for (const row of rows) {
      for (const field of ['name_n', 'city_n', 'styles_n']) {
        for (const t of trigrams(row[field], plLocale)) {
          await sql`INSERT INTO ss_trigrams (trigram, item_id, field) VALUES (${t}, ${row.id}, ${field})`;
        }
      }
    }

    const db: DatabaseClient = {
      async execute(q) {
        const { sql: text, args } = typeof q === 'string' ? { sql: q, args: [] as unknown[] } : q;
        return { rows: [...await sql.unsafe(text, args as never[])] as Record<string, unknown>[] };
      },
    };
    engine = createSearchEngine<Item>({ db, adapter, locale: plLocale, dialect: 'postgres', fuzzy });
  });

  afterAll(async () => {
    await sql.unsafe('DROP TABLE IF EXISTS ss_items, ss_synonyms, ss_trigrams');
    await sql.end();
  });

  it('finds an exact term through tsvector', async () => {
    const r = await engine.search({ query: 'vinyasa' });
    expect(r.results.map(x => x.id).sort()).toEqual(['g0', 'k1']);
  });

  it('expands a multi-word synonym as a phrase instead of a tsquery syntax error', async () => {
    await sql`INSERT INTO ss_synonyms (alias, canonical, category) VALUES ('dynamiczna', 'Vinyasa Power', 'category')`;
    const r = await engine.search({ query: 'dynamiczna' });
    expect(r.results.map(x => x.id)).toContain('g0');
  });

  it('pages a location in SQL', async () => {
    const page = await engine.search({ query: '', locationSlug: 'gdansk', lat: 54.35, lng: 18.65, limit: 2, offset: 2 });
    expect(page.results).toHaveLength(2);
    expect(page.totalFound).toBe(6);
  });

  it('finds a mid-word substitution on its own', async () => {
    const r = await engine.search({ query: 'vinjasa' });
    expect(r.results.map(x => x.id)).toContain('g0');
  });

  it('still honours a misspelled term when another term fills the FTS quota', async () => {
    const r = await engine.search({ query: 'vinjasa gdansk' });
    expect(r.results[0].id).toBe('g0');
  });

  it('recalls a misspelled term from a long field outside the FTS batch', async () => {
    // k1 matches neither "gdansk" nor, by whole-field similarity(), the typo:
    // on pg-trgm only word_similarity() reaches a style buried in a long list.
    const r = await engine.search({ query: 'vinjasa gdansk' });
    expect(r.results.map(x => x.id)).toContain('k1');
  });
});
