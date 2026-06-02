/**
 * LLM-powered summarisation step.
 *
 *  Local (developer)            → uses the Anthropic API key from the
 *                                 developer's environment.  Picks a fast,
 *                                 cheap Haiku for bulk seeding.
 *  CI (GitHub Actions)          → uses a project secret. The incremental
 *                                 batch is small (<2k items/week) so this
 *                                 fits comfortably inside free-tier or
 *                                 a small credit budget.
 *
 * Two-sentence essence, plus 3–10 normalised tags.
 *
 * Implementation philosophy: deterministic prompt + low temperature +
 * structured output via tool-use so we can validate before persisting.
 */

import Anthropic from "@anthropic-ai/sdk";
import { openJsonlWriter, readJsonl } from "./lib/jsonl.js";
import { stagedJsonl } from "./lib/paths.js";

const MODEL = process.env.SENTENTIM_SUMMARY_MODEL ?? "claude-haiku-4-5-20251001";
const CHUNK_CHARS = 18_000; // ~6k tokens — Haiku handles this easily and cheaply

interface StagedRow {
  id: string;
  source: "SN" | "CJEU";
  signature: string;
  court: string;
  date: string;
  fullText: string;
  summary?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface SummariseOptions {
  source: "sn" | "cjeu";
  /** Cap, mostly for smoke runs. */
  maxItems?: number;
  /** Skip rows that already have a summary (incremental safety). */
  skipExisting?: boolean;
}

export async function summarise(opts: SummariseOptions): Promise<{
  outFile: string;
  total: number;
  summarised: number;
  skipped: number;
}> {
  const inFile = stagedJsonl(opts.source);
  const outFile = inFile.replace(/\.jsonl$/, ".summarised.jsonl");
  const writer = openJsonlWriter(outFile);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let total = 0;
  let summarised = 0;
  let skipped = 0;

  for await (const row of readJsonl<StagedRow>(inFile)) {
    total++;
    if (opts.maxItems && total > opts.maxItems) break;

    if (opts.skipExisting && row.summary && row.tags?.length) {
      writer.write(row);
      skipped++;
      continue;
    }

    const body = (row.fullText ?? "").slice(0, CHUNK_CHARS);
    if (body.length < 200) {
      // Not enough text to summarise — fall back to a sourced stub.
      writer.write({
        ...row,
        summary: `${row.court}, ${row.signature} (${row.date}). Pełny tekst niedostępny w źródle.`,
        tags: [],
      });
      summarised++;
      continue;
    }

    const result = await callClaude(client, row, body);
    writer.write({
      ...row,
      summary: result.summary,
      tags: result.tags,
    });
    summarised++;
  }

  await writer.close();
  return { outFile, total, summarised, skipped };
}

interface SummaryOutput {
  summary: string;
  tags: string[];
}

async function callClaude(
  client: Anthropic,
  row: StagedRow,
  body: string,
): Promise<SummaryOutput> {
  const sourceHint =
    row.source === "SN"
      ? "Polski Sąd Najwyższy"
      : "Trybunał Sprawiedliwości Unii Europejskiej (TSUE)";

  const prompt = `Jesteś asystentem prawnika. Otrzymujesz fragment orzeczenia (${sourceHint}, sygnatura ${row.signature}, data ${row.date}).

Twoje zadanie:
1. summary — DOKŁADNIE 2 zdania w języku polskim opisujące esencję rozstrzygnięcia. Pierwsze zdanie: czego dotyczyła sprawa. Drugie zdanie: co sąd rozstrzygnął i z jakiego powodu. Bez wstępów, bez "sąd uznał", od razu do meritum.
2. tags — od 3 do 10 krótkich, znormalizowanych tagów w języku polskim, oddających kluczowe pojęcia prawne (np. "odpowiedzialność deliktowa", "RODO", "art. 415 k.c.", "klauzule abuzywne"). Dolne litery, bez kropek na końcu.

Zwróć WYŁĄCZNIE poprawny JSON o strukturze:
{"summary": "…", "tags": ["…", "…"]}

TEKST ORZECZENIA:
"""
${body}
"""`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const parsed = extractJson(text);
  return {
    summary: String(parsed.summary ?? "").trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 10)
      : [],
  };
}

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}
