import { describe, expect, it } from "vitest";
import {
  displaySignature,
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

describe("displaySignature", () => {
  const cases: Array<[string, string]> = [
    ["II CSK 123/22", "II CSK 123/22"],
    ["ii  csk 123 / 22", "II CSK 123/22"],
    ["II  c.s.k.   822/22", "II CSK 822/22"],
    ["I C 822 / 22", "I C 822/22"],
    ["C-311/18 P", "C-311/18 P"],
  ];
  for (const [input, expected] of cases) {
    it(`'${input}' → '${expected}'`, () => {
      expect(displaySignature(input)).toBe(expected);
    });
  }
});

describe("normaliseSignature", () => {
  it("matches the display form when ASCII", () => {
    expect(normaliseSignature("II CSK 123/22")).toBe("II CSK 123/22");
  });
  it("strips diacritics for matching", () => {
    // Synthetic — signatures rarely contain marks but we don't want to silently miss
    expect(normaliseSignature("Łeb/Ąć")).toBe("LEB/AC");
  });
});

describe("signaturesMatch", () => {
  it("is whitespace + case + dot insensitive", () => {
    expect(signaturesMatch("II CSK 123/22", "ii  c.s.k. 123 / 22")).toBe(true);
  });
  it("distinguishes different signatures", () => {
    expect(signaturesMatch("II CSK 123/22", "II CSK 124/22")).toBe(false);
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
