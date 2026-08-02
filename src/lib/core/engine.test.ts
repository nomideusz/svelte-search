import { describe, it, expect } from 'vitest';
import { createSearchEngine } from './engine.js';
import type { DatabaseClient, SchemaAdapter, SearchResult } from './types.js';
import { plLocale } from '../locales/pl.js';

// ── Fake DB ────────────────────────────────────────────────
// Doubles as executable documentation of the DatabaseClient contract:
// one `execute()` taking {sql, args} and returning {rows}.

interface Call { sql: string; args: unknown[] }

function fakeDb(handler: (sql: string) => Record<string, unknown>[]) {
  const calls: Call[] = [];
  const db: DatabaseClient = {
    async execute(q) {
      const { sql, args } = typeof q === 'string' ? { sql: q, args: [] } : q;
      calls.push({ sql, args });
      return { rows: handler(sql) };
    },
  };
  return { db, calls, find: (frag: string) => calls.find(c => c.sql.includes(frag)) };
}

const adapter: SchemaAdapter<SearchResult> = {
  tables: { entities: 'items', trigrams: 'item_trigrams', fts: 'items_fts', synonyms: 'synonyms' },
  columns: {
    id: 'id', name: 'name', nameNormalized: 'name_n', slug: 'slug',
    lat: 'lat', lng: 'lng', locationSlug: 'city_slug',
    categoriesNormalized: 'cats_n', locationNormalized: 'city_n', areaNormalized: 'area_n',
  },
  trigramColumns: { trigram: 'trigram', entityId: 'item_id', field: 'field' },
  toResult(row, lat, lng) {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      lat: (row.lat as number) ?? null,
      lng: (row.lng as number) ?? null,
      distanceKm: null,
      walkingMin: null,
      score: 0,
      _hasFts: row._ftsRank != null,
      _nameN: (row.name_n as string) || '',
      _locationN: (row.city_n as string) || '',
      _categoriesN: (row.cats_n as string) || '',
    };
  },
  trigramFields(e) {
    return [{ text: e.name as string, field: 'name' }];
  },
};

const INTERNALS = ['_hasFts', '_nameN', '_locationN', '_categoriesN'];

function row(over: Record<string, unknown> = {}) {
  return {
    id: '1', name: 'Hatha Studio', slug: 'hatha-studio', name_n: 'hatha studio',
    city_n: 'krakow', cats_n: 'hatha', lat: 50.06, lng: 19.94, ...over,
  };
}

describe('createSearchEngine — result hygiene', () => {
  it('strips internal fields from the FTS path', async () => {
    const { db } = fakeDb(sql => (sql.includes('items_fts') ? [row({ _ftsRank: -5 })] : []));
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'hatha' });
    expect(results).toHaveLength(1);
    for (const k of INTERNALS) expect(results[0]).not.toHaveProperty(k);
  });

  it('strips internal fields from the location-only path', async () => {
    // No query + locationSlug → searchAllInLocation
    const { db } = fakeDb(() => [row()]);
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: '', locationSlug: 'krakow' });
    expect(results).toHaveLength(1);
    for (const k of INTERNALS) expect(results[0]).not.toHaveProperty(k);
  });

  it('strips internal fields from the geo-only path', async () => {
    const { db } = fakeDb(() => [row()]);
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: '', lat: 50.06, lng: 19.94 });
    expect(results).toHaveLength(1);
    for (const k of INTERNALS) expect(results[0]).not.toHaveProperty(k);
  });
});

describe('createSearchEngine — category constraint', () => {
  it('applies categorySlug to the fuzzy fallback, not just FTS', async () => {
    // FTS returns nothing → fuzzy fallback runs. Both must be category-scoped,
    // otherwise a style-filtered search leaks entities without that style.
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'hatha', categorySlug: 'yin-yoga' });

    const fuzzy = find('item_trigrams');
    expect(fuzzy, 'fuzzy fallback should have run').toBeDefined();
    expect(fuzzy!.sql).toContain('cats_n LIKE');
    expect(fuzzy!.args).toContain('%yin yoga%');
  });

  it('applies locationSlug to the fuzzy fallback', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'hatha', locationSlug: 'krakow' });
    const fuzzy = find('item_trigrams');
    expect(fuzzy!.args).toContain('krakow');
  });
});

