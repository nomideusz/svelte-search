# CLAUDE.md — @nomideusz/svelte-search

Notes for working on this package. Read alongside `/CLAUDE.md` and the
package registry in `/AGENTS.md`.

## Folding is one function

`stripDiacriticsGeneric` (`src/lib/core/normalize.ts`) is the whole fold:
NFD, U+0300–036F marks out, plus a table for letters NFD leaves whole
(ł, ø, ß, æ, œ, þ, đ, ı …). `normalize` keeps `\p{L}\p{M}\p{N}`, so Cyrillic,
Greek and Indic text survive as tokens; `plLocale.stripDiacritics` is the
same function. A change to either changes what every `*_n` column holds —
apps must renormalize stored columns after it.

## Locales strip grammar, apps strip domain

`plLocale` stop words are Polish grammar only. Domain vocabulary ("joga",
"kurs", "szkola jogi") lives in the app: yoga's `yogaLocale` in
`apps/yoga/src/lib/search/normalize.ts`.
