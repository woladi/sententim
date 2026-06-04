/**
 * Cold-start seed — MVP-1 corpus.
 *
 * Decision: union of two SAOS queries (user choice).
 *   (a) legalBase = "art. 45 ustawy o kredycie konsumenckim"  (~195 hits)
 *   (b) all       = "sankcja kredytu darmowego"               (~1254 hits)
 *
 * After dedup by SAOS `id` we expect ~1300 unique judgments.
 *
 *   pnpm etl:seed                       # full union (~15-20 min)
 *   pnpm etl:seed --max=50              # smoke test
 *   pnpm etl:seed --skip-fetch          # re-normalise from existing raw JSONLs
 *
 * No ANTHROPIC_API_KEY required — zero LLM in this pipeline.
 */

import { performance } from "node:perf_hooks";
import { buildDatabase } from "./build-db.js";
import { RAW_DIR, STAGING_DIR, ensureDir, rawJsonl } from "./lib/paths.js";
import { normaliseSaos, summariseNormalisation } from "./normalize.js";
import { fetchSaosJudgments } from "./sources/saos.js";

const QUERY_LEGAL_BASE = "art. 45 ustawy o kredycie konsumenckim";
const QUERY_ALL = "sankcja kredytu darmowego";

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

  const pkgVersion = flag("version") ?? process.env.npm_package_version ?? "0.1.0";
  const maxItems = flagN("max");
  const skipFetch = flag("skip-fetch") === "true";

  if (!skipFetch) {
    await step(`SAOS · legalBase="${QUERY_LEGAL_BASE}"`, () =>
      fetchSaosJudgments({
        courtType: "COMMON",
        legalBase: QUERY_LEGAL_BASE,
        maxItems,
        outFile: rawJsonl("saos", "legalBase"),
      }),
    );
    await step(`SAOS · all="${QUERY_ALL}"`, () =>
      fetchSaosJudgments({
        all: QUERY_ALL,
        maxItems,
        outFile: rawJsonl("saos", "all"),
      }),
    );
  } else {
    process.stderr.write("▸ skipping fetch (--skip-fetch)\n");
  }

  const norm = await step("Normalise + parse", () =>
    normaliseSaos({
      inputs: [rawJsonl("saos", "legalBase"), rawJsonl("saos", "all")],
    }),
  );
  process.stderr.write(await summariseNormalisation(norm));

  const built = await step("Build DB", () =>
    buildDatabase({
      pkgVersion,
      source: "SAOS",
      legalDomain: "sankcja_kredytu_darmowego",
      seedQueryCount: 2,
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
