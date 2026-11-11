/**
 * PLY-8 (design round 7, r7play.js stepsopen): the steps dialog, "When The abbey ruins starts" (a scene's ⋯ › What
 * it does when it starts…) or "When Thunder crack is pressed" (a pad's ⋯ › What it does…). The usual steps are shown
 * when nothing else was chosen; each step is a sentence with Move up, Move down and Remove, and a play step has How it
 * comes in, Up next and From. Add a step, Put back the usual, Try in headphones (the first step that plays, as a
 * preview), and for a scene Then (it can move on by itself). Done saves (the usual steps keep none), with the Saved
 * pop-up; Cancel or Esc keeps what was there.
 */
import React, { useMemo, useState } from "react";
import type { SoundRef } from "../../../common/domain";
import { stepsOf, stepsToKeep, usualPadSteps, usualSceneSteps, type CueStep, type MovesOn } from "../../../common/domain/round7";
import type { PadBoard, SceneInfo, WriteResult } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useBoards, useCampaigns, useLyreApi, usePlaylists, useTracks } from "../../api";
import { useLyreAudio } from "../../audio";
import { Button, IconButton } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { MenuButton } from "../../kit/Menu";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import {
  FADE_SECONDS,
  finished,
  HOW_CHOICES,
  LEVEL_CHOICES,
  movesOnOf,
  moveStep,
  NEW_STEPS,
  sceneKey,
  sceneOf,
  sentence,
  soundKey,
  soundOf,
  STOP_CHOICES,
  THEN_CHOICES,
  UP_NEXT_CHOICES,
  WAIT_SECONDS,
  type DraftStep,
  type StepNames,
} from "./stepsModel";
import "./steps.css";

export type StepsOwner =
  | { kind: "scene"; campaignId: string; sessionId: string; scene: SceneInfo }
  | { kind: "pad"; board: PadBoard; padId: string; label: string; steps: CueStep[] | null };

