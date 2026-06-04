import { z } from "zod";
import type { JudgmentsDb } from "../db.js";
import { detectLikelyInstancja } from "../instancja-pattern.js";
import { normaliseSignature } from "../normalize.js";
import type { Judgment, JudgmentMatch, VerifyResult } from "../types.js";

export const DISCLAIMER =
  "Dane deterministyczne ze źródła publicznego. Zweryfikuj treść w źródle. Nie stanowi porady prawnej.";

export const verifySignatureSchema = z.object({
  sygnatura: z
    .string()
    .min(1)
    .describe(
      "Sygnatura wyroku, np. 'II CSK 750/15'. Tolerujemy wielkość liter, spacje i kropki w skrótach.",
    ),
  sad: z
    .string()
    .optional()
    .describe("Opcjonalnie zawęża po nazwie sądu (substring, case-insensitive)."),
  data: z
    .string()
    .optional()
    .describe("Opcjonalnie zawęża po dokładnej dacie wydania w formacie ISO YYYY-MM-DD."),
});

export type VerifySignatureInput = z.input<typeof verifySignatureSchema>;

export const verifySignatureTool = {
  name: "verify_signature",
  title: "Zweryfikuj istnienie wyroku",
  description: [
    "Zwraca wyłącznie zweryfikowane fakty z lokalnej bazy polskich wyroków.",
    "Statusy odpowiedzi:",
    "FOUND — jedno trafienie, użyj danych;",
    "AMBIGUOUS — kilka sądów, wszyscy kandydaci zwróceni;",
    "NOT_FOUND — zero trafień, sygnatura wygląda jak SR/SO/SA (które baza pokrywa) → prawdopodobnie zmyślona;",
    "OUT_OF_SCOPE — zero trafień, sygnatura wygląda jak SN/TSUE/NSA/TK (które baza NIE pokrywa) → nie potrafimy potwierdzić ani zaprzeczyć, sprawdź w źródle.",
    "Pole `corpus_scope` mówi które instancje baza faktycznie pokrywa.",
    "Pole `likely_instancja` (tylko dla OUT_OF_SCOPE) to heurystyczny pattern-match — nie fakt o sądzie.",
    "NIE cytuj sygnatur ze statusem NOT_FOUND ani OUT_OF_SCOPE jako potwierdzonych przez ten tool.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      sygnatura: {
        type: "string",
        description: "Sygnatura wyroku, np. 'II CSK 750/15'.",
      },
      sad: {
        type: "string",
        description: "Opcjonalnie zawęża po nazwie sądu (substring).",
      },
      data: {
        type: "string",
        description: "Opcjonalnie zawęża po ISO dacie wydania YYYY-MM-DD.",
      },
    },
    required: ["sygnatura"],
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
    ecli: j.ecli,
  };
}

export function runVerifySignature(db: JudgmentsDb, input: VerifySignatureInput): VerifyResult {
  const parsed = verifySignatureSchema.parse(input);
  const candidates = db.findCandidates(parsed.sygnatura, {
    sad: parsed.sad,
    data: parsed.data,
  });
  const corpus_scope = db.manifest().corpus_scope;

  if (candidates.length === 1) {
    return {
      status: "FOUND",
      matches: [toMatch(candidates[0]!)],
      corpus_scope,
      disclaimer: DISCLAIMER,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "AMBIGUOUS",
      matches: candidates.map(toMatch),
      corpus_scope,
      disclaimer: DISCLAIMER,
    };
  }

  // Zero candidates — figure out whether the signature LOOKS like an
  // instance we don't even cover.  If so, raise OUT_OF_SCOPE so the LLM
  // doesn't conflate "fabricated" with "outside corpus".
  const norm = normaliseSignature(parsed.sygnatura);
  const likely_instancja = detectLikelyInstancja(norm);
  if (likely_instancja && !corpus_scope.includes(likely_instancja)) {
    return {
      status: "OUT_OF_SCOPE",
      matches: [],
      corpus_scope,
      likely_instancja,
      disclaimer: DISCLAIMER,
    };
  }
  return {
    status: "NOT_FOUND",
    matches: [],
    corpus_scope,
    disclaimer: DISCLAIMER,
  };
}
