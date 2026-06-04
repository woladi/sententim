# Changelog

## 0.2.1

### Patch Changes

- 8d1479c: Switch the release pipeline to **npm Trusted Publishing (OIDC)**.

  - `release.yml` no longer references `NPM_TOKEN`. The npm CLI exchanges
    the GitHub-issued OIDC token for a short-lived publish token at the
    moment of `npm publish`, scoped to this package + version.
  - Sigstore provenance is attached automatically — every release tarball
    is verifiably built from the commit it claims to be built from, and
    the attestation surfaces on the npm package page.
  - Align `pnpm/action-setup` with the local lockfile version (9 → 11) in
    both `release.yml` and `ci.yml`. Add `--config.dangerouslyAllowAllBuilds=true`
    so pnpm 11 compiles `better-sqlite3`'s native binding in CI.

  No runtime change. Drop-in upgrade in the supply-chain story:
  fewer long-lived secrets to rotate, cryptographic provenance on every
  published version.

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions track [SemVer](https://semver.org/spec/v2.0.0.html). Releases are cut by [changesets](https://github.com/changesets/changesets).

## [Unreleased]

## [0.2.0]

### Added

- **`search_judgments` MCP tool** — FTS5-backed search over `(sygnatura, sygnatura_norm, podstawa_prawna, sad)` with diacritic-insensitive `unicode61 remove_diacritics=2` tokenizer.
- **Polish-aware stem prefix matching** — tokens ≥5 chars ending in a Polish nominative vowel are trimmed before the `*` prefix so `Warszawa` finds `Warszawie`, `apelacyjny` finds `apelacyjna`, etc.
- **`prawomocny` heuristic** — courts of last resort (SA, SN, NSA, TK, TSUE) are marked `prawomocny=1` deterministically at projection time (96 records in current corpus).
- **Cross-reference pass** in `normalize.ts` — extracts `sygn. akt X` signatures from appellate textContent; back-fills `prawomocny=1` for lower-court rows whose appeal was `oddalono` and `uchylony_przez=<sygnatura>` + `prawomocny=0` when appellate `uchyla_przekazuje`. On v0.2 corpus: +19 prawomocny attributions, 0 uchylony_przez (narrow domain, see README limits).
- `scripts/etl/parsers/cross-ref.ts` + golden tests.
- 7 new cross-ref tests, 6 new search-judgments tests (66 total, all green).

### Changed

- `package.json` version 0.1.0 → 0.2.0.
- `src/server.ts` registers two tools: `verify_signature` + `search_judgments`.

## [0.1.0]

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

### Fixed (first end-to-end smoke run)

- `displaySignature` dot-strip regex was leaving a trailing `.` when an abbreviation ended at whitespace (`II c.s.k. 822/22` → `II CSK. 822/22`). Extended the lookahead.
- `better-sqlite3` transactions cannot return promises; `build-db.ts` now collects the streamed rows into an array before running the INSERT batch synchronously.
- SAOS `/api/judgments/{id}` wraps the response in `{links, data}`; `fetchSingle()` now unwraps and `normalize.ts` tolerates either shape for already-saved JSONL.

### Known limitations

- SN coverage via SAOS ends 2016-06-22 (upstream freeze). COMMON courts are current.
- `prawomocny` and `uchylony_przez` are NULL in MVP-1 — they require a cross-ref pass (v0.2).
- ~30-40% of records have NULL `sentencja_typ` when the 5 regex rules don't match (observed on real COMMON corpus — slightly higher than the initial ~20-30% estimate; bumping our heuristic depth is roadmap v0.2).
- `pnpm install` may warn about ignored native builds; one-time fix documented in README.
