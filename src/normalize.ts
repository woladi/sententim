/**
 * Signature normalisation — single source of truth.
 *
 * Two outputs per signature:
 *
 *   1. `displaySignature(raw)` — light cleanup, ready to round-trip back
 *      to a human.  Keeps slashes, uppercases letters, collapses runs of
 *      whitespace, removes dots inside abbreviations (`C.S.K.` → `CSK`).
 *
 *   2. `normaliseSignature(raw)` — what we match on.  Same as (1) PLUS
 *      diacritic stripping, so `Łeb/Ąć` collapses to `LEB/AC` and stays
 *      consistent with the FTS5 `unicode61 remove_diacritics=2` tokenizer.
 *
 * Rationale: signatures themselves rarely contain Polish diacritics, but
 * we never want a user typing the sąd's full name or a fancy
 * apostrophe to silently miss a match.
 */

const POLISH_DIACRITICS: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "A",
  Ć: "C",
  Ę: "E",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z",
};

export function stripDiacritics(input: string): string {
  return input.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => POLISH_DIACRITICS[c] ?? c);
}

/**
 * Display form — case-folded, dot-stripped abbreviations, whitespace tidy.
 * Slashes are preserved.  A trailing four-digit year is collapsed to two
 * digits so that `I C 1535/2023` matches `I C 1535/23` stored in SAOS.
 *
 *   "ii  c.s.k.   822/22"  →  "II CSK 822/22"
 *   "I C 822 / 22"         →  "I C 822/22"
 *   "I C 1535/2023"        →  "I C 1535/23"
 *   "X 5/1999"             →  "X 5/99"
 *   "C-311/18 P"           →  "C-311/18 P"
 *
 * The year collapse only fires for 4-digit years starting with `19` or
 * `20`, so signatures whose tail merely looks like a long number
 * (e.g. weird internal IDs) are left alone.
 */
export function displaySignature(raw: string): string {
  return (
    raw
      .trim()
      .toUpperCase()
      .replace(/\s*\/\s*/g, "/")
      // Strip dots in abbreviations like "C.S.K." → "CSK".
      // A letter+dot is removed when followed by:
      //   · another letter+optional-dot (mid-abbreviation, "C.S")
      //   · whitespace (end of abbreviation, "K. 822")
      //   · end of input ("K." at EOL)
      //   · a slash ("K./22")
      .replace(/([A-ZĄĆĘŁŃÓŚŹŻ])\.(?=[A-ZĄĆĘŁŃÓŚŹŻ]\.?|\s|\/|$)/g, "$1")
      // Collapse trailing four-digit year (1900-2099) to two-digit form
      // — SAOS stores `I C 1535/23`, prawnicy piszą `I C 1535/2023`.
      // Optional " P" suffix (CJEU appeal cases) is preserved.
      .replace(/\/(19|20)(\d{2})(\s+P)?$/, "/$2$3")
      .replace(/\s+/g, " ")
  );
}

/**
 * Lookup form — `displaySignature` + diacritic stripping. This is what
 * goes into `sygnatura_norm` and the FTS index.
 */
export function normaliseSignature(raw: string): string {
  return stripDiacritics(displaySignature(raw));
}

/**
 * True when two signatures look the same after our normalisation.
 */
export function signaturesMatch(a: string, b: string): boolean {
  return normaliseSignature(a) === normaliseSignature(b);
}

/**
 * Heuristic Polish stem for common-word substring matching.  When the
 * input ends in a typical nominative-style vowel (a/ą/e/ę/i/o/ó/u/y) and
 * is at least 5 characters long, the trailing vowel is dropped.  This
 * lets `Gdynia` match the locative `w Gdyni`, `Warszawa` match
 * `w Warszawie`, etc., without pulling in a full Polish lemmatiser.
 *
 * Shorter words and consonant-ending words are returned unchanged.
 * Multi-token inputs (e.g. `"Sąd Rejonowy"`) are stemmed token-by-token
 * so each word independently loses its trailing vowel.
 *
 * Used by:
 *  - the FTS5 query expansion (`expandToken` in db.ts), and
 *  - the `sad` substring filter in `findCandidates` (B3 fix).
 */
export function stemPolishWord(input: string): string {
  if (input.length >= 5 && /[aąeęioóuy]$/iu.test(input)) {
    return input.slice(0, -1);
  }
  return input;
}

/** Token-wise stem for multi-word inputs like `"Sąd Apelacyjny"`. */
export function stemPolishPhrase(input: string): string {
  return input.trim().split(/\s+/).map(stemPolishWord).join(" ");
}

/**
 * Strip light SAOS-style HTML out of `textContent` so the raw body is
 * regex-friendly for our deterministic parsers.  SAOS occasionally
 * wraps fragments in `<p>` and `<em>` (the latter when search hits are
 * highlighted); we do not need rich-text fidelity.
 */
export function stripLightHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
