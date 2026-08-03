import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Marked } from 'marked';

export const prerender = true;

/** GitHub-style anchor slug: lowercase, drop punctuation, spaces to dashes. */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]*>/g, '')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

// marked dropped automatic heading ids in v16, so a `[link](#section)` in the
// README resolves to nothing and SvelteKit's prerenderer fails the build on the
// dangling anchor. Re-add them, matching GitHub's slug rules so the same links
// work both here and on the repo page.
const marked = new Marked({ gfm: true });
marked.use({
	renderer: {
		heading({ tokens, depth }) {
			const text = this.parser.parseInline(tokens);
			return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
		},
	},
});

export async function load() {
	const md = readFileSync(resolve('README.md'), 'utf-8');
	const html = await marked.parse(md);
	return { html };
}