/** One empty list for every read not answered yet, so the lists made from them are not made anew each time. */
const NONE: never[] = [];

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function StepsDialog({ owner, onClose }: { owner: StepsOwner; onClose: () => void }) {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const save = useSave();
  const { say, toast } = useAnnounce();
  const tracks = useTracks().data ?? NONE;
  const playlists = usePlaylists().data ?? NONE;
  const boards = useBoards().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;

  const usual = owner.kind === "scene" ? usualSceneSteps(owner.scene) : usualPadSteps();
  const [steps, setSteps] = useState<DraftStep[]>(() => stepsOf(owner.kind === "scene" ? owner.scene.steps : owner.steps, usual));
  const [then, setThen] = useState<MovesOn["when"]>(owner.kind === "scene" ? owner.scene.movesOn.when : "stay");

  const names: StepNames = useMemo(
    () => ({
      sound: (ref) => {
        if (ref.kind === "playlist") return playlists.find((p) => p.id === ref.id)?.name ?? "a playlist";
        const t = tracks.find((x) => x.id === ref.id);
        return t ? shownTitle(t) : "a track";
      },
      board: (id) => boards.find((b) => b.id === id)?.name ?? "a pad board",
      pad: (boardId, padId) => {
        const b = boards.find((x) => x.id === boardId);
        const p = b ? [...b.slots, ...b.spare].find((x) => x?.id === padId) : undefined;
        return b && p ? `${b.name} › ${p.label}` : "a pad";
      },
      scene: (a) => {
        const s = campaigns.find((c) => c.id === a.campaignId)?.sessions.find((x) => x.id === a.sessionId);
        return s?.scenes.find((x) => x.id === a.sceneId)?.name ?? "a scene";
      },
    }),
    [tracks, playlists, boards, campaigns],
  );

  const playables = useMemo(
    () => [
      ...playlists.filter((p) => p.lane === "music").map((p): [string, string] => [soundKey({ kind: "playlist", id: p.id }), `${p.name} (playlist)`]),
      ...tracks.filter((t) => t.kind !== "amb").map((t): [string, string] => [soundKey({ kind: "track", id: t.id }), shownTitle(t)]),
    ],
    [playlists, tracks],
  );
  const padChoices = useMemo(
    () => boards.flatMap((b) => [...b.slots, ...b.spare].flatMap((p): [string, string][] => (p ? [[`${b.id}/${p.id}`, `${b.name} › ${p.label}`]] : []))),
    [boards],
  );
  const sceneChoices = useMemo(
    () =>
      campaigns.flatMap((c) =>
        c.sessions.flatMap((s) => s.scenes.map((sc): [string, string] => [sceneKey({ campaignId: c.id, sessionId: s.id, sceneId: sc.id }), `Session ${s.number} › ${sc.name}`])),
      ),
    [campaigns],
  );
  const markersOf = (ref: SoundRef | null) => (ref?.kind === "track" ? (tracks.find((t) => t.id === ref.id)?.profile.markers ?? []) : []);

  const change = (i: number, next: DraftStep) => setSteps((all) => all.map((s, j) => (j === i ? next : s)));
  const title = owner.kind === "scene" ? `When ${owner.scene.name || "this scene"} starts` : `When ${owner.label} is pressed`;

  const tryIt = () => {
    const first = steps.find((s): s is Extract<DraftStep, { do: "music" | "play" }> => (s.do === "music" || s.do === "play") && !!s.what);
    if (!first?.what) {
      if (owner.kind === "pad") audio.previewPad(owner.board.id, owner.padId);
      else toast("No step plays anything yet");
      return;
    }
    if (first.what.kind === "playlist") audio.previewPlaylist(first.what.id);
    else audio.previewTrack(first.what.id);
  };

  const done = async () => {
    const ready = finished(steps);
    if ("waiting" in ready) {
      toast(`Step ${ready.waiting} needs its choice first`);
      return;
    }
    const keep = stepsToKeep(ready.steps, usual);
    let write: () => Promise<WriteResult<unknown>>;
    let what: string;
    if (owner.kind === "scene") {
      const address = { campaignId: owner.campaignId, sessionId: owner.sessionId, sceneId: owner.scene.id };
      write = () => api.sessions.setSceneSteps(address, keep, movesOnOf(then));
      what = `what ${owner.scene.name || "the scene"} does when it starts`;
    } else {
      write = () => api.boards.setPadSteps(owner.board.id, owner.padId, keep);
      what = `what ${owner.label} does`;
    }
    if (await save(what, write)) onClose();
  };

  const select = (i: number, field: string, label: string, value: string, options: readonly (readonly [string | number, string])[], onPick: (v: string) => void) => {
    const id = `stp-${i}-${field}`;
    return (
      <span className="stp-f" key={field}>
        <label htmlFor={id}>{label}</label>
        <select className="input" id={id} data-k={id} value={value} onChange={(e) => onPick(e.target.value)}>
          {options.map(([v, text]) => (
            <option key={String(v)} value={String(v)}>
              {text}
            </option>
          ))}
        </select>
      </span>
    );
  };

  const controls = (step: DraftStep, i: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    if (step.do === "play")
      out.push(select(i, "what", "What", step.what ? soundKey(step.what) : "", [["", "Choose…"], ...playables], (v) => change(i, { ...step, what: soundOf(v), fromMs: null })));
    if (step.do === "music" || step.do === "play") {
      out.push(select(i, "how", "How it comes in", step.how, HOW_CHOICES, (v) => change(i, { ...step, how: v as typeof step.how })));
      out.push(select(i, "queue", "Up next", step.upNext, UP_NEXT_CHOICES, (v) => change(i, { ...step, upNext: v as typeof step.upNext })));
      const markers = markersOf(step.what);
      if (markers.length)
        out.push(
          select(i, "from", "From", step.fromMs === null ? "" : String(step.fromMs), [["", "The start"], ...markers.map((m): [number, string] => [m.atMs, `${m.label} (${fmt(m.atMs)})`])], (v) =>
            change(i, { ...step, fromMs: v === "" ? null : Number(v) }),
          ),
        );
    }
    if (step.do === "stop") out.push(select(i, "what", "What", step.what, STOP_CHOICES, (v) => change(i, { ...step, what: v as typeof step.what })));
    if (step.do === "fade") {
      out.push(select(i, "level", "Level", String(Math.round(step.level * 100)), LEVEL_CHOICES.map((n): [number, string] => [n, `${n}%`]), (v) => change(i, { ...step, level: Number(v) / 100 })));
      out.push(select(i, "secs", "Over", String(step.ms / 1000), FADE_SECONDS.map((n): [number, string] => [n, `${n} s`]), (v) => change(i, { ...step, ms: Number(v) * 1000 })));
    }
    if (step.do === "wait") out.push(select(i, "secs", "Wait", String(step.ms / 1000), WAIT_SECONDS, (v) => change(i, { ...step, ms: Number(v) * 1000 })));
    if (step.do === "pad")
      out.push(
        select(i, "what", "Pad", step.boardId && step.padId ? `${step.boardId}/${step.padId}` : "", [["", "Choose…"], ...padChoices], (v) => {
          const [boardId, padId] = v.split("/");
          change(i, { do: "pad", boardId: boardId || null, padId: padId || null });
        }),
      );
    if (step.do === "scene") out.push(select(i, "what", "Scene", step.scene ? sceneKey(step.scene) : "", [["", "Choose…"], ...sceneChoices], (v) => change(i, { do: "scene", scene: sceneOf(v) })));
    return out;
  };

  return (
    <Dialog
      open
      wide
      title={title}
      description="Lyre does these in order. Each play step says how it comes in and what happens to Up next."
      onClose={onClose}
      footer={
        <>
          <Button icon="headphones" onClick={tryIt}>
            Try in headphones
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void done()}>
            Done
          </Button>
        </>
      }
    >
      <ol className="stp-list" aria-label="Steps">
        {steps.map((step, i) => {
          const ctl = controls(step, i);
          return (
            <li className="stp" key={i}>
              <div className="stp-1">
                <span className="num stp-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="grow stp-s">{sentence(step, names)}</span>
                <IconButton
                  size="s"
                  variant="ghost"
                  icon="chevup"
                  label="Move up"
                  disabled={i === 0}
                  onClick={() => {
                    setSteps((s) => moveStep(s, i, -1));
                    say(`Step moved to ${i}`);
                  }}
                />
                <IconButton
                  size="s"
                  variant="ghost"
                  icon="chevdown"
                  label="Move down"
                  disabled={i === steps.length - 1}
                  onClick={() => {
                    setSteps((s) => moveStep(s, i, 1));
                    say(`Step moved to ${i + 2}`);
                  }}
                />
                <IconButton
                  size="s"
                  variant="ghost"
                  icon="close"
                  label="Remove"
                  hint="Remove this step"
                  onClick={() => {
                    setSteps((s) => s.filter((_x, j) => j !== i));
                    say("Step removed");
                  }}
                />
              </div>
              {ctl.length > 0 && <div className="stp-ctl">{ctl}</div>}
            </li>
          );
        })}
      </ol>
      <div className="row-flex stp-tools">
        <MenuButton
          label="Add a step"
          size="s"
          icon="plus"
          items={NEW_STEPS.map(([label, make]) => ({
            label,
            onSelect: () => {
              const step = make();
              setSteps((s) => [...s, step]);
              say(`Step ${steps.length + 1} added: ${sentence(step, names)}`);
            },
          }))}
        >
          Add a step
        </MenuButton>
        <Button
          size="s"
          icon="restart"
          className="ghost"
          onClick={() => {
            setSteps(usual);
            setThen("stay");
            say("The usual steps are back");
          }}
        >
          Put back the usual
        </Button>
      </div>
      {owner.kind === "scene" && (
        <div className="field stp-then">
          <label htmlFor="stp-then">Then</label>
          <select className="input" id="stp-then" value={then} onChange={(e) => setThen(e.target.value as MovesOn["when"])}>
            {THEN_CHOICES.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        </div>
      )}
    </Dialog>
  );
}

/** PLY-8: the marks a scene that does something other than the usual carries (r7play.js L.sceneMarks). */
export function SceneMarks({ scene }: { scene: Pick<SceneInfo, "steps" | "movesOn"> }) {
  const moves = scene.movesOn.when !== "stay";
  if (!moves && !scene.steps) return null;
  return (
    <>
      {moves && (
        <span className="badge r7-mark" title={scene.movesOn.when === "musicEnds" ? "Starts the next scene when its music ends" : "Starts the next scene after 5 minutes"}>
          Moves on by itself
        </span>
      )}
      {scene.steps && <span className="badge r7-mark">Own start</span>}
    </>
  );
}
