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
import { extractSignatureRefs } from "./parsers/cross-ref.js";
import { extractPodstawaPrawna } from "./parsers/podstawa-prawna.js";
import { canonicalSadName, resolveInstancja } from "./parsers/sad-instancja.js";
import { classifySentencja } from "./parsers/sentencja-typ.js";
import { type CjeuRawRecord, celexToEcli } from "./sources/cjeu.js";
import type { SaosJudgment } from "./sources/saos.js";

/**
 * Instances whose own ruling is, by virtue of being a court of last
 * resort in its branch, prawomocny on the day it's issued.
 *
 * SR / SO are explicitly NOT in here — even when SO sits as an appellate
 * panel (Ca / Cz / Ka), we leave its prawomocny status to the cross-ref
 * pass, because a Skarga Kasacyjna could still upend it.
 */
const ALWAYS_PRAWOMOCNY: ReadonlySet<Instancja> = new Set(["SA", "SN", "NSA", "TK", "TSUE"]);

/**
 * Instances whose decisions, when they `oddala` an appeal or `uchyla` a
 * lower judgment, deterministically settle the status of the lower row
 * they referenced.  Everything else is too noisy to act on.
 */
const APPELLATE_FOR_CROSSREF: ReadonlySet<Instancja> = new Set(["SO", "SA", "SN", "NSA"]);

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
  /** ECLI (TSUE always, SN often, COMMON rarely). */
  ecli: string | null;
}

export interface NormaliseInputOptions {
  /** Pass multiple raw JSONL paths to merge (e.g. legalBase + all queries). */
  inputs?: string[];
}

export interface NormaliseAllOptions {
  /** SAOS raw JSONL paths (COMMON + SUPREME). */
  saosInputs: string[];
  /** CJEU/TSUE raw JSONL paths.  Empty array = TSUE skipped. */
  cjeuInputs: string[];
}

export interface NormaliseResult {
  outFile: string;
  total: number;
  skipped: number;
  unresolvedInstancja: number;
  unresolvedSentencja: number;
  prawomocnyByInstance: number;
  prawomocnyByCrossRef: number;
  uchylonyPrzezSet: number;
}

/**
 * Read all input SAOS JSONLs, project to the canonical schema, dedup by
 * SAOS `id` first (cheap and exact), then write to a staged JSONL.
 * Per-row dedup by (sygnatura_norm, sad, data) happens later at SQL
 * INSERT time via UNIQUE constraint.
 */
export async function normaliseSaos(opts: NormaliseInputOptions = {}): Promise<NormaliseResult> {
  const inputs = opts.inputs ?? [rawJsonl("saos", "legalBase"), rawJsonl("saos", "all")];
  const out = stagedJsonl("judgments");

  const seenSaosIds = new Set<number>();
  const now = new Date().toISOString();
  const todayMax = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // First pass — project all rows into memory.  We keep textContent in a
  // parallel map keyed by sygnatura_norm so the cross-ref pass can run
  // without re-reading the raw JSONLs.  ~1300 records × ~20 KB textContent
  // ≈ 26 MB; comfortably in budget.
  const projected: StagedJudgment[] = [];
  const textByNorm = new Map<string, string>();

  let total = 0;
  let skipped = 0;
  const unresolvedInstancja = 0;
  let unresolvedSentencja = 0;

  for (const inFile of inputs) {
    for await (const wrapper of readJsonl<SaosJudgment & { data?: SaosJudgment }>(inFile)) {
      const raw = (wrapper as { data?: SaosJudgment }).data ?? wrapper;
      if (!raw?.id || seenSaosIds.has(raw.id)) {
        skipped++;
        continue;
      }
      seenSaosIds.add(raw.id);

      const row = projectOne(raw, now);
      if (!row) {
        skipped++;
        continue;
      }
      if (row.data_orzeczenia < MIN_DATE || row.data_orzeczenia > todayMax) {
        skipped++;
        continue;
      }
      if (!row.sentencja_typ) unresolvedSentencja++;

      projected.push(row);
      textByNorm.set(row.sygnatura_norm, stripLightHtml(raw.textContent));
      total++;
    }
  }

  // Cross-reference pass — walk every appellate row, extract references
  // to a lower judgment from its text body, look them up in the same
  // corpus, and back-fill `uchylony_przez` / `prawomocny` on the lower
  // row when the appellate's disposition is unambiguous.
  const bySygNorm = new Map<string, StagedJudgment>();
  for (const j of projected) bySygNorm.set(j.sygnatura_norm, j);

  const prawomocnyByInstance = projected.filter((j) => j.prawomocny === 1).length;
  let prawomocnyByCrossRef = 0;
  let uchylonyPrzezSet = 0;

  for (const j of projected) {
    if (!APPELLATE_FOR_CROSSREF.has(j.instancja)) continue;
    if (!j.sentencja_typ) continue;
    const text = textByNorm.get(j.sygnatura_norm);
    if (!text) continue;

    for (const ref of extractSignatureRefs(text)) {
      const lower = bySygNorm.get(ref.normalised);
      if (!lower) continue;
      if (lower.sygnatura_norm === j.sygnatura_norm) continue; // self-ref

      if (j.sentencja_typ === "uchyla_przekazuje") {
        // Hard signal: the lower judgment was annulled.
        if (lower.uchylony_przez !== j.sygnatura) {
          lower.uchylony_przez = j.sygnatura;
          uchylonyPrzezSet++;
        }
        lower.prawomocny = 0;
      } else if (j.sentencja_typ === "oddala") {
        // Soft signal: the appeal was dismissed → the lower stands.
        // Do not overwrite an explicit annulment.
        if (lower.prawomocny == null) {
          lower.prawomocny = 1;
          prawomocnyByCrossRef++;
        }
      }
      // `zmienia` / `umarza` are deliberately ignored — they do not
      // settle the lower's prawomocny status in a way we can rely on.
    }
  }

  // Final write.
  const writer = openJsonlWriter(out);
  for (const row of projected) writer.write(row);
  await writer.close();

  return {
    outFile: out,
    total,
    skipped,
    unresolvedInstancja,
    unresolvedSentencja,
    prawomocnyByInstance,
    prawomocnyByCrossRef,
    uchylonyPrzezSet,
  };
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

  const sourceUrl = raw.source?.judgmentUrl ?? `https://www.saos.org.pl/judgments/${raw.id}`;

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
    // Courts of last resort are prawomocne by construction.  Everything
    // else starts NULL and may be set during the cross-ref pass.
    prawomocny: ALWAYS_PRAWOMOCNY.has(instancja) ? 1 : null,
    uchylony_przez: null,
    podstawa_prawna,
    zrodlo_url: sourceUrl,
    data_pobrania: dataPobrania,
    sha256,
    // SAOS doesn't expose ECLI for COMMON / SUPREME records — leave null
    // unless an upstream future change starts surfacing it.
    ecli: null,
  };
}

