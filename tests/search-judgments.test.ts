/**
 * search_judgments contract — fixture DB exercise.
 */

import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JudgmentsDb } from "../src/db.js";
import { normaliseSignature } from "../src/normalize.js";
import { runSearchJudgments } from "../src/tools/search-judgments.js";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "data", "schema.sql"), "utf8");

let tmpDir: string;
let dbPath: string;
let db: JudgmentsDb;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sententim-fts-"));
  dbPath = join(tmpDir, "judgments.db");

  const seed = new Database(dbPath);
  seed.exec(SCHEMA);
  const insert = seed.prepare(`INSERT INTO judgments (
    sygnatura, sygnatura_norm, sad, instancja, data_orzeczenia,
    sentencja_typ, prawomocny, uchylony_przez, podstawa_prawna,
    zrodlo_url, data_pobrania, sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  insert.run(
    "I C 52/26", normaliseSignature("I C 52/26"),
    "Sąd Rejonowy w Piszu", "SR", "2026-04-29",
    "oddala", null, null,
    JSON.stringify(["art. 30 ukk", "art. 45 ukk", "art. 555 k.c."]),
    "https://example.com/1", "2026-01-01T00:00:00Z", "a".repeat(64),
  );
  insert.run(
    "III Ca 100/25", normaliseSignature("III Ca 100/25"),
    "Sąd Okręgowy w Krakowie", "SO", "2025-11-15",
    "oddala", null, null,
    JSON.stringify(["art. 45 ukk"]),
    "https://example.com/2", "2026-01-01T00:00:00Z", "b".repeat(64),
  );
  insert.run(
    "I ACa 50/24", normaliseSignature("I ACa 50/24"),
    "Sąd Apelacyjny w Warszawie", "SA", "2024-08-20",
    "oddala", 1, null,
    JSON.stringify(["art. 69 pr.bank"]),
    "https://example.com/3", "2026-01-01T00:00:00Z", "c".repeat(64),
  );

  const manifest = seed.prepare("INSERT INTO manifest(key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries({
    version: "0.0.0-test", built_at: "2025-01-01T00:00:00Z",
    schema_version: "1", total: "3", source: "SAOS",
    legal_domain: "test", seed_query_count: "1", last_seed_at: "2025-01-01T00:00:00Z",
  })) manifest.run(k, v);
  seed.close();

  db = new JudgmentsDb({ path: dbPath });
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("search_judgments", () => {
  it("finds by sygnatura keyword", () => {
    const r = runSearchJudgments(db, { query: "ACa" });
    expect(r.total_returned).toBeGreaterThan(0);
    expect(r.matches[0]?.sygnatura).toBe("I ACa 50/24");
  });

  it("finds by sąd name", () => {
    const r = runSearchJudgments(db, { query: "Olsztyn" });
    expect(r.total_returned).toBe(0);
    const r2 = runSearchJudgments(db, { query: "Piszu" });
    expect(r2.total_returned).toBe(1);
    expect(r2.matches[0]?.sad).toContain("Piszu");
  });

  it("finds by podstawa prawna", () => {
    const r = runSearchJudgments(db, { query: "ukk" });
    expect(r.total_returned).toBe(2);
    const signatures = new Set(r.matches.map((m) => m.sygnatura));
    expect(signatures).toEqual(new Set(["I C 52/26", "III Ca 100/25"]));
  });

  it("narrows by instancja", () => {
    const r = runSearchJudgments(db, { query: "ukk", instancja: "SO" });
    expect(r.total_returned).toBe(1);
    expect(r.matches[0]?.instancja).toBe("SO");
  });

  it("returns disclaimer on every call", () => {
    const r = runSearchJudgments(db, { query: "ukk" });
    expect(r.disclaimer).toMatch(/Dane deterministyczne/);
  });

  it("returns empty for no-hit query", () => {
    const r = runSearchJudgments(db, { query: "halucynacja" });
    expect(r.total_returned).toBe(0);
    expect(r.matches).toEqual([]);
  });
});
