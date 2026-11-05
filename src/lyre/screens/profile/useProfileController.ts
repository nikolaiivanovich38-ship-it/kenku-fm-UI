/**
 * Everything the Audio profile screen does, for its boxes to call: the preview clock and its sound, the points and
 * fades, markers, places, Play on air and the single-key shortcuts. Ported from the actions in the prototype's
 * views/profile.js (L.acts.ap*, L.inputs.ap*, handleKey, scrubKey and its L.onKey handler).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { parsePlaceKey, resolveProfile, sceneSequence, type AfterEnd } from "../../../common/domain";
import { shownTitle } from "../../../common/lyre/text";
import type { TrackFrom } from "../../audio";
import { useLyreAudio, useLyreAudioEvent, useNowPlaying } from "../../audio/LyreAudioProvider";
import type { PreviewPosition } from "../../audio";
import { useAnnounce } from "../../shell/Announcer";
import { nextContexts, placeName, sceneOf, type NextContext } from "./places";
import { advance, finishClock, follow, initialClock, pauseClock, playClock, seekClock, stopClock, type ClockState, type ClockWorld } from "./previewClock";
import {
  addMarker,
  fmt,
  fromDomain,
  isLength,
  movePoint,
  parseTime,
  pointText,
  POINT,
  rangeOf,
  toInput,
  valueOf,
  wholeTrack,
  type Prof,
  type Which,
} from "./profileModel";
import { useKeys1 } from "./useKeys1";
import type { ProfileEditor } from "./useProfileEditor";

/** After choosing another place, the screen opens again; this control gets the focus back (by its data-k). */
let focusOnOpen: string | null = null;

/** A time or length being typed: the text, and the profile as it was before typing began. */
interface Editing {
  which: Which;
  text: string;
  base: Prof;
  changed: boolean;
}

