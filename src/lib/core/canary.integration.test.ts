// The canary exists to catch what checkFtsSync cannot, so it is tested the
// same way: against real SQLite/FTS5, breaking the index for real.
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createCanary } from './canary.js';
import { createSearchEngine } from './engine.js';
import { createIndexer } from './indexer.js';
import type { DatabaseClient, SchemaAdapter, SearchResult } from './types.js';
import { plLocale } from '../locales/pl.js';

function sqliteClient(db: DatabaseSync): DatabaseClient {
  return {
    async execute(q) {
      const { sql, args } = typeof q === 'string' ? { sql: q, args: [] as unknown[] } : q;
      const stmt = db.prepare(sql);
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
    lat: null, lng: null, locationSlug: null,
    categoriesNormalized: null, locationNormalized: 'city_n', areaNormalized: null,
  },
  trigramColumns: { trigram: 'trigram', entityId: 'item_id', field: 'field' },
  toResult(row) {
    return {
      id: row.id as string, name: row.name as string, slug: (row.slug as string) ?? '',
      lat: null, lng: null, distanceKm: null, walkingMin: null, score: 0,
      _hasFts: row._ftsRank != null,
      _nameN: (row.name_n as string) ?? '',
      _locationN: (row.city_n as string) ?? '',
    };
  },
  trigramFields(e) {
    return [{ text: e.name as string, field: 'name' }];
  },
};

// Distinctive names, so every one is uniquely identifiable by a rare token.
const ITEMS = [
  ['i1', 'Shantimalaya Studio', 1],
  ['i2', 'Triratna Buddyzm', 1],
  ['i3', 'Kalpataru Centrum', 1],
  ['i4', 'Drzewo Życia', 1],
  ['i5', 'Prasada Joga', 1],
  ['i6', 'Ukryty Nieopublikowany', 0],   // out of scope: is_listed = 0
] as const;

let db: DatabaseSync;
let client: DatabaseClient;

function canaryFor(opts: Partial<Parameters<typeof createCanary>[0]> = {}) {
  const engine = createSearchEngine({ db: client, adapter, locale: plLocale });
  return createCanary({
    db: client, adapter, search: (p) => engine.search(p),
    where: 'is_listed = 1', sampleSize: 5, ...opts,
  });
}

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, name_n TEXT DEFAULT '',
      city_n TEXT DEFAULT '', is_listed INTEGER DEFAULT 1
    );
    CREATE TABLE item_trigrams (trigram TEXT, item_id TEXT, field TEXT);
    CREATE TABLE synonyms (alias TEXT, canonical TEXT, category TEXT);
    CREATE VIRTUAL TABLE items_fts USING fts5(
      name_n, city_n, content='items', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  const ins = db.prepare('INSERT INTO items (id,name,slug,name_n,is_listed) VALUES (?,?,?,?,?)');
  for (const [id, name, listed] of ITEMS) {
    ins.run(id, name, id, name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), listed);
  }
  client = sqliteClient(db);
  const indexer = createIndexer({ db: client, adapter, locale: plLocale });
  await indexer.rebuildFts();
  await indexer.reindexAllTrigrams();
});

describe('createCanary', () => {
  it('passes when every sampled entity is findable by its own name', async () => {
    const r = await canaryFor().run();
    expect(r.sampled).toBe(5);
    expect(r.passed).toBe(5);
    expect(r.failures).toEqual([]);
    expect(r.unindexed).toBe(0);
  });

  it('fails when the FTS index is emptied underneath it', async () => {
    // The exact scenario checkFtsSync reports as healthy on external content.
    db.exec("INSERT INTO items_fts(items_fts) VALUES('delete-all')");
    db.exec('DELETE FROM item_trigrams');
    const r = await canaryFor().run();
    expect(r.sampled).toBeGreaterThan(0);
    expect(r.passed).toBe(0);
    expect(r.failures.length).toBe(r.sampled);
  });

  it('counts entities with an empty normalized name as unindexed', async () => {
    db.exec("UPDATE items SET name_n = '' WHERE id = 'i1'");
    const r = await canaryFor().run();
    expect(r.unindexed).toBe(1);
    expect(r.failures.map((f) => f.id)).not.toContain('i1'); // counted, not probed
  });

  it('honours the scope predicate', async () => {
    // i6 is is_listed = 0 and must never be probed or counted
    const r = await canaryFor({ sampleSize: 99 }).run();
    expect(r.sampled).toBe(5);
    expect(r.failures.map((f) => f.id)).not.toContain('i6');
  });

  it('skips entities no name search could single out', async () => {
    // Give everything the same tokens: nothing is identifiable, so nothing is
    // probed — silence beats reporting a failure the index cannot fix.
    db.exec("UPDATE items SET name = 'Studio Jogi', name_n = 'studio jogi'");
    const r = await canaryFor({ maxTokenDf: 2 }).run();
    expect(r.sampled).toBe(0);
    expect(r.failures).toEqual([]);
  });
});
