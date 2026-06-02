/**
 * Outcome classifier — operates on the first ~2000 chars of `textContent`,
 * which is where SAOS-served Polish judgments put the operative part.
 *
 * Ordered priority: `uchyla_przekazuje` > `zmienia` > `umarza` > `oddala`
 * > `uwzglednia`.  This matters for compound rulings ("uchyla w części,
 * w pozostałej oddala") where we report the strongest disposition.
 *
 * NULL on no-match (never guess `'inne'`).  `'inne'` is reserved for a
 * future heuristic with stronger evidence than a regex miss.
 */

import type { SentencjaTyp } from "../../../src/types.js";

const HEAD_BUDGET = 2000;

// Each rule: regex on lower-cased, diacritic-preserved head.
// Note: the rules use Polish word stems so we don't depend on exact endings.
const RULES: Array<{ typ: SentencjaTyp; re: RegExp }> = [
  {
    typ: "uchyla_przekazuje",
    re: /\buchyla\b[\s\S]{0,200}\bprzekazuje\b/i,
  },
  {
    typ: "zmienia",
    re: /\bzmienia\s+zaskar[zż]on/i,
  },
  {
    typ: "umarza",
    re: /\bumarza\s+post[eę]powani/i,
  },
  {
    typ: "oddala",
    re: /\b(oddala|odrzuca)\s+(apelacj|kasacj|pow[oó]dztw|wnios|skarg|za[zż]alen)/i,
  },
  {
    typ: "uwzglednia",
    re: /\buwzgl[eę]dnia\s+(apelacj|kasacj|pow[oó]dztw|wnios|skarg|za[zż]alen)/i,
  },
];

export function classifySentencja(textContent: string | null | undefined): SentencjaTyp | null {
  if (!textContent) return null;
  const head = textContent.slice(0, HEAD_BUDGET);
  for (const rule of RULES) {
    if (rule.re.test(head)) return rule.typ;
  }
  return null;
}
