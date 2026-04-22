<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>svelte-search — Docs</title>
</svelte:head>

<main class="doc-content">
	{@html data.html}
</main>

<style>
	.doc-content {
		max-width: 1100px;
		margin: 0 auto;
		padding: 32px 24px 96px;
		color: var(--text);
		line-height: 1.7;
	}

	.doc-content :global(h1) {
		font: 700 28px/1.2 'Outfit', system-ui, sans-serif;
		color: var(--text);
		margin: 0 0 8px;
		letter-spacing: -0.01em;
	}
	.doc-content :global(h2) {
		font: 600 20px/1.3 'Outfit', system-ui, sans-serif;
		color: var(--text);
		margin: 40px 0 14px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}
	.doc-content :global(h3) {
		font: 600 15px/1.3 'Outfit', system-ui, sans-serif;
		color: var(--text);
		margin: 28px 0 10px;
	}

	.doc-content :global(p) {
		font-size: 14px;
		margin: 0 0 14px;
		color: var(--text);
	}
	.doc-content :global(> p:first-of-type) {
		font-size: 15px;
		color: var(--text-2);
		margin-bottom: 28px;
	}

	.doc-content :global(blockquote) {
		margin: 0 0 16px;
		padding: 10px 14px;
		border-left: 3px solid var(--accent-glow);
		background: var(--accent-dim);
		border-radius: 0 6px 6px 0;
		font-size: 13px;
		color: var(--text-2);
	}
	.doc-content :global(blockquote p) {
		margin: 0;
	}

	.doc-content :global(pre) {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 14px 18px;
		overflow-x: auto;
		margin: 0 0 18px;
		font: 400 12.5px/1.6 ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		color: var(--text);
	}
	.doc-content :global(code) {
		font: 400 12.5px/1 ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		background: var(--surface-2);
		padding: 2px 6px;
		border-radius: 4px;
		color: var(--text);
	}
	.doc-content :global(pre code) {
		background: none;
		padding: 0;
		border-radius: 0;
	}

	.doc-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0 0 18px;
		font-size: 13px;
	}
	.doc-content :global(th) {
		text-align: left;
		padding: 8px 12px;
		font: 600 11px/1 'Outfit', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
		border-bottom: 1px solid var(--border-strong);
	}
	.doc-content :global(td) {
		padding: 7px 12px;
		border-bottom: 1px solid var(--border);
		color: var(--text-2);
		vertical-align: top;
	}
	.doc-content :global(td code) {
		font-size: 12px;
		color: var(--accent);
		background: var(--accent-dim);
	}

	.doc-content :global(ul),
	.doc-content :global(ol) {
		padding-left: 20px;
		margin: 0 0 14px;
	}
	.doc-content :global(li) {
		font-size: 14px;
		margin-bottom: 4px;
		color: var(--text);
	}

	.doc-content :global(a) {
		color: var(--accent);
		border-bottom: 1px solid var(--accent-glow);
		transition: border-color 120ms;
	}
	.doc-content :global(a:hover) {
		border-color: var(--accent);
	}

	.doc-content :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 28px 0;
	}

	.doc-content :global(strong) {
		font-weight: 600;
		color: var(--text);
	}

	@media (max-width: 600px) {
		.doc-content {
			padding: 20px 16px 48px;
		}
		.doc-content :global(h1) {
			font-size: 22px;
		}
		.doc-content :global(h2) {
			font-size: 17px;
			margin-top: 32px;
		}
		.doc-content :global(pre) {
			padding: 10px 12px;
			font-size: 12px;
		}
		.doc-content :global(table) {
			display: block;
			overflow-x: auto;
		}
		.doc-content :global(th),
		.doc-content :global(td) {
			padding: 6px 8px;
			white-space: nowrap;
		}
	}
</style>
