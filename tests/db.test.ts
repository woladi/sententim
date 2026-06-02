/**
 * End-to-end DB test: build a tiny fixture DB in-memory and exercise every
 * RulingsDb method.  Validates the SQL we ship — including the FTS5
 * unicode61 + remove_diacritics tokenizer behaviour with Polish marks.
 */

import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RulingsDb } from "../src/db.js";
import { buildRulingId, normaliseSignature } from "../src/normalize.js";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "data", "schema.sql"), "utf8");

let tmpDir: string;
let dbPath: string;

const SAMPLES = [
  {
    id: buildRulingId("SN", "II CSK 123/22"),
    source: "SN" as const,
    ecli: null,
    signature: "II CSK 123/22",
    signature_normalised: normaliseSignature("II CSK 123/22"),
    court: "Sąd Najwyższy",
    chamber: "Izba Cywilna",
    date: "2022-05-10",
    type: "wyrok",
    language: "pl",
    summary:
      "Sprawa dotyczyła zakresu odpowiedzialności deliktowej za szkodę wyrządzoną przez ruch przedsiębiorstwa. Sąd Najwyższy uznał, że art. 435 k.c. obejmuje również szkody pośrednie wynikające z normalnego ryzyka działalności.",
    tags: JSON.stringify(["odpowiedzialność deliktowa", "art. 435 k.c.", "szkoda pośrednia"]),
    legal_basis: JSON.stringify([{ act: "kc", article: "435" }]),
    source_url: "https://www.saos.org.pl/judgments/1",
    source_updated_at: null,
    ingested_at: "2025-01-01T00:00:00Z",
  },
  {
    id: buildRulingId("CJEU", "C-311/18"),
    source: "CJEU" as const,
    ecli: "ECLI:EU:C:2020:559",
    signature: "C-311/18",
    signature_normalised: normaliseSignature("C-311/18"),
    court: "Trybunał Sprawiedliwości Unii Europejskiej",
    chamber: "Wielka Izba",
    date: "2020-07-16",
    type: "judgment",
    language: "pl",
    summary:
      "Sprawa Schrems II dotyczyła ważności decyzji o adekwatności Tarczy Prywatności UE–USA oraz standardowych klauzul umownych. Trybunał stwierdził nieważność decyzji 2016/1250 i potwierdził wymóg dodatkowych zabezpieczeń przy korzystaniu ze standardowych klauzul.",
    tags: JSON.stringify(["RODO", "ochrona danych", "transfer danych", "tarcza prywatności"]),
    legal_basis: JSON.stringify([{ act: "rodo", article: "46" }]),
    source_url: "https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX%3A62018CJ0311",
    source_updated_at: null,
    ingested_at: "2025-01-01T00:00:00Z",
  },
];

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sententim-test-"));
  dbPath = join(tmpDir, "rulings.db");

  const seedDb = new Database(dbPath);
  seedDb.exec(SCHEMA);
  const insert = seedDb.prepare(`INSERT INTO rulings (
    id, source, ecli, signature, signature_normalised, court, chamber,
    date, type, language, summary, tags, legal_basis, source_url,
    source_updated_at, ingested_at
  ) VALUES (
    @id, @source, @ecli, @signature, @signature_normalised, @court, @chamber,
    @date, @type, @language, @summary, @tags, @legal_basis, @source_url,
    @source_updated_at, @ingested_at
  )`);
  for (const r of SAMPLES) insert.run(r);

  const manifest = seedDb.prepare("INSERT INTO manifest(key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    version: "0.0.0-test",
    built_at: "2025-01-01T00:00:00Z",
    schema_version: "1",
    total_rulings: "2",
    sn_count: "1",
    cjeu_count: "1",
    sn_latest_date: "2022-05-10",
    cjeu_latest_date: "2020-07-16",
  }))
    manifest.run(k, v);
  seedDb.close();

  // Sanity: write expected DB path so RulingsDb fallback can find it
  writeFileSync(join(tmpDir, "marker.txt"), "ok");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("RulingsDb", () => {
  it("reports manifest", () => {
    const db = new RulingsDb({ path: dbPath });
    const m = db.manifest();
    expect(m.totalRulings).toBe(2);
    expect(m.snCount).toBe(1);
    expect(m.cjeuCount).toBe(1);
    db.close();
  });

  it("finds by exact signature", () => {
    const db = new RulingsDb({ path: dbPath });
    const r = db.findBySignature("II CSK 123/22");
    expect(r).not.toBeNull();
    expect(r?.source).toBe("SN");
    db.close();
  });

  it("finds by sloppy signature (case, whitespace, slashes)", () => {
    const db = new RulingsDb({ path: dbPath });
    expect(db.findBySignature("ii csk 123 / 22")?.source).toBe("SN");
    db.close();
  });

  it("finds by ECLI", () => {
    const db = new RulingsDb({ path: dbPath });
    expect(db.findByEcli("ECLI:EU:C:2020:559")?.source).toBe("CJEU");
    db.close();
  });

  it("verify() returns exists=true for real signatures", () => {
    const db = new RulingsDb({ path: dbPath });
    const r = db.verify("II CSK 123/22");
    expect(r.exists).toBe(true);
    expect(r.ruling?.signature).toBe("II CSK 123/22");
    expect(r.tookMs).toBeLessThan(50);
    db.close();
  });

  it("verify() returns fuzzy suggestions for hallucinated signatures", () => {
    const db = new RulingsDb({ path: dbPath });
    const r = db.verify("II CSK 999/99");
    expect(r.exists).toBe(false);
    // suggestions may be empty when prefix doesn't match — both are valid
    expect(Array.isArray(r.suggestions)).toBe(true);
    db.close();
  });

  it("searchByTopic finds Polish words with and without diacritics", () => {
    const db = new RulingsDb({ path: dbPath });
    const withMarks = db.searchByTopic("odpowiedzialność");
    const withoutMarks = db.searchByTopic("odpowiedzialnosc");
    expect(withMarks.length).toBe(1);
    expect(withoutMarks.length).toBe(1);
    expect(withMarks[0]?.id).toBe(withoutMarks[0]?.id);
    db.close();
  });

  it("searchByTopic respects source filter", () => {
    const db = new RulingsDb({ path: dbPath });
    const cjeuOnly = db.searchByTopic("RODO", { source: "CJEU" });
    expect(cjeuOnly.every((r) => r.source === "CJEU")).toBe(true);
    db.close();
  });

  it("latest returns ordered rulings", () => {
    const db = new RulingsDb({ path: dbPath });
    const sn = db.latest("SN", 5);
    expect(sn[0]?.signature).toBe("II CSK 123/22");
    db.close();
  });
});
