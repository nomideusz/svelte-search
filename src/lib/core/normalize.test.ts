import { describe, it, expect } from 'vitest';
import {
  normalize, stripDiacriticsGeneric, trigrams, trigramSimilarity,
  levenshtein, levenshteinSimilarity, bestWordSimilarity, isPostcode, findPostcode,
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

describe('normalize — letters of any language', () => {
  // NFD leaves these whole; the old [a-z0-9] filter then deleted them
  const cases: [string, string][] = [
    ['Szkoły', 'szkoly'],
    ['Łódź', 'lodz'],
    ['Straße', 'strasse'],
    ['Ørsted', 'orsted'],
    ['Đakovo Æble Œuvre Þór', 'dakovo aeble oeuvre thor'],
    ['İstanbul', 'istanbul'],
    ['Київ', 'киів'],
    ['Αθήνα', 'αθηνα'],
    ['योग स्टूडियो', 'योग स्टूडियो'],
  ];
  for (const [input, want] of cases) {
    it(`${input} → ${want}`, () => {
      expect(normalize(input)).toBe(want);
      expect(normalize(input, plLocale)).toBe(want);
    });
  }

  it('still drops punctuation and symbols', () => {
    expect(normalize('S.U.N. Festival! ✨ €20')).toBe('s u n festival 20');
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

  it('counts a swap of adjacent letters as one edit', () => {
    expect(levenshtein('pilatse', 'pilates')).toBe(1);
    expect(levenshteinSimilarity('pilatse', 'pilates')).toBeGreaterThanOrEqual(0.75);
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

describe('bestWordSimilarity', () => {
  it('matches a typo of one word in a multi-word field', () => {
    // whole-field similarity is ~0.17 — per-word must rescue it
    expect(bestWordSimilarity('triranta', 'triratna warszawa buddyzm i medytacja mokotow')).toBeGreaterThanOrEqual(0.75);
  });

  it('still rejects unrelated words', () => {
    expect(bestWordSimilarity('inowroclaw', 'szkola jogi wroclaw')).toBeLessThan(0.75);
  });

  it('falls back to whole-field for single-word fields', () => {
    expect(bestWordSimilarity('krakof', 'krakow')).toBeGreaterThanOrEqual(0.75);
  });

  it('returns 0 for empty field', () => {
    expect(bestWordSimilarity('anything', '')).toBe(0);
  });
});

describe('isPostcode (Polish locale)', () => {
  it('matches XX-XXX format', () => {
    expect(isPostcode('30-001', plLocale)).toBe(true);
  });

  it('matches XXXXX format', () => {
    expect(isPostcode('30001', plLocale)).toBe(true);
  });

  it('rejects invalid', () => {
    expect(isPostcode('hello', plLocale)).toBe(false);
    expect(isPostcode('123456', plLocale)).toBe(false);
  });
});

describe('postcodes are locale-driven', () => {
  const ukLocale = {
    stripDiacritics: (s: string) => s,
    stopTokens: new Set<string>(),
    stopPhrases: [],
    geoPatterns: [],
    postcodePattern: /\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i,
    formatPostcode: (m: RegExpMatchArray) => m[0].toUpperCase().replace(/\s+/g, ' '),
  };

  it('finds none without a locale pattern — a bare number is not a postcode', () => {
    expect(findPostcode('studio 54 10115 berlin')).toBeNull();
    expect(isPostcode('30-001')).toBe(false);
  });

  it('reads the Polish shape under plLocale', () => {
    expect(findPostcode('hatha 30-001 krakow', plLocale)).toEqual({ postcode: '30-001', raw: '30-001' });
    // canonicalizes the hyphenless form
    expect(findPostcode('30001', plLocale)?.postcode).toBe('30-001');
  });

  it('honours a non-Polish pattern', () => {
    expect(findPostcode('yoga SW1A 1AA london', ukLocale)?.postcode).toBe('SW1A 1AA');
    // The Polish shape must not be picked up under a UK locale
    expect(findPostcode('30-001', ukLocale)).toBeNull();
  });

  it('isPostcode follows the same pattern', () => {
    expect(isPostcode('SW1A 1AA', ukLocale)).toBe(true);
    expect(isPostcode('30-001', ukLocale)).toBe(false);
    expect(isPostcode('30-001', plLocale)).toBe(true);
  });

  it('returns the raw match so callers can cut it out of the query', () => {
    const found = findPostcode('hatha 30001', plLocale)!;
    expect(found.raw).toBe('30001');       // what to remove
    expect(found.postcode).toBe('30-001'); // what to display/geocode
  });
});

describe('geo intent without a locale', () => {
  it('detects English "near me" out of the box', () => {
    expect(hasGeoIntent('yoga near me')).toBe(true);
    expect(hasGeoIntent('studios nearby')).toBe(true);
    expect(hasGeoIntent('hatha in warsaw')).toBe(false);
  });

  it('strips the phrase it detected', () => {
    expect(stripGeoIntent('yoga near me')).toBe('yoga');
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
  // A directory's domain words are the app's to add, not the locale's
  const yogaLocale = {
    ...plLocale,
    stopTokens: new Set([...plLocale.stopTokens, 'joga', 'yoga']),
    stopPhrases: ['szkola jogi'],
  };

  it('keeps domain words: the Polish locale strips grammar only', () => {
    expect(stripStopWords('joga hatha', plLocale)).toBe('joga hatha');
  });

  it('strips an app-extended stop word', () => {
    expect(stripStopWords('joga hatha', yogaLocale)).toBe('hatha');
  });

  it('strips multi-word stop phrases', () => {
    expect(stripStopWords('szkola jogi krakow', yogaLocale)).toBe('krakow');
  });

  it('strips Polish prepositions', () => {
    expect(stripStopWords('w krakowie na mokotowie', plLocale)).toBe('krakowie mokotowie');
  });

  it('returns empty for all-stop query', () => {
    expect(stripStopWords('w na do', plLocale)).toBe('');
  });
});
