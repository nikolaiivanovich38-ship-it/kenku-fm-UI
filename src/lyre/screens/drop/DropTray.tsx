/**
 * ORG-5 (design round 7, r7org.js): adding tracks to other lists. Nothing shows until a drag starts; then "Drop on"
 * appears at the right with where the tracks can go (dropTargets) and says what is dragged ("2 tracks") and "Copies
 * it · Shift moves · Esc cancels". Dropping copies; with Shift held a track moves out of the playlist it came from.
 * The place under the pointer lights up; Esc puts everything back. Add to… is the keyboard's way: the same places as
 * a list of choices, with "Move it out of …". Every add is one undo step, with the Saved pop-up naming the place.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseDropPlace } from "../../../common/domain/round7";
import type { LibraryTrack } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useBoards, useCampaigns, useLyreApi, usePlaylists, useTracks } from "../../api";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { useSave } from "../../shell/useSave";
import { nextSession } from "../campaigns/model";
import { draggedName, dropTargets, type DropTarget } from "./places";
import "./drop.css";

/** What is being added: track ids, and the manual playlist they come from (Shift, or Move it out of…, moves them). */
export interface Dragged {
  ids: string[];
  from: string | null;
}

/** The places for some tracks, and a way to put them in one. */
export function usePut() {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const save = useSave();
  const { toast } = useAnnounce();
  const tracks = useTracks().data;
  const playlists = usePlaylists().data;
  const boards = useBoards().data;
  const campaigns = useCampaigns().data;
  const rooms = useNowPlaying().rooms;
  const inHand = useCampaignInHand();
  const campaign = campaigns?.find((c) => c.id === inHand) ?? campaigns?.[0] ?? null;
  const byId = useMemo(() => new Map((tracks ?? []).map((t) => [t.id, t])), [tracks]);
  const tracksOf = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((t): t is LibraryTrack => !!t);
  const nameOf = (ids: readonly string[]) => draggedName(tracksOf(ids).map((t) => ({ title: shownTitle(t) })));

  const targets = (what: Dragged): DropTarget[] =>
    dropTargets(tracksOf(what.ids), what.from, {
      playlists: playlists ?? [],
      boards: boards ?? [],
      rooms: rooms.map((r) => ({ roomId: r.roomId, name: r.name })),
      campaign,
      session: campaign ? nextSession(campaign) : null,
    });

  const put = async (key: string, what: Dragged, move: boolean): Promise<boolean> => {
    const place = parseDropPlace(key);
    if (!place) return false;
    const name = nameOf(what.ids);
    if (place.kind === "queue") {
      for (const id of what.ids) audio.addToQueue({ kind: "track", trackId: id }, { target: { room: place.roomId } });
      const room = rooms.find((r) => r.roomId === place.roomId)?.name ?? "Table";
      toast(`Added to Up next in ${room}: ${name}`);
      return true;
    }
    const placeName =
      place.kind === "playlist"
        ? (playlists?.find((p) => p.id === place.playlistId)?.name ?? "the playlist")
        : place.kind === "board"
          ? (boards?.find((b) => b.id === place.boardId)?.name ?? "the board")
          : `${campaigns?.find((c) => c.id === place.campaignId)?.sessions.find((s) => s.id === place.sessionId)?.scenes.find((x) => x.id === place.sceneId)?.name ?? "the scene"} music`;
    const from = what.from ? playlists?.find((p) => p.id === what.from) : undefined;
    const moving = move && !!from && place.kind === "playlist";
    const added = what.ids.length === 1 ? name : `${what.ids.length} tracks added`;
    const words = moving ? `${placeName} and ${from.name}` : placeName;
    const detail = moving ? `Moved to ${placeName}: ${name}` : place.kind === "board" ? (what.ids.length === 1 ? `new pad ${name}` : `${what.ids.length} new pads`) : added;
    const done = await save(words, () => api.library.put({ place, what: { kind: "tracks", ids: what.ids }, ...(what.from ? { from: what.from } : {}), ...(moving ? { move: true } : {}) }), { detail });
    if (done && !moving && done.value.added.length === 0) toast(`Already in ${placeName}`);
    return !!done;
  };

  return { targets, put, nameOf };
}

/**
 * The drop tray. `resolve` says what a drag that starts on an element carries (null: not tracks), so each screen
 * decides what its rows hold (the Library: every ticked row when a ticked one is dragged).
 */
