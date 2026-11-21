/**
 * Pads in Live (live.js padGrid, padHTML): a board's pads with their keys, in Current scene (the scene's board, whose
 * keys are the live keys), Session pads and Campaign pads (click only). A hold pad plays while it is pressed; a toggle
 * pad is on or off. BUG-20: pressing any pad that plays stops it, so every tile is pressed (and says On) while it
 * plays. Round 7 part 2 (ORG-4): a board's divider names the row of pads under it. Sound goes to the box's room
 * (To:); a sounding pad shows the initial of its room when there are two or more rooms.
 */
import React, { useEffect, useRef } from "react";

import type { RoomTarget } from "../../../common/domain";
import type { Pad, PadBoard } from "../../../common/lyre/api";
import type { LyreAudio, NowPlaying } from "../../audio/lyreAudio";
import { Icon, type IconName } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { ICONS } from "../../kit/icons";
import { MODE_ICON, MODE_NAME, PAD_COLOUR } from "../boards/boardModel";
import { useBoxTarget, useLive } from "./liveData";
import { noSoundWords, padHasNoSound, padStepWords, type LiveBox, type LiveRoom } from "./liveModel";
import { useAnnounce } from "../../shell/Announcer";
import { useDip } from "../settings/dipSettings";

/** Whether a pad sounds in a room. */
function padOnIn(now: NowPlaying, roomId: string, key: string): boolean {
  return now.rooms.some((r) => r.roomId === roomId && r.effects.some((e) => e.padKey === key));
}

/**
 * Press or let go of a pad in the box's rooms. With All rooms, a press on a pad that sounds in any of them stops it
 * where it sounds (BUG-20); otherwise it starts in every one.
 */
export function firePads(audio: LyreAudio, now: NowPlaying, targets: RoomTarget[], board: PadBoard, pad: Pad, phase: "down" | "up" = "down"): void {
  const key = `${board.id}/${pad.id}`;
  const rooms = targets.flatMap((t) => (t === "all" ? [] : [t.room]));
  if (phase === "down" && rooms.length > 1) {
    const anyOn = rooms.some((id) => padOnIn(now, id, key));
    for (const id of rooms) if (!anyOn || padOnIn(now, id, key)) audio.firePad(board.id, pad.id, phase, { room: id });
    return;
  }
  for (const t of targets) audio.firePad(board.id, pad.id, phase, t);
}

/**
 * Round 9 §11 (item 47): whether the music dips while this pad plays: its While it plays, else the usual for its play
 * mode (a one-shot or Restart on press pad dips; the engine's padDips), and never with Dip the music under effects off.
 */
export function padDipsNow(pad: Pick<Pad, "mode" | "dip">, dipOff: boolean): boolean {
  return !dipOff && (pad.dip ?? (pad.mode === "oneshot" || pad.mode === "retrigger"));
}

