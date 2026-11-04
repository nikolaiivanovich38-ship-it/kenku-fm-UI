/**
 * WP2: steps for tests that broadcast to Discord. Discord cannot be reached
 * from the test machine, so these tests start a test build with
 * CUE_DESK_FAKE_DISCORD=1: bots log in with any token starting with "fake-"
 * and see one server, "Test Server", with the voice channels below
 * (src/main/broadcast/testing/fakeDiscord.ts). The fake records the Opus
 * packets each voice connection receives.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "./app";

/** Environment for `launchApp` that switches the fake Discord on. */
export const FAKE_DISCORD_ENV = { CUE_DESK_FAKE_DISCORD: "1" };

export const FAKE_CHANNEL_IDS = {
  Tavern: "901",
  Dungeon: "902",
  Stage: "903",
  "Locked Room": "904",
  "Silent Room": "905",
} as const;
export type FakeChannelName = keyof typeof FAKE_CHANNEL_IDS;

/** Settings dialog, opened if needed. */
export async function openSettings(mainWindow: Page) {
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  if (!(await settings.isVisible())) {
    await mainWindow.getByRole("button", { name: "Settings" }).click();
  }
  await expect(settings).toBeVisible();
  return settings;
}

/** Type a bot token in Settings, connect, and close Settings once connected. */
export async function connectFakeBot(mainWindow: Page, token = "fake-token-1") {
  const settings = await openSettings(mainWindow);
  await settings.getByLabel("Token").fill(token);
  await settings.getByRole("button", { name: "Connect" }).click();
  await expect(settings.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
}

/** A voice channel in the side bar's output list. */
export function channelButton(mainWindow: Page, name: FakeChannelName) {
  return mainWindow.getByRole("button", { name, exact: true });
}

/** Packets the fake voice connections in a channel have received (silence frames excluded). */
export function packetCount(app: ElectronApplication, channel: FakeChannelName): Promise<number> {
  return app.evaluate((_electron, channelId) => {
    const fake = (globalThis as unknown as { __cueDeskFakeDiscord?: { decode(id: string): unknown[] } })
      .__cueDeskFakeDiscord;
    return fake ? fake.decode(channelId).length : -1;
  }, FAKE_CHANNEL_IDS[channel]);
}

/** Decoded audio a channel received: per packet, its arrival time and 16-bit stereo samples. */
export function receivedAudio(
  app: ElectronApplication,
  channel: FakeChannelName,
): Promise<{ at: number; pcm: number[] }[]> {
  return app.evaluate((_electron, channelId) => {
    const fake = (
      globalThis as unknown as {
        __cueDeskFakeDiscord: { decode(id: string): { at: number; pcm: Int16Array }[] };
      }
    ).__cueDeskFakeDiscord;
    return fake.decode(channelId).map(({ at, pcm }) => ({ at, pcm: Array.from(pcm) }));
  }, FAKE_CHANNEL_IDS[channel]);
}

/**
 * A page that plays a 440 Hz tone whose volume rises from 0 to full over
 * `rampSeconds`, either with Web Audio (`playRamp`) or from an audio element
 * (`playRampElement`, a WAV rendered in the page). `title` names the tab.
 */
export function tonePage(title = "Tone") {
  return {
    title,
    body: `<p>${title}</p><script>
    window.playRamp = (rampSeconds) => {
      const context = new AudioContext();
      const tone = context.createOscillator();
      const volume = context.createGain();
      volume.gain.setValueAtTime(0, 0);
      volume.gain.linearRampToValueAtTime(1, rampSeconds);
      tone.connect(volume).connect(context.destination);
      tone.start();
      window.toneContext = context;
    };
    window.playTone = () => window.playRamp(0.001);
    window.stopTone = () => window.toneContext && window.toneContext.close();
    window.playRampElement = async (rampSeconds) => {
      const rate = 48000;
      const offline = new OfflineAudioContext(1, rate * (rampSeconds + 1), rate);
      const tone = offline.createOscillator();
      const volume = offline.createGain();
      volume.gain.setValueAtTime(0, 0);
      volume.gain.linearRampToValueAtTime(1, rampSeconds);
      tone.connect(volume).connect(offline.destination);
      tone.start();
      const samples = (await offline.startRendering()).getChannelData(0);
      const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
      const text = (offset, value) => [...value].forEach((c, i) => wav.setUint8(offset + i, c.charCodeAt(0)));
      text(0, "RIFF"); wav.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVEfmt ");
      wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
      wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true); text(36, "data"); wav.setUint32(40, samples.length * 2, true);
      samples.forEach((sample, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true));
      const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: "audio/wav" })));
      await audio.play();
    };
  </script>`,
  };
}

export const TONE_PAGE = tonePage();

/** Open a website tab the way the "+" button does; returns its view id. */
export function openTab(mainWindow: Page, url: string): Promise<number> {
  return mainWindow.evaluate(
    (address) =>
      (window as unknown as { kenku: { createBrowserView(...args: unknown[]): Promise<number> } }).kenku.createBrowserView(
        address,
        0,
        0,
        400,
        300,
      ),
    url,
  );
}
