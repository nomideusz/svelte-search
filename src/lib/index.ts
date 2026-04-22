// @nomideusz/svelte-search — Public API
// ============================================================

// Core types
export type {
  SqlDialect,
  DatabaseClient,
  SchemaAdapter,
  SearchParams,
  SearchResult,
  SearchResponse,
  AutocompleteResult,
  SearchLocale,
  ResolverContext,
  ResolverLookups,
  ResolverAction,
  TrackSearchEvent,
} from './core/types.js';

// Geo utilities
export {
  haversineKm,
  walkingMinutes,
  boundingBox,
  formatDistance,
  formatWalkingTime,
  walkingRoute,
} from './core/geo.js';

// Normalization & similarity
export {
  normalize,
  stripDiacriticsGeneric,
  trigrams,
  trigramSimilarity,
  levenshtein,
  levenshteinSimilarity,
  isPostcode,
  hasGeoIntent,
  stripGeoIntent,
  stripStopWords,
  MIN_SEARCH_TOKEN_LENGTH,
} from './core/normalize.js';

// Search engine
export { createSearchEngine, type SearchEngineConfig } from './core/engine.js';

// Indexer
export { createIndexer, createLookupsLoader, type IndexerConfig, type LoadLookupsConfig } from './core/indexer.js';

// Resolver
export { parseQuery, findMatchingArea, findNearestLocationWithEntities, type ParsedQuery } from './core/resolver.js';

// Tracker
export { createTracker, type TrackerConfig } from './core/track.js';
