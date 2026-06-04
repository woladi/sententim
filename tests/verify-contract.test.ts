/**
 * Acceptance test for the public MCP contract.
 *
 * Covers the four programmatic criteria from the user's MVP-1 spec:
 *   (1) real signature → FOUND
 *   (2) same signature in 2 courts → AMBIGUOUS (both candidates)
 *   (3) non-existing signature → NOT_FOUND, no fabrication
 *   (4) lookup <10 ms
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JudgmentsDb } from "../src/db.js";
import { normaliseSignature } from "../src/normalize.js";
import { DISCLAIMER, runVerifySignature } from "../src/tools/verify-signature.js";

const SCHEMA = readFileSync(join(import.meta.dirname, "..", "data", "schema.sql"), "utf8");

let tmpDir: string;
let dbPath: string;
let db: JudgmentsDb;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sententim-contract-"));
  dbPath = join(tmpDir, "judgments.db");

  const seed = new Database(dbPath);
  seed.exec(SCHEMA);
  const insert = seed.prepare(`INSERT INTO judgments (
    sygnatura, sygnatura_norm, sad, instancja, data_orzeczenia,
    sentencja_typ, prawomocny, uchylony_przez, podstawa_prawna,
    zrodlo_url, data_pobrania, sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  insert.run(
    "II CSK 750/15",
    normaliseSignature("II CSK 750/15"),
    "Sąd Najwyższy",
    "SN",
    "2016-05-10",
    "oddala",
    1,
    null,
    JSON.stringify(["art. 45 ukk"]),
    "https://www.saos.org.pl/judgments/100001",
    "2025-01-01T00:00:00Z",
    "x".repeat(64),
  );
  insert.run(
    "I C 822/22",
    normaliseSignature("I C 822/22"),
    "Sąd Rejonowy w Olsztynie",
    "SR",
    "2022-09-15",
    "uwzglednia",
    null,
    null,
    JSON.stringify(["art. 45 ukk"]),
    "https://www.saos.org.pl/judgments/200001",
    "2025-01-01T00:00:00Z",
    "y".repeat(64),
  );
  insert.run(
    "I C 822/22",
    normaliseSignature("I C 822/22"),
    "Sąd Rejonowy w Warszawie",
    "SR",
    "2022-11-08",
    "oddala",
    null,
    null,
    JSON.stringify(["art. 45 ukk"]),
    "https://www.saos.org.pl/judgments/200002",
    "2025-01-01T00:00:00Z",
    "z".repeat(64),
  );

  const manifest = seed.prepare("INSERT INTO manifest(key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries({
    version: "0.0.0-test",
    built_at: "2025-01-01T00:00:00Z",
    schema_version: "1",
    total: "3",
    source: "SAOS",
    legal_domain: "test",
    seed_query_count: "2",
    last_seed_at: "2025-01-01T00:00:00Z",
  }))
    manifest.run(k, v);
  seed.close();

  db = new JudgmentsDb({ path: dbPath });
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("verify_signature contract", () => {
  it("(1) FOUND for a real signature, with hard facts", () => {
    const r = runVerifySignature(db, { sygnatura: "II CSK 750/15" });
    expect(r.status).toBe("FOUND");
    expect(r.matches).toHaveLength(1);
    const m = r.matches[0]!;
    expect(m.sygnatura).toBe("II CSK 750/15");
    expect(m.sad).toBe("Sąd Najwyższy");
    expect(m.instancja).toBe("SN");
    expect(m.data_orzeczenia).toBe("2016-05-10");
    expect(m.sentencja_typ).toBe("oddala");
    expect(m.podstawa_prawna).toEqual(["art. 45 ukk"]);
    expect(m.zrodlo_url).toContain("saos.org.pl");
    expect(r.disclaimer).toBe(DISCLAIMER);
    // Audit field MUST NOT leak to the MCP contract
    // biome-ignore lint/suspicious/noExplicitAny: testing leak
    expect((m as any).sha256).toBeUndefined();
  });

  it("(2) AMBIGUOUS for a signature shared by two courts", () => {
    const r = runVerifySignature(db, { sygnatura: "I C 822/22" });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.matches).toHaveLength(2);
    const sady = new Set(r.matches.map((m) => m.sad));
    expect(sady).toEqual(new Set(["Sąd Rejonowy w Olsztynie", "Sąd Rejonowy w Warszawie"]));
  });

  it("(2b) AMBIGUOUS narrows to FOUND with `sad`", () => {
    const r = runVerifySignature(db, { sygnatura: "I C 822/22", sad: "Olsztyn" });
    expect(r.status).toBe("FOUND");
    expect(r.matches[0]?.sad).toBe("Sąd Rejonowy w Olsztynie");
  });

  it("(2c) AMBIGUOUS narrows to FOUND with `data`", () => {
    const r = runVerifySignature(db, { sygnatura: "I C 822/22", data: "2022-11-08" });
    expect(r.status).toBe("FOUND");
    expect(r.matches[0]?.sad).toBe("Sąd Rejonowy w Warszawie");
  });

  it("(3) NOT_FOUND for a hallucinated signature — no fabrication", () => {
    const r = runVerifySignature(db, { sygnatura: "IV CSKP 95/21" });
    expect(r.status).toBe("NOT_FOUND");
    expect(r.matches).toEqual([]);
    expect(r.disclaimer).toBe(DISCLAIMER);
  });

  it("(4) lookup completes well under 10ms", () => {
    // Warm-up — first call after server start can be slightly slower
    runVerifySignature(db, { sygnatura: "II CSK 750/15" });
    const t0 = performance.now();
    runVerifySignature(db, { sygnatura: "II CSK 750/15" });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(10);
  });
});
