/**
 * UX-19 (round 6 part 5, design/prototype/ROUND6.md "The standard"): the rules of the one Saved pop-up, without the
 * page. The prototype's showNote (core.js): one pop-up at a time; the same save again within 2 s refreshes it (its
 * timer restarts, the tick pulses) and is not read out again; nor is a note that follows an announcement of the same
 * event within half a second (Could 14 of the round 6 review), nor an announcement that follows a note read out
 * within half a second (UX-R6 of the 0.5.0 review): one event, one message, whichever comes first.
 */

/** How long a note stays: 3 s, longer text up to 6 s. */
export const NOTE_MS = 3000;
export const NOTE_MAX_MS = 6000;
const MS_PER_CHARACTER = 55;
/** The same save again within this refreshes the one pop-up. */
export const MERGE_MS = 2000;
/** A note this soon after an announcement is shown but not read out again. */
export const QUIET_AFTER_SAY_MS = 500;

/** "Saved: <what>", with " · <detail>" after it when given. */
export function savedText(what: string, detail?: string): string {
  return `Saved: ${what}${detail ? ` · ${detail}` : ""}`;
}

export function noteDuration(text: string): number {
  return Math.min(NOTE_MAX_MS, Math.max(NOTE_MS, text.length * MS_PER_CHARACTER));
}

export interface ShowRule {
  /** The pop-up already shows this save: refresh it (pulse, restart its timer) instead of a new one. */
  refresh: boolean;
  /** Screen readers read it (it is not a refresh, nor just announced). */
  readOut: boolean;
}

export class NoteRules {
  private key: string | null = null;
  private at = 0;
  private saidAt = Number.NEGATIVE_INFINITY;
  private readAt = Number.NEGATIVE_INFINITY;

  /** Something is to be announced (Announcer.say) at `now`. False: a note was just read out for it, so stay quiet. */
  said(now: number): boolean {
    if (now - this.readAt < QUIET_AFTER_SAY_MS) return false;
    this.saidAt = now;
    return true;
  }

  /** A note with this key shows at `now`. */
  show(key: string, now: number): ShowRule {
    const refresh = this.key === key && now - this.at < MERGE_MS;
    this.key = key;
    this.at = now;
    const readOut = !refresh && now - this.saidAt >= QUIET_AFTER_SAY_MS;
    if (readOut) this.readAt = now;
    return { refresh, readOut };
  }

  /** The pop-up went (its time was up). */
  hidden(): void {
    this.key = null;
  }
}
