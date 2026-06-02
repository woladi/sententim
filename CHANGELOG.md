# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions track [SemVer](https://semver.org/spec/v2.0.0.html). Releases are cut by [changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Pivot — MVP-1 scope

The initial scaffold positioned sententim as a five-tool AI-grounding ecosystem for SN + CJEU with LLM-generated summaries. This pivot strips it down to a single deterministic tool with no LLM in the pipeline, on a narrower-but-precise corpus.

### Added
- `verify_signature` MCP tool with the FOUND / NOT_FOUND / AMBIGUOUS contract.
- Three deterministic parsers (`sentencja-typ`, `podstawa-prawna`, `sad-instancja`) replacing LLM summarisation.
- Audit fields: `sha256(textContent)`, `data_pobrania`, `zrodlo_url` on every record.
- Acceptance tests for the four programmatic MVP-1 criteria (`tests/verify-contract.test.ts`).
- `PRAGMA query_only=1` enforced at runtime — write-path is provably impossible.

### Changed
- Schema reshaped 1:1 to user MVP-1 spec (Polish field names, `instancja` enum, `UNIQUE(sygnatura_norm, sad, data_orzeczenia)`).
- `data/rulings.db` → `data/judgments.db` to match the new domain language.
- Seed corpus narrowed to "sankcja kredytu darmowego" — union of SAOS `legalBase=art. 45 ustawy o kredycie konsumenckim` and `all=sankcja kredytu darmowego`, deduped by SAOS id (~1300 unique).
- README repositioned around "deterministic verifier, zero LLM" — Lex/Legalis pitch moved to roadmap.

### Removed
- `search_by_topic`, `get_ruling`, `list_latest`, `db_info` tools (deferred / partially reincarnated as v0.2 `search_judgments`).
- LLM summarisation step + `@anthropic-ai/sdk` dependency.
- `etl-weekly.yml` cron (MVP-1 is one-shot seed; weekly cron returns in v0.2).
- `incremental.ts` ETL entry point.

### Gated (kept in tree, disabled)
- CJEU/CELLAR ingestion (`scripts/etl/sources/cjeu.ts`). Enable with `SENTENTIM_ENABLE_CJEU=1` for raw fetch; full schema integration deferred to v0.5.

### Known limitations
- SN coverage via SAOS ends 2016-06-22 (upstream freeze). COMMON courts are current.
- `prawomocny` and `uchylony_przez` are NULL in MVP-1 — they require a cross-ref pass (v0.2).
- ~20-30% of records have NULL `sentencja_typ` when the 5 regex rules don't match (compound rulings).
