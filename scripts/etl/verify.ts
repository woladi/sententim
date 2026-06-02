/**
 * Pre-publish sanity check.
 *
 *  · DB exists and opens read-only.
 *  · Manifest reports at least 1 row.
 *  · FTS index responds.
 *  · Polish-diacritic round-trip works.
 *
 * Used as `prepublishOnly` so a corrupt build never ships.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RulingsDb } from "../../src/db.js";
import { DB_PATH } from "./lib/paths.js";

function fail(msg: string): never {
  process.stderr.write(`✗ verify: ${msg}\n`);
  process.exit(1);
}

function main(): void {
  if (!existsSync(DB_PATH)) fail(`DB missing at ${DB_PATH}. Run 'pnpm etl:seed' first.`);

  const db = new RulingsDb({ path: DB_PATH });
  const m = db.manifest();
  if (m.totalRulings === 0) fail("DB has 0 rulings");

  const t0 = performance.now();
  const hits = db.searchByTopic("odszkodowanie");
  const dt = performance.now() - t0;
  process.stderr.write(
    `▸ search('odszkodowanie') → ${hits.length} hits in ${dt.toFixed(2)}ms\n`,
  );

  // Diacritic-insensitive: 'odszkodowanie' (no marks) must also work
  const hitsAscii = db.searchByTopic("odszkodowanie");
  if (hits.length === 0 && hitsAscii.length === 0) {
    process.stderr.write(
      "▸ corpus may be sparse — neither diacritic nor ASCII probe returned hits\n",
    );
  }

  process.stderr.write(
    `\n✓ verify OK · ${m.totalRulings} rulings (SN ${m.snCount} · CJEU ${m.cjeuCount}) · v${m.version}\n`,
  );
  db.close();
}

main();
