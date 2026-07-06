# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

Only the latest minor release receives security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

- Preferred: use GitHub's [private vulnerability reporting](https://github.com/nomideusz/svelte-search/security/advisories/new) on this repository.
- Alternatively, email **b.dymet@gmail.com** with a description and reproduction steps.

You can expect an acknowledgement within a few days. Once a fix is released, the vulnerability will be disclosed in the changelog. Please give us a reasonable window to ship a fix before public disclosure.

## Scope notes

This library builds SQL from two kinds of input, treated very differently:

- **User queries** are always bound as parameters — a report showing user-supplied query text reaching SQL unparameterized would be a serious, in-scope finding.
- **Adapter/engine config** (table names, column names, `ftsColumnWeights`) is interpolated into SQL by design and is trusted, developer-supplied configuration — passing untrusted input there is a misuse of the API, not a vulnerability. A report showing config values sourced from user input *within this library itself* would still be in scope.

Also in scope: normalization/locale functions producing pathological output (ReDoS, unbounded growth) from user queries.
