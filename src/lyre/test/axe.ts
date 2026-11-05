/**
 * Accessibility check for component tests: axe-core 4.14.0 with the WCAG 2.2 A and AA rules, the same tags the
 * acceptance sweeps use (e2e/specs/sweeps.spec.ts). jsdom draws nothing, so colour contrast is left to the sweeps.
 */
import axe from "axe-core";
import { expect } from "vitest";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Fails the test with one line per broken rule. */
export async function expectNoAxeViolations(root: Element = document.body): Promise<void> {
  const result = await axe.run(root, {
    runOnly: { type: "tag", values: TAGS },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  const lines = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(lines).toEqual([]);
}
