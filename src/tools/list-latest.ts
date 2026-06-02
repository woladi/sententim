import { z } from "zod";
import type { RulingsDb } from "../db.js";

export const listLatestSchema = z.object({
  source: z.enum(["SN", "CJEU"]).describe("Which corpus to pull from."),
  limit: z.number().int().min(1).max(50).default(10),
});

export type ListLatestInput = z.input<typeof listLatestSchema>;

export const listLatestTool = {
  name: "list_latest",
  title: "List most recent rulings",
  description: "Return the N most recent rulings from SN or CJEU, ordered by judgment date.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", enum: ["SN", "CJEU"] },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
    required: ["source"],
  },
} as const;

export function runListLatest(db: RulingsDb, input: ListLatestInput) {
  const parsed = listLatestSchema.parse(input);
  const rows = db.latest(parsed.source, parsed.limit);
  return {
    source: parsed.source,
    total_returned: rows.length,
    rulings: rows.map((r) => ({
      id: r.id,
      signature: r.signature,
      ecli: r.ecli,
      court: r.court,
      chamber: r.chamber,
      date: r.date,
      summary: r.summary,
      tags: r.tags,
      source_url: r.sourceUrl,
    })),
  };
}
