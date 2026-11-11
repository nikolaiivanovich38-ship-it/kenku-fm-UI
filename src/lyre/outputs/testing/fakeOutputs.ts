/**
 * w4-outputs: outputs for screen tests, on the prototype's Discord (design/prototype/src/data.js): two servers, six
 * voice channels with their people, Lyre Table in Table and Lyre Side in no room, both at 85 %. A move joins
 * ("joining") and connects a moment later, as Discord does; `settle()` waits for that. Every call is recorded.
 * OUT-8: Settings' calls work in memory as the prototype's settings.js does: a new bot is named "Lyre Third" and
 * so on, and is in no server until an invite was opened (then in The Gull and Lantern); tokens show their last four.
 */
import { applicationIdProblem, botInviteUrl, tokenProblem, type LyreBot, type LyreBotResult, type LyreOutputs } from "../../../common/lyreOutputs";
import type { OutputsClient } from "../OutputsProvider";

export const TABLE_BOT = "bot-00000000-0000-4000-8000-000000000001";
export const SIDE_BOT = "bot-00000000-0000-4000-8000-000000000002";

/** What Settings shows of a prototype bot: its own name, its token's end, no Application ID yet. */
function settings(savedName: string, tokenEnd: string): Pick<LyreBot, "savedName" | "tokenEnd" | "tokenRemembered" | "applicationId" | "inviteUrl" | "canRemove"> {
  return { savedName, tokenEnd, tokenRemembered: true, applicationId: null, inviteUrl: null, canRemove: true };
}

const NEW_NAMES = ["Lyre Third", "Lyre Fourth", "Lyre Fifth", "Lyre Sixth"];

export const PROTOTYPE_OUTPUTS: LyreOutputs = {
  bots: [
    { id: TABLE_BOT, name: "Lyre Table", ...settings("Bot 1", "Kq7w"), login: "ready", room: { serverId: "1001", channelId: "1011", status: "connected" }, muted: false, volume: 0.85, serverIds: ["1001", "1002"] },
    { id: SIDE_BOT, name: "Lyre Side", ...settings("Bot 2", "p3Zd"), login: "ready", room: null, muted: false, volume: 0.85, serverIds: ["1001", "1002"] },
  ],
  encryption: true,
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

  private invited = false;
  private removed = new Map<string, { bot: LyreBot; index: number }>();
  private made = 0;

  async addBot(token: string, applicationId: string | null): Promise<LyreBotResult> {
    this.calls.push(["addBot", token.slice(-4), applicationId]);
    const problem = tokenProblem(token) ?? (applicationId === null ? null : applicationIdProblem(applicationId));
    if (problem) return { ok: false, message: problem };
    const id = `bot-fake-${++this.made}`;
    const appId = applicationId?.trim() || null;
    const bot: LyreBot = {
      id, name: NEW_NAMES[this.made - 1] ?? `Lyre ${this.made + 2}`, savedName: `Bot ${this.state.bots.length + 1}`, tokenEnd: token.trim().slice(-4), tokenRemembered: true,
      applicationId: appId, inviteUrl: appId ? botInviteUrl(appId) : null, canRemove: true, login: "ready", room: null, muted: false, volume: 0.85, serverIds: this.invited ? ["1001"] : [],
    };
    this.push(this.withRemovable([...this.state.bots, bot]));
    return { ok: true, botId: id };
  }

  async replaceToken(botId: string, token: string): Promise<LyreBotResult> {
    this.calls.push(["replaceToken", botId, token.slice(-4)]);
    if (!this.bot(botId)) return { ok: false, message: "That bot is no longer in Lyre." };
    const problem = tokenProblem(token);
    if (problem) return { ok: false, message: problem };
    this.change(botId, { tokenEnd: token.trim().slice(-4), login: "ready" });
    return { ok: true, botId };
  }

  async rename(botId: string, name: string): Promise<LyreBotResult> {
    this.calls.push(["rename", botId, name]);
    if (!name.trim()) return { ok: false, message: "Give the bot a name." };
    this.change(botId, { savedName: name.trim() });
    return { ok: true, botId };
  }

  async setApplicationId(botId: string, applicationId: string | null): Promise<LyreBotResult> {
    this.calls.push(["setApplicationId", botId, applicationId]);
    const problem = applicationId === null ? null : applicationIdProblem(applicationId);
    if (problem) return { ok: false, message: problem };
    const appId = applicationId?.trim() || null;
    this.change(botId, { applicationId: appId, inviteUrl: appId ? botInviteUrl(appId) : null });
    return { ok: true, botId };
  }

  async remove(botId: string): Promise<LyreBotResult> {
    this.calls.push(["remove", botId]);
    const index = this.state.bots.findIndex((b) => b.id === botId);
    if (index < 0) return { ok: false, message: "That bot is no longer in Lyre." };
    if (this.state.bots.length <= 1) return { ok: false, message: "Lyre needs one bot at least: replace its token instead." };
    this.removed.set(botId, { bot: this.state.bots[index], index });
    this.push(this.withRemovable(this.state.bots.filter((b) => b.id !== botId)));
    return { ok: true, botId };
  }

  async restore(botId: string): Promise<LyreBotResult> {
    this.calls.push(["restore", botId]);
    const kept = this.removed.get(botId);
    if (!kept) return { ok: false, message: "There is nothing to put back." };
    this.removed.delete(botId);
    const bots = [...this.state.bots];
    bots.splice(kept.index, 0, kept.bot);
    this.push(this.withRemovable(bots));
    return { ok: true, botId };
  }

  connect(botId: string): void {
    this.calls.push(["connect", botId]);
    this.change(botId, { login: "ready" });
  }

  disconnect(botId: string): void {
    this.calls.push(["disconnect", botId]);
    this.change(botId, { login: "offline", room: null });
  }

  /** As the test builds' Discord: an invite opened lets new bots into The Gull and Lantern. */
  openInvite(applicationId: string): void {
    this.calls.push(["openInvite", applicationId]);
    this.invited = true;
  }

  /** FND-16: Got it on the note about a token moved from Kenku FM. */
  legacyTokenNoteSeen(): void {
    this.calls.push(["legacyTokenNoteSeen"]);
    const rest = { ...this.state };
    delete rest.legacyTokenNote;
    this.push(rest);
  }

  private withRemovable(bots: LyreBot[]): LyreOutputs {
    return { ...this.state, bots: bots.map((b) => ({ ...b, canRemove: bots.length > 1 })) };
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
