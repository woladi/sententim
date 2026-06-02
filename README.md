# sententim

**Deterministyczny weryfikator sygnatur polskich wyroków. Zero LLM w runtime. Zero halucynacji.**

Sprawdzasz: czy ten wyrok istnieje?
Otrzymujesz: `FOUND` / `NOT_FOUND` / `AMBIGUOUS` — z twardymi faktami ze źródła.

[![npm](https://img.shields.io/npm/v/sententim?style=flat-square&color=000000)](https://www.npmjs.com/package/sententim)
[![ci](https://img.shields.io/github/actions/workflow/status/woladi/sententim/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/woladi/sententim/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/woladi/sententim?style=flat-square)](LICENSE)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-1.x-black?style=flat-square)](https://modelcontextprotocol.io)

---

## Po co to istnieje

LLM-y, które piszą o polskim prawie, **konfabulują sygnatury**. *„Sąd Najwyższy, II CSK 999/22 — orzekł, że…"* — sygnatura nie istnieje, sąd nigdy się nie wypowiedział, model brzmi pewnie.

Sententim rozwiązuje **dokładnie ten jeden problem**:

> Zanim zacytujesz sygnaturę — sprawdź, czy ona naprawdę istnieje. Lokalnie. W mikrosekundach. Bez wysyłania niczego do chmury.

Reguła naczelna: **jeśli czegoś nie ma w bazie → `NOT_FOUND`. Nigdy nie zgaduj.**

## Czym to NIE jest

- ❌ Nie jest wyszukiwarką semantyczną (FTS5 jest, ale narzędzie `search_judgments` przyjdzie w v0.2 — i też deterministycznie)
- ❌ Nie generuje streszczeń, omówień ani interpretacji
- ❌ Nie jest alternatywą dla Lex / Legalis — to jedno małe, precyzyjne narzędzie do jednej rzeczy
- ❌ Nie korzysta z LLM w runtime — w paczce nie ma ani jednego API-call do chmury

## Co jest w paczce (MVP-1)

| Pole | Wartość |
|---|---|
| **Domena prawna** | Sankcja kredytu darmowego (art. 45 ukk + art. 75c pr.bank) |
| **Źródło** | SAOS · System Analizy Orzeczeń Sądowych (publiczne, otwarte dane) |
| **Korpus** | ~1300 wyroków SR / SO / SA / SN dotykających tej tematyki |
| **Tooling** | Jedno narzędzie MCP: `verify_signature` |
| **Audyt** | Każdy rekord: `zrodlo_url` + `data_pobrania` + `sha256(textContent)` |

## Quick start

### Claude Code

```bash
claude mcp add sententim -- npx sententim-mcp
```

### Claude Desktop

W `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sententim": {
      "command": "npx",
      "args": ["sententim-mcp"]
    }
  }
}
```

### Cursor / Continue / any MCP client

Transport: stdio, komenda: `npx sententim-mcp`.

### Z poziomu kodu

```ts
import { JudgmentsDb } from "sententim";
import { runVerifySignature } from "sententim/dist/tools/verify-signature.js";

const db = new JudgmentsDb();
const r = runVerifySignature(db, { sygnatura: "II CSK 750/15" });
// {
//   status: "FOUND",
//   matches: [{ sygnatura, sad, instancja, data_orzeczenia,
//                sentencja_typ, podstawa_prawna, zrodlo_url, ... }],
//   disclaimer: "Dane deterministyczne ze źródła publicznego. ..."
// }
```

## Kontrakt narzędzia MCP

**Tool**: `verify_signature`

```ts
input: {
  sygnatura: string;           // np. "II CSK 750/15"
  sad?:      string;           // zawęża po substringu nazwy sądu
  data?:     string;           // zawęża po dokładnej dacie ISO YYYY-MM-DD
}

output: {
  status:  "FOUND" | "NOT_FOUND" | "AMBIGUOUS",
  matches: Array<{
    sygnatura, sad, instancja,
    data_orzeczenia, sentencja_typ,
    prawomocny, uchylony_przez,
    podstawa_prawna, zrodlo_url, data_pobrania
  }>,
  disclaimer: "Dane deterministyczne ze źródła publicznego. Zweryfikuj treść w źródle. Nie stanowi porady prawnej."
}
```

| status | znaczenie | matches |
|---|---|---|
| `FOUND` | dokładnie jedno trafienie | `[{...}]` |
| `NOT_FOUND` | zero trafień — **nie cytuj tej sygnatury** | `[]` |
| `AMBIGUOUS` | ta sama sygnatura w ≥2 sądach — zwracamy wszystkich kandydatów, **bez wybierania** | `[{...}, {...}, …]` |

## Schemat danych

```ts
type Judgment = {
  sygnatura:       string;                    // "II CSK 750/15"
  sygnatura_norm:  string;                    // matchowanie: upper-case, bez kropek, ASCII
  sad:             string;                    // "Sąd Rejonowy w Olsztynie"
  instancja:       "SR"|"SO"|"SA"|"SN"|"NSA"|"WSA"|"TK"|"TSUE";
  data_orzeczenia: string;                    // ISO YYYY-MM-DD
  sentencja_typ:   "oddala"|"uwzglednia"|"uchyla_przekazuje"|"zmienia"|"umarza"|"inne"|null;
  prawomocny:      0|1|null;                  // NULL w MVP-1 (v0.2: cross-ref pass)
  uchylony_przez:  string|null;               // NULL w MVP-1
  podstawa_prawna: string[];                  // ["art. 45 ukk", "art. 75c pr.bank"]
  zrodlo_url:      string;
  data_pobrania:   string;                    // ISO timestamp
  sha256:          string;                    // hash surowego textContent (audyt)
};
```

Każde pole pochodzi z deterministycznej ekstrakcji — pełna lista parserów: `scripts/etl/parsers/`.

## Architektura

```
                                         (one-shot, ~15-20 min, lokalnie u devy)
    SAOS REST API ──── seed.ts ─────┐
                                    │
                                    ▼
                            data/judgments.db                ← (commited do repo,
                            (~1300 wierszy, FTS5)              shipowane w paczce npm)
                                    │
                                    │ better-sqlite3 (sync, PRAGMA query_only=1)
                                    ▼
                            sententim-mcp · stdio            ← runtime: 0 LLM, 0 sieci
                                    │
                                    ▼
                            verify_signature
                                    │
                                    ▼
                            FOUND | NOT_FOUND | AMBIGUOUS
```

| Komponent | Stack |
|---|---|
| Schema | SQLite + FTS5 (`tokenize="unicode61 remove_diacritics 2"`) |
| Runtime | better-sqlite3 (sync), prepared statements, PRAGMA query_only=1 |
| MCP | @modelcontextprotocol/sdk 1.x, stdio transport |
| ETL | TypeScript pure-fn — zero LLM, zero zewnętrznych API poza SAOS |

## Limity i znane luki

- **`prawomocny` zawsze NULL w MVP-1** — nie można ustalić bez cross-refa z apelacją. Roadmap v0.2.
- **`uchylony_przez` zawsze NULL w MVP-1** — analogicznie.
- **`sentencja_typ` `NULL` jeśli żaden z 5 regexów nie trafia** — świadomie zamiast zgadywać `'inne'`. W praktyce ~20-30% wyroków ma `NULL` (najczęściej compound rulings które wymagają mocniejszej heurystyki).
- **CJEU / TSUE wyłączone** — kod istnieje pod flagą `SENTENTIM_ENABLE_CJEU=1`, ale integracja z nowym deterministycznym schematem wymaga przeprojektowania (roadmap v0.5).
- **Daty filtrowane** do zakresu `1990-01-01 ... dzisiaj+1d` (literówki w źródle typu „3013-…" są odrzucane).

## Roadmap

- **v0.1** — `verify_signature`, sankcja kredytu darmowego, SAOS. *Tu jesteś.*
- **v0.2** — `search_judgments` (FTS5 po sygnaturze + podstawie prawnej), cross-ref pass dla `prawomocny`/`uchylony_przez`.
- **v0.3** — Druga domena prawna (rozszerzenie korpusu seedu).
- **v0.4** — Scraper sn.pl dla SN post-2016 (SAOS-owy SN zamrożony na 2016-06-22).
- **v0.5** — Aktywacja CJEU/TSUE (osobny schema-extension dla ECLI + procedural lang).

Streszczenia LLM — **tylko z human-in-the-loop i flagą provenance**, **nigdy** w default-path.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test

pnpm etl:seed             # ~15-20 min, lokalnie, produkuje data/judgments.db
pnpm etl:seed --max=50    # smoke
pnpm etl:verify           # pre-publish gate
pnpm build
```

Layout:

```
sententim/
├── src/
│   ├── index.ts                · stdio MCP entry
│   ├── server.ts               · jeden tool zarejestrowany
│   ├── db.ts                   · JudgmentsDb (PRAGMA query_only=1)
│   ├── normalize.ts            · displaySignature + normaliseSignature
│   ├── types.ts                · Judgment, VerifyResult, Manifest
│   ├── cli.ts                  · `sententim info` / `sententim verify`
│   └── tools/verify-signature.ts
├── scripts/etl/
│   ├── parsers/
│   │   ├── sentencja-typ.ts    · regex outcome classifier
│   │   ├── podstawa-prawna.ts  · regex legal-basis extractor
│   │   └── sad-instancja.ts    · court → SR/SO/SA/SN/...
│   ├── sources/
│   │   ├── saos.ts             · SAOS REST API client
│   │   └── cjeu.ts             · gated SENTENTIM_ENABLE_CJEU (deferred)
│   ├── normalize.ts            · raw SAOS → canonical
│   ├── build-db.ts             · staged JSONL → SQLite + manifest
│   ├── seed.ts                 · unia 2 queries SAOS
│   └── verify.ts               · prepublish gate
├── data/
│   ├── schema.sql              · DDL (commit)
│   ├── judgments.db            · published artefact
│   └── manifest.json           · published artefact
├── tests/
│   ├── normalize.test.ts
│   ├── parsers.test.ts
│   ├── db.test.ts
│   └── verify-contract.test.ts
└── .github/workflows/
    ├── ci.yml
    └── release.yml             · changesets → npm
```

## License

[MIT](LICENSE) © Adrian Wołczuk.
Dane SAOS wykorzystywane na podstawie art. 4 ustawy o prawie autorskim (orzeczenia organów państwowych poza zakresem ochrony).
