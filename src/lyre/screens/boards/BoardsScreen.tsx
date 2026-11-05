/**
 * All pad boards (#/boards; design/prototype/src/views/boards.js, "all pad boards"): a card per board with a small
 * picture of its grid, its size, where it is used, Open, Preview of its first pad and More. Search by board name or
 * pad label; filter by Used, Not used yet, and campaign.
 */
import React, { useRef, useState } from "react";
import type { CampaignInfo, PadBoard } from "../../../common/lyre/api";
import { Button } from "../../kit/Button";
import { SearchField } from "../../kit/Fields";
import { MenuButton } from "../../kit/Menu";
import { useBoards, useCampaigns } from "../../api";
import { useAnnounce } from "../../shell/Announcer";
import type { ScreenProps } from "..";
import { PAD_COLOUR, allPads, firstPad, plural, sizeText, usesOfBoard } from "./boardModel";
import { DeleteBoardDialog, NewBoardDialog, UseInDialog, useDuplicateBoard } from "./BoardDialogs";
import { PreviewButton } from "../../kit/SoundButtons";
import "./boards.css";

type Used = "all" | "used" | "unused";
const USED_OPTIONS: [Used, string][] = [
  ["all", "All"],
  ["used", "Used"],
  ["unused", "Not used yet"],
];

export function BoardsScreen(_props: ScreenProps) {
  const boards = useBoards().data;
  const campaigns = useCampaigns().data ?? [];
  const { say } = useAnnounce();
  const duplicate = useDuplicateBoard();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [used, setUsed] = useState<Used>("all");
  const [campaignId, setCampaignId] = useState("all");
  const [newBoard, setNewBoard] = useState(false);
  const [useIn, setUseIn] = useState<PadBoard | null>(null);
  const [deleting, setDeleting] = useState<PadBoard | null>(null);

  const all = boards ?? [];
  const needle = query.trim().toLowerCase();
  const padHits = (b: PadBoard) => (needle ? allPads(b).filter((p) => p.label.toLowerCase().includes(needle)) : []);
  const filter = (u: Used, cid: string) =>
    all.filter((b) => {
      const uses = usesOfBoard(campaigns, b.id);
      if (u === "used" && !uses.length) return false;
      if (u === "unused" && uses.length) return false;
      if (cid !== "all" && !uses.some((x) => x.campaignId === cid)) return false;
      return !needle || b.name.toLowerCase().includes(needle) || padHits(b).length > 0;
    });
  const shown = filter(used, campaignId);
  const filtered = needle !== "" || used !== "all" || campaignId !== "all";

  return (
    <>
      <div className="viewhead">
        <h1>Pad boards</h1>
        <span className="muted grow pb-sub">{filtered ? `Showing ${shown.length} of ${all.length}` : plural(all.length, "board")}</span>
        <Button variant="primary" icon="plus" onClick={() => setNewBoard(true)}>
          New board
        </Button>
      </div>
      <div className="viewbody">
        <div className="pb-ltools">
          <SearchField
            className="pb-lsearch"
            label="Search pad boards by board name or pad label"
            placeholder="Search boards and pads"
            value={query}
            onChange={setQuery}
            inputRef={searchRef}
          />
          <div className="seg s" role="group" aria-label="Used or not">
            {USED_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={used === value}
                onClick={() => {
                  setUsed(value);
                  say(`${filter(value, campaignId).length} pad boards shown`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="pb-camp">
            <span>Campaign</span>
            <select
              className="input"
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                say(`${filter(used, e.target.value).length} pad boards shown`);
              }}
            >
              <option value="all">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {boards === undefined ? null : shown.length ? (
          <ul className="pb-cards" aria-label="Pad boards">
            {shown.map((b) => (
              <BoardCard
                key={b.id}
                board={b}
                campaigns={campaigns}
                hits={padHits(b).map((p) => p.label)}
                onUseIn={() => setUseIn(b)}
                onDuplicate={() => void duplicate(b)}
                onDelete={() => setDeleting(b)}
              />
            ))}
          </ul>
        ) : all.length ? (
          <div className="empty">
            No pad boards match.{" "}
            <Button
              size="s"
              onClick={() => {
                setQuery("");
                setUsed("all");
                setCampaignId("all");
                searchRef.current?.focus();
              }}
            >
              Show all boards
            </Button>
          </div>
        ) : (
          <p className="empty">No pad boards yet. Make one with New board.</p>
        )}
      </div>
      <NewBoardDialog open={newBoard} onClose={() => setNewBoard(false)} />
      <UseInDialog board={useIn} campaigns={campaigns} onClose={() => setUseIn(null)} />
      <DeleteBoardDialog board={deleting} campaigns={campaigns} onClose={() => setDeleting(null)} />
    </>
  );
}

/** A small picture of the grid: a coloured cell for each pad, an outline for each empty slot. Decoration only. */
export function MiniGrid({ board }: { board: PadBoard }) {
  return (
    <span className="pb-mini" style={{ gridTemplateColumns: `repeat(${board.cols},10px)` }} aria-hidden="true">
      {board.slots.map((p, i) =>
        p ? <i key={i} className="pb-cell on" style={{ "--pc": PAD_COLOUR[p.color]?.hex ?? PAD_COLOUR.bone.hex } as React.CSSProperties} /> : <i key={i} className="pb-cell" />,
      )}
    </span>
  );
}

function BoardCard({
  board,
  campaigns,
  hits,
  onUseIn,
  onDuplicate,
  onDelete,
}: {
  board: PadBoard;
  campaigns: readonly CampaignInfo[];
  hits: string[];
  onUseIn: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const uses = usesOfBoard(campaigns, board.id);
  const first = firstPad(board);
  return (
    <li className="pb-card">
      {/* Out of the Tab path: Open below goes to the same place, so each card is one stop plus its buttons. */}
      <a className="pb-card-main" href={`#/board/${board.id}`} tabIndex={-1}>
        <MiniGrid board={board} />
        <span className="pb-card-text">
          <span className="pb-card-name ellipsis">{board.name}</span> <span className="pb-card-size">{sizeText(board)}</span>
        </span>
      </a>
      {hits.length > 0 && (
        <div className="pb-card-used">
          <span className="pb-lbl">Pads</span>{" "}
          <span className="pb-used-text">{hits.join(", ")}</span>
        </div>
      )}
      <div className="pb-card-used" title={uses.map((u) => u.label).join("\n")}>
        <span className="pb-used-text">{uses.length ? `Used in ${plural(uses.length, "place")}` : <span className="faint">Not used yet</span>}</span>
      </div>
      <div className="pb-card-acts">
        <a className="btn s" href={`#/board/${board.id}`} aria-label={`Open ${board.name}`}>
          Open
        </a>
        <span className="grow" />
        {first && (
          <PreviewButton target={{ kind: "board", board }} name={board.name} />
        )}
        <MenuButton
          label={`More for ${board.name}`}
          icon="more"
          size="s"
          items={[
            { label: "Use in…", icon: "link", onSelect: onUseIn },
            { label: "Duplicate board", onSelect: onDuplicate },
            { separator: true },
            { label: "Delete board…", icon: "trash", onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}