/**
 * Project a single CELLAR record into the canonical schema.
 *
 *  - `sygnatura`        = `case_number` (e.g. C-487/21), display form
 *  - `sygnatura_norm`   = normalised form (uppercase, slash-collapsed,
 *                          stripped diacritics)
 *  - `sad`              = "Trybunał Sprawiedliwości Unii Europejskiej"
 *                          (lub "Sąd UE" — czyli General Court — for T-…)
 *  - `instancja`        = "TSUE"
 *  - `data_orzeczenia`  = derived from CELEX year (best we can do without
 *                          parsing the HTML body)
 *  - `sentencja_typ`    = NULL  (TSUE uses different phrasing; classifier
 *                          out of scope for v0.5)
 *  - `prawomocny`       = 1     (court of last resort)
 *  - `podstawa_prawna`  = best-effort extraction from PL body via regex
 *  - `zrodlo_url`       = EUR-Lex display URL for the CELEX
 *  - `sha256`           = hash of the raw HTML
 *  - `ecli`             = computed from CELEX (`ECLI:EU:C:YYYY:NNNN`)
 */
function projectCjeu(raw: CjeuRawRecord, dataPobrania: string): StagedJudgment | null {
  if (!raw.case_number || !raw.celex) return null;

  const sygnatura = displaySignature(raw.case_number);
  const sygnatura_norm = normaliseSignature(raw.case_number);
  const sad = raw.case_number.startsWith("T-")
    ? "Sąd Unii Europejskiej"
    : "Trybunał Sprawiedliwości Unii Europejskiej";

  // Year is the only date signal we can extract without parsing the body.
  // CELEX year (e.g. 62021CJ0487 → 2021).  We stamp 01-01 as the date —
  // not perfect, but every TSUE record gets a deterministic ISO date so
  // the schema constraint is satisfied.
  const yearMatch = raw.celex.match(/^6(\d{4})/);
  const yyyy = yearMatch?.[1] ?? "2000";
  const data_orzeczenia = `${yyyy}-01-01`;

  // CELEX-encoded URL on the canonical EUR-Lex frontend.
  const zrodlo_url = `https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX%3A${raw.celex}`;

  // Body — keep the raw HTML in audit terms; for regex use we strip tags.
  const text = stripLightHtml(raw.html);
  const podstawa_prawna = extractPodstawaPrawna(text);

  const sha256 = createHash("sha256").update(raw.html, "utf8").digest("hex");

  return {
    sygnatura,
    sygnatura_norm,
    sad,
    instancja: "TSUE",
    data_orzeczenia,
    sentencja_typ: null,
    prawomocny: 1,
    uchylony_przez: null,
    podstawa_prawna,
    zrodlo_url,
    data_pobrania: dataPobrania,
    sha256,
    ecli: celexToEcli(raw.celex),
  };
}

