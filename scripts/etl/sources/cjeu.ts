/**
 * CJEU / TSUE ingestion via CELLAR (Publications Office of the EU).
 *
 *   Discovery   → curated list of CELEX codes (handpicked for the
 *                 consumer-credit / frankowicze legal domain — those are
 *                 the cases polish lawyers actually cite in pisma).
 *   Full text   → REST `/resource/celex/{CELEX}` with `Accept-Language: pol`.
 *
 * v0.5 unlocks TSUE from behind `SENTENTIM_ENABLE_CJEU` — it is now part
 * of the default seed.  Setting `SENTENTIM_ENABLE_CJEU=0` skips it (or
 * pass `--no-tsue` on the seed CLI).
 *
 * Why hand-curated rather than SPARQL?
 *   - CELLAR's `cdm:work_cites_work` predicate is sparse and inconsistently
 *     applied for case-law-cites-legislation links.  An automated SPARQL
 *     filter for "judgments citing Directive 2008/48" returns 0 — see the
 *     2026-06-04 BNP dry-run report.
 *   - EUR-Lex SOAP webservice requires registration and rate-limit
 *     coordination.
 *   - For the narrow MVP domain, a handpicked list of canonical citations
 *     keeps the corpus precise: every record is a case lawyers actually
 *     reach for, none is filler.
 *
 *   Roadmap v0.6: replace the curated list with a SPARQL+EUROVOC query
 *   over CELLAR once we have a verified concept-code for "kredyt
 *   konsumencki" / "klauzule abuzywne".
 */

import { fetchText, sleep } from "../lib/http.js";
import { openJsonlWriter } from "../lib/jsonl.js";
import { rawJsonl } from "../lib/paths.js";

const CELLAR_REST = "https://publications.europa.eu/resource/celex";
const POLITE_DELAY_MS = 350;

/**
 * Curated list of CELEX codes for TSUE judgments relevant to the
 * consumer-credit / klauzule-abuzywne / frankowicze legal domain.
 *
 * Each entry includes:
 *  - `celex`: CELEX identifier — primary lookup key
 *  - `case`: human-readable case number (`C-487/21`)
 *  - `topic`: short tag visible in the staged JSONL, useful for audits
 *
 * Cases below cover the canonical authorities cited in Polish kredytowe
 * litigation: sankcja kredytu darmowego, abuzywne postanowienia w umowach
 * frankowych, ochrona konsumenta i bankowa odpowiedzialność.
 *
 * Ordered chronologically (oldest first) — the order doesn't matter for
 * correctness but makes diffs predictable.
 */
const CURATED_CJEU: Array<{ celex: string; case: string; topic: string }> = [
  { celex: "62011CJ0415", case: "C-415/11", topic: "klauzule abuzywne (Aziz)" },
  { celex: "62013CJ0026", case: "C-26/13", topic: "klauzule abuzywne (Kásler)" },
  { celex: "62013CJ0449", case: "C-449/13", topic: "kredyt konsumencki (CA Consumer Finance)" },
  { celex: "62015CJ0186", case: "C-186/16", topic: "kredyt frankowy (Andriciuc)" },
  { celex: "62017CJ0118", case: "C-118/17", topic: "abuzywne klauzule, denominacja CHF (Dunai)" },
  {
    celex: "62017CJ0176",
    case: "C-176/17",
    topic: "weksel w kredycie konsumenckim (Profi Credit Polska)",
  },
  { celex: "62018CJ0260", case: "C-260/18", topic: "klauzule abuzywne frankowe (Dziubak)" },
  {
    celex: "62019CJ0019",
    case: "C-19/20",
    topic: "kredyt CHF, możliwości utrzymania umowy (Bank BPH)",
  },
  { celex: "62019CJ0269", case: "C-269/19", topic: "klauzule abuzywne, skutki (Banca B.)" },
  { celex: "62020CJ0705", case: "C-705/20", topic: "kredyt CHF (PKO BP)" },
  {
    celex: "62021CJ0180",
    case: "C-180/21",
    topic: "kredyt konsumencki, wynagrodzenie (Profi Credit)",
  },
  { celex: "62021CJ0487", case: "C-487/21", topic: "informacja o sankcji KD, art. 10 D2008/48" },
  {
    celex: "62021CJ0520",
    case: "C-520/21",
    topic: "wynagrodzenie za korzystanie z kapitału, kredyt CHF",
  },
  { celex: "62022CJ0714", case: "C-714/22", topic: "sankcja KD, transparentność kosztów" },
  { celex: "62023CJ0677", case: "C-677/23", topic: "sankcja KD, interpretacja art. 23" },
];

