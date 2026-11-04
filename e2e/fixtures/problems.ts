/**
 * What counts as a problem while the app runs under test. Kept free of
 * Playwright so the rules are easy to read.
 */

export type ConsoleEntry = { page: string; type: string; text: string };

/** Everything collected while the app ran, by where it came from. */
export type CollectedErrors = {
  /** Uncaught exceptions in any page (main window, player view, capture window, website tabs). */
  pageErrors: { page: string; message: string }[];
  /** Console errors and warnings from every page. */
  console: ConsoleEntry[];
  /** Every line the main process wrote to stdout or stderr. */
  mainLog: string[];
  /**
   * Console errors a test causes on purpose (for example a refused Discord
   * token). Matching errors are not reported; CSP and IPC-guard messages
   * always are.
   */
  ignoredConsole: RegExp[];
  /**
   * Security refusals a test provokes on purpose in a page that is not one
   * of the app's own (for example a local file probing what it may read).
   * A console entry is let through only when both its page address and its
   * text match; refusals in the app's own pages are always reported.
   */
  expectedRefusals: { page: RegExp; text: RegExp }[];
};

/** Main-process lines that mean something went badly wrong. */
export const MAIN_PROCESS_FAILURE =
  /Uncaught Exception|A JavaScript error occurred in the main process|UnhandledPromiseRejection|Unhandled promise rejection|FATAL:/;

/**
 * Messages that mean a security rule blocked the app's own work: a
 * Content-Security-Policy violation (SEC-11; Chromium words these either
 * "Refused to load …" or "… violates the following Content Security Policy
 * directive …"), a message dropped by the IPC guard ("Ignored a … message",
 * SEC-8), or a view or page the main process refused to create or load.
 */
export const SECURITY_REFUSAL =
  /Refused to |violates the following Content Security Policy directive|Ignored a \S+ message/;

/** Plain-language list of problems; empty when the run was clean. */
export function findProblems(errors: CollectedErrors): string[] {
  const problems: string[] = [];
  for (const error of errors.pageErrors) {
    problems.push(`uncaught error in ${error.page}: ${error.message}`);
  }
  for (const line of errors.mainLog) {
    if (MAIN_PROCESS_FAILURE.test(line) || SECURITY_REFUSAL.test(line)) {
      problems.push(`main process: ${line}`);
    }
  }
  for (const entry of errors.console) {
    const expected = errors.expectedRefusals.some(
      (refusal) => refusal.page.test(entry.page) && refusal.text.test(entry.text),
    );
    if (expected) {
      continue;
    }
    if (SECURITY_REFUSAL.test(entry.text)) {
      problems.push(`console ${entry.type} in ${entry.page}: ${entry.text}`);
    } else if (entry.type === "error" && !errors.ignoredConsole.some((pattern) => pattern.test(entry.text))) {
      problems.push(`console error in ${entry.page}: ${entry.text}`);
    }
  }
  return problems;
}
