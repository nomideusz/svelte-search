import { describe, it, expect } from 'vitest';
import { plLocale, polishLocative, polishLocationStems } from './pl.js';

describe('plLocale.stripDiacritics', () => {
  it('strips Polish characters', () => {
    expect(plLocale.stripDiacritics('Kraków')).toBe('Krakow');
    expect(plLocale.stripDiacritics('Łódź')).toBe('Lodz');
    expect(plLocale.stripDiacritics('Częstochowa')).toBe('Czestochowa');
  });
});

describe('polishLocative', () => {
  it('handles major cities', () => {
    expect(polishLocative('Kraków')).toBe('Krakowie');
    expect(polishLocative('Warszawa')).toBe('Warszawie');
    expect(polishLocative('Łódź')).toBe('Łodzi');
    expect(polishLocative('Wrocław')).toBe('Wrocławiu');
    expect(polishLocative('Poznań')).toBe('Poznaniu');
    expect(polishLocative('Gdańsk')).toBe('Gdańsku');
    expect(polishLocative('Katowice')).toBe('Katowicach');
  });

  it('handles multi-word city names', () => {
    expect(polishLocative('Bielany Wrocławskie')).toBe('Bielanach Wrocławskich');
    expect(polishLocative('Suchy Las')).toBe('Suchym Lesie');
  });

  it('handles rule-based fallback', () => {
    // -ów → -owie
    expect(polishLocative('Tarnów')).toBe('Tarnowie');
    // -a → -ie (via irregular map)
    expect(polishLocative('Warszawa')).toBe('Warszawie');
  });
});

describe('polishLocationStems', () => {
  it('stems locative to nominative', () => {
    const stems = polishLocationStems('krakowie');
    expect(stems).toContain('krakow');
  });

  it('stems genitive', () => {
    const stems = polishLocationStems('warszawy');
    expect(stems).toContain('warszaw');
  });

  it('returns original for nominative', () => {
    const stems = polishLocationStems('krakow');
    expect(stems).toContain('krakow');
  });

  it('handles multi-word stems', () => {
    const stems = polishLocationStems('zielonej gory');
    // Should produce combinations
    expect(stems.length).toBeGreaterThan(1);
  });
});
