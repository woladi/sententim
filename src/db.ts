import Database, { type Database as Db } from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseSignature } from "./normalize.js";
import type { Judgment, Manifest } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultDbPath(): string {
  const candidates = [
    process.env.SENTENTIM_DB_PATH,
    join(__dirname, "..", "data", "judgments.db"),
    join(__dirname, "..", "..", "data", "judgments.db"),
    resolve(process.cwd(), "data", "judgments.db"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[1] ?? candidates[0]!;
}

interface JudgmentRow {
  id: number;
  sygnatura: string;
  sygnatura_norm: string;
  sad: string;
  instancja: Judgment["instancja"];
  data_orzeczenia: string;
  sentencja_typ: Judgment["sentencja_typ"];
  prawomocny: 0 | 1 | null;
  uchylony_przez: string | null;
  podstawa_prawna: string;
  zrodlo_url: string;
  data_pobrania: string;
  sha256: string;
}

function rowToJudgment(row: JudgmentRow): Judgment {
  return {
    ...row,
    podstawa_prawna: safeJsonArray(row.podstawa_prawna),
  };
}

function safeJsonArray(input: string): string[] {
  try {
    const v = JSON.parse(input);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export interface JudgmentsDbOptions {
  /** Override the bundled DB path. */
  path?: string;
  /**
   * Open in read-write mode (ETL only). Defaults to read-only.
   * Even when `false`, runtime callers further enforce `PRAGMA query_only=1`.
   */
  readwrite?: boolean;
}

export interface FindCandidatesOptions {
  /** Substring match on the court name (case-insensitive). */
  sad?: string;
  /** Exact ISO date match. */
  data?: string;
}

/**
 * Read-only-by-default wrapper around the bundled corpus.
 *
 *   const db = new JudgmentsDb();
 *   db.findCandidates("II CSK 750/15");
 *   //  → 0  → caller should report NOT_FOUND
 *   //  → 1  → FOUND
 *   //  → ≥2 → AMBIGUOUS
 */
export class JudgmentsDb {
  readonly path: string;
  readonly db: Db;
  #manifest?: Manifest;

  readonly #findByNorm;
  readonly #findByNormAndSad;
  readonly #findByNormAndData;
  readonly #findByNormAndSadAndData;
  readonly #manifestStmt;
  readonly #countStmt;

  constructor(opts: JudgmentsDbOptions = {}) {
    this.path = opts.path ?? defaultDbPath();
    const readonly = !opts.readwrite;
    this.db = new Database(this.path, {
      readonly,
      fileMustExist: readonly,
    });

    // Runtime guard — query_only stays on regardless of the open mode flag.
    // This makes the runtime path provably side-effect-free.
    if (readonly) {
      this.db.pragma("query_only = 1");
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("mmap_size = 268435456");
    this.db.pragma("cache_size = -64000");

    this.#findByNorm = this.db.prepare<[string]>(
      "SELECT * FROM judgments WHERE sygnatura_norm = ? ORDER BY data_orzeczenia DESC LIMIT 50",
    );
    this.#findByNormAndSad = this.db.prepare<[string, string]>(
      "SELECT * FROM judgments WHERE sygnatura_norm = ? AND sad LIKE ? ORDER BY data_orzeczenia DESC LIMIT 50",
    );
    this.#findByNormAndData = this.db.prepare<[string, string]>(
      "SELECT * FROM judgments WHERE sygnatura_norm = ? AND data_orzeczenia = ? LIMIT 50",
    );
    this.#findByNormAndSadAndData = this.db.prepare<[string, string, string]>(
      "SELECT * FROM judgments WHERE sygnatura_norm = ? AND sad LIKE ? AND data_orzeczenia = ? LIMIT 50",
    );

    this.#manifestStmt = this.db.prepare("SELECT key, value FROM manifest");
    this.#countStmt = this.db.prepare("SELECT COUNT(*) AS n FROM judgments");
  }

  manifest(): Manifest {
    if (this.#manifest) return this.#manifest;
    const rows = this.#manifestStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value] as const));
    this.#manifest = {
      version: map.get("version") ?? "0.0.0",
      built_at: map.get("built_at") ?? new Date(0).toISOString(),
      schema_version: Number(map.get("schema_version") ?? 1),
      total: Number(map.get("total") ?? 0),
      source: map.get("source") ?? "",
      legal_domain: map.get("legal_domain") ?? "",
      seed_query_count: Number(map.get("seed_query_count") ?? 0),
      last_seed_at: map.get("last_seed_at") ?? "",
    };
    return this.#manifest;
  }

  count(): number {
    return (this.#countStmt.get() as { n: number }).n;
  }

  /**
   * Return every judgment matching the (sygnatura, sad?, data?) tuple.
   *
   *   0 results → caller reports NOT_FOUND
   *   1 result  → caller reports FOUND
   *   N results → caller reports AMBIGUOUS and returns the full list
   *
   * No heuristic ranking, no implicit picking. The DB never invents.
   */
  findCandidates(sygnatura: string, opts: FindCandidatesOptions = {}): Judgment[] {
    const norm = normaliseSignature(sygnatura);
    const sadLike = opts.sad?.trim() ? `%${opts.sad.trim()}%` : null;
    const data = opts.data?.trim() || null;

    let rows: JudgmentRow[];
    if (sadLike && data) {
      rows = this.#findByNormAndSadAndData.all(norm, sadLike, data) as JudgmentRow[];
    } else if (sadLike) {
      rows = this.#findByNormAndSad.all(norm, sadLike) as JudgmentRow[];
    } else if (data) {
      rows = this.#findByNormAndData.all(norm, data) as JudgmentRow[];
    } else {
      rows = this.#findByNorm.all(norm) as JudgmentRow[];
    }
    return rows.map(rowToJudgment);
  }

  close(): void {
    this.db.close();
  }
}
