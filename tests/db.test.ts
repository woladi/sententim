/**
 * End-to-end DB test: build a tiny fixture DB in-memory and exercise every
 * JudgmentsDb method. Validates the SQL we ship + the FTS5 tokenizer.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JudgmentsDb } from "../src/db.js";
import { normaliseSignature } from "../src/normalize.js";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "data", "schema.sql"), "utf8");

let tmpDir: string;
let dbPath: string;

const SAMPLES = [
  {
    sygnatura: "II CSK 750/15",
    sygnatura_norm: normaliseSignature("II CSK 750/15"),
    sad: "Sąd Najwyższy",
    instancja: "SN",
    data_orzeczenia: "2016-05-10",
    sentencja_typ: "oddala",
    prawomocny: 1,
    uchylony_przez: null,
    podstawa_prawna: JSON.stringify(["art. 45 ukk"]),
    zrodlo_url: "https://www.saos.org.pl/judgments/100001",
    data_pobrania: "2025-01-01T00:00:00Z",
    sha256: "a".repeat(64),
  },
  // Same signature, different court — the AMBIGUOUS case
  {
    sygnatura: "I C 822/22",
    sygnatura_norm: normaliseSignature("I C 822/22"),
    sad: "Sąd Rejonowy w Olsztynie",
    instancja: "SR",
    data_orzeczenia: "2022-09-15",
    sentencja_typ: "uwzglednia",
    prawomocny: null,
    uchylony_przez: null,
    podstawa_prawna: JSON.stringify(["art. 45 ukk", "art. 75c pr.bank"]),
    zrodlo_url: "https://www.saos.org.pl/judgments/200001",
    data_pobrania: "2025-01-01T00:00:00Z",
    sha256: "b".repeat(64),
  },
  {
    sygnatura: "I C 822/22",
    sygnatura_norm: normaliseSignature("I C 822/22"),
    sad: "Sąd Rejonowy w Warszawie",
    instancja: "SR",
    data_orzeczenia: "2022-11-08",
    sentencja_typ: "oddala",
    prawomocny: null,
    uchylony_przez: null,
    podstawa_prawna: JSON.stringify(["art. 45 ukk"]),
    zrodlo_url: "https://www.saos.org.pl/judgments/200002",
    data_pobrania: "2025-01-01T00:00:00Z",
    sha256: "c".repeat(64),
  },
];

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sententim-test-"));
  dbPath = join(tmpDir, "judgments.db");

  const seedDb = new Database(dbPath);
  seedDb.exec(SCHEMA);
  const insert = seedDb.prepare(`INSERT INTO judgments (
    sygnatura, sygnatura_norm, sad, instancja, data_orzeczenia,
    sentencja_typ, prawomocny, uchylony_przez, podstawa_prawna,
    zrodlo_url, data_pobrania, sha256
  ) VALUES (
    @sygnatura, @sygnatura_norm, @sad, @instancja, @data_orzeczenia,
    @sentencja_typ, @prawomocny, @uchylony_przez, @podstawa_prawna,
    @zrodlo_url, @data_pobrania, @sha256
  )`);
  for (const s of SAMPLES) insert.run(s);

  const manifest = seedDb.prepare("INSERT INTO manifest(key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    version: "0.0.0-test",
    built_at: "2025-01-01T00:00:00Z",
    schema_version: "1",
    total: String(SAMPLES.length),
    source: "SAOS",
    legal_domain: "test",
    seed_query_count: "2",
    last_seed_at: "2025-01-01T00:00:00Z",
  }))
    manifest.run(k, v);
  seedDb.close();
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("JudgmentsDb", () => {
  it("opens read-only with query_only=1", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const qo = db.db.pragma("query_only", { simple: true });
    expect(qo).toBe(1);
    db.close();
  });

  it("reports manifest", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const m = db.manifest();
    expect(m.total).toBe(3);
    expect(m.source).toBe("SAOS");
    expect(m.legal_domain).toBe("test");
    db.close();
  });

  it("finds exactly one for unique signature", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const r = db.findCandidates("II CSK 750/15");
    expect(r).toHaveLength(1);
    expect(r[0]?.sad).toBe("Sąd Najwyższy");
    expect(r[0]?.podstawa_prawna).toEqual(["art. 45 ukk"]);
    db.close();
  });

  it("returns all candidates for ambiguous signature", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const r = db.findCandidates("I C 822/22");
    expect(r).toHaveLength(2);
    const sady = new Set(r.map((x) => x.sad));
    expect(sady).toEqual(new Set(["Sąd Rejonowy w Olsztynie", "Sąd Rejonowy w Warszawie"]));
    db.close();
  });

  it("narrows by court substring", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const r = db.findCandidates("I C 822/22", { sad: "Olsztyn" });
    expect(r).toHaveLength(1);
    expect(r[0]?.sad).toContain("Olsztyn");
    db.close();
  });

  it("narrows by exact date", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const r = db.findCandidates("I C 822/22", { data: "2022-11-08" });
    expect(r).toHaveLength(1);
    expect(r[0]?.sad).toContain("Warszawie");
    db.close();
  });

  it("returns no candidates for hallucinated signature", () => {
    const db = new JudgmentsDb({ path: dbPath });
    const r = db.findCandidates("IV CSKP 95/21");
    expect(r).toEqual([]);
    db.close();
  });

  it("is whitespace/dot insensitive on input", () => {
    const db = new JudgmentsDb({ path: dbPath });
    expect(db.findCandidates("ii  c.s.k. 750 / 15")).toHaveLength(1);
    db.close();
  });
});
