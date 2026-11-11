/**
 * Current scene (live.js currentScene, round 6 part 3: "the current playing scene, with all the details of that scene
 * expanded"): the running scene's notes, its music in the order it plays (each row with the row's buttons and Repeat
 * one, saved with the scene, PLY-17), its ambience, and its pad boards with Stop pads while a pad sounds (BUG-20). The
 * board shown here is the one whose keys are the live keys. Before a scene starts it says "No scene yet". Its ⋯ holds
 * the rare things: play its music from the top, open it in the planner, edit its pad board. Sound goes to its room
 * (To:); scenes themselves always start in the first room.
 */
import React from "react";

import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { LIVE_FADE_MS } from "./liveActions";
import { sceneRefOf, scenePlace, sceneSteps, showLibraryOf, useBoxTarget, useLive } from "./liveData";
import { currentBoard, sceneBoards } from "./liveModel";
import { touched, updateLive } from "./liveState";
import { PadGrid } from "./Pads";
import { AmbienceRow, SceneMusicList } from "./Rows";
import { ToChip } from "./ToChip";

/** Notes longer than this fold to two lines, with More. */
const LONG_NOTES = 70;

export function CurrentScenePane() {
  const d = useLive();
  const { scene, index, state, campaign, session, now, keys1, audio } = d;
  const target = useBoxTarget("music");
  const { say } = useAnnounce();
  const boards = sceneBoards(scene, index);
  const board = currentBoard(state.boards.sc, scene, index);
  const sounding = now.rooms.reduce((n, r) => n + r.effects.filter((e) => e.padKey).length, 0);
  const ref = scene ? sceneRefOf(campaign.id, session.id, scene) : null;

  const stopPads = () => {
    touched();
    audio.stopPads();
    say("Pads stopped");
    // Stop pads goes with the last sound: focus goes to the first pad, not to the page.
    const first = document.querySelector<HTMLElement>('[data-pane="lv-current"] .lv-cur-pads .lv-pad');
    if (first) first.focus({ preventScroll: true });
  };

  const more = (): PopMenuEntry[] =>
    scene && ref
      ? [
          {
            key: "top",
            content: (
              <>
                <Icon name="playair" size="s" />
                <span className="grow">Play its music from the top{target.inWhere}</span>
              </>
            ),
            onSelect: () => {
              touched();
              const first = sceneSteps(showLibraryOf(index, d.campaigns, d.overrides, d.orders), ref, 0)[0];
              if (first) for (const t of target.targets) audio.playTrack(first.trackId, { target: t, from: { scene: ref, at: 0 }, fadeMs: LIVE_FADE_MS });
            },
          },
          {
            key: "planner",
            content: (
              <>
                <Icon name="edit" size="s" />
                Open in the session planner
              </>
            ),
            onSelect: () => (window.location.hash = `#/session/${campaign.id}/${session.id}`),
          },
          ...(board
            ? [
                {
                  key: "board",
                  content: (
                    <>
                      <Icon name="grid" size="s" />
                      Edit the pad board {board.name}
                    </>
                  ),
                  onSelect: () => (window.location.hash = `#/board/${board.id}`),
                },
              ]
            : []),
        ]
      : [];

  const actions = (
    <>
      <ToChip box="music" />
      {scene && (
        <PopMenuButton label={scene.name} className="closer" ariaLabel={`More for ${scene.name}`} title="More" focusKey="lv-curmenu" dataK="lv-curmenu" items={more}>
          <Icon name="more" />
        </PopMenuButton>
      )}
    </>
  );

  return (
    <Pane
      id="lv-current"
      title="Current scene"
      icon="play"
      kind="current"
      size="auto"
      flush
      noMax
      keys="Alt+3"
      actions={actions}
      summary={
        scene ? (
          <b className="lv-cur-n" title={`${scene.name}${scene.startsWhen ? `. Started when: ${scene.startsWhen}` : ""}`}>
            {scene.name}
          </b>
        ) : undefined
      }
    >
      {!scene || !ref ? (
        <p className="lv-none">No scene yet</p>
      ) : (
        <>
          {scene.notes && (
            <div className={cx("lv-sc-notes lv-cur-notes", state.notesOpen && "open")} id="lv-notes">
              <span className="lv-sc-notes-t" title={scene.notes}>
                {scene.notes}
              </span>
              {scene.notes.length > LONG_NOTES && (
                <button type="button" className="lv-more" aria-expanded={state.notesOpen} aria-controls="lv-notes" onClick={() => updateLive({ notesOpen: !state.notesOpen })}>
                  {state.notesOpen ? "Less" : "More"}
                </button>
              )}
            </div>
          )}
          {scene.music.length ? <SceneMusicList scene={scene} label={`${scene.name}: music in the order it plays`} running keyPrefix="sc" /> : <p className="lv-in-none">No music</p>}
          <AmbienceRow scene={scene} place={scenePlace(ref)} dataLv="cur-amb" />
          {board && (
            <div className="lv-cur-pads">
              <div className="lv-pads-bar">
                {boards.length > 1 ? (
                  <div className="seg s lv-bseg" role="group" aria-label="This scene's pad boards">
                    {boards.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={b.id === board.id}
                        title={b.name}
                        onClick={() => {
                          updateLive((s) => ({ boards: { ...s.boards, sc: b.id } }));
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
                <span className="grow" />
                {!keys1 && <span className="hint">Pad keys are off</span>}
                {/* BUG-20: Stop pads stops every pad sound, in every room; music and ambience go on. It shows while a pad sounds. */}
                {sounding > 0 && (
                  <button type="button" className="btn s" data-lv="padstop" title="Stop every pad, in every room (music and ambience go on)" onClick={stopPads}>
                    <Icon name="stop" size="s" />
                    Stop pads
                  </button>
                )}
              </div>
              <PadGrid board={board} box="music" keysOn />
            </div>
          )}
        </>
      )}
    </Pane>
  );
}
