// ============================================================
// @nomideusz/svelte-search — Text normalization
// ============================================================
// Generic normalization, trigrams, and similarity functions.
// Locale-specific logic (diacritics, stop words) is injected
// via SearchLocale.

import type { SearchLocale } from './types.js';

// ── Default diacritics (NFD decomposition) ─────────────────

/** Strip diacritics using Unicode NFD decomposition (generic, all languages). */
export function stripDiacriticsGeneric(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Full normalization: lowercase + strip diacritics + collapse whitespace. */
export function normalize(text: string, locale?: SearchLocale): string {
  if (!text) return '';
  const stripped = locale ? locale.stripDiacritics(text) : stripDiacriticsGeneric(text);
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Trigrams ───────────────────────────────────────────────

/** Generate trigrams from text. "hatha" → ["hat","ath","tha"] */
export function trigrams(text: string, locale?: SearchLocale): string[] {
  const n = normalize(text, locale);
  if (n.length < 3) return n ? [n] : [];
  const result: string[] = [];
  for (const word of n.split(/\s+/)) {
    if (word.length < 3) { result.push(word); continue; }
    for (let i = 0; i <= word.length - 3; i++) result.push(word.slice(i, i + 3));
  }
  return [...new Set(result)];
}

// ── Similarity ─────────────────────────────────────────────

/** Trigram similarity (Jaccard coefficient). 0..1, higher = more similar. */
export function trigramSimilarity(a: string, b: string, locale?: SearchLocale): number {
  const tA = new Set(trigrams(a, locale));
  const tB = new Set(trigrams(b, locale));
  if (tA.size === 0 && tB.size === 0) return 1;
  if (tA.size === 0 || tB.size === 0) return 0;
  let intersection = 0;
  for (const t of tA) if (tB.has(t)) intersection++;
  return intersection / (tA.size + tB.size - intersection);
}

/** Levenshtein distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1, curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized Levenshtein similarity. 0..1, higher = more similar. */
export function levenshteinSimilarity(a: string, b: string, locale?: SearchLocale): number {
  const na = normalize(a, locale), nb = normalize(b, locale);
  const max = Math.max(na.length, nb.length);
  return max === 0 ? 1 : 1 - levenshtein(na, nb) / max;
}

/**
 * Best Levenshtein similarity of `query` against a multi-word field: the max
 * of whole-field similarity and per-word similarity. A typo of one word in a
 * long field ("triranta" vs "triratna warszawa buddyzm...") scores near 0
 * against the whole field but 0.75 against the word it matches.
 */
export function bestWordSimilarity(query: string, field: string, locale?: SearchLocale): number {
  if (!field) return 0;
  let best = levenshteinSimilarity(query, field, locale);
  for (const w of normalize(field, locale).split(' ')) {
    if (w) best = Math.max(best, levenshteinSimilarity(query, w, locale));
  }
  return best;
}

/** Polish `NN-NNN`, used when a locale supplies no pattern of its own. */
const DEFAULT_POSTCODE_PATTERN = /\b(\d{2})-?(\d{3})\b/;

function postcodePatternOf(locale?: SearchLocale): RegExp {
  return locale?.postcodePattern ?? DEFAULT_POSTCODE_PATTERN;
}

function defaultFormatPostcode(match: RegExpMatchArray): string {
  return match.length > 2 && match[1] && match[2] ? `${match[1]}-${match[2]}` : match[0];
}

/**
 * Find a postcode anywhere in the text.
 * Returns the canonical form plus the raw match, so callers can cut exactly
 * what matched back out of the query.
 */
export function findPostcode(
  text: string,
  locale?: SearchLocale,
): { postcode: string; raw: string } | null {
  const match = text.match(postcodePatternOf(locale));
  if (!match) return null;
  const format = locale?.formatPostcode ?? defaultFormatPostcode;
  return { postcode: format(match), raw: match[0] };
}

/** Is the whole string a postcode? Uses the locale's pattern (Polish default). */
export function isPostcode(text: string, locale?: SearchLocale): boolean {
  const trimmed = text.trim();
  const match = trimmed.match(postcodePatternOf(locale));
  return match?.[0] === trimmed;
}

// ── Geo intent ─────────────────────────────────────────────

/**
 * Fallback for apps that pass no locale. "near me" is the one geo phrase
 * every English-language app needs, and without this the geo-intent helpers
 * are inert unless you write a whole locale. A supplied locale replaces
 * these entirely — it does not merge.
 */
const DEFAULT_GEO_PATTERNS: RegExp[] = [
  /\bnear me\b/,
  /\bnearby\b/,
  /\baround me\b/,
  /\bclose to me\b/,
  /\bclosest\b/,
];

function geoPatternsOf(locale?: SearchLocale): RegExp[] {
  return locale ? locale.geoPatterns : DEFAULT_GEO_PATTERNS;
}

/** Detect "near me" intent using locale geo patterns. */
export function hasGeoIntent(query: string, locale?: SearchLocale): boolean {
  const n = (locale ? locale.stripDiacritics(query) : stripDiacriticsGeneric(query)).toLowerCase();
  return geoPatternsOf(locale).some(p => p.test(n));
}

/** Remove geo-intent phrases from query. */
export function stripGeoIntent(query: string, locale?: SearchLocale): string {
  let q = (locale ? locale.stripDiacritics(query) : stripDiacriticsGeneric(query)).toLowerCase();
  for (const p of geoPatternsOf(locale)) q = q.replace(p, '');
  return q.replace(/\s+/g, ' ').trim();
}

// ── Stop words ─────────────────────────────────────────────

/**
 * Strip stop words/phrases from a NORMALIZED string.
 * Strips geo intent phrases first, then multi-word stop phrases,
 * then single stop tokens.
 */
export function stripStopWords(normalized: string, locale?: SearchLocale): string {
  if (!locale) return normalized;
  let result = normalized;

  // Geo intent phrases first (before single-token stripping splits them)
  for (const p of locale.geoPatterns) result = result.replace(p, ' ');

  // Multi-word stop phrases (longest first to avoid partial stripping)
  const sorted = [...locale.stopPhrases].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    result = result.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ');
  }

  // Single-word stop tokens
  result = result
    .split(/\s+/)
    .filter(t => !locale.stopTokens.has(t))
    .join(' ');

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Minimum token length for substring/prefix matching.
 * Tokens shorter than this are too ambiguous for client-side matching.
 */
export const MIN_SEARCH_TOKEN_LENGTH = 3;
