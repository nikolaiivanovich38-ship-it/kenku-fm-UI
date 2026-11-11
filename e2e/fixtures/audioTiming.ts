/**
 * w51-audio: measuring stutter in what Discord would hear, from the fake Discord's own record (test builds,
 * CUE_DESK_FAKE_DISCORD). Every packet @discordjs/voice's player hands a voice connection is kept with its time,
 * including the 3-byte silence frames the player sends when it has no packet ready. The analysis runs here, in the
 * test, so it works on any test build, old or new.
 *
 * What counts as stutter:
 * - a gap: a silence frame between two packets with sound, 20 ms the players hear as a hole;
 * - a jump: the steady 440 Hz stand-in tone (src/main/lyreApi/seedAudio.ts) changes phase between two packets in a
 *   row, so audio was lost or played twice on the way.
 */
import type { ElectronApplication, Page } from "@playwright/test";

/** One packet a voice connection was handed: when, and its Opus bytes. */
export type RawPacket = { at: number; data: Buffer };

/** The main process's clock (the fake Discord stamps packets with it). */
export function mainNow(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => Date.now());
}

/** Every packet a channel's voice connections were handed from `since` (main-process time) on. */
export async function rawPackets(app: ElectronApplication, channelId: string, since: number): Promise<RawPacket[]> {
  const list = await app.evaluate(
    (_electron, [id, from]) => {
      type Packet = { at: number; data: Buffer };
      const fake = (globalThis as unknown as {
        __cueDeskFakeDiscord?: { connections: { joinConfig: { channelId: string }; packets: Packet[] }[] };
      }).__cueDeskFakeDiscord;
      if (!fake) return [];
      return fake.connections
        .filter((connection) => connection.joinConfig.channelId === id)
        .flatMap((connection) => connection.packets)
        .filter((packet) => packet.at >= from)
        .map((packet) => ({ at: packet.at, data: packet.data.toString("base64") }));
    },
    [channelId, since] as const,
  );
  return list.map(({ at, data }) => ({ at, data: Buffer.from(data, "base64") }));
}

export interface StreamTiming {
  /** Packets the player sent in the window (one per 20 ms while it plays). */
  ticks: number;
  /** Of those, packets with sound. */
  sound: number;
  /** Silence frames between two packets with sound: 20 ms holes. */
  gaps: number;
  /** Places where the steady tone's phase jumps: audio lost or doubled before Discord. */
  jumps: number;
  /** Time between the player's sends, in ms. */
  intervalMs: { p50: number; p99: number; max: number };
}

const SAMPLE_RATE = 48_000;
const FRAME = 960;
const TONE_HZ = 440;
/** Phase from one 20 ms packet to the next for a steady 440 Hz tone (8.8 turns), wrapped. */
const STEP = wrap(2 * Math.PI * ((TONE_HZ * FRAME) / SAMPLE_RATE));
/** A phase change further than this from the steady step counts as a jump (a lost 20 ms frame moves it 1.26 rad). */
const JUMP_RADIANS = 0.5;
/** Below this the tone is too quiet to read its phase (Goertzel magnitude per sample; the stand-in is about 0.1). */
const TONE_FLOOR = 0.01;

