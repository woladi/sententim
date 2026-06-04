import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as Db } from "better-sqlite3";
import { normaliseSignature, stemPolishPhrase, stemPolishWord } from "./normalize.js";
import type { Instancja, Judgment, Manifest } from "./types.js";

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
  readonly #ftsSearch;
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
    // FTS5 search joined back to the canonical row.  We never expose
    // textContent (it isn't stored), only the structured row.
    this.#ftsSearch = this.db.prepare<{
      q: string;
      instancja: string | null;
      limit: number;
      offset: number;
    }>(
      `SELECT j.* FROM judgments_fts f
       JOIN judgments j ON j.id = f.rowid
       WHERE judgments_fts MATCH :q
         AND (:instancja IS NULL OR j.instancja = :instancja)
       ORDER BY rank
       LIMIT :limit OFFSET :offset`,
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
      corpus_scope: parseCorpusScope(map.get("corpus_scope")),
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
    // Stem-aware `sad` substring: `"Gdynia"` becomes `"Gdyni"` so it
    // matches the locative form `"Sąd Rejonowy w Gdyni"` stored in the
    // base.  Token-wise so multi-word inputs ("Sąd Apelacyjny") still
    // work as substring anchors.
    const sadRaw = opts.sad?.trim();
    const sadLike = sadRaw ? `%${stemPolishPhrase(sadRaw)}%` : null;
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

  /**
   * FTS5-backed search across (sygnatura, sygnatura_norm, podstawa_prawna,
   * sad).  Diacritic-insensitive by virtue of the unicode61 tokenizer with
   * remove_diacritics=2.  Returns ranked judgments matching the query.
   */
  search(
    query: string,
    opts: { instancja?: Judgment["instancja"]; limit?: number; offset?: number } = {},
  ): Judgment[] {
    const fts = sanitiseFtsQuery(query);
    if (!fts) return [];
    // Wrap the FTS5 call: even though the sanitiser strips reserved
    // keywords and special chars, a future malformed input shouldn't
    // surface as MCP error -32603.  A defensive empty result is the
    // contractually safer fallback.
    try {
      const rows = this.#ftsSearch.all({
        q: fts,
        instancja: opts.instancja ?? null,
        limit: Math.min(opts.limit ?? 20, 100),
        offset: Math.max(opts.offset ?? 0, 0),
      }) as JudgmentRow[];
      return rows.map(rowToJudgment);
    } catch (err) {
      // Log to stderr so operators can diagnose, but never throw.
      process.stderr.write(
        `sententim · search() swallowed: ${(err as Error).message} (query="${query}")\n`,
      );
      return [];
    }
  }

  close(): void {
    this.db.close();
  }
}

/**
 * FTS5 reserved keywords — when these appear as bare tokens FTS5
 * treats them as operators (`AND`/`OR`/`NOT`/`NEAR`) and our `expandToken`
 * would turn them into `OR*` / `AND*` / etc. which FTS5 then rejects
 * with a syntax error.  Drop them before they reach the query.
 */
const FTS5_RESERVED: ReadonlySet<string> = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * FTS5 query sanitiser.
 *
 * Polish nouns inflect heavily, so we never use exact-token matching.
 * Each input token is expanded to a prefix term (`token*`).  Additionally,
 * when a token has 5+ characters and ends in a Polish nominative-style
 * vowel, we ALSO emit the stem (without that vowel) as an OR-prefix so
 * `Warszawa` finds `Warszawie`, `Krakowa` finds `Krakowski`, and so on.
 * This is a heuristic, not a morphology engine, but it covers the
 * majority of city / declension cases without a dictionary dependency.
 *
 * Tokens are whitelisted to letters + digits (incl. Polish diacritics)
 * so nothing in the user's input can hijack FTS5 query syntax.  We also
 * drop the FTS5 reserved keywords (AND/OR/NOT/NEAR) — they would otherwise
 * become `OR*` after expansion and trip a syntax error.
 *
 * Multi-token queries become implicit AND (FTS5 default).
 */
function sanitiseFtsQuery(input: string): string {
  if (!input) return "";
  const tokens = input
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !FTS5_RESERVED.has(t.toUpperCase()));
  if (tokens.length === 0) return "";
  return tokens.map(expandToken).join(" ");
}

function expandToken(t: string): string {
  // Drop a trailing Polish nominative vowel before adding `*` so
  // `Warszawa` matches `Warszawie`, `apelacyjny` matches `apelacyjna`,
  // etc.  FTS5 rejects parenthesised OR-groups when mixed with AND
  // terms, so we commit to the stem instead of OR-ing both forms.
  // The same stem heuristic powers the `sad` substring filter in
  // findCandidates — see stemPolishWord in normalize.ts.
  return `${stemPolishWord(t)}*`;
}

/**
 * Parse `corpus_scope` value stored in the manifest table as a JSON
 * array of Instancja codes.  Defaults to `["SR","SO","SA"]` for
 * back-compat with v0.3.x DBs which didn't set the key.
 */
const INSTANCJA_VALUES: ReadonlySet<Instancja> = new Set<Instancja>([
  "SR",
  "SO",
  "SA",
  "SN",
  "NSA",
  "WSA",
  "TK",
  "TSUE",
]);

function parseCorpusScope(raw: string | undefined): Instancja[] {
  if (!raw) return ["SR", "SO", "SA"];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["SR", "SO", "SA"];
    return parsed.filter((x): x is Instancja => INSTANCJA_VALUES.has(x as Instancja));
  } catch {
    return ["SR", "SO", "SA"];
  }
}
