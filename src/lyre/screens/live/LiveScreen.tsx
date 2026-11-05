/**
 * Live (route `live`, UX-2, UX-8, UX-12, UX-14, SFX-2, OUT-6, SHW-1, SHW-2, SHW-3): the screen the game master runs a
 * game from, ported from design/prototype/src/views/live.js and live.css. Built to work in half of a 1920 screen.
 *
 * Order of importance: what is on air (one box per room), the scenes, the scene's music, Off script search, then the
 * pads (folded at first). One column below 820 px of the app, two up to 1200 px, three above; the page scrolls as a
 * whole and Scene music sits above the On air boxes.
 *
 * The audio host is the engine: Live reads getNowPlaying() and calls it (startScene, playTrack, firePad, undo…); it
 * keeps no sound of its own. What Live keeps (the scene on now, To: choices, the search) is in liveState.ts, so it
 * is the same after a visit to another screen. Keys: Space next scene, / search, pad keys (single-key shortcuts, can
 * be switched off), Shift+Esc fade all, Ctrl+Z undo the scene change, Esc clear the search.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useBoards, useCampaigns, useProfileOverrides, useTagGroups, usePlaylists, useTracks } from "../../api";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { loadInLive, useLiveSession } from "../../kit/liveSession";
import { usePlayOrders } from "../../kit/playOrders";
import { useTrackNames } from "../../kit/trackName";
import { useOutputs } from "../../outputs/OutputsProvider";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { useRememberedOpen } from "../../shell/ShellSettings";
import type { ScreenComponent } from "../index";
import { libraryIndex } from "../campaigns/model";
import { sessionLabel } from "../campaigns/model";
import { LiveDataProvider, sceneRefOf, type LiveData } from "./liveData";
import { boxTarget, currentBoard, defaultLiveSession, liveKey, liveRooms, padForKey, UNDO_MS } from "./liveModel";
import { getLiveState, standbyFor, updateLive, useLiveState } from "./liveState";
import { LiveTop } from "./LiveTop";
import { OffScriptPane } from "./OffScript";
import { OnAirBoxes } from "./OnAir";
import { firePads, PadsPane } from "./Pads";
import { SceneMusicPane } from "./SceneMusic";
import { focusLive, ScenesPane } from "./Scenes";
import "./live.css";

/** Where the single-key shortcuts choice is kept (this page only). */
const KEYS1_KEY = "lyre-live-keys1";
/** Layout from the width of the app: one column below 820 px, two up to 1200 px, three above (live.js layoutFor). */
const TWO_COLUMNS_PX = 820;
const THREE_COLUMNS_PX = 1200;

type PaneId = "onair" | "scenes" | "music" | "off" | "pads";
const LAYOUT: Record<1 | 2 | 3, PaneId[][]> = {
  1: [["music", "onair", "off", "scenes", "pads"]],
  2: [
    ["scenes", "off"],
    ["music", "onair", "pads"],
  ],
  3: [["scenes"], ["music", "onair"], ["off", "pads"]],
};

