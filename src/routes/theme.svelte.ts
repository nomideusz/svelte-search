export type Scheme = 'dark' | 'light';

const STORAGE_KEY = 'svelte-search-scheme';

function initial(): Scheme {
	if (typeof localStorage === 'undefined') return 'dark';
	const v = localStorage.getItem(STORAGE_KEY);
	return v === 'light' ? 'light' : 'dark';
}

export const scheme = $state<{ current: Scheme }>({ current: initial() });

export function setScheme(v: Scheme) {
	scheme.current = v;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, v);
	}
}