/** Follows the pointer until it is let go (anywhere on the page). */
function dragWith(onMove: (e: PointerEvent) => void, onEnd: () => void): void {
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

const READ_ONLY_NOTE = "These are the track's settings. Give this place its own settings to change them here.";

export type ProfileController = ReturnType<typeof useProfileController>;

export function useProfileController(editor: ProfileEditor, rootRef: React.RefObject<HTMLElement>) {
  const { track, dur, prof: p, editable, key, view } = editor;
  const audio = useLyreAudio();
  const { say, toast } = useAnnounce();
  const [keys1, setKeys1Raw] = useKeys1();
  const title = shownTitle(track);

  /* ---------- the preview clock ---------- */

  const [clock, setClockState] = useState<ClockState>(() => initialClock(p));
  const clockRef = useRef(clock);
  const setClock = useCallback((s: ClockState) => {
    clockRef.current = s;
    setClockState(s);
  }, []);

  const contexts = useMemo(() => nextContexts(track.id, key, view), [track.id, key, view]);
  const [ctxIndex, setCtxIndex] = useState(0);
  const ctx: NextContext | undefined = contexts[Math.min(ctxIndex, contexts.length - 1)];

  /** A track's profile in a place ("" for its own), as the library resolves it. */
  const domainProfileOf = useCallback(
    (id: string, placeKey: string) => {
      const t = view.track(id);
      const place = placeKey ? parsePlaceKey(placeKey) : null;
      return t ? resolveProfile(t, place ? [place] : [], view.overrides).profile : null;
    },
    [view],
  );
  /** The same in the screen's seconds. */
  const profileOf = useCallback(
    (id: string, placeKey: string): Prof | null => {
      const profile = domainProfileOf(id, placeKey);
      return profile ? fromDomain(profile) : null;
    },
    [domainProfileOf],
  );

  const world: ClockWorld = {
    prof: p,
    dur,
    next: () => {
      const n = ctx && view.track(ctx.next);
      return n && ctx ? { id: n.id, place: ctx.place, start: profileOf(n.id, ctx.place)?.start ?? 0, title: shownTitle(n) } : null;
    },
  };
  const worldRef = useRef(world);
  worldRef.current = world;

  /* ---------- the preview's sound (the game master's headphones only, never the rooms) ---------- */

  // The sound plays the file from the playhead with the profile shown, quietly (this screen says what happens). Once
  // the audio host says where it is, the clock follows it; until then it runs on its own.
  const sounding = useRef<string | null>(null);
  const [following, setFollowing] = useState(false);
  const startSound = useCallback(
    (from: number, id = track.id, profile: Prof | null = p) => {
      // Past End the players never hear it, so it plays the plain file there (to the end of the file).
      const shaped = profile && from < profile.end ? toInput(profile) : undefined;
      const outcome = audio.previewTrack(id, { startAtMs: Math.round(from * 1000), profile: shaped, quiet: true });
      sounding.current = outcome.ok ? id : null;
      setFollowing(false);
    },
    [audio, track.id, p],
  );
  const stopSound = useCallback(() => {
    if (!sounding.current) return;
    sounding.current = null;
    setFollowing(false);
    audio.stopPreview();
  }, [audio]);
  const scrubbing = useRef(false);
  useLyreAudioEvent("preview-position", (at: PreviewPosition) => {
    if (!sounding.current || at.key !== sounding.current || scrubbing.current) return;
    if (!following) setFollowing(true);
    const step = follow(clockRef.current, at.positionMs / 1000, worldRef.current);
    if (step.state !== clockRef.current) setClock(step.state);
    if (step.say) say(step.say);
  });
  // The sound ended by itself (End, the end of the file): the clock goes there. Another Preview button taking the
  // headphones pauses the clock where it is.
  const previewKey = useNowPlaying().preview?.key ?? null;
  const heard = useRef(false);
  useEffect(() => {
    if (!sounding.current) {
      heard.current = false;
      return;
    }
    if (previewKey === sounding.current) {
      heard.current = true;
      return;
    }
    if (!heard.current) return;
    heard.current = false;
    sounding.current = null;
    setFollowing(false);
    const s = clockRef.current;
    const step = previewKey ? { state: pauseClock(s) } : finishClock(s, worldRef.current);
    setClock(step.state);
    if (step.say) say(step.say);
  }, [previewKey, say, setClock]);

  // The clock runs on animation frames while the preview plays and the sound has not said where it is (a frame is at
  // most a quarter second, so a page that was hidden does not jump ahead).
  useEffect(() => {
    if (!clock.playing || following) return;
    let last = performance.now();
    let frameId = requestAnimationFrame(function frame(now) {
      const dt = Math.min(0.25, Math.max(0, now - last) / 1000);
      last = now;
      const step = advance(clockRef.current, dt, worldRef.current);
      setClock(step.state);
      if (step.say) say(step.say);
      if (step.state.playing) frameId = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(frameId);
  }, [clock.playing, following, say, setClock]);

  // Moving on: the next track's sound, from its Start with its settings in that place, until the clock stops it.
  const handoverId = clock.playing ? (clock.handover?.id ?? null) : null;
  useEffect(() => {
    const h = clockRef.current.handover;
    if (!handoverId || !h || sounding.current === handoverId) return;
    startSound(h.pos, h.id, profileOf(h.id, h.place));
  }, [handoverId, startSound, profileOf]);
  // The profile changed while it plays (a handle moved): the sound starts again from where it is, with the change.
  const playingProfile = useRef(p);
  useEffect(() => {
    if (playingProfile.current === p) return;
    playingProfile.current = p;
    if (sounding.current !== track.id || !clockRef.current.playing || clockRef.current.handover) return;
    const timer = setTimeout(() => startSound(clockRef.current.pos), 200);
    return () => clearTimeout(timer);
  }, [p, track.id, startSound]);
  // The clock stopped by itself (End, the end of the file, a few seconds into the next track): so does the sound.
  useEffect(() => {
    if (!clock.playing) stopSound();
  }, [clock.playing, stopSound]);
  // Leaving the screen, or opening another place, stops the preview.
  const stopSoundRef = useRef(stopSound);
  stopSoundRef.current = stopSound;
  useEffect(() => () => stopSoundRef.current(), []);

  /* ---------- focus after a change ---------- */

  // A control to focus once it is on the screen (by its data-k). Every action that asks for one also changes what is
  // shown, so the check runs after that render, and again after each later one until the control appears (a
  // place's own settings appear when the library answers).
  const focusWanted = useRef<string | null>(null);
  const setFocusK = (k: string) => {
    focusWanted.current = k;
  };
  useEffect(() => {
    const wanted = focusWanted.current ?? focusOnOpen;
    if (!wanted) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-k="${wanted}"]`);
    if (!el) return;
    focusOnOpen = null;
    focusWanted.current = null;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  });

  /* ---------- typed times and lengths ---------- */

  const [editing, setEditing] = useState<Editing | null>(null);
  const [invalid, setInvalid] = useState<Partial<Record<Which, string>>>({});

  /* ---------- actions ---------- */

  const sayPoint = (which: Which, prof: Prof) => say(`${POINT[which]} ${pointText(which, valueOf(prof, which))}`);
  const readOnlyNote = () => toast(READ_ONLY_NOTE);

  const actions = {
    togglePlay() {
      const s = clockRef.current;
      if (s.playing) {
        setClock(pauseClock(s));
        say(`Preview paused at ${fmt(s.pos)}`);
        stopSound();
        return;
      }
      const from = s.handover ? { ...s, handover: null, pos: p.end } : s;
      const step = playClock(from, "play", world);
      setClock(step.state);
      if (step.say) say(step.say);
      startSound(step.state.pos);
    },
    playLast10() {
      const step = playClock(clockRef.current, "last10", world);
      setClock(step.state);
      if (step.say) say(step.say);
      startSound(step.state.pos);
    },
    stop() {
      setClock(stopClock(clockRef.current, p));
      say("Preview stopped");
      stopSound();
    },
    /** Move the playhead; silent while dragging (the end of the drag says where it is). */
    seek(v: number, silent = false) {
      const wasHandingOver = !!clockRef.current.handover;
      const s = seekClock(clockRef.current, v, dur);
      setClock(s);
      if (!silent) say(`Playhead ${fmt(s.pos)}`);
      // While it plays, the sound goes on from the new place (a drag waits for its end).
      if (!silent && s.playing && (sounding.current === track.id || wasHandingOver)) startSound(s.pos);
    },
    nudge(d: number) {
      actions.seek(clockRef.current.pos + d);
    },
    /** Pressing on the waveform moves the playhead there; dragging moves it along. */
    scrubFrom(e: React.PointerEvent<HTMLElement>, secAt: (ev: { clientX: number }) => number) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus();
      scrubbing.current = true;
      actions.seek(secAt(e), true);
      dragWith(
        (ev) => actionsRef.current.seek(secAt(ev), true),
        () => {
          scrubbing.current = false;
          say(`Playhead ${fmt(clockRef.current.pos)}`);
          if (clockRef.current.playing && sounding.current) startSound(clockRef.current.pos);
        },
      );
    },
    /** Dragging a handle: Start, End and Loop start follow the pointer; a fade knob sets the fade's length. */
    dragHandle(which: Which, e: React.PointerEvent<HTMLElement>, secAt: (ev: { clientX: number }) => number) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus();
      if (!editable) {
        readOnlyNote();
        return;
      }
      let cur = p;
      const write = editor.write;
      dragWith(
        (ev) => {
          const sec = secAt(ev);
          cur = movePoint(cur, dur, which, which === "fadein" ? sec - cur.start : which === "fadeout" ? cur.end - sec : sec);
          write(cur, "hold");
        },
        () => {
          editor.flush();
          sayPoint(which, cur);
        },
      );
    },

    /** A handle, stepper or field moved a point; `when` says when to write it (see useProfileEditor). */
    move(which: Which, v: number, when: "now" | "soon" | "hold" = "now"): Prof | null {
      if (!editable) {
        readOnlyNote();
        return null;
      }
      const next = movePoint(p, dur, which, v);
      editor.write(next, when);
      return next;
    },
    keyOnHandle(which: Which, e: React.KeyboardEvent) {
      const cur = valueOf(p, which);
      const [lo, hi] = rangeOf(p, dur, which);
      const big = e.shiftKey ? 10 : 1;
      const v =
        e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? cur - big
          : e.key === "ArrowRight" || e.key === "ArrowUp"
            ? cur + big
            : e.key === "PageDown"
              ? cur - 10
              : e.key === "PageUp"
                ? cur + 10
                : e.key === "Home"
                  ? lo
                  : e.key === "End"
                    ? hi
                    : null;
      if (v === null) return;
      e.preventDefault();
      e.stopPropagation();
      const next = actions.move(which, v, "soon");
      if (next) sayPoint(which, next);
    },
    /** The playhead's own keys: arrows 1 s (Shift 10 s), Page Up and Down 10 s, Home and End. */
    keyOnScrub(e: React.KeyboardEvent) {
      const pos = clockRef.current.pos;
      const big = e.shiftKey ? 10 : 1;
      const d =
        e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -big
          : e.key === "ArrowRight" || e.key === "ArrowUp"
            ? big
            : e.key === "PageDown"
              ? -10
              : e.key === "PageUp"
                ? 10
                : e.key === "Home"
                  ? -pos
                  : e.key === "End"
                    ? dur - pos
                    : null;
      if (d === null) return;
      e.preventDefault();
      e.stopPropagation();
      actions.nudge(d);
    },
    /** Start, End, Loop start or a fade length from the playhead (the "... at playhead" buttons and I, O, L). */
    setHere(which: Which) {
      if (!editable) {
        readOnlyNote();
        return;
      }
      const pos = clockRef.current.pos;
      const base = which === "loop" && p.after !== "loop" ? { ...p, after: "loop" as const } : p;
      const v = which === "fadein" ? pos - p.start : which === "fadeout" ? p.end - pos : pos;
      const next = movePoint(base, dur, which, v);
      editor.write(next);
      sayPoint(which, next);
      setEditing(null);
      setInvalid({});
    },
    step(which: Which, d: number) {
      const next = actions.move(which, valueOf(p, which) + d);
      setInvalid(({ [which]: _gone, ...rest }) => rest);
      setEditing(null);
      if (next) sayPoint(which, next);
    },
    reset() {
      if (!editor.write(wholeTrack(p, dur))) return;
      setInvalid({});
      setEditing(null);
      toast(`Back to the whole track: 0:00 to ${fmt(dur)}, no fades`);
      say("Reset to the whole track");
    },
    setAfter(after: AfterEnd) {
      if (!editor.write({ ...p, after })) return;
      setClock({ ...clockRef.current, event: null, handover: null });
      say(after === "loop" ? `At the end: loop back to ${fmt(p.loopStart)}` : after === "next" ? "At the end: move to the next track" : "At the end: stop");
    },
    setShape(kind: "in" | "out", shape: number) {
      const f = kind === "in" ? p.fadeIn : p.fadeOut;
      editor.write(kind === "in" ? { ...p, fadeIn: { dur: f.dur, shape } } : { ...p, fadeOut: { dur: f.dur, shape } }, "soon");
    },

    /** Typing in a time or length field: each keystroke counts from the profile before typing began. */
    typeField(which: Which, text: string) {
      const base = editing?.which === which ? editing.base : p;
      const len = isLength(which);
      const v = parseTime(text, len);
      const [lo, hi] = rangeOf(base, dur, which);
      let problem: string | null = null;
      if (v === null) problem = len ? "Type a number of seconds, like 6" : "Type minutes and seconds, like 5:18";
      else if (v < lo || v > hi) problem = `Between ${len ? `${lo} and ${hi} seconds` : `${fmt(lo)} and ${fmt(hi)}`}`;
      let changed = editing?.which === which && editing.changed;
      if (problem === null && v !== null && editable) {
        editor.write(movePoint(base, dur, which, v), "soon");
        changed = true;
      }
      setEditing({ which, text, base, changed });
      setInvalid(problem ? { [which]: problem } : {});
    },
    commitField() {
      if (!editing) return;
      setEditing(null);
      setInvalid({});
      editor.flush();
    },
    /** Escape: back to the value before typing. */
    cancelField() {
      if (editing?.changed) editor.write(editing.base);
      setEditing(null);
      setInvalid({});
    },

    addMarker(focus: boolean) {
      if (!editable) {
        readOnlyNote();
        return;
      }
      const { profile, index } = addMarker(p, clockRef.current.pos);
      editor.write(profile);
      if (focus) setFocusK(`ap-ml-${index}`);
      say(`Marker added at ${fmt(profile.markers[index].at)}`);
    },
    renameMarker(i: number, label: string) {
      editor.write({ ...p, markers: p.markers.map((m, j) => (j === i ? { ...m, label } : m)) }, "soon");
    },
    removeMarker(i: number) {
      const gone = p.markers[i];
      if (!editor.write({ ...p, markers: p.markers.filter((_m, j) => j !== i) })) return;
      setFocusK("ap-madd");
      say(`Marker removed: ${gone ? gone.label : ""}`);
    },

    choosePlace(next: string) {
      editor.flush();
      focusOnOpen = "ap-place";
      window.location.hash = `#/profile/${track.id}${next ? `/${next}` : ""}`;
      say(`Settings for ${placeName(next, view)}`);
    },
    async giveOwn() {
      if (!(await editor.giveOwn())) return;
      setFocusK("ap-clear");
      say("This place now has its own settings, copied from the track's");
      toast(`Own settings for ${placeName(key, view)}, copied from the track's`);
    },
    useTracks() {
      say("Using the track's settings here");
    },
    async clearOwn() {
      editor.flush();
      if (!(await editor.clearOwn())) return;
      setFocusK("ap-own");
      say("Back to the track's settings here");
    },
    async undoClear() {
      if (!(await editor.undoClearOwn())) return;
      setFocusK("ap-clear");
      say("Own settings brought back");
    },
    chooseContext(i: number) {
      setCtxIndex(i);
      setClock({ ...clockRef.current, handover: null });
    },

    /** Play on air: the players hear it from Start, with this place's settings (a scene's step or a playlist's track). */
    playOnAir() {
      let from: TrackFrom | undefined;
      const place = key ? parsePlaceKey(key) : null;
      if (place?.kind === "playlist") from = { playlistId: place.playlistId };
      else if (place?.kind === "scene") {
        const found = sceneOf(key, view);
        const at = found ? sceneSequence(found.scene, view.lookup).findIndex((s) => s.trackId === track.id) : -1;
        if (at > -1) from = { scene: { campaignId: place.campaignId, sessionId: place.sessionId, sceneId: place.sceneId }, at };
      }
      editor.flush();
      const result = audio.playTrack(track.id, from ? { fadeMs: 3000, from } : { fadeMs: 3000 });
      if (result.ok) toast(`On air: ${title}, from ${fmt(p.start)}`);
    },
    setKeys1(on: boolean) {
      setKeys1Raw(on);
      say(`Single-key shortcuts ${on ? "on" : "off"}`);
    },
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  /* ---------- single-key shortcuts, while the screen has the focus and nothing is being typed ---------- */

  useEffect(() => {
    if (!keys1) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;
      const viewEl = document.getElementById("view");
      if (a && a !== document.body && viewEl && !viewEl.contains(a)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const act = actionsRef.current;
      let done = true;
      if (k === " ") {
        if (a?.closest("button, a")) return;
        act.togglePlay();
      } else if (k === "ArrowLeft" || k === "ArrowRight") act.nudge((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
      else if (e.shiftKey) done = false;
      else if (k === "i") act.setHere("start");
      else if (k === "o") act.setHere("end");
      else if (k === "l") act.setHere("loop");
      else if (k === "m") act.addMarker(false);
      else done = false;
      if (done) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keys1]);

  return { editor, p, dur, editable, key, view, title, clock, keys1, contexts, ctx, editing, invalid, actions, profileOf };
}
