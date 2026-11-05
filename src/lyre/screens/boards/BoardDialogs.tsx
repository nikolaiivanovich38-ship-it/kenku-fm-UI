/**
 * The sheets the pad board screens open: New pad board, Delete board…, Use in… and Delete pad…
 * (boards.js L.acts.pbnew, pbdelboard, pbuse via _shared.js L.assignSheet, pbdelpad).
 */
import React, { useState } from "react";
import type { CampaignInfo, PadBoard, UsePlace } from "../../../common/lyre/api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { PickerDialog, type PickerItem } from "../../kit/Picker";
import { useLyreApi } from "../../api";
import { useAnnounce } from "../../shell/Announcer";
import { MAX_SIZE, QUICK_SIZES, allPads, plural, usesOfBoard } from "./boardModel";
import { go, useWrite } from "./hooks";

/* ---------- New pad board ---------- */

export function NewBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <NewBoardBody onClose={onClose} /> : null;
}

function NewBoardBody({ onClose }: { onClose: () => void }) {
  const api = useLyreApi();
  const write = useWrite();
  const { toast } = useAnnounce();
  const [name, setName] = useState("");
  const [size, setSize] = useState({ cols: 4, rows: 3 });
  // What the number fields show while typing (an empty field is allowed until you leave it).
  const [typed, setTyped] = useState({ cols: "4", rows: "3" });
  const [custom, setCustom] = useState(false);
  const quick = QUICK_SIZES.find(([c, r]) => c === size.cols && r === size.rows);
  const colsRef = React.useRef<HTMLInputElement>(null);

  const clamp = (text: string) => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(text)) || 1));
  const setNumber = (axis: "cols" | "rows", text: string) => {
    setTyped({ ...typed, [axis]: text });
    setSize({ ...size, [axis]: clamp(text) });
    setCustom(false);
  };
  const make = async () => {
    const shown = name.trim() || "Untitled board";
    const made = await write(api.boards.create({ name: shown, cols: size.cols, rows: size.rows }));
    if (!made) return;
    onClose();
    toast(`Made "${made.name}". Click an empty slot to add a pad.`);
    go(`board/${made.id}`);
  };

  return (
    <Dialog
      open
      title="New pad board"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void make()}>
            Make board
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="pb-nb-name">Name</label>
          <input
            id="pb-nb-name"
            className="input"
            value={name}
            placeholder="For example: Harbour at night"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void make()}
          />
        </div>
        <fieldset className="pb-fs">
          <legend>Starting size (columns × rows)</legend>
          <div className="pb-qs" role="radiogroup" aria-label="Starting size">
            {QUICK_SIZES.map(([c, r]) => (
              <label key={`${c}x${r}`} className="pb-qs-opt">
                <input
                  type="radio"
                  name="pb-nb-size"
                  value={`${c}x${r}`}
                  checked={!custom && quick?.[0] === c && quick?.[1] === r}
                  onChange={() => {
                    setSize({ cols: c, rows: r });
                    setTyped({ cols: String(c), rows: String(r) });
                    setCustom(false);
                  }}
                />
                <span>
                  {c} × {r}
                </span>{" "}
                <span className="hint">{c * r} pads</span>
              </label>
            ))}
            <label className="pb-qs-opt">
              <input
                type="radio"
                name="pb-nb-size"
                value="custom"
                checked={custom || !quick}
                onChange={() => {
                  setCustom(true);
                  colsRef.current?.focus();
                }}
              />
              <span>Custom</span> <span className="hint">1 to 8 each</span>
            </label>
          </div>
          <div className="row-flex pb-nb-custom">
            <div className="field">
              <label htmlFor="pb-nb-c">Columns</label>
              <input ref={colsRef} id="pb-nb-c" className="input num" type="number" min={1} max={MAX_SIZE} value={typed.cols} onChange={(e) => setNumber("cols", e.target.value)} />
            </div>
            <span className="pb-x" aria-hidden="true">
              ×
            </span>
            <div className="field">
              <label htmlFor="pb-nb-r">Rows</label>
              <input id="pb-nb-r" className="input num" type="number" min={1} max={MAX_SIZE} value={typed.rows} onChange={(e) => setNumber("rows", e.target.value)} />
            </div>
          </div>
        </fieldset>
        <p className="hint">You can make it bigger or smaller at any time. Pads never get deleted when you make it smaller.</p>
      </div>
    </Dialog>
  );
}

/* ---------- Delete board… ---------- */

