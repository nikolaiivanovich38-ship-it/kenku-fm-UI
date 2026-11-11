import { describe, expect, it } from "vitest";

import { REMOTE_CODE_ALPHABET, REMOTE_CODE_PATTERN, codesMatch, generateRemoteCode, normaliseRemoteCode } from "./remoteCode";

describe("the remote control's secret code (SEC-4, lead decision 7 Nov: 8 characters)", () => {
  it("is two groups of four letters and digits that cannot be mistaken for each other", () => {
    const code = generateRemoteCode();
    expect(code).toMatch(REMOTE_CODE_PATTERN);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // No 0 or O, no 1, I or L: Nik types it on a phone, reading it off the screen.
    expect(code).not.toMatch(/[01OIL]/);
  });

  it("uses an alphabet of 31 symbols with none that look alike", () => {
    expect(REMOTE_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(REMOTE_CODE_ALPHABET).size).toBe(31);
    expect(REMOTE_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("is different every time", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRemoteCode()));
    expect(codes.size).toBe(200);
  });

  it("takes each symbol from the random numbers it is given, first to last", () => {
    expect(generateRemoteCode(() => 0)).toBe("AAAA-AAAA");
    expect(generateRemoteCode(() => 30)).toBe("9999-9999");
    let i = 0;
    expect(generateRemoteCode(() => i++)).toBe("ABCD-EFGH");
  });

  it("asks for a whole number below the alphabet's size, so every symbol is as likely (no modulo bias)", () => {
    const asked: number[] = [];
    generateRemoteCode((below) => {
      asked.push(below);
      return 0;
    });
    expect(asked).toEqual(Array(8).fill(31));
  });

  it("matches a code typed in lower case, without the dash or with spaces", () => {
    const code = "K7QD-92XF";
    for (const typed of ["k7qd-92xf", "K7QD92XF", " K7QD 92XF ", "k7qd 92xf"]) {
      expect(codesMatch(typed, code), typed).toBe(true);
    }
    expect(normaliseRemoteCode("k7-qd 92xf")).toBe("K7QD92XF");
  });

  it("refuses any other code, an empty one and one of another length", () => {
    const code = "K7QD-92XF";
    expect(codesMatch("K7QD-92XE", code)).toBe(false);
    expect(codesMatch("", code)).toBe(false);
    expect(codesMatch("K7QD", code)).toBe(false);
    expect(codesMatch(`${code}A`, code)).toBe(false);
    expect(codesMatch(code, "")).toBe(false);
  });
});
