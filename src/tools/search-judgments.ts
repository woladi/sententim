import { z } from "zod";
import type { JudgmentsDb } from "../db.js";
import type { Judgment, JudgmentMatch } from "../types.js";
import { DISCLAIMER } from "./verify-signature.js";

export const searchJudgmentsSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe(
      "Zapytanie pełnotekstowe (FTS5). Działa po sygnaturze, nazwie sądu i podstawie prawnej. Akcento-niewrażliwe — `odszkodowanie` ≡ `odszkodowanie`. Wiele słów: implicit AND.",
    ),
  instancja: z
    .enum(["SR", "SO", "SA", "SN", "NSA", "WSA", "TK", "TSUE"])
    .optional()
    .describe("Opcjonalnie zawęża do jednej instancji."),
  limit: z.number().int().min(1).max(50).default(10).describe("Max trafień (1-50)."),
});

export type SearchJudgmentsInput = z.input<typeof searchJudgmentsSchema>;

export const searchJudgmentsTool = {
  name: "search_judgments",
  title: "Wyszukaj wyroki",
  description: [
    "Wyszukuje wyroki polskich sądów po sygnaturze, nazwie sądu lub podstawie prawnej (FTS5).",
    "Zwraca posortowane po trafności rekordy z twardymi faktami — bez generowania treści.",
    "Używaj gdy LLM nie ma konkretnej sygnatury, ale chce zorientować się czy w bazie jest coś trafnego.",
    "Wciąż obowiązuje reguła naczelna: nie cytuj wyroku, jeśli nie ma go w bazie.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Zapytanie FTS5 (multiple words = AND)." },
      instancja: {
        type: "string",
        enum: ["SR", "SO", "SA", "SN", "NSA", "WSA", "TK", "TSUE"],
        description: "Opcjonalnie ogranicza do jednej instancji.",
      },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
    required: ["query"],
  },
} as const;

function toMatch(j: Judgment): JudgmentMatch {
  return {
    sygnatura: j.sygnatura,
    sad: j.sad,
    instancja: j.instancja,
    data_orzeczenia: j.data_orzeczenia,
    sentencja_typ: j.sentencja_typ,
    prawomocny: j.prawomocny,
    uchylony_przez: j.uchylony_przez,
    podstawa_prawna: j.podstawa_prawna,
    zrodlo_url: j.zrodlo_url,
    data_pobrania: j.data_pobrania,
  };
}

export function runSearchJudgments(db: JudgmentsDb, input: SearchJudgmentsInput) {
  const parsed = searchJudgmentsSchema.parse(input);
  const rows = db.search(parsed.query, {
    instancja: parsed.instancja,
    limit: parsed.limit,
  });
  return {
    query: parsed.query,
    instancja: parsed.instancja ?? "ALL",
    total_returned: rows.length,
    matches: rows.map(toMatch),
    disclaimer: DISCLAIMER,
  };
}
