# scripts/etl

The data pipeline. **Lives outside `src/`** because:

- it does not ship in the npm package;
- it depends on `@anthropic-ai/sdk` (devDependency) and the developer's API key;
- it produces the artefact (`data/rulings.db`) that *does* ship.

## Layout

| Path                 | Role                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/http.ts`        | Tiny fetch wrapper · retry · backoff · timeout. No external deps.                               |
| `lib/jsonl.ts`       | Streaming JSONL reader/writer.                                                                  |
| `lib/paths.ts`       | Single source of truth for every disk path the ETL touches.                                     |
| `sources/saos.ts`    | SAOS REST API client — Polish Supreme Court (frozen at 2016-06-22).                             |
| `sources/cjeu.ts`    | CELLAR SPARQL + REST client — CJEU/TSUE with `Accept-Language: pol` fallback.                   |
| `normalize.ts`       | Raw upstream JSONL → canonical `Ruling` schema.                                                 |
| `summarize.ts`       | Anthropic Haiku 4.5 → 2-sentence summary + 3–10 tags per ruling.                                |
| `build-db.ts`        | Stage JSONL → `data/rulings.db` (with FTS5 optimize + ANALYZE).                                 |
| `seed.ts`            | Local "cold start" entrypoint.  *Heavy, runs on the developer machine.*                         |
| `incremental.ts`     | Weekly delta entrypoint.  *Runs in GitHub Actions.*                                             |
| `verify.ts`          | `prepublishOnly` sanity gate — exits non-zero on bad / empty / unreadable DB.                   |

## When to run what

```bash
# Cold start — once per repo lifetime
ANTHROPIC_API_KEY=sk-ant-... pnpm etl:seed
pnpm etl:seed -- --max-sn=200 --max-cjeu=50   # smoke test against the full pipeline
pnpm etl:seed -- --no-cjeu                    # only Sąd Najwyższy

# Manual step-by-step
pnpm etl:saos
pnpm etl:cjeu
pnpm etl:summarize
pnpm etl:build-db
pnpm etl:verify

# Weekly delta — what GitHub Actions runs
pnpm etl:incremental
```

## Environment

| Variable                      | Purpose                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | **Required** for summarisation. Hits Haiku at low temperature.                              |
| `SENTENTIM_SUMMARY_MODEL`     | Override model. Defaults to `claude-haiku-4-5-20251001`. Bump to Sonnet for higher quality. |
| `SENTENTIM_DB_PATH`           | Override DB output path (build) / DB read path (runtime).                                   |

## CI budget

The weekly run is sized to fit comfortably in a small Anthropic credit budget:
- CJEU volume runs ~1.5–2k items/year → ~30–40 items/week typical.
- SAOS-SN delta is currently *zero* (corpus is frozen).
- Each item ≈ ~2k input tokens + ~200 output tokens through Haiku.

Per-run cost is well under one US dollar.
