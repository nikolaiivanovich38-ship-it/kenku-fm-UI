/**
 * w4-outputs, test builds only (CUE_DESK_FAKE_DISCORD=prototype): the design prototype's Discord
 * (design/prototype/src/data.js, `discord`), so the acceptance specs in e2e/specs see the same servers, channels,
 * people and bots in the app as in the prototype. Never part of a release build: only discordDriver.ts and
 * PlaybackManager require it, behind __CUE_DESK_TEST_BUILD__.
 */
import type { OutputManager } from "../OutputManager";
import type { FakeWorld } from "./fakeDiscord";

export const PROTOTYPE_WORLD: FakeWorld = {
  guilds: [
    {
      id: "1001",
      name: "The Gull and Lantern",
      channels: [
        { id: "1011", name: "Table", members: ["Nik", "Aster", "Bram", "Corin", "Dalia"] },
        { id: "1012", name: "Side room" },
        { id: "1013", name: "Whispers" },
        { id: "1014", name: "AFK", members: ["Ezra"] },
      ],
    },
    {
      id: "1002",
      name: "Night court",
      channels: [
        { id: "1021", name: "Elysium" },
        { id: "1022", name: "Private audience" },
      ],
    },
  ],
  // OUT-8 (round 6 specs, e2e/specs/settings.spec.ts): the tokens end as the prototype shows them (Kq7w, p3Zd); the
  // specs' new bot "Lyre Third" and Lyre Side's replaced token log in too, and the new bot is in no server until an
  // invite is opened (testing/fakeDiscord.ts notInvited).
  usernames: {
    "fake-lyre-table.prototype.Kq7w": "Lyre Table",
    "fake-lyre-side.prototype.p3Zd": "Lyre Side",
    "MTAx.new-bot.abcd": "Lyre Third",
    "MTAx.secret-part.wxyz": "Lyre Side",
  },
  notInvited: ["MTAx.new-bot.abcd"],
};

/** The prototype's bots, in order: their token, the channel the first starts in, and their volume (85 %). */
const BOTS: readonly { token: string; startsIn: string | null }[] = [
  { token: "fake-lyre-table.prototype.Kq7w", startsIn: "1011" },
  { token: "fake-lyre-side.prototype.p3Zd", startsIn: null },
];
const VOLUME = 0.85;

/** Resolves once `done()` is true, checking on every change of the outputs (at most `ms`). */
function whenOutputs(outputs: OutputManager, done: () => boolean, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (done()) return resolve();
    const timer = setTimeout(() => {
      outputs.off("stateChange", check);
      reject(new Error("The fake Discord did not answer in time"));
    }, ms);
    function check() {
      if (!done()) return;
      clearTimeout(timer);
      outputs.off("stateChange", check);
      resolve();
    }
    outputs.on("stateChange", check);
  });
}

/** Two bots logged in, at 85 %, the first in Table. */
export function seedPrototypeOutputs(outputs: OutputManager): void {
  const ids = outputs.state().bots.map((bot) => bot.id);
  while (ids.length < BOTS.length) ids.push(outputs.addBot());
  BOTS.forEach((spec, i) => {
    const id = ids[i];
    outputs.setToken(id, spec.token);
    outputs.setRoomVolume(id, VOLUME);
    void outputs.connect(id).then(async () => {
      if (!spec.startsIn) return;
      await whenOutputs(outputs, () => outputs.bots.get(id)?.status === "ready");
      await outputs.moveBot(id, spec.startsIn);
    });
  });
}

/** What the specs' joinRoom and leaveAllRooms call (as globalThis.__lyreOutputsTest in test builds). */
export function outputsTestHook(outputs: OutputManager) {
  const botNamed = (name: string) => {
    const bot = outputs.state().bots.find((b) => (b.discordName ?? b.name) === name);
    if (!bot) throw new Error(`No bot called ${name}`);
    return bot.id;
  };
  const channelNamed = (name: string) => {
    for (const guild of PROTOTYPE_WORLD.guilds) {
      const channel = guild.channels.find((c) => c.name === name);
      if (channel) return channel.id;
    }
    throw new Error(`No voice channel called ${name}`);
  };
  return {
    /** A bot joins a voice channel (by their names); resolves when it is connected there. */
    async join(bot: string, channel: string): Promise<void> {
      const id = botNamed(bot);
      const channelId = channelNamed(channel);
      await outputs.moveBot(id, channelId);
      const inThere = () => outputs.bots.get(id)?.voice().some((s) => s.channelId === channelId && s.status === "connected") ?? false;
      await whenOutputs(outputs, inThere);
    },
    /** Every bot leaves its voice channels. */
    leaveAll(): void {
      for (const id of outputs.bots.keys()) outputs.leaveAll(id);
    },
    /** w51-audio: per bot (by name), the packets its player was given, its holes and its drops. */
    timing(): Record<string, ReturnType<OutputManager["audioTiming"]>[string]> {
      const timing = outputs.audioTiming();
      return Object.fromEntries(
        [...outputs.bots].map(([id, bot]) => [bot.discordName ?? bot.lastDiscordName ?? id, timing[id]]),
      );
    },
  };
}

/** Test builds: start the prototype's bots and give the specs their hook. */
export function startPrototypeOutputs(outputs: OutputManager): void {
  seedPrototypeOutputs(outputs);
  (globalThis as unknown as { __lyreOutputsTest: ReturnType<typeof outputsTestHook> }).__lyreOutputsTest = outputsTestHook(outputs);
}
