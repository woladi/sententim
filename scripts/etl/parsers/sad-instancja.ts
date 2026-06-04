/**
 * Map a SAOS-served judgment (`courtType` + court/division name) to our
 * `Instancja` enum.
 *
 * SAOS courtType taxonomy:
 *   SUPREME                  → SN
 *   CONSTITUTIONAL_TRIBUNAL  → TK
 *   ADMINISTRATIVE           → NSA / WSA (decided by court name)
 *   COMMON                   → SR / SO / SA (decided by court name)
 *   NATIONAL_APPEAL_CHAMBER  → not modelled in MVP-1 (returns null)
 */

import type { Instancja } from "../../../src/types.js";

export interface SadCourt {
  courtType: string;
  /** The textual name of the court ("Sąd Rejonowy w Olsztynie"). */
  courtName?: string | null;
}

const COMMON_PATTERNS: Array<{ re: RegExp; instancja: Instancja }> = [
  { re: /\bs[aą]d\s+rejonowy\b/i, instancja: "SR" },
  { re: /\bs[aą]d\s+okr[eę]gowy\b/i, instancja: "SO" },
  { re: /\bs[aą]d\s+apelacyjny\b/i, instancja: "SA" },
  { re: /\bs[aą]d\s+najwy[zż]szy\b/i, instancja: "SN" },
];

const ADMIN_PATTERNS: Array<{ re: RegExp; instancja: Instancja }> = [
  { re: /\bnaczelny\s+s[aą]d\s+administracyjny\b/i, instancja: "NSA" },
  { re: /\bwojew[oó]dzki\s+s[aą]d\s+administracyjny\b/i, instancja: "WSA" },
];

export function resolveInstancja(input: SadCourt): Instancja | null {
  const name = input.courtName?.trim() ?? "";

  switch (input.courtType) {
    case "SUPREME":
      return "SN";
    case "CONSTITUTIONAL_TRIBUNAL":
      return "TK";
    case "ADMINISTRATIVE":
      for (const p of ADMIN_PATTERNS) if (p.re.test(name)) return p.instancja;
      // Fall back to NSA only when the name explicitly says so; otherwise null.
      return null;
    case "COMMON":
      for (const p of COMMON_PATTERNS) if (p.re.test(name)) return p.instancja;
      return null;
    default:
      // NATIONAL_APPEAL_CHAMBER and other types not modelled in MVP-1
      return null;
  }
}

/**
 * Compose the canonical `sad` string we store, given a SAOS division.
 *
 *   { courtType: "COMMON", divisionName: "I Wydział Cywilny",
 *     courtName: "Sąd Rejonowy w Olsztynie" }
 *     → "Sąd Rejonowy w Olsztynie"
 *
 *   { courtType: "SUPREME", chamberName: "Izba Cywilna" }
 *     → "Sąd Najwyższy"
 */
export function canonicalSadName(input: SadCourt): string {
  const name = input.courtName?.trim();
  if (name) return name;
  switch (input.courtType) {
    case "SUPREME":
      return "Sąd Najwyższy";
    case "CONSTITUTIONAL_TRIBUNAL":
      return "Trybunał Konstytucyjny";
    case "ADMINISTRATIVE":
      return "Sąd Administracyjny";
    case "COMMON":
      return "Sąd Powszechny";
    default:
      return "Nieznany";
  }
}
