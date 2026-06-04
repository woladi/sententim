# Changelog

## 0.5.0

### Minor Changes

- 24345ff: v0.5.0 — Korpus rozszerzony o SN (SAOS) i TSUE (curated CELLAR list).

  **Source expansion**

  - SAOS SUPREME (= Sąd Najwyższy) queries dodane do `seed.ts`:
    - `all="kredyt konsumencki"` (~44 hits)
    - `all="klauzule abuzywne"` (~19 hits)
    - SN w SAOS jest upstream-frozen na **2016-06-22**, więc to historyczny snapshot. v0.6 dodaje scraper sn.pl dla post-2016.
  - TSUE via CELLAR REST `Accept-Language: pol` — handpicked lista 15 CELEX-ów
    obejmujących kanoniczne autorytety dla domeny:
    C-415/11 (Aziz), C-26/13 (Kásler), C-449/13, C-186/16 (Andriciuc),
    C-118/17 (Dunai), C-176/17 (Profi Credit), C-260/18 (Dziubak), C-19/20,
    C-269/19, C-705/20, C-180/21, **C-487/21**, C-520/21, **C-714/22**,
    **C-677/23**. Pogrubione = autorytety wymienione w raporcie BNP-Paribas
    dry-runa jako kluczowe dla sankcji KD.
  - Hand-curated zamiast SPARQL po consumer-credit Directive 2008/48: CELLAR
    predicate `cdm:work_cites_work` wraca 0 dla "judgments citing Dir 2008/48",
    a EUR-Lex SOAP wymaga rejestracji. Roadmap v0.6 przeniesie to na SPARQL
    - EUROVOC concept code, gdy zweryfikujemy mapowanie.

  **Schema migration**

  - Nowa opcjonalna kolumna `judgments.ecli TEXT` — TSUE używa zawsze, SN
    często, COMMON rzadko. `INSERT` rozszerzony, `Manifest` / `Judgment` /
    `JudgmentMatch` interface'y zawierają teraz `ecli: string | null`.
  - Index `idx_ecli` (partial: `WHERE ecli IS NOT NULL`).
  - Stare DB (v0.4.x bez `ecli`) graceful upgrade dzięki SQLite `CREATE TABLE
IF NOT EXISTS` + nullable column.

  **Pipeline rewrite**

  - `scripts/etl/sources/cjeu.ts` przepisany. Zniknęło `cjeuEnabled()`
    feature flag — TSUE jest teraz częścią default seedu (`SENTENTIM_ENABLE_CJEU=0`
    albo `--no-tsue` żeby pominąć).
  - Nowa `normaliseAll({ saosInputs, cjeuInputs })` w `scripts/etl/normalize.ts`
    scala oba źródła w jednym przebiegu + uruchamia cross-ref pass tylko
    nad SAOS częścią (TSUE są top-level, nie cytują polskich SR/SO).
  - `projectCjeu()` projektuje CELLAR rekord na canonical schema:
    - `sygnatura` = `case_number` (C-XXX/YY decoded from CELEX)
    - `sad` = "Trybunał Sprawiedliwości Unii Europejskiej" (lub "Sąd UE"
      dla T-…)
    - `instancja` = "TSUE"
    - `prawomocny` = 1 (court of last resort)
    - `ecli` = z CELEX (`celexToEcli` helper)
    - `data_orzeczenia` = `YYYY-01-01` (CELEX year stamp; real date wymaga
      parsowania HTML body — roadmap v0.6)
  - Nowe utility `celexToCaseNumber`, `celexToEcli` w `sources/cjeu.ts`.

  **Corpus stats (v0.5)**

  - 1348 judgments total (z 1272 w v0.4.0).
  - Distribution: **SO 721 · SR 459 · SA 96 · SN 57 · TSUE 15**.
  - `corpus_scope` w manifest = `["SR","SO","SA","SN","TSUE"]`.
  - 188 prawomocnych (169 by-instance, +19 by-cross-ref — +57 SN + +15 TSUE
    bumpa by-instance z 96 do 169).
  - 4 `uchylony_przez` (były 0 — szerszy korpus daje więcej powołań).
  - DB size: 1.23 MB (z 1.17 MB — TSUE i SN dorzucają niewiele bo ich
    textContent nie trafia do bazy, tylko sha256).

  **Impact na N2 OUT_OF_SCOPE**

  - SN i TSUE są teraz w `corpus_scope`, więc heurystyka N2 inaczej
    klasyfikuje halucynacje:
    - przed v0.5: `verify("IV CSKP 95/21")` → `OUT_OF_SCOPE, likely=SN`
    - od v0.5: `verify("IV CSKP 95/21")` → `NOT_FOUND` (SN pokryty,
      więc to halucynacja, nie spoza zakresu)
    - przed v0.5: `verify("C-487/21")` → `OUT_OF_SCOPE, likely=TSUE`
    - od v0.5: `verify("C-487/21")` → `FOUND` z ECLI:EU:C:2021:0487
  - NSA / TK / WSA wciąż **poza** korpusem → `OUT_OF_SCOPE` z `likely_instancja`.
  - Klient widzący `NOT_FOUND` w v0.5 ma silniejszy sygnał "halucynacja"
    niż w v0.4, bo bardziej kompletny korpus = mniejsza szansa false-negative.

## 0.4.0

### Minor Changes

