/**
 * Cross-reference extractor.
 *
 * Polish appellate judgments ALWAYS reference the lower-court signature
 * they were reviewing.  The signature is invariably preceded by some
 * variant of "sygn. akt".  We extract these references so a later pass
 * can mark the corresponding lower-court rows with `uchylony_przez` (when
 * the appellate sentencja_typ is `uchyla_przekazuje`) and `prawomocny`
 * (when the appellate `oddala` an appeal — the lower judgment stands).
 *
 * High-precision, low-recall — we'd rather miss a reference than create
 * a wrong link.  The grammar of sygn. akt + signature is stable enough
 * that a regex catches the obvious cases cleanly.
 *
 * Pure regex.  No LLM.
 */

import { normaliseSignature } from "../../../src/normalize.js";

// Sygnatury w polskim orzecznictwie zaczynają się od rzymskiej liczby
// (instancji wydziału), oznaczenia wydziału (1-4 litery), numeru sprawy,
// ukośnika i 2-cyfrowego roku.  Przykłady: "I C 822/22", "VII Ca 100/24",
// "II AKa 50/23", "III CSK 1/22".
const SIGNATURE_RE =
  /\b([IVX]{1,5})\s+(A?C[a-zA-Z]{0,4}|A?K[a-zA-Z]{0,4}|U[a-zA-Z]{0,4}|P[a-zA-Z]{0,4}|S[a-zA-Z]{0,4}|N[a-zA-Z]{0,4})\s+(\d{1,5})\s*\/\s*(\d{2,4})\b/g;

// Capture signatures appearing within 400 chars after "sygn[. ]+akt".
const SYGN_AKT_RE = /\bsygn\.?\s+akt[uy]?\s+([\s\S]{0,400})/giu;

/** A reference to another judgment by signature, found in the body. */
export interface SignatureRef {
  signature: string;
  /** sygnatura_norm equivalent — what we match on. */
  normalised: string;
}

/**
 * Pull every signature reference out of a text body.
 * De-duplicated, sorted by first-occurrence offset.
 */
export function extractSignatureRefs(textContent: string | null | undefined): SignatureRef[] {
  if (!textContent) return [];

  const seen = new Set<string>();
  const refs: SignatureRef[] = [];

  for (const akt of textContent.matchAll(SYGN_AKT_RE)) {
    const window = akt[1] ?? "";
    for (const m of window.matchAll(SIGNATURE_RE)) {
      const sig = `${m[1]} ${m[2]} ${m[3]}/${m[4]}`;
      const norm = normaliseSignature(sig);
      if (seen.has(norm)) continue;
      seen.add(norm);
      refs.push({ signature: sig, normalised: norm });
    }
  }
  return refs;
}
