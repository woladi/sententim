/**
 * Raw → canonical normalisation.
 *
 * Reads the JSONL files produced by `sources/saos.ts` and `sources/cjeu.ts`,
 * applies our common Ruling schema, and writes per-source staged JSONL
 * (one record per line) that is then fed to summarisation + build-db.
 */

import { buildRulingId, normaliseSignature, stripLightHtml } from "../../src/normalize.js";
import type { JudgmentType, Ruling } from "../../src/types.js";
import { openJsonlWriter, readJsonl } from "./lib/jsonl.js";
import { rawJsonl, stagedJsonl } from "./lib/paths.js";

const SAOS_JUDGMENT_TYPE: Record<string, JudgmentType> = {
  SENTENCE: "wyrok",
  DECISION: "postanowienie",
  RESOLUTION: "uchwała",
};

const CJEU_RESOURCE_TYPE: Record<string, JudgmentType> = {
  JUDG: "judgment",
  ORDER: "order",
  OPIN_AG: "opinion",
  VIEW_AG: "opinion",
};

interface SaosRaw {
  id: number;
  courtType: string;
  courtCases: Array<{ caseNumber: string }>;
  judgmentType: string;
  judgmentDate: string;
  judgmentForm?: string;
  textContent?: string;
  division?: { chambers?: Array<{ name: string }> };
  source?: { judgmentUrl?: string; publicationDate?: string };
  referencedRegulations?: Array<{ text?: string; journalTitle?: string }>;
  keywords?: string[];
}

interface CjeuRaw {
  ecli: string;
  celex: string;
  date: string;
  type: string;
  shortType: string;
  formation: string | null;
  procedureType: string | null;
  htmlByLang: Record<string, string>;
}

export async function normaliseSaos(): Promise<{ outFile: string; total: number }> {
  const writer = openJsonlWriter(stagedJsonl("sn"));
  let total = 0;

  for await (const raw of readJsonl<SaosRaw>(rawJsonl("saos"))) {
    if (raw.courtType !== "SUPREME") continue;
    const signature = raw.courtCases?.[0]?.caseNumber?.trim();
    if (!signature) continue;

    const fullText = stripLightHtml(raw.textContent);
    const chamber = raw.division?.chambers?.[0]?.name ?? null;

    const ruling: Omit<Ruling, "summary" | "tags"> & { fullText: string } = {
      id: buildRulingId("SN", signature),
      source: "SN",
      ecli: null, // SAOS doesn't return ECLI for SN
      signature,
      signatureNormalised: normaliseSignature(signature),
      court: "Sąd Najwyższy",
      chamber,
      date: raw.judgmentDate,
      type: SAOS_JUDGMENT_TYPE[raw.judgmentType] ?? "wyrok",
      language: "pl",
      legalBasis: (raw.referencedRegulations ?? [])
        .map((r) => deriveLegalBasis(r.journalTitle, r.text))
        .filter((x): x is { act: string; article: string } => x !== null)
        .slice(0, 10),
      sourceUrl: raw.source?.judgmentUrl ?? `https://www.saos.org.pl/judgments/${raw.id}`,
      sourceUpdatedAt: raw.source?.publicationDate ?? null,
      ingestedAt: new Date(0).toISOString(), // stamp during build-db
      fullText,
    };

    writer.write(ruling);
    total++;
  }

  await writer.close();
  return { outFile: stagedJsonl("sn"), total };
}

export async function normaliseCjeu(): Promise<{ outFile: string; total: number }> {
  const writer = openJsonlWriter(stagedJsonl("cjeu"));
  let total = 0;

  for await (const raw of readJsonl<CjeuRaw>(rawJsonl("cjeu"))) {
    const signature = ecliToCaseNumber(raw.ecli) ?? raw.celex;
    const polishOrFallback =
      raw.htmlByLang?.pol ?? raw.htmlByLang?.eng ?? raw.htmlByLang?.fra ?? "";
    const fullText = stripLightHtml(polishOrFallback);

    const ruling = {
      id: buildRulingId("CJEU", signature),
      source: "CJEU" as const,
      ecli: raw.ecli,
      signature,
      signatureNormalised: normaliseSignature(signature),
      court: "Trybunał Sprawiedliwości Unii Europejskiej",
      chamber: raw.formation,
      date: raw.date,
      type: CJEU_RESOURCE_TYPE[raw.type] ?? "judgment",
      language: raw.htmlByLang?.pol ? "pl" : raw.htmlByLang?.eng ? "en" : "fr",
      legalBasis: [],
      sourceUrl: `https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX%3A${encodeURIComponent(raw.celex)}`,
      sourceUpdatedAt: null,
      ingestedAt: new Date(0).toISOString(),
      fullText,
    } satisfies Omit<Ruling, "summary" | "tags"> & { fullText: string };

    writer.write(ruling);
    total++;
  }

  await writer.close();
  return { outFile: stagedJsonl("cjeu"), total };
}

/**
 * ECLI:EU:C:2023:123 → C-123/23   (heuristic; only used as a display fallback)
 * For real CJEU signatures we'd parse them out of the body; we lean on CELEX
 * + ECLI as the stable identifiers.
 */
function ecliToCaseNumber(ecli: string): string | null {
  const m = ecli.match(/^ECLI:EU:(C|T|F):(\d{4}):(\d+)$/);
  if (!m) return null;
  const [, court, year, seq] = m;
  const yy = (year ?? "").slice(-2);
  return `${court}-${seq}/${yy}`;
}

const ACT_ALIASES: Record<string, string> = {
  "kodeks cywilny": "kc",
  "kodeks karny": "kk",
  "kodeks postępowania cywilnego": "kpc",
  "kodeks postępowania karnego": "kpk",
  "kodeks pracy": "kp",
  konstytucja: "konstytucja",
  "rozporządzenie 2016/679": "rodo",
};

function deriveLegalBasis(
  title: string | undefined,
  text: string | undefined,
): { act: string; article: string } | null {
  if (!title && !text) return null;
  const haystack = `${title ?? ""} ${text ?? ""}`.toLowerCase();
  let act: string | null = null;
  for (const [needle, code] of Object.entries(ACT_ALIASES)) {
    if (haystack.includes(needle)) {
      act = code;
      break;
    }
  }
  if (!act) return null;
  const articleMatch = text?.match(/art\.?\s*([0-9a-zÀ-ſ.,\s]+?)(?:\s|$)/iu);
  return { act, article: articleMatch?.[1]?.trim() ?? "" };
}
