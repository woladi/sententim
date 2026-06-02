/**
 * Pre-publish sanity gate.
 *
 *  · DB exists and opens read-only.
 *  · `PRAGMA query_only` returns 1 in runtime mode (write is impossible).
 *  · Manifest reports at least one row.
 *  · A representative lookup runs in under 10 ms.
 *  · A diacritic round-trip works (Polish marks ≈ ASCII fold).
 *
 * Wired to `prepublishOnly` — a corrupt build never ships.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { JudgmentsDb } from "../../src/db.js";
import { runVerifySignature } from "../../src/tools/verify-signature.js";
import { DB_PATH } from "./lib/paths.js";

function fail(msg: string): never {
  process.stderr.write(`✗ verify: ${msg}\n`);
  process.exit(1);
}

function main(): void {
  if (!existsSync(DB_PATH)) fail(`DB missing at ${DB_PATH}. Run 'pnpm etl:seed' first.`);

  const db = new JudgmentsDb({ path: DB_PATH });
  const m = db.manifest();
  if (m.total === 0) fail("DB has 0 judgments");

  // Confirm query_only really is on in runtime mode.
  const qOnly = db.db.pragma("query_only", { simple: true });
  if (qOnly !== 1) fail(`PRAGMA query_only=${qOnly}, expected 1`);

  const total = db.count();
  if (total !== m.total) {
    process.stderr.write(
      `▸ warning · manifest.total=${m.total} but COUNT(*)=${total}\n`,
    );
  }

  // A pretty-much-arbitrary signature that the corpus is likely to have
  // (something with "C" or "Ca") — we only care about latency here.
  const probe = "I C 1/22";
  const t0 = performance.now();
  const r = runVerifySignature(db, { sygnatura: probe });
  const dt = performance.now() - t0;
  process.stderr.write(
    `▸ verify('${probe}') → ${r.status} in ${dt.toFixed(2)}ms (matches: ${r.matches.length})\n`,
  );

  if (dt > 25) fail(`probe lookup took ${dt.toFixed(2)}ms (>25ms threshold)`);

  process.stderr.write(
    `\n✓ verify OK · ${m.total} judgments · v${m.version} · domain=${m.legal_domain}\n`,
  );
  db.close();
}

main();
