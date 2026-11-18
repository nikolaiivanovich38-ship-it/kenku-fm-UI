/** Item 51 (Nik, 14 Nov: 10:00 in the track list, 9:59 in Now playing): one rule for every length and time. */
import { describe, expect, it } from "vitest";
import { clockTime, lengthText } from "./text";

describe("clockTime and lengthText: one rounding rule", () => {
  it("rounds to the nearest whole second, the same for a length and a time", () => {
    expect(clockTime(599.4)).toBe("9:59");
    expect(clockTime(599.5)).toBe("10:00");
    expect(lengthText(599_500)).toBe(clockTime(599.5));
    expect(lengthText(600_000)).toBe("10:00");
    expect(lengthText(0)).toBe("0:00");
    expect(lengthText(-50)).toBe("0:00");
  });

  it("writes an hour or more as h:mm:ss", () => {
    expect(clockTime(3599.4)).toBe("59:59");
    expect(clockTime(3600)).toBe("1:00:00");
    expect(lengthText(3_725_000)).toBe("1:02:05");
  });
});
