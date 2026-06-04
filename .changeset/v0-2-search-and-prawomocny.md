---
"sententim": minor
---

v0.2.0 — search_judgments MCP tool + prawomocny heuristic + cross-ref pass.

- New tool `search_judgments` exposes the FTS5 index over (sygnatura, sygnatura_norm, podstawa_prawna, sad) with diacritic-insensitive matching and Polish-aware stem prefix expansion.
- `prawomocny` heuristic: SA/SN/NSA/TK/TSUE → 1 by construction; SR/SO backfilled when an appellate `oddala` is found in the corpus that references them.
- Cross-reference pass parses `sygn. akt X` patterns from appellate textContent to wire `uchylony_przez` + `prawomocny` on the lower row.
- On the existing 1272-judgment corpus: 115 prawomocny attributions, 0 uchylony_przez (narrow domain expected behaviour).
