import { describe, expect, it } from "vitest";

import { slackFrom } from "./perfBudget";

describe("performance budgets on slower machines", () => {
  it("are the stated budgets unless CUE_DESK_PERF_SLACK says otherwise", () => {
    expect(slackFrom(undefined)).toBe(1);
    expect(slackFrom("3")).toBe(3);
  });

  it("never tighten below the stated budget, and ignore a value that is not a number", () => {
    expect(slackFrom("0.5")).toBe(1);
    expect(slackFrom("fast")).toBe(1);
  });
});
