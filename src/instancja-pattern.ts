/**
 * Heurystyka klasyfikacji sygnatury → potential `Instancja`.
 *
 * Wzorce sygnatur w polskim/europejskim systemie sądowym są na tyle
 * stabilne, że samo dopasowanie regexu daje wiarygodny "guess" — bez
 * konieczności dochodzenia do bazy.  Używamy tego TYLKO jako hint do
 * rozróżnienia "to halucynacja" od "to spoza zakresu naszego korpusu".
 *
 * Funkcja nie ma deterministycznych prawd — to klasyfikator wzorca.
 * Nigdy nie cytuj wyroku tylko dlatego że pattern się zgadza.
 *
 * Operuje na ZNORMALIZOWANEJ sygnaturze (`sygnatura_norm`): upper-case,
 * collapsed whitespace, single slashes, abbreviation dots stripped, two-
 * digit year (po `displaySignature` + `stripDiacritics`).
 */

import type { Instancja } from "./types.js";

/**
 * Lista wydziałów SN.  Najczęstsze cywilne (CSK, CSKP), karne (KK, KSK,
 * KZS, KO), pracy/ubezpieczeń (UK, UKS), zagadnienia prawne (ZP).
 * Lista nie jest wyczerpująca — to dominujące wzorce.
 */
const SN_DEPT = ["CSK", "CSKP", "UK", "UKS", "KK", "KSK", "KO", "KZS", "ZP"];

/** Wydziały NSA (administracyjne). */
const NSA_DEPT = ["FSK", "GSK", "OSK", "FZ", "OZ"];

/** Wydziały TK (konstytucyjne).  K = kontrola abstr., SK = skarga konst. */
const TK_DEPT = ["K", "SK", "U", "P", "TW", "KP", "PP", "TS"];

/**
 * Skompilowane regexy — pre-budowane, by `detectLikelyInstancja` dało
 * mikrosekundowe odpowiedzi.
 */
const RE_SN = new RegExp(`^[IVX]+\\s+(${SN_DEPT.join("|")})\\s+\\d+/\\d{2}$`);
const RE_NSA = new RegExp(`^[IVX]+\\s+(${NSA_DEPT.join("|")})\\s+\\d+/\\d{2}$`);
const RE_TK = new RegExp(`^(${TK_DEPT.join("|")})\\s+\\d+/\\d{2}$`);
// Court of Justice of the EU: C-XXX/YY (judgments), T-XXX/YY (General
// Court), opcjonalny suffix " P" dla appeal cases.
const RE_TSUE = /^[CT]-\d+\/\d{2}(\s+P)?$/;

/**
 * Zwraca prawdopodobną instancję dla SYGNATURY, albo `null` gdy żaden
 * wzorzec nie pasuje (sygnatura wygląda na SR/SO/SA lub coś nietypowego).
 *
 * UWAGA: input musi być już znormalizowany (`normaliseSignature(...)`).
 * Funkcja nie wykonuje normalizacji sama, żeby caller nie płacił dwa razy.
 */
export function detectLikelyInstancja(sygnaturaNorm: string): Instancja | null {
  if (!sygnaturaNorm) return null;
  if (RE_SN.test(sygnaturaNorm)) return "SN";
  if (RE_NSA.test(sygnaturaNorm)) return "NSA";
  if (RE_TSUE.test(sygnaturaNorm)) return "TSUE";
  if (RE_TK.test(sygnaturaNorm)) return "TK";
  return null;
}
