/**
 * One pad board (#/board/<id>; design/prototype/src/views/boards.js, "board editor"): the grid of pads with its
 * size controls, the Spare pads, where the board is used, and the selected pad's own box.
 *
 * A board has cols × rows slots and a spare tray. Resizing keeps every pad where it sits; pads that fall outside a
 * smaller grid move to Spare pads and are never deleted silently. The grid is one stop on the Tab path: the arrows
 * move between slots (selecting the pad there), P previews, Alt+arrow moves the selected pad, Enter or Space selects
 * (on an empty slot: adds a pad), a right-click opens the pad's menu, and a pad can be dragged onto another slot or
 * onto Spare pads.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import type { LibraryTrack, Pad, PadBoard, PadPatch } from "../../../common/lyre/api";
import { Button, IconButton } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Menu, MenuButton, type MenuEntry } from "../../kit/Menu";
import { Column, Pane } from "../../kit/Pane";
import { useBoards, useCampaigns, useLyreApi, useTagGroups, useTracks } from "../../api";
import { useAnnounce } from "../../shell/Announcer";
import type { ScreenProps } from "..";
import {
  MAX_SIZE,
  MODE_ICON,
  MODE_NAME,
  PAD_COLOUR,
  QUICK_SIZES,
  findPad,
  firstPad,
  isArrow,
  keyLabel,
  moveMessage,
  neighbour,
  padCount,
  padTileName,
  place,
  plural,
  resizeMessage,
  tryWords,
  usesOfBoard,
  type PadAt,
} from "./boardModel";
import { BoardDividerDialog, DeleteBoardDialog, DeletePadDialog, UseInDialog, useDuplicateBoard } from "./BoardDialogs";
import { StepsDialog } from "../steps/StepsDialog";
import { go, useBoardSound, usePendingFocus, useSavedText, useWrite } from "./hooks";
import { PadEditor } from "./PadEditor";
import { PreviewButton } from "../../kit/SoundButtons";
import { useHeldPads } from "../../kit/heldPads";
import "./boards.css";
import { TopLead } from "../../shell/TopBar";
import { useSave } from "../../shell/useSave";

/** What a pad's change saved, for the Saved pop-up ("Saved: pad label “Thunder”", "Saved: Thunder colour"). */
export function padSaveWords(patch: PadPatch, label: string): string {
  if (patch.label !== undefined) return `pad label “${patch.label}”`;
  if (patch.color !== undefined) return `${label} colour`;
  if (patch.icon !== undefined) return `${label} icon`;
  if (patch.volume !== undefined) return `${label} volume`;
  if (patch.fadeOutMs !== undefined) return `${label} fade`;
  if (patch.key !== undefined) return `${label} hotkey`;
  if (patch.mode !== undefined) return `${label} play mode`;
  return `${label} sound`;
}

/** A second click on the selected pad within this time previews it (the prototype's double-click). */
const DOUBLE_CLICK_MS = 450;

const colourOf = (color: string) => ({ "--pc": PAD_COLOUR[color as keyof typeof PAD_COLOUR]?.hex ?? PAD_COLOUR.bone.hex }) as React.CSSProperties;

/** Typing in these keeps its arrows (and Alt+arrows) to itself. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && !["radio", "checkbox", "button"].includes(target.type));
}

export function BoardScreen({ route }: ScreenProps) {
  const boards = useBoards().data;
  const board = boards?.find((b) => b.id === route.params.bid);
  if (boards === undefined) {
    return (
      <div className="viewhead">
        <TopLead />
        <h1>Pad board</h1>
      </div>
    );
  }
  if (!board) {
    return (
      <>
        <div className="viewhead">
          <TopLead />
          <h1>Pad board not found</h1>
        </div>
        <div className="viewbody" data-scroll="body">
          <p className="empty">
            This board was deleted. <a href="#/boards">Back to Pad boards</a>
          </p>
        </div>
      </>
    );
  }
  return <BoardEditor board={board} />;
}

/** An open menu; `n` makes each opening a fresh menu (so "Move to…" after "Pad" focuses its own first item). */
type OpenMenu = { owner: string; label: string; items: MenuEntry[]; n: number };

