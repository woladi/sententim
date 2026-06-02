/**
 * Build the bundled SQLite DB from staged JSONL.
 *
 * Input:  data/staging/judgments.jsonl
 * Output: data/judgments.db   +   data/manifest.json
 *
 * Rebuilds from scratch every time so the published artefact is always
 * reproducible from raw + parsers + schema.  No state survives between
 * runs except the staged JSONLs.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readJsonl } from "./lib/jsonl.js";
import { DATA_DIR, DB_PATH, MANIFEST_PATH, SCHEMA_PATH, stagedJsonl } from "./lib/paths.js";
import type { StagedJudgment } from "./normalize.js";

export interface BuildOptions {
  pkgVersion: string;
  source?: string;
  legalDomain?: string;
  seedQueryCount?: number;
}

export interface BuildResult {
  total: number;
  inserted: number;
  collisions: number;
}

export async function buildDatabase(opts: BuildOptions): Promise<BuildResult> {
  // Start fresh — the published DB is always reproducible.
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) unlinkSync(p);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const insert = db.prepare(`
    INSERT INTO judgments (
      sygnatura, sygnatura_norm, sad, instancja, data_orzeczenia,
      sentencja_typ, prawomocny, uchylony_przez, podstawa_prawna,
      zrodlo_url, data_pobrania, sha256
    ) VALUES (
      @sygnatura, @sygnatura_norm, @sad, @instancja, @data_orzeczenia,
      @sentencja_typ, @prawomocny, @uchylony_przez, @podstawa_prawna,
      @zrodlo_url, @data_pobrania, @sha256
    )
    ON CONFLICT(sygnatura_norm, sad, data_orzeczenia) DO UPDATE SET
      sygnatura       = excluded.sygnatura,
      sentencja_typ   = excluded.sentencja_typ,
      podstawa_prawna = excluded.podstawa_prawna,
      zrodlo_url      = excluded.zrodlo_url,
      data_pobrania   = excluded.data_pobrania,
      sha256          = excluded.sha256
  `);

  const now = new Date().toISOString();
  let total = 0;
  let inserted = 0;
  let collisions = 0;

  // better-sqlite3 transactions are strictly synchronous, so we collect
  // the streamed rows first, then run the INSERT batch atomically.  Our
  // staged corpus is bounded (~1300 rows) — fine to hold in memory.
  const rows: StagedJudgment[] = [];
  for await (const row of readJsonl<StagedJudgment>(stagedJsonl("judgments"))) {
    rows.push(row);
  }

  const tx = db.transaction((batch: StagedJudgment[]) => {
    for (const row of batch) {
      total++;
      const info = insert.run({
        sygnatura: row.sygnatura,
        sygnatura_norm: row.sygnatura_norm,
        sad: row.sad,
        instancja: row.instancja,
        data_orzeczenia: row.data_orzeczenia,
        sentencja_typ: row.sentencja_typ,
        prawomocny: row.prawomocny,
        uchylony_przez: row.uchylony_przez,
        podstawa_prawna: JSON.stringify(row.podstawa_prawna ?? []),
        zrodlo_url: row.zrodlo_url,
        data_pobrania: row.data_pobrania,
        sha256: row.sha256,
      });
      if (info.changes === 1) inserted++;
      else collisions++;
    }
  });
  tx(rows);

  // `info.changes === 1` is true for both INSERT and UPDATE branches of
  // the UPSERT, so `inserted` over-counts when staged JSONL contains two
  // SAOS records that map to the same (sygnatura_norm, sad, data) key.
  // Take the authoritative count from the table itself.
  const distinctRows = (db.prepare("SELECT COUNT(*) AS n FROM judgments").get() as { n: number }).n;
  const upserts = inserted - distinctRows;
  inserted = distinctRows;
  collisions += Math.max(0, upserts);

  const upsertManifest = db.prepare(
    "INSERT INTO manifest(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const manifest: Record<string, string> = {
    version: opts.pkgVersion,
    built_at: now,
    schema_version: "1",
    total: String(inserted),
    source: opts.source ?? "SAOS",
    legal_domain: opts.legalDomain ?? "sankcja_kredytu_darmowego",
    seed_query_count: String(opts.seedQueryCount ?? 0),
    last_seed_at: now,
  };
  for (const [k, v] of Object.entries(manifest)) upsertManifest.run(k, v);

  db.exec("INSERT INTO judgments_fts(judgments_fts) VALUES('optimize')");
  db.exec("ANALYZE");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        version: opts.pkgVersion,
        builtAt: now,
        schemaVersion: 1,
        total: inserted,
        source: opts.source ?? "SAOS",
        legalDomain: opts.legalDomain ?? "sankcja_kredytu_darmowego",
        seedQueryCount: opts.seedQueryCount ?? 0,
        dataDir: DATA_DIR,
      },
      null,
      2,
    )}\n`,
  );

  return { total, inserted, collisions };
}
