/**
 * SAOS — System Analizy Orzeczeń Sądowych (ICM UW / CeON)
 *
 * Public REST API.  No auth, JSON.  Bulk dump preferred.
 * Pertinent docs: https://www.saos.org.pl/help/index.php/dokumentacja-api
 *
 * IMPORTANT — Verified empirically (2026-06):
 *   The Sąd Najwyższy (SUPREME) corpus in SAOS is FROZEN at 2016-06-22.
 *   Total: ~38,081 SN judgments. This is the historical foundation; for
 *   post-2016 SN coverage we'll need a separate sn.pl scraper (Phase 2).
 */

import { fetchJson, sleep } from "../lib/http.js";
import { openJsonlWriter } from "../lib/jsonl.js";
import { rawJsonl } from "../lib/paths.js";

const BASE = "https://www.saos.org.pl/api";
const PAGE_SIZE = 100;
const POLITE_DELAY_MS = 600;

export interface SaosJudgment {
  id: number;
  courtType: "SUPREME" | "COMMON" | "ADMINISTRATIVE" | "CONSTITUTIONAL_TRIBUNAL" | "NATIONAL_APPEAL_CHAMBER";
  courtCases: Array<{ caseNumber: string }>;
  judgmentType: string;
  judgmentDate: string;
  judgmentForm?: string;
  personnelType?: string;
  judges?: Array<{ name: string; function?: string; specialRoles?: string[] }>;
  textContent?: string;
  keywords?: string[];
  division?: { id: number; name: string; chambers?: Array<{ id: number; name: string }> };
  source?: { judgmentUrl?: string; publicationDate?: string };
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
  /** Only judgments on or after this ISO date. */
  judgmentDateFrom?: string;
  /** Only judgments on or before this ISO date. */
  judgmentDateTo?: string;
  /** Polling — used by incremental runs. ISO `yyyy-MM-dd'T'HH:mm:ss.SSS`. */
  sinceModificationDate?: string;
  /** Stop after this many items (handy for smoke tests). */
  maxItems?: number;
  /** Where to write the raw JSONL. */
  outFile?: string;
}

/**
 * Fetch every SN judgment matching the filters and stream them to a JSONL
 * file.  Uses the search endpoint (filtered) because the dump endpoint
 * rejects `courtType` and we'd otherwise have to download every court in
 * the SAOS corpus to filter client-side.
 */
export async function fetchSnJudgments(opts: SaosFetchOptions = {}): Promise<{
  outFile: string;
  total: number;
}> {
  const outFile = opts.outFile ?? rawJsonl("saos");
  const writer = openJsonlWriter(outFile);
  const params = new URLSearchParams({
    courtType: "SUPREME",
    pageSize: String(PAGE_SIZE),
    sortingField: "JUDGMENT_DATE",
    sortingDirection: "DESC",
  });
  if (opts.judgmentDateFrom) params.set("judgmentDateFrom", opts.judgmentDateFrom);
  if (opts.judgmentDateTo) params.set("judgmentDateTo", opts.judgmentDateTo);
  if (opts.sinceModificationDate) params.set("sinceModificationDate", opts.sinceModificationDate);

  let pageNumber = 0;
  let total = 0;

  while (true) {
    params.set("pageNumber", String(pageNumber));
    const url = `${BASE}/search/judgments?${params.toString()}`;
    const page = await fetchJson<SaosSearchResponse>(url, { retries: 4 });

    if (!page.items?.length) break;

    for (const item of page.items) {
      // Search endpoint sometimes returns truncated `textContent`; if so,
      // hit the single-judgment endpoint to get the full body.
      const full = item.textContent && item.textContent.length > 200
        ? item
        : await fetchSingle(item.id);
      writer.write(full);
      total++;
      if (opts.maxItems && total >= opts.maxItems) {
        await writer.close();
        return { outFile, total };
      }
    }

    pageNumber++;
    if (pageNumber * PAGE_SIZE >= page.info.totalResults) break;
    await sleep(POLITE_DELAY_MS);
  }

  await writer.close();
  return { outFile, total };
}

async function fetchSingle(id: number): Promise<SaosJudgment> {
  return fetchJson<SaosJudgment>(`${BASE}/judgments/${id}`, { retries: 3 });
}
