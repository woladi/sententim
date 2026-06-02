/**
 * Weekly incremental ETL — runs in GitHub Actions.
 *
 *  · SAOS · pulls anything modified in the last 7 days; SN itself is
 *    frozen at 2016-06-22 but we keep the poll so the moment CeON
 *    resumes ingestion we pick up automatically.
 *  · CELLAR · fetches CJEU instruments dated within the last ~10 days
 *    (overlap window so we don't lose late-publications).
 *
 * Keeps the run under the CI budget (small batch + Haiku model).
 */

import { performance } from "node:perf_hooks";
import { buildDatabase } from "./build-db.js";
import { ensureDir, RAW_DIR, STAGING_DIR } from "./lib/paths.js";
import { normaliseCjeu, normaliseSaos } from "./normalize.js";
import { fetchCjeuJudgments } from "./sources/cjeu.js";
import { fetchSnJudgments } from "./sources/saos.js";
import { summarise } from "./summarize.js";

const DAY = 24 * 60 * 60 * 1000;
const SAOS_LOOKBACK_DAYS = 14;
const CJEU_LOOKBACK_DAYS = 10;

function toIsoMs(d: Date): string {
  return d.toISOString().replace(/Z$/, "");
}
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  const now = Date.now();
  const saosSince = toIsoMs(new Date(now - SAOS_LOOKBACK_DAYS * DAY));
  const cjeuSince = toIsoDate(new Date(now - CJEU_LOOKBACK_DAYS * DAY));

  const pkgVersion = process.env.npm_package_version ?? "0.1.0";

  await step(`SAOS · poll (sinceModificationDate=${saosSince})`, () =>
    fetchSnJudgments({ sinceModificationDate: saosSince }),
  );
  await step("SAOS · normalise", normaliseSaos);
  await step("SAOS · summarise (skip-existing)", () =>
    summarise({ source: "sn", skipExisting: true }),
  );

  await step(`CELLAR · fetch CJEU since ${cjeuSince}`, () =>
    fetchCjeuJudgments({ since: cjeuSince }),
  );
  await step("CELLAR · normalise", normaliseCjeu);
  await step("CELLAR · summarise (skip-existing)", () =>
    summarise({ source: "cjeu", skipExisting: true }),
  );

  const built = await step("Build DB", () => buildDatabase(pkgVersion));
  process.stderr.write(
    `\nIncremental complete · total ${built.total} (SN ${built.sn} · CJEU ${built.cjeu})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`incremental failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
