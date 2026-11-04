/**
 * UX finding 6: the window shows a live countdown to a bot's next automatic
 * reconnect attempt. DiscordBot says "Trying again in 4 s…" when it starts
 * waiting; this notes the moment each such wait starts (the text changes
 * from one attempt to the next, as every wait in RECONNECT_DELAYS_MS is
 * longer than the one before) and turns it into the time the attempt is due.
 */
const WAIT_TEXT = /Trying again in (\d+) s/;

export class RetryClock {
  private waits = new Map<string, { text: string; retryAt: number }>();

  /**
   * Note the current reason for a bot or one of its voice connections.
   * @returns when the next attempt is due, or undefined when not waiting
   */
  update(key: string, reason: string | undefined, now = Date.now()): number | undefined {
    const seconds = reason ? WAIT_TEXT.exec(reason)?.[1] : undefined;
    if (!reason || seconds === undefined) {
      this.waits.delete(key);
      return undefined;
    }
    const known = this.waits.get(key);
    if (known?.text === reason) {
      return known.retryAt;
    }
    const retryAt = now + Number(seconds) * 1000;
    this.waits.set(key, { text: reason, retryAt });
    return retryAt;
  }

  /** The due time noted for `key`, if it is waiting. */
  get(key: string): number | undefined {
    return this.waits.get(key)?.retryAt;
  }

  /** Forget one bot's voice connections except `keep`, or the whole bot (it was removed). */
  forget(botId: string, keep?: string[]): void {
    for (const key of [...this.waits.keys()]) {
      const voiceKey = key.startsWith(`${botId}:`);
      if (keep ? voiceKey && !keep.includes(key) : key === botId || voiceKey) {
        this.waits.delete(key);
      }
    }
  }
}
