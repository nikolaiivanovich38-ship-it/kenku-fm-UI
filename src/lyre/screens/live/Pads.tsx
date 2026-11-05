/**
 * Pads (live.js pads), folded at first: the scene's boards as a switch, every other board in a menu, and the board's
 * pads with their keys. Pad keys work while the box is folded (LiveScreen). A hold pad plays while it is pressed;
 * a toggle pad is on or off. Sound goes to the box's room (To:); a sounding pad shows the initial of its room when
 * there are two or more rooms.
 */
import React, { useEffect, useRef } from "react";

import type { RoomTarget } from "../../../common/domain";
import type { Pad, PadBoard } from "../../../common/lyre/api";
import type { LyreAudio, NowPlaying } from "../../audio/lyreAudio";
import { Icon, type IconName } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { ICONS } from "../../kit/icons";
import { useRememberedOpen } from "../../shell/ShellSettings";
import { MODE_ICON, MODE_NAME, PAD_COLOUR } from "../boards/boardModel";
import { useBoxTarget, useLive } from "./liveData";
import { boardMenu, currentBoard, padKeys, sceneBoards, type LiveRoom } from "./liveModel";
import { updateLive } from "./liveState";
import { ToChip } from "./ToChip";

/** Whether a pad sounds in a room. */
function padOnIn(now: NowPlaying, roomId: string, key: string): boolean {
  return now.rooms.some((r) => r.roomId === roomId && r.effects.some((e) => e.padKey === key));
}

/**
 * Press or let go of a pad in the box's rooms. With All rooms, a toggle pad that sounds in any of them stops where it
 * sounds; otherwise it starts in every one.
 */
export function firePads(audio: LyreAudio, now: NowPlaying, targets: RoomTarget[], board: PadBoard, pad: Pad, phase: "down" | "up" = "down"): void {
  const key = `${board.id}/${pad.id}`;
  const rooms = targets.flatMap((t) => (t === "all" ? [] : [t.room]));
  if (pad.mode === "toggle" && rooms.length > 1) {
    const anyOn = rooms.some((id) => padOnIn(now, id, key));
    for (const id of rooms) if (!anyOn || padOnIn(now, id, key)) audio.firePad(board.id, pad.id, phase, { room: id });
    return;
  }
  for (const t of targets) audio.firePad(board.id, pad.id, phase, t);
}