function wrap(radians: number): number {
  const turn = 2 * Math.PI;
  return ((((radians + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** The 440 Hz component of one packet's left channel: magnitude per sample and phase. */
function tone(pcm: Int16Array): { magnitude: number; phase: number } {
  const omega = (2 * Math.PI * TONE_HZ) / SAMPLE_RATE;
  let re = 0;
  let im = 0;
  for (let n = 0; n < FRAME; n++) {
    const x = pcm[n * 2] / 32768;
    re += x * Math.cos(omega * n);
    im -= x * Math.sin(omega * n);
  }
  return { magnitude: Math.hypot(re, im) / FRAME, phase: Math.atan2(im, re) };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Gaps, jumps and send intervals of the packets in [from, to). Packets before `from` are decoded too, so the Opus
 * decoder has settled when the window starts.
 */
export function analyseStream(packets: RawPacket[], from: number, to: number): StreamTiming {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpusScript = require("opusscript");
  const decoder = new OpusScript(SAMPLE_RATE, 2, OpusScript.Application.AUDIO);
  const inWindow: { at: number; silent: boolean; tone?: { magnitude: number; phase: number } }[] = [];
  try {
    for (const packet of packets) {
      if (packet.at >= to) break;
      const silent = packet.data.length <= 3;
      let heard: { magnitude: number; phase: number } | undefined;
      if (!silent) {
        const pcm: Buffer = decoder.decode(packet.data);
        heard = tone(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2));
      }
      if (packet.at >= from) inWindow.push({ at: packet.at, silent, tone: heard });
    }
  } finally {
    decoder.delete();
  }
  let gaps = 0;
  let jumps = 0;
  let pendingSilence = 0;
  let seenSound = false;
  let previous: { magnitude: number; phase: number } | undefined;
  for (const entry of inWindow) {
    if (entry.silent) {
      if (seenSound) pendingSilence++;
      previous = undefined;
      continue;
    }
    gaps += pendingSilence;
    pendingSilence = 0;
    seenSound = true;
    const heard = entry.tone!;
    if (previous && previous.magnitude > TONE_FLOOR && heard.magnitude > TONE_FLOOR) {
      if (Math.abs(wrap(heard.phase - previous.phase - STEP)) > JUMP_RADIANS) jumps++;
    }
    previous = heard;
  }
  const intervals = inWindow
    .slice(1)
    .map((entry, i) => entry.at - inWindow[i].at)
    .sort((a, b) => a - b);
  return {
    ticks: inWindow.length,
    sound: inWindow.filter((entry) => !entry.silent).length,
    gaps,
    jumps,
    intervalMs: { p50: percentile(intervals, 0.5), p99: percentile(intervals, 0.99), max: intervals[intervals.length - 1] ?? 0 },
  };
}

/** Start noting the page's long tasks (over 50 ms on its main thread). */
export async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __w51LongTasks?: number[] };
    if (target.__w51LongTasks) return;
    target.__w51LongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) target.__w51LongTasks!.push(Math.round(entry.duration));
    }).observe({ type: "longtask" });
  });
}

/** The long tasks noted since the last call: how many, their total and the longest, in ms. */
export async function takeLongTasks(page: Page): Promise<{ count: number; totalMs: number; maxMs: number }> {
  const tasks = await page.evaluate(() => {
    const target = window as unknown as { __w51LongTasks?: number[] };
    const taken = target.__w51LongTasks ?? [];
    target.__w51LongTasks = [];
    return taken;
  });
  return { count: tasks.length, totalMs: tasks.reduce((a, b) => a + b, 0), maxMs: Math.max(0, ...tasks) };
}

/**
 * Keep the page's main thread busy for each of `workMs` in turn, with `gapMs` between, for `seconds`: a stand-in for
 * screens redrawing (on a slower computer, or with a bigger library, they take longer). Work of uneven length is
 * what a buffer cannot get used to: a single length is absorbed once the first hole has deepened the buffer.
 */
export async function busyMainThread(page: Page, workMs: readonly number[], gapMs: number, seconds: number): Promise<void> {
  await page.evaluate(
    ([works, gap, total]) => {
      const stopAt = performance.now() + total * 1000;
      let turn = 0;
      const step = () => {
        if (performance.now() > stopAt) return;
        const end = performance.now() + works[turn++ % works.length];
        while (performance.now() < end) {
          // Busy on purpose.
        }
        setTimeout(step, gap);
      };
      setTimeout(step, gap);
    },
    [workMs, gapMs, seconds] as const,
  );
}

/** w51-audio builds: how Lyre's frames for each room (and the preview) fared in the capture window. */
export type InletCounts = Record<string, { frames: number; holes: number; dropped: number; wait: number }>;

