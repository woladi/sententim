/**
 * SAOS — System Analizy Orzeczeń Sądowych (ICM UW / CeON)
 *
 * Public REST API.  No auth, JSON.
 * Docs: https://www.saos.org.pl/help/index.php/dokumentacja-api
 *
 * MVP-1 usage: COMMON court corpus is live (~466k judgments); SUPREME is
 * frozen at 2016-06-22 (38k historical).  We hit `/search/judgments`
 * with `courtType=COMMON` plus `legalBase` and/or `all` text-search
 * parameters, then re-fetch each hit via `/judgments/{id}` to get the
 * full `textContent` (search endpoint truncates).
 */

import { fetchJson, sleep } from "../lib/http.js";
import { openJsonlWriter } from "../lib/jsonl.js";
import { rawJsonl } from "../lib/paths.js";

const BASE = "https://www.saos.org.pl/api";
const PAGE_SIZE = 100;
const POLITE_DELAY_MS = 600;

export type SaosCourtType =
  | "COMMON"
  | "SUPREME"
  | "ADMINISTRATIVE"
  | "CONSTITUTIONAL_TRIBUNAL"
  | "NATIONAL_APPEAL_CHAMBER";

export interface SaosJudgment {
  id: number;
  courtType: SaosCourtType;
  courtCases: Array<{ caseNumber: string }>;
  judgmentType: string;
  judgmentDate: string;
  judgmentForm?: string;
  personnelType?: string;
  judges?: Array<{ name: string; function?: string; specialRoles?: string[] }>;
  textContent?: string;
  keywords?: string[];
  division?: {
    id: number;
    name: string;
    court?: { id: number; name: string; type: string };
  };
  source?: {
    code?: string;
    judgmentUrl?: string;
    judgmentId?: string;
    publisher?: string;
    publicationDate?: string;
  };
  referencedRegulations?: Array<{
    journalTitle?: string;
    journalNo?: string;
    journalYear?: string;
    journalEntry?: string;
    text?: string;
  }>;
}

interface SaosSearchResponse {
  items: SaosJudgment[];
  info: { totalResults: number };
  links: Array<{ rel: string; href: string }>;
}

export interface SaosFetchOptions {
  /** SAOS courtType filter. */
  courtType?: SaosCourtType;
  /** Filter by referenced legal basis (server-side string match). */
  legalBase?: string;
  /** Full-text query across the judgment body. */
  all?: string;
  /** ISO date from. */
  judgmentDateFrom?: string;
  /** ISO date to. */
  judgmentDateTo?: string;
  /** Polling — incremental runs use this. */
  sinceModificationDate?: string;
  /** Stop after this many items. */
  maxItems?: number;
  /** Politeness delay override. */
  delayMs?: number;
  /** Where to write the raw JSONL (default: data/raw/saos-<tag>.jsonl). */
  outFile?: string;
}

export interface SaosFetchResult {
  outFile: string;
  total: number;
  totalReported: number;
}

/**
 * Stream every SAOS judgment matching the filters into a JSONL file.
 * Each line is a full single-judgment record (with `textContent`).
 */
export async function fetchSaosJudgments(opts: SaosFetchOptions = {}): Promise<SaosFetchResult> {
  const tag = opts.outFile
    ? "custom"
    : (opts.legalBase ? "legalBase" : opts.all ? "all" : (opts.courtType ?? "common").toLowerCase());
  const outFile = opts.outFile ?? rawJsonl("saos", tag);
  const writer = openJsonlWriter(outFile);
  const delay = opts.delayMs ?? POLITE_DELAY_MS;

  const params = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    sortingField: "JUDGMENT_DATE",
    sortingDirection: "DESC",
  });
  if (opts.courtType) params.set("courtType", opts.courtType);
  if (opts.legalBase) params.set("legalBase", opts.legalBase);
  if (opts.all) params.set("all", opts.all);
  if (opts.judgmentDateFrom) params.set("judgmentDateFrom", opts.judgmentDateFrom);
  if (opts.judgmentDateTo) params.set("judgmentDateTo", opts.judgmentDateTo);
  if (opts.sinceModificationDate) params.set("sinceModificationDate", opts.sinceModificationDate);

  let pageNumber = 0;
  let total = 0;
  let totalReported = 0;

  while (true) {
    params.set("pageNumber", String(pageNumber));
    const url = `${BASE}/search/judgments?${params.toString()}`;
    const page = await fetchJson<SaosSearchResponse>(url, { retries: 4 });
    totalReported = page.info.totalResults;

    if (!page.items?.length) break;

    for (const item of page.items) {
      // Full body — search endpoint truncates `textContent` for hits.
      const full = await fetchSingle(item.id);
      writer.write(full);
      total++;
      if (opts.maxItems && total >= opts.maxItems) {
        await writer.close();
        return { outFile, total, totalReported };
      }
      await sleep(delay);
    }

    pageNumber++;
    if (pageNumber * PAGE_SIZE >= page.info.totalResults) break;
  }

  await writer.close();
  return { outFile, total, totalReported };
}

/**
 * Single-judgment endpoint wraps the response: `{ links: [...], data: {...} }`.
 * Search endpoint returns judgments inline under `items[]`.  This unwrap
 * normalises both so the rest of the pipeline always sees a flat record.
 */
export async function fetchSingle(id: number): Promise<SaosJudgment> {
  const res = await fetchJson<{ data?: SaosJudgment } & Partial<SaosJudgment>>(
    `${BASE}/judgments/${id}`,
    { retries: 3 },
  );
  return res.data ?? (res as SaosJudgment);
}
