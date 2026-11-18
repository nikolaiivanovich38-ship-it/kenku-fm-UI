/** Item 51: every screen writes lengths and times with the one helper in common/lyre/text.ts, so they agree. */
import { describe, expect, it } from "vitest";
import { lengthText } from "../common/lyre/text";
import { fmt, fmtLong } from "./screens/library/model";
import { clockTime as barClock } from "./shell/NowPlayingBar";
import { fmt as profileFmt } from "./screens/profile/profileModel";
import { formatLength } from "./screens/campaigns/model";

describe("lengths agree on every screen (item 51)", () => {
  it("is the helper the screens use (no screen keeps its own rounding)", () => {
    for (const ms of [0, 1499, 1500, 59_500, 599_400, 599_500, 3_725_000]) {
      expect(fmt(ms)).toBe(lengthText(ms));
      expect(fmtLong(ms)).toBe(lengthText(ms));
      expect(formatLength(ms)).toBe(lengthText(ms));
      expect(barClock(ms / 1000)).toBe(lengthText(ms));
      expect(profileFmt(ms / 1000)).toBe(lengthText(ms));
    }
  });
});
