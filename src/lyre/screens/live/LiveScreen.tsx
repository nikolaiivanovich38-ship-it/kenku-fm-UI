/**
 * Live (route `live`): the screen the game master runs a game from, ported from design/prototype/src/views/live.js and
 * live.css (round 6 parts 3 to 7, round 7 part 2).
 *
 * Seven boxes, each with one job, a plain name and a place that never moves during play (SHW-8): On air at the top,
 * the whole width, always in view (a part per room); under it Scenes and Current scene, each as tall as its contents;
 * then the trays: "This session" (Session playlists, Session pads) and "Whole campaign" (Campaign playlists, Campaign
 * pads), folded at first, growing with their contents while the page scrolls. Find a track or playlist is a field in
 * the top strip. Columns come from the width of the app: one below 820 px, two up to 1200 px, three above.
 *
 * The audio host is the engine: Live reads getNowPlaying() and calls it (startScene, playTrack, playNext, firePad,
 * undo…); it keeps no sound of its own. What Live keeps (the scene on now, To: choices, open boxes, Find) is in
 * liveState.ts, so it is the same after a visit to another screen. Keys (Settings › Keyboard shortcuts, UX-12): Space
 * next scene (a second press within a second is ignored), / Find, pad keys (single-key shortcuts, can be switched
 * off), Shift+Esc fade all, Ctrl+Z undo the last change, Alt+1 to 7 and F6 go to a box, Esc closes Find.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_LIBRARY_NORMALISE, guardAllows, keyName, shortcutKey } from "../../../common/domain";
import { GLOBAL_KEY_EVENT } from "../../../common/globalKeys";
import { useBoards, useCampaigns, useLyreQuery, useProfileOverrides, useSettings, useTagGroups, usePlaylists, useTracks } from "../../api";
import { useLyreAudio, useLyreAudioEvent, useNowPlaying, type LyreAudio } from "../../audio";
import { loadInLive, takeNextScene, useLiveSession } from "../../kit/liveSession";
import { usePlayOrders } from "../../kit/playOrders";
import { useTrackNames } from "../../kit/trackName";
import { useOutputs } from "../../outputs/OutputsProvider";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { zoomFactorOf } from "../../shell/display";
import type { ScreenComponent } from "../index";
import { libraryIndex } from "../campaigns/model";
import { sessionLabel } from "../campaigns/model";
import { CurrentScenePane } from "./CurrentScene";
import { closeFind, openFind } from "./Find";
import { focusBox, focusLiveSoon, focusLive } from "./focus";
import { LiveDataProvider, sceneRefOf, type LiveData } from "./liveData";
import { boxTarget, currentBoard, defaultLiveSession, LIVE_BOXES, LIVE_KEYS, liveKey, liveRooms, padForKey, padStepWords, UNDO_MS, type LiveKeys } from "./liveModel";
import { getLiveState, standbyFor, touched, updateLive, useLiveState } from "./liveState";
import { LiveTop } from "./LiveTop";
import { OnAirPane } from "./OnAir";
import { firePads } from "./Pads";
import { ScenesPane } from "./Scenes";
import { PadsBox, PlaylistsBox } from "./Trays";
import "./live.css";

/** Where the single-key shortcuts choice is kept (this page only). */
const KEYS1_KEY = "lyre-live-keys1";
/** Layout from the width of the app: one column below 820 px, two up to 1200 px, three above (live.js layoutFor). */
const TWO_COLUMNS_PX = 820;
const THREE_COLUMNS_PX = 1200;
/** What plays from another session fades this long when a session is loaded. */
const SESSION_FADE_MS = 3000;

type BoxId = "scenes" | "current" | "ssp" | "ssd" | "cpp" | "cpd";
/**
 * On air is above, the whole width (round 6 part 6); under it Scenes and Current scene where the eye starts, then the
 * session's things, then the campaign's. Alt+1 to 7 and F6 follow LIVE_BOXES, the same in every layout.
 */
