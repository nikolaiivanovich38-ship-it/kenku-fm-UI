/**
 * Test builds only (CUE_DESK_LYRE_SEED=prototype): the prototype's computer, so the specs see the sample library as
 * the design does (design/prototype/src/data.js, views/transfer.js). The seeded library keeps the prototype's paths
 * (H:\Audio\…), which are not on the test machine, so Lyre looks at them through this stand-in instead of the disk:
 *
 * - every sample track's file is there, 9 MB each (the prototype's rough size per file), except the three that
 *   moved when the drive was reorganised (seed `missing`: t19, t26, t37);
 * - E:\Music\Scores, the folder Find missing files looks in, holds t19 with the same name and size and t26 with the
 *   same name and another size (t37 is not there);
 * - reading a file gives that many bytes, so Save to a file with the audio files writes a file of the real size;
 * - "Curse of Strahd from Sam.lyre" is the shared file Choose a file… opens (transfer.js SAMPLE), made with the real
 *   writer: Lyre then opens, checks and brings it in like any other .lyre file.
 *
 * libraryProcessCore.ts uses this only for a seeded test library; the app reads the disk.
 */
import fs from "fs";
import path from "path";
import { Readable } from "stream";

import { prototypeSeed, type SeedData } from "../../common/lyre/seed";
import type { CampaignInfo, PadBoard, Pad, PlaylistInfo, SceneInfo } from "../../common/lyre/api";
import type { FileProbe } from "../data/import/relink";
import { writeLyreFile, type FileTrack, type LyreFileLibrary } from "../transfer/lyreFile";

export const SAMPLE_FILE_BYTES = 9_000_000;
/** The folder the specs type into Find missing files (transfer.js rl.folder). */
export const SAMPLE_RELINK_FOLDER = "E:\\Music\\Scores";
export const SAMPLE_SHARED_FILE = "Curse of Strahd from Sam.lyre";
/** 5 Nov 2026, the prototype's today. */
export const SAMPLE_TODAY = Date.UTC(2026, 10, 5, 12);

