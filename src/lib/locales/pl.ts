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
  // Polish prepositions & particles. The -e variants ("we Wrocławiu",
  // "ze Szczecina", "pode mną") are obligatory before consonant clusters,
  // so they show up in ordinary queries as often as the bare forms.
  'w', 'we', 'z', 'ze', 'na', 'do', 'od', 'dla', 'i', 'o', 'u',
  'przy', 'po', 'pod', 'pode', 'nad', 'nade', 'za', 'przed', 'przede',
  'miedzy', 'lub',
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
  [/wie$/, 'w'],
  [/rze$/, 'ra'],
  [/skie$/, 'sk'],
  [/iu$/, ''],
  // Adjectival place names decline like adjectives: "Zielonej Górze" →
  // "Zielona Góra", "Nowym Sączu" → "Nowy Sącz", "Zakopanem" → "Zakopane".
  [/ej$/, 'a'],
  [/ym$/, 'y'],
  [/em$/, ''],
  [/y$/, ''],
  [/i$/, ''],
  [/e$/, ''],
  [/u$/, ''],
];

// A Polish nominative is not always a prefix of the inflected form:
// "Katowicach" → "Katowice", "Gdyni" → "Gdynia", "Warszawie" → "Warszawa".
// Stripping alone can only shorten, so offer the common nominative endings
// too. Callers match candidates against a lookup map of real place names, so
// the ones that spell nothing simply never match.
const NOMINATIVE_ENDINGS = ['a', 'e', 'o', 'y', 'ia', 'ie'];

// Names the suffix rules cannot reach because the stem itself changes.
// "Białystok" declines as an adjective+noun compound ("w Białymstoku").
const INFLECTED_IRREGULARS: Record<string, string> = {
  bialymstoku: 'bialystok',
  bialymstokiem: 'bialystok',
};

