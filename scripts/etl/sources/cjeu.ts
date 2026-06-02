/**
 * CJEU / TSUE ingestion via CELLAR (Publications Office of the EU).
 *
 *  Discovery   → SPARQL endpoint at publications.europa.eu/webapi/rdf/sparql
 *  Full text   → REST  endpoint /resource/celex/{CELEX} with Accept-Language: pol
 *
 * Verified (2026-06):
 *  - SPARQL is online and responds to anonymous requests in JSON.
 *  - REST returns full Polish HTML when Accept-Language: pol is set.
 *  - Polish is one of 24 procedural languages; AG opinions and orders may
 *    lag — we probe and fall back to fra / eng.
 *
 * Volume — ~1.5–2k CJEU instruments per year; weekly increments stay small.
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
  /** JUDG | ORDER | OPIN_AG | VIEW_AG */
  type: string;
  /** Court formation code (e.g. CHAMB_01_C) */
  formation: string | null;
  /** Procedure type code (e.g. PREJ) */
  procedureType: string | null;
}

export interface CjeuRecord extends CjeuDiscoveryRow {
  htmlByLang: Record<string, string>;
}

export interface CjeuFetchOptions {
  /** ISO date — earliest judgment date to ingest (inclusive). */
  since?: string;
  /** ISO date — latest judgment date to ingest (inclusive). */
  until?: string;
  /** Stop after this many items (smoke tests). */
  maxItems?: number;
  /** Languages to attempt for the body, in fallback order. */
  languages?: string[];
  outFile?: string;
}

const SHORT_NAME: Record<string, string> = {
  JUDG: "judgment",
  ORDER: "order",
  OPIN_AG: "opinion",
  VIEW_AG: "opinion",
  OPIN_JUR: "opinion",
};

/**
 * 1. Ask CELLAR for every CJEU instrument with a date in [since, until].
 * 2. For each, fetch the body in Polish (with eng/fra fallback).
 * 3. Stream to JSONL.
 */
export async function fetchCjeuJudgments(opts: CjeuFetchOptions = {}): Promise<{
  outFile: string;
  total: number;
}> {
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
          break; // first-language-wins for body fetching
        }
      } catch {
        // try next language
      }
      await sleep(150);
    }

    writer.write({ ...row, shortType: SHORT_NAME[row.type] ?? "judgment", htmlByLang });
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