export function DeleteBoardDialog({
  board,
  campaigns,
  onClose,
  onDeleted,
}: {
  board: PadBoard | null;
  campaigns: readonly CampaignInfo[];
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const api = useLyreApi();
  const write = useWrite();
  const { toast } = useAnnounce();
  if (!board) return null;
  const uses = usesOfBoard(campaigns, board.id);
  const remove = async () => {
    const done = await write(api.boards.delete(board.id));
    onClose();
    if (done === null) return;
    toast(`Deleted "${board.name}"`);
    onDeleted?.();
  };
  return (
    <Dialog
      open
      title={`Delete "${board.name}"?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" onClick={() => void remove()}>
            Delete board
          </Button>
        </>
      }
    >
      <div className="stack">
        {uses.length ? (
          <>
            <p>This board is used in:</p>
            <ul className="pb-uselist">
              {uses.map((u) => (
                <li key={u.label}>{u.label}</li>
              ))}
            </ul>
            <p>Those places will have no pad board until you choose another.</p>
          </>
        ) : (
          <p>This board is not used anywhere.</p>
        )}
        <p className="muted">Its {plural(allPads(board).length, "pad")} go with it. The sound files stay in your library.</p>
      </div>
    </Dialog>
  );
}

/* ---------- Use in… ---------- */

/** The places "Use in…" offers, and those that use the board now (the prototype's targets()). */
function targetsForUseIn(campaigns: readonly CampaignInfo[], boardId: string): { items: PickerItem[]; selected: string[]; places: Map<string, UsePlace> } {
  const items: PickerItem[] = [];
  const selected: string[] = [];
  const places = new Map<string, UsePlace>();
  for (const c of campaigns) {
    const cid = `c:${c.id}`;
    items.push({ id: cid, label: `${c.name}: whole campaign`, sub: "Available in every session", group: c.name });
    places.set(cid, { campaignId: c.id });
    if (c.boardIds.includes(boardId)) selected.push(cid);
    for (const s of c.sessions) {
      const sid = `s:${c.id}:${s.id}`;
      items.push({ id: sid, label: `Session ${s.number}: ${s.name}`, sub: "Available in every scene of this session", group: c.name });
      places.set(sid, { campaignId: c.id, sessionId: s.id });
      if (s.boardIds.includes(boardId)) selected.push(sid);
      for (const sc of s.scenes) {
        const xid = `x:${c.id}:${s.id}:${sc.id}`;
        items.push({ id: xid, label: `Scene: ${sc.name}`, indent: true, group: c.name, sub: `Session ${s.number} · one of the pad boards in this scene` });
        places.set(xid, { campaignId: c.id, sessionId: s.id, sceneId: sc.id });
        if (sc.boardIds.includes(boardId)) selected.push(xid);
      }
    }
  }
  return { items, selected, places };
}

export function UseInDialog({ board, campaigns, onClose }: { board: PadBoard | null; campaigns: readonly CampaignInfo[]; onClose: () => void }) {
  const api = useLyreApi();
  const write = useWrite();
  const { toast } = useAnnounce();
  if (!board) return null;
  const { items, selected, places } = targetsForUseIn(campaigns, board.id);
  return (
    <PickerDialog
      open
      title={`Use "${board.name}" in…`}
      intro="Tick a campaign to make it available all campaign long, a session for that evening, or a scene to add this board to that scene."
      items={items}
      selected={selected}
      multi
      okLabel="Save"
      onClose={onClose}
      onDone={(ids) => {
        onClose();
        const chosen = ids.map((id) => places.get(id)).filter((p): p is UsePlace => p !== undefined);
        void write(api.campaigns.setUses({ kind: "board", id: board.id }, chosen)).then((done) => done !== null && toast(`Saved where "${board.name}" is used`));
      }}
    />
  );
}

/* ---------- Delete pad… ---------- */

export function DeletePadDialog({
  board,
  pad,
  onClose,
  onDeleted,
}: {
  board: PadBoard;
  pad: { id: string; label: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const api = useLyreApi();
  const write = useWrite();
  const { toast } = useAnnounce();
  if (!pad) return null;
  const remove = async () => {
    const done = await write(api.boards.deletePad(board.id, pad.id));
    onClose();
    if (done === null) return;
    onDeleted();
    toast(`Deleted the pad "${pad.label}"`);
  };
  return (
    <Dialog
      open
      title={`Delete the pad "${pad.label}"?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" onClick={() => void remove()}>
            Delete pad
          </Button>
        </>
      }
    >
      <p>The pad goes from {board.name}. Its sound files stay in your library.</p>
    </Dialog>
  );
}

/** Duplicate board: a copy right after it, used nowhere yet. */
export function useDuplicateBoard() {
  const api = useLyreApi();
  const write = useWrite();
  const { toast } = useAnnounce();
  return async (board: PadBoard) => {
    const made = await write(api.boards.duplicate(board.id));
    if (made) toast(`Made "${made.name}". It is not used anywhere yet.`);
  };
}
