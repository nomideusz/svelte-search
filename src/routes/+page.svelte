<script lang="ts">
	import {
		normalize,
		trigrams,
		trigramSimilarity,
		levenshtein,
		levenshteinSimilarity,
		hasGeoIntent,
		stripGeoIntent,
		stripStopWords,
		isPostcode,
		haversineKm,
		walkingMinutes,
		formatDistance,
		formatWalkingTime,
		boundingBox,
		parseQuery,
		type ResolverLookups,
	} from '$lib/index.js';
	import { plLocale } from '$lib/locales/pl.js';

	// ── 1. Normalization & tokenization ──────────────────────

	let nQuery = $state('Hatha w Warszawie blisko mnie');
	let nPolish = $state(true);
	const nLocale = $derived(nPolish ? plLocale : undefined);
	const nNormalized = $derived(normalize(nQuery, nLocale));
	const nGeoIntent = $derived(hasGeoIntent(nQuery, nLocale));
	const nAfterGeo = $derived(stripGeoIntent(nNormalized, nLocale));
	const nAfterStop = $derived(stripStopWords(nAfterGeo, nLocale));
	const nTokens = $derived(nAfterStop.split(/\s+/).filter(Boolean));
	const nTrigrams = $derived(trigrams(nAfterStop, nLocale));
	const nIsPostcode = $derived(isPostcode(nQuery.trim()));

	// ── 2. Similarity ────────────────────────────────────────

	const SIM_PRESETS = [
		['hatha', 'hata'],
		['vinyasa', 'vinjasa'],
		['Warszawa', 'Warzsawa'],
		['ashtanga', 'astanga'],
		['kundalini', 'kundalin'],
		['restorative', 'restoratywna'],
	];

	let sA = $state('hatha');
	let sB = $state('hata');
	const sTrigram = $derived(trigramSimilarity(sA, sB));
	const sLev = $derived(levenshtein(normalize(sA), normalize(sB)));
	const sLevSim = $derived(levenshteinSimilarity(sA, sB));

	function fmtPct(v: number) {
		return `${Math.round(v * 100)}%`;
	}

	// ── 3. Geo ───────────────────────────────────────────────

	const CITIES: Record<string, [number, number]> = {
		Warsaw: [52.229, 21.012],
		Kraków: [50.062, 19.937],
		Gdańsk: [54.372, 18.638],
		Poznań: [52.406, 16.925],
		Wrocław: [51.108, 17.038],
		Łódź: [51.76, 19.455],
	};
	const CITY_NAMES = Object.keys(CITIES);

	let gFrom = $state('Warsaw');
	let gTo = $state('Kraków');
	let gRadius = $state(5);
	const gFromCoords = $derived(CITIES[gFrom]);
	const gToCoords = $derived(CITIES[gTo]);
	const gKm = $derived(haversineKm(gFromCoords[0], gFromCoords[1], gToCoords[0], gToCoords[1]));
	const gWalkMin = $derived(walkingMinutes(gKm));
	const gBBox = $derived(boundingBox(gFromCoords[0], gFromCoords[1], gRadius));
	const gBBoxText = $derived(
		`{\n  minLat: ${gBBox.minLat.toFixed(5)},\n  maxLat: ${gBBox.maxLat.toFixed(5)},\n  minLng: ${gBBox.minLng.toFixed(5)},\n  maxLng: ${gBBox.maxLng.toFixed(5)}\n}`,
	);

	// ── 4. Query resolver ────────────────────────────────────

	const lookups: ResolverLookups = {
		locationMap: new Map([
			['warszawa', 'warsaw'],
			['warszawie', 'warsaw'],
			['warszawy', 'warsaw'],
			['krakow', 'krakow'],
			['krakowie', 'krakow'],
			['krakowa', 'krakow'],
			['gdansk', 'gdansk'],
			['gdansku', 'gdansk'],
			['poznan', 'poznan'],
			['poznaniu', 'poznan'],
			['wroclaw', 'wroclaw'],
			['wroclawiu', 'wroclaw'],
			['lodz', 'lodz'],
			['lodzi', 'lodz'],
		]),
		categoryMap: new Map([
			['hatha', 'hatha'],
			['vinyasa', 'vinyasa'],
			['yin', 'yin'],
			['ashtanga', 'ashtanga'],
			['kundalini', 'kundalini'],
			['power', 'power-yoga'],
			['restorative', 'restorative'],
			['nidra', 'nidra'],
		]),
		areaMap: new Map([
			['warsaw', ['mokotow', 'praga', 'wola', 'ochota', 'srodmiescie']],
			['krakow', ['stare miasto', 'kazimierz', 'nowa huta', 'podgorze']],
			['gdansk', ['stare miasto', 'wrzeszcz', 'oliwa']],
			['poznan', ['stare miasto', 'jezyce', 'grunwald']],
			['wroclaw', ['stare miasto', 'krzyki', 'srodmiescie']],
			['lodz', ['srodmiescie', 'widzew', 'baluty']],
		]),
		locationEntityCount: new Map([
			['warsaw', 284],
			['krakow', 156],
			['gdansk', 88],
			['poznan', 74],
			['wroclaw', 112],
			['lodz', 63],
		]),
	};

	const RESOLVER_PRESETS = [
		'hatha w warszawie mokotow',
		'vinyasa kraków',
		'joga blisko mnie',
		'yin yoga w gdansku wrzeszcz',
		'02-001 hatha',
		'nidra',
	];

	let rQuery = $state('hatha w warszawie mokotow');
	const rParsed = $derived(parseQuery(rQuery, lookups, plLocale));
