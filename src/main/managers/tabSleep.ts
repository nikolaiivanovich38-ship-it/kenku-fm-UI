/**
 * PERF-5: put hidden website tabs to sleep.
 *
 * Every website tab is captured for Discord, and Chromium treats a captured
 * page as visible even after the tab is hidden, so its timers and animations
 * keep running at full speed. Chromium also refuses to freeze a captured page
 * (Page Lifecycle "frozen" has no effect while the capture runs), so a
 * sleeping tab is slowed down instead: BrowserViewManagerMain limits its
 * processor use (both probed on Electron 44 during WP2). This module decides
 * when a tab may sleep.
 *
 * A tab sleeps when it has been hidden, silent and without playing media for
 * the whole delay. A tab that plays sound is never put to sleep, because its
 * sound is being sent to Discord. A short quiet moment (between two videos,
 * a quiet passage) restarts the count rather than sending the tab to sleep.
 * Showing the tab wakes it.
 *
 * Free of Electron imports so the rules can be unit-tested.
 */

/** How long a hidden tab has to stay silent before it sleeps. */
export const SLEEP_AFTER_SILENT_MS = 60_000;

/**
 * The delay to use. Test builds (CUE_DESK_E2E_BUILD=1) may shorten it with
 * CUE_DESK_TAB_SLEEP_MS so end-to-end tests do not wait a minute; release
 * builds ignore the variable.
 */
export function sleepDelay(env: Record<string, string | undefined>, isTestBuild: boolean): number {
  const override = Number(env.CUE_DESK_TAB_SLEEP_MS);
  if (isTestBuild && Number.isInteger(override) && override > 0) {
    return override;
  }
  return SLEEP_AFTER_SILENT_MS;
}

export interface SleepActions {
  sleep(id: number): void;
  wake(id: number): void;
}

interface TabState {
  hidden: boolean;
  audible: boolean;
  playingMedia: number;
  asleep: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class TabSleep {
  private readonly tabs = new Map<number, TabState>();

  constructor(
    private readonly actions: SleepActions,
    private readonly delayMs: number = SLEEP_AFTER_SILENT_MS,
  ) {}

  /** Start looking after a website or file tab. Tabs start visible. The player is never tracked. */
  track(id: number): void {
    this.tabs.set(id, { hidden: false, audible: false, playingMedia: 0, asleep: false });
  }

  forget(id: number): void {
    const tab = this.tabs.get(id);
    if (tab?.timer) {
      clearTimeout(tab.timer);
    }
    this.tabs.delete(id);
  }

  hidden(id: number): void {
    this.update(id, (tab) => {
      tab.hidden = true;
    });
  }

  shown(id: number): void {
    this.update(id, (tab) => {
      tab.hidden = false;
    });
  }

  /** Chromium's "audio-state-changed": the tab started or stopped making sound. */
  audible(id: number, audible: boolean): void {
    this.update(id, (tab) => {
      tab.audible = audible;
    });
  }

  mediaStarted(id: number): void {
    this.update(id, (tab) => {
      tab.playingMedia += 1;
    });
  }

  mediaPaused(id: number): void {
    this.update(id, (tab) => {
      tab.playingMedia = Math.max(tab.playingMedia - 1, 0);
    });
  }

  isAsleep(id: number): boolean {
    return this.tabs.get(id)?.asleep ?? false;
  }

  private update(id: number, change: (tab: TabState) => void): void {
    const tab = this.tabs.get(id);
    if (!tab) {
      return;
    }
    change(tab);
    if (tab.timer) {
      clearTimeout(tab.timer);
      tab.timer = undefined;
    }
    const mayRun = !tab.hidden || tab.audible || tab.playingMedia > 0;
    if (mayRun) {
      if (tab.asleep) {
        tab.asleep = false;
        this.actions.wake(id);
      }
      return;
    }
    if (!tab.asleep) {
      tab.timer = setTimeout(() => {
        tab.timer = undefined;
        tab.asleep = true;
        this.actions.sleep(id);
      }, this.delayMs);
    }
  }
}
