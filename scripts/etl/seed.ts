/**
 * Local "cold start" seed.
 *
 *   pnpm etl:seed -- --max-sn=100 --max-cjeu=50 --since=2020-01-01
 *
 * Designed to be run on the developer's machine — full SAOS SN historical
 * dump (~38k rulings, ~5–15 min) + recent CJEU window.  The output
 * (`data/rulings.db`) is committed and later distributed inside the npm
 * package.
 */

import { performance } from "node:perf_hooks";
import { buildDatabase } from "./build-db.js";
import { ensureDir, RAW_DIR, STAGING_DIR } from "./lib/paths.js";
import { normaliseCjeu, normaliseSaos } from "./normalize.js";
import { fetchCjeuJudgments } from "./sources/cjeu.js";
import { fetchSnJudgments } from "./sources/saos.js";
import { summarise } from "./summarize.js";

function flag(name: string): string | undefined {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : undefined;
}
function flagN(name: string): number | undefined {
  const v = flag(name);
  return v ? Number(v) : undefined;
}
const SKIP_SAOS = process.argv.includes("--no-sn");
const SKIP_CJEU = process.argv.includes("--no-cjeu");

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

  if (!SKIP_SAOS) {
    await step("SAOS · fetch SN judgments", () =>
      fetchSnJudgments({
        maxItems: flagN("max-sn"),
        judgmentDateFrom: flag("since"),
        judgmentDateTo: flag("until"),
      }),
    );
    await step("SAOS · normalise", normaliseSaos);
    await step("SAOS · summarise", () =>
      summarise({ source: "sn", maxItems: flagN("max-sn"), skipExisting: true }),
    );
  }

  if (!SKIP_CJEU) {
    await step("CELLAR · fetch CJEU judgments", () =>
      fetchCjeuJudgments({
        since: flag("since") ?? "2020-01-01",
        until: flag("until"),
        maxItems: flagN("max-cjeu"),
      }),
    );
    await step("CELLAR · normalise", normaliseCjeu);
    await step("CELLAR · summarise", () =>
      summarise({ source: "cjeu", maxItems: flagN("max-cjeu"), skipExisting: true }),
    );
  }

  const built = await step("Build DB", () => buildDatabase(pkgVersion));
  process.stderr.write(
    `\nSeeded ${built.total} rulings · SN ${built.sn} · CJEU ${built.cjeu}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`seed failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
