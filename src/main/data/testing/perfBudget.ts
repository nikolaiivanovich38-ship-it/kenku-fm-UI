/**
 * Time budgets for the performance tests. The budgets are the product's (a turn of the main process over 200 ms
 * lets Discord's audio queue run dry) and hold as stated on the 2-core build machine, where the release checks run.
 * GitHub's runners measure the tests with coverage instrumentation on shared processors, about two to three times
 * slower; there CI sets CUE_DESK_PERF_SLACK (see .github/workflows/ci.yml), which multiplies every budget. It still
 * fails a change that makes the work several times slower, and it never makes a budget tighter.
 */
export function slackFrom(value: string | undefined): number {
  const slack = Number(value);
  return Number.isFinite(slack) && slack > 1 ? slack : 1;
}

export const PERF_SLACK = slackFrom(process.env.CUE_DESK_PERF_SLACK);

/** `ms`, multiplied by CUE_DESK_PERF_SLACK where it is set. */
export const budget = (ms: number): number => ms * PERF_SLACK;
