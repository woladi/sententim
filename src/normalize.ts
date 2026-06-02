/**
 * Signature normalisation — single source of truth.
 *
 * "II CSK 123/22"     → "II_CSK_123_22"
 * "ii csk 123 / 22"   → "II_CSK_123_22"
 * "C-123/22 P"        → "C_123_22_P"
 * "ECLI:EU:C:2023:1"  → "ECLI_EU_C_2023_1"
 *
 * Polish diacritics are stripped so the FTS index (remove_diacritics=2) and
 * the normalised column agree.
 */

const POLISH_DIACRITICS: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
};

export function stripDiacritics(input: string): string {
  return input.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => POLISH_DIACRITICS[c] ?? c);
}

export function normaliseSignature(raw: string): string {
  return stripDiacritics(raw)
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s/\-.,;:()[\]]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Best-effort signature equivalence. Two signatures match when their
 * normalised forms match.
 */
export function signaturesMatch(a: string, b: string): boolean {
  return normaliseSignature(a) === normaliseSignature(b);
}

/**
 * Build the canonical internal id from source + signature.
 * Example: SN + "II CSK 123/22" → "sn-II_CSK_123_22"
 */
export function buildRulingId(source: "SN" | "CJEU", signature: string): string {
  return `${source.toLowerCase()}-${normaliseSignature(signature)}`;
}

/**
 * Strip light HTML noise from SAOS text fields (`<p>`, `<em>`, `<br/>`).
 * SAOS doesn't return rich HTML — usually only paragraph and emphasis tags
 * around search matches — so a regex strip is safe enough.
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
