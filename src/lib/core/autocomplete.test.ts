import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutocomplete, createSuggestionIndex } from './autocomplete.js';
import { plLocale } from '../locales/pl.js';

const places = [
  { name: 'Kraków', aliases: ['Cracow'] },
  { name: 'Krasnystaw' },
  { name: 'Warszawa' },
  { name: 'Nowy Sącz' },
  { name: 'Pilates Studio Kraków' },
  { name: 'Hot Pilates' },
];
const index = createSuggestionIndex(places, { text: p => [p.name, ...(p.aliases ?? [])], locale: plLocale });
const names = (q: string, limit?: number) => index.search(q, limit).map(p => p.name);

describe('createSuggestionIndex', () => {
  it('matches the half-typed word as a prefix, without diacritics', () => {
    expect(names('kra')).toEqual(['Kraków', 'Krasnystaw', 'Pilates Studio Kraków']);
    expect(names('sacz')).toEqual(['Nowy Sącz']);
  });

  it('finds an entry by its alias', () => {
    expect(names('crac')).toEqual(['Kraków']);
  });

  it('needs every word, in any order', () => {
    expect(names('krak pilates')).toEqual(['Pilates Studio Kraków']);
    expect(names('pilates warszawa')).toEqual([]);
  });

  it('ranks a label that starts with the query over one that only contains it', () => {
    expect(names('pilates')).toEqual(['Pilates Studio Kraków', 'Hot Pilates']);
  });

  it('forgives a typo, below any exact match', () => {
    expect(names('warszwa')).toEqual(['Warszawa']);
    expect(names('pilatse')).toEqual(['Hot Pilates', 'Pilates Studio Kraków']); // shorter first
    expect(names('krakow pilatse')).toEqual(['Pilates Studio Kraków']);
    expect(createSuggestionIndex(places, { text: p => p.name, typos: false }).search('warszwa')).toEqual([]);
  });

  it('matches inside a word from three letters', () => {
    expect(names('ystaw')).toEqual(['Krasnystaw']);
  });

  it('drops whole stop words but not a half-typed last word', () => {
    expect(names('pilates w krak')).toEqual(['Pilates Studio Kraków']);
    expect(names('w')).toEqual(['Warszawa']);
  });

  it('keeps input order among equal matches, and honours the limit', () => {
    const idx = createSuggestionIndex(['ab one', 'ab two', 'ab six'], { text: s => s });
    expect(idx.search('ab', 2)).toEqual(['ab one', 'ab two']);
    expect(idx.search('  ')).toEqual([]);
  });
});

describe('createAutocomplete', () => {
  afterEach(() => vi.useRealTimers());

  it('applies a sync source in the same tick', () => {
    const ac = createAutocomplete({ source: q => names(q), debounceMs: 0 });
    ac.input('kra');
    expect(ac.state).toMatchObject({ query: 'kra', loading: false, items: ['Kraków', 'Krasnystaw', 'Pilates Studio Kraków'] });
  });

  it('debounces, and only the last keystroke reaches the source', async () => {
    vi.useFakeTimers();
    const source = vi.fn(async (q: string) => [q]);
    const ac = createAutocomplete({ source });
    ac.input('k'); ac.input('kr'); ac.input('kra');
    expect(ac.state.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(source).toHaveBeenCalledTimes(1);
    expect(ac.state).toMatchObject({ items: ['kra'], loading: false });
  });

  it('drops a slow answer that a newer query overtook, and aborts it', async () => {
    const resolvers: Record<string, (v: string[]) => void> = {};
    const signals: AbortSignal[] = [];
    const ac = createAutocomplete<string>({
      debounceMs: 0,
      source: (q, { signal }) => { signals.push(signal); return new Promise(r => { resolvers[q] = r; }); },
    });
    ac.input('ab'); ac.input('abc');
    expect(signals[0].aborted).toBe(true);
    resolvers.abc(['new']); resolvers.ab(['old']);
    await Promise.resolve();
    expect(ac.state.items).toEqual(['new']);
  });

  it('keeps short queries away from the source', () => {
    const source = vi.fn(() => ['x']);
    const ac = createAutocomplete({ source, debounceMs: 0, minLength: 2 });
    ac.input('a ');
    expect(source).not.toHaveBeenCalled();
    expect(ac.state.items).toEqual([]);
  });

  it('reports a failing source and recovers on the next success', async () => {
    let fail = true;
    const ac = createAutocomplete({ debounceMs: 0, source: async () => { if (fail) throw new Error('down'); return ['ok']; } });
    ac.input('ab');
    await Promise.resolve();
    expect(ac.state).toMatchObject({ items: [], loading: false });
    expect(ac.state.error).toBeInstanceOf(Error);
    fail = false;
    ac.input('abc');
    await Promise.resolve();
    expect(ac.state).toMatchObject({ items: ['ok'], error: null });
  });

  it('moves the keyboard position with wrap-around', () => {
    const ac = createAutocomplete({ source: () => ['a', 'b', 'c'], debounceMs: 0 });
    ac.input('x');
    ac.move(-1); expect(ac.selected()).toBe('c');
    ac.move(1); expect(ac.selected()).toBe('a');
    ac.move(1); expect(ac.state.active).toBe(1);
    ac.input('xy'); expect(ac.state.active).toBe(-1);
  });

  it('is a store: subscribers get the state now and on change', () => {
    const ac = createAutocomplete({ source: () => ['a'], debounceMs: 0 });
    const seen: number[] = [];
    const stop = ac.subscribe(s => seen.push(s.items.length));
    ac.input('x');
    ac.close();
    stop();
    ac.input('y');
    expect(seen.at(0)).toBe(0);
    expect(seen.at(-1)).toBe(0);
    expect(seen).toContain(1);
  });

  it('forgets the query on close, so nothing reads as "no results"', () => {
    const ac = createAutocomplete({ source: () => [], debounceMs: 0 });
    ac.input('zz');
    expect(ac.state.query).toBe('zz');
    ac.close();
    expect(ac.state).toMatchObject({ query: '', items: [] });
  });
});