export interface CjeuFetchOptions {
  outFile?: string;
  /** Languages to attempt in fallback order. `pol` first per house style. */
  languages?: string[];
  /** Cap (smoke runs). */
  maxItems?: number;
}

export interface CjeuFetchResult {
  outFile: string;
  total: number;
  fallback_pol_to_eng: number;
}

export interface CjeuRawRecord {
  celex: string;
  case_number: string;
  topic: string;
  language: string;
  html: string;
}

export function cjeuEnabled(): boolean {
  return process.env.SENTENTIM_ENABLE_CJEU !== "0";
}

/**
 * Fetch every curated TSUE judgment.  For each: try Polish first, fall
 * back to English if PL is unavailable.  Stream as JSONL — one
 * `CjeuRawRecord` per line.
 */
export async function fetchCjeuCuratedJudgments(
  opts: CjeuFetchOptions = {},
): Promise<CjeuFetchResult> {
  const outFile = opts.outFile ?? rawJsonl("cjeu", "curated");
  const languages = opts.languages ?? ["pol", "eng", "fra"];
  const writer = openJsonlWriter(outFile);
  const cap = opts.maxItems ?? CURATED_CJEU.length;

  let total = 0;
  let fallback = 0;

  for (const entry of CURATED_CJEU.slice(0, cap)) {
    let html = "";
    let language = "";
    for (const lang of languages) {
      try {
        const body = await fetchText(`${CELLAR_REST}/${entry.celex}`, {
          headers: {
            Accept: "text/html, application/xhtml+xml",
            "Accept-Language": lang,
          },
          retries: 2,
          giveUpOn: [400, 404, 406, 410],
        });
        if (body && body.length > 500) {
          html = body;
          language = lang;
          if (lang !== "pol") fallback++;
          break;
        }
      } catch {
        // try next language
      }
      await sleep(150);
    }

    if (!html) {
      process.stderr.write(`cjeu · skip ${entry.celex} (${entry.case}) — no body in pol/eng/fra\n`);
      continue;
    }

    const record: CjeuRawRecord = {
      celex: entry.celex,
      case_number: entry.case,
      topic: entry.topic,
      language,
      html,
    };
    writer.write(record);
    total++;
    await sleep(POLITE_DELAY_MS);
  }

  await writer.close();
  return { outFile, total, fallback_pol_to_eng: fallback };
}

/**
 * Convert a CELEX identifier to a human-readable TSUE case number.
 *
 *   62021CJ0487 → C-487/21    (Court of Justice judgment)
 *   62019CO0123 → C-123/19    (Court of Justice order)
 *   62020TJ0050 → T-50/20     (General Court judgment)
 *
 * Returns the original CELEX when the format is unrecognised.
 */
export function celexToCaseNumber(celex: string): string {
  // 6 = case-law sector
  // YYYY = year
  // [CJ|CO|TJ|TO|FJ|FO] = court + type
  // NNNN = case number
  const m = celex.match(/^6(\d{4})(C[JOA]|T[JOA]|F[JOA])(\d+)$/);
  if (!m) return celex;
  const [, year, type, num] = m;
  if (!year || !type || !num) return celex;
  const court = type[0] === "C" ? "C" : type[0] === "T" ? "T" : "F";
  const yy = year.slice(-2);
  const cleanNum = num.replace(/^0+/, "") || "0";
  return `${court}-${cleanNum}/${yy}`;
}

/**
 * Build ECLI from CELEX (when ECLI isn't directly available).
 *
 *   62021CJ0487 → ECLI:EU:C:2021:0487
 *
 * Note: this is a best-effort placeholder.  The actual ECLI uses the
 * case-decision sequence, which we can't reconstruct from CELEX alone.
 * Where possible, prefer the ECLI we get from the body / SPARQL.
 */
export function celexToEcli(celex: string): string | null {
  const m = celex.match(/^6(\d{4})(C[JOA]|T[JOA]|F[JOA])(\d+)$/);
  if (!m) return null;
  const [, year, type, num] = m;
  if (!year || !type || !num) return null;
  const court = type[0] === "C" ? "C" : type[0] === "T" ? "T" : "F";
  return `ECLI:EU:${court}:${year}:${num}`;
}