function readKeys1(): boolean {
  try {
    return localStorage.getItem(KEYS1_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The number of columns for the app's width, following it as the window changes. */
function useColumns(): 1 | 2 | 3 {
  const of = (w: number): 1 | 2 | 3 => (w >= THREE_COLUMNS_PX ? 3 : w >= TWO_COLUMNS_PX ? 2 : 1);
  const measure = () => {
    const app = document.getElementById("app");
    const w = app ? app.getBoundingClientRect().width : 0;
    return of(w > 0 ? w : 960);
  };
  const [columns, setColumns] = useState(measure);
  useLayoutEffect(() => {
    const app = document.getElementById("app");
    const update = () => setColumns(measure());
    update();
    if (!app || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(app);
    return () => observer.disconnect();
  }, []);
  return columns;
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
  const orders = usePlayOrders();
  const names = useTrackNames();
  const { outputs, client } = useOutputs();
  const loaded = useLiveSession();
  const inHand = useCampaignInHand();
  const state = useLiveState();
  const { say, toast } = useAnnounce();
  const columns = useColumns();
  const [keys1, setKeys1State] = useState(readKeys1);
  const [keysOpen, setKeysOpenState] = useState(false);
  const [offOpen, setOffOpen] = useRememberedOpen("lv-off", true);

  const index = useMemo(() => (tracks && playlists && boards ? libraryIndex(tracks, playlists, boards) : null), [tracks, playlists, boards]);
  const wanted = campaigns ? defaultLiveSession(campaigns, loaded, inHand) : null;

  // The session shown: the one loaded, else a default, which is then loaded (the rail says "Live: S14"). Another
  // session than the one Live last showed waits on standby with nothing started.
  useEffect(() => {
    if (!wanted) return;
    if (!loaded || loaded.campaignId !== wanted.campaignId || loaded.sessionId !== wanted.sessionId) loadInLive(wanted);
    const had = getLiveState().session;
    if (!had || had.campaignId !== wanted.campaignId || had.sessionId !== wanted.sessionId) standbyFor(wanted);
  }, [wanted?.campaignId, wanted?.sessionId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const rooms = useMemo(() => liveRooms(outputs, now), [outputs, now]);
  const campaign = campaigns?.find((c) => c.id === state.session?.campaignId);
  const session = campaign?.sessions.find((s) => s.id === state.session?.sessionId);
  const sceneIndex = state.now >= 0 ? state.now : state.standby;
  const scene = session?.scenes[sceneIndex] ?? (state.now < 0 ? (session?.scenes[0] ?? null) : null);

  const data: LiveData | null =
    index && campaigns && campaign && session
      ? { audio, now, index, campaigns, campaign, session, scene, sceneIndex, state, rooms, outputs, client, names, overrides: overrides ?? {}, orders, tagGroups: tagGroups ?? [], keys1 }
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
      updateLive({
        now: i,
        standby: Math.min(i + 1, d.session.scenes.length),
        undo: { before: { now: s.now, standby: s.standby }, label: left, started: target.name, until: Date.now() + UNDO_MS },
        list: null,
        board: null,
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
  const undo = useCallback(() => {
    const offer = getLiveState().undo;
    if (!offer) return false;
    updateLive({ undo: null });
    const outcome = dataRef.current?.audio.undoSceneStart();
    if (!outcome?.ok) return true;
    updateLive({ now: offer.before.now, standby: offer.before.standby, list: null, board: null });
    focusLive("nextsc");
    say(`Back to ${offer.label}, with its music and ambience`);
    return true;
  }, [say]);
  const sceneActions = useMemo(() => ({ start: changeScene, next: nextScene, undo }), [changeScene, nextScene, undo]);

  /** Load another session from the session menu: on standby, fading out music from any other session (3 s). */
  const loadSession = useCallback(
    (campaignId: string, sessionId: string) => {
      const d = dataRef.current;
      const s = getLiveState().session;
      if (!d || (s?.campaignId === campaignId && s.sessionId === sessionId)) return;
      const first = d.rooms[0] ? { room: d.rooms[0].roomId } : undefined;
      const firstRoom = d.now.rooms[0];
      const fromThere = firstRoom?.music?.origin.kind === "scene" && firstRoom.music.origin.scene.campaignId === campaignId && firstRoom.music.origin.scene.sessionId === sessionId;
      if (firstRoom?.music && !fromThere) d.audio.stopLane("music", { target: first, fadeMs: 3000 });
      if (firstRoom?.ambience) d.audio.stopLane("ambience", { target: first, fadeMs: 3000 });
      loadInLive({ campaignId, sessionId });
      standbyFor({ campaignId, sessionId });
      const c = d.campaigns.find((x) => x.id === campaignId);
      const ss = c?.sessions.find((x) => x.id === sessionId);
      if (c && ss) toast(`Loaded ${c.name}, ${sessionLabel(ss).toLowerCase()}.${ss.scenes[0] ? ` Press Space to start ${ss.scenes[0].name}.` : ""}`);
    },
    [toast],
  );

  /* ---------- keys ---------- */

  const keysOpenRef = useRef(keysOpen);
  keysOpenRef.current = keysOpen;
  const keyNav = useRef(false);
  // The latest callbacks, so the key listeners are added once and a held pad is never let go by a redraw.
  const calls = useRef({ nextScene, undo, say, setKeysOpen, setOffOpen });
  calls.current = { nextScene, undo, say, setKeysOpen, setOffOpen };
  const heldKeys = useRef(new Map<string, () => void>());
  useEffect(() => {
    const onTab = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyNav.current = true;
    };
    const onPointer = () => {
      keyNav.current = false;
    };
    const focusSearch = () => {
      calls.current.setOffOpen(true);
      focusLive("search");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const d = dataRef.current;
      const { nextScene, undo, say, setKeysOpen } = calls.current;
      if (!d || event.defaultPrevented || document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      const s = getLiveState();
      const decision = liveKey({
        key: event.key,
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTyping(target),
        inSearch: target?.dataset?.lv === "search",
        searchValue: (target as HTMLInputElement | null)?.value ?? "",
        onControl: !!target && target !== document.body && target.matches("button, a, [role=menuitem]"),
        keyNav: keyNav.current,
        keys1: d.keys1,
        keysOpen: keysOpenRef.current,
        searchActive: s.search.q !== "" || s.search.tags.length > 0,
      });
      const handled = () => event.preventDefault();
      switch (decision.kind) {
        case "none":
          return;
        case "swallow":
          return handled();
        case "fadeAll":
          setKeysOpen(false, false);
          d.audio.fadeAll();
          return handled();
        case "closeKeys":
          setKeysOpen(false, true);
          return handled();
        case "undo":
          if (undo()) handled();
          return;
        case "clearSearchBox":
          updateLive((x) => ({ search: { ...x.search, q: "" } }));
          return handled();
        case "leaveSearchBox":
          target?.blur();
          return handled();
        case "clearSearch":
          updateLive((x) => ({ search: { ...x.search, q: "", tags: [] } }));
          say("Search cleared");
          return handled();
        case "nextScene":
          nextScene();
          return handled();
        case "focusSearch":
          focusSearch();
          return handled();
        case "pad": {
          const board = currentBoard(s.board, d.scene, d.index);
          const pad = board && padForKey(board, decision.key);
          if (!board || !pad) return;
          handled();
          if (event.repeat || heldKeys.current.has(decision.key)) return;
          const targets = boxTarget(d.rooms, s.to.pads).targets;
          firePads(d.audio, d.now, targets, board, pad, "down");
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
    document.addEventListener("keydown", onTab, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onTab, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      onBlur();
    };
  }, []);
  if (!data) return null;
  const compact = columns === 1;
  const panes: Record<PaneId, React.ReactNode> = {
    onair: <OnAirBoxes key="onair" />,
    scenes: <ScenesPane key="scenes" compact={compact} actions={sceneActions} />,
    music: <SceneMusicPane key="music" />,
    off: <OffScriptPane key="off" open={offOpen} onOpenChange={setOffOpen} keys1={keys1} />,
    pads: <PadsPane key="pads" />,
  };
  return (
    <LiveDataProvider value={data}>
      <div className="lv">
        <LiveTop keysOpen={keysOpen} setKeysOpen={setKeysOpen} setKeys1={setKeys1} loadSession={loadSession} />
        <div className={`lv-cols c${columns}`}>
          {LAYOUT[columns].map((ids) => (
            <div className="col" key={ids.join("-")}>
              {ids.map((id) => panes[id])}
            </div>
          ))}
        </div>
      </div>
    </LiveDataProvider>
  );
};

// The room boxes show what each room hears, so the Now playing bar shows only the preview here (UX-16).
LiveScreen.showsOnAir = true;
