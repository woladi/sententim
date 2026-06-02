/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  DEFERRED — gated behind SENTENTIM_ENABLE_CJEU=1                  ║
 * ║                                                                      ║
 * ║  This module fetches CJEU/TSUE judgments from CELLAR.                ║
 * ║  In MVP-1 the Polish-named schema in data/schema.sql has no `ecli`   ║
 * ║  column and no general CJEU representation, so this code is NOT      ║
 * ║  wired into the seed pipeline.                                       ║
 * ║                                                                      ║
 * ║  When SENTENTIM_ENABLE_CJEU is set, callers may invoke               ║
 * ║  fetchCjeuJudgments() directly to refresh raw JSONL, but the         ║
 * ║  normalisation step needed to land CJEU rows into `judgments`        ║
 * ║  (mapping CELEX → sygnatura, ECLI → URL, etc.) is deliberately       ║
 * ║  out of scope and will land in v0.5.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Discovery: SPARQL at publications.europa.eu/webapi/rdf/sparql.
 * Body:      REST /resource/celex/{CELEX} with Accept-Language: pol.
 */

import { fetchJson, fetchText, sleep } from "../lib/http.js";
import { openJsonlWriter } from "../lib/jsonl.js";
import { rawJsonl } from "../lib/paths.js";

const SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";
const CELLAR_REST = "https://publications.europa.eu/resource/celex";
const POLITE_DELAY_MS = 350;

export interface CjeuDiscoveryRow {
  ecli: string;
  celex: string;
  date: string;
  type: string;
  formation: string | null;
  procedureType: string | null;
}

export interface CjeuFetchOptions {
  since?: string;
  until?: string;
  maxItems?: number;
  languages?: string[];
  outFile?: string;
}

export interface CjeuFetchResult {
  outFile: string;
  total: number;
}

export function cjeuEnabled(): boolean {
  return process.env.SENTENTIM_ENABLE_CJEU === "1";
}

export async function fetchCjeuJudgments(opts: CjeuFetchOptions = {}): Promise<CjeuFetchResult> {
  if (!cjeuEnabled()) {
    throw new Error(
      "CJEU ingestion is disabled. Set SENTENTIM_ENABLE_CJEU=1 to enable. " +
        "See sources/cjeu.ts header — MVP-1 schema needs rework before CJEU rows can land in judgments.db.",
    );
  }

  const outFile = opts.outFile ?? rawJsonl("cjeu");
  const languages = opts.languages ?? ["pol", "eng", "fra"];
  const writer = openJsonlWriter(outFile);

  const discovery = await sparqlList({
    since: opts.since,
    until: opts.until,
    limit: opts.maxItems,
  });

  let written = 0;
  for (const row of discovery) {
    const htmlByLang: Record<string, string> = {};
    for (const lang of languages) {
      try {
        const body = await fetchText(`${CELLAR_REST}/${row.celex}`, {
          headers: { Accept: "text/html, application/xhtml+xml", "Accept-Language": lang },
          retries: 2,
          giveUpOn: [400, 404, 406, 410],
        });
        if (body && body.length > 500) {
          htmlByLang[lang] = body;
          break;
        }
      } catch {
        // try next language
      }
      await sleep(150);
    }
    writer.write({ ...row, htmlByLang });
    written++;
    await sleep(POLITE_DELAY_MS);
  }

  await writer.close();
  return { outFile, total: written };
}

interface SparqlListOptions {
  since?: string;
  until?: string;
  limit?: number;
}

async function sparqlList(opts: SparqlListOptions): Promise<CjeuDiscoveryRow[]> {
  const filters: string[] = [];
  if (opts.since) filters.push(`FILTER(?date >= "${opts.since}"^^xsd:date)`);
  if (opts.until) filters.push(`FILTER(?date <= "${opts.until}"^^xsd:date)`);

  const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?work ?ecli ?celex ?date ?type ?formation ?procedureType WHERE {
  ?work cdm:work_date_document ?date ;
        cdm:case-law_ecli ?ecli ;
        cdm:resource_legal_id_celex ?celex ;
        cdm:work_has_resource-type ?type .
  OPTIONAL { ?work cdm:case-law_delivered_by_court-formation ?formation . }
  OPTIONAL { ?work cdm:case-law_has_type_procedure_concept_type_procedure ?procedureType . }
  FILTER(?type IN (
    <http://publications.europa.eu/resource/authority/resource-type/JUDG>,
    <http://publications.europa.eu/resource/authority/resource-type/ORDER>,
    <http://publications.europa.eu/resource/authority/resource-type/OPIN_AG>,
    <http://publications.europa.eu/resource/authority/resource-type/VIEW_AG>
  ))
  ${filters.join("\n  ")}
} ORDER BY DESC(?date) ${opts.limit ? `LIMIT ${opts.limit}` : ""}
`.trim();

  const url = `${SPARQL}?query=${encodeURIComponent(query)}&format=application/sparql-results+json`;
  const res = await fetchJson<SparqlResponse>(url, {
    headers: { Accept: "application/sparql-results+json" },
    retries: 3,
    timeoutMs: 60_000,
  });

  return res.results.bindings.map((b) => ({
    ecli: b.ecli.value,
    celex: b.celex.value,
    date: b.date.value.slice(0, 10),
    type: tail(b.type.value, "/"),
    formation: b.formation?.value ? tail(b.formation.value, "/") : null,
    procedureType: b.procedureType?.value ? tail(b.procedureType.value, "/") : null,
  }));
}

function tail(uri: string, sep: string): string {
  const idx = uri.lastIndexOf(sep);
  return idx === -1 ? uri : uri.slice(idx + 1);
}

interface SparqlResponse {
  results: {
    bindings: Array<
      Record<string, { value: string }> & {
        ecli: { value: string };
        celex: { value: string };
        date: { value: string };
        type: { value: string };
        formation?: { value: string };
        procedureType?: { value: string };
      }
    >;
  };
}
