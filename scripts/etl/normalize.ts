/**
 * Raw SAOS JSONL → staged JSONL of canonical `judgments` rows.
 *
 * Deterministic. Every output column either:
 *   - comes verbatim from SAOS, or
 *   - is computed by one of the regex parsers in `parsers/`, or
 *   - is a hash / timestamp we control.
 *
 * Nothing here invokes an LLM.
 */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { displaySignature, normaliseSignature, stripLightHtml } from "../../src/normalize.js";
import type { Instancja, SentencjaTyp } from "../../src/types.js";
import { openJsonlWriter, readJsonl } from "./lib/jsonl.js";
import { rawJsonl, stagedJsonl } from "./lib/paths.js";
import { extractPodstawaPrawna } from "./parsers/podstawa-prawna.js";
import { canonicalSadName, resolveInstancja } from "./parsers/sad-instancja.js";
import { classifySentencja } from "./parsers/sentencja-typ.js";
import type { SaosJudgment } from "./sources/saos.js";

const MIN_DATE = "1990-01-01";

export interface StagedJudgment {
  sygnatura: string;
  sygnatura_norm: string;
  sad: string;
  instancja: Instancja;
  data_orzeczenia: string;
  sentencja_typ: SentencjaTyp | null;
  prawomocny: 0 | 1 | null;
  uchylony_przez: string | null;
  podstawa_prawna: string[];
  zrodlo_url: string;
  data_pobrania: string;
  sha256: string;
}

export interface NormaliseInputOptions {
  /** Pass multiple raw JSONL paths to merge (e.g. legalBase + all queries). */
  inputs?: string[];
}

export interface NormaliseResult {
  outFile: string;
  total: number;
  skipped: number;
  unresolvedInstancja: number;
  unresolvedSentencja: number;
}

/**
 * Read all input SAOS JSONLs, project to the canonical schema, dedup by
 * SAOS `id` first (cheap and exact), then write to a staged JSONL.
 * Per-row dedup by (sygnatura_norm, sad, data) happens later at SQL
 * INSERT time via UNIQUE constraint.
 */
export async function normaliseSaos(opts: NormaliseInputOptions = {}): Promise<NormaliseResult> {
  const inputs = opts.inputs ?? [
    rawJsonl("saos", "legalBase"),
    rawJsonl("saos", "all"),
  ];
  const out = stagedJsonl("judgments");
  const writer = openJsonlWriter(out);

  const seenSaosIds = new Set<number>();
  const now = new Date().toISOString();
  const todayMax = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let total = 0;
  let skipped = 0;
  let unresolvedInstancja = 0;
  let unresolvedSentencja = 0;

  for (const inFile of inputs) {
    for await (const raw of readJsonl<SaosJudgment>(inFile)) {
      if (!raw?.id || seenSaosIds.has(raw.id)) {
        skipped++;
        continue;
      }
      seenSaosIds.add(raw.id);

      const projected = projectOne(raw, now);
      if (!projected) {
        skipped++;
        continue;
      }
      if (projected.data_orzeczenia < MIN_DATE || projected.data_orzeczenia > todayMax) {
        // Guard against malformed dates like "3013-…" in the upstream.
        skipped++;
        continue;
      }
      if (!projected.sentencja_typ) unresolvedSentencja++;
      writer.write(projected);
      total++;
    }
  }

  await writer.close();
  return { outFile: out, total, skipped, unresolvedInstancja, unresolvedSentencja };
}

function projectOne(raw: SaosJudgment, dataPobrania: string): StagedJudgment | null {
  const signatureRaw = raw.courtCases?.[0]?.caseNumber?.trim();
  if (!signatureRaw) return null;

  const sygnatura = displaySignature(signatureRaw);
  const sygnatura_norm = normaliseSignature(signatureRaw);

  const courtName = raw.division?.court?.name ?? null;
  const sad = canonicalSadName({ courtType: raw.courtType, courtName });
  const instancja = resolveInstancja({ courtType: raw.courtType, courtName });
  if (!instancja) return null;

  const text = stripLightHtml(raw.textContent);
  const sentencja_typ = classifySentencja(text);

  // Prefer regulations-from-the-search-result-field when SAOS gives them
  // (sometimes for COMMON it does — usually it's empty); otherwise regex
  // out of the body.  Either way, the canonical short-form list is the
  // single source of truth.
  const fromRegulations = (raw.referencedRegulations ?? [])
    .map((r) => `${r.text ?? ""} ${r.journalTitle ?? ""}`.trim())
    .filter((s) => s.length > 0)
    .join("\n");
  const podstawa_prawna = extractPodstawaPrawna(`${fromRegulations}\n${text}`);

  const sourceUrl =
    raw.source?.judgmentUrl ??
    `https://www.saos.org.pl/judgments/${raw.id}`;

  const sha256 = createHash("sha256")
    .update(raw.textContent ?? "", "utf8")
    .digest("hex");

  return {
    sygnatura,
    sygnatura_norm,
    sad,
    instancja,
    data_orzeczenia: raw.judgmentDate,
    sentencja_typ,
    prawomocny: null,        // MVP-1: deferred to v0.2 cross-ref pass
    uchylony_przez: null,    // MVP-1: deferred to v0.2 cross-ref pass
    podstawa_prawna,
    zrodlo_url: sourceUrl,
    data_pobrania: dataPobrania,
    sha256,
  };
}

export async function summariseNormalisation(res: NormaliseResult): Promise<string> {
  return [
    `Normalisation done · ${res.total} kept · ${res.skipped} skipped`,
    `  unresolved sentencja_typ: ${res.unresolvedSentencja}`,
    `  unresolved instancja:     ${res.unresolvedInstancja}`,
    `  output: ${res.outFile}`,
    "",
  ].join("\n");
}

// One-tick performance smoke for a single record, for local sanity.
// Not part of the public API.
export function _perf(raw: SaosJudgment): number {
  const t = performance.now();
  projectOne(raw, new Date().toISOString());
  return performance.now() - t;
}