export function DropTray({ resolve }: { resolve: (el: HTMLElement) => Dragged | null }) {
  const { targets, put, nameOf } = usePut();
  const { say } = useAnnounce();
  const [drag, setDrag] = useState<Dragged | null>(null);
  const [shift, setShift] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const live = useRef({ drag, shift, resolve, put });
  live.current = { drag, shift, resolve, put };

  useEffect(() => {
    // Esc cancels: the drag goes on in the browser until the button comes up, and its drop must change nothing
    // (not even the list's own reordering), so the drop is stopped before it reaches the page.
    let cancelled = false;
    const end = () => {
      setDrag(null);
      setOver(null);
      setShift(false);
    };
    const onDragEnd = () => {
      cancelled = false;
      end();
    };
    const onDragStart = (event: DragEvent) => {
      const el = event.target instanceof HTMLElement ? event.target : null;
      const what = el ? live.current.resolve(el) : null;
      if (!what) return;
      cancelled = false;
      setShift(event.shiftKey);
      try {
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
      } catch {
        /* read-only in some engines */
      }
      // After the browser has taken its picture of the row, so the tray is not in it.
      setTimeout(() => !cancelled && setDrag(what), 0);
    };
    const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dropto]") : null);
    const onDragOver = (event: DragEvent) => {
      if (cancelled) {
        // No place takes a cancelled drag: the pointer shows it cannot be dropped. Stopped here, so this does what the
        // page's drop guard (SEC-7) would: no browser handling of a file or link (review 0.5.0 CR-8).
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        return;
      }
      if (!live.current.drag) return;
      if (event.shiftKey && !live.current.shift) setShift(true);
      const t = target(event);
      if (!t) return;
      // Handled here: the page's drop guard (SEC-7, on the document) would otherwise say "no drop" (dropEffect none).
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = live.current.shift ? "move" : "copy";
      setOver(t.dataset.dropto ?? null);
    };
    const onDrop = (event: DragEvent) => {
      if (cancelled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const now = live.current;
      if (!now.drag) return;
      const t = target(event);
      if (!t?.dataset.dropto) return;
      event.preventDefault();
      event.stopPropagation();
      const what = now.drag;
      end();
      void now.put(t.dataset.dropto, what, event.shiftKey || now.shift);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShift(true);
      if (event.key === "Escape" && live.current.drag) {
        event.preventDefault();
        event.stopPropagation();
        cancelled = true;
        end();
        say("Drag cancelled");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShift(false);
    };
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
    };
  }, [say]);

  if (!drag) return null;
  const places = targets(drag);
  const groups = [...new Set(places.map((p) => p.group))];
  const canMove = !!drag.from;
  return createPortal(
    <section className="droptray" aria-label="Drop on">
      <header className="dt-head">
        <b className="ellipsis">{nameOf(drag.ids)}</b>
        <span className="faint dt-how">{canMove ? (shift ? "Moves it" : "Copies it · Shift moves") : "Adds it"} · Esc cancels</span>
      </header>
      {groups.map((g) => (
        <div key={g} className="dt-g" role="group" aria-label={g}>
          <h3 className="dt-gh">{g}</h3>
          {places
            .filter((p) => p.group === g)
            .map((p) => (
              <button key={p.key} type="button" className={over === p.key ? "dt-t dt-over" : "dt-t"} data-dropto={p.key} tabIndex={-1}>
                {p.name}
                {/* Told apart by their group for screen readers (a scene and a playlist can share a name). */}
                {p.group !== "Playlists" && p.group !== "Up next" && <span className="sr-only">, {p.group === "Pad boards" ? "new pad" : "scene"}</span>}
              </button>
            ))}
        </div>
      ))}
    </section>,
    document.body,
  );
}

/** Add to… (the keyboard's way): the same places as a list, with Move it out of … for a track in a manual playlist. */
export function AddToDialog({ what, onClose }: { what: Dragged; onClose: () => void }) {
  const { targets, put, nameOf } = usePut();
  const { toast } = useAnnounce();
  const playlists = usePlaylists().data;
  const [choice, setChoice] = useState("");
  const [move, setMove] = useState(false);
  const places = targets(what);
  const groups = [...new Set(places.map((p) => p.group))];
  const from = what.from ? playlists?.find((p) => p.id === what.from) : undefined;
  const add = async () => {
    if (!choice) {
      toast("Choose where it goes");
      return;
    }
    if (await put(choice, what, move)) onClose();
  };
  return (
    <Dialog
      open
      title={`Add ${nameOf(what.ids)} to`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void add()}>
            Add
          </Button>
        </>
      }
    >
      <div className="addto">
        {groups.map((g) => (
          <fieldset key={g} className="addto-g">
            <legend>{g}</legend>
            {places
              .filter((p) => p.group === g)
              .map((p) => (
                <label key={p.key} className="lk-radio">
                  <input type="radio" name="addto" value={p.key} checked={choice === p.key} onChange={() => setChoice(p.key)} />
                  <span>{p.label ?? p.name}</span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      {from && (
        <label className="lv-switch addto-move">
          <input type="checkbox" role="switch" checked={move} onChange={(e) => setMove(e.target.checked)} />
          <span className="lv-switch-t">
            <b>Move it out of {from.name}</b>
          </span>
        </label>
      )}
    </Dialog>
  );
}
