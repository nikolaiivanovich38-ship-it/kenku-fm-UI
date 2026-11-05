/**
 * w4-outputs: outputs for screen tests, on the prototype's Discord (design/prototype/src/data.js): two servers, six
 * voice channels with their people, Lyre Table in Table and Lyre Side in no room, both at 85 %. A move joins
 * ("joining") and connects a moment later, as Discord does; `settle()` waits for that. Every call is recorded.
 */
import type { LyreBot, LyreOutputs } from "../../../common/lyreOutputs";
import type { OutputsClient } from "../OutputsProvider";

export const TABLE_BOT = "bot-00000000-0000-4000-8000-000000000001";
export const SIDE_BOT = "bot-00000000-0000-4000-8000-000000000002";

export const PROTOTYPE_OUTPUTS: LyreOutputs = {
  bots: [
    { id: TABLE_BOT, name: "Lyre Table", login: "ready", room: { serverId: "1001", channelId: "1011", status: "connected" }, muted: false, volume: 0.85, serverIds: ["1001", "1002"] },
    { id: SIDE_BOT, name: "Lyre Side", login: "ready", room: null, muted: false, volume: 0.85, serverIds: ["1001", "1002"] },
  ],
  servers: [
    {
      id: "1001",
      name: "The Gull and Lantern",
      channels: [
        { id: "1011", name: "Table", members: ["Nik", "Aster", "Bram", "Corin", "Dalia"] },
        { id: "1012", name: "Side room", members: [] },
        { id: "1013", name: "Whispers", members: [] },
        { id: "1014", name: "AFK", members: ["Ezra"] },
      ],
    },
    {
      id: "1002",
      name: "Night court",
      channels: [
        { id: "1021", name: "Elysium", members: [] },
        { id: "1022", name: "Private audience", members: [] },
      ],
    },
  ],
};

const JOIN_MS = 5;

export class FakeOutputs implements OutputsClient {
  state: LyreOutputs;
  calls: [string, ...unknown[]][] = [];
  private readonly listeners = new Set<(outputs: LyreOutputs) => void>();
  private pending: Promise<void>[] = [];

  constructor(start: LyreOutputs = PROTOTYPE_OUTPUTS) {
    this.state = JSON.parse(JSON.stringify(start)) as LyreOutputs;
  }

  async get(): Promise<LyreOutputs> {
    return this.state;
  }

  onState(listener: (outputs: LyreOutputs) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replace the state, as a push from the main process. */
  push(state: LyreOutputs): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  move(botId: string, channelId: string): void {
    this.calls.push(["move", botId, channelId]);
    const server = this.state.servers.find((s) => s.channels.some((c) => c.id === channelId));
    if (!server) return;
    this.change(botId, { room: { serverId: server.id, channelId, status: "joining" } });
    this.pending.push(
      new Promise((resolve) =>
        setTimeout(() => {
          const bot = this.bot(botId);
          if (bot?.room?.channelId === channelId) this.change(botId, { room: { ...bot.room, status: "connected" } });
          resolve();
        }, JOIN_MS),
      ),
    );
  }

  leave(botId: string): void {
    this.calls.push(["leave", botId]);
    this.change(botId, { room: null });
  }

  setMuted(botId: string, muted: boolean): void {
    this.calls.push(["setMuted", botId, muted]);
    this.change(botId, { muted });
  }

  setVolume(botId: string, volume: number): void {
    this.calls.push(["setVolume", botId, volume]);
    this.change(botId, { volume });
  }

  retry(botId: string): void {
    this.calls.push(["retry", botId]);
  }

  /** Wait until every join so far has connected. */
  async settle(): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    await Promise.all(pending);
  }

  private bot(id: string): LyreBot | undefined {
    return this.state.bots.find((b) => b.id === id);
  }

  private change(botId: string, part: Partial<LyreBot>): void {
    this.push({ ...this.state, bots: this.state.bots.map((b) => (b.id === botId ? { ...b, ...part } : b)) });
  }
}
