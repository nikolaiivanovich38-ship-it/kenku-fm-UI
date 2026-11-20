/**
 * Round 9 §4 and round 10 (design/prototype/ROUND9.md, ROUND10.md "Help"; the prototype's r9guide.js): Set up Lyre,
 * nine tasks in the order a new table needs them, each ticked by itself when the library has what it needs, each with
 * Show me (Lyre goes to the screen and a short walk points at the real controls: tours.ts). Nik, item 19: "Need a much
 * better tutorial, covering much more of the functionality, and giving a guided setup for all elements of the app".
 */
import { useEffect, useState } from "react";
import type { LyreOutputs } from "../../common/lyreOutputs";
import type { CampaignInfo, LibraryTrack, PadBoard, PlaylistInfo } from "../../common/lyre/api";
import { useBoards, useCampaigns, usePlaylists, useTracks } from "../api";
import { useOptionalLyreAudio } from "../audio/LyreAudioProvider";
import { useOutputs } from "../outputs/OutputsProvider";
import type { TourKey } from "./tours";

/** Page storage for what the library cannot tell: a scene was run in Live, and the checklist hidden. */
const SETUP_KEY = "lyre-setup";

export interface SetupFacts {
  outputs: LyreOutputs | null;
  tracks: readonly LibraryTrack[];
  playlists: readonly PlaylistInfo[];
  campaigns: readonly CampaignInfo[];
  boards: readonly PadBoard[];
  ranLive: boolean;
  themeChosen: boolean;
}

export interface SetupTask {
  id: string;
  title: string;
  tour: TourKey;
  done: (facts: SetupFacts) => boolean;
}

const tagged = (t: LibraryTrack) => Object.values(t.tags).some((tags) => tags.length > 0);

/** The nine tasks, in the prototype's order and words. */
export const SETUP_TASKS: readonly SetupTask[] = [
  { id: "bot", title: "Connect a Discord bot", tour: "settings", done: (f) => !!f.outputs?.bots.some((b) => b.login === "ready") },
  { id: "room", title: "Put the bot in a room", tour: "rooms", done: (f) => !!f.outputs?.bots.some((b) => b.room?.status === "connected") },
  { id: "music", title: "Add your music", tour: "library", done: (f) => f.tracks.length > 0 },
  { id: "tags", title: "Tag a few tracks", tour: "details", done: (f) => f.tracks.filter(tagged).length >= 3 },
  { id: "playlist", title: "Make a playlist", tour: "playlists", done: (f) => f.playlists.length > 0 },
  { id: "plan", title: "Plan a session and its scenes", tour: "session", done: (f) => f.campaigns.some((c) => c.sessions.some((s) => s.scenes.length > 1)) },
  { id: "pads", title: "Build a pad board", tour: "board", done: (f) => f.boards.some((b) => [...b.slots, ...b.spare].some(Boolean)) },
  { id: "live", title: "Run a scene in Live", tour: "live", done: (f) => f.ranLive },
  { id: "look", title: "Choose a theme (optional)", tour: "look", done: (f) => f.themeChosen },
];

interface SetupStore {
  ranLive?: boolean;
  hidden?: boolean;
}

function readStore(): SetupStore {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as SetupStore) : {};
  } catch {
    return {};
  }
}

function writeStore(change: SetupStore): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({ ...readStore(), ...change }));
  } catch {
    // Storage unavailable: it lasts for this visit.
  }
}

export interface SetupProgress {
  tasks: readonly { task: SetupTask; done: boolean }[];
  done: number;
  of: number;
  /** Nik hid the checklist (Hide); it shows as one line. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

/** Set up Lyre's tasks, ticked from the library, Discord and this page. `themeChosen`: a theme was chosen. */
export function useSetupProgress(themeChosen: boolean): SetupProgress {
  const { outputs } = useOutputs();
  const tracks = useTracks().data ?? [];
  const playlists = usePlaylists().data ?? [];
  const campaigns = useCampaigns().data ?? [];
  const boards = useBoards().data ?? [];
  const [store, setStore] = useState(readStore);
  const audio = useOptionalLyreAudio();
  // A scene run in Live ticks "Run a scene in Live" for good.
  useEffect(() => {
    if (!audio || store.ranLive) return;
    const heard = () => {
      writeStore({ ranLive: true });
      setStore(readStore());
    };
    audio.on("scene-started", heard);
    return () => {
      audio.off("scene-started", heard);
    };
  }, [audio, store.ranLive]);
  const facts: SetupFacts = { outputs, tracks, playlists, campaigns, boards, ranLive: !!store.ranLive, themeChosen };
  const tasks = SETUP_TASKS.map((task) => ({ task, done: task.done(facts) }));
  return {
    tasks,
    done: tasks.filter((t) => t.done).length,
    of: tasks.length,
    hidden: !!store.hidden,
    setHidden: (hidden) => {
      writeStore({ hidden });
      setStore(readStore());
    },
  };
}