</script>

<svelte:head>
	<title>svelte-search — Demo</title>
</svelte:head>

<main>
	<section class="hero">
		<h1>Full-text search for Svelte 5 apps</h1>
		<p class="lead">
			FTS5 / <code>tsvector</code>, trigram fuzzy matching, geo proximity, synonym expansion, query resolution,
			Polish locale support. Driven by your own database via a pluggable schema adapter.
		</p>
		<div class="install">
			<code>pnpm add @nomideusz/svelte-search</code>
		</div>
	</section>

	<!-- ═══ Playground 1: Normalize & tokenize ═════════════ -->
	<section class="card">
		<header class="card-hd">
			<h2>1. Normalize & tokenize</h2>
			<span class="hd-meta">normalize · trigrams · stripGeoIntent · stripStopWords · isPostcode</span>
		</header>

		<div class="row">
			<div class="input-box">
				<label for="n-q">Query</label>
				<input id="n-q" type="text" bind:value={nQuery} placeholder="Try: hatha w Warszawie blisko mnie" />
			</div>
			<label class="toggle">
				<input type="checkbox" bind:checked={nPolish} />
				<span>Polish locale</span>
			</label>
		</div>

		<div class="output-grid">
			<div class="out">
				<span class="out-label">Normalized</span>
				<code class="out-val">{nNormalized || '—'}</code>
			</div>
			<div class="out">
				<span class="out-label">After stripGeoIntent</span>
				<code class="out-val">{nAfterGeo || '—'}</code>
			</div>
			<div class="out">
				<span class="out-label">After stripStopWords</span>
				<code class="out-val">{nAfterStop || '—'}</code>
			</div>
			<div class="out">
				<span class="out-label">Geo intent</span>
				<span class="badge" class:badge-on={nGeoIntent}>{nGeoIntent ? 'yes' : 'no'}</span>
			</div>
			<div class="out">
				<span class="out-label">Postcode?</span>
				<span class="badge" class:badge-on={nIsPostcode}>{nIsPostcode ? 'yes' : 'no'}</span>
			</div>
			<div class="out">
				<span class="out-label">Token count</span>
				<code class="out-val">{nTokens.length}</code>
			</div>
		</div>

		<div class="chips-block">
			<span class="block-label">Tokens</span>
			{#if nTokens.length === 0}
				<span class="empty">—</span>
			{:else}
				<div class="chips">
					{#each nTokens as t}
						<span class="chip">{t}</span>
					{/each}
				</div>
			{/if}
		</div>

		<div class="chips-block">
			<span class="block-label">Trigrams <span class="count">({nTrigrams.length})</span></span>
			{#if nTrigrams.length === 0}
				<span class="empty">—</span>
			{:else}
				<div class="chips chips-dense">
					{#each nTrigrams as t}
						<span class="chip chip-mono">{t}</span>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<!-- ═══ Playground 2: Similarity ═══════════════════════ -->
	<section class="card">
		<header class="card-hd">
			<h2>2. Similarity</h2>
			<span class="hd-meta">trigramSimilarity · levenshtein · levenshteinSimilarity</span>
		</header>

		<div class="row two-col">
			<div class="input-box">
				<label for="s-a">A</label>
				<input id="s-a" type="text" bind:value={sA} />
			</div>
			<div class="input-box">
				<label for="s-b">B</label>
				<input id="s-b" type="text" bind:value={sB} />
			</div>
		</div>

		<div class="presets">
			{#each SIM_PRESETS as [a, b]}
				<button class="preset" onclick={() => { sA = a; sB = b; }}>
					<span>{a}</span>
					<span class="arrow">↔</span>
					<span>{b}</span>
				</button>
			{/each}
		</div>

		<div class="output-grid">
			<div class="out">
				<span class="out-label">Trigram similarity</span>
				<div class="metric">
					<code class="out-val">{sTrigram.toFixed(3)}</code>
					<span class="metric-pct">{fmtPct(sTrigram)}</span>
				</div>
				<div class="bar"><div class="bar-fill" style:width="{sTrigram * 100}%"></div></div>
			</div>
			<div class="out">
				<span class="out-label">Levenshtein distance</span>
				<code class="out-val">{sLev} edit{sLev === 1 ? '' : 's'}</code>
			</div>
			<div class="out">
				<span class="out-label">Levenshtein similarity</span>
				<div class="metric">
					<code class="out-val">{sLevSim.toFixed(3)}</code>
					<span class="metric-pct">{fmtPct(sLevSim)}</span>
				</div>
				<div class="bar"><div class="bar-fill" style:width="{sLevSim * 100}%"></div></div>
			</div>
		</div>
	</section>

	<!-- ═══ Playground 3: Geo ══════════════════════════════ -->
	<section class="card">
		<header class="card-hd">
			<h2>3. Geo helpers</h2>
			<span class="hd-meta">haversineKm · walkingMinutes · boundingBox · formatDistance · formatWalkingTime</span>
		</header>

		<div class="row three-col">
			<div class="input-box">
				<label for="g-from">From</label>
				<select id="g-from" bind:value={gFrom}>
					{#each CITY_NAMES as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</div>
			<div class="input-box">
				<label for="g-to">To</label>
				<select id="g-to" bind:value={gTo}>
					{#each CITY_NAMES as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</div>
			<div class="input-box">
				<label for="g-r">Radius (km)</label>
				<input id="g-r" type="number" min="1" max="100" bind:value={gRadius} />
			</div>
		</div>

		<div class="output-grid">
			<div class="out">
				<span class="out-label">Haversine distance</span>
				<code class="out-val">{gKm.toFixed(2)} km</code>
			</div>
			<div class="out">
				<span class="out-label">formatDistance</span>
				<code class="out-val">{formatDistance(gKm)}</code>
			</div>
			<div class="out">
				<span class="out-label">Walking time</span>
				<code class="out-val">{gWalkMin} min</code>
			</div>
			<div class="out">
				<span class="out-label">formatWalkingTime</span>
				<code class="out-val">{formatWalkingTime(gWalkMin)}</code>
			</div>
		</div>

		<div class="chips-block">
			<span class="block-label">Bounding box (for SQL pre-filter)</span>
			<pre class="json">{gBBoxText}</pre>
		</div>
	</section>

	<!-- ═══ Playground 4: Resolver ═════════════════════════ -->
	<section class="card">
		<header class="card-hd">
			<h2>4. Query resolver</h2>
			<span class="hd-meta">parseQuery · classifies tokens into location / category / area / rest</span>
		</header>

		<div class="row">
			<div class="input-box">
				<label for="r-q">Query</label>
				<input id="r-q" type="text" bind:value={rQuery} placeholder="hatha w warszawie mokotow" />
			</div>
		</div>

		<div class="presets">
			{#each RESOLVER_PRESETS as p}
				<button class="preset" onclick={() => (rQuery = p)}>{p}</button>
			{/each}
		</div>

		<div class="output-grid">
			<div class="out">
				<span class="out-label">Location</span>
				{#if rParsed.location}
					<code class="out-val">{rParsed.location.slug}</code>
					<span class="out-meta">matched "{rParsed.location.original}"</span>
				{:else}
					<span class="empty">not detected</span>
				{/if}
			</div>
			<div class="out">
				<span class="out-label">Category</span>
				{#if rParsed.category}
					<code class="out-val">{rParsed.category.slug}</code>
					<span class="out-meta">matched "{rParsed.category.original}"</span>
				{:else}
					<span class="empty">not detected</span>
				{/if}
			</div>
			<div class="out">
				<span class="out-label">Postal code</span>
				{#if rParsed.postal}
					<code class="out-val">{rParsed.postal}</code>
				{:else}
					<span class="empty">—</span>
				{/if}
			</div>
			<div class="out">
				<span class="out-label">Geo intent</span>
				<span class="badge" class:badge-on={rParsed.geoIntent}>{rParsed.geoIntent ? 'yes' : 'no'}</span>
			</div>
		</div>

		<div class="chips-block">
			<span class="block-label">Remaining tokens</span>
			{#if rParsed.rest.length === 0}
				<span class="empty">—</span>
			{:else}
				<div class="chips">
					{#each rParsed.rest as t}
						<span class="chip">{t}</span>
					{/each}
				</div>
			{/if}
		</div>

		<details class="detail">
			<summary>Raw <code>ParsedQuery</code></summary>
			<pre class="json">{JSON.stringify(
				{
					normalized: rParsed.normalized,
					working: rParsed.working,
					geoIntent: rParsed.geoIntent,
					postal: rParsed.postal,
					location: rParsed.location,
					category: rParsed.category,
					rest: rParsed.rest,
				},
				null,
				2,
			)}</pre>
		</details>

		<details class="detail">
			<summary>Lookup data used in this demo</summary>
			<div class="lookup-grid">
				<div>
					<strong>locationMap ({lookups.locationMap.size})</strong>
					<p class="hint">includes Polish locative forms — "warszawie" and "warszawa" both resolve to <code>warsaw</code>.</p>
				</div>
				<div>
					<strong>categoryMap ({lookups.categoryMap.size})</strong>
					<p class="hint">yoga styles: hatha, vinyasa, yin, ashtanga, kundalini, power, restorative, nidra.</p>
				</div>
				<div>
					<strong>areaMap ({lookups.areaMap.size} locations)</strong>
					<p class="hint">districts per city — e.g. Warsaw: mokotow, praga, wola, ochota, śródmieście.</p>
				</div>
			</div>
		</details>
	</section>

	<section class="cta">
		<p>Ready to wire it up to your DB? See the <a href="/docs">docs</a> for the full <code>SchemaAdapter</code> contract.</p>
	</section>
</main>

<style>
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px 24px 80px;
	}

	@media (max-width: 600px) {
		main {
			padding: 16px 16px 48px;
		}
	}

	.hero {
		text-align: center;
		padding: 32px 0 40px;
	}
	.hero h1 {
		font: 700 34px/1.15 'Outfit', system-ui, sans-serif;
		margin: 0 0 14px;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.hero .lead {
		font: 400 15px/1.6 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		max-width: 640px;
		margin: 0 auto 24px;
	}
	.hero code {
		font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		font-size: 13px;
		background: var(--surface-2);
		padding: 1px 6px;
		border-radius: 4px;
		color: var(--accent);
	}
	.install {
		display: inline-block;
		padding: 10px 18px;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
	}
	.install code {
		background: none;
		padding: 0;
		color: var(--text);
		font-size: 13px;
	}

	@media (max-width: 600px) {
		.hero {
			padding: 16px 0 24px;
		}
		.hero h1 {
			font-size: 24px;
		}
		.hero .lead {
			font-size: 13.5px;
		}
	}

	/* ─── Card ─────────────────────────────────────────── */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 20px;
	}

	.card-hd {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 14px;
		margin-bottom: 18px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--border);
	}
	.card-hd h2 {
		font: 600 16px/1.3 'Outfit', system-ui, sans-serif;
		margin: 0;
		color: var(--text);
	}
	.hd-meta {
		font: 400 11px/1.3 ui-monospace, 'Cascadia Code', monospace;
		color: var(--text-3);
	}

	/* ─── Inputs ───────────────────────────────────────── */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 14px;
		margin-bottom: 14px;
	}
	.row.two-col .input-box,
	.row.three-col .input-box {
		flex: 1;
		min-width: 140px;
	}
	.row:not(.two-col):not(.three-col) .input-box {
		flex: 1;
		min-width: 200px;
	}

	.input-box {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.input-box label {
		font: 600 10px/1 'Outfit', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.input-box input,
	.input-box select {
		padding: 8px 11px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		border-radius: 6px;
		font: 400 13px/1.3 'Outfit', system-ui, sans-serif;
		outline: none;
		transition: border-color 120ms, background 120ms;
	}
	.input-box input:focus,
	.input-box select:focus {
		border-color: var(--accent);
		background: var(--bg);
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font: 500 12px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		cursor: pointer;
		padding: 8px 10px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		border-radius: 6px;
	}
	.toggle input {
		margin: 0;
		accent-color: var(--accent);
	}

	/* ─── Output ───────────────────────────────────────── */
	.output-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 10px;
		margin-bottom: 16px;
	}
	.out {
		padding: 10px 12px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 7px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 56px;
	}
	.out-label {
		font: 600 10px/1 'Outfit', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.out-val {
		font: 500 13px/1.3 ui-monospace, 'Cascadia Code', monospace;
		color: var(--text);
		word-break: break-word;
	}
	.out-meta {
		font: 400 11px/1.2 'Outfit', system-ui, sans-serif;
		color: var(--text-3);
	}

	.metric {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.metric-pct {
		font: 500 11px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
	}
	.bar {
		height: 4px;
		background: var(--surface);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 4px;
	}
	.bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 180ms ease;
	}

	.badge {
		display: inline-block;
		width: max-content;
		padding: 2px 8px;
		border-radius: 4px;
		font: 600 10.5px/1.4 'Outfit', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--surface);
		color: var(--text-3);
		border: 1px solid var(--border);
	}
	.badge-on {
		background: var(--accent-dim);
		color: var(--accent);
		border-color: var(--accent-glow);
	}

	/* ─── Chips / tokens ───────────────────────────────── */
	.chips-block {
		margin: 12px 0 0;
	}
	.block-label {
		display: block;
		font: 600 10px/1 'Outfit', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
		margin-bottom: 8px;
	}
	.count {
		color: var(--text-3);
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.chips-dense {
		gap: 3px;
	}
	.chip {
		padding: 3px 8px;
		border-radius: 4px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		font: 500 11.5px/1.2 'Outfit', system-ui, sans-serif;
		color: var(--text);
	}
	.chip-mono {
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 10.5px;
		color: var(--text-2);
	}

	.empty {
		font: 400 12px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-3);
		font-style: italic;
	}

	/* ─── Presets ──────────────────────────────────────── */
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 12px 0 16px;
	}
	.preset {
		padding: 5px 10px;
		background: transparent;
		border: 1px solid var(--border-strong);
		border-radius: 5px;
		font: 500 11px/1.2 ui-monospace, 'Cascadia Code', monospace;
		color: var(--text-2);
		cursor: pointer;
		transition: color 120ms, border-color 120ms, background 120ms;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.preset:hover {
		color: var(--text);
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.preset .arrow {
		color: var(--text-3);
	}

	/* ─── JSON / details ───────────────────────────────── */
	.json {
		margin: 0;
		padding: 12px 14px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 7px;
		font: 400 12px/1.5 ui-monospace, 'Cascadia Code', monospace;
		color: var(--text-2);
		overflow-x: auto;
		white-space: pre;
	}

	.detail {
		margin-top: 14px;
		border: 1px solid var(--border);
		border-radius: 7px;
		overflow: hidden;
	}
	.detail summary {
		padding: 9px 12px;
		cursor: pointer;
		font: 500 12px/1 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		background: var(--surface-2);
		list-style: none;
	}
	.detail summary::-webkit-details-marker {
		display: none;
	}
	.detail summary::before {
		content: '▸ ';
		color: var(--text-3);
		margin-right: 4px;
	}
	.detail[open] summary::before {
		content: '▾ ';
	}
	.detail summary:hover {
		color: var(--text);
	}
	.detail summary code {
		font-size: 11.5px;
		color: var(--accent);
	}
	.detail > :not(summary) {
		padding: 12px;
	}
	.lookup-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 14px;
	}
	.lookup-grid strong {
		font: 600 12px/1.2 'Outfit', system-ui, sans-serif;
		color: var(--text);
	}
	.lookup-grid .hint {
		font: 400 12px/1.5 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
		margin: 4px 0 0;
	}
	.lookup-grid code {
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 11px;
		background: var(--surface-2);
		padding: 1px 5px;
		border-radius: 3px;
		color: var(--accent);
	}

	/* ─── CTA ──────────────────────────────────────────── */
	.cta {
		text-align: center;
		padding: 24px 0 0;
		font: 400 14px/1.5 'Outfit', system-ui, sans-serif;
		color: var(--text-2);
	}
	.cta a {
		color: var(--accent);
		border-bottom: 1px solid var(--accent-glow);
	}
	.cta a:hover {
		border-bottom-color: var(--accent);
	}
	.cta code {
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 12.5px;
		background: var(--surface-2);
		padding: 1px 5px;
		border-radius: 3px;
		color: var(--text);
	}
</style>
