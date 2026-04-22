import { describe, it, expect } from 'vitest';
import {
  normalize, stripDiacriticsGeneric, trigrams, trigramSimilarity,
  levenshtein, levenshteinSimilarity, isPostcode,
  hasGeoIntent, stripGeoIntent, stripStopWords,
} from './normalize.js';
import { plLocale } from '../locales/pl.js';

describe('stripDiacriticsGeneric', () => {
  it('strips common diacritics', () => {
    expect(stripDiacriticsGeneric('café')).toBe('cafe');
    expect(stripDiacriticsGeneric('naïve')).toBe('naive');
  });
});

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  Hello World  ')).toBe('hello world');
  });

  it('strips Polish diacritics with locale', () => {
    expect(normalize('Kraków', plLocale)).toBe('krakow');
    expect(normalize('Łódź', plLocale)).toBe('lodz');
  });

  it('removes special characters', () => {
    expect(normalize('yoga & pilates!')).toBe('yoga pilates');
  });

  it('returns empty for empty input', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null as unknown as string)).toBe('');
  });
});

describe('trigrams', () => {
  it('generates trigrams from word', () => {
    expect(trigrams('hatha')).toEqual(['hat', 'ath', 'tha']);
  });

  it('returns short tokens as-is', () => {
    expect(trigrams('ab')).toEqual(['ab']);
  });

  it('returns empty for empty input', () => {
    expect(trigrams('')).toEqual([]);
  });

  it('deduplicates', () => {
    const result = trigrams('aaa');
    expect(result).toEqual(['aaa']);
  });

  it('handles multi-word input', () => {
    const result = trigrams('hot yoga');
    expect(result).toContain('hot');
    expect(result).toContain('yog');
    expect(result).toContain('oga');
  });
});

describe('trigramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(trigramSimilarity('hatha', 'hatha')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('returns partial similarity for similar strings', () => {
    const sim = trigramSimilarity('hatha', 'hata');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length for empty string', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
  });

  it('counts single edit', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical', () => {
    expect(levenshteinSimilarity('hatha', 'hatha')).toBe(1);
  });

  it('returns high for similar (hata → hatha)', () => {
    expect(levenshteinSimilarity('hata', 'hatha')).toBeGreaterThan(0.7);
  });

  it('returns low for different (inowroclaw → wroclaw)', () => {
    expect(levenshteinSimilarity('inowroclaw', 'wroclaw')).toBeLessThan(0.75);
  });
});

describe('isPostcode', () => {
  it('matches XX-XXX format', () => {
    expect(isPostcode('30-001')).toBe(true);
  });

  it('matches XXXXX format', () => {
    expect(isPostcode('30001')).toBe(true);
  });

  it('rejects invalid', () => {
    expect(isPostcode('hello')).toBe(false);
    expect(isPostcode('123456')).toBe(false);
  });
});

describe('hasGeoIntent (with Polish locale)', () => {
  it('detects "blisko mnie"', () => {
    expect(hasGeoIntent('joga blisko mnie', plLocale)).toBe(true);
  });

  it('detects "near me"', () => {
    expect(hasGeoIntent('yoga near me', plLocale)).toBe(true);
  });

  it('detects "nearby"', () => {
    expect(hasGeoIntent('yoga nearby', plLocale)).toBe(true);
  });

  it('returns false without locale', () => {
    expect(hasGeoIntent('blisko mnie')).toBe(false);
  });

  it('returns false for non-geo query', () => {
    expect(hasGeoIntent('hatha yoga', plLocale)).toBe(false);
  });
});

describe('stripGeoIntent', () => {
  it('strips "blisko mnie"', () => {
    expect(stripGeoIntent('joga blisko mnie', plLocale)).toBe('joga');
  });

  it('strips "near me"', () => {
    expect(stripGeoIntent('yoga near me', plLocale)).toBe('yoga');
  });
});

describe('stripStopWords (with Polish locale)', () => {
  it('strips yoga-related stop words', () => {
    expect(stripStopWords('joga hatha', plLocale)).toBe('hatha');
  });

  it('strips multi-word stop phrases', () => {
    expect(stripStopWords('szkola jogi krakow', plLocale)).toBe('krakow');
  });

  it('strips Polish prepositions', () => {
    expect(stripStopWords('w krakowie na mokotowie', plLocale)).toBe('krakowie mokotowie');
  });

  it('returns empty for all-stop query', () => {
    expect(stripStopWords('joga yoga', plLocale)).toBe('');
  });
});