export function PadsPane() {
  const live = useLive();
  const { audio, index, scene, session, campaign, state, now, rooms, keys1 } = live;
  const target = useBoxTarget("pads");
  const { say } = useAnnounce();
  const board = currentBoard(state.board, scene, index);
  const inScene = sceneBoards(scene, index);
  const sounding = now.rooms.reduce((n, r) => n + r.effects.filter((e) => e.padKey).length, 0);
  const held = useRef<{ board: PadBoard; pad: Pad } | null>(null);

  // A hold pad pressed with the pointer is let go wherever the pointer comes up, or when the window loses focus.
  useEffect(() => {
    const release = () => {
      const h = held.current;
      if (!h) return;
      held.current = null;
      firePads(audio, now, target.targets, h.board, h.pad, "up");
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [audio, now, target.targets]);

  const choose = (id: string) => {
    updateLive({ board: id });
    say(`Pad board: ${index.board(id)?.name ?? ""}`);
  };
  const menu = (): PopMenuEntry[] =>
    boardMenu(scene, session, campaign, index).flatMap(({ label, boards }): PopMenuEntry[] => [
      { group: label },
      ...boards.map(
        (b): PopMenuEntry => ({
          key: `${label}-${b.id}`,
          role: "menuitemradio",
          checked: b.id === board?.id,
          content: (
            <>
              {b.id === board?.id ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
              <span className="grow ellipsis">{b.name}</span> <span className="faint">{`${b.cols} × ${b.rows}`}</span>
            </>
          ),
          onSelect: () => choose(b.id),
        }),
      ),
    ]);
  const boardInScene = !!board && inScene.some((b) => b.id === board.id);
  const keys = padKeys(board);
  const [open] = useRememberedOpen("lv-pads", false);
  const folded = !open;

  return (
    <Pane
      id="lv-pads"
      title="Pads"
      icon="grid"
      kind="fx"
      size="auto"
      flush
      noMax
      collapsed
      actions={<ToChip box="pads" />}
      status={sounding ? { text: `${sounding} sounding`, tone: "live" } : undefined}
      summary={folded && board ? <span title={keys1 && keys.length ? `Pad keys ${keys.join(" ")} work while this box is folded` : undefined}>{board.name}</span> : undefined}
    >
      <div className="lv-pads-bar">
        {inScene.length > 0 && (
          <div className="seg s lv-bseg" role="group" aria-label="This scene's pad boards">
            {inScene.map((b) => (
              <button key={b.id} type="button" aria-pressed={b.id === board?.id} title={b.name} onClick={() => choose(b.id)}>
                <span className="ellipsis">{b.name}</span>
              </button>
            ))}
          </div>
        )}
        <PopMenuButton label="Pad boards" className="btn s lv-boardbtn" title="Session, campaign and other pad boards" items={menu}>
          <Icon name="grid" size="s" />
          <span className="ellipsis">{boardInScene || !board ? "Other boards" : board.name}</span>
          <Icon name="chevdown" size="s" />
        </PopMenuButton>
        {!keys1 && <span className="hint ellipsis grow">Single-key shortcuts are off</span>}
        <span className="grow" />
        {board && (
          <a className="btn s ghost" href={`#/board/${board.id}`}>
            <Icon name="edit" size="s" />
            Edit board
          </a>
        )}
      </div>
      {board && (
        <div className="lv-grid" style={{ gridTemplateColumns: `repeat(${board.cols}, minmax(0, 1fr))` }} role="group" aria-label={`Pads on ${board.name}`}>
          {board.slots.slice(0, board.cols * board.rows).map((pad, i) =>
            pad ? (
              <PadTile
                key={pad.id}
                board={board}
                pad={pad}
                rooms={rooms}
                now={now}
                keys1={keys1}
                inWhere={target.inWhere}
                mine={target.targets.flatMap((t) => (t === "all" ? [] : [t.room]))}
                press={(phase) => firePads(audio, now, target.targets, board, pad, phase)}
                hold={() => (held.current = { board, pad })}
              />
            ) : (
              <span key={`empty-${i}`} className="lv-pad-empty" aria-hidden="true" />
            ),
          )}
        </div>
      )}
    </Pane>
  );
}

interface PadTileProps {
  board: PadBoard;
  pad: Pad;
  rooms: LiveRoom[];
  now: NowPlaying;
  keys1: boolean;
  inWhere: string;
  /** The rooms this box plays in. */
  mine: string[];
  press: (phase: "down" | "up") => void;
  /** A hold pad pressed with the pointer: let it go when the pointer comes up. */
  hold: () => void;
}

function PadTile({ board, pad, rooms, now, keys1, inWhere, mine, press, hold }: PadTileProps) {
  const key = `${board.id}/${pad.id}`;
  const many = rooms.length > 1;
  const on = now.rooms.some((r) => r.effects.some((e) => e.padKey === key));
  const onHere = mine.some((id) => padOnIn(now, id, key));
  const inRooms = many ? rooms.filter((r) => padOnIn(now, r.roomId, key)).map((r) => r.name) : [];
  const toggle = pad.mode === "toggle";
  const isHold = pad.mode === "hold";
  const keyHeld = useRef(false);
  const icon: IconName = (pad.icon in ICONS ? pad.icon : "note") as IconName;
  return (
    <button
      type="button"
      className={cx("lv-pad", on && "on")}
      data-lv={`pad-${key}`}
      style={{ ["--pad" as string]: (PAD_COLOUR[pad.color] ?? PAD_COLOUR.bone).hex }}
      aria-pressed={toggle ? (many ? onHere : on) : undefined}
      aria-keyshortcuts={pad.key && keys1 ? pad.key : undefined}
      title={`${pad.label}${pad.key ? ` (key ${pad.key.toUpperCase()})` : ""}: ${MODE_NAME[pad.mode]}${inWhere}${inRooms.length ? `. Sounding in ${inRooms.join(" and ")}` : ""}`}
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
      {inRooms.length > 0 && (
        <>
          <span className="lv-pad-rm" aria-hidden="true">
            {inRooms.map((n) => n.charAt(0)).join("")}
          </span>
          <span className="sr-only">, sounding in {inRooms.join(" and ")}</span>
        </>
      )}
      {toggle && on && !many ? (
        <span className="lv-pad-on">On</span>
      ) : pad.mode === "oneshot" || (toggle && on) ? null : (
        <span className="lv-pad-mode" title={MODE_NAME[pad.mode]}>
          <Icon name={MODE_ICON[pad.mode]} size="s" />
          <span className="sr-only">{MODE_NAME[pad.mode]}</span>
        </span>
      )}
      {pad.key && keys1 && (
        <span className="kbd" aria-hidden="true">
          {pad.key.toUpperCase()}
        </span>
      )}
    </button>
  );
}
