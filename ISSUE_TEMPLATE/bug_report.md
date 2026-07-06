---
name: Bug report
about: Something returns wrong results, throws, or breaks an adapter
title: ''
labels: bug
assignees: ''
---

## What happened?

<!-- A clear description of the bug. -->

## Minimal reproduction

<!-- The smallest setup that shows the problem. Usually enough:
- the query string
- a few example rows (name + the normalized columns involved)
- the relevant SchemaAdapter fields and engine config (dialect, locale, ftsColumnWeights…)
-->

```ts
// adapter/config + query here
```

**Expected results:**

**Actual results:**

## Environment

- `@nomideusz/svelte-search` version:
- Dialect: sqlite / postgres
- DB / driver (e.g. libsql, better-sqlite3, pg):
- Locale: pl / custom / none
