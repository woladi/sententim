# sententim

**The local-first case-law engine for the AI era.**
Ultra-fast (`<10 ms`), offline by default, MCP-native — built so your LLM can ground every Polish Supreme Court (SN) and EU Court of Justice (CJEU/TSUE) citation it makes, without paying €/month for a closed legal portal.

[![npm](https://img.shields.io/npm/v/sententim?style=flat-square&color=000000)](https://www.npmjs.com/package/sententim)
[![ci](https://img.shields.io/github/actions/workflow/status/woladi/sententim/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/woladi/sententim/actions/workflows/ci.yml)
[![weekly etl](https://img.shields.io/github/actions/workflow/status/woladi/sententim/etl-weekly.yml?branch=main&style=flat-square&label=weekly%20etl)](https://github.com/woladi/sententim/actions/workflows/etl-weekly.yml)
[![license](https://img.shields.io/github/license/woladi/sententim?style=flat-square)](LICENSE)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-1.x-black?style=flat-square)](https://modelcontextprotocol.io)

> **sententim** *(łac.)* — "z osądu", "z opinii". Stąd polskie **sentencja**.
> The opinion of the court, distilled — and indexed for your AI.

---

## Why sententim exists

Polish lawyers pay 6–7 zł a year for closed legal portals (Lex, Legalis). They are excellent products — and they were designed for a world in which a human lawyer reads judgments one at a time. That world is ending.

The new bottleneck is hallucination. Any LLM you point at Polish case-law will invent signatures, misquote ECLIs, and confidently cite *Sąd Najwyższy II CSK 999/22* that never existed. The fix is not a smarter model. The fix is **letting the model verify every citation locally, in microseconds, against a real, bundled corpus.**

That's the job sententim does.

- 🇵🇱 **Polish Supreme Court** (Sąd Najwyższy) — historical foundation via SAOS.
- 🇪🇺 **CJEU / TSUE** — refreshed weekly from CELLAR (Publications Office of the EU).
- 🧠 **AI-ready** — every ruling has a 2-sentence LLM-generated essence + normalised tags.
- ⚡ **Sub-10 ms lookups** — SQLite + FTS5, mmapped, prepared statements, zero network in runtime.
- 🔒 **100 % local** — your queries never leave your machine.
- 📦 **Zero infrastructure** — one `npm install` and the database ships with the package.

---

## Quick start

### Claude Code (CLI)

```bash
claude mcp add sententim -- npx sententim-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

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

Use stdio transport, command `npx sententim-mcp`. Done.

### Or just use it from your code

```ts
import { RulingsDb } from "sententim";

const db = new RulingsDb();
const result = db.verify("II CSK 311/22");
//  { exists: true, ruling: { … }, tookMs: 0.42 }
```

---

## The tools your LLM gets

| Tool                  | What it does                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **`verify_signature`** | Verify any SN/CJEU citation — returns the canonical record or up to 3 fuzzy alternatives. *Use this before citing.*                     |
| **`search_by_topic`**  | Full-text search on signatures, summaries, tags. Diacritic-insensitive (`odszkodowanie` ≡ `odszkodowanie`).                             |
| **`get_ruling`**       | Fetch a complete record by `id`, `ecli`, or `signature`.                                                                                |
| **`list_latest`**      | The N most recent rulings in either corpus — useful for staying current.                                                                |
| **`db_info`**          | Coverage stats: per-source counts and the latest judgment date. *Tell users honestly what you do and don't know.*                       |

Every tool returns structured JSON. Every tool is designed to be called *before* the model generates its answer — not after.

---

## Architecture

### Hybrid ETL pipeline

We split the data work between two environments that have different cost profiles:

```
                   ┌──────────────────────────────────────┐
                   │   Local (developer's machine)        │
   one-time   ──▶  │   • full SAOS dump (~38k SN)         │
   "cold seed"     │   • CELLAR back-fill (configurable)  │
                   │   • Claude Haiku batch summarisation │
                   │   • git commit  data/rulings.db      │
                   └──────────────────┬───────────────────┘
                                      │
                                      ▼
                   ┌──────────────────────────────────────┐
                   │   GitHub Actions · etl-weekly.yml    │
   every Mon  ──▶  │   • CELLAR ?date >= now-10d          │
   03:30 UTC       │   • SAOS sinceModificationDate       │
                   │   • Haiku summaries (small batch)    │
                   │   • opens PR with refreshed DB       │
                   └──────────────────┬───────────────────┘
                                      │ merge ↳
                                      ▼
                   ┌──────────────────────────────────────┐
                   │   release.yml → npm publish          │
                   │   (changesets, provenance enabled)   │
                   └──────────────────────────────────────┘
```

| Phase             | Where                | What                                                                       |
| ----------------- | -------------------- | -------------------------------------------------------------------------- |
| **Seed**          | Developer localhost  | Full historical dump. Heavy. Done once. Uses your local Anthropic API key. |
| **Weekly delta**  | GitHub Actions cron  | ~10-day overlap window. Small batch. Fits comfortably in a free-tier LLM budget. |
| **Release**       | GitHub Actions push  | `pnpm build` → `pnpm etl:verify` → `pnpm publish` with provenance.         |

### Runtime

```
                       ┌────────────────────────────────┐
   MCP client          │  sententim-mcp · stdio         │
   (Claude, Cursor) ──▶│   verify_signature             │
                       │   search_by_topic              │
                       │   get_ruling, list_latest      │
                       └────────────┬───────────────────┘
                                    │ better-sqlite3 (sync)
                                    ▼
                       ┌────────────────────────────────┐
                       │  data/rulings.db  (mmap 256MB) │
                       │   • rulings   (canonical)      │
                       │   • rulings_fts (FTS5,         │
                       │       unicode61,               │
                       │       remove_diacritics=2)     │
                       │   • manifest  (build metadata) │
                       └────────────────────────────────┘
```

The DB ships **inside the npm package**. No download on first run. No CDN. No outbound call. Polish diacritics are handled at the tokeniser level — search with or without marks, get the same hits.

---

## Data sources

| Source     | What we ingest                                                  | Notes                                                                                       |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **SAOS**   | Full Sąd Najwyższy corpus, ~38k judgments since 1917            | ⚠️ Upstream SAOS ingestion of SN is frozen at **2016-06-22**. Phase-2 sn.pl scraper planned. |
| **CELLAR** | CJEU judgments, orders, AG opinions — Polish text where available | SPARQL discovery + REST body fetch with `Accept-Language: pol` fallback to `eng`/`fra`.    |

Both sources are public-domain (Polish art. 4 ust. o prawie aut.; EU Decision 2011/833/EU). Reuse is free; attribution welcome.

---

## Schema (one row per ruling)

```ts
type Ruling = {
  id: string;            // sn-II_CSK_123_22 | cjeu-C_311_18
  source: "SN" | "CJEU";
  ecli: string | null;   // ECLI:EU:C:2020:559 (CJEU has these; SN often null)
  signature: string;     // "II CSK 311/22"
  court: string;         // "Sąd Najwyższy"
  chamber: string | null;// "Izba Cywilna"
  date: string;          // YYYY-MM-DD
  type: "wyrok" | "postanowienie" | "uchwała" | "judgment" | "order" | "opinion";
  summary: string;       // exactly 2 sentences, LLM-generated
  tags: string[];        // 3–10 normalised concepts ("art. 415 k.c.", "RODO")
  legalBasis: { act: string; article: string }[];
  sourceUrl: string;     // canonical upstream URL
};
```

Full text is **not** bundled — it would balloon the package without proportional value for a citation-grounding tool. The model uses summary + tags + signature, and links out to the source URL when the user wants to read.

---

## Developing

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Local seed (heavy — ~5–15 min for full SAOS SN dump)
ANTHROPIC_API_KEY=sk-ant-... pnpm etl:seed -- --since=2010-01-01 --max-cjeu=500

# Or piecemeal:
pnpm etl:saos
pnpm etl:cjeu
pnpm etl:summarize
pnpm etl:build-db
```

`pnpm dev` runs the server in watch mode. `pnpm sententim info` (after `pnpm build`) prints the manifest of the current DB.

### Project layout

```
sententim/
├── src/
│   ├── index.ts            · stdio MCP entry
│   ├── server.ts           · MCP server + tool routing
│   ├── db.ts               · RulingsDb (better-sqlite3 + FTS5)
│   ├── normalize.ts        · signature & diacritic helpers
│   ├── types.ts
│   ├── cli.ts              · `sententim` CLI for ad-hoc inspection
│   └── tools/              · one file per MCP tool
├── scripts/etl/
│   ├── sources/            · saos.ts · cjeu.ts
│   ├── normalize.ts        · raw → canonical
│   ├── summarize.ts        · LLM 2-sentence summaries
│   ├── build-db.ts         · staging JSONL → SQLite
│   ├── seed.ts             · local cold start
│   ├── incremental.ts      · CI weekly delta
│   └── verify.ts           · prepublish sanity gate
├── data/
│   ├── schema.sql          · SQLite + FTS5 DDL
│   ├── rulings.db          · published artefact
│   └── manifest.json       · published artefact
├── tests/                  · vitest
└── .github/workflows/
    ├── ci.yml
    ├── etl-weekly.yml      · Monday 03:30 UTC
    └── release.yml         · changesets → npm
```

---

## Roadmap

- **v0.1** — SN historical (SAOS) + CJEU weekly. *You are here.*
- **v0.2** — sn.pl scraper for SN post-2016.
- **v0.3** — NSA / WSA (CBOSA) administrative-court tier.
- **v0.4** — Citation graph (`cites_*` from CELLAR), so an LLM can walk the precedent chain.
- **v0.5** — Optional full-text companion package (`sententim-full`) with bodies for users who want them.
- **v1.0** — Stability, profiling, sub-5 ms p95 across a 100k-corpus.

---

## License

[MIT](LICENSE) © Adrian Wołczuk.
Data is reused under public-domain provisions: Polish *Ustawa o prawie autorskim* (art. 4) for SN, [Decision 2011/833/EU](https://eur-lex.europa.eu/eli/dec/2011/833/oj/eng) for CJEU.

Built as part of a [privacy-first AI ecosystem](https://github.com/woladi). If sententim saves you from hallucinating in court, send a postcard.
