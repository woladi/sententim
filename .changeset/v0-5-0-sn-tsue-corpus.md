---
"sententim": minor
---

v0.5.0 — Korpus rozszerzony o SN (SAOS) i TSUE (curated CELLAR list).

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
  **C-677/23**.  Pogrubione = autorytety wymienione w raporcie BNP-Paribas
  dry-runa jako kluczowe dla sankcji KD.
- Hand-curated zamiast SPARQL po consumer-credit Directive 2008/48: CELLAR
  predicate `cdm:work_cites_work` wraca 0 dla "judgments citing Dir 2008/48",
  a EUR-Lex SOAP wymaga rejestracji.  Roadmap v0.6 przeniesie to na SPARQL
  + EUROVOC concept code, gdy zweryfikujemy mapowanie.

**Schema migration**
- Nowa opcjonalna kolumna `judgments.ecli TEXT` — TSUE używa zawsze, SN
  często, COMMON rzadko.  `INSERT` rozszerzony, `Manifest` / `Judgment` /
  `JudgmentMatch` interface'y zawierają teraz `ecli: string | null`.
- Index `idx_ecli` (partial: `WHERE ecli IS NOT NULL`).
- Stare DB (v0.4.x bez `ecli`) graceful upgrade dzięki SQLite `CREATE TABLE
  IF NOT EXISTS` + nullable column.

**Pipeline rewrite**
- `scripts/etl/sources/cjeu.ts` przepisany.  Zniknęło `cjeuEnabled()`
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
  - od v0.5: `verify("IV CSKP 95/21")` → `NOT_FOUND`  (SN pokryty,
    więc to halucynacja, nie spoza zakresu)
  - przed v0.5: `verify("C-487/21")` → `OUT_OF_SCOPE, likely=TSUE`
  - od v0.5: `verify("C-487/21")` → `FOUND` z ECLI:EU:C:2021:0487
- NSA / TK / WSA wciąż **poza** korpusem → `OUT_OF_SCOPE` z `likely_instancja`.
- Klient widzący `NOT_FOUND` w v0.5 ma silniejszy sygnał "halucynacja"
  niż w v0.4, bo bardziej kompletny korpus = mniejsza szansa false-negative.
