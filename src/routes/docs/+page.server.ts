import { readFileSync } from 'fs';
import { resolve } from 'path';
import { marked } from 'marked';

export const prerender = true;

export async function load() {
	const md = readFileSync(resolve('README.md'), 'utf-8');
	const html = await marked(md, { gfm: true });
	return { html };
}
