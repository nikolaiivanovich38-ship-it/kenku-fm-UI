/**
 * The profile the screen shows and edits, for one track in one place, and the writes that keep it.
 *
 * Changes show at once (a draft) and are kept through LyreApi: right away for a click, a little later for a run of
 * key presses or typing (one write, so the library's Undo is not filled with single seconds), and when a drag ends.
 * When the library's data changes and nothing of ours is waiting to be written, the draft goes and the library's
 * profile shows again, so a change from elsewhere (another window, Undo) appears.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { parsePlaceKey, resolveProfile, type AudioProfileInput, type ProfilePlace } from "../../../common/domain";
import { isRefused, type LibraryTrack, type WriteResult } from "../../../common/lyre/api";
import { useCampaigns, useLyreApi, usePlaylists, useProfileOverrides, useTracks } from "../../api";
import { useAnnounce } from "../../shell/Announcer";
import { hasOwn, libraryView, placeName, type LibraryView } from "./places";
import { fromDomain, toInput, type Prof } from "./profileModel";

/** "hold": keep the draft, write when `flush` is called (the end of a drag). */
export type WriteWhen = "now" | "soon" | "hold";

/** How long a run of key presses or typing waits before it is written. */
const SOON_MS = 600;

/** "Back to the track's settings" can be undone while the screen is on that track (kept across places, as the prototype). */
let undoClear: { trackId: string; key: string; input: AudioProfileInput } | null = null;

export interface ProfileEditor {
  view: LibraryView;
  track: LibraryTrack;
  /** The track's length in seconds. */
  dur: number;
  key: string;
  place: ProfilePlace | null;
  /** What the screen shows: the draft, or the library's profile for this place. */
  prof: Prof;
  /** This place has settings of its own (the track's own settings always do). */
  editable: boolean;
  /** Something was changed since the screen opened. */
  saved: boolean;
  /** "Back to the track's settings" was just used here, so Undo can bring them back. */
  canUndoClear: boolean;
  write(next: Prof, when?: WriteWhen): boolean;
  /** Write at once; resolves with the library's undo label for it (null when refused or nothing changed). */
  writeNow(next: Prof): Promise<string | null>;
  flush(): void;
  giveOwn(): Promise<boolean>;
  clearOwn(): Promise<boolean>;
  undoClearOwn(): Promise<boolean>;
}

export type ProfileEditorState = { status: "loading" } | { status: "missing" } | { status: "ready"; editor: ProfileEditor };

export function useProfileEditor(trackId: string, key: string): ProfileEditorState {
  const api = useLyreApi();
  const { toast, saved: savedNote, saveFailed } = useAnnounce();
  const tracks = useTracks().data;
  const playlists = usePlaylists().data;
  const campaigns = useCampaigns().data;
  const overrides = useProfileOverrides().data;

  const view = useMemo(
    () => (tracks && playlists && campaigns && overrides ? libraryView(tracks, playlists, campaigns, overrides) : null),
    [tracks, playlists, campaigns, overrides],
  );
  const track = view?.track(trackId);
  const place = key ? parsePlaceKey(key) : null;

  const [draft, setDraft] = useState<Prof | null>(null);
  const [saved, setSaved] = useState(false);
  /** Whether this place has its own settings, as just written, until the library's data says so too. */
  const [ownNow, setOwnNow] = useState<boolean | null>(null);
  const [undoHere, setUndoHere] = useState(() => undoClear?.trackId === trackId && undoClear.key === key);
  const queued = useRef<Prof | null>(null);
  /** UX-19: what the Saved pop-up calls this place's settings (the prototype's apWhat). */
  const what = useRef("audio profile of the track");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef(0);

  const showRefusal = useCallback(
    (result: WriteResult<unknown>) => {
      if (!isRefused(result)) return false;
      toast(result.refusal.message);
      return true;
    },
    [toast],
  );

  const flush = useCallback((): Promise<string | null> => {
    clearTimeout(timer.current);
    const p = queued.current;
    if (!p) return Promise.resolve(null);
    queued.current = null;
    pending.current++;
    return api.profiles.set(trackId, place, toInput(p)).then(
      (result) => {
        pending.current--;
        if (!isRefused(result)) {
          savedNote(what.current, { key: `ap-${key}` });
          return result.undoLabel;
        }
        if (result.refusal.code === "not-saved") {
          // The drive could not take it: the change stays on screen, and Try again writes it.
          saveFailed(what.current, () => {
            queued.current = p;
            void flushRef.current();
          });
          return null;
        }
        showRefusal(result);
        setDraft(null);
        setSaved(false);
        return null;
      },
      (): null => {
        pending.current--;
        toast("Lyre could not keep that change. Try again.");
        setDraft(null);
        setSaved(false);
        return null;
      },
    );
    // place is derived from key; trackId and key fix it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, trackId, key, showRefusal, toast, savedNote, saveFailed]);

  // A change waiting to be written is written when the screen closes (another place, another screen).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  // New data from the library: show it, unless a change of ours is still on its way.
  useEffect(() => {
    if (pending.current === 0 && queued.current === null) {
      setDraft(null);
      setOwnNow(null);
    }
  }, [tracks, overrides]);

  if (!view) return { status: "loading" };
  if (!track) return { status: "missing" };
  what.current = key ? `audio profile in ${placeName(key, view).replace(/^the /, "")}` : "audio profile of the track";

  const editable = ownNow ?? hasOwn(trackId, key, view.overrides);
  const prof = draft ?? fromDomain(resolveProfile(track, place ? [place] : [], view.overrides).profile);

  const editor: ProfileEditor = {
    view,
    track,
    dur: track.durationMs / 1000,
    key,
    place,
    prof,
    editable,
    saved,
    canUndoClear: undoHere,
    write(next, when = "now") {
      if (!editable) return false;
      setDraft(next);
      setSaved(true);
      queued.current = next;
      clearTimeout(timer.current);
      if (when === "now") flush();
      else if (when === "soon") timer.current = setTimeout(flush, SOON_MS);
      return true;
    },
    writeNow(next) {
      if (!editable) return Promise.resolve(null);
      setDraft(next);
      setSaved(true);
      queued.current = next;
      return flush();
    },
    flush: () => void flush(),
    async giveOwn() {
      if (!place) return false;
      const result = await api.profiles.set(trackId, place, track.profile ?? {});
      if (showRefusal(result)) return false;
      undoClear = null;
      setUndoHere(false);
      setOwnNow(true);
      setSaved(true);
      return true;
    },
    async clearOwn() {
      if (!place) return false;
      // What Undo brings back: the settings as shown, including a change still on its way to the library.
      const input = toInput(prof);
      const result = await api.profiles.clear(trackId, place);
      if (showRefusal(result)) return false;
      undoClear = { trackId, key, input };
      setUndoHere(true);
      setDraft(null);
      setOwnNow(false);
      setSaved(false);
      return true;
    },
    async undoClearOwn() {
      const u = undoClear;
      if (!place || !u || u.trackId !== trackId || u.key !== key) return false;
      const result = await api.profiles.set(trackId, place, u.input);
      if (showRefusal(result)) return false;
      undoClear = null;
      setUndoHere(false);
      setOwnNow(true);
      return true;
    },
  };
  return { status: "ready", editor };
}

/** Forget "Back to the track's settings" Undo when another track opens (the prototype keeps it per track). */
export function forgetUndoUnless(trackId: string): void {
  if (undoClear && undoClear.trackId !== trackId) undoClear = null;
}
