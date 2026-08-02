import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// transpile TS out of shipped .svelte files so consumers without a TS
	// preprocessor (svelte-loader, bundlephobia, plain rollup) can compile them
	preprocess: vitePreprocess({ script: true, style: false }),
	kit: {
		adapter: adapter()
	}
};

export default config;