/**
 * One-pass normaliser that consumes BOTH SAOS and CJEU staged inputs and
 * writes a single staged JSONL.  Runs the SAOS cross-ref pass over the
 * Polish-court subset (TSUE rows are skipped — they're top-level by
 * construction).
 */
export async function normaliseAll(opts: NormaliseAllOptions): Promise<NormaliseResult> {
  const out = stagedJsonl("judgments");
  const now = new Date().toISOString();
  const todayMax = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const projected: StagedJudgment[] = [];
  const textByNorm = new Map<string, string>();
  const seenSaosIds = new Set<number>();

  let total = 0;
  let skipped = 0;
  const unresolvedInstancja = 0;
  let unresolvedSentencja = 0;

  // SAOS pass — exactly the logic from normaliseSaos, with shared state.
  for (const inFile of opts.saosInputs) {
    for await (const wrapper of readJsonl<SaosJudgment & { data?: SaosJudgment }>(inFile)) {
      const raw = (wrapper as { data?: SaosJudgment }).data ?? wrapper;
      if (!raw?.id || seenSaosIds.has(raw.id)) {
        skipped++;
        continue;
      }
      seenSaosIds.add(raw.id);
      const row = projectOne(raw, now);
      if (!row) {
        skipped++;
        continue;
      }
      if (row.data_orzeczenia < MIN_DATE || row.data_orzeczenia > todayMax) {
        skipped++;
        continue;
      }
      if (!row.sentencja_typ) unresolvedSentencja++;
      projected.push(row);
      textByNorm.set(row.sygnatura_norm, stripLightHtml(raw.textContent));
      total++;
    }
  }

  // CJEU pass — each CELEX produces at most one row.
  const seenCelex = new Set<string>();
  for (const inFile of opts.cjeuInputs) {
    for await (const raw of readJsonl<CjeuRawRecord>(inFile)) {
      if (!raw?.celex || seenCelex.has(raw.celex)) {
        skipped++;
        continue;
      }
      seenCelex.add(raw.celex);
      const row = projectCjeu(raw, now);
      if (!row) {
        skipped++;
        continue;
      }
      projected.push(row);
      total++;
    }
  }

  // Cross-ref pass — only over rows where `textByNorm` has the body,
  // i.e. SAOS appellate rulings.  TSUE rulings don't contribute to the
  // cross-ref because we don't store their full text in the same map.
  const bySygNorm = new Map<string, StagedJudgment>();
  for (const j of projected) bySygNorm.set(j.sygnatura_norm, j);
  const prawomocnyByInstance = projected.filter((j) => j.prawomocny === 1).length;
  let prawomocnyByCrossRef = 0;
  let uchylonyPrzezSet = 0;
  for (const j of projected) {
    if (!APPELLATE_FOR_CROSSREF.has(j.instancja)) continue;
    if (!j.sentencja_typ) continue;
    const text = textByNorm.get(j.sygnatura_norm);
    if (!text) continue;
    for (const ref of extractSignatureRefs(text)) {
      const lower = bySygNorm.get(ref.normalised);
      if (!lower) continue;
      if (lower.sygnatura_norm === j.sygnatura_norm) continue;
      if (j.sentencja_typ === "uchyla_przekazuje") {
        if (lower.uchylony_przez !== j.sygnatura) {
          lower.uchylony_przez = j.sygnatura;
          uchylonyPrzezSet++;
        }
        lower.prawomocny = 0;
      } else if (j.sentencja_typ === "oddala" && lower.prawomocny == null) {
        lower.prawomocny = 1;
        prawomocnyByCrossRef++;
      }
    }
  }

  const writer = openJsonlWriter(out);
  for (const row of projected) writer.write(row);
  await writer.close();

  return {
    outFile: out,
    total,
    skipped,
    unresolvedInstancja,
    unresolvedSentencja,
    prawomocnyByInstance,
    prawomocnyByCrossRef,
    uchylonyPrzezSet,
  };
}

export async function summariseNormalisation(res: NormaliseResult): Promise<string> {
  return [
    `Normalisation done · ${res.total} kept · ${res.skipped} skipped`,
    `  unresolved sentencja_typ: ${res.unresolvedSentencja}`,
    `  unresolved instancja:     ${res.unresolvedInstancja}`,
    `  prawomocny by instance:   ${res.prawomocnyByInstance}`,
    `  prawomocny by cross-ref:  ${res.prawomocnyByCrossRef}`,
    `  uchylony_przez set:       ${res.uchylonyPrzezSet}`,
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
