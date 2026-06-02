/**
 * Legal-basis extractor.
 *
 * Pulls every `art. N [act-alias]` mention from the judgment body and
 * normalises it into the canonical short form we ship in the DB:
 *
 *   "ustawy o kredycie konsumenckim"  → "ukk"
 *   "Prawa bankowego"                 → "pr.bank"
 *   "kodeksu cywilnego"               → "k.c."
 *
 * Output: sorted, unique JSON-encodable array of strings.
 *
 * Pure regex.  No LLM, no semantic guesses.
 */

interface ActAlias {
  /** Patterns we accept in source text (case-insensitive). */
  match: RegExp;
  /** Canonical short form we emit. */
  short: string;
}

const ACTS: ActAlias[] = [
  { match: /ustaw[ay]\s+o\s+kredycie\s+konsumenckim|\bu\.?k\.?k\b|\bUKK\b/i, short: "ukk" },
  { match: /praw[ao]\s+bankow|\bpr\.?\s*bank\b/i, short: "pr.bank" },
  { match: /kodeks(?:u|owi|em|ie)?\s+cywiln|\bk\.?c\b/i, short: "k.c." },
  { match: /kodeks(?:u|owi|em|ie)?\s+karneg|\bk\.?k\b/i, short: "k.k." },
  { match: /kodeks(?:u|owi|em|ie)?\s+post[eę]powania\s+cywiln|\bk\.?p\.?c\b/i, short: "kpc" },
  { match: /kodeks(?:u|owi|em|ie)?\s+post[eę]powania\s+karneg|\bk\.?p\.?k\b/i, short: "kpk" },
  { match: /kodeks(?:u|owi|em|ie)?\s+pracy|\bk\.?p\b/i, short: "k.p." },
  { match: /konstytucji/i, short: "konstytucja" },
  { match: /rozporz[aą]dzeni[ae]\s+2016\/679|\bRODO\b|\bGDPR\b/i, short: "rodo" },
  { match: /ustaw[ay]\s+o\s+ochronie\s+konkurencji\s+i\s+konsument/i, short: "uokik" },
];

// Match an article number (possibly followed by a letter or fragment like "75c").
// We deliberately don't try to parse ust./pkt suffixes — they make the dedup
// noisy without much benefit at this stage.
const ART_RE = /\bart\.?\s*(\d+[a-z]?)\s*(?:[a-zA-ZĄĆĘŁŃÓŚŹŻąćęłńóśźż.,\s]*?)\s+(ustaw[ay]\s+o\s+kredycie\s+konsumenckim|praw[ao]\s+bankow\w*|pr\.?\s*bank|kodeks(?:u|owi|em|ie)?\s+cywiln\w*|kodeks(?:u|owi|em|ie)?\s+karn\w*|kodeks(?:u|owi|em|ie)?\s+post[eę]powania\s+cywiln\w*|kodeks(?:u|owi|em|ie)?\s+post[eę]powania\s+karn\w*|kodeks(?:u|owi|em|ie)?\s+pracy|konstytucji|rozporz[aą]dzeni[ae]\s+2016\/679|\bRODO\b|ustaw[ay]\s+o\s+ochronie\s+konkurencji\s+i\s+konsument\w*|u\.?k\.?k|UKK|k\.?c|k\.?k|k\.?p\.?c|k\.?p\.?k|k\.?p)/giu;

function shortFor(actText: string): string | null {
  for (const a of ACTS) {
    if (a.match.test(actText)) return a.short;
  }
  return null;
}

export function extractPodstawaPrawna(textContent: string | null | undefined): string[] {
  if (!textContent) return [];
  const hits = new Set<string>();
  for (const m of textContent.matchAll(ART_RE)) {
    const article = m[1];
    const actText = m[2];
    if (!article || !actText) continue;
    const short = shortFor(actText);
    if (!short) continue;
    hits.add(`art. ${article} ${short}`);
  }
  return [...hits].sort();
}
