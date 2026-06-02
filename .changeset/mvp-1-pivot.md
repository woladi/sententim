---
"sententim": minor
---

Pivot to MVP-1: deterministic `verify_signature` only.

- Single MCP tool with FOUND / NOT_FOUND / AMBIGUOUS contract
- Zero LLM in runtime; zero LLM-generated fields in schema
- Three regex parsers (sentencja_typ, podstawa_prawna, sąd→instancja) replace summarisation
- Schema reshaped to Polish field names with `UNIQUE(sygnatura_norm, sad, data_orzeczenia)`
- Seed narrowed to "sankcja kredytu darmowego" via SAOS union (~1300 judgments)
- Audit on every row: `sha256(textContent)` + `data_pobrania` + `zrodlo_url`
- CJEU/CELLAR code preserved but gated behind `SENTENTIM_ENABLE_CJEU=1`
- `@anthropic-ai/sdk` dependency dropped; `etl-weekly.yml` cron removed
