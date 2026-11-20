/**
 * Round 9 §4 and round 10 (ROUND10.md row 9; the prototype's r9guide.js TOURS): a short walk per screen that points at
 * the real controls, one at a time (Tour.tsx draws it). Help's "Tour of this screen" and Set up Lyre's "Show me" start
 * one. A step whose control is not on screen is left out. Words from the prototype (they had the language pass).
 *
 * The controls are found by their names on screen, as a person finds them, so a tour keeps working when a screen's
 * markup changes.
 */
import type { RouteName } from "../shell/routes";
import type { TourStep } from "./Tour";

export type TourKey = "settings" | "rooms" | "library" | "details" | "playlists" | "session" | "board" | "live" | "look";

/** What a tour may need to open its screen: the first track, session and board in the library. */
export interface TourPlaces {
  trackId?: string;
  session?: { campaignId: string; sessionId: string };
  boardId?: string;
}

export interface TourDef {
  name: string;
  /** The page address to go to first. */
  route: (places: TourPlaces) => string;
  steps: readonly TourStep[];
}

/** Shown and in the page (not in a folded box or a closed panel). */
function shown(e: Element): boolean {
  if (e.closest("[hidden], [aria-hidden='true']")) return false;
  // jsdom lays nothing out; a browser gives a shown element at least one box.
  return e.getClientRects().length > 0 || /jsdom/.test(navigator.userAgent);
}