describe('createSearchEngine — fuzzy quality gate', () => {
  it('keeps a genuine typo (hata → hatha)', async () => {
    const { db } = fakeDb(sql =>
      sql.includes('item_trigrams') ? [row({ _fuzzyScore: 0.8 })] : []);
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'hatha' });
    expect(results.map(r => r.id)).toEqual(['1']);
  });

  it('rejects a fuzzy-only near-miss (inowroclaw should not match wroclaw)', async () => {
    const { db } = fakeDb(sql =>
      sql.includes('item_trigrams')
        ? [row({ id: '2', name: 'Wrocław Studio', name_n: 'wroclaw', city_n: 'wroclaw', cats_n: '', _fuzzyScore: 0.6 })]
        : []);
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'inowroclaw' });
    expect(results).toEqual([]);
  });

  it('never gates out an FTS match', async () => {
    // Same near-miss row, but with an FTS rank — FTS hits bypass the gate.
    const { db } = fakeDb(sql =>
      sql.includes('items_fts')
        ? [row({ id: '2', name: 'Wrocław Studio', name_n: 'wroclaw', city_n: 'wroclaw', cats_n: '', _ftsRank: -3 })]
        : []);
    const { results } = await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'inowroclaw' });
    expect(results.map(r => r.id)).toEqual(['2']);
  });
});

describe('createSearchEngine — dialects', () => {
  it('emits numbered placeholders and tsquery syntax for postgres', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale, dialect: 'postgres' })
      .search({ query: 'hatha joga', locationSlug: 'krakow' });

    const fts = find('to_tsquery');
    expect(fts).toBeDefined();
    expect(fts!.sql).toContain('$1');
    expect(fts!.args[0]).toBe('hatha:*');  // "joga" is a Polish stop word
  });

  it('emits ? placeholders and FTS5 prefix syntax for sqlite', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale })
      .search({ query: 'hatha' });
    const fts = find('items_fts MATCH');
    expect(fts!.sql).toContain('MATCH ?');
    expect(fts!.args[0]).toBe('"hatha"*');
  });
});

describe('createSearchEngine — stop words', () => {
  it('drops locale stop words from the FTS query', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale }).search({ query: 'hatha joga' });
    // "joga" OR'd in would match nearly every row in a yoga directory
    expect(find('items_fts MATCH')!.args[0]).toBe('"hatha"*');
  });

  it('keeps the stop word when it is the entire query', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale }).search({ query: 'joga' });
    expect(find('items_fts MATCH')!.args[0]).toBe('"joga"*');
  });

  it('is a no-op without a locale', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter }).search({ query: 'hatha joga' });
    expect(find('items_fts MATCH')!.args[0]).toBe('"hatha"* OR "joga"*');
  });
});

describe('createSearchEngine — weighted bm25', () => {
  it('uses bm25() with weights when ftsColumnWeights is set', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale, ftsColumnWeights: [10, 4, 0.5] })
      .search({ query: 'hatha' });
    expect(find('items_fts MATCH')!.sql).toContain('bm25(items_fts, 10, 4, 0.5)');
  });

  it('still discriminates when weights push bm25 magnitudes past the old /20 divisor', async () => {
    // Identical names, so only the FTS rank can separate them. Fed worst-first.
    const rows = [
      row({ id: 'mediocre', _ftsRank: -25 }),
      row({ id: 'excellent', _ftsRank: -60 }),
    ];
    const { db } = fakeDb(sql => (sql.includes('items_fts') ? rows : []));
    const { results } = await createSearchEngine({
      db, adapter, locale: plLocale, ftsColumnWeights: [10, 4, 4, 4, 3, 2, 0.5],
    }).search({ query: 'hatha' });
    expect(results.map(r => r.id)).toEqual(['excellent', 'mediocre']);
  });

  it('falls back to fts.rank when unset', async () => {
    const { db, find } = fakeDb(() => []);
    await createSearchEngine({ db, adapter, locale: plLocale }).search({ query: 'hatha' });
    expect(find('items_fts MATCH')!.sql).toContain('fts.rank');
  });
});
