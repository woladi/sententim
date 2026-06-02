# scripts/etl

Deterministic data pipeline. Runs locally on a developer machine; produces
`data/judgments.db` which is committed and shipped inside the npm package.

**Zero LLM calls in this directory.** Every record in the DB is computable
from raw upstream JSON + the parsers in `parsers/` + the schema in
`data/schema.sql`. To audit the pipeline you only need to look at three
folders.

## Layout

| Path                          | Role                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `lib/http.ts`                 | Tiny fetch wrapper · retry · backoff · timeout. No external deps.                 |
| `lib/jsonl.ts`                | Streaming JSONL reader/writer.                                                    |
| `lib/paths.ts`                | Single source of truth for every disk path the ETL touches.                       |
| `sources/saos.ts`             | SAOS REST API client — search + single-judgment fetch.                            |
| `sources/cjeu.ts`             | **DEFERRED** — gated behind `SENTENTIM_ENABLE_CJEU=1`, see file header.           |
| `parsers/sentencja-typ.ts`    | Outcome regex: `oddala` / `uwzglednia` / `uchyla_przekazuje` / `zmienia` / `umarza`. |
| `parsers/podstawa-prawna.ts`  | Article-and-act regex → `["art. 45 ukk", …]`.                                     |
| `parsers/sad-instancja.ts`    | Court name → `SR` / `SO` / `SA` / `SN` / `NSA` / `WSA` / `TK`.                    |
| `normalize.ts`                | Raw SAOS JSONL → canonical `judgments` rows + sha256 + data_pobrania.             |
| `build-db.ts`                 | Staged JSONL → `data/judgments.db` (with FTS5 optimize + ANALYZE).                |
| `seed.ts`                     | Cold-start entrypoint — runs the union of two SAOS queries.                       |
| `verify.ts`                   | `prepublishOnly` sanity gate — opens DB, asserts `PRAGMA query_only=1`, latency. |

## When to run what

```bash
pnpm etl:seed                # full union (~15-20 min)
pnpm etl:seed --max=50       # smoke test
pnpm etl:seed --skip-fetch   # re-normalise from existing raw JSONLs
pnpm etl:verify              # what `prepublishOnly` runs
```

## Environment

| Variable                  | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `SENTENTIM_DB_PATH`       | Override DB path (build) / DB read path (runtime).                     |
| `SENTENTIM_ENABLE_CJEU`   | Allow `sources/cjeu.ts` to be invoked. Default: disabled.              |

## Audit trail

For every row in the published DB:

- `zrodlo_url` — public link back to the source (SAOS).
- `sha256` — SHA-256 of the raw `textContent` we used to extract fields.
  Run `curl <zrodlo_url> | jq -r .textContent | sha256sum` and compare —
  if the hash matches, you're looking at the same bytes we parsed.
- `data_pobrania` — ISO timestamp of the fetch.

This is the entire integrity story. There's no LLM-derived field to audit,
because there's no LLM in the pipeline.