/** The name a control is known by: its label, else its words. */
function nameOf(e: Element): string {
  return (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim();
}

/** The first shown control (button, link, field) whose name matches, inside `within` (CSS) when given. */
function control(name: RegExp, within = "#view"): () => Element | null {
  return () =>
    Array.from(document.querySelectorAll(`${within} :is(button, a[href], input, select, textarea, [role=button], [role=switch])`)).find((e) => shown(e) && name.test(nameOf(e))) ??
    null;
}

/** The first shown element matching a CSS selector. */
function first(selector: string): () => Element | null {
  return () => Array.from(document.querySelectorAll(selector)).find(shown) ?? null;
}

/** A box (region) by its name. */
function region(name: string): () => Element | null {
  return first(`#view [role=region][aria-label="${name}"], #view section[aria-label="${name}"]`);
}

export const TOURS: Record<TourKey, TourDef> = {
  settings: {
    name: "Settings › Discord bots",
    route: () => "#/settings",
    steps: [
      { title: "Add a bot", text: "Lyre needs one bot for each voice channel it plays into. Press Add a bot to see the steps for making one in Discord and pasting its token.", target: control(/^Add a bot/) },
      { title: "Your bot", text: "Connected means Lyre can use it. Press Replace… to paste a new token. Rename and Remove are in the ⋯ menu.", target: control(/^Replace…/) },
      { title: "Starting volume", text: "The volume a bot starts at when it joins a room. Bots join a room only when you add them to it, in Live.", target: control(/^Starting volume/) },
      { title: "Rooms", text: "The Rooms screen shows which bot is in which voice channel.", target: control(/^Rooms/) },
    ],
  },
  rooms: {
    name: "Rooms in Live",
    route: () => "#/live",
    steps: [
      { title: "Add a room", text: "A room is a Discord voice channel that Lyre plays into. Pick a channel here, and Lyre uses a bot that is not in a room yet.", target: control(/^Add a room/) },
      { title: "Move a room", text: "Press the room’s name to move it to another channel or make it leave. From the same menu you can copy what another room plays.", target: control(/^(Room|Move|Table|More for (the )?room)/) },
      { title: "Mute and volume", text: "Each room has its own volume and mute.", target: control(/^(Mute|Volume)/) },
    ],
  },
  library: {
    name: "Track library",
    route: () => "#/library",
    steps: [
      { title: "Add tracks", text: "Add files or a folder. With Watch a folder…, new files in that folder are added by themselves. You can also drop files on the page.", target: control(/^Add tracks/) },
      { title: "Search", text: "Type any word from a title, file name, artist or tag.", target: first("#view input[type=search]") },
      { title: "Filters", text: "Click a filter once to show only those tracks. Click it again to hide them. Use the order button to sort the filters.", target: region("Filters") },
      { title: "Columns", text: "Choose which columns the list shows. Click a column’s name to sort by it, and click it again to reverse the order.", target: control(/^Columns/) },
    ],
  },
  details: {
    name: "A track’s details",
    route: (p) => (p.trackId ? `#/library/${p.trackId}` : "#/library"),
    steps: [
      { title: "Your title", text: "Type a name you will recognise at the table. The title in the file does not change.", target: control(/^Your title/) },
      { title: "Tags", text: "Tag the track by mood, leitmotif and scene type. Dynamic playlists are built from tags, and you can search by them.", target: control(/^(Add a tag|Tags|Tag…)/) },
      { title: "Use it for", text: "Choose what the track is for: background, scene music, a short cue or a lead-in.", target: control(/^(Use it for|Role)/) },
      { title: "At its end", text: "Choose what happens when the track ends: it can loop, move to the next track, fade out, stop, or play something else.", target: control(/^(At its end|Ending|Looping)/) },
    ],
  },
  playlists: {
    name: "Playlists",
    route: () => "#/playlists",
    steps: [
      { title: "New playlist", text: "Pick the tracks yourself for a manual playlist. A dynamic playlist is filled with the tracks whose tags match its rules.", target: control(/^New playlist/) },
      { title: "Sort", text: "Sort the playlists in your order, by name, by size or by use.", target: control(/^Sort/) },
      { title: "Your order", text: "Drag a playlist by its grip, or use Move up and Move down in its ⋯ menu.", target: control(/^More for /) },
    ],
  },
  session: {
    name: "Planning a session",
    route: (p) => (p.session ? `#/session/${p.session.campaignId}/${p.session.sessionId}` : "#/campaigns"),
    steps: [
      { title: "Add a scene", text: "Each scene has its music, ambience, pad boards and notes.", target: control(/^Add scene/) },
      { title: "Open a scene", text: "Click a scene’s name to open it. Drag its grip to change the order of the scenes.", target: control(/^Scene \d+: /) },
      { title: "This session’s playlists", text: "You can play them from any scene in this session. Drag a track from an open playlist onto a scene’s music.", target: region("Session playlists") },
    ],
  },
  board: {
    name: "A pad board",
    route: (p) => (p.boardId ? `#/board/${p.boardId}` : "#/boards"),
    steps: [
      { title: "Pads", text: "Each pad plays a sound. Click a pad to select it, then choose its sound and play mode on the right.", target: first("#view [role=grid], #view .pb-grid") },
      { title: "Play mode", text: "Choose One-shot, Toggle loop, Hold to play or Restart on press.", target: control(/^(One-shot|Play mode)/) },
      { title: "While it plays", text: "Choose whether the music gets quieter while this pad plays.", target: control(/^While it plays/) },
    ],
  },
  // Round 10 (table review D-S7): what matters at the table. Arrange and Keys are in the article.
  live: {
    name: "Live",
    route: () => "#/live",
    steps: [
      { title: "Next scene", text: "Press Space to start the next scene. If you press it twice within a second, the second press is ignored.", target: control(/^(Next scene|Start)/) },
      { title: "On air: what the players hear", text: "This box shows each room, what it plays now and what comes next. The red light is on while the players hear something.", target: region("On air") },
      { title: "Preview: only you", text: "To hear a track in your headphones only, use the headphones button. Play on air, the last button on a row, is for the players.", target: control(/^Preview /) },
      { title: "Pads and their keys", text: "Click a pad or press its key to play it. Press Stop pads, beside them, to stop all pads.", target: first("#view .lv-pad") },
      { title: "Undo", text: "Undo shows here for 8 seconds after you change what the players hear. You can also press Ctrl+Z.", target: control(/^Undo/) },
      { title: "Fade all and Stop all", text: "Everything fades out with Fade all (Shift+Esc), or stops at once with Stop all, in your headphones too. You can undo both.", target: control(/^Fade all/) },
    ],
  },
  look: {
    name: "Look and feel",
    route: () => "#/look",
    steps: [{ title: "Look and feel", text: "Choose a theme here. You can also change the text size and how much moves on screen. A campaign can have a theme of its own.", target: first("#view h1") }],
  },
};

/** The tour and the article for the screen Help was opened from (Help's "On this screen"). */
export const SCREEN_HELP: Partial<Record<RouteName, { tour: TourKey; article?: string }>> = {
  library: { tour: "library", article: "add-music" },
  playlists: { tour: "playlists", article: "dynamic-playlist" },
  playlist: { tour: "playlists", article: "dynamic-playlist" },
  session: { tour: "session", article: "plan-campaign" },
  campaign: { tour: "session", article: "plan-campaign" },
  campaigns: { tour: "session", article: "plan-campaign" },
  boards: { tour: "board", article: "pad-boards" },
  board: { tour: "board", article: "pad-boards" },
  live: { tour: "live", article: "live" },
  settings: { tour: "settings", article: "rooms-and-bots" },
  profile: { tour: "details", article: "audio-profile" },
  look: { tour: "look" },
};

/** A tour's steps whose controls are on screen now. */
export function stepsOnScreen(def: TourDef): TourStep[] {
  return def.steps.filter((step) => step.target() !== null);
}
