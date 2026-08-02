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

  it('handles towns the suffix rules used to mangle', () => {
    // feminine -ica → -icy (rules said "Dębicie")
    expect(polishLocative('Dębica')).toBe('Dębicy');
    // -iec → -cu (rules said "Bolesławiecie")
    expect(polishLocative('Bolesławiec')).toBe('Bolesławcu');
    // hyphenated with noun -ko (rules said "Bielskie-Białej")
    expect(polishLocative('Bielsko-Biała')).toBe('Bielsku-Białej');
    // -nia → -ni (rules said "Wrześniie")
    expect(polishLocative('Września')).toBe('Wrześni');
    // feminine Ostrów, unlike masculine Ostrów Wielkopolski
    expect(polishLocative('Ostrów Mazowiecka')).toBe('Ostrowi Mazowieckiej');
    expect(polishLocative('Ostrów Wielkopolski')).toBe('Ostrowie Wielkopolskim');
    // fossilized instrumental
    expect(polishLocative('Zakopane')).toBe('Zakopanem');
    // plural -y → -ach
    expect(polishLocative('Brzeziny')).toBe('Brzezinach');
    // declining "nad X" tail stays untouched
    expect(polishLocative('Kostrzyn nad Odrą')).toBe('Kostrzynie nad Odrą');
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

  // Stems are matched against a lookup map keyed by the nominative, so
  // producing a shorter prefix is not enough — "Katowicach" has to reach
  // "katowice", not just "katowic". These are the forms Poles actually type.
  it.each([
    ['warszawie', 'warszawa'], ['warszawy', 'warszawa'], ['krakowie', 'krakow'],
    ['lodzi', 'lodz'], ['poznaniu', 'poznan'], ['toruniu', 'torun'],
    ['gdansku', 'gdansk'], ['wroclawiu', 'wroclaw'], ['katowicach', 'katowice'],
    ['lublinie', 'lublin'], ['szczecinie', 'szczecin'], ['bydgoszczy', 'bydgoszcz'],
    ['gdyni', 'gdynia'], ['czestochowie', 'czestochowa'], ['radomiu', 'radom'],
    ['sosnowcu', 'sosnowiec'], ['kielcach', 'kielce'], ['gliwicach', 'gliwice'],
    ['olsztynie', 'olsztyn'], ['rzeszowie', 'rzeszow'], ['opolu', 'opole'],
    ['bialymstoku', 'bialystok'], ['zakopanem', 'zakopane'], ['bytomiu', 'bytom'],
    ['tychach', 'tychy'], ['zabrzu', 'zabrze'], ['legnicy', 'legnica'],
    ['zielonej gorze', 'zielona gora'], ['nowym saczu', 'nowy sacz'],
    ['jeleniej gorze', 'jelenia gora'],
  ])('%s reaches the nominative %s', (typed, nominative) => {
    expect(polishLocationStems(typed)).toContain(nominative);
  });

  it('does not expand a word no rule applies to', () => {
    // Street adjectives must not sprout city candidates
    expect(polishLocationStems('krakowska')).toEqual(['krakowska']);
  });

  it('keeps the candidate list small enough to look up per keystroke', () => {
    expect(polishLocationStems('krakowie').length).toBeLessThan(20);
  });
});
