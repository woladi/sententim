import { describe, expect, it } from "vitest";
import { extractSignatureRefs } from "../scripts/etl/parsers/cross-ref.js";

describe("extractSignatureRefs", () => {
  it("returns [] for empty input", () => {
    expect(extractSignatureRefs(null)).toEqual([]);
    expect(extractSignatureRefs("")).toEqual([]);
  });

  it("extracts a signature after 'sygn. akt'", () => {
    const text = "po rozpoznaniu sprawy z powództwa X o sygn. akt I C 822/22 Sąd uznał, że...";
    const refs = extractSignatureRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.signature).toBe("I C 822/22");
    expect(refs[0]?.normalised).toBe("I C 822/22");
  });

  it("extracts multiple distinct signatures", () => {
    const text = `
      uchyla wyrok Sądu Rejonowego o sygn. akt I C 100/22 z dnia 5 maja 2022 r.
      oraz wyrok Sądu Okręgowego o sygn. akt VII Ca 250/23 z dnia 1 lipca 2023 r.
    `;
    const refs = extractSignatureRefs(text);
    const sigs = refs.map((r) => r.signature).sort();
    expect(sigs).toEqual(["I C 100/22", "VII Ca 250/23"]);
  });

  it("dedupes repeated mentions", () => {
    const text =
      "sygn. akt II C 5/21 a następnie ponownie sygn. akt II C 5/21 i jeszcze raz sygn. akt II C 5/21";
    const refs = extractSignatureRefs(text);
    expect(refs).toHaveLength(1);
  });

  it("does NOT extract a signature far from 'sygn. akt'", () => {
    // The signature appears more than 400 chars after sygn. akt — should be missed.
    const filler = ".".repeat(500);
    const text = `sygn. akt ${filler} I C 100/22`;
    expect(extractSignatureRefs(text)).toEqual([]);
  });

  it("handles 'sygn akt' without dot", () => {
    const text = "sygn akt III C 1/20 z dnia 5 stycznia 2020";
    const refs = extractSignatureRefs(text);
    expect(refs[0]?.signature).toBe("III C 1/20");
  });

  it("ignores prose numbers that look like dates or amounts", () => {
    const text = "wynagrodzenie 5000/22 zł i koszty";
    expect(extractSignatureRefs(text)).toEqual([]);
  });
});
