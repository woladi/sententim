# Changelog

## 0.2.2

### Patch Changes

- 1920de2: Docs polish + supply-chain bookkeeping.

  - LICENSE: strip the trailing "DATA REUSE NOTICE" so GitHub's Licensee
    gem correctly identifies the file as MIT. Move the notice to a
    standalone NOTICE file alongside (covers data sources + transitive
    licences). Fixes the "license not identifiable" badge on the repo.
  - README: refresh badges (npm version, types, license-via-npm, node,
    CI, Sigstore provenance, MCP); drop the stale "v0.2 search_judgments
    is coming" note; document both tools in the headline; re-cast the
    "from code" example against the actual public exports.
  - `src/index.ts`: re-export `runVerifySignature`, `runSearchJudgments`,
    their zod schemas, MCP tool definitions, `DISCLAIMER`, and the
    signature normalisation helpers so the README example actually
    compiles when run by a consumer of the npm package.
  - CHANGELOG: switch to the Changesets-native one-section-per-version
    layout so future automated bumps don't shred the file.
  - Layout / dev-section housekeeping (66 tests, 0.2 file tree,
    cross-ref + search-judgments paths).

All notable changes to this project will be documented here. Format follows the format produced by [Changesets](https://github.com/changesets/changesets), which lays each released version on its own `## X.Y.Z` heading. Versions track [SemVer](https://semver.org/spec/v2.0.0.html).

## 0.2.1

### Patch Changes

- 8d1479c: Switch the release pipeline to **npm Trusted Publishing (OIDC)**.

  - `release.yml` no longer references `NPM_TOKEN`. The npm CLI exchanges
    the GitHub-issued OIDC token for a short-lived publish token at the
    moment of `npm publish`, scoped to this package + version.
  - Sigstore SLSA-v1 provenance is attached automatically — every release
    tarball is verifiably built from the commit it claims to be built from,
    and the attestation surfaces on the npm package page.
  - Align `pnpm/action-setup` with the local lockfile version (9 → 11) in
    both `release.yml` and `ci.yml`. Bump CI Node to 22 (pnpm 11.5 requires
    Node ≥ 22.13). Add `--config.dangerouslyAllowAllBuilds=true` so pnpm 11
    compiles `better-sqlite3`'s native binding in CI.

  No runtime change. Drop-in supply-chain upgrade: fewer long-lived
  secrets to rotate, cryptographic provenance on every published version.

## 0.2.0

### Minor Changes

- **`search_judgments` MCP tool** — FTS5-backed search over `(sygnatura, sygnatura_norm, podstawa_prawna, sad)` with diacritic-insensitive `unicode61 remove_diacritics=2` tokenizer.
- **Polish-aware stem prefix matching** — tokens ≥5 chars ending in a Polish nominative vowel are trimmed before the `*` prefix so `Warszawa` finds `Warszawie`, `apelacyjny` finds `apelacyjna`, etc.
- **`prawomocny` heuristic** — courts of last resort (SA, SN, NSA, TK, TSUE) are marked `prawomocny=1` deterministically at projection time (96 records in current corpus).
- **Cross-reference pass** in `normalize.ts` — extracts `sygn. akt X` signatures from appellate textContent; back-fills `prawomocny=1` for lower-court rows whose appeal was `oddalono` and `uchylony_przez=<sygnatura>` + `prawomocny=0` when appellate `uchyla_przekazuje`. On v0.2 corpus: +19 prawomocny attributions, 0 uchylony_przez (narrow domain, see README limits).
- `src/server.ts` registers two tools: `verify_signature` + `search_judgments`.
- `scripts/etl/parsers/cross-ref.ts` + golden tests. 13 new tests (cross-ref × 7, search-judgments × 6); 66/66 green.

## 0.1.0

### Minor Changes

Pivot — MVP-1 scope. The initial scaffold positioned sententim as a five-tool AI-grounding ecosystem for SN + CJEU with LLM-generated summaries. This pivot strips it down to a single deterministic tool with no LLM in the pipeline, on a narrower-but-precise corpus.

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
- `etl-weekly.yml` cron (MVP-1 is one-shot seed; weekly cron returns later).
- `incremental.ts` ETL entry point.

### Gated (kept in tree, disabled)

- CJEU/CELLAR ingestion (`scripts/etl/sources/cjeu.ts`). Enable with `SENTENTIM_ENABLE_CJEU=1` for raw fetch; full schema integration deferred to v0.5.

### Fixed (first end-to-end smoke run)

- `displaySignature` dot-strip regex was leaving a trailing `.` when an abbreviation ended at whitespace (`II c.s.k. 822/22` → `II CSK. 822/22`). Extended the lookahead.
- `better-sqlite3` transactions cannot return promises; `build-db.ts` now collects the streamed rows into an array before running the INSERT batch synchronously.
- SAOS `/api/judgments/{id}` wraps the response in `{links, data}`; `fetchSingle()` now unwraps and `normalize.ts` tolerates either shape for already-saved JSONL.

### Known limitations on the v0.1 corpus

- SN coverage via SAOS ends 2016-06-22 (upstream freeze). COMMON courts are current.
- `prawomocny` and `uchylony_przez` were NULL throughout (resolved in v0.2 via the cross-ref pass).
- ~30-40% of records have NULL `sentencja_typ` when the 5 regex rules don't match.
- `pnpm install` may warn about ignored native builds; one-time fix documented in README.
