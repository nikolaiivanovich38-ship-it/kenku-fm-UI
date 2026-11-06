import { describe, expect, it } from "vitest";

import { REMOTE_CODE_PATTERN, codesMatch, generateRemoteCode, normaliseRemoteCode } from "./remoteCode";

describe("the remote control's secret code (SEC-4)", () => {
  it("is five groups of four letters and digits that are easy to read and type", () => {
    const code = generateRemoteCode();
    expect(code).toMatch(REMOTE_CODE_PATTERN);
    // No I, L, O or U: they are read as 1, 1, 0 or misread as V.
    expect(code).not.toMatch(/[ILOU]/);
  });

  it("is different every time (100 random bits)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRemoteCode()));
    expect(codes.size).toBe(200);
  });

  it("uses every random byte it is given", () => {
    const zeros = generateRemoteCode(() => Buffer.alloc(13));
    const ones = generateRemoteCode(() => Buffer.alloc(13, 0xff));
    expect(zeros).toBe("0000-0000-0000-0000-0000");
    expect(ones).toBe("ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  });

  it("matches a code typed in lower case, without dashes, with spaces or with O for 0 and I or L for 1", () => {
    const code = "AB01-CD23-EF45-GH67-JK89";
    for (const typed of ["ab01-cd23-ef45-gh67-jk89", "AB01CD23EF45GH67JK89", " AB01 CD23 EF45 GH67 JK89 ", "ABO1-CD23-EF45-GH67-JK89", "ABOI-CD23-EF45-GH67-JK89", "AB0L-CD23-EF45-GH67-JK89"]) {
      expect(codesMatch(typed, code), typed).toBe(true);
    }
    expect(normaliseRemoteCode("ab-0i")).toBe("AB01");
  });

  it("refuses any other code, an empty one and one of another length", () => {
    const code = "AB01-CD23-EF45-GH67-JK89";
    expect(codesMatch("AB01-CD23-EF45-GH67-JK88", code)).toBe(false);
    expect(codesMatch("", code)).toBe(false);
    expect(codesMatch("AB01", code)).toBe(false);
    expect(codesMatch(`${code}0`, code)).toBe(false);
    expect(codesMatch(code, "")).toBe(false);
  });
});