const key = (p: string) => p.replace(/\//g, "\\").toLowerCase();
const fileOf = (t: { folder: string; fileName: string }) => `${t.folder}\\${t.fileName}`;

export function sampleComputer(seed: SeedData): FileProbe & { open(file: string): NodeJS.ReadableStream } {
  const files = new Map<string, { path: string; size: number }>();
  const missing = new Set(seed.missing);
  for (const t of seed.tracks) if (!missing.has(t.id)) files.set(key(fileOf(t)), { path: fileOf(t), size: SAMPLE_FILE_BYTES });
  const moved = (id: string, size: number) => {
    const t = seed.tracks.find((x) => x.id === id);
    if (!t) return;
    const at = `${SAMPLE_RELINK_FOLDER}\\${t.artist}\\${t.album}\\${t.fileName}`;
    files.set(key(at), { path: at, size });
  };
  moved("t19", SAMPLE_FILE_BYTES);
  moved("t26", 8_400_000);
  const found = (p: string) => files.get(key(p));
  return {
    exists: async (p) => found(p) !== undefined,
    facts: async (p) => {
      const f = found(p);
      if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return { path: f.path, size: f.size, mtimeMs: SAMPLE_TODAY, checksum: `q1:sample:${f.size}:${key(path.win32.basename(f.path))}` };
    },
    audioFilesUnder: async (folder) => {
      const prefix = `${key(folder).replace(/\\+$/, "")}\\`;
      return [...files.values()].filter((f) => key(f.path).startsWith(prefix)).map((f) => f.path);
    },
    open: (p) => {
      const size = found(p)?.size ?? 0;
      const chunk = Buffer.alloc(64 * 1024, 0x55);
      // The first bytes are those of a real file of its kind: Bring in unpacks only what looks like audio (audioBytes.ts).
      const first = Buffer.from(chunk);
      first.write(path.win32.extname(p).toLowerCase() === ".wav" ? "RIFF\u0000\u0000\u0000\u0000WAVE" : "fLaC", "latin1");
      return Readable.from(
        (function* () {
          for (let sent = 0; sent < size; sent += chunk.length) yield (sent === 0 ? first : chunk).subarray(0, Math.min(chunk.length, size - sent));
        })(),
      );
    },
  };
}

/* ---------- the file another game master shared ---------- */

const BAROVIA = "D:\\Music\\Barovia";

/** Sam's library: 8 of the sample's tracks (same file name and length) and 30 of Sam's own. */
function samTracks(seed: SeedData): FileTrack[] {
  const shared = ["t18", "t20", "t38", "t12", "t13", "t14", "t15", "t21"].map((id) => seed.tracks.find((t) => t.id === id)).filter((t): t is SeedData["tracks"][number] => !!t);
  const own: FileTrack[] = shared.map(({ url: _u, addedAt: _a, isNew: _n, suggestedShape: _s, ...t }) => ({ ...t, id: `sam-${t.id}`, folder: BAROVIA, tags: { ...t.tags } }));
  for (let i = 1; i <= 30; i++) {
    const fx = i > 21;
    own.push({
      id: `sam-${i}`,
      kind: fx ? "fx" : "music",
      title: fx ? `Barovia effect ${i - 21}` : `Barovia cue ${i}`,
      metaTitle: "",
      fileName: fx ? `barovia_fx_${String(i - 21).padStart(2, "0")}.wav` : `Barovia ${String(i).padStart(2, "0")}.flac`,
      durationMs: fx ? 3000 : 150_000 + i * 1000,
      role: fx ? "effect" : "underscore",
      loop: fx ? "no" : "crossfade",
      energy: fx ? null : (i % 5) + 1,
      tags: { mood: i % 3 === 0 ? ["Gothic", "Dread"] : ["Gothic"], motif: i % 4 === 0 ? ["Strahd"] : i % 7 === 0 ? ["Ireena"] : [], scene: [] },
      profile: null,
      shape: null,
      normalise: null,
      artist: "Sam's collection",
      album: "Barovia",
      folder: BAROVIA,
      notes: "",
      sizeBytes: null,
      fadesOut: false,
      resume: false,
      follow: null,
    });
  }
  return own;
}

const pad = (n: number, trackId: string, label: string): Pad => ({
  id: `sam-pad-${n}`, label, icon: "bolt", color: "plum", key: String(n), mode: "oneshot",
  sound: { kind: "single", trackIds: [trackId], order: "random", tag: null }, volume: 0.8, fadeOutMs: 1500, aside: false, steps: null,
});

const scene = (id: string, name: string, music: SceneInfo["music"], boardIds: string[] = []): SceneInfo => ({ id, name, music, ambience: null, boardIds, startsWhen: "", notes: "", noteLink: "", trackNames: {}, repeatOnes: [], steps: null, movesOn: { when: "stay" } });

const tagInfos = (names: string[]) => names.map((name) => ({ name, parent: null as string | null, also: [] as string[], color: null as null }));

export function sampleSharedLibrary(seed: SeedData): LyreFileLibrary {
  const tracks = samTracks(seed);
  const playlists: PlaylistInfo[] = [
    { id: "sam-mist", name: "Barovia mist", lane: "music", kind: "manual", trackIds: ["sam-1", "sam-2", "sam-3", "sam-4", "sam-5", "sam-6"], notes: "", order: null, normalise: null, folderId: null, dividers: [] },
    { id: "sam-gothic", name: "Gothic dread", lane: "music", kind: "dynamic", rule: { conds: [{ group: "mood", match: "any", values: ["Gothic", "Dread"] }] }, notes: "", order: null, normalise: null, folderId: null, dividers: [] },
    { id: "sam-halls", name: "Castle corridors", lane: "music", kind: "manual", trackIds: ["sam-t38", "sam-t20", "sam-7", "sam-t12"], notes: "", order: { shuffle: true, repeat: "all" }, normalise: null, folderId: null, dividers: [] },
  ];
  const board: PadBoard = { id: "sam-ravenloft", name: "Ravenloft", cols: 3, rows: 3, spare: [], dividers: [], folderId: null, slots: Array.from({ length: 9 }, (_, i) => pad(i + 1, `sam-${22 + Math.min(i, 8)}`, ["Bats", "Wolves", "Thunder", "Organ", "Bell", "Door", "Scream", "Chains", "Raven"][i])) };
  const music = (...ids: string[]): SceneInfo["music"] => ids.map((id) => (id.startsWith("sam-") && playlists.some((p) => p.id === id) ? { kind: "playlist", id } : { kind: "track", id }));
  const campaign: CampaignInfo = {
    id: "sam-cos", name: "Curse of Strahd", system: "D&D 5e", theme: "elysium", description: "Gothic horror in the mists of Barovia.", notes: "",
    obsidian: { vault: "", note: "", sessionsFolder: "" }, playlistIds: ["sam-mist"], boardIds: ["sam-ravenloft"], trackIds: [],
    sessions: [
      { id: "sam-s1", campaignId: "sam-cos", number: 1, name: "Into the mists", date: "2026-10-30", status: "played", noteLink: "", playlistIds: [], boardIds: [], trackIds: [], scenes: [
        scene("sam-a", "The Svalich Road", music("sam-mist")), scene("sam-b", "Village of Barovia", music("sam-8", "sam-9")), scene("sam-c", "Death House", music("sam-gothic"), ["sam-ravenloft"]), scene("sam-d", "The burgomaster", music("sam-t13")),
      ] },
      { id: "sam-s2", campaignId: "sam-cos", number: 2, name: "The castle", date: "2026-11-06", status: "next", noteLink: "", playlistIds: ["sam-halls"], boardIds: ["sam-ravenloft"], trackIds: [], scenes: [
        scene("sam-e", "Gates of Ravenloft", music("sam-t18")), scene("sam-f", "Castle corridors", music("sam-halls")), scene("sam-g", "The chapel", music("sam-t14", "sam-t15")), scene("sam-h", "Strahd's dinner", music("sam-10", "sam-t21")), scene("sam-i", "Escape", music("sam-11"), ["sam-ravenloft"]),
      ] },
    ],
  };
  return {
    tracks,
    tagGroups: [
      { id: "mood", name: "Mood", values: ["Gothic", "Dread"], color: null, tags: tagInfos(["Gothic", "Dread"]) },
      { id: "motif", name: "Leitmotif", values: ["Strahd", "Ireena"], color: null, tags: tagInfos(["Strahd", "Ireena"]) },
    ],
    playlists,
    boards: [board],
    campaigns: [campaign],
    overrides: {},
    playOrders: {},
    trackOrders: {},
  };
}

/** Writes Sam's file into `folder` (once) and answers its path. */
export async function writeSampleSharedFile(folder: string, seed?: SeedData): Promise<string> {
  const target = path.join(folder, SAMPLE_SHARED_FILE);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(folder, { recursive: true });
  const library = sampleSharedLibrary(seed ?? prototypeSeed());
  const sessions = library.campaigns[0].sessions;
  await writeLyreFile(target, {
    scope: { kind: "campaign", campaignId: "sam-cos" },
    title: "Curse of Strahd",
    counts: { tracks: library.tracks.length, playlists: 3, boards: 1, campaigns: 1, sessions: sessions.length, scenes: sessions.reduce((n, s) => n + s.scenes.length, 0), tagGroups: 2 },
    library,
    audio: [],
    savedAt: Date.UTC(2026, 10, 2, 20),
  });
  return target;
}
