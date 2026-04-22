import { describe, it, expect } from 'vitest';
import { parseQuery, findMatchingArea, findNearestLocationWithEntities } from './resolver.js';
import type { ResolverLookups } from './types.js';
import { plLocale } from '../locales/pl.js';

const lookups: ResolverLookups = {
  locationMap: new Map([
    ['krakow', 'krakow'],
    ['warszawa', 'warszawa'],
    ['lodz', 'lodz'],
    ['zielona gora', 'zielona-gora'],
  ]),
  categoryMap: new Map([
    ['hatha', 'hatha-yoga'],
    ['vinyasa', 'vinyasa-yoga'],
    ['yin', 'yin-yoga'],
  ]),
  areaMap: new Map([
    ['krakow', ['zwierzyniec', 'krowodrza', 'podgorze']],
    ['warszawa', ['mokotow', 'ursynow', 'wola']],
  ]),
  locationEntityCount: new Map([
    ['krakow', 15],
    ['warszawa', 20],
    ['lodz', 5],
    ['zielona-gora', 0],
  ]),
  locationGeo: new Map([
    ['krakow', { lat: 50.06, lng: 19.94, name: 'Kraków' }],
    ['warszawa', { lat: 52.23, lng: 21.01, name: 'Warszawa' }],
    ['lodz', { lat: 51.77, lng: 19.45, name: 'Łódź' }],
  ]),
};

describe('parseQuery', () => {
  it('parses city-only query', () => {
    const result = parseQuery('Kraków', lookups, plLocale);
    expect(result.location?.slug).toBe('krakow');
    expect(result.category).toBeNull();
    expect(result.rest).toEqual([]);
  });

  it('parses category-only query', () => {
    const result = parseQuery('hatha', lookups, plLocale);
    expect(result.location).toBeNull();
    expect(result.category?.slug).toBe('hatha-yoga');
  });

  it('parses city + category', () => {
    const result = parseQuery('hatha Kraków', lookups, plLocale);
    expect(result.location?.slug).toBe('krakow');
    expect(result.category?.slug).toBe('hatha-yoga');
  });

  it('detects geo intent', () => {
    const result = parseQuery('hatha blisko mnie', lookups, plLocale);
    expect(result.geoIntent).toBe(true);
    expect(result.category?.slug).toBe('hatha-yoga');
  });

  it('extracts postal code', () => {
    const result = parseQuery('30-001 hatha', lookups, plLocale);
    expect(result.postal).toBe('30-001');
    expect(result.category?.slug).toBe('hatha-yoga');
  });

  it('handles bigram location (zielona góra)', () => {
    const result = parseQuery('zielona góra', lookups, plLocale);
    expect(result.location?.slug).toBe('zielona-gora');
  });

  it('returns empty for empty input', () => {
    const result = parseQuery('', lookups, plLocale);
    expect(result.normalized).toBe('');
    expect(result.location).toBeNull();
    expect(result.category).toBeNull();
  });

  it('strips stop words before classifying', () => {
    const result = parseQuery('joga w Krakowie', lookups, plLocale);
    // "joga" and "w" stripped, "krakowie" stemmed to "krakow"
    expect(result.location?.slug).toBe('krakow');
  });

  it('puts unclassified tokens in rest', () => {
    const result = parseQuery('Kraków mokotów', lookups, plLocale);
    // mokotów is not a location/category, ends up in rest
    expect(result.location?.slug).toBe('krakow');
    expect(result.rest).toContain('mokotow');
  });
});

describe('findMatchingArea', () => {
  it('finds matching district', () => {
    const area = findMatchingArea('zwierzyniec', 'krakow', lookups, plLocale);
    expect(area).toBe('zwierzyniec');
  });

  it('returns null for non-matching query', () => {
    const area = findMatchingArea('bielany', 'krakow', lookups, plLocale);
    expect(area).toBeNull();
  });

  it('returns null for wrong location', () => {
    const area = findMatchingArea('mokotow', 'krakow', lookups, plLocale);
    expect(area).toBeNull();
  });
});

describe('findNearestLocationWithEntities', () => {
  it('finds nearest city with entities', () => {
    // From Zielona Góra coords (51.94, 15.50) — Łódź should be nearest with entities
    const result = findNearestLocationWithEntities(51.94, 15.50, lookups);
    expect(result).not.toBeNull();
    expect(result!.count).toBeGreaterThan(0);
  });

  it('excludes specified slug', () => {
    const result = findNearestLocationWithEntities(50.06, 19.94, lookups, 'krakow');
    expect(result).not.toBeNull();
    expect(result!.slug).not.toBe('krakow');
  });

  it('returns null if no geo data', () => {
    const emptyLookups: ResolverLookups = {
      locationMap: new Map(),
      categoryMap: new Map(),
      areaMap: new Map(),
    };
    const result = findNearestLocationWithEntities(50.0, 20.0, emptyLookups);
    expect(result).toBeNull();
  });
});
