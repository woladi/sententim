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
 * Slashes are preserved.
 *
 *   "ii  c.s.k.   822/22"  →  "II CSK 822/22"
 *   "I C 822 / 22"         →  "I C 822/22"
 *   "C-311/18 P"           →  "C-311/18 P"
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
