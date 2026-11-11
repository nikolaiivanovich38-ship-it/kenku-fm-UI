/**
 * The Scenes box (live.js scenesBox, sceneInside): Next scene (Space), the Undo strip for about 8 seconds after a scene
 * change (Ctrl+Z), and the session's scenes with Now and Next, each with Start or Restart. Scenes always start in the
 * first room. Round 6 part 5: no "Ready" and no scene count; Now and Next say where the evening is (the folded box says
 * them in its summary). In one column only Now and Next show, with Show all.
 *
 * SHW-7 (round 6 part 3, Nik 6 Nov 12:24): a scene's name unfolds it in place (Enter, or Right; Left folds), without
 * touching what plays: when it starts, its notes, its music in the order it will play, its ambience and its pad boards
 * (each unfolds to its pads). Every row has the row's buttons; Play on air there plays that item only (Rows.tsx).
 * Round 7 part 2 (PLY-8): a scene that moves on by itself, or has its own start, says so.
 */
import React from "react";

import type { SceneInfo } from "../../../common/lyre/api";
import { ExpanderButton } from "../../kit/Expander";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { cx } from "../../kit/cx";
import { useRememberedOpen } from "../../shell/ShellSettings";
import { sceneRefOf, scenePlace, useLive } from "./liveData";
import { isSingleKey, sceneBoards } from "./liveModel";
import { updateLive } from "./liveState";
import { PadGrid } from "./Pads";
import { AmbienceRow, SceneMusicList } from "./Rows";
import { SceneUndoStrip } from "./UndoStrips";
// PLY-8: a scene that differs from the usual is marked the same way as in the planner.
import { SceneMarks } from "../steps/StepsDialog";

export interface SceneActions {
  start: (index: number) => void;
  next: () => void;
  undo: () => boolean;
}

/** The box's one-line summary, shown only while it is folded (the prototype's collapsed(id) ? … : ""). */
export function useFoldedSummary(id: string, openByDefault: boolean, summary: React.ReactNode): React.ReactNode {
  const [open] = useRememberedOpen(id, openByDefault);
  return open ? undefined : summary;
}

/** A key as aria-keyshortcuts writes it ("Control+Z", "Shift+Escape", "Space"). */
export function ariaKey(key: string): string {
  return key.replace(/^Ctrl\+/, "Control+").replace(/Esc$/, "Escape");
}

