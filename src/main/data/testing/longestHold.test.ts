import { describe, expect, it } from "vitest";
import { longestHold } from "./longestHold";

const spin = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Hold the thread, as a long synchronous batch would.
  }
};
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("longestHold", () => {
  it("counts a synchronous call for its whole length", async () => {
    const { cpu, wall } = await longestHold(() => spin(120));
    expect(cpu).toBeGreaterThanOrEqual(100);
    expect(wall).toBeGreaterThanOrEqual(120);
  });

  it("counts work that yields between batches by its longest batch", async () => {
    const { cpu } = await longestHold(async () => {
      for (let i = 0; i < 6; i++) {
        spin(20);
        await yieldTurn();
      }
    });
    expect(cpu).toBeLessThan(80);
  });

  it("does not count time the thread spends waiting", async () => {
    const { cpu } = await longestHold(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(cpu).toBeLessThan(50);
  });
});
