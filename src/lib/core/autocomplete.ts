// ============================================================
// @nomideusz/svelte-search — Autocomplete
// ============================================================
// Two halves, no framework: a suggestion index that ranks a list
// held in memory as the user types, and a controller that runs any
// source (that index, a fetch, the engine behind an endpoint) per
// keystroke — debounced, stale answers dropped, keyboard position
// kept. The controller is a Svelte store; <SearchBox> wears it.

import { normalize, levenshtein } from './normalize.js';
import type { SearchLocale } from './types.js';

// ── Suggestion index ───────────────────────────────────────

export interface SuggestionIndexOptions<T> {
  /** What an entry is found by: its label first, then any aliases. */
  text: (entry: T) => string | string[];
  locale?: SearchLocale;
  /** Forgive one typo per word (two from 8 letters) on words of 4+ letters. Default true. */
  typos?: boolean;
}

export interface SuggestionIndex<T> {
  /** Entries matching every word typed, best first; input order breaks ties. */
  search(query: string, limit?: number): T[];
}

interface Indexed<T> { entry: T; label: string; words: string[]; order: number }

/**
 * Rank entries against what is typed so far. Every query word must match a
 * word of the entry: as its start (the last word is usually half-typed),
 * inside it, or — failing both — within a typo. Pass entries most popular
 * first: among equal matches, the earlier entry wins.
 */
export function createSuggestionIndex<T>(entries: T[], options: SuggestionIndexOptions<T>): SuggestionIndex<T> {
  const { locale, typos = true } = options;
  const indexed: Indexed<T>[] = entries.map((entry, order) => {
    const raw = options.text(entry);
    const texts = (Array.isArray(raw) ? raw : [raw]).map(t => normalize(t, locale));
    return { entry, label: texts[0] ?? '', words: texts.join(' ').split(/[\s-]+/).filter(Boolean), order };
  });

  /** 0 prefix, 1 infix, 2 typo, -1 no match. */
  function matchWord(token: string, words: string[]): number {
    let best = -1;
    for (const w of words) {
      if (w.startsWith(token)) return 0;
      if (best !== 1 && token.length >= 3 && w.includes(token)) best = 1;
    }
    if (best !== -1 || !typos || token.length < 4) return best;
    const allowed = token.length >= 8 ? 2 : 1;
    for (const w of words) {
      // Against the word's start too: "pilatse" is a typo of "pilates" and of
      // the half-typed "pilates…" alike.
      const d = Math.min(levenshtein(token, w), levenshtein(token, w.slice(0, token.length)));
      if (d <= allowed) return 2;
    }
    return -1;
  }

  return {
    search(query, limit = 8) {
      const q = normalize(query, locale);
      if (!q) return [];
      let tokens = q.split(' ');
      // Whole stop words go; the last word may be the start of a real one.
      if (locale && tokens.length > 1) {
        const kept = tokens.filter((t, i) => i === tokens.length - 1 || !locale.stopTokens.has(t));
        if (kept.length) tokens = kept;
      }
      const scored: { item: Indexed<T>; score: number }[] = [];
      for (const item of indexed) {
        let score = item.label.startsWith(q) ? 0 : 1;
        for (const t of tokens) {
          const r = matchWord(t, item.words);
          if (r < 0) { score = -1; break; }
          score += r * 2;
        }
        if (score >= 0) scored.push({ item, score });
      }
      scored.sort((a, b) => a.score - b.score
        || a.item.label.length - b.item.label.length
        || a.item.order - b.item.order);
      return scored.slice(0, limit).map(s => s.item.entry);
    },
  };
}

// ── Controller ─────────────────────────────────────────────

export interface AutocompleteState<T> {
  /** The query `items` answer (trimmed queries go to the source); '' once closed. */
  query: string;
  items: T[];
  /** Keyboard position in `items`; -1 = none. */
  active: number;
  loading: boolean;
  /** What the last source call threw; null after any success. */
  error: unknown;
}

export interface AutocompleteOptions<T> {
  /** Suggestions for a query. Sync sources apply in the same tick. */
  source: (query: string, context: { signal: AbortSignal }) => T[] | Promise<T[]>;
  /** Wait this long after the last keystroke. Default 150; 0 for in-memory sources. */
  debounceMs?: number;
  /** Shorter queries (trimmed) suggest nothing. Default 1. */
  minLength?: number;
}

export interface Autocomplete<T> {
  /** Svelte store contract: called now and on every change. */
  subscribe(run: (state: AutocompleteState<T>) => void): () => void;
  readonly state: AutocompleteState<T>;
  /** The field changed. */
  input(query: string): void;
  /** Arrow keys: +1 / -1, wrapping; from none, down is the first and up the last. */
  move(delta: number): void;
  /** The active item, if any. */
  selected(): T | undefined;
  /** Drop pending work and suggestions. */
  close(): void;
}

export function createAutocomplete<T>(options: AutocompleteOptions<T>): Autocomplete<T> {
  const { debounceMs = 150, minLength = 1 } = options;
  let state: AutocompleteState<T> = { query: '', items: [], active: -1, loading: false, error: null };
  const listeners = new Set<(s: AutocompleteState<T>) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let generation = 0;

  function set(patch: Partial<AutocompleteState<T>>) {
    state = { ...state, ...patch };
    for (const run of listeners) run(state);
  }

  function cancel() {
    clearTimeout(timer);
    controller?.abort();
    generation++;
  }

  function run(query: string, version: number) {
    controller = new AbortController();
    let result: T[] | Promise<T[]>;
    try {
      result = options.source(query, { signal: controller.signal });
    } catch (error) {
      set({ items: [], loading: false, error });
      return;
    }
    if (!(result instanceof Promise)) {
      set({ items: result, active: -1, loading: false, error: null });
      return;
    }
    result.then(
      items => { if (version === generation) set({ items, active: -1, loading: false, error: null }); },
      error => {
        if (version !== generation) return;
        set({ items: [], loading: false, error });
      },
    );
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => { listeners.delete(fn); };
    },
    get state() { return state; },
    input(query) {
      cancel();
      const q = query.trim();
      if (q.length < minLength) { set({ query, items: [], active: -1, loading: false, error: null }); return; }
      const version = generation;
      set({ query, active: -1, loading: true });
      if (debounceMs > 0) timer = setTimeout(() => run(q, version), debounceMs);
      else run(q, version);
    },
    move(delta) {
      const n = state.items.length;
      if (!n) return;
      const active = state.active < 0 ? (delta > 0 ? 0 : n - 1) : (((state.active + delta) % n) + n) % n;
      set({ active });
    },
    selected() {
      return state.active >= 0 ? state.items[state.active] : undefined;
    },
    close() {
      cancel();
      set({ query: '', items: [], active: -1, loading: false });
    },
  };
}
