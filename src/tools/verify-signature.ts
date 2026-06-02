import { z } from "zod";
import type { JudgmentsDb } from "../db.js";
import type { Judgment, JudgmentMatch, VerifyResult } from "../types.js";

export const DISCLAIMER =
  "Dane deterministyczne ze źródła publicznego. Zweryfikuj treść w źródle. Nie stanowi porady prawnej.";

export const verifySignatureSchema = z.object({
  sygnatura: z
    .string()
    .min(1)
    .describe("Sygnatura wyroku, np. 'II CSK 750/15'. Tolerujemy wielkość liter, spacje i kropki w skrótach."),
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
    "Jeśli wyrok nie istnieje w bazie → status: NOT_FOUND.",
    "Jeśli ta sama sygnatura występuje w kilku sądach → status: AMBIGUOUS, wszyscy kandydaci.",
    "NIE cytuj sygnatur, których to narzędzie nie potwierdziło.",
    "Pola: sygnatura, sąd, instancja, data, typ sentencji, podstawa prawna, URL źródła, data pobrania.",
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
  };
}

export function runVerifySignature(db: JudgmentsDb, input: VerifySignatureInput): VerifyResult {
  const parsed = verifySignatureSchema.parse(input);
  const candidates = db.findCandidates(parsed.sygnatura, {
    sad: parsed.sad,
    data: parsed.data,
  });

  if (candidates.length === 0) {
    return { status: "NOT_FOUND", matches: [], disclaimer: DISCLAIMER };
  }
  if (candidates.length === 1) {
    return { status: "FOUND", matches: [toMatch(candidates[0]!)], disclaimer: DISCLAIMER };
  }
  return { status: "AMBIGUOUS", matches: candidates.map(toMatch), disclaimer: DISCLAIMER };
}
