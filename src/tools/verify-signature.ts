import { z } from "zod";
import type { RulingsDb } from "../db.js";

export const verifySignatureSchema = z.object({
  citation: z
    .string()
    .min(1)
    .describe(
      "The case-law citation as written by the model — e.g. 'II CSK 123/22', 'C-123/22', 'ECLI:EU:C:2023:1'.",
    ),
});

export type VerifySignatureInput = z.infer<typeof verifySignatureSchema>;

export const verifySignatureTool = {
  name: "verify_signature",
  title: "Verify a case-law citation",
  description: [
    "Verify whether a Polish Supreme Court (SN) or CJEU case-law citation is real.",
    "Returns the canonical record when found, or up to 3 fuzzy alternatives when not.",
    "Use this BEFORE citing a ruling in your answer to prevent hallucinated case numbers.",
    "Accepts signatures ('II CSK 123/22', 'C-123/22'), ECLIs, and informal variants.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      citation: {
        type: "string",
        description: verifySignatureSchema.shape.citation.description,
      },
    },
    required: ["citation"],
  },
} as const;

export function runVerifySignature(db: RulingsDb, input: VerifySignatureInput) {
  const { citation } = verifySignatureSchema.parse(input);
  const result = db.verify(citation);

  if (result.exists && result.ruling) {
    const r = result.ruling;
    return {
      verdict: "VERIFIED" as const,
      lookup_ms: result.tookMs,
      ruling: {
        id: r.id,
        source: r.source,
        ecli: r.ecli,
        signature: r.signature,
        court: r.court,
        chamber: r.chamber,
        date: r.date,
        type: r.type,
        summary: r.summary,
        tags: r.tags,
        legal_basis: r.legalBasis,
        source_url: r.sourceUrl,
      },
    };
  }

  return {
    verdict: "NOT_FOUND" as const,
    lookup_ms: result.tookMs,
    message:
      "No matching ruling found in the bundled SN/CJEU corpus. Do NOT cite this signature as fact. The suggestions below are the closest known signatures — verify whether the user meant one of them.",
    suggestions: result.suggestions.map((s) => ({
      signature: s.signature,
      ecli: s.ecli,
      court: s.court,
      date: s.date,
      summary: s.summary,
      source_url: s.sourceUrl,
    })),
  };
}