/** A board's pads in a box (its rooms are the box's To:). `keysOn`: its pad keys play it (Current scene's board). */
export function PadGrid({ board, box, keysOn }: { board: PadBoard; box: LiveBox; keysOn: boolean }) {
  const { audio, now, rooms, keys1 } = useLive();
  const { toast, warn } = useAnnounce();
  const dipOff = useDip().amount === "off";
  const target = useBoxTarget(box);
  const held = useRef<Pad | null>(null);
  const latest = useRef({ audio, now, targets: target.targets });
  latest.current = { audio, now, targets: target.targets };

  // A hold pad pressed with the pointer is let go wherever the pointer comes up, or when the window loses focus.
  useEffect(() => {
    const release = () => {
      const pad = held.current;
      if (!pad) return;
      held.current = null;
      const l = latest.current;
      firePads(l.audio, l.now, l.targets, board, pad, "up");
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [board]);

  const cells: React.ReactNode[] = [];
  board.slots.slice(0, board.cols * board.rows).forEach((pad, i) => {
    const divider = i % board.cols === 0 ? board.dividers?.find((dv) => dv.row === i / board.cols) : undefined;
    if (divider) {
      cells.push(
        <h3 key={`div-${divider.row}`} className="lv-pad-div ellipsis" style={{ gridColumn: "1 / -1" }} title={divider.name}>
          {divider.name}
        </h3>,
      );
    }
    cells.push(
      pad ? (
        <PadTile
          key={pad.id}
          board={board}
          pad={pad}
          box={box}
          rooms={rooms}
          now={now}
          keys={keysOn && keys1}
          dips={padDipsNow(pad, dipOff)}
          inWhere={target.inWhere}
          mine={target.targets.flatMap((t) => (t === "all" ? [] : [t.room]))}
          press={(phase) => {
            // Round 10 (table review S3): a pad with no sound says so in the warning pop-up instead of doing nothing.
            if (padHasNoSound(pad)) {
              if (phase === "down") warn(noSoundWords(pad));
              return;
            }
            // 0.5.2 (round 9 review M5): a pad does not end the scene's Undo.
            firePads(audio, now, target.targets, board, pad, phase);
            const words = phase === "down" ? padStepWords(pad) : null;
            if (words) toast(words);
          }}
          hold={() => (held.current = pad)}
        />
      ) : (
        <span key={`empty-${i}`} className="lv-pad-empty" aria-hidden="true" />
      ),
    );
  });
  return (
    <div className="lv-grid" style={{ gridTemplateColumns: `repeat(${board.cols}, minmax(0, 1fr))` }} role="group" aria-label={`Pads on ${board.name}`}>
      {cells}
    </div>
  );
}

interface PadTileProps {
  board: PadBoard;
  pad: Pad;
  box: LiveBox;
  rooms: LiveRoom[];
  now: NowPlaying;
  /** Its key plays it, so the key is shown on the tile. */
  keys: boolean;
  /** The music dips while it plays (said in its hover text; no mark on its face, round 10). */
  dips: boolean;
  inWhere: string;
  /** The rooms this box plays in. */
  mine: string[];
  press: (phase: "down" | "up") => void;
  /** A hold pad pressed with the pointer: let it go when the pointer comes up. */
  hold: () => void;
}

function PadTile({ board, pad, box, rooms, now, keys, dips, inWhere, mine, press, hold }: PadTileProps) {
  const key = `${board.id}/${pad.id}`;
  const many = rooms.length > 1;
  const on = now.rooms.some((r) => r.effects.some((e) => e.padKey === key));
  const onHere = mine.some((id) => padOnIn(now, id, key));
  const inRooms = many ? rooms.filter((r) => padOnIn(now, r.roomId, key)).map((r) => r.name) : [];
  const isHold = pad.mode === "hold";
  const keyHeld = useRef(false);
  const icon: IconName = (pad.icon in ICONS ? pad.icon : "note") as IconName;
  const none = padHasNoSound(pad);
  return (
    <button
      type="button"
      className={cx("lv-pad", on && "on", none && "lv-pad-none")}
      data-lv={`pad-${box}-${key}`}
      style={{ ["--pad" as string]: (PAD_COLOUR[pad.color] ?? PAD_COLOUR.bone).hex }}
      aria-pressed={many ? onHere : on}
      aria-keyshortcuts={pad.key && keys ? pad.key : undefined}
      // 0.6.0 usability test (F-P4): a pad with no sound is read "Owl, No sound", with no stray space before the comma.
      aria-label={none ? `${pad.label}, No sound` : undefined}
      // F-C9: the hover says when the music dips while it plays (round 10: no mark on the pad's face); in whole
      // sentences (language review E1).
      title={
        none
          ? noSoundWords(pad)
          : `${pad.label}${pad.key && keys ? ` (key ${pad.key.toUpperCase()})` : ""} is a ${MODE_NAME[pad.mode]} pad${inWhere ? ` that plays${inWhere}` : ""}.${dips ? " It dips the music while it plays." : ""}${inRooms.length ? ` It is playing in ${inRooms.join(" and ")}.` : ""}`
      }
      onClick={isHold ? undefined : () => press("down")}
      onPointerDown={
        isHold
          ? (event) => {
              if (event.button > 0) return;
              event.preventDefault();
              (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
              hold();
              press("down");
            }
          : undefined
      }
      onKeyDown={
        isHold
          ? (event) => {
              // A hold pad reached with the keyboard plays while Enter or Space is down.
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat && !keyHeld.current) {
                keyHeld.current = true;
                press("down");
              }
            }
          : undefined
      }
      onKeyUp={
        isHold
          ? (event) => {
              if ((event.key !== "Enter" && event.key !== " ") || !keyHeld.current) return;
              event.preventDefault();
              keyHeld.current = false;
              press("up");
            }
          : undefined
      }
      onBlur={() => {
        if (keyHeld.current) {
          keyHeld.current = false;
          press("up");
        }
      }}
    >
      <Icon name={icon} size="s" />
      <span className="lv-pad-l ellipsis">{pad.label}</span>
      {none && <span className="lv-pad-nosound">No sound</span>}
      {inRooms.length > 0 && (
        <>
          {/* 0.5.2 (round 8 finding 15): the letters are the rooms' first letters; their hover says so in words. */}
          <span className="lv-pad-rm" aria-hidden="true" title={`Sounding in ${inRooms.join(" and ")}`}>
            {inRooms.map((n) => n.charAt(0)).join("")}
          </span>
          <span className="sr-only">, sounding in {inRooms.join(" and ")}</span>
        </>
      )}
      {on && !many ? (
        <>
          {/* A space, so "On" is a word of its own in the name a screen reader hears. */}
          {" "}
          <span className="lv-pad-on">On</span>
        </>
      ) : pad.mode === "oneshot" || on ? null : (
        <span className="lv-pad-mode" title={MODE_NAME[pad.mode]}>
          <Icon name={MODE_ICON[pad.mode]} size="s" />
          <span className="sr-only">{MODE_NAME[pad.mode]}</span>
        </span>
      )}
      {pad.key && keys && (
        <span className="kbd" aria-hidden="true">
          {pad.key.toUpperCase()}
        </span>
      )}
    </button>
  );
}
