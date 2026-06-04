import { describe, expect, it } from "vitest";
import { extractPodstawaPrawna } from "../scripts/etl/parsers/podstawa-prawna.js";
import { canonicalSadName, resolveInstancja } from "../scripts/etl/parsers/sad-instancja.js";
import { classifySentencja } from "../scripts/etl/parsers/sentencja-typ.js";
import { detectLikelyInstancja } from "../src/instancja-pattern.js";
import { normaliseSignature, stemPolishPhrase, stemPolishWord } from "../src/normalize.js";

describe("classifySentencja", () => {
  it("returns null for empty input", () => {
    expect(classifySentencja("")).toBeNull();
    expect(classifySentencja(null)).toBeNull();
    expect(classifySentencja(undefined)).toBeNull();
  });

  it("classifies 'oddala apelację'", () => {
    expect(classifySentencja("Sąd Okręgowy oddala apelację pozwanego")).toBe("oddala");
  });

  it("classifies 'oddala powództwo'", () => {
    expect(classifySentencja("oddala powództwo w całości")).toBe("oddala");
  });

  it("classifies 'uwzględnia apelację'", () => {
    expect(classifySentencja("uwzględnia apelację powoda")).toBe("uwzglednia");
  });

  it("classifies 'uchyla ... przekazuje' as uchyla_przekazuje", () => {
    expect(
      classifySentencja(
        "uchyla zaskarżony wyrok w punkcie I i przekazuje sprawę do ponownego rozpoznania",
      ),
    ).toBe("uchyla_przekazuje");
  });

  it("classifies 'zmienia zaskarżony wyrok'", () => {
    expect(classifySentencja("zmienia zaskarżony wyrok w ten sposób, że")).toBe("zmienia");
  });

  it("classifies 'umarza postępowanie'", () => {
    expect(classifySentencja("umarza postępowanie z uwagi na cofnięcie")).toBe("umarza");
  });

  it("returns null when no rule matches", () => {
    expect(classifySentencja("dnia 15 września 2022 r. po rozpoznaniu")).toBeNull();
  });

  it("prioritises uchyla_przekazuje over oddala in compound rulings", () => {
    expect(
      classifySentencja(
        "uchyla zaskarżony wyrok w części I i przekazuje sprawę; w pozostałej części oddala apelację",
      ),
    ).toBe("uchyla_przekazuje");
  });
});

describe("extractPodstawaPrawna", () => {
  it("returns empty array for no text", () => {
    expect(extractPodstawaPrawna(null)).toEqual([]);
    expect(extractPodstawaPrawna("")).toEqual([]);
  });

  it("extracts art. 45 ukk in canonical form", () => {
    expect(extractPodstawaPrawna("art. 45 ustawy o kredycie konsumenckim")).toContain(
      "art. 45 ukk",
    );
  });

  it("extracts art. 75c pr.bank", () => {
    expect(extractPodstawaPrawna("art. 75c prawa bankowego")).toContain("art. 75c pr.bank");
  });

  it("extracts art. X k.c.", () => {
    expect(extractPodstawaPrawna("zgodnie z art. 5 kodeksu cywilnego")).toContain("art. 5 k.c.");
  });

  it("dedupes repeated mentions", () => {
    const out = extractPodstawaPrawna(
      "art. 45 ustawy o kredycie konsumenckim oraz ponownie art. 45 ustawy o kredycie konsumenckim",
    );
    expect(out.filter((s) => s === "art. 45 ukk")).toHaveLength(1);
  });

  it("returns a sorted unique array", () => {
    const out = extractPodstawaPrawna(
      "art. 75c prawa bankowego, art. 45 ustawy o kredycie konsumenckim",
    );
    expect(out).toEqual([...out].sort());
  });

  it("ignores articles without a known act", () => {
    expect(extractPodstawaPrawna("art. 42 jakiejś nieznanej ustawy")).toEqual([]);
  });
});

