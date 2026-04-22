// ============================================================
// @nomideusz/svelte-search — Resolver framework
// ============================================================
// Generic query resolver: classifies tokens (location, category,
// area, unclassified) and dispatches to page-specific handlers.
// Apps provide their own dispatch rules via createResolver().

import type { SearchLocale, ResolverLookups, ResolverAction } from './types.js';
import { normalize, hasGeoIntent, stripGeoIntent, stripStopWords, isPostcode } from './normalize.js';

// ── Token matching ─────────────────────────────────────────

interface TokenMatch {
  matched: string;
  slug: string;
  original: string;
}

function matchToken(
  tokens: string[],
  lookup: Map<string, string>,
  locale?: SearchLocale
): TokenMatch | null {
  // Try bigrams first
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    const slug = lookup.get(bigram);
    if (slug) return { matched: bigram, slug, original: bigram };
  }
  // Single tokens (with optional locale stemming)
  for (const t of tokens) {
    const slug = lookup.get(t);
    if (slug) return { matched: t, slug, original: t };
    // Try locale-specific stems (e.g. Polish case forms)
    if (locale?.locationStems) {
      for (const stem of locale.locationStems(t)) {
        if (stem === t) continue;
        const stemSlug = lookup.get(stem);
        if (stemSlug) return { matched: t, slug: stemSlug, original: t };
      }
    }
  }
  return null;
}

function matchesArea(query: string, area: string): boolean {
  if (query === area) return true;
  const re = new RegExp(`(?:^|\\s)${area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  return re.test(query);
}

// ── Parsed query ───────────────────────────────────────────

export interface ParsedQuery {
  /** Original normalized query */
  normalized: string;
  /** Query after stop word removal */
  working: string;
  /** Whether geo intent was detected */
  geoIntent: boolean;
  /** Extracted postal code, if any */
  postal: string | undefined;
  /** Matched location token */
  location: TokenMatch | null;
  /** Matched category token */
  category: TokenMatch | null;
  /** Remaining unclassified tokens */
  rest: string[];
}

/**
 * Parse and classify a raw search query.
 * Reusable by any app — the classification is the same,
 * only the dispatch logic differs.
 */
export function parseQuery(
  raw: string,
  lookups: ResolverLookups,
  locale?: SearchLocale
): ParsedQuery {
  const normalized = normalize(raw, locale);
  if (!normalized) {
    return { normalized: '', working: '', geoIntent: false, postal: undefined, location: null, category: null, rest: [] };
  }

  let working = stripStopWords(normalized, locale);
  if (!working) {
    return { normalized, working: '', geoIntent: false, postal: undefined, location: null, category: null, rest: [] };
  }

  // Geo intent
  const geoIntent = hasGeoIntent(raw, locale);
  if (geoIntent) {
    working = stripGeoIntent(working, locale);
  }

  // Postal code
  const postalMatch = working.match(/\b(\d{2})-?(\d{3})\b/);
  let postal: string | undefined;
  if (postalMatch) {
    postal = `${postalMatch[1]}-${postalMatch[2]}`;
    working = working.replace(postalMatch[0], '').replace(/\s+/g, ' ').trim();
  }

  if (!working) {
    return { normalized, working: '', geoIntent, postal, location: null, category: null, rest: [] };
  }

  // Tokenize and classify
  const tokens = working.split(/\s+/).filter(Boolean);
  const location = matchToken(tokens, lookups.locationMap, locale);
  const category = matchToken(tokens, lookups.categoryMap, locale);
  const rest = tokens.filter(
    t => t !== location?.matched && t !== category?.matched
  );

  return { normalized, working, geoIntent, postal, location, category, rest };
}

// ── Dispatch helpers ───────────────────────────────────────
// Common action patterns used by app-specific resolvers.

/** Check if query matches an area/district in the given location. */
export function findMatchingArea(
  query: string,
  locationSlug: string,
  lookups: ResolverLookups,
  locale?: SearchLocale
): string | null {
  const areas = lookups.areaMap.get(locationSlug) ?? [];
  const normalized = normalize(query, locale);
  return areas.find(a => matchesArea(normalized, a)) ?? null;
}

/**
 * Find the nearest location that has entities.
 * Useful for "no results" states.
 */
export function findNearestLocationWithEntities(
  lat: number, lng: number,
  lookups: ResolverLookups,
  excludeSlug?: string
): { name: string; slug: string; distanceKm: number; count: number } | null {
  if (!lookups.locationEntityCount || !lookups.locationGeo) return null;

  let best: { name: string; slug: string; distanceKm: number; count: number } | null = null;
  let bestDist = Infinity;

  for (const [slug, geo] of lookups.locationGeo) {
    const count = lookups.locationEntityCount.get(slug) ?? 0;
    if (count === 0 || slug === excludeSlug) continue;

    const dlat = (geo.lat - lat) * Math.PI / 180;
    const dlng = (geo.lng - lng) * Math.PI / 180;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(geo.lat * Math.PI / 180) * Math.sin(dlng / 2) ** 2;
    const d = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (d < bestDist) {
      bestDist = d;
      best = { slug, name: geo.name, count, distanceKm: Math.round(d) };
    }
  }
  return best;
}
