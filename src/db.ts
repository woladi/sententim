import Database, { type Database as Db } from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseSignature } from "./normalize.js";
import type {
  Manifest,
  Ruling,
  RulingSource,
  RulingSummary,
  SearchOptions,
  VerifyResult,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the bundled DB path.
 *
 * In dev, this is repo-root/data/rulings.db.
 * When the package is installed via npm, this is `<pkg>/data/rulings.db`,
 * because the `data/` folder is included via the package.json `files` field.
 */
function defaultDbPath(): string {
  const candidates = [
    process.env.SENTENTIM_DB_PATH,
    join(__dirname, "..", "data", "rulings.db"),
    join(__dirname, "..", "..", "data", "rulings.db"),
    resolve(process.cwd(), "data", "rulings.db"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Return the most likely path even if missing — open() will surface the error.
  return candidates[1] ?? candidates[0]!;
}

type RulingRow = {
  id: string;
  source: RulingSource;
  ecli: string | null;
  signature: string;
  signature_normalised: string;
  court: string;
  chamber: string | null;
  date: string;
  type: Ruling["type"];
  language: string;
  summary: string;
  tags: string;
  legal_basis: string;
  source_url: string;
  source_updated_at: string | null;
  ingested_at: string;
};

function rowToRuling(row: RulingRow): Ruling {
  return {
    id: row.id,
    source: row.source,
    ecli: row.ecli,
    signature: row.signature,
    signatureNormalised: row.signature_normalised,
    court: row.court,
    chamber: row.chamber,
    date: row.date,
    type: row.type,
    language: row.language,
    summary: row.summary,
    tags: safeJson<string[]>(row.tags, []),
    legalBasis: safeJson<Ruling["legalBasis"]>(row.legal_basis, []),
    sourceUrl: row.source_url,
    sourceUpdatedAt: row.source_updated_at,
    ingestedAt: row.ingested_at,
  };
}

function rowToSummary(row: RulingRow): RulingSummary {
  return {
    id: row.id,
    source: row.source,
    ecli: row.ecli,
    signature: row.signature,
    court: row.court,
    chamber: row.chamber,
    date: row.date,
    summary: row.summary,
    tags: safeJson<string[]>(row.tags, []),
    sourceUrl: row.source_url,
  };
}

function safeJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export interface RulingsDbOptions {
  /** Override the bundled DB path. Falls back to env or repo path. */
  path?: string;
  /** Open in read-write mode (ETL only). Defaults to read-only. */
  readwrite?: boolean;
}

/**
 * Thin, synchronous wrapper around the bundled SQLite ruling database.
 * Every method is designed for sub-10ms execution against a warm page cache.
 */
export class RulingsDb {
  readonly path: string;
  readonly db: Db;
  #manifest?: Manifest;

  // Prepared statements — built once, reused on every call.
  readonly #findByEcli;
  readonly #findById;
  readonly #findBySignatureNormalised;
  readonly #fuzzyByPrefix;
  readonly #searchByTopic;
  readonly #latestBySource;
  readonly #countBySource;
  readonly #manifestStmt;

  constructor(opts: RulingsDbOptions = {}) {
    this.path = opts.path ?? defaultDbPath();
    const readonly = !opts.readwrite;
    this.db = new Database(this.path, {
      readonly,
      fileMustExist: readonly,
    });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("mmap_size = 268435456"); // 256 MB mmap — DB is read-only
    this.db.pragma("cache_size = -64000"); // 64 MB page cache

    this.#findByEcli = this.db.prepare<[string]>(
      "SELECT * FROM rulings WHERE ecli = ? LIMIT 1",
    );
    this.#findById = this.db.prepare<[string]>(
      "SELECT * FROM rulings WHERE id = ? LIMIT 1",
    );
    this.#findBySignatureNormalised = this.db.prepare<[string]>(
      "SELECT * FROM rulings WHERE signature_normalised = ? LIMIT 1",
    );
    this.#fuzzyByPrefix = this.db.prepare<[string, string, number]>(
      "SELECT * FROM rulings WHERE signature_normalised LIKE ? OR signature LIKE ? LIMIT ?",
    );
    this.#searchByTopic = this.db.prepare<{
      q: string;
      source: string | null;
      limit: number;
      offset: number;
    }>(
      `SELECT r.* FROM rulings_fts f
       JOIN rulings r ON r.rowid = f.rowid
       WHERE rulings_fts MATCH :q
         AND (:source IS NULL OR r.source = :source)
       ORDER BY rank
       LIMIT :limit OFFSET :offset`,
    );
    this.#latestBySource = this.db.prepare<[string, number]>(
      "SELECT * FROM rulings WHERE source = ? ORDER BY date DESC LIMIT ?",
    );
    this.#countBySource = this.db.prepare<[string]>(
      "SELECT COUNT(*) AS n FROM rulings WHERE source = ?",
    );
    this.#manifestStmt = this.db.prepare("SELECT key, value FROM manifest");
  }

  /** Build metadata (cached after first read). */
  manifest(): Manifest {
    if (this.#manifest) return this.#manifest;
    const rows = this.#manifestStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value] as const));
    this.#manifest = {
      version: map.get("version") ?? "0.0.0",
      builtAt: map.get("built_at") ?? new Date(0).toISOString(),
      schemaVersion: Number(map.get("schema_version") ?? 1),
      totalRulings: Number(map.get("total_rulings") ?? 0),
      snCount: Number(map.get("sn_count") ?? 0),
      cjeuCount: Number(map.get("cjeu_count") ?? 0),
      snLatestDate: map.get("sn_latest_date") ?? null,
      cjeuLatestDate: map.get("cjeu_latest_date") ?? null,
    };
    return this.#manifest;
  }

  /** Exact ECLI lookup. */
  findByEcli(ecli: string): Ruling | null {
    const row = this.#findByEcli.get(ecli.trim()) as RulingRow | undefined;
    return row ? rowToRuling(row) : null;
  }

  /** Lookup by canonical internal id. */
  findById(id: string): Ruling | null {
    const row = this.#findById.get(id) as RulingRow | undefined;
    return row ? rowToRuling(row) : null;
  }

  /**
   * Lookup by signature with the normalisation we promise: case + diacritic +
   * separator insensitive.  "II CSK 123/22" === "ii  csk 123 / 22".
   */
  findBySignature(signature: string): Ruling | null {
    const normalised = normaliseSignature(signature);
    const row = this.#findBySignatureNormalised.get(normalised) as RulingRow | undefined;
    return row ? rowToRuling(row) : null;
  }

  /**
   * Verify a citation. Returns exact hit + ranked fuzzy alternatives so the
   * caller LLM can decide whether the citation is real or hallucinated.
   */
  verify(citation: string): VerifyResult {
    const t0 = process.hrtime.bigint();
    const trimmed = citation.trim();

    // Try ECLI first when the input looks like one
    if (trimmed.toUpperCase().startsWith("ECLI:")) {
      const exact = this.findByEcli(trimmed);
      if (exact) {
        return finish(t0, { exists: true, ruling: exact, suggestions: [] });
      }
    }

    const exact = this.findBySignature(trimmed);
    if (exact) {
      return finish(t0, { exists: true, ruling: exact, suggestions: [] });
    }

    // Fuzzy fallback — prefix match on the normalised form
    const normalised = normaliseSignature(trimmed);
    const prefix = normalised.slice(0, Math.max(3, Math.floor(normalised.length * 0.7)));
    const rows = this.#fuzzyByPrefix.all(`${prefix}%`, `${trimmed}%`, 3) as RulingRow[];

    return finish(t0, {
      exists: false,
      ruling: null,
      suggestions: rows.map(rowToSummary),
    });
  }

  /**
   * Full-text search across signature, summary and tags.
   * Query syntax is FTS5 — the caller can pass `"art. 415" AND szkoda`.
   */
  searchByTopic(query: string, opts: SearchOptions = {}): RulingSummary[] {
    const fts = sanitiseFtsQuery(query);
    if (!fts) return [];
    const rows = this.#searchByTopic.all({
      q: fts,
      source: opts.source ?? null,
      limit: Math.min(opts.limit ?? 20, 100),
      offset: Math.max(opts.offset ?? 0, 0),
    }) as RulingRow[];
    return rows.map(rowToSummary);
  }

  latest(source: RulingSource, limit = 10): RulingSummary[] {
    const rows = this.#latestBySource.all(source, Math.min(limit, 100)) as RulingRow[];
    return rows.map(rowToSummary);
  }

  countBySource(source: RulingSource): number {
    const row = this.#countBySource.get(source) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }
}

function finish(
  t0: bigint,
  result: Omit<VerifyResult, "tookMs">,
): VerifyResult {
  const ns = Number(process.hrtime.bigint() - t0);
  return { ...result, tookMs: Math.round((ns / 1_000_000) * 100) / 100 };
}

/**
 * FTS5 reserves a handful of characters that, when unescaped, would either
 * blow up the query or change its semantics. We strip them and wrap the
 * remaining tokens in implicit AND.
 */
function sanitiseFtsQuery(input: string): string {
  const cleaned = input
    .replace(/["()\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // Quote each token so e.g. "art." doesn't become a column-name reference
  return cleaned
    .split(" ")
    .filter((t) => t.length >= 2)
    .map((t) => `"${t}"`)
    .join(" ");
}
