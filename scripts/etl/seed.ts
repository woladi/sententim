/**
 * Cold-start seed — v0.5 corpus.
 *
 * Sources, unioned and id-deduped:
 *   (a) SAOS COMMON · legalBase = "art. 45 ustawy o kredycie konsumenckim"  (~195)
 *   (b) SAOS COMMON · all       = "sankcja kredytu darmowego"               (~1254)
 *   (c) SAOS SUPREME · all      = "kredyt konsumencki"                       (~44)
 *   (d) SAOS SUPREME · all      = "klauzule abuzywne"                        (~19)
 *   (e) CELLAR TSUE · curated list of CELEX codes for consumer-credit /
 *       frankowicze case-law (~15-20), fetched via REST with PL body.
 *
 * SAOS SUPREME (= Sąd Najwyższy) is upstream-frozen at 2016-06-22, so the
 * SN portion is historical; for post-2016 SN we'd need sn.pl scraper
 * (roadmap v0.6).
 *
 *   pnpm etl:seed                       # full union (~20-25 min)
 *   pnpm etl:seed --max=50              # smoke test
 *   pnpm etl:seed --skip-fetch          # re-normalise from existing raw JSONLs
 *   pnpm etl:seed --no-tsue             # skip TSUE (CELLAR fetch)
 *
 * No ANTHROPIC_API_KEY required — zero LLM in this pipeline.
 */

import { performance } from "node:perf_hooks";
import { buildDatabase } from "./build-db.js";
import { RAW_DIR, STAGING_DIR, ensureDir, rawJsonl } from "./lib/paths.js";
import { normaliseAll, summariseNormalisation } from "./normalize.js";
import { fetchCjeuCuratedJudgments } from "./sources/cjeu.js";
import { fetchSaosJudgments } from "./sources/saos.js";

const QUERY_COMMON_LEGAL_BASE = "art. 45 ustawy o kredycie konsumenckim";
const QUERY_COMMON_ALL = "sankcja kredytu darmowego";
const QUERY_SUPREME_KREDYT = "kredyt konsumencki";
const QUERY_SUPREME_ABUZYWNE = "klauzule abuzywne";

function flag(name: string): string | undefined {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (m) return m.slice(name.length + 3);
  if (process.argv.includes(`--${name}`)) return "true";
  return undefined;
}
function flagN(name: string): number | undefined {
  const v = flag(name);
  return v && v !== "true" ? Number(v) : undefined;
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  process.stderr.write(`▸ ${label}\n`);
  const out = await fn();
  const dt = ((performance.now() - t) / 1000).toFixed(1);
  process.stderr.write(`  ✓ ${label} (${dt}s)\n`);
  return out;
}

async function main(): Promise<void> {
  ensureDir(RAW_DIR);
  ensureDir(STAGING_DIR);

  const pkgVersion = flag("version") ?? process.env.npm_package_version ?? "0.5.0";
  const maxItems = flagN("max");
  const skipFetch = flag("skip-fetch") === "true";
  const skipTsue = flag("no-tsue") === "true";

  if (!skipFetch) {
    await step(`SAOS COMMON · legalBase="${QUERY_COMMON_LEGAL_BASE}"`, () =>
      fetchSaosJudgments({
        courtType: "COMMON",
        legalBase: QUERY_COMMON_LEGAL_BASE,
        maxItems,
        outFile: rawJsonl("saos", "legalBase"),
      }),
    );
    await step(`SAOS COMMON · all="${QUERY_COMMON_ALL}"`, () =>
      fetchSaosJudgments({
        all: QUERY_COMMON_ALL,
        maxItems,
        outFile: rawJsonl("saos", "all"),
      }),
    );
    await step(`SAOS SUPREME · all="${QUERY_SUPREME_KREDYT}"`, () =>
      fetchSaosJudgments({
        courtType: "SUPREME",
        all: QUERY_SUPREME_KREDYT,
        maxItems,
        outFile: rawJsonl("saos", "supreme-kredyt"),
      }),
    );
    await step(`SAOS SUPREME · all="${QUERY_SUPREME_ABUZYWNE}"`, () =>
      fetchSaosJudgments({
        courtType: "SUPREME",
        all: QUERY_SUPREME_ABUZYWNE,
        maxItems,
        outFile: rawJsonl("saos", "supreme-abuzywne"),
      }),
    );
    if (!skipTsue) {
      await step("CELLAR TSUE · curated CELEX list", () =>
        fetchCjeuCuratedJudgments({
          outFile: rawJsonl("cjeu", "curated"),
          maxItems,
        }),
      );
    }
  } else {
    process.stderr.write("▸ skipping fetch (--skip-fetch)\n");
  }

  const norm = await step("Normalise + parse", () =>
    normaliseAll({
      saosInputs: [
        rawJsonl("saos", "legalBase"),
        rawJsonl("saos", "all"),
        rawJsonl("saos", "supreme-kredyt"),
        rawJsonl("saos", "supreme-abuzywne"),
      ],
      cjeuInputs: skipTsue ? [] : [rawJsonl("cjeu", "curated")],
    }),
  );
  process.stderr.write(await summariseNormalisation(norm));

  const built = await step("Build DB", () =>
    buildDatabase({
      pkgVersion,
      source: skipTsue ? "SAOS" : "SAOS + CELLAR",
      legalDomain: "kredyt_konsumencki",
      seedQueryCount: skipTsue ? 4 : 5,
    }),
  );
  process.stderr.write(
    `\nSeeded ${built.inserted} judgments (${built.collisions} collisions absorbed, ${built.total} staged)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`seed failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