describe("resolveInstancja", () => {
  it("maps SUPREME directly to SN", () => {
    expect(resolveInstancja({ courtType: "SUPREME", courtName: null })).toBe("SN");
  });
  it("maps Constitutional Tribunal to TK", () => {
    expect(resolveInstancja({ courtType: "CONSTITUTIONAL_TRIBUNAL", courtName: null })).toBe("TK");
  });
  it("maps common-court name 'Sąd Rejonowy' to SR", () => {
    expect(resolveInstancja({ courtType: "COMMON", courtName: "Sąd Rejonowy w Olsztynie" })).toBe(
      "SR",
    );
  });
  it("maps common-court name 'Sąd Okręgowy' to SO", () => {
    expect(resolveInstancja({ courtType: "COMMON", courtName: "Sąd Okręgowy w Warszawie" })).toBe(
      "SO",
    );
  });
  it("maps common-court name 'Sąd Apelacyjny' to SA", () => {
    expect(resolveInstancja({ courtType: "COMMON", courtName: "Sąd Apelacyjny w Krakowie" })).toBe(
      "SA",
    );
  });
  it("maps NSA / WSA", () => {
    expect(
      resolveInstancja({ courtType: "ADMINISTRATIVE", courtName: "Naczelny Sąd Administracyjny" }),
    ).toBe("NSA");
    expect(
      resolveInstancja({
        courtType: "ADMINISTRATIVE",
        courtName: "Wojewódzki Sąd Administracyjny w Krakowie",
      }),
    ).toBe("WSA");
  });
  it("returns null for unknown common-court names", () => {
    expect(resolveInstancja({ courtType: "COMMON", courtName: "Mystery Court" })).toBeNull();
  });
});

describe("canonicalSadName", () => {
  it("uses provided court name", () => {
    expect(canonicalSadName({ courtType: "COMMON", courtName: "Sąd Rejonowy w Olsztynie" })).toBe(
      "Sąd Rejonowy w Olsztynie",
    );
  });
  it("falls back to 'Sąd Najwyższy' for SUPREME with no name", () => {
    expect(canonicalSadName({ courtType: "SUPREME", courtName: null })).toBe("Sąd Najwyższy");
  });
});

describe("stemPolishWord", () => {
  it("drops a trailing nominative vowel when word ≥ 5 chars", () => {
    expect(stemPolishWord("Warszawa")).toBe("Warszaw");
    expect(stemPolishWord("Gdynia")).toBe("Gdyni");
    expect(stemPolishWord("apelacyjny")).toBe("apelacyjn");
  });
  it("leaves short words alone", () => {
    expect(stemPolishWord("Pisz")).toBe("Pisz");
    expect(stemPolishWord("Toruń")).toBe("Toruń");
  });
  it("leaves consonant-ending words alone", () => {
    expect(stemPolishWord("Olsztyn")).toBe("Olsztyn");
    expect(stemPolishWord("Wrocław")).toBe("Wrocław");
  });
});

describe("stemPolishPhrase", () => {
  it("stems each token", () => {
    expect(stemPolishPhrase("Sąd Apelacyjny")).toBe("Sąd Apelacyjn");
    expect(stemPolishPhrase("Sąd Rejonowy")).toBe("Sąd Rejonow");
  });
  it("collapses whitespace", () => {
    expect(stemPolishPhrase("  Warszawa  ")).toBe("Warszaw");
  });
});

describe("detectLikelyInstancja", () => {
  const cases: Array<[string, ReturnType<typeof detectLikelyInstancja>]> = [
    // SN — Sąd Najwyższy
    ["II CSK 750/15", "SN"],
    ["IV CSKP 95/21", "SN"],
    ["I UK 100/22", "SN"],
    ["III KK 50/20", "SN"],
    ["III KSK 5/19", "SN"],
    ["I KZS 12/24", "SN"],
    // TSUE — Court of Justice of the EU
    ["C-487/21", "TSUE"],
    ["T-100/22", "TSUE"],
    ["C-311/18 P", "TSUE"],
    // NSA — Naczelny Sąd Administracyjny
    ["II FSK 100/24", "NSA"],
    ["I GSK 50/22", "NSA"],
    ["II OSK 200/21", "NSA"],
    // TK — Trybunał Konstytucyjny
    ["K 12/20", "TK"],
    ["SK 5/22", "TK"],
    ["U 1/19", "TK"],
    // Common courts — should NOT match (returns null)
    ["I C 822/22", null],
    ["VII Ca 100/24", null],
    ["I ACa 50/24", null],
    ["XV Cz 99/20", null],
    // Random text — should NOT match
    ["foo bar", null],
    ["", null],
  ];
  for (const [sig, expected] of cases) {
    it(`'${sig}' → ${expected ?? "null"}`, () => {
      // detectLikelyInstancja expects the normalised form
      expect(detectLikelyInstancja(normaliseSignature(sig))).toBe(expected);
    });
  }
});
