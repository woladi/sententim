# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions track [SemVer](https://semver.org/spec/v2.0.0.html). Releases are cut by [changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Added
- Initial scaffolding: TypeScript + ESM + Node 20 baseline.
- SQLite + FTS5 schema with Polish-aware `unicode61` tokenizer (`remove_diacritics=2`).
- MCP server with five tools: `verify_signature`, `search_by_topic`, `get_ruling`, `list_latest`, `db_info`.
- SAOS ingestion for Sąd Najwyższy (full search-endpoint paginator, ~38k historical judgments).
- CELLAR ingestion for CJEU (SPARQL discovery + REST `Accept-Language: pol` body fetch).
- LLM-powered 2-sentence summarisation via Anthropic Claude Haiku.
- GitHub Actions: `ci.yml`, `etl-weekly.yml` (Monday 03:30 UTC), `release.yml` (changesets + npm provenance).
- `sententim` CLI for ad-hoc inspection (`info`, `verify`, `search`, `latest`).

### Known limitations
- SN coverage ends 2016-06-22 (upstream SAOS freeze). Phase-2 sn.pl scraper planned.
- CJEU Polish text may be missing for newest AG opinions — falls back to `eng`/`fra`.
