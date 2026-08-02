// Integration test — runs the engine's generated SQL against a real in-memory
// SQLite with FTS5 (node:sqlite, no extra dependency). The unit tests in
// engine.test.ts assert SQL *shape* against a fake client; this one proves the
// SQL actually parses and returns sane results, and doubles as a worked
// schema example for apps adopting the package.
import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createSearchEngine } from './engine.js';
import { trigrams, normalize } from './normalize.js';
import type { DatabaseClient, SchemaAdapter, SearchResult } from './types.js';
import { plLocale } from '../locales/pl.js';

interface Item extends SearchResult {
  city: string;
  styles: string;
}

// ── DatabaseClient over node:sqlite ────────────────────────
function sqliteClient(db: DatabaseSync): DatabaseClient {
  return {
    async execute(q) {
      const { sql, args } = typeof q === 'string' ? { sql: q, args: [] as unknown[] } : q;
      const rows = db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
      return { rows };
    },
  };
}

const adapter: SchemaAdapter<Item> = {
  tables: { entities: 'items', trigrams: 'item_trigrams', fts: 'items_fts', synonyms: 'synonyms' },
  columns: {
    id: 'id', name: 'name', nameNormalized: 'name_n', slug: 'slug',
    lat: 'lat', lng: 'lng', locationSlug: 'city_slug',
    categoriesNormalized: 'styles_n', locationNormalized: 'city_n', areaNormalized: 'district_n',
  },
  trigramColumns: { trigram: 'trigram', entityId: 'item_id', field: 'field' },
  toResult(row) {
    return {
      id: row.id as string, name: row.name as string, slug: row.slug as string,
      city: row.city as string, styles: (row.styles_n as string) ?? '',
      lat: (row.lat as number) ?? null, lng: (row.lng as number) ?? null,
      distanceKm: null, walkingMin: null, score: 0,
      _hasFts: row._ftsRank != null,
      _nameN: (row.name_n as string) ?? '',
      _locationN: (row.city_n as string) ?? '',
      _categoriesN: (row.styles_n as string) ?? '',
    };
  },
  trigramFields(e) {
    return [
      { text: e.name as string, field: 'name' },
      { text: e.city as string, field: 'city' },
      { text: e.styles_n as string, field: 'style' },
    ];
  },
};

const SEED = [
  { id: '1', name: 'Hatha Joga Kraków', city: 'Kraków', styles: 'hatha', district: 'Zwierzyniec', street: 'Floriańska 12' },
  { id: '2', name: 'Vinyasa Flow Studio', city: 'Kraków', styles: 'vinyasa power', district: 'Podgórze', street: 'Kalwaryjska 5' },
  { id: '3', name: 'Yin Yoga Warszawa', city: 'Warszawa', styles: 'yin restorative', district: 'Mokotów', street: 'Puławska 22' },
  { id: '4', name: 'Wrocław Yoga House', city: 'Wrocław', styles: 'hatha ashtanga', district: 'Stare Miasto', street: 'Rynek 1' },
  { id: '5', name: 'Studio Pilates Kraków', city: 'Kraków', styles: 'pilates mat', district: 'Krowodrza', street: 'Długa 8' },
];

let db: DatabaseSync;
let engine: ReturnType<typeof createSearchEngine<Item>>;

beforeAll(() => {
  // Mirrors the "Schema requirements" section of the README — keep in sync.
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, city TEXT, city_slug TEXT,
      name_n TEXT, city_n TEXT, styles_n TEXT, district_n TEXT, street_n TEXT,
      lat REAL, lng REAL
    );
    CREATE TABLE item_trigrams (
      trigram TEXT NOT NULL, item_id TEXT NOT NULL, field TEXT NOT NULL
    );
    CREATE INDEX idx_item_trigrams_lookup ON item_trigrams(trigram, field);
    CREATE TABLE synonyms (
      alias TEXT NOT NULL, canonical TEXT NOT NULL, category TEXT NOT NULL,
      PRIMARY KEY (alias, canonical)
    );
    CREATE INDEX idx_synonyms_alias ON synonyms(alias);
    CREATE VIRTUAL TABLE items_fts USING fts5(
      name_n, styles_n, city_n, district_n, street_n,
      content='items', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  const ins = db.prepare(`INSERT INTO items
    (id,name,slug,city,city_slug,name_n,city_n,styles_n,district_n,street_n,lat,lng)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of SEED) {
    ins.run(
      s.id, s.name, `slug-${s.id}`, s.city, normalize(s.city, plLocale).replace(/\s+/g, '-'),
      normalize(s.name, plLocale), normalize(s.city, plLocale), s.styles,
      normalize(s.district, plLocale), normalize(s.street, plLocale), 50.06, 19.94,
    );
  }

  const insTri = db.prepare('INSERT INTO item_trigrams (item_id, trigram, field) VALUES (?,?,?)');
  for (const s of SEED) {
    for (const { text, field } of adapter.trigramFields({ name: s.name, city: s.city, styles_n: s.styles })) {
      for (const t of trigrams(text ?? '', plLocale)) insTri.run(s.id, t, field);
    }
  }

  db.prepare('INSERT INTO synonyms (alias, canonical, category) VALUES (?,?,?)').run('joga', 'yoga', 'category');
  db.exec("INSERT INTO items_fts(items_fts) VALUES('rebuild')");

  engine = createSearchEngine<Item>({
    db: sqliteClient(db), adapter, locale: plLocale,
    ftsColumnWeights: [10, 4, 4, 4, 3],
  });
});

describe('engine against real SQLite/FTS5', () => {
  it('generates SQL that actually parses and runs', async () => {
    const r = await engine.search({ query: 'hatha' });
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('finds by style term', async () => {
    const r = await engine.search({ query: 'vinyasa' });
    expect(r.results[0].id).toBe('2');
  });

  it('finds by street via FTS', async () => {
    const r = await engine.search({ query: 'floriańska' });
    expect(r.results.map(x => x.id)).toContain('1');
  });

  it('scopes results to a location', async () => {
    const r = await engine.search({ query: 'hatha', locationSlug: 'warszawa' });
    expect(r.results.every(x => x.city === 'Warszawa')).toBe(true);
  });

  it('corrects a typo through the trigram fallback', async () => {
    const r = await engine.search({ query: 'vinyas' });
    expect(r.results.map(x => x.id)).toContain('2');
  });

  it('does not match inowroclaw to wroclaw', async () => {
    const r = await engine.search({ query: 'inowroclaw' });
    expect(r.results.map(x => x.id)).not.toContain('4');
  });

  it('returns everything in a location for an empty query', async () => {
    const r = await engine.search({ query: '', locationSlug: 'krakow' });
    expect(r.results.length).toBe(3);
    for (const k of ['_hasFts', '_nameN', '_locationN', '_categoriesN']) {
      expect(r.results[0]).not.toHaveProperty(k);
    }
  });

  it('constrains the category filter across both FTS and fuzzy paths', async () => {
    const r = await engine.search({ query: 'krakow', categorySlug: 'pilates' });
    expect(r.results.every(x => x.styles.includes('pilates'))).toBe(true);
  });

  it('treats a bare stop word as a real query rather than erroring', async () => {
    const r = await engine.search({ query: 'joga' });
    expect(Array.isArray(r.results)).toBe(true);
  });
});