const LAYOUT: Record<1 | 2 | 3, BoxId[][]> = {
  1: [["scenes", "current", "ssp", "ssd", "cpp", "cpd"]],
  2: [
    ["scenes", "ssp", "ssd", "cpp", "cpd"],
    ["current"],
  ],
  3: [["scenes"], ["current"], ["ssp", "ssd", "cpp", "cpd"]],
};

function readKeys1(): boolean {
  try {
    return localStorage.getItem(KEYS1_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The number of columns for a width of the app (unmeasured counts as half of a 1920 screen). */
function columnsFor(width: number): 1 | 2 | 3 {
  const w = width > 0 ? width : 960;
  return w >= THREE_COLUMNS_PX ? 3 : w >= TWO_COLUMNS_PX ? 2 : 1;
}

function appWidth(): number {
  return document.getElementById("app")?.getBoundingClientRect().width ?? 0;
}

/** The app's width in CSS pixels, following it as the window changes. */
function useAppWidth(): number {
  const [width, setWidth] = useState(appWidth);
  useLayoutEffect(() => {
    const app = document.getElementById("app");
    const update = () => setWidth(appWidth());
    update();
    if (!app || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(app);
    return () => observer.disconnect();
  }, []);
  return width;
}

/**
 * Another session loaded (Run, the session menu): what plays in the first room from elsewhere fades out over 3 s, so
 * the new session starts clean (live.js L.liveStandby); music already from that session plays on. Every room's list
 * of what was added for the evening is cleared (the audio host's sessionLoaded).
 */
function fadeOtherSession(audio: LyreAudio, session: { campaignId: string; sessionId: string }): void {
  const first = audio.getNowPlaying().rooms[0];
  const o = first?.music?.origin;
  const fromThere = o?.kind === "scene" && o.scene.campaignId === session.campaignId && o.scene.sessionId === session.sessionId;
  if (first?.music && !fromThere) audio.stopLane("music", { fadeMs: SESSION_FADE_MS });
  if (first?.ambience) audio.stopLane("ambience", { fadeMs: SESSION_FADE_MS });
  audio.sessionLoaded();
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export const LiveScreen: ScreenComponent = function LiveScreen() {
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const campaigns = useCampaigns().data;
  const tracks = useTracks().data;
  const playlists = usePlaylists().data;
  const boards = useBoards().data;
  const overrides = useProfileOverrides().data;
  const tagGroups = useTagGroups().data;
  const settingsQuery = useSettings();
  const settings = settingsQuery.data;
  // UX-12: Live waits for the keys Settings has, so a key changed there never does what it did before for a moment.
  const keysKnown = settings !== undefined || settingsQuery.error !== null;
  const normalise = useLyreQuery("normalise-settings", (api) => api.library.normaliseSettings(), ["tracks"]).data;
  const orders = usePlayOrders();
  const names = useTrackNames();
  const { outputs, client } = useOutputs();
  const loaded = useLiveSession();
  const inHand = useCampaignInHand();
  const state = useLiveState();
  const { say, toast } = useAnnounce();
  const width = useAppWidth();
  const columns = columnsFor(width);
  const [keys1, setKeys1State] = useState(readKeys1);
  const [keysOpen, setKeysOpenState] = useState(false);

  const index = useMemo(() => (tracks && playlists && boards ? libraryIndex(tracks, playlists, boards) : null), [tracks, playlists, boards]);
  const wanted = campaigns ? defaultLiveSession(campaigns, loaded, inHand) : null;
  const shortcuts = settings?.shortcuts;
  const keys: LiveKeys = useMemo(
    () => (shortcuts ? { nextScene: shortcutKey(shortcuts, "nextScene"), fadeAll: shortcutKey(shortcuts, "fadeAll"), undo: shortcutKey(shortcuts, "undo"), find: shortcutKey(shortcuts, "find"), palette: shortcutKey(shortcuts, "palette") } : LIVE_KEYS),
    [shortcuts],
  );

  // The session shown: the one loaded, else a default, which is then loaded (the rail says "Live: S14"). Another
  // session than the one Live last showed waits on standby with nothing started.
  useEffect(() => {
    if (!wanted) return;
    if (!loaded || loaded.campaignId !== wanted.campaignId || loaded.sessionId !== wanted.sessionId) loadInLive(wanted);
    const had = getLiveState().session;
    if (had && (had.campaignId !== wanted.campaignId || had.sessionId !== wanted.sessionId)) fadeOtherSession(audio, wanted);
    if (!had || had.campaignId !== wanted.campaignId || had.sessionId !== wanted.sessionId) standbyFor(wanted);
  }, [wanted?.campaignId, wanted?.sessionId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const rooms = useMemo(() => liveRooms(outputs, now), [outputs, now]);
  const campaign = campaigns?.find((c) => c.id === state.session?.campaignId);
  const session = campaign?.sessions.find((s) => s.id === state.session?.sessionId);
  const scene = state.now >= 0 ? (session?.scenes[state.now] ?? null) : null;

  const data: LiveData | null =
    index && campaigns && campaign && session && keysKnown
      ? {
          audio,
          now,
          index,
          campaigns,
          campaign,
          session,
          scene,
          sceneIndex: state.now,
          state,
          rooms,
          outputs,
          client,
          names,
          overrides: overrides ?? {},
          orders,
          tagGroups: tagGroups ?? [],
          keys1,
          keys,
          guard: settings?.nextSceneGuard ?? true,
          normalise: normalise ?? DEFAULT_LIBRARY_NORMALISE,
        }
      : null;
  const dataRef = useRef(data);
  dataRef.current = data;

  const setKeys1 = useCallback(
    (on: boolean) => {
      setKeys1State(on);
      try {
        localStorage.setItem(KEYS1_KEY, on ? "on" : "off");
      } catch {
        /* storage unavailable: lasts for this visit */
      }
      say(`Single-key shortcuts ${on ? "on" : "off"}`);
    },
    [say],
  );
  const setKeysOpen = useCallback((open: boolean, refocus: boolean) => {
    setKeysOpenState(open);
    if (!open && refocus) focusLive("keys");
  }, []);

  /* ---------- scenes ---------- */

  const changeScene = useCallback(
    (i: number) => {
      const d = dataRef.current;
      if (!d) return;
      const target = d.session.scenes[i];
      if (!target) return;
      const s = getLiveState();
      const left = s.now < 0 ? "before the first scene" : (d.session.scenes[s.now]?.name ?? "the previous scene");
      const outcome = d.audio.startScene(sceneRefOf(d.campaign.id, d.session.id, target));
      if (!outcome.ok) return;
      // A new scene is a change of mood: the audio host clears what was added to the room's list (Nik, 6 Nov 13:55)
      // and the room's Repeat; the scene's Undo brings them back.
      updateLive({
        now: i,
        standby: Math.min(i + 1, d.session.scenes.length),
        undo: { before: { now: s.now, standby: s.standby }, label: left, started: target.name, until: Date.now() + UNDO_MS },
        undo2: null,
        boards: { ...s.boards, sc: null },
        notesOpen: false,
      });
      say(`Started ${target.name}. Undo is available for 8 seconds, or press Ctrl+Z.`);
    },
    [say],
  );
  const nextScene = useCallback(() => {
    const d = dataRef.current;
    if (!d) return;
    const s = getLiveState();
    const active = document.activeElement as HTMLElement | null;
    const keep = !active || active === document.body || !document.getElementById("view")?.contains(active) || active.dataset.lv === "nextsc";
    if (!d.session.scenes[s.standby]) {
      toast("That was the last scene");
      return;
    }
    changeScene(s.standby);
    if (keep) focusLive("nextsc");
  }, [changeScene, toast]);
  /** Ctrl+Z and the strips: the last change only (Must 1), a scene change or any other. */
  const undo = useCallback(() => {
    const s = getLiveState();
    if (s.undo2) {
      const offer = s.undo2;
      updateLive({ undo2: null });
      offer.restore();
      // UX-R4: what comes back may be drawn a moment later (a room whose bot rejoins); focus waits for it.
      focusLiveSoon([offer.focus || "nextsc", "nextsc"]);
      say(`Undone: ${offer.text}`);
      return true;
    }
    const offer = s.undo;
    if (!offer) return false;
    updateLive({ undo: null });
    const outcome = dataRef.current?.audio.undoSceneStart();
    if (!outcome?.ok) return true;
    updateLive({ now: offer.before.now, standby: offer.before.standby, boards: { ...getLiveState().boards, sc: null } });
    focusLive("nextsc");
    say(`Back to ${offer.label}, with its music and ambience`);
    return true;
  }, [say]);
  const sceneActions = useMemo(() => ({ start: changeScene, next: nextScene, undo }), [changeScene, nextScene, undo]);

  // PLY-8: a scene started by another's step, or moving on by itself, is the scene on now; a step can show a board.
  useLyreAudioEvent("scene-started", (at) => {
    const d = dataRef.current;
    if (!d || at.by === "press" || at.scene.campaignId !== d.campaign.id || at.scene.sessionId !== d.session.id) return;
    const i = d.session.scenes.findIndex((sc) => sc.id === at.scene.sceneId);
    if (i < 0) return;
    updateLive((s) => ({ now: i, standby: Math.min(i + 1, d.session.scenes.length), boards: { ...s.boards, sc: null }, notesOpen: false }));
  });
  useLyreAudioEvent("show-board", (at) => {
    updateLive((s) => ({ boards: { ...s.boards, sc: at.boardId } }));
  });

  /** Load another session from the session menu: on standby, fading out music from any other session (3 s). */
  const loadSession = useCallback(
    (campaignId: string, sessionId: string) => {
      const d = dataRef.current;
      const s = getLiveState().session;
      if (!d || (s?.campaignId === campaignId && s.sessionId === sessionId)) return;
      fadeOtherSession(d.audio, { campaignId, sessionId });
      loadInLive({ campaignId, sessionId });
      standbyFor({ campaignId, sessionId });
      const c = d.campaigns.find((x) => x.id === campaignId);
      const ss = c?.sessions.find((x) => x.id === sessionId);
      if (c && ss) toast(`Loaded ${c.name}, ${sessionLabel(ss).toLowerCase()}.${ss.scenes[0] ? ` Press ${d.keys.nextScene} to start ${ss.scenes[0].name}.` : ""}`);
    },
    [toast],
  );

  /* ---------- keys ---------- */

  const keysOpenRef = useRef(keysOpen);
  keysOpenRef.current = keysOpen;
  const keyNav = useRef(false);
  // The latest callbacks, so the key listeners are added once and a held pad is never let go by a redraw.
  const calls = useRef({ nextScene, undo, say, toast, setKeysOpen });
  calls.current = { nextScene, undo, say, toast, setKeysOpen };
  const heldKeys = useRef(new Map<string, () => void>());
  useEffect(() => {
    const onTab = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyNav.current = true;
      // UX-12: F6 goes through the seven boxes in their order (Alt+1 to 7), whatever the columns; it is Live's, not the
      // shell's, unless a pad of Current scene's board has F6 as its key (pad keys F1 to F12 win in Live).
      if (event.key === "F6" && !event.ctrlKey && !event.altKey && !document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) {
        const d = dataRef.current;
        const board = d && currentBoard(getLiveState().boards.sc, d.scene, d.index);
        if (d?.keys1 && board && padForKey(board, "f6")) return;
        const heads = LIVE_BOXES.filter((b) => document.querySelector(`#view [data-pane="${b.id}"] .pane-toggle`));
        if (!heads.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const inBox = (document.activeElement as HTMLElement | null)?.closest?.("[data-pane]")?.getAttribute("data-pane");
        const at = heads.findIndex((b) => b.id === inBox);
        const next = heads[(at + (event.shiftKey ? -1 : 1) + heads.length) % heads.length];
        const words = focusBox(next.id);
        if (words) calls.current.say(words);
      }
    };
    const onPointer = () => {
      keyNav.current = false;
    };
    const focusSearch = () => {
      openFind();
      const field = document.querySelector<HTMLInputElement>('[data-lv="search"]');
      field?.focus();
      field?.select();
    };
    /** UX-12: Next scene pressed with its key; a second press within a second is ignored, so it never skips a scene. */
    const nextSceneKey = (d: LiveData) => {
      const at = Date.now();
      if (!guardAllows(getLiveState().lastNextKey, at, d.guard)) {
        calls.current.say("A second Next scene within a second: ignored");
        return;
      }
      updateLive({ lastNextKey: at });
      calls.current.nextScene();
    };
    const fadeAllKey = (d: LiveData) => {
      calls.current.setKeysOpen(false, false);
      touched();
      d.audio.fadeAll();
    };
    /**
     * Keys that Settings lets work in other programs too reach the page only as this event (Windows gives them to the
     * registration, not to the page): the same Next scene and Fade all as the keys pressed here. Taking it
     * (preventDefault) tells the shell not to fade on its own. Until Settings' keys have loaded, Live takes nothing.
     */
    const onGlobalKey = (event: Event) => {
      const d = dataRef.current;
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (!d) return;
      if (action === "nextScene") nextSceneKey(d);
      else if (action === "fadeAll") fadeAllKey(d);
      else return;
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const d = dataRef.current;
      const { undo, say, setKeysOpen } = calls.current;
      if (!d || event.defaultPrevented || document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      const s = getLiveState();
      const decision = liveKey({
        key: event.key,
        name: keyName(event),
        code: event.code,
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTyping(target),
        inSearch: target?.dataset?.lv === "search",
        searchValue: (target as HTMLInputElement | null)?.value ?? "",
        onControl: !!target && target !== document.body && target.matches("button, a, [role=menuitem]"),
        onSceneName: !!target?.dataset?.scene,
        keyNav: keyNav.current,
        keys1: d.keys1,
        keysOpen: keysOpenRef.current,
        findOpen: s.findOpen,
        searchActive: s.search.q !== "" || s.search.tags.length > 0,
        keys: d.keys,
      });
      const handled = () => event.preventDefault();
      switch (decision.kind) {
        case "none":
          return;
        case "swallow":
          return handled();
        case "goBox": {
          const words = focusBox(LIVE_BOXES[decision.box].id);
          if (words) say(words);
          return handled();
        }
        case "fadeAll":
          fadeAllKey(d);
          return handled();
        case "closeKeys":
          setKeysOpen(false, true);
          return handled();
        case "undo":
          if (undo()) handled();
          return;
        case "clearSearchBox":
          updateLive((x) => ({ search: { ...x.search, q: "", tags: [] } }));
          return handled();
        case "leaveSearchBox":
          // UX-R4: the results close and focus stays in the field (as in the prototype), not on the page.
          closeFind(false);
          return handled();
        case "closeFind":
          closeFind(true);
          return handled();
        case "clearSearch":
          updateLive((x) => ({ search: { ...x.search, q: "", tags: [] } }));
          say("Search cleared");
          return handled();
        case "nextScene":
          handled();
          nextSceneKey(d);
          return;
        case "focusSearch":
          focusSearch();
          return handled();
        case "unfoldScene":
        case "foldScene": {
          const id = target?.dataset?.scene;
          if (!id) return;
          const want = decision.kind === "unfoldScene";
          if (!!s.scOpen[id] !== want) updateLive((x) => ({ scOpen: { ...x.scOpen, [id]: want } }));
          return handled();
        }
        case "pad": {
          const board = currentBoard(s.boards.sc, d.scene, d.index);
          const pad = board && padForKey(board, decision.key);
          if (!board || !pad) return;
          handled();
          if (event.repeat || heldKeys.current.has(decision.key)) return;
          const targets = boxTarget(d.rooms, s.to.music).targets;
          touched();
          firePads(d.audio, d.now, targets, board, pad, "down");
          const words = padStepWords(pad);
          if (words) calls.current.toast(words);
          if (pad.mode === "hold") heldKeys.current.set(decision.key, () => firePads(d.audio, dataRef.current?.now ?? d.now, targets, board, pad, "up"));
          else heldKeys.current.set(decision.key, () => undefined);
          return;
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const release = heldKeys.current.get(key);
      if (!release) return;
      heldKeys.current.delete(key);
      release();
    };
    const onBlur = () => {
      heldKeys.current.forEach((release) => release());
      heldKeys.current.clear();
    };
    window.addEventListener("keydown", onTab, true);
    window.addEventListener(GLOBAL_KEY_EVENT, onGlobalKey);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onTab, true);
      window.removeEventListener(GLOBAL_KEY_EVENT, onGlobalKey);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      onBlur();
    };
  }, []);
  // w51-fix2: Next scene pressed in another program while another screen showed opened Live: move on once drawn.
  const ready = !!data;
  useEffect(() => {
    if (!ready || !takeNextScene()) return;
    updateLive({ lastNextKey: Date.now() });
    calls.current.nextScene();
  }, [ready]);
  if (!data) return null;
  // One column shows only Now and Next in Scenes, in a narrow window; a wide window in one column because its text is
  // large (Look and feel › Display, UX-11) has room to list every scene.
  const compact = columns === 1 && (width > 0 ? width : 960) * zoomFactorOf(settings?.display?.textSize ?? 100) < TWO_COLUMNS_PX;
  const boxes: Record<BoxId, React.ReactNode> = {
    scenes: <ScenesPane key="scenes" compact={compact} actions={sceneActions} />,
    current: <CurrentScenePane key="current" />,
    ssp: <PlaylistsBox key="ssp" scope="ss" />,
    ssd: <PadsBox key="ssd" scope="ss" />,
    cpp: <PlaylistsBox key="cpp" scope="cp" />,
    cpd: <PadsBox key="cpd" scope="cp" />,
  };
  return (
    <LiveDataProvider value={data}>
      <div className="lv">
        <LiveTop keysOpen={keysOpen} setKeysOpen={setKeysOpen} setKeys1={setKeys1} loadSession={loadSession} />
        <OnAirPane undo={undo} />
        <div className={`lv-cols c${columns}`} data-scroll="lv-page">
          {LAYOUT[columns].map((ids) => (
            <div className={columns === 3 && /^(ss|cp)/.test(ids[0]) ? "col lv-c-trays" : "col"} key={ids.join("-")}>
              {trays(ids).map((group) =>
                group.scope ? (
                  // A tray per scope: the session's boxes on a filled tray, the campaign's on an outlined one (Should 6).
                  <div className={`lv-grp lv-grp-${group.scope}`} key={group.scope}>
                    <p className="lv-grp-h" aria-hidden="true">
                      {group.scope === "ss" ? "This session" : "Whole campaign"}
                    </p>
                    {group.ids.map((id) => boxes[id])}
                  </div>
                ) : (
                  boxes[group.ids[0]]
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </LiveDataProvider>
  );
};

/** The boxes of a column, the session's and the campaign's grouped in their trays. */
function trays(ids: BoxId[]): { scope: "ss" | "cp" | ""; ids: BoxId[] }[] {
  const out: { scope: "ss" | "cp" | ""; ids: BoxId[] }[] = [];
  for (const id of ids) {
    const scope = id.startsWith("ss") ? "ss" : id.startsWith("cp") ? "cp" : "";
    const last = out[out.length - 1];
    if (scope && last?.scope === scope) last.ids.push(id);
    else out.push({ scope, ids: [id] });
  }
  return out;
}

// On air shows what each room hears, so the Now playing bar shows only the preview here (UX-16).
LiveScreen.showsOnAir = true;
