<script lang="ts">
	import { page } from '$app/state';
	import { scheme, setScheme } from './theme.svelte.js';

	let { children } = $props();
	const path = $derived(page.url.pathname);

	$effect(() => {
		document.documentElement.dataset.scheme = scheme.current;
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<header class="site-hd">
	<a class="site-logo" href="/">
		<span class="logo-mark">◉</span>
		<span>svelte-search</span>
	</a>

	<nav class="site-nav">
		<a class="site-link" class:site-link--active={path === '/'} href="/">Demo</a>
		<a class="site-link" class:site-link--active={path === '/docs'} href="/docs">Docs</a>
	</nav>

	<button
		class="scheme-toggle"
		onclick={() => setScheme(scheme.current === 'dark' ? 'light' : 'dark')}
		title="Toggle light/dark"
		aria-label="Toggle light/dark"
	>
		{scheme.current === 'dark' ? '☾' : '☀'}
	</button>

	<a class="site-gh" href="https://github.com/nomideusz/svelte-search" target="_blank" rel="noopener">
		<svg viewBox="0 0 16 16" fill="currentColor" width="15" height="15" aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.62 7.62 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
		</svg>
		<span>GitHub</span>
	</a>
</header>

{@render children()}

<style>
	:global(:root) {
		--bg: #08080c;
		--surface: #0d0f14;
		--surface-2: #11141b;
		--border: rgba(148, 163, 184, 0.08);
		--border-strong: rgba(148, 163, 184, 0.15);
		--text: rgba(226, 232, 240, 0.92);
		--text-2: rgba(148, 163, 184, 0.7);
		--text-3: rgba(100, 116, 139, 0.55);
		--accent: #f97316;
		--accent-dim: rgba(249, 115, 22, 0.12);
		--accent-glow: rgba(249, 115, 22, 0.25);
		--success: #34d399;
		--warning: #fbbf24;
		--danger: #ef4444;
	}

	:global([data-scheme='light']) {
		--bg: #ffffff;
		--surface: #fafafa;
		--surface-2: #f3f4f6;
		--border: rgba(0, 0, 0, 0.06);
		--border-strong: rgba(0, 0, 0, 0.12);
		--text: rgba(0, 0, 0, 0.87);
		--text-2: rgba(0, 0, 0, 0.55);
		--text-3: rgba(0, 0, 0, 0.35);
		--accent: #ea580c;
		--accent-dim: rgba(234, 88, 12, 0.1);
		--accent-glow: rgba(234, 88, 12, 0.2);
	}

	:global(html) {
		background: var(--bg);
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: 'Outfit', system-ui, -apple-system, sans-serif;
		-webkit-font-smoothing: antialiased;
		transition: background 300ms ease, color 300ms ease;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
	}

	.site-hd {
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: 1100px;
		margin: 0 auto;
		padding: 16px 24px;
	}

	.site-logo {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: 600 15px/1 'Outfit', system-ui, sans-serif;
		color: var(--text);
		letter-spacing: -0.01em;
		margin-right: auto;
	}

	.logo-mark {
		color: var(--accent);
		font-size: 17px;
	}

	.site-nav {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.site-link {
		padding: 5px 12px;
		border-radius: 6px;
		font: 500 11.5px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		transition: color 120ms, background 120ms;
	}
	.site-link:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.site-link--active {
		color: var(--text);
	}

	.scheme-toggle {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
		border-radius: 6px;
		cursor: pointer;
		font-size: 13px;
		transition: color 120ms, border-color 120ms, background 120ms;
	}
	.scheme-toggle:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}

	.site-gh {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		font: 500 11px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		transition: color 120ms, border-color 120ms;
	}
	.site-gh:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.site-gh svg {
		opacity: 0.7;
	}

	@media (max-width: 600px) {
		.site-hd {
			padding: 12px 16px;
			gap: 10px;
		}
		.site-gh span {
			display: none;
		}
		.site-gh {
			padding: 6px 8px;
		}
	}
</style>
