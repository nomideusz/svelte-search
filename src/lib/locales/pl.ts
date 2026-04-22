// ============================================================
// @nomideusz/svelte-search — Polish locale
// ============================================================
// Polish-specific search features: diacritics, stop words,
// geo intent patterns, city name stemming, locative case.

import type { SearchLocale } from '../core/types.js';

// ── Diacritics ─────────────────────────────────────────────

const PL_DIACRITICS: Record<string, string> = {
  'ą': 'a', 'Ą': 'A', 'ć': 'c', 'Ć': 'C', 'ę': 'e', 'Ę': 'E',
  'ł': 'l', 'Ł': 'L', 'ń': 'n', 'Ń': 'N', 'ó': 'o', 'Ó': 'O',
  'ś': 's', 'Ś': 'S', 'ź': 'z', 'Ź': 'Z', 'ż': 'z', 'Ż': 'Z',
};

function stripPolishDiacritics(text: string): string {
  let r = '';
  for (const c of text) r += PL_DIACRITICS[c] ?? c;
  return r.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Stop words ─────────────────────────────────────────────

const PL_STOP_PHRASES = [
  'szkola jogi', 'szkoly jogi',
  'studio jogi', 'studia jogi',
  'zajecia jogi', 'lekcje jogi', 'klasy jogi',
  'yoga studio', 'yoga school', 'yoga class',
];

const PL_STOP_TOKENS = new Set([
  // Site-generic
  'joga', 'yoga',
  // Polish prepositions & particles
  'w', 'z', 'na', 'do', 'od', 'dla', 'i', 'o', 'u', 'ze',
  'przy', 'po', 'pod', 'nad', 'za', 'przed', 'miedzy', 'lub',
  // Common filler words
  'sie', 'jak', 'co', 'to', 'jest', 'sa', 'nie', 'tak', 'czy',
  'tu', 'tam', 'ten', 'ta', 'te',
  // Common in location queries
  'okolicy', 'okolice', 'okolica', 'okolicach', 'okolicami',
  'poblizu', 'rejon', 'rejonie', 'rejonu',
  'sasiedztwie', 'centrum', 'okolo',
  'praca', 'kurs', 'kursy', 'lekcje', 'zajecia', 'treningi',
]);

// ── Geo intent patterns ────────────────────────────────────

const PL_GEO_PATTERNS = [
  /\bblisko\s+mnie\b/i,
  /\bblisko\b/i,
  /\bniedaleko\b/i,
  /\bw\s+poblizu\b/i,
  /\bobok\b/i,
  /\bw\s+okolic\w*\b/i,
  /\bnajblizej\b/i,
  /\bnajblizsz\w*/i,
  /\bkolo\s+mnie\b/i,
  /\bw\s+sasiedztwie\b/i,
  /\bw\s+moim\s+rejonie\b/i,
  // English (universal)
  /\bnear\s*me\b/i,
  /\bnearby\b/i,
  /\bclosest\b/i,
  /\baround\s+me\b/i,
];

// ── City name stemming ─────────────────────────────────────

const STEM_RULES: [RegExp, string][] = [
  [/owie$/, 'ow'],
  [/odzi$/, 'odz'],
  [/owej$/, 'owa'],
  [/ach$/, ''],
  [/ami$/, ''],
  [/nie$/, 'n'],
  [/cie$/, 'c'],
  [/zie$/, 'z'],
  [/skie$/, 'sk'],
  [/y$/, ''],
  [/i$/, ''],
  [/e$/, ''],
  [/u$/, ''],
];

function stemWord(word: string): string[] {
  const stems = [word];
  for (const [re, replacement] of STEM_RULES) {
    if (re.test(word)) {
      const stem = word.replace(re, replacement);
      if (stem.length >= 3 && stem !== word) stems.push(stem);
    }
  }
  return stems;
}

function polishLocationStems(token: string): string[] {
  const words = token.split(/\s+/);
  if (words.length === 1) return stemWord(token);

  const wordStems = words.map(w => stemWord(w));
  const results = new Set<string>([token]);

  function combine(idx: number, current: string[]) {
    if (idx === wordStems.length) {
      results.add(current.join(' '));
      return;
    }
    for (const stem of wordStems[idx]) {
      current.push(stem);
      combine(idx + 1, current);
      current.pop();
    }
  }
  combine(0, []);
  return [...results];
}

// ── Polish locative case ───────────────────────────────────
// Used for display: "w Krakowie", "w Łodzi", "w Warszawie"

const LOCATIVE_IRREGULARS: Record<string, string> = {
  'Kraków': 'Krakowie',
  'Wrocław': 'Wrocławiu',
  'Łódź': 'Łodzi',
  'Poznań': 'Poznaniu',
  'Gdańsk': 'Gdańsku',
  'Gdynia': 'Gdyni',
  'Szczecin': 'Szczecinie',
  'Bydgoszcz': 'Bydgoszczy',
  'Lublin': 'Lublinie',
  'Białystok': 'Białymstoku',
  'Katowice': 'Katowicach',
  'Częstochowa': 'Częstochowie',
  'Radom': 'Radomiu',
  'Sosnowiec': 'Sosnowcu',
  'Toruń': 'Toruniu',
  'Kielce': 'Kielcach',
  'Rzeszów': 'Rzeszowie',
  'Gliwice': 'Gliwicach',
  'Olsztyn': 'Olsztynie',
  'Zabrze': 'Zabrzu',
  'Opole': 'Opolu',
  'Tychy': 'Tychach',
  'Płock': 'Płocku',
  'Elbląg': 'Elblągu',
  'Tarnów': 'Tarnowie',
  'Chorzów': 'Chorzowie',
  'Bytom': 'Bytomiu',
  'Piła': 'Pile',
  'Legnica': 'Legnicy',
  'Jaworzno': 'Jaworznie',
  'Siedlce': 'Siedlcach',
  'Mysłowice': 'Mysłowicach',
  'Konin': 'Koninie',
  'Inowrocław': 'Inowrocławiu',
  'Skierniewice': 'Skierniewicach',
  'Sopot': 'Sopocie',
  'Warszawa': 'Warszawie',
  'Bełchatów': 'Bełchatowie',
  'Bielany Wrocławskie': 'Bielanach Wrocławskich',
  'Borkowo': 'Borkowie',
  'Brzozówka': 'Brzozówce',
  'Czeladź': 'Czeladzi',
  'Górki': 'Górkach',
  'Kamionki': 'Kamionkach',
  'Komorniki': 'Komornikach',
  'Konstantynów Łódzki': 'Konstantynowie Łódzkim',
  'Kowale': 'Kowalach',
  'Koziegłowy': 'Koziegłowach',
  'Luboń': 'Luboniu',
  'Mierzyn': 'Mierzynie',
  'Mikołów': 'Mikołowie',
  'Monte': 'Monte',
  'Niemcz': 'Niemczu',
  'Osielsko': 'Osielsku',
  'Owińska': 'Owińskach',
  'Piekary Śląskie': 'Piekarach Śląskich',
  'Pilchowice': 'Pilchowicach',
  'Plewiska': 'Plewiskach',
  'Przeźmierowo': 'Przeźmierowie',
  'Sierosław': 'Sierosławiu',
  'Skórzewo': 'Skórzewie',
  'Suchy Dwór': 'Suchym Dworze',
  'Suchy Las': 'Suchym Lesie',
  'Wiry': 'Wirach',
  'Wola Kopcowa': 'Woli Kopcowej',
  'Wysoka': 'Wysokiej',
  'Zgierz': 'Zgierzu',
  // Adjective-level irregulars (for multi-word names)
  'Ruda': 'Rudzie', 'Wola': 'Woli', 'Dąbrowa': 'Dąbrowie',
  'Nowy': 'Nowym', 'Nowa': 'Nowej', 'Stary': 'Starym', 'Stara': 'Starej',
  'Wielka': 'Wielkiej', 'Wielki': 'Wielkim',
  'Mały': 'Małym', 'Mała': 'Małej',
  'Dolna': 'Dolnej', 'Dolny': 'Dolnym',
  'Górna': 'Górnej', 'Górny': 'Górnym',
  'Suchy': 'Suchym', 'Sucha': 'Suchej',
};

function locativeWord(w: string): string {
  if (LOCATIVE_IRREGULARS[w]) return LOCATIVE_IRREGULARS[w];

  // Adjective endings
  if (w.endsWith('owa')) return w.slice(0, -1) + 'ej';
  if (w.endsWith('owy')) return w.slice(0, -1) + 'ym';
  if (w.endsWith('ska')) return w.slice(0, -1) + 'iej';
  if (w.endsWith('cka')) return w.slice(0, -1) + 'iej';
  if (w.endsWith('ski') || w.endsWith('cki')) return w + 'm';
  if (w.endsWith('na')) return w.slice(0, -1) + 'ej';
  if (w.endsWith('ny')) return w.slice(0, -1) + 'ym';
  if (w.endsWith('cza')) return w.slice(0, -1) + 'ej';
  if (w.endsWith('sza')) return w.slice(0, -1) + 'ej';
  if (w.endsWith('ła')) return w.slice(0, -1) + 'ej';
  if (w.endsWith('ły')) return w.slice(0, -1) + 'ym';

  // Noun endings
  if (w.endsWith('ów')) return w.slice(0, -2) + 'owie';
  if (w.endsWith('ław')) return w + 'iu';
  if (w.endsWith('in') || w.endsWith('yn')) return w + 'ie';
  if (w.endsWith('ań') || w.endsWith('eń') || w.endsWith('uń')) return w.slice(0, -1) + 'niu';
  if (w.endsWith('ek')) return w.slice(0, -2) + 'ku';
  if (w.endsWith('ice') || w.endsWith('yce')) return w.slice(0, -1) + 'ach';
  if (w.endsWith('la')) return w.slice(0, -1) + 'i';
  if (w.endsWith('a')) return w.slice(0, -1) + 'ie';
  if (w.endsWith('o')) return w.slice(0, -1) + 'ie';
  if (w.endsWith('e')) return w.slice(0, -1) + 'u';
  if (w.endsWith('y')) return w.slice(0, -1) + 'ach';
  if (/(?:k|g|ch|sz|cz|rz|ż|ąg|ąk)$/.test(w)) return w + 'u';
  return w + 'ie';
}

/**
 * Polish locative case for city names.
 * "Kraków" → "Krakowie", used in "w Krakowie" (in Kraków).
 */
export function polishLocative(city: string): string {
  const c = city.trim();
  if (LOCATIVE_IRREGULARS[c]) return LOCATIVE_IRREGULARS[c];

  // Multi-word names: decline each word separately
  const parts = c.split(/(\s+|-)/);
  if (parts.filter(p => p.trim() && p !== '-').length > 1) {
    return parts.map(p => {
      if (!p.trim() || p === '-') return p;
      return locativeWord(p);
    }).join('');
  }

  return locativeWord(c);
}

// ── Export locale ──────────────────────────────────────────

export const plLocale: SearchLocale = {
  stripDiacritics: stripPolishDiacritics,
  stopTokens: PL_STOP_TOKENS,
  stopPhrases: PL_STOP_PHRASES,
  geoPatterns: PL_GEO_PATTERNS,
  locationStems: polishLocationStems,
};

// Re-export individual pieces for apps that need them directly
export { polishLocationStems, stripPolishDiacritics, LOCATIVE_IRREGULARS };
