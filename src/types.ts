/**
 * Source of a ruling — only two supported in v1.
 *  - SN   · Sąd Najwyższy (Polish Supreme Court)
 *  - CJEU · Court of Justice of the European Union (Trybunał Sprawiedliwości UE)
 */
export type RulingSource = "SN" | "CJEU";

export type JudgmentType =
  | "wyrok"
  | "postanowienie"
  | "uchwała"
  | "judgment"
  | "order"
  | "opinion";

export interface LegalBasis {
  /** Short act code: 'kc' | 'kk' | 'kpc' | 'kpk' | 'rodo' | 'tfeu' | … */
  act: string;
  /** Article reference, e.g. '415' or '6 ust. 1 lit. f' */
  article: string;
}

/**
 * Canonical record shape stored in the bundled SQLite DB.
 * `tags` and `legal_basis` are JSON-encoded in the row but exposed as
 * structured arrays on the API.
 */
export interface Ruling {
  id: string;
  source: RulingSource;
  ecli: string | null;
  signature: string;
  signatureNormalised: string;
  court: string;
  chamber: string | null;
  date: string;
  type: JudgmentType;
  language: string;
  summary: string;
  tags: string[];
  legalBasis: LegalBasis[];
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  ingestedAt: string;
}

/** Lightweight projection used for list-style responses. */
export interface RulingSummary {
  id: string;
  source: RulingSource;
  ecli: string | null;
  signature: string;
  court: string;
  chamber: string | null;
  date: string;
  summary: string;
  tags: string[];
  sourceUrl: string;
}

/** Build metadata embedded in the published DB. */
export interface Manifest {
  version: string;
  builtAt: string;
  schemaVersion: number;
  totalRulings: number;
  snCount: number;
  cjeuCount: number;
  snLatestDate: string | null;
  cjeuLatestDate: string | null;
}

export interface SearchOptions {
  /** Restrict to a single source. */
  source?: RulingSource;
  /** Max results to return. */
  limit?: number;
  /** Offset for paging. */
  offset?: number;
  /** ISO date — only rulings on or after this date. */
  since?: string;
  /** ISO date — only rulings on or before this date. */
  until?: string;
}

export interface VerifyResult {
  /** True when an exact signature/ECLI hit was found. */
  exists: boolean;
  /** The matched ruling, if any. */
  ruling: Ruling | null;
  /** Up to 3 fuzzy alternatives when no exact hit. */
  suggestions: RulingSummary[];
  /** How long the lookup took, in ms (informational). */
  tookMs: number;
}
