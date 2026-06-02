import { z } from "zod";
import type { RulingsDb } from "../db.js";

export const getRulingSchema = z.object({
  id: z
    .string()
    .optional()
    .describe("Canonical internal id, e.g. 'sn-II_CSK_123_22' or 'cjeu-C_123_22'."),
  ecli: z.string().optional().describe("ECLI identifier, e.g. 'ECLI:EU:C:2023:123'."),
  signature: z.string().optional().describe("Signature/case number as written: 'II CSK 123/22'."),
}).refine((d) => d.id ?? d.ecli ?? d.signature, {
  message: "Provide at least one of: id, ecli, signature.",
});

export type GetRulingInput = z.input<typeof getRulingSchema>;

export const getRulingTool = {
  name: "get_ruling",
  title: "Get full ruling record",
  description: [
    "Retrieve the full canonical record for a single ruling — summary, tags, legal basis,",
    "chamber, judgment type, and the source URL where the full text can be read.",
    "Provide one of: id, ecli, or signature.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      ecli: { type: "string" },
      signature: { type: "string" },
    },
    anyOf: [
      { required: ["id"] },
      { required: ["ecli"] },
      { required: ["signature"] },
    ],
  },
} as const;

export function runGetRuling(db: RulingsDb, input: GetRulingInput) {
  const parsed = getRulingSchema.parse(input);

  const found =
    (parsed.id && db.findById(parsed.id)) ||
    (parsed.ecli && db.findByEcli(parsed.ecli)) ||
    (parsed.signature && db.findBySignature(parsed.signature)) ||
    null;

  if (!found) {
    return {
      found: false as const,
      message: "No matching ruling. Try `verify_signature` to get fuzzy suggestions.",
    };
  }

  return {
    found: true as const,
    ruling: {
      id: found.id,
      source: found.source,
      ecli: found.ecli,
      signature: found.signature,
      court: found.court,
      chamber: found.chamber,
      date: found.date,
      type: found.type,
      language: found.language,
      summary: found.summary,
      tags: found.tags,
      legal_basis: found.legalBasis,
      source_url: found.sourceUrl,
      source_updated_at: found.sourceUpdatedAt,
    },
  };
}