function BoardEditor({ board }: { board: PadBoard }) {
  const api = useLyreApi();
  const write = useWrite();
  const save = useSave();
  const { say, toast } = useAnnounce();
  const campaigns = useCampaigns().data ?? [];
  const tracks = useTracks().data ?? [];
  const tagGroups = useTagGroups().data ?? [];
  const sound = useBoardSound();
  const pressHeld = useHeldPads(sound.audio);
  const duplicateBoard = useDuplicateBoard();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusLater = usePendingFocus(rootRef);
  const helpId = useId();

  // Which pad is selected: undefined until chosen (the first pad), null after its pad was deleted.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [focusIndex, setFocusIndex] = useState(0);
  const [message, setMessage] = useState<{ text: string; undoLabel: string | null; cols: number; rows: number } | null>(null);
  const [spareOpen, setSpareOpen] = useState<boolean | undefined>(undefined);
  const [padOpen, setPadOpen] = useState(true);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const menuCount = useRef(0);
  const [useIn, setUseIn] = useState(false);
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [deletingPad, setDeletingPad] = useState<PadAt | null>(null);
  /** ORG-4: Add a divider… is open. PLY-8: the pad whose steps are open (What it does…). */
  const [addingDivider, setAddingDivider] = useState(false);
  const [stepsPad, setStepsPad] = useState<Pad | null>(null);
  const lastClick = useRef<{ pid: string | null; t: number }>({ pid: null, t: 0 });
  const dragging = useRef<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const tryPads = useTryPads(board, tracks, sound);

  const selected: PadAt | null = chosen === null ? null : findPad(board, chosen) ?? (() => {
    const first = firstPad(board);
    return first ? findPad(board, first.id) : null;
  })();
  const select = (pid: string | null) => setChosen(pid);
  const fi = Math.min(focusIndex, board.slots.length - 1);
  const spareShown = spareOpen ?? board.spare.length > 0;

  // UX-19: the board's name and every change to a pad show the Saved pop-up, in the prototype's words.
  const nameField = useSavedText(
    board.name,
    (text) => text.trim() && void save(`board name “${text.trim()}”`, () => api.boards.rename(board.id, text.trim()), { key: `pb-name-${board.id}` }),
    board.id,
  );
  const update = (patch: PadPatch, padId = selected?.pad.id) => {
    if (!padId) return Promise.resolve(null);
    const pad = findPad(board, padId)?.pad;
    const what = padSaveWords(patch, pad?.label ?? "pad");
    return save(what, () => api.boards.updatePad(board.id, padId, patch), { key: `pad-${padId}-${what}` }).then((done) => done ?? null);
  };

  /* ---------- changes to the board ---------- */

  const resize = async (cols: number, rows: number) => {
    cols = Math.max(1, Math.min(MAX_SIZE, cols));
    rows = Math.max(1, Math.min(MAX_SIZE, rows));
    if (cols === board.cols && rows === board.rows) return;
    const before = board;
    let result;
    try {
      result = await api.boards.resize(board.id, cols, rows);
    } catch (error) {
      toast(`That did not work: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (result.ok === false) {
      toast(result.refusal.message);
      return;
    }
    const after = result.value.board;
    const moved = result.value.movedToSpare.map((id) => findPad(before, id)?.pad.label ?? "");
    const back = result.value.cameBack.map((id) => findPad(before, id)?.pad.label ?? "");
    const text = resizeMessage(after, moved, back);
    if (moved.length) setSpareOpen(true);
    if (focusIndex >= cols * rows) setFocusIndex(0);
    setMessage({ text, undoLabel: result.undoLabel, cols: before.cols, rows: before.rows });
    say(text);
  };

  const stepper = (axis: "cols" | "rows", label: string) => {
    const value = board[axis];
    const fewer = `Fewer ${label.toLowerCase()}`;
    const more = `More ${label.toLowerCase()}`;
    const step = (d: number) => {
      if ((d < 0 && value <= 1) || (d > 0 && value >= MAX_SIZE)) {
        say(d > 0 ? `Already at the largest size, ${MAX_SIZE}` : "Already at the smallest size, 1");
        return;
      }
      void (axis === "cols" ? resize(board.cols + d, board.rows) : resize(board.cols, board.rows + d));
    };
    return (
      <div className="pb-step" role="group" aria-label={label}>
        <span className="pb-step-l">{label}</span>
        <IconButton icon="minus" size="s" label={fewer} aria-disabled={value <= 1 ? true : undefined} onClick={() => step(-1)} />
        <span className="pb-step-v num" aria-live="polite">
          {value}
        </span>
        <IconButton icon="plus" size="s" label={more} aria-disabled={value >= MAX_SIZE ? true : undefined} onClick={() => step(1)} />
      </div>
    );
  };

  const undoResize = async () => {
    if (!message) return;
    const history = await api.history.state().catch((): null => null);
    if (!history || history.undoLabel !== message.undoLabel) {
      setMessage(null);
      toast("That cannot be undone here any more: something else changed since.");
      return;
    }
    const done = await write(api.history.undo());
    if (!done) return;
    setMessage(null);
    say(`Undone. Grid is ${message.cols} × ${message.rows} again.`);
    focusLater("pb-name");
  };

  /** Moving onto a pad swaps the two (boards.js moveTo). */
  const moveTo = async (pid: string, to: number | "spare") => {
    const at = findPad(board, pid);
    if (!at) return;
    if (to === "spare" ? at.where === "spare" : at.where === "slot" && at.index === to) return;
    const other = to === "spare" ? null : board.slots[to];
    const text = moveMessage(board, at.pad, to, other, at.where === "spare");
    const done = await write(api.boards.movePad(board.id, pid, to === "spare" ? "spare" : { slot: to }));
    if (done === null) return;
    if (to === "spare") setSpareOpen(true);
    else setFocusIndex(to);
    say(text);
  };

  const putBack = (pid: string) => {
    const empty = board.slots.indexOf(null);
    if (empty < 0) {
      toast("No empty slot. Make the grid bigger first.");
      return;
    }
    focusLater(`slot-${empty}`, { pid });
    void moveTo(pid, empty);
  };

  const putAllBack = async () => {
    const done = await write(api.boards.putAllBack(board.id));
    if (!done) return;
    const left = board.spare.length - done.putBack.length;
    say(`${plural(done.putBack.length, "pad")} put back in the grid${left ? `; ${left} still spare` : ""}`);
  };

  const addPad = async (index: number) => {
    const made = await write(api.boards.addPad(board.id, index));
    if (!made) return;
    select(made.id);
    setFocusIndex(index);
    setPadOpen(true);
    focusLater("pb-label", { pid: made.id, select: true });
    say(`New pad added at ${place(board.cols, index)}. Give it a label.`);
  };

  const duplicatePad = async (at: PadAt) => {
    const done = await write(api.boards.duplicatePad(board.id, at.pad.id));
    if (!done) return;
    if (done.place === "spare") {
      setSpareOpen(true);
      toast("No empty slot, so the copy went to Spare pads");
    } else {
      setFocusIndex(done.place.slot);
      say(`Copy added at ${place(board.cols, done.place.slot)} and selected`);
    }
    select(done.pad.id);
    focusLater("pb-label", { pid: done.pad.id });
  };

  /* ---------- sound ---------- */

  const fire = (pad: { id: string; label: string; mode: string }) => {
    const wasOn = sound.onAir(board.id, pad.id);
    let outcome;
    if (pad.mode === "hold") {
      outcome = pressHeld(board.id, pad.id);
    } else {
      outcome = sound.audio.firePad(board.id, pad.id);
    }
    if (outcome.ok) say(`${pad.mode === "toggle" && !wasOn ? "Started on air: " : "On air: "}${pad.label}`);
  };

  /* ---------- menus ---------- */

  const openMenu = (anchor: HTMLElement, owner: string, label: string, items: MenuEntry[]) => {
    menuAnchor.current = anchor;
    menuCount.current += 1;
    setMenu({ owner, label, items, n: menuCount.current });
  };
  const moveMenu = (at: PadAt, anchor: HTMLElement, owner: string) => {
    const items: MenuEntry[] = [{ group: `Move "${at.pad.label}" to` }];
    if (at.where === "slot") {
      items.push({ label: "Spare pads", icon: "queue", onSelect: () => (focusLater(`sp-${at.pad.id}`), void moveTo(at.pad.id, "spare")) }, { separator: true });
    }
    board.slots.forEach((p, i) => {
      if (at.where === "slot" && at.index === i) return;
      const where = place(board.cols, i).replace(/^r/, "R");
      items.push({
        label: `${where}: ${p ? `swap with ${p.label}` : "empty"}`,
        icon: p ? "shuffle" : "plus",
        onSelect: () => {
          focusLater(`slot-${i}`, { pid: at.pad.id });
          void moveTo(at.pad.id, i);
        },
      });
    });
    openMenu(anchor, owner, "Move to", items);
  };
  const deletePadEntry = (at: PadAt): MenuEntry => ({ label: "Delete pad…", icon: "trash", onSelect: () => setDeletingPad(at) });
  /** PLY-8: a pad plays its sound; What it does… adds steps, such as turning the music down first. */
  const stepsEntry = (at: PadAt): MenuEntry => ({ label: "What it does…", icon: "list", onSelect: () => setStepsPad(at.pad) });
  const padMenu = (at: PadAt, anchor: HTMLElement) =>
    openMenu(anchor, "pad", "Pad", [
      stepsEntry(at),
      { label: "Duplicate pad", onSelect: () => void duplicatePad(at) },
      { label: "Move to…", onSelect: () => moveMenu(at, anchor, "pad") },
      { separator: true },
      deletePadEntry(at),
    ]);
  const tileMenu = (at: PadAt, anchor: HTMLElement) =>
    openMenu(anchor, `tile-${at.pad.id}`, "Pad", [
      { group: at.pad.label },
      { label: "Preview", icon: "headphones", onSelect: () => sound.previewPad(board.id, at.pad.id) },
      { label: "Play on air", icon: "playair", onSelect: () => fire(at.pad) },
      { label: "Duplicate pad", onSelect: () => void duplicatePad(at) },
      { label: "Move to…", onSelect: () => moveMenu(at, anchor, `tile-${at.pad.id}`) },
      deletePadEntry(at),
    ]);
  const spareMenu = (at: PadAt, anchor: HTMLElement) => {
    const empty = board.slots.includes(null);
    openMenu(anchor, `spare-${at.pad.id}`, "Spare pad", [
      { group: at.pad.label },
      { label: "Put back in the grid", icon: "left", disabled: !empty, onSelect: () => putBack(at.pad.id) },
      { label: "Move to…", onSelect: () => moveMenu(at, anchor, `spare-${at.pad.id}`) },
      { separator: true },
      deletePadEntry(at),
    ]);
  };

  /* ---------- keyboard and pointer ---------- */

  /** Alt+arrow moves the selected pad on the grid; anywhere on the board but in a text field. */
  const altMove = (arrow: string, inGrid: boolean) => {
    if (!selected) return;
    if (selected.where !== "slot") {
      say(`${selected.pad.label} is in Spare pads. Use Put back or Move to.`);
      return;
    }
    const j = neighbour(board.cols, board.rows, selected.index, arrow);
    if (j < 0) {
      say(`${selected.pad.label} is already at the edge`);
      return;
    }
    if (inGrid) focusLater(`slot-${j}`, { pid: selected.pad.id });
    void moveTo(selected.pad.id, j);
  };

  const onBodyKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey || !isArrow(e.key) || isTyping(e.target)) return;
    e.preventDefault();
    altMove(e.key, false);
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const index = Number(target.dataset.slot);
    if (Number.isNaN(index) || e.ctrlKey || e.metaKey) return;
    if ((e.key === "p" || e.key === "P") && !e.altKey) {
      const pad = board.slots[index];
      if (pad) {
        e.preventDefault();
        sound.previewPad(board.id, pad.id);
      }
      return;
    }
    if (!isArrow(e.key)) return;
    e.preventDefault();
    if (e.altKey) {
      altMove(e.key, true);
      return;
    }
    if (e.shiftKey) return;
    const next = neighbour(board.cols, board.rows, index, e.key);
    if (next < 0) return;
    setFocusIndex(next);
    const pad = board.slots[next];
    if (pad) select(pad.id);
    rootRef.current?.querySelector<HTMLElement>(`[data-k="slot-${next}"]`)?.focus();
  };

  const onPadClick = (e: React.MouseEvent, index: number, pid: string, label: string) => {
    setFocusIndex(index);
    if (tryPads.on) {
      // Trying: the tile is the pad as in Live. A hold pad plays on pointer down instead (tryPads.tileProps).
      const pad = board.slots[index];
      if (pad && pad.mode !== "hold") tryPads.press(pad, "down");
      return;
    }
    const same = selected?.pad.id === pid;
    const now = Date.now();
    if (e.detail > 0 && same && lastClick.current.pid === pid && now - lastClick.current.t < DOUBLE_CLICK_MS) {
      lastClick.current = { pid: null, t: 0 };
      sound.previewPad(board.id, pid);
      return;
    }
    lastClick.current = { pid, t: now };
    if (!same) {
      select(pid);
      say(`${label} selected for editing`);
    }
  };

  const dragProps = (pid: string) => ({
    // While trying, pressing a pad plays it, so it does not drag.
    draggable: !tryPads.on,
    onDragStart: (e: React.DragEvent) => {
      dragging.current = pid;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", pid);
      (e.currentTarget as HTMLElement).classList.add("dragging");
    },
    onDragEnd: (e: React.DragEvent) => {
      dragging.current = null;
      setDropOver(null);
      (e.currentTarget as HTMLElement).classList.remove("dragging");
    },
  });
  const dropProps = (to: string) => ({
    // A pad dragged within the board is handled here and goes no further: the page's drop guard (SEC-7), which
    // refuses everything else dropped on the page, never sees it. Files dropped here still reach the guard.
    onDragOver: (e: React.DragEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (dropOver !== to) setDropOver(to);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (dropOver === to && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      const pid = dragging.current;
      if (!pid) return;
      e.preventDefault();
      e.stopPropagation();
      dragging.current = null;
      setDropOver(null);
      select(pid);
      if (to === "spare") {
        focusLater(`sp-${pid}`);
        void moveTo(pid, "spare");
      } else {
        const index = Number(to);
        focusLater(`slot-${index}`, { pid });
        void moveTo(pid, index);
      }
    },
  });

  /* ---------- drawing ---------- */

  const uses = usesOfBoard(campaigns, board.id);
  const count = padCount(board);
  const sounding = board.slots.filter((p) => p && sound.onAir(board.id, p.id)).length;
  const padsStatus = sounding
    ? { text: `${sounding} sounding`, tone: "live" as const }
    : tryPads.on
      ? { text: "Trying", tone: "on" as const }
      : count
        ? { text: plural(count, "pad"), tone: "idle" as const }
        : { text: "Empty", tone: "idle" as const };

  /** ORG-4: take a divider off the board. */
  const removeDivider = async (row: number, name: string) => {
    if (await save(board.name, () => api.boards.setDivider(board.id, row, null), { detail: `divider “${name}” removed` })) focusLater("pb-name");
  };

  const slot = (pad: PadBoard["slots"][number], index: number) => {
    const where = place(board.cols, index);
    const tabIndex = index === fi ? 0 : -1;
    if (!pad) {
      return (
        <div key={index} className={dropOver === String(index) ? "pb-slot pb-over" : "pb-slot"} {...dropProps(String(index))}>
          <button
            type="button"
            className="pb-empty"
            data-k={`slot-${index}`}
            data-slot={index}
            data-pid=""
            tabIndex={tabIndex}
            // Round 6, Must 5 (WCAG 2.5.3): named as it reads.
            aria-label={`Add pad: ${where}`}
            onClick={() => {
              setFocusIndex(index);
              void addPad(index);
            }}
          >
            <Icon name="plus" size="s" />
            <span className="pb-empty-t">Add pad</span>
          </button>
        </div>
      );
    }
    const on = sound.onAir(board.id, pad.id);
    const tried = tryPads.sounding(pad);
    const pv = !tried && sound.previewing(board.id, pad.id);
    const isSel = selected?.pad.id === pad.id;
    const at: PadAt = { where: "slot", index, pad };
    // While trying, aria-pressed says whether the pad sounds (a press then stops it, BUG-20); otherwise which pad is
    // selected.
    const pressed = tryPads.on ? tried : isSel;
    const classes = ["pb-slot", "pb-has", isSel && "sel", on && "on", pv && "pv", tried && "trying", dropOver === String(index) && "pb-over"].filter(Boolean).join(" ");
    return (
      <div key={index} className={classes} style={colourOf(pad.color)} {...dropProps(String(index))}>
        <button
          type="button"
          className={isSel ? "pb-pad sel" : "pb-pad"}
          data-k={`slot-${index}`}
          data-slot={index}
          data-pid={pad.id}
          tabIndex={tabIndex}
          aria-pressed={pressed}
          aria-label={padTileName(pad, board.cols, index, on ? "on air" : tried ? "trying" : pv ? "previewing" : null)}
          onClick={(e) => onPadClick(e, index, pad.id, pad.label)}
          {...tryPads.tileProps(pad)}
          onContextMenu={(e) => {
            e.preventDefault();
            setFocusIndex(index);
            if (!isSel) select(pad.id);
            tileMenu(at, e.currentTarget);
          }}
          {...dragProps(pad.id)}
        >
          <span className="pb-pad-label">{pad.label}</span>{" "}
          <span className="pb-pad-meta">
            {pad.key && <span className="kbd">{keyLabel(pad.key)}</span>}
            <span className="pb-mode" title={MODE_NAME[pad.mode]}>
              <Icon name={MODE_ICON[pad.mode]} size="s" />
            </span>
            {on ? <span className="pb-playing">On air</span> : tried && <span className="pb-trying">{pad.mode === "toggle" || pad.mode === "hold" ? "Sounding" : "Playing"}</span>}
          </span>
        </button>
        <span className="pb-tile-pv">
          <PreviewButton target={{ kind: "pad", boardId: board.id, padId: pad.id }} name={pad.label} tabIndex={-1} icon="play" />
        </span>
      </div>
    );
  };

  const nameId = `${helpId}-name`;
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>{nameField.value || board.name}</h1>
        <span className="grow" />
        <Button icon="link" onClick={() => setUseIn(true)}>
          Use in…
        </Button>
        <MenuButton
          label="More for this board"
          icon="more"
          items={[
            { label: "See it in the live view", icon: "broadcast", onSelect: () => go("live") },
            // Round 7 (ORG-4): a name above a row of pads.
            { label: "Add a divider…", icon: "list", onSelect: () => setAddingDivider(true) },
            { label: "Duplicate board", onSelect: () => void duplicateBoard(board) },
            { separator: true },
            { label: "Delete board…", icon: "trash", onSelect: () => setDeletingBoard(true) },
          ]}
        />
      </div>
      <div className="pb-body" ref={rootRef} onKeyDown={onBodyKeyDown}>
        <div className="pb-ed">
          <Column className="pb-left">
            <Pane
              id="pb-grid"
              title="Pads"
              icon="grid"
              kind="fx"
              size="auto"
              // Round 6 (UX-R3): the quick-size buttons show the size while the box is open.
              summary={`${board.cols} × ${board.rows}`}
              foldedSummary
              status={padsStatus}
              actions={
                <Button
                  size="s"
                  className="pb-trybtn"
                  icon={tryPads.on ? "check" : "headphones"}
                  pressed={tryPads.on}
                  data-k="pb-trymode"
                  title="Press pads and their keys to hear how they play, in your headphones only"
                  onClick={tryPads.toggle}
                >
                  Try pads
                </Button>
              }
            >
              <div className="pb-tools">
                <div className="field pb-name">
                  <label htmlFor={nameId}>Board name</label>
                  <input
                    id={nameId}
                    className="input"
                    data-k="pb-name"
                    value={nameField.value}
                    onChange={(e) => nameField.onChange(e.target.value)}
                    onFocus={nameField.onFocus}
                    onBlur={nameField.onBlur}
                  />
                </div>
                <div className="pb-sizes">
                  {stepper("cols", "Columns")}
                  {stepper("rows", "Rows")}
                  <div className="seg s" role="group" aria-label="Quick sizes">
                    {QUICK_SIZES.map(([c, r]) => (
                      <button
                        key={`${c}x${r}`}
                        type="button"
                        aria-pressed={board.cols === c && board.rows === r}
                        aria-label={`${c}×${r}, ${c} columns by ${r} rows`}
                        onClick={() => void resize(c, r)}
                      >
                        {c}×{r}
                      </button>
                    ))}
                  </div>
                  <span className="pb-count">
                    <b className="num">{count}</b> of <b className="num">{board.slots.length}</b> slots used
                  </span>
                </div>
              </div>
              {message && (
                <div className="pb-msg" role="status">
                  <Icon name="check" size="s" />
                  <span className="grow">{message.text}</span>
                  <Button size="s" onClick={() => void undoResize()}>
                    Undo
                  </Button>
                  <IconButton
                    icon="close"
                    quiet
                    label="Dismiss message"
                    hint="Dismiss"
                    onClick={() => {
                      setMessage(null);
                      focusLater("pb-name");
                    }}
                  />
                </div>
              )}
              {tryPads.on && (
                <p className="pb-tryhint" role="note">
                  <Icon name="headphones" size="s" />
                  <span>Trying: pads play as they will in Live, keys too, but only you hear them. Click a pad, or press its key; hold a Hold to play pad.</span>
                </p>
              )}
              <div
                className="pb-grid"
                role="group"
                aria-label={`Pads, ${board.cols} columns by ${board.rows} rows`}
                aria-describedby={helpId}
                style={{ gridTemplateColumns: `repeat(${board.cols},minmax(0,1fr))` }}
                onKeyDown={onGridKeyDown}
              >
                {board.slots.map((pad, index) => {
                  // ORG-4: a divider names the row it sits above.
                  const divider = index % board.cols === 0 ? board.dividers?.find((d) => d.row === index / board.cols) : undefined;
                  return divider ? (
                    <React.Fragment key={`d${index}`}>
                      <BoardDivider name={divider.name} onRemove={() => void removeDivider(divider.row, divider.name)} />
                      {slot(pad, index)}
                    </React.Fragment>
                  ) : (
                    slot(pad, index)
                  );
                })}
              </div>
              {/* Round 6 rule 5 (UX-R3): shown only while the keyboard is in the box; always its description. */}
              <p className="hint pb-help keys-on-focus" id={helpId}>
                Drag to swap pads. Keys: arrows move, P previews, Alt+arrow moves the pad.
              </p>
            </Pane>
            <SparePads
              board={board}
              selected={selected}
              open={spareShown}
              onOpenChange={setSpareOpen}
              menuOwner={menu?.owner ?? null}
              dropProps={dropProps("spare")}
              dropOver={dropOver === "spare"}
              dragProps={dragProps}
              onPick={(pid) => select(pid)}
              onMenu={spareMenu}
              onPutAllBack={() => void putAllBack()}
            />
            <Pane
              id="pb-used"
              title="Used in"
              icon="link"
              kind="scenes"
              size="auto"
              flush
              status={{ text: uses.length ? plural(uses.length, "place") : "Not used yet", tone: "idle" }}
              actions={
                <Button size="s" onClick={() => setUseIn(true)}>
                  Use in…
                </Button>
              }
            >
              {uses.length ? (
                <ul className="list">
                  {uses.map((u) => (
                    <li key={u.label} className="lrow">
                      <span className="pb-lvl">{u.level === "campaign" ? "Campaign" : u.level === "session" ? "Session" : "Scene"}</span>
                      <a className="pb-uselink ellipsis grow" href={u.href}>
                        {u.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pb-spare-empty">Not used yet.</p>
              )}
            </Pane>
          </Column>
          <Column className="pb-right">
            {selected ? (
              <PadEditor
                key={selected.pad.id}
                board={board}
                at={selected}
                tracks={tracks}
                tagGroups={tagGroups}
                sound={sound}
                open={padOpen}
                onOpenChange={setPadOpen}
                update={update}
                onFire={fire}
                onMenu={(anchor) => padMenu(selected, anchor)}
                menuOpen={menu?.owner === "pad"}
                focusLater={focusLater}
              />
            ) : (
              <Pane id="pb-pad" title="Pad" icon="edit" kind="plain" open={padOpen} onOpenChange={setPadOpen} summary="No pad selected">
                <p className="empty">Select a pad to change it, or click an empty slot to add one.</p>
              </Pane>
            )}
          </Column>
        </div>
      </div>
      {menu && (
        <Menu
          key={menu.n}
          label={menu.label}
          items={menu.items}
          anchor={menuAnchor}
          onClose={(refocus) => {
            setMenu(null);
            if (refocus && menuAnchor.current && document.contains(menuAnchor.current)) menuAnchor.current.focus();
          }}
        />
      )}
      {useIn && <UseInDialog board={board} campaigns={campaigns} onClose={() => setUseIn(false)} />}
      {addingDivider && <BoardDividerDialog board={board} onClose={() => setAddingDivider(false)} />}
      {stepsPad && <StepsDialog owner={{ kind: "pad", board, padId: stepsPad.id, label: stepsPad.label, steps: stepsPad.steps }} onClose={() => setStepsPad(null)} />}
      {deletingBoard && <DeleteBoardDialog board={board} campaigns={campaigns} onClose={() => setDeletingBoard(false)} onDeleted={() => go("boards")} />}
      <DeletePadDialog
        board={board}
        pad={deletingPad ? deletingPad.pad : null}
        onClose={() => setDeletingPad(null)}
        onDeleted={() => {
          const at = deletingPad;
          if (!at) return;
          if (selected?.pad.id === at.pad.id) select(null);
          if (at.where === "slot") {
            setFocusIndex(at.index);
            focusLater(`slot-${at.index}`, { pid: "" });
          }
        }}
      />
    </>
  );
}

/* ---------- Try pads ---------- */

/** How long a one-shot whose length the library does not know says "Playing" (the prototype's TRY_LEN). */
const TRY_FALLBACK_MS = 2500;

/** The longest of a pad's sounds, as the library knows them (ms); null for "any effect with a tag". */
function soundLength(pad: Pad, tracks: readonly LibraryTrack[]): number | null {
  if (pad.sound.kind === "tag") return null;
  const lengths = pad.sound.trackIds.map((id) => tracks.find((t) => t.id === id)?.durationMs ?? 0);
  const longest = Math.max(0, ...lengths);
  return longest > 0 ? longest : null;
}

/**
 * SFX-12 Try pads (boards.js tryPad): while on, pressing a pad on the grid, or its key, plays it as it will play in
 * Live (LyreAudio.tryPad), in the headphones only. A toggle loop and a held pad sound while the preview is theirs; a
 * one-shot or restart pad says "Playing" for as long as its sound lasts, and a press while it plays stops it (BUG-20).
 * Turning it off, or leaving the board, stops what is being tried.
 */
function useTryPads(board: PadBoard, tracks: readonly LibraryTrack[], sound: ReturnType<typeof useBoardSound>) {
  const { say } = useAnnounce();
  const [on, setOn] = useState(false);
  /** When each one-shot or restart pad stops saying "Playing" (Date.now() ms). */
  const [until, setUntil] = useState<Record<string, number>>({});
  const [, redraw] = useState(0);
  const held = useRef<{ padId: string; key: string | null } | null>(null);

  const isOurs = () => sound.audio.getNowPlaying().preview?.key.startsWith(`pad:${board.id}/`) ?? false;
  const stop = () => {
    held.current = null;
    setUntil({});
    if (isOurs()) sound.audio.stopPreview();
  };

  const sounding = (pad: Pad): boolean => {
    if (!on || !sound.previewing(board.id, pad.id)) return false;
    if (pad.mode === "toggle" || pad.mode === "hold") return true;
    return (until[pad.id] ?? 0) > Date.now();
  };

  const press = (pad: Pad, phase: "down" | "up") => {
    const was = sounding(pad) || (pad.mode !== "oneshot" && pad.mode !== "retrigger" && sound.previewing(board.id, pad.id));
    if (phase === "up" && (pad.mode !== "hold" || !was)) return;
    if (phase === "down" && pad.mode === "hold" && was) return;
    const outcome = sound.audio.tryPad(board.id, pad.id, phase);
    if (!outcome.ok) return;
    if (phase === "down" && (pad.mode === "oneshot" || pad.mode === "retrigger")) {
      // A press while it plays stopped it (BUG-20): it no longer says Playing.
      setUntil((u) => ({ ...u, [pad.id]: was ? 0 : Date.now() + (soundLength(pad, tracks) ?? TRY_FALLBACK_MS) }));
    }
    say(tryWords(pad, phase, was));
  };

  // A one-shot's "Playing" goes when its time is up.
  useEffect(() => {
    const next = Math.min(...Object.values(until).filter((t) => t > Date.now()));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => redraw((n) => n + 1), next - Date.now() + 30);
    return () => clearTimeout(timer);
  });

  // A pad's own key tries it (grid pads only: a spare pad's key does nothing), as in Live.
  const latest = useRef({ board, press });
  latest.current = { board, press };
  useEffect(() => {
    if (!on) return;
    const padOfKey = (key: string) => latest.current.board.slots.find((p): p is Pad => !!p && !!p.key && p.key.toLowerCase() === key.toLowerCase());
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.length === 0) return;
      const pad = padOfKey(e.key);
      if (!pad) return;
      e.preventDefault();
      if (pad.mode === "hold") held.current = { padId: pad.id, key: e.key.toLowerCase() };
      latest.current.press(pad, "down");
    };
    const letGo = () => {
      const h = held.current;
      if (!h) return;
      held.current = null;
      const pad = latest.current.board.slots.find((p): p is Pad => !!p && p.id === h.padId);
      if (pad) latest.current.press(pad, "up");
    };
    const up = (e: KeyboardEvent) => {
      if (held.current?.key === e.key.toLowerCase()) letGo();
    };
    // The window losing focus (Alt+Tab to Discord) lets go of a held pad, as in Live: no keyup would ever come.
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", letGo);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", letGo);
    };
  }, [on]);

  // Leaving the board stops what is being tried.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const onRef = useRef(on);
  onRef.current = on;
  useEffect(() => () => void (onRef.current && stopRef.current()), []);

  /** A hold pad on the grid sounds while the pointer, Space or Enter is held on it. */
  const tileProps = (pad: Pad): React.ButtonHTMLAttributes<HTMLButtonElement> => {
    if (!on || pad.mode !== "hold") return {};
    const letGo = () => {
      if (held.current?.padId !== pad.id) return;
      held.current = null;
      press(pad, "up");
    };
    return {
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        held.current = { padId: pad.id, key: null };
        press(pad, "down");
      },
      onPointerUp: letGo,
      onPointerLeave: letGo,
      onPointerCancel: letGo,
      onKeyDown: (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (e.repeat) return;
        held.current = { padId: pad.id, key: e.key.toLowerCase() };
        press(pad, "down");
      },
      onKeyUp: (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
      },
    };
  };

  return {
    on,
    sounding,
    press,
    tileProps,
    toggle: () => {
      if (on) stop();
      setOn(!on);
      say(on ? "Stopped trying pads" : "Trying pads: press a pad or its key to hear it as it will play. Only you hear it.");
    },
  };
}

/* ---------- Spare pads ---------- */

function SparePads({
  board,
  selected,
  open,
  onOpenChange,
  menuOwner,
  dropProps,
  dropOver,
  dragProps,
  onPick,
  onMenu,
  onPutAllBack,
}: {
  board: PadBoard;
  selected: PadAt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuOwner: string | null;
  dropProps: React.HTMLAttributes<HTMLDivElement>;
  dropOver: boolean;
  dragProps: (pid: string) => React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  onPick: (pid: string) => void;
  onMenu: (at: PadAt, anchor: HTMLElement) => void;
  onPutAllBack: () => void;
}) {
  const n = board.spare.length;
  const empty = board.slots.includes(null);
  return (
    <Pane
      id="pb-spare"
      title="Spare pads"
      // Round 6: why spare pads exist is read out with the box, not a line on screen.
      description="Pads that are not on the grid wait here; their keys do nothing until you put them back."
      icon="queue"
      kind="fx"
      size="auto"
      open={open}
      onOpenChange={onOpenChange}
      summary={n ? board.spare.map((p) => p.label).join(", ") : ""}
      foldedSummary
      status={n ? { text: plural(n, "pad"), tone: "idle" } : { text: "Empty", tone: "idle" }}
      actions={
        n && empty ? (
          <Button size="s" onClick={onPutAllBack}>
            Put all back
          </Button>
        ) : null
      }
    >
      <div className={dropOver ? "pb-spare pb-over" : "pb-spare"} {...dropProps}>
        {n ? (
          <ul className="list">
            {board.spare.map((pad, index) => {
              const isSel = selected?.pad.id === pad.id;
              return (
                <li key={pad.id} className={isSel ? "lrow pb-sp selected" : "lrow pb-sp"} style={colourOf(pad.color)}>
                  <button type="button" className="pb-sp-pick" data-k={`sp-${pad.id}`} data-pid={pad.id} aria-pressed={isSel} onClick={() => onPick(pad.id)} {...dragProps(pad.id)}>
                    <span className="ellipsis">{pad.label}</span>{" "}
                    {pad.key && (
                      <span className="kbd pb-kbd-off" title="Does nothing while the pad is spare">
                        {keyLabel(pad.key)}
                        <span className="sr-only"> (key does nothing while spare)</span>
                      </span>
                    )}
                  </button>
                  <PreviewButton target={{ kind: "pad", boardId: board.id, padId: pad.id }} name={pad.label} />
                  <button
                    type="button"
                    className="btn s icon"
                    aria-haspopup="menu"
                    aria-expanded={menuOwner === `spare-${pad.id}`}
                    title="More"
                    aria-label={`More for ${pad.label}`}
                    onClick={(e) => onMenu({ where: "spare", index, pad }, e.currentTarget)}
                  >
                    <Icon name="more" size="s" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pb-spare-empty">None. Drag a pad here to put it aside.</p>
        )}
      </div>
    </Pane>
  );
}

/** ORG-4: a divider's name above its row of pads, with a button to remove it (r7org.js boardDividerHTML). */
function BoardDivider({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div className="pb-div">
      <h3 className="pb-div-h ellipsis" title={name}>
        {name}
      </h3>
      <IconButton icon="close" size="s" variant="ghost" label={`Remove the divider ${name}`} hint="Remove this divider" onClick={onRemove} />
    </div>
  );
}
