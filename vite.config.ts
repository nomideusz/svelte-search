import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit({
		adapter: adapter(),
		// transpile TS out of shipped .svelte files so consumers without a TS
		// preprocessor (svelte-loader, bundlephobia, plain rollup) can compile them
		preprocess: vitePreprocess({ script: true, style: false })
	})],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
});
