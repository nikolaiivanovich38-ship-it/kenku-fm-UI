/**
 * WP2, FND-16: steps for tests that broadcast to Discord. Discord cannot be reached from the test machine, so test
 * builds fake it: CUE_DESK_FAKE_DISCORD=1 lets a bot log in with any token starting with "fake-" (one server, "Test
 * Server"); CUE_DESK_FAKE_DISCORD=prototype is the design prototype's world, with Lyre Table in Table and Lyre Side
 * in no room (src/main/broadcast/testing). The fake records the Opus packets each voice connection receives.
 * Until 0.5.1 these steps drove the old main window's Settings and sidebar; the Lyre page's own are in e2e/specs.
 */
import type { ElectronApplication } from "@playwright/test";

/** Environment for `launchApp` that switches the fake Discord on. */
export const FAKE_DISCORD_ENV = { CUE_DESK_FAKE_DISCORD: "1" };

/** The prototype's library and Discord (e2e/specs see the same). */
export const PROTOTYPE_ENV = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };

/** The prototype world's voice channels (src/main/broadcast/testing/prototypeWorld.ts). */
export const PROTOTYPE_CHANNEL_IDS = { Table: "1011", "Side room": "1012" } as const;
export type PrototypeChannel = keyof typeof PROTOTYPE_CHANNEL_IDS;

/** Per packet a channel received from number `from` on: arrival time and loudest sample (0 to 1). */
export function receivedPeaks(app: ElectronApplication, channel: PrototypeChannel, from = 0): Promise<{ at: number; peak: number }[]> {
  return app.evaluate(
    (_electron, [channelId, start]) =>
      (globalThis as unknown as { __cueDeskFakeDiscord: { peaks(id: string, from: number): { at: number; peak: number }[] } }).__cueDeskFakeDiscord.peaks(
        channelId,
        start,
      ),
    [PROTOTYPE_CHANNEL_IDS[channel], from] as const,
  );
}

/** Packets with sound (Discord's silence frames left out) a channel has received so far. */
export async function packetCount(app: ElectronApplication, channel: PrototypeChannel): Promise<number> {
  return (await receivedPeaks(app, channel)).length;
}

/** A prototype bot joins a voice channel, by their names; resolves once it is connected there. */
export function joinRoom(app: ElectronApplication, bot: string, channel: string): Promise<void> {
  return app.evaluate(
    (_electron, [b, c]) => (globalThis as unknown as { __lyreOutputsTest: { join(bot: string, channel: string): Promise<void> } }).__lyreOutputsTest.join(b, c),
    [bot, channel] as const,
  );
}

/** Whether this computer's speakers get sound from Lyre: the Lyre page or the capture window (Chromium's check). */
export function thisComputerPlays(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((c) => !c.isDestroyed() && ["Lyre", "Audio Capture"].includes(c.getTitle()) && c.isCurrentlyAudible()),
  );
}
