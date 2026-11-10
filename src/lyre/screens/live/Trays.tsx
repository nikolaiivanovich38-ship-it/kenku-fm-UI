/**
 * The trays (live.js playlistsBox, padsBox; round 6 part 3 and the review's Should 6): "This session" holds Session
 * playlists and Session pads, "Whole campaign" holds Campaign playlists and Campaign pads. Each box starts folded and
 * stays open once unfolded (round 6 part 6); each grows with what it holds and the page scrolls (Nik, 6 Nov 21:59).
 * A playlist unfolds to its tracks in that place's order (PLY-13); the single tracks kept on hand are rows too
 * (ORG-12). Pads here are click only: the pad keys belong to Current scene's board, which is not drawn twice.
 */
import React from "react";

import type { UsePlace } from "../../../common/domain";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { useLive } from "./liveData";
import { currentBoard, ownBoards, trayContents } from "./liveModel";
import { touched, updateLive } from "./liveState";
import { PadGrid } from "./Pads";
import { PlaylistRow, TrackRow, trackOnAir } from "./Rows";
import { ToChip } from "./ToChip";

type Scope = "ss" | "cp";

const SCOPE_WORDS: Record<Scope, string> = { ss: "Session", cp: "Campaign" };

function placeOf(scope: Scope, campaignId: string, sessionId: string): UsePlace {
  return scope === "ss" ? { kind: "session", campaignId, sessionId } : { kind: "campaign", campaignId };
}

export function PlaylistsBox({ scope }: { scope: Scope }) {
  const d = useLive();
  const own = scope === "ss" ? d.session : d.campaign;
  const { playlists, tracks } = trayContents(own, d.index);
  const place = placeOf(scope, d.campaign.id, d.session.id);
  const title = `${SCOPE_WORDS[scope]} playlists`;
  const count = playlists.length + tracks.length;
  return (
    <Pane
      id={`lv-${scope}p`}
      title={title}
      scope={SCOPE_WORDS[scope]}
      scopeHidden
      label="Playlists"
      icon="playlist"
      kind="music"
      size="auto"
      collapsed
      flush
      noMax
      keys={scope === "ss" ? "Alt+4" : "Alt+6"}
      actions={<ToChip box={scope} />}
      status={{ text: String(count), tone: "idle" }}
    >
      {count ? (
        <ol className="lv-list" aria-label={title}>
          {playlists.map((id) => {
            const p = d.index.playlist(id)!;
            return (
              <PlaylistRow
                key={id}
                playlist={p}
                rowKey={`${scope}p:${id}`}
                place={place}
                box={scope}
                trackRow={(t) => <TrackRow key={t.id} track={t} rowKey={`${scope}p:${id}:${t.id}`} place={place} playlistId={id} from={{ playlistId: id, place }} box={scope} on={trackOnAir(d, t.id)} inner />}
              />
            );
          })}
          {tracks.map((id) => {
            const t = d.index.track(id)!;
            return <TrackRow key={`t-${id}`} track={t} rowKey={`${scope}t:${id}`} place={place} playlistId={null} box={scope} on={trackOnAir(d, id)} />;
          })}
        </ol>
      ) : (
        <p className="lv-in-none lv-none">None</p>
      )}
    </Pane>
  );
}

export function PadsBox({ scope }: { scope: Scope }) {
  const d = useLive();
  const { say } = useAnnounce();
  const own = scope === "ss" ? d.session : d.campaign;
  const boards = ownBoards(own.boardIds, d.index);
  const chosen = d.state.boards[scope];
  const board = boards.find((b) => b.id === chosen) ?? boards[0] ?? null;
  const keysBoard = currentBoard(d.state.boards.sc, d.scene, d.index);
  const box = scope === "ss" ? "ssd" : "cpd";
  const title = `${SCOPE_WORDS[scope]} pads`;
  const sounding = d.now.rooms.some((r) => r.effects.some((e) => e.padKey));
  // The board Current scene shows is not drawn a second time: the same pads twice is only more to read.
  const there = !!board && keysBoard?.id === board.id;
  return (
    <Pane
      id={`lv-${scope}d`}
      title={title}
      scope={SCOPE_WORDS[scope]}
      scopeHidden
      label="Pads"
      icon="grid"
      kind="fx"
      size="auto"
      collapsed
      flush
      noMax
      keys={scope === "ss" ? "Alt+5" : "Alt+7"}
      actions={
        board ? (
          <>
            <ToChip box={box} />
            {sounding && (
              <button
                type="button"
                className="btn s icon"
                aria-label="Stop pads"
                title="Stop every pad, in every room (music and ambience go on)"
                onClick={() => {
                  touched();
                  d.audio.stopPads();
                  say("Pads stopped");
                }}
              >
                <Icon name="stop" size="s" />
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {!board ? (
        <p className="lv-in-none lv-none">None</p>
      ) : (
        <>
          {(boards.length > 1 || !there) && (
            <div className="lv-pads-bar">
              {boards.length > 1 ? (
                <div className="seg s lv-bseg" role="group" aria-label={`${title}: boards`}>
                  {boards.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={b.id === board.id}
                      title={b.name}
                      onClick={() => {
                        updateLive((s) => ({ boards: { ...s.boards, [scope]: b.id } }));
                        say(`Pad board: ${b.name}`);
                      }}
                    >
                      <span className="ellipsis">{b.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="lv-bd1" title={board.name}>
                  <span className="lane-dot fx" aria-hidden="true" />
                  {board.name}
                </span>
              )}
            </div>
          )}
          {there ? <p className="lv-in-none lv-none lv-bd-there">{board.name}: in Current scene</p> : <PadGrid board={board} box={box} keysOn={false} />}
        </>
      )}
    </Pane>
  );
}
