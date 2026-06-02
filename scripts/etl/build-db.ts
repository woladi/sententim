/**
 * Build the bundled SQLite DB from the *.summarised.jsonl files.
 *
 * Inputs:  data/staging/sn.summarised.jsonl
 *          data/staging/cjeu.summarised.jsonl
 * Output:  data/rulings.db   (+ data/manifest.json mirror)
 *
 * This is intentionally idempotent: it rebuilds the DB from scratch, runs
 * ANALYZE, populates the manifest, and writes a one-shot WAL-checkpoint
 * before producing the final, read-only artifact.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readJsonl } from "./lib/jsonl.js";
import { DATA_DIR, DB_PATH, MANIFEST_PATH, SCHEMA_PATH, stagedJsonl } from "./lib/paths.js";

interface SummarisedRow {
  id: string;
  source: "SN" | "CJEU";
  ecli: string | null;
  signature: string;
  signatureNormalised: string;
  court: string;
  chamber: string | null;
  date: string;
  type: string;
  language: string;
  summary: string;
  tags: string[];
  legalBasis: Array<{ act: string; article: string }>;
  sourceUrl: string;
  sourceUpdatedAt: string | null;
}

export async function buildDatabase(pkgVersion: string): Promise<{
  total: number;
  sn: number;
  cjeu: number;
}> {
  // Start fresh — the published DB is always reproducible from the staging files.
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  if (existsSync(`${DB_PATH}-wal`)) unlinkSync(`${DB_PATH}-wal`);
  if (existsSync(`${DB_PATH}-shm`)) unlinkSync(`${DB_PATH}-shm`);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const insert = db.prepare(`
    INSERT INTO rulings (
      id, source, ecli, signature, signature_normalised,
      court, chamber, date, type, language,
      summary, tags, legal_basis,
      source_url, source_updated_at, ingested_at
    ) VALUES (
      @id, @source, @ecli, @signature, @signature_normalised,
      @court, @chamber, @date, @type, @language,
      @summary, @tags, @legal_basis,
      @source_url, @source_updated_at, @ingested_at
    )
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      tags = excluded.tags,
      legal_basis = excluded.legal_basis,
      source_url = excluded.source_url,
      source_updated_at = excluded.source_updated_at,
      ingested_at = excluded.ingested_at
  `);

  const now = new Date().toISOString();
  let total = 0;
  let sn = 0;
  let cjeu = 0;
  let snLatest: string | null = null;
  let cjeuLatest: string | null = null;

  const tx = db.transaction(async () => {
    for (const source of ["sn", "cjeu"] as const) {
      const file = stagedJsonl(source).replace(/\.jsonl$/, ".summarised.jsonl");
      if (!existsSync(file)) continue;
      for await (const row of readJsonl<SummarisedRow>(file)) {
        if (!row.summary || row.summary.length < 20) continue;
        insert.run({
          id: row.id,
          source: row.source,
          ecli: row.ecli ?? null,
          signature: row.signature,
          signature_normalised: row.signatureNormalised,
          court: row.court,
          chamber: row.chamber ?? null,
          date: row.date,
          type: row.type,
          language: row.language ?? "pl",
          summary: row.summary,
          tags: JSON.stringify(row.tags ?? []),
          legal_basis: JSON.stringify(row.legalBasis ?? []),
          source_url: row.sourceUrl,
          source_updated_at: row.sourceUpdatedAt ?? null,
          ingested_at: now,
        });
        total++;
        if (row.source === "SN") {
          sn++;
          if (!snLatest || row.date > snLatest) snLatest = row.date;
        } else {
          cjeu++;
          if (!cjeuLatest || row.date > cjeuLatest) cjeuLatest = row.date;
        }
      }
    }
  });
  await tx();

  const upsertManifest = db.prepare(
    "INSERT INTO manifest(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const manifest = {
    version: pkgVersion,
    built_at: now,
    schema_version: "1",
    total_rulings: String(total),
    sn_count: String(sn),
    cjeu_count: String(cjeu),
    sn_latest_date: snLatest ?? "",
    cjeu_latest_date: cjeuLatest ?? "",
  };
  for (const [k, v] of Object.entries(manifest)) upsertManifest.run(k, v);

  db.exec("INSERT INTO rulings_fts(rulings_fts) VALUES('optimize')");
  db.exec("ANALYZE");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        version: pkgVersion,
        builtAt: now,
        schemaVersion: 1,
        totalRulings: total,
        snCount: sn,
        cjeuCount: cjeu,
        snLatestDate: snLatest,
        cjeuLatestDate: cjeuLatest,
        dataDir: DATA_DIR,
      },
      null,
      2,
    )}\n`,
  );

  return { total, sn, cjeu };
}
