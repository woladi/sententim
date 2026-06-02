import { z } from "zod";
import type { RulingsDb } from "../db.js";

export const searchByTopicSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe(
      "Natural-language search terms in Polish or English. Polish diacritics are optional ('odszkodowanie' matches 'odszkodowanie'). FTS5 operators (AND, OR, NEAR) are honoured.",
    ),
  source: z
    .enum(["SN", "CJEU"])
    .optional()
    .describe("Restrict to one source: 'SN' (Polish Supreme Court) or 'CJEU' (EU Court of Justice)."),
  limit: z.number().int().min(1).max(50).default(10).describe("Max rulings to return (1-50)."),
});

export type SearchByTopicInput = z.input<typeof searchByTopicSchema>;

export const searchByTopicTool = {
  name: "search_by_topic",
  title: "Search case-law by topic",
  description: [
    "Search Polish Supreme Court (SN) and CJEU rulings by topic, keyword, or legal concept.",
    "Returns ranked rulings with 2-sentence summaries you can ground your answer in.",
    "Diacritic-insensitive and case-insensitive by design.",
    "Use this when the user asks a substantive legal question and you need primary case-law.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: searchByTopicSchema.shape.query.description },
      source: {
        type: "string",
        enum: ["SN", "CJEU"],
        description: "Restrict to a single source.",
      },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
    required: ["query"],
  },
} as const;

export function runSearchByTopic(db: RulingsDb, input: SearchByTopicInput) {
  const parsed = searchByTopicSchema.parse(input);
  const hits = db.searchByTopic(parsed.query, {
    source: parsed.source,
    limit: parsed.limit,
  });

  return {
    query: parsed.query,
    source: parsed.source ?? "ALL",
    total_returned: hits.length,
    rulings: hits.map((h) => ({
      id: h.id,
      source: h.source,
      ecli: h.ecli,
      signature: h.signature,
      court: h.court,
      chamber: h.chamber,
      date: h.date,
      summary: h.summary,
      tags: h.tags,
      source_url: h.sourceUrl,
    })),
  };
}