- 56f2021: v0.4.0 — bug fixes z dry-run testu BNP-Paribas + nowy status `OUT_OF_SCOPE`.

  **B1 fix** (FTS5 sanitiser):

  - Sanityzer odrzuca teraz tokeny `AND`/`OR`/`NOT`/`NEAR` (FTS5 reserved
    keywords) z input query — wcześniej `OR` po `expandToken` stawało się
    `OR*` i FTS5 wybuchał z `-32603`. `search("art* OR")` więcej nie crashuje.
  - Wrap `JudgmentsDb.search()` w try/catch — każdy przyszły malformed
    query daje `total_returned: 0` zamiast podnoszenia exception do MCP.

  **B2 fix** (rok normalizacja w sygnaturze):

  - `displaySignature` zwija końcowy 4-cyfrowy rok (`19XX`/`20XX`) do
    2-cyfrowego. `I1 C 1535/2023` jest teraz dopasowywane do `I1 C 1535/23`
    w bazie. Eliminuje false-negatyw na prawdziwej sygnaturze podanej
    w długiej formie (najgroźniejszy bug — kasowanie poprawnego cytatu).

  **B3 fix** (filtr `sad` stem-aware):

  - `findCandidates` strippuje końcową polską samogłoskę z `sad` przed
    użyciem w `LIKE '%...%'`. `sad="Gdynia"` (mianownik) matchuje teraz
    "Sąd Rejonowy w Gdyni" (miejscownik). Wyciągnięto `stemPolishWord` /
    `stemPolishPhrase` do `src/normalize.ts` jako współdzielony helper —
    używa go zarówno FTS5 `expandToken` jak i filtr `sad`.

  **N1 doc** (opis search_judgments):

  - Opis toolu mówi teraz wprost, że NIE indeksuje treści orzeczenia ani
    słów tematycznych — zapytania typu "kredyt", "RODO" znajdą trafienia
    TYLKO gdy słowo występuje w sygnaturze, nazwie sądu lub liście podstaw
    prawnych. Dodano też notkę o polu `corpus_scope` w odpowiedzi.

  **N2 contract** (BREAKING change w `VerifyStatus` enum):

  - Nowy status `OUT_OF_SCOPE` w `verify_signature`. Heurystyka
    `detectLikelyInstancja` (regex-pattern matcher) rozpoznaje wzorce
    SN / TSUE / NSA / TK; gdy sygnatura matchuje wzorzec, a ta instancja
    nie jest w `corpus_scope` → status `OUT_OF_SCOPE` zamiast `NOT_FOUND`,
    z polem `likely_instancja`. LLM widzi explicite: "to nie jest
    halucynacja, to po prostu spoza naszego korpusu".
  - Pole `corpus_scope: Instancja[]` w każdej odpowiedzi obu toolu
    (verify_signature + search_judgments) — czytane z manifestu DB, który
    build-db.ts liczy z distinct `instancja` w bazie. LLM widzi explicite,
    jaki zakres baza pokrywa.

  **Inne**:

  - `Manifest` interface rozszerzony o `corpus_scope: Instancja[]`.
    Stare bazy (v0.3.x) bez tego klucza dostają default
    `["SR","SO","SA"]` przez `parseCorpusScope` fallback.
  - `runVerifySignature` / `runSearchJudgments` reużywają `db.manifest()`
    (cache'owany przez `JudgmentsDb`).
  - Public API rozszerzone: re-exporty `detectLikelyInstancja`,
    `stemPolishWord`, `stemPolishPhrase` przez `sententim` package.
  - 45 nowych testów (B1 ×5, B2 ×6 displaySignature + 2 signaturesMatch,
    B3 ×2, instancja-pattern ×21, stem ×6, corpus_scope ×2, OUT_OF_SCOPE
    scenariusze ×7). Łącznie 111/111 zielone.

  **Migracja klienta**: kod który switch'uje `status === "NOT_FOUND"`
  strict-checkiem może potrzebować dorzucenia gałęzi `OUT_OF_SCOPE`.
  Reguła: `NOT_FOUND` = "nie wierz", `OUT_OF_SCOPE` = "nie potrafimy
  potwierdzić ani zaprzeczyć — sprawdź w źródle". Pozostałe statusy
  (FOUND, AMBIGUOUS) bez zmian. `matches`, `disclaimer` bez zmian.

## 0.3.0

### Minor Changes

- 2eafb16: `sententim` binary now auto-detects MCP mode — fixes the npx invocation gap.

  Before, the Quick Start in the README told users to run
  `claude mcp add sententim -- npx sententim-mcp`. That fails with HTTP 404 because
  `npx <X>` resolves `<X>` as a **package name** in the npm registry, and there is
  no package called `sententim-mcp` — only a binary alias inside the `sententim`
  package. The workaround used to be `npx -y -p sententim sententim-mcp`, which is
  ugly and undocumented in every other "use this MCP server" tutorial users
  encounter.

  The fix is to make the canonical binary smart:

  - `sententim` (stdin is a pipe — typical when launched by an MCP client) →
    start the stdio JSON-RPC server.
  - `sententim` (stdin is a TTY — interactive shell) → print help.
  - `sententim mcp` → force MCP mode regardless of TTY (handy for testing).
  - `sententim info`, `sententim verify <sygnatura>` → CLI as before.

  Now `npx -y sententim` Just Works™ as an MCP entry, matching the convention of
  every other published MCP server package.

  Other changes shipped here:

  - `serverInfo.version` returned by the MCP `initialize` response is now read
    dynamically from `package.json` at module load instead of being hard-coded
    (no more "0.2.0" leaking out of a 0.3.x build).
  - The legacy `sententim-mcp` binary still points at `dist/index.js` and behaves
    exactly as before — kept for any consumer who pinned the old name.
  - README quick-start sections rewritten to use `npx -y sententim`, with a
    short note explaining the npx-package-vs-binary gotcha for future readers.

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