export function ScenesPane({ compact, actions }: { compact: boolean; actions: SceneActions }) {
  const { session, state, rooms, keys1, keys } = useLive();
  const scenes = session.scenes;
  const nowAt = state.now;
  const next = scenes[state.standby];
  const short = compact && !state.allScenes && scenes.length > 2;
  const current = scenes[nowAt];
  const standby = nowAt < 0;
  const firstRoom = rooms[0]?.name;
  const nextKey = keys.nextScene;
  // A single key works only while single-key shortcuts are on (WCAG 2.1.4); a key with Ctrl always does.
  const showKey = !!next && (keys1 || !isSingleKey(nextKey));
  const summary = useFoldedSummary("lv-scenes", true, [current && `Now: ${current.name}`, next && `Next: ${next.name}`].filter(Boolean).join(" · "));
  return (
    <Pane id="lv-scenes" title="Scenes" icon="scroll" kind="scenes" size="auto" flush noMax keys="Alt+2" summary={summary}>
      <div className="lv-sc-top">
        <button
          type="button"
          className="btn primary lv-nextsc"
          data-lv="nextsc"
          aria-disabled={next ? undefined : "true"}
          aria-keyshortcuts={showKey ? ariaKey(nextKey) : undefined}
          title={next ? `Start ${next.name}${showKey ? ` (${nextKey})` : ""}${rooms.length > 1 && firstRoom ? `. Scenes always play in ${firstRoom}` : ""}` : "That was the last scene"}
          onClick={actions.next}
        >
          <Icon name="next" size="s" />
          <span className="ellipsis">{next ? `${standby ? "Start: " : "Next scene: "}${next.name}` : "No more scenes"}</span>
          {showKey && (
            <span className="kbd" aria-hidden="true">
              {nextKey}
            </span>
          )}
        </button>
        <SceneUndoStrip onUndo={actions.undo} />
      </div>
      <ol className="lv-scenes">
        {scenes.map((sc, i) => {
          const isNow = i === nowAt;
          const isNext = i === state.standby;
          const open = !!state.scOpen[sc.id];
          if (short && !isNow && !isNext && !open) return null;
          const name = `${isNow ? "Restart" : "Start"} scene ${i + 1}: ${sc.name}`;
          const bodyId = `lv-scb-${sc.id}`;
          return (
            <li key={sc.id} className={cx("lv-sc", isNow && "now", isNext && "next", nowAt > -1 && i < nowAt && "done", open && "open")} aria-current={isNow ? "step" : undefined}>
              <div className="lv-sc-1">
                {isNow ? <span className="badge lv-nowb">Now</span> : isNext ? <span className="badge lv-nextb">Next</span> : null}
                <SceneMarks scene={sc} />
                <button
                  type="button"
                  className="lv-sc-name"
                  data-lv={`scn-${sc.id}`}
                  data-scene={sc.id}
                  aria-expanded={open}
                  aria-controls={open ? bodyId : undefined}
                  aria-label={`Scene ${i + 1}: ${sc.name}`}
                  title={`${sc.name}: ${open ? "fold" : "see what it plays"}`}
                  onClick={() => updateLive((s) => ({ scOpen: { ...s.scOpen, [sc.id]: !open } }))}
                >
                  <Icon name="chevdown" size="s" className="lv-sc-chev" />
                  <span className="sr-only">Scene {i + 1}: </span>
                  <span className="ellipsis">{sc.name}</span>
                </button>
                <button type="button" className="btn s icon lv-sc-go" data-lv={`start-${i}`} aria-label={name} title={`${isNow ? "Restart" : "Start"} this scene`} onClick={() => actions.start(i)}>
                  <Icon name={isNow ? "restart" : "play"} size="s" />
                </button>
              </div>
              {/* Could 21: the cue for the next change of scene; the running scene's details are in Current scene. */}
              {isNext && sc.startsWhen && !open && (
                <div className="lv-sc-when ellipsis" title={`Starts when: ${sc.startsWhen}`}>
                  <span className="faint">Starts when:</span> {sc.startsWhen}
                </div>
              )}
              {open && <SceneInside scene={sc} index={i} id={bodyId} />}
            </li>
          );
        })}
      </ol>
      {compact && scenes.length > 2 && (
        <button type="button" className="lv-more lv-allsc" aria-expanded={state.allScenes} onClick={() => updateLive({ allScenes: !state.allScenes })}>
          {state.allScenes ? "Show only Now and Next" : `Show all ${scenes.length} scenes`}
        </button>
      )}
    </Pane>
  );
}

/** An unfolded scene: when it starts, its notes, its music in play order, its ambience and its pad boards. */
function SceneInside({ scene, index: i, id }: { scene: SceneInfo; index: number; id: string }) {
  const d = useLive();
  const ref = sceneRefOf(d.campaign.id, d.session.id, scene);
  const running = d.state.now === i;
  const boards = sceneBoards(scene, d.index);
  return (
    <div className="lv-sc-in" id={id}>
      {scene.startsWhen && (
        <div className="lv-sc-when">
          <span className="faint">Starts when:</span> {scene.startsWhen}
        </div>
      )}
      {scene.notes && (
        <div className="lv-sc-notes">
          <span className="lv-sc-notes-t" title={scene.notes}>
            {scene.notes}
          </span>
        </div>
      )}
      {scene.music.length ? <SceneMusicList scene={scene} label={`${scene.name}: music in play order`} running={running} keyPrefix={`in${scene.id}-`} /> : <p className="lv-in-none">No music</p>}
      <AmbienceRow scene={scene} place={scenePlace(ref)} dataLv={`in${scene.id}-amb`} />
      <div className="lv-in-line lv-in-bds">
        <span className="lane-dot fx" aria-hidden="true" />
        <span className="sr-only">Pad boards: </span>
        {boards.length ? (
          boards.map((b) => {
            const key = `scbd-${scene.id}-${b.id}`;
            return (
              <span key={b.id} className="lv-in-bd">
                <ExpanderButton label={b.name} expanded={!!d.state.expanded[key]} onToggle={() => updateLive((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } }))} />
                <span className="ellipsis" title={b.name}>
                  {b.name}
                </span>
              </span>
            );
          })
        ) : (
          <span className="faint">No pad boards</span>
        )}
      </div>
      {boards
        .filter((b) => d.state.expanded[`scbd-${scene.id}-${b.id}`])
        .map((b) => (
          <PadGrid key={b.id} board={b} box="music" keysOn={false} />
        ))}
    </div>
  );
}
