// ============================================================
// @nomideusz/svelte-search — Search canary
// ============================================================
// Row counts cannot tell you whether search actually works. On an
// external-content FTS5 table they stay in sync even when the index is empty
// (see checkFtsSync), and they say nothing about empty normalized columns or a
// view that filters more than you think.
//
// The canary probes the real search path instead: sample entities, search for
// each by its own name, and assert it comes back. That is the query a user is
// most likely to type, and it fails loudly for the whole "the row exists but
// search can't see it" class of bugs.

import type { DatabaseClient, SchemaAdapter, SearchParams, SearchResponse, SearchResult } from './types.js';

export interface CanaryConfig<TResult extends SearchResult = SearchResult> {
  db: DatabaseClient;
  adapter: SchemaAdapter<TResult>;
  /** The search entry point to probe through — normally the engine's `search`. */
  search(params: SearchParams): Promise<SearchResponse<TResult>>;
  /**
   * Extra SQL predicate scoping which rows are expected to be findable,
   * e.g. `'is_listed = 1'`. Must be a literal you control, not user input.
   */
  where?: string;
  /** How many entities to probe per run (default: 5). */
  sampleSize?: number;
  /**
   * A name token appearing in more than this many entities is treated as
   * non-identifying (default: 5). An entity whose every token is common
   * ("Studio Jogi Kraków") cannot be found by name no matter how healthy the
   * index is, so it is skipped rather than reported as a failure.
   */
  maxTokenDf?: number;
  /** Results to scan for the probed entity (default: 30). */
  probeLimit?: number;
}

export interface CanaryResult {
  /** Entities actually probed — never more than sampleSize, fewer if few qualify. */
  sampled: number;
  passed: number;
  failures: Array<{ id: string; name: string; query: string }>;
  /**
   * Entities in scope whose normalized name is empty. These are invisible to
   * both FTS and trigram search and cannot even be sampled, so they are
   * counted separately — a non-zero value means indexing is broken upstream.
   */
  unindexed: number;
}

export function createCanary<TResult extends SearchResult = SearchResult>(
  config: CanaryConfig<TResult>
) {
  const {
    db, adapter, search,
    where, sampleSize = 5, maxTokenDf = 5, probeLimit = 30,
  } = config;
  const { tables, columns } = adapter;
  const scope = where ? ` AND ${where}` : '';

  async function run(): Promise<CanaryResult> {
    const unindexedRes = await db.execute(
      `SELECT COUNT(*) AS c FROM ${tables.entities}` +
      ` WHERE (${columns.nameNormalized} = '' OR ${columns.nameNormalized} IS NULL)${scope}`,
    );
    const unindexed = Number((unindexedRes.rows[0] as Record<string, unknown>).c);

    const res = await db.execute(
      `SELECT ${columns.id}, ${columns.name}, ${columns.nameNormalized}` +
      ` FROM ${tables.entities} WHERE ${columns.nameNormalized} != ''${scope}`,
    );
    const rows = res.rows;

    // Document frequency per name token, so we only probe entities that a name
    // search could actually single out.
    const df = new Map<string, number>();
    for (const row of rows) {
      const nameN = (row[columns.nameNormalized] as string) ?? '';
      for (const token of new Set(nameN.split(/[\s-]+/))) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
    const rarestDf = (nameN: string) => {
      const tokens = nameN.split(/[\s-]+/).filter((t) => t.length >= 4);
      if (tokens.length === 0) return Infinity;
      return Math.min(...tokens.map((t) => df.get(t) ?? Infinity));
    };

    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    const failures: CanaryResult['failures'] = [];
    let sampled = 0;

    for (const row of shuffled) {
      if (sampled >= sampleSize) break;
      if (rarestDf((row[columns.nameNormalized] as string) ?? '') > maxTokenDf) continue;
      sampled++;

      const name = row[columns.name] as string;
      const id = row[columns.id];
      const resp = await search({ query: name, limit: probeLimit });
      if (!resp.results.some((r) => r.id === id)) {
        failures.push({ id: String(id), name, query: name });
      }
    }

    return { sampled, passed: sampled - failures.length, failures, unindexed };
  }

  return { run };
}