/**
 * Ask the capture window for its counts (it logs them as "Audio timing: {…}"). Null on a build without them (0.5.0),
 * so the same checks measure an old build from the outside only.
 */
export async function captureCounts(app: ElectronApplication, capture: Page): Promise<InletCounts | null> {
  const answer = new Promise<InletCounts | null>((resolve) => {
    const timer = setTimeout(() => {
      capture.off("console", onLine);
      resolve(null);
    }, 3_000);
    function onLine(message: { text(): string }) {
      const text = message.text();
      if (!text.startsWith("Audio timing: ")) return;
      clearTimeout(timer);
      capture.off("console", onLine);
      resolve(JSON.parse(text.slice("Audio timing: ".length)) as InletCounts);
    }
    capture.on("console", onLine);
  });
  await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((contents) => !contents.isDestroyed() && contents.getTitle() === "Audio Capture")
      ?.send("AUDIO_CAPTURE_TIMING"),
  );
  return answer;
}

/** w51-audio builds: per bot (by name), what its Discord player was given, its holes and drops. Null on older builds. */
export type FeedCounts = Record<string, { packets: number; holes: number; dropped: number }>;

export function feedCounts(app: ElectronApplication): Promise<FeedCounts | null> {
  return app.evaluate(() => {
    const hook = (globalThis as unknown as { __lyreOutputsTest?: { timing?(): Record<string, { packets: number; holes: number; dropped: number }> } })
      .__lyreOutputsTest;
    return hook?.timing ? hook.timing() : null;
  });
}

/** What changed between two sets of counts (each number after minus before; `wait` as it is after). */
export function countsSince<T extends Record<string, Record<string, number>>>(before: T | null, after: T | null): T | null {
  if (!before || !after) return null;
  const result: Record<string, Record<string, number>> = {};
  for (const [key, now] of Object.entries(after)) {
    const then = before[key] ?? {};
    result[key] = Object.fromEntries(Object.entries(now).map(([name, value]) => [name, name === "wait" ? value : value - (then[name] ?? 0)]));
  }
  return result as T;
}

/** Windows' timer step when no program asks for finer timers: 1/64 s. */
export const WINDOWS_TIMER_MS = 15.625;

/**
 * Make the timers of some of the app's pages wake up to `ms` late, as Windows' coarse timers do, while the sound card
 * (here Chromium's audio service, left alone) keeps exact time. Uses Linux's per-thread timer slack (as root), set
 * again every 200 ms so new threads get it too. Returns a function that puts the timers back; null where this cannot
 * be done (another system, not root), so a test can skip.
 */
export async function coarseTimers(app: ElectronApplication, titles: readonly string[], ms = WINDOWS_TIMER_MS): Promise<(() => void) | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  if (process.platform !== "linux" || process.getuid?.() !== 0) return null;
  const pids = await app.evaluate(
    ({ webContents }, names) =>
      webContents
        .getAllWebContents()
        .filter((contents) => !contents.isDestroyed() && names.includes(contents.getTitle()))
        .map((contents) => contents.getOSProcessId()),
    [...titles],
  );
  if (pids.length !== titles.length) return null;
  const write = (nanoseconds: number) => {
    for (const pid of pids) {
      let threads: string[] = [];
      try {
        threads = fs.readdirSync(`/proc/${pid}/task`);
      } catch {
        continue; // the page has gone
      }
      for (const thread of threads) {
        try {
          fs.writeFileSync(`/proc/${pid}/task/${thread}/timerslack_ns`, String(nanoseconds));
        } catch {
          // A thread that ended meanwhile.
        }
      }
    }
  };
  const slack = Math.round(ms * 1_000_000);
  write(slack);
  const timer = setInterval(() => write(slack), 200);
  return () => {
    clearInterval(timer);
    write(0); // 0: back to the thread's default
  };
}
