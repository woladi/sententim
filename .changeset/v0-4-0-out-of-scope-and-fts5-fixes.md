---
"sententim": minor
---

v0.4.0 — bug fixes z dry-run testu BNP-Paribas + nowy status `OUT_OF_SCOPE`.

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