function stemWord(word: string): string[] {
  const irregular = INFLECTED_IRREGULARS[word];
  if (irregular) return [word, irregular];

  const stems = new Set<string>([word]);
  for (const [re, replacement] of STEM_RULES) {
    if (re.test(word)) {
      const stem = word.replace(re, replacement);
      if (stem.length >= 3 && stem !== word) stems.add(stem);
    }
  }
  // Re-endings come after every stripped stem, so a plain stem still wins the
  // first-match race in matchToken ("krakow" before "krakowo").
  for (const stem of [...stems]) {
    if (stem === word) continue;
    for (const ending of NOMINATIVE_ENDINGS) stems.add(stem + ending);
    // Fleeting e: "Sosnowcu" → "sosnowc" → "sosnowiec", "Bolesławcu" → "Bolesławiec"
    if (stem.endsWith('c')) stems.add(`${stem.slice(0, -1)}iec`);
  }
  return [...stems];
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
  // Full-name forms take precedence over the per-word suffix rules below.
  // Comprehensive table of Polish towns (every city with 10+ collection
  // points in kompi-recycling, hand-verified July 2026) plus localities
  // from the yoga directory. Data over algorithm: the suffix rules cannot
  // decide gender/number ("Dębica" → "Dębicy" but "Dębnica" too, while
  // "Zakopane" → "Zakopanem"), so unlisted names only get a best guess.
  'Aleksandrów Kujawski': 'Aleksandrowie Kujawskim',
  'Aleksandrów Łódzki': 'Aleksandrowie Łódzkim',
  'Andrychów': 'Andrychowie',
  'Augustów': 'Augustowie',
  'Barczewo': 'Barczewie',
  'Barlinek': 'Barlinku',
  'Bartoszyce': 'Bartoszycach',
  'Bełchatów': 'Bełchatowie',
  'Będzin': 'Będzinie',
  'Biała Podlaska': 'Białej Podlaskiej',
  'Białobrzegi': 'Białobrzegach',
  'Białogard': 'Białogardzie',
  'Białystok': 'Białymstoku',
  'Bielany Wrocławskie': 'Bielanach Wrocławskich',
  'Bielawa': 'Bielawie',
  'Bielsk Podlaski': 'Bielsku Podlaskim',
  'Bielsko-Biała': 'Bielsku-Białej',
  'Bieruń': 'Bieruniu',
  'Biłgoraj': 'Biłgoraju',
  'Biskupiec': 'Biskupcu',
  'Błonie': 'Błoniu',
  'Bogatynia': 'Bogatyni',
  'Boguszów-Gorce': 'Boguszowie-Gorcach',
  'Bolesławiec': 'Bolesławcu',
  'Bolszewo': 'Bolszewie',
  'Borkowo': 'Borkowie',
  'Braniewo': 'Braniewie',
  'Brodnica': 'Brodnicy',
  'Brwinów': 'Brwinowie',
  'Brzeg': 'Brzegu',
  'Brzeg Dolny': 'Brzegu Dolnym',
  'Brzesko': 'Brzesku',
  'Brzeziny': 'Brzezinach',
  'Brzozów': 'Brzozowie',
  'Brzozówka': 'Brzozówce',
  'Buk': 'Buku',
  'Busko-Zdrój': 'Busku-Zdroju',
  'Bydgoszcz': 'Bydgoszczy',
  'Bystrzyca Kłodzka': 'Bystrzycy Kłodzkiej',
  'Bytom': 'Bytomiu',
  'Bytów': 'Bytowie',
  'Chełm': 'Chełmie',
  'Chełmno': 'Chełmnie',
  'Chodzież': 'Chodzieży',
  'Chojnice': 'Chojnicach',
  'Chojnów': 'Chojnowie',
  'Chorzów': 'Chorzowie',
  'Choszczno': 'Choszcznie',
  'Chrzanów': 'Chrzanowie',
  'Ciechanów': 'Ciechanowie',
  'Ciechocinek': 'Ciechocinku',
  'Cieszyn': 'Cieszynie',
  'Czaplinek': 'Czaplinku',
  'Czarnków': 'Czarnkowie',
  'Czechowice-Dziedzice': 'Czechowicach-Dziedzicach',
  'Czeladź': 'Czeladzi',
  'Czersk': 'Czersku',
  'Czerwionka-Leszczyny': 'Czerwionce-Leszczynach',
  'Częstochowa': 'Częstochowie',
  'Człuchów': 'Człuchowie',
  'Darłowo': 'Darłowie',
  'Dąbrowa Górnicza': 'Dąbrowie Górniczej',
  'Dąbrówka': 'Dąbrówce',
  'Dębica': 'Dębicy',
  'Dęblin': 'Dęblinie',
  'Dębnica Kaszubska': 'Dębnicy Kaszubskiej',
  'Dębno': 'Dębnie',
  'Dobra': 'Dobrej',
  'Dobre Miasto': 'Dobrym Mieście',
  'Drawsko Pomorskie': 'Drawsku Pomorskim',
  'Drezdenko': 'Drezdenku',
  'Działdowo': 'Działdowie',
  'Działoszyn': 'Działoszynie',
  'Dzierżoniów': 'Dzierżoniowie',
  'Elbląg': 'Elblągu',
  'Ełk': 'Ełku',
  'Garwolin': 'Garwolinie',
  'Gdańsk': 'Gdańsku',
  'Gdynia': 'Gdyni',
  'Giżycko': 'Giżycku',
  'Gliwice': 'Gliwicach',
  'Głogów': 'Głogowie',
  'Głogów Małopolski': 'Głogowie Małopolskim',
  'Głowno': 'Głownie',
  'Głubczyce': 'Głubczycach',
  'Głuchołazy': 'Głuchołazach',
  'Gniezno': 'Gnieźnie',
  'Goleniów': 'Goleniowie',
  'Golub-Dobrzyń': 'Golubiu-Dobrzyniu',
  'Gołdap': 'Gołdapi',
  'Gorlice': 'Gorlicach',
  'Gorzów Wielkopolski': 'Gorzowie Wielkopolskim',
  'Gostynin': 'Gostyninie',
  'Gostyń': 'Gostyniu',
  'Góra': 'Górze',
  'Góra Kalwaria': 'Górze Kalwarii',
  'Górki': 'Górkach',
  'Grajewo': 'Grajewie',
  'Grodków': 'Grodkowie',
  'Grodzisk Mazowiecki': 'Grodzisku Mazowieckim',
  'Grodzisk Wielkopolski': 'Grodzisku Wielkopolskim',
  'Grójec': 'Grójcu',
  'Grudziądz': 'Grudziądzu',
  'Gryfice': 'Gryficach',
  'Gryfino': 'Gryfinie',
  'Gubin': 'Gubinie',
  'Hrubieszów': 'Hrubieszowie',
  'Iława': 'Iławie',
  'Inowrocław': 'Inowrocławiu',
  'Jabłonna': 'Jabłonnie',
  'Janki': 'Jankach',
  'Janów Lubelski': 'Janowie Lubelskim',
  'Jarocin': 'Jarocinie',
  'Jarosław': 'Jarosławiu',
  'Jasin': 'Jasinie',
  'Jasło': 'Jaśle',
  'Jastrzębie-Zdrój': 'Jastrzębiu-Zdroju',
  'Jawor': 'Jaworze',
  'Jaworzno': 'Jaworznie',
  'Jelcz-Laskowice': 'Jelczu-Laskowicach',
  'Jelenia Góra': 'Jeleniej Górze',
  'Jędrzejów': 'Jędrzejowie',
  'Józefosław': 'Józefosławiu',
  'Józefów': 'Józefowie',
  'Kalisz': 'Kaliszu',
  'Kamienna Góra': 'Kamiennej Górze',
  'Kamień Pomorski': 'Kamieniu Pomorskim',
  'Kamionki': 'Kamionkach',
  'Karpacz': 'Karpaczu',
  'Kartuzy': 'Kartuzach',
  'Katowice': 'Katowicach',
  'Kazimierza Wielka': 'Kazimierzy Wielkiej',
  'Kędzierzyn-Koźle': 'Kędzierzynie-Koźlu',
  'Kępno': 'Kępnie',
  'Kętrzyn': 'Kętrzynie',
  'Kęty': 'Kętach',
  'Kielce': 'Kielcach',
  'Kluczbork': 'Kluczborku',
  'Kłobuck': 'Kłobucku',
  'Kłodzko': 'Kłodzku',
  'Knurów': 'Knurowie',
  'Kobyłka': 'Kobyłce',
  'Kolbuszowa': 'Kolbuszowej',
  'Kolno': 'Kolnie',
  'Koluszki': 'Koluszkach',
  'Koło': 'Kole',
  'Kołobrzeg': 'Kołobrzegu',
  'Komorniki': 'Komornikach',
  'Konin': 'Koninie',
  'Konstancin-Jeziorna': 'Konstancinie-Jeziornie',
  'Konstantynów Łódzki': 'Konstantynowie Łódzkim',
  'Końskie': 'Końskich',
  'Koronowo': 'Koronowie',
  'Kostrzyn nad Odrą': 'Kostrzynie nad Odrą',
  'Koszalin': 'Koszalinie',
  'Kościan': 'Kościanie',
  'Kościerzyna': 'Kościerzynie',
  'Kowale': 'Kowalach',
  'Kowalewo Pomorskie': 'Kowalewie Pomorskim',
  'Koziegłowy': 'Koziegłowach',
  'Kozienice': 'Kozienicach',
  'Kraków': 'Krakowie',
  'Krapkowice': 'Krapkowicach',
  'Krasnystaw': 'Krasnymstawie',
  'Kraśnik': 'Kraśniku',
  'Krosno': 'Krośnie',
  'Krosno Odrzańskie': 'Krośnie Odrzańskim',
  'Krotoszyn': 'Krotoszynie',
  'Kruszwica': 'Kruszwicy',
  'Krynica-Zdrój': 'Krynicy-Zdroju',
  'Krzeszowice': 'Krzeszowicach',
  'Kudowa-Zdrój': 'Kudowie-Zdroju',
  'Kutno': 'Kutnie',
  'Kwidzyn': 'Kwidzynie',
  'Legionowo': 'Legionowie',
  'Legnica': 'Legnicy',
  'Leszno': 'Lesznie',
  'Leżajsk': 'Leżajsku',
  'Lębork': 'Lęborku',
  'Libiąż': 'Libiążu',
  'Lidzbark Warmiński': 'Lidzbarku Warmińskim',
  'Limanowa': 'Limanowej',
  'Lipienice': 'Lipienicach',
  'Lipno': 'Lipnie',
  'Lipsko': 'Lipsku',
  'Lubaczów': 'Lubaczowie',
  'Lubań': 'Lubaniu',
  'Lubartów': 'Lubartowie',
  'Lubawa': 'Lubawie',
  'Lubin': 'Lubinie',
  'Lublin': 'Lublinie',
  'Lubliniec': 'Lublińcu',
  'Luboń': 'Luboniu',
  'Lubsko': 'Lubsku',
  'Lwówek Śląski': 'Lwówku Śląskim',
  'Łagów': 'Łagowie',
  'Łańcut': 'Łańcucie',
  'Łapy': 'Łapach',
  'Łask': 'Łasku',
  'Łaziska Górne': 'Łaziskach Górnych',
  'Łazy': 'Łazach',
  'Łeba': 'Łebie',
  'Łęczna': 'Łęcznej',
  'Łęczyca': 'Łęczycy',
  'Łobez': 'Łobzie',
  'Łomianki': 'Łomiankach',
  'Łomża': 'Łomży',
  'Łosice': 'Łosicach',
  'Łowicz': 'Łowiczu',
  'Łódź': 'Łodzi',
  'Łuków': 'Łukowie',
  'Maków Mazowiecki': 'Makowie Mazowieckim',
  'Malbork': 'Malborku',
  'Marki': 'Markach',
  'Miastko': 'Miastku',
  'Miechów': 'Miechowie',
  'Mielec': 'Mielcu',
  'Mierzyn': 'Mierzynie',
  'Międzychód': 'Międzychodzie',
  'Międzyrzec Podlaski': 'Międzyrzecu Podlaskim',
  'Międzyrzecz': 'Międzyrzeczu',
  'Międzyzdroje': 'Międzyzdrojach',
  'Mikołów': 'Mikołowie',
  'Milanówek': 'Milanówku',
  'Milicz': 'Miliczu',
  'Mińsk Mazowiecki': 'Mińsku Mazowieckim',
  'Mława': 'Mławie',
  'Mogilno': 'Mogilnie',
  'Monte': 'Monte',
  'Mońki': 'Mońkach',
  'Mosina': 'Mosinie',
  'Mrągowo': 'Mrągowie',
  'Mysłowice': 'Mysłowicach',
  'Myszków': 'Myszkowie',
  'Myślenice': 'Myślenicach',
  'Myślibórz': 'Myśliborzu',
  'Nakło nad Notecią': 'Nakle nad Notecią',
  'Namysłów': 'Namysłowie',
  'Nasielsk': 'Nasielsku',
  'Nidzica': 'Nidzicy',
  'Niemcz': 'Niemczu',
  'Niemodlin': 'Niemodlinie',
  'Niepołomice': 'Niepołomicach',
  'Nisko': 'Nisku',
  'Nowa Ruda': 'Nowej Rudzie',
  'Nowa Sól': 'Nowej Soli',
  'Nowa Wieś': 'Nowej Wsi',
  'Nowe Miasto Lubawskie': 'Nowym Mieście Lubawskim',
  'Nowogard': 'Nowogardzie',
  'Nowy Dwór Gdański': 'Nowym Dworze Gdańskim',
  'Nowy Dwór Mazowiecki': 'Nowym Dworze Mazowieckim',
  'Nowy Sącz': 'Nowym Sączu',
  'Nowy Targ': 'Nowym Targu',
  'Nowy Tomyśl': 'Nowym Tomyślu',
  'Nysa': 'Nysie',
  'Oborniki': 'Obornikach',
  'Olecko': 'Olecku',
  'Olesno': 'Oleśnie',
  'Oleśnica': 'Oleśnicy',
  'Olkusz': 'Olkuszu',
  'Olsztyn': 'Olsztynie',
  'Oława': 'Oławie',
  'Opalenica': 'Opalenicy',
  'Opatów': 'Opatowie',
  'Opoczno': 'Opocznie',
  'Opole': 'Opolu',
  'Opole Lubelskie': 'Opolu Lubelskim',
  'Orzesze': 'Orzeszu',
  'Osiek': 'Osieku',
  'Osielsko': 'Osielsku',
  'Ostrołęka': 'Ostrołęce',
  'Ostrowiec Świętokrzyski': 'Ostrowcu Świętokrzyskim',
  'Ostróda': 'Ostródzie',
  'Ostrów Mazowiecka': 'Ostrowi Mazowieckiej',
  'Ostrów Wielkopolski': 'Ostrowie Wielkopolskim',
  'Ostrzeszów': 'Ostrzeszowie',
  'Oświęcim': 'Oświęcimiu',
  'Otwock': 'Otwocku',
  'Owińska': 'Owińskach',
  'Ozorków': 'Ozorkowie',
  'Ożarów Mazowiecki': 'Ożarowie Mazowieckim',
  'Pabianice': 'Pabianicach',
  'Pajęczno': 'Pajęcznie',
  'Parczew': 'Parczewie',
  'Pasłęk': 'Pasłęku',
  'Piaseczno': 'Piasecznie',
  'Piastów': 'Piastowie',
  'Piekary Śląskie': 'Piekarach Śląskich',
  'Pilchowice': 'Pilchowicach',
  'Piła': 'Pile',
  'Pionki': 'Pionkach',
  'Piotrków Trybunalski': 'Piotrkowie Trybunalskim',
  'Pisz': 'Piszu',
  'Pleszew': 'Pleszewie',
  'Plewiska': 'Plewiskach',
  'Płock': 'Płocku',
  'Płońsk': 'Płońsku',
  'Pniewy': 'Pniewach',
  'Pobiedziska': 'Pobiedziskach',
  'Poddębice': 'Poddębicach',
  'Podkowa Leśna': 'Podkowie Leśnej',
  'Pogórze': 'Pogórzu',
  'Police': 'Policach',
  'Polkowice': 'Polkowicach',
  'Połaniec': 'Połańcu',
  'Poznań': 'Poznaniu',
  'Praszka': 'Praszce',
  'Prudnik': 'Prudniku',
  'Pruszcz Gdański': 'Pruszczu Gdańskim',
  'Pruszków': 'Pruszkowie',
  'Przasnysz': 'Przasnyszu',
  'Przemyśl': 'Przemyślu',
  'Przeworsk': 'Przeworsku',
  'Przeźmierowo': 'Przeźmierowie',
  'Pszczyna': 'Pszczynie',
  'Puck': 'Pucku',
  'Puławy': 'Puławach',
  'Pułtusk': 'Pułtusku',
  'Pyrzyce': 'Pyrzycach',
  'Pyskowice': 'Pyskowicach',
  'Rabka-Zdrój': 'Rabce-Zdroju',
  'Racibórz': 'Raciborzu',
  'Radlin': 'Radlinie',
  'Radom': 'Radomiu',
  'Radomsko': 'Radomsku',
  'Radziejów': 'Radziejowie',
  'Radzionków': 'Radzionkowie',
  'Radzymin': 'Radzyminie',
  'Radzyń Podlaski': 'Radzyniu Podlaskim',
  'Rawa Mazowiecka': 'Rawie Mazowieckiej',
  'Rawicz': 'Rawiczu',
  'Reda': 'Redzie',
  'Rogoźno': 'Rogoźnie',
  'Rokietnica': 'Rokietnicy',
  'Ropczyce': 'Ropczycach',
  'Ruda Śląska': 'Rudzie Śląskiej',
  'Rumia': 'Rumi',
  'Ruszowice': 'Ruszowicach',
  'Rybnik': 'Rybniku',
  'Rydułtowy': 'Rydułtowach',
  'Ryki': 'Rykach',
  'Rypin': 'Rypinie',
  'Rzepin': 'Rzepinie',
  'Rzeszów': 'Rzeszowie',
  'Rzgów': 'Rzgowie',
  'Sandomierz': 'Sandomierzu',
  'Sanok': 'Sanoku',
  'Serock': 'Serocku',
  'Sędziszów Małopolski': 'Sędziszowie Małopolskim',
  'Sępólno Krajeńskie': 'Sępólnie Krajeńskim',
  'Siedlce': 'Siedlcach',
  'Siemianowice Śląskie': 'Siemianowicach Śląskich',
  'Siemiatycze': 'Siemiatyczach',
  'Sieradz': 'Sieradzu',
  'Sierakowice': 'Sierakowicach',
  'Sierosław': 'Sierosławiu',
  'Sierpc': 'Sierpcu',
  'Siewierz': 'Siewierzu',
  'Skarżysko-Kamienna': 'Skarżysku-Kamiennej',
  'Skawina': 'Skawinie',
  'Skierniewice': 'Skierniewicach',
  'Skórzewo': 'Skórzewie',
  'Skwierzyna': 'Skwierzynie',
  'Sławno': 'Sławnie',
  'Słubice': 'Słubicach',
  'Słupca': 'Słupcy',
  'Słupsk': 'Słupsku',
  'Smolec': 'Smolcu',
  'Sochaczew': 'Sochaczewie',
  'Sokołów Podlaski': 'Sokołowie Podlaskim',
  'Sokółka': 'Sokółce',
  'Sopot': 'Sopocie',
  'Sosnowiec': 'Sosnowcu',
  'Stalowa Wola': 'Stalowej Woli',
  'Starachowice': 'Starachowicach',
  'Stargard': 'Stargardzie',
  'Starogard Gdański': 'Starogardzie Gdańskim',
  'Staszów': 'Staszowie',
  'Strzegom': 'Strzegomiu',
  'Strzelce Krajeńskie': 'Strzelcach Krajeńskich',
  'Strzelce Opolskie': 'Strzelcach Opolskich',
  'Strzelin': 'Strzelinie',
  'Strzyżów': 'Strzyżowie',
  'Sucha Beskidzka': 'Suchej Beskidzkiej',
  'Suchy Dwór': 'Suchym Dworze',
  'Suchy Las': 'Suchym Lesie',
  'Sulechów': 'Sulechowie',
  'Sulejówek': 'Sulejówku',
  'Sulęcin': 'Sulęcinie',
  'Suwałki': 'Suwałkach',
  'Swarzędz': 'Swarzędzu',
  'Syców': 'Sycowie',
  'Szamotuły': 'Szamotułach',
  'Szczecin': 'Szczecinie',
  'Szczecinek': 'Szczecinku',
  'Szczytno': 'Szczytnie',
  'Szprotawa': 'Szprotawie',
  'Szubin': 'Szubinie',
  'Szydłowiec': 'Szydłowcu',
  'Śrem': 'Śremie',
  'Środa Śląska': 'Środzie Śląskiej',
  'Środa Wielkopolska': 'Środzie Wielkopolskiej',
  'Świdnica': 'Świdnicy',
  'Świdnik': 'Świdniku',
  'Świdwin': 'Świdwinie',
  'Świebodzice': 'Świebodzicach',
  'Świebodzin': 'Świebodzinie',
  'Świecie': 'Świeciu',
  'Świętochłowice': 'Świętochłowicach',
  'Świnoujście': 'Świnoujściu',
  'Tarczyn': 'Tarczynie',
  'Tarnobrzeg': 'Tarnobrzegu',
  'Tarnowo Podgórne': 'Tarnowie Podgórnym',
  'Tarnowskie Góry': 'Tarnowskich Górach',
  'Tarnów': 'Tarnowie',
  'Tczew': 'Tczewie',
  'Tomaszów Lubelski': 'Tomaszowie Lubelskim',
  'Tomaszów Mazowiecki': 'Tomaszowie Mazowieckim',
  'Toruń': 'Toruniu',
  'Trzcianka': 'Trzciance',
  'Trzebiatów': 'Trzebiatowie',
  'Trzebinia': 'Trzebini',
  'Trzebnica': 'Trzebnicy',
  'Tuchola': 'Tucholi',
  'Turek': 'Turku',
  'Tychy': 'Tychach',
  'Ustka': 'Ustce',
  'Ustroń': 'Ustroniu',
  'Ustrzyki Dolne': 'Ustrzykach Dolnych',
  'Wadowice': 'Wadowicach',
  'Wałbrzych': 'Wałbrzychu',
  'Wałcz': 'Wałczu',
  'Warka': 'Warce',
  'Warszawa': 'Warszawie',
  'Wąbrzeźno': 'Wąbrzeźnie',
  'Wągrowiec': 'Wągrowcu',
  'Wejherowo': 'Wejherowie',
  'Węgorzewo': 'Węgorzewie',
  'Węgrów': 'Węgrowie',
  'Wieliczka': 'Wieliczce',
  'Wieluń': 'Wieluniu',
  'Wieruszów': 'Wieruszowie',
  'Wiry': 'Wirach',
  'Wisła': 'Wiśle',
  'Witnica': 'Witnicy',
  'Władysławowo': 'Władysławowie',
  'Włocławek': 'Włocławku',
  'Włodawa': 'Włodawie',
  'Włoszczowa': 'Włoszczowie',
  'Wodzisław Śląski': 'Wodzisławiu Śląskim',
  'Wojkowice': 'Wojkowicach',
  'Wola Kopcowa': 'Woli Kopcowej',
  'Wolsztyn': 'Wolsztynie',
  'Wołomin': 'Wołominie',
  'Wołów': 'Wołowie',
  'Wrocław': 'Wrocławiu',
  'Wronki': 'Wronkach',
  'Września': 'Wrześni',
  'Wschowa': 'Wschowie',
  'Wysoka': 'Wysokiej',
  'Wyszków': 'Wyszkowie',
  'Zabrze': 'Zabrzu',
  'Zakopane': 'Zakopanem',
  'Zalasewo': 'Zalasewie',
  'Zambrów': 'Zambrowie',
  'Zamość': 'Zamościu',
  'Zawada': 'Zawadzie',
  'Zawiercie': 'Zawierciu',
  'Ząbki': 'Ząbkach',
  'Ząbkowice Śląskie': 'Ząbkowicach Śląskich',
  'Zduńska Wola': 'Zduńskiej Woli',
  'Zdzieszowice': 'Zdzieszowicach',
  'Zgierz': 'Zgierzu',
  'Zgorzelec': 'Zgorzelcu',
  'Zielona Góra': 'Zielonej Górze',
  'Zielonka': 'Zielonce',
  'Złocieniec': 'Złocieńcu',
  'Złotoryja': 'Złotoryi',
  'Zwoleń': 'Zwoleniu',
  'Żagań': 'Żaganiu',
  'Żary': 'Żarach',
  'Żnin': 'Żninie',
  'Żory': 'Żorach',
  'Żukowo': 'Żukowie',
  'Żuromin': 'Żurominie',
  'Żyrardów': 'Żyrardowie',
  'Żywiec': 'Żywcu',
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
  // Polish kod pocztowy: NN-NNN, commonly typed without the hyphen
  postcodePattern: /\b(\d{2})-?(\d{3})\b/,
};

// Re-export individual pieces for apps that need them directly
export { polishLocationStems, stripPolishDiacritics, LOCATIVE_IRREGULARS };
