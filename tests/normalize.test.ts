import { describe, expect, it } from "vitest";
import {
  buildRulingId,
  normaliseSignature,
  signaturesMatch,
  stripDiacritics,
  stripLightHtml,
} from "../src/normalize.js";

describe("stripDiacritics", () => {
  it("strips Polish marks", () => {
    expect(stripDiacritics("Ąćęłńóśźż")).toBe("Acelnoszz");
  });
  it("leaves ASCII untouched", () => {
    expect(stripDiacritics("Hello, world!")).toBe("Hello, world!");
  });
});

describe("normaliseSignature", () => {
  const cases: Array<[string, string]> = [
    ["II CSK 123/22", "II_CSK_123_22"],
    ["ii  csk 123 / 22", "II_CSK_123_22"],
    ["C-123/22", "C_123_22"],
    ["C-123/22 P", "C_123_22_P"],
    ["ECLI:EU:C:2023:1", "ECLI_EU_C_2023_1"],
    ["Łeb/ąć", "LEB_AC"],
  ];
  for (const [input, expected] of cases) {
    it(`'${input}' → '${expected}'`, () => {
      expect(normaliseSignature(input)).toBe(expected);
    });
  }
});

describe("signaturesMatch", () => {
  it("is whitespace-insensitive", () => {
    expect(signaturesMatch("II CSK 123/22", "ii csk 123 / 22")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(signaturesMatch("c-123/22", "C-123/22")).toBe(true);
  });
  it("returns false for distinct cases", () => {
    expect(signaturesMatch("II CSK 123/22", "II CSK 124/22")).toBe(false);
  });
});

describe("buildRulingId", () => {
  it("prefixes with lowercase source", () => {
    expect(buildRulingId("SN", "II CSK 123/22")).toBe("sn-II_CSK_123_22");
    expect(buildRulingId("CJEU", "C-123/22")).toBe("cjeu-C_123_22");
  });
});

describe("stripLightHtml", () => {
  it("removes paragraph + emphasis tags", () => {
    expect(stripLightHtml("<p>foo <em>bar</em></p>")).toBe("foo bar");
  });
  it("decodes basic entities", () => {
    expect(stripLightHtml("Lex &amp; Iustitia &lt;3")).toBe("Lex & Iustitia <3");
  });
  it("collapses excess blank lines", () => {
    expect(stripLightHtml("<p>a</p><p>b</p>")).toBe("a\n\nb");
  });
});
