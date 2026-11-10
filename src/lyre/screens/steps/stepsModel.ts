/**
 * PLY-8 (design round 7, r7play.js): a scene's start and a pad as a list of steps, as the steps dialog edits them.
 * Each step reads as one sentence ("Fade the music to 30% over 2 s"). While editing, a new Play, Fire a pad or Start
 * a scene step may not have its choice yet (a draft); Done keeps only finished steps (CueStep, src/common/domain).
 */
import type { SoundRef } from "../../../common/domain";
import type { CueStep, MovesOn, StepHow, StepSceneAddress, StepUpNext } from "../../../common/domain/round7";
import { MOVES_ON_AFTER_MS } from "../../../common/domain/round7";

/** A step being edited: a play, pad or scene step may still wait for its choice (null). */
export type DraftStep =
  | Exclude<CueStep, { do: "play" } | { do: "pad" } | { do: "scene" }>
  | { do: "play"; what: SoundRef | null; how: StepHow; upNext: StepUpNext; fromMs: number | null }
  | { do: "pad"; boardId: string | null; padId: string | null }
  | { do: "scene"; scene: StepSceneAddress | null };

/** What the dialog needs to name things: a track or playlist, a board, a pad, a scene. */
export interface StepNames {
  sound: (ref: SoundRef) => string;
  board: (id: string) => string;
  /** "Drowned Abbey › Abbey bell" */
  pad: (boardId: string, padId: string) => string;
  scene: (address: StepSceneAddress) => string;
}

export const HOW_CHOICES: readonly [StepHow, string][] = [
  ["crossfade", "Crossfade (Settings)"],
  ["cut", "Cut"],
  ["trackEnds", "When the current track ends"],
  ["mixOut", "At the mix-out marker"],
  ["loopEnds", "After the current loop"],
];
export const UP_NEXT_CHOICES: readonly [StepUpNext, string][] = [
  ["replace", "Replace what plays"],
  ["playNext", "Play next"],
  ["addToQueue", "Add to queue"],
];
export const STOP_CHOICES: readonly [string, string][] = [
  ["music", "The music"],
  ["ambience", "The ambience"],
  ["all", "Everything"],
];
export const LEVEL_CHOICES = [0, 10, 20, 30, 50, 70, 100] as const;
export const FADE_SECONDS = [1, 2, 3, 5, 8] as const;
export const WAIT_SECONDS: readonly [number, string][] = [
  [1, "1 s"],
  [2, "2 s"],
  [5, "5 s"],
  [10, "10 s"],
  [30, "30 s"],
  [60, "1 min"],
];

/** Add a step: the menu's choices in the prototype's order, each with the step it adds. */
export const NEW_STEPS: readonly [string, () => DraftStep][] = [
  ["Play…", () => ({ do: "play", what: null, how: "crossfade", upNext: "replace", fromMs: null })],
  ["Stop…", () => ({ do: "stop", what: "music" })],
  ["Fade the music…", () => ({ do: "fade", level: 0.3, ms: 2000 })],
  ["Wait…", () => ({ do: "wait", ms: 5000 })],
  ["Fire a pad…", () => ({ do: "pad", boardId: null, padId: null })],
  ["Start a scene…", () => ({ do: "scene", scene: null })],
];

/** Then (a scene that moves on by itself): the choices and how each is kept. */
export const THEN_CHOICES: readonly [MovesOn["when"], string][] = [
  ["stay", "Stay on this scene until you press Next"],
  ["musicEnds", "Start the next scene when its music ends"],
  ["after", "Start the next scene after 5 minutes"],
];
export function movesOnOf(when: MovesOn["when"]): MovesOn {
  return when === "after" ? { when: "after", ms: MOVES_ON_AFTER_MS } : { when };
}

const secs = (ms: number) => Math.round(ms / 100) / 10;

/** The step in one sentence, as the list shows it. */
export function sentence(step: DraftStep, names: StepNames): string {
  switch (step.do) {
    case "music":
      return `Play the music: ${names.sound(step.what)}`;
    case "ambience":
      return `Play the ambience: ${names.sound(step.what)}`;
    case "board":
      return `Show the pads: ${names.board(step.boardId)}`;
    case "sound":
      return "Play its sound";
    case "play":
      return `Play ${step.what ? names.sound(step.what) : "…"}`;
    case "stop":
      return { music: "Stop the music", ambience: "Stop the ambience", all: "Stop everything" }[step.what];
    case "fade":
      return `Fade the music to ${Math.round(step.level * 100)}% over ${secs(step.ms)} s`;
    case "wait":
      return `Wait ${secs(step.ms)} s`;
    case "pad":
      return `Fire a pad: ${step.boardId && step.padId ? names.pad(step.boardId, step.padId) : "…"}`;
    case "scene":
      return `Start the scene: ${step.scene ? names.scene(step.scene) : "…"}`;
  }
}

/** Every step finished, as kept; or the number (from 1) of the first step still waiting for its choice. */
export function finished(steps: readonly DraftStep[]): { steps: CueStep[] } | { waiting: number } {
  const out: CueStep[] = [];
  for (const [i, step] of steps.entries()) {
    if (step.do === "play") {
      if (!step.what) return { waiting: i + 1 };
      out.push({ ...step, what: step.what });
    } else if (step.do === "pad") {
      if (!step.boardId || !step.padId) return { waiting: i + 1 };
      out.push({ do: "pad", boardId: step.boardId, padId: step.padId });
    } else if (step.do === "scene") {
      if (!step.scene) return { waiting: i + 1 };
      out.push({ do: "scene", scene: step.scene });
    } else out.push(step);
  }
  return { steps: out };
}

/** A sound's key in a select: "track:t13" or "playlist:p-abbey". */
export const soundKey = (ref: SoundRef): string => `${ref.kind}:${ref.id}`;
export function soundOf(key: string): SoundRef | null {
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  return (kind === "track" || kind === "playlist") && id ? { kind, id } : null;
}
export const sceneKey = (a: StepSceneAddress): string => `${a.campaignId}/${a.sessionId}/${a.sceneId}`;
export function sceneOf(key: string): StepSceneAddress | null {
  const [campaignId, sessionId, sceneId] = key.split("/");
  return campaignId && sessionId && sceneId ? { campaignId, sessionId, sceneId } : null;
}

/** Move a step by one place up (-1) or down (1); the list as it was when it cannot move. */
export function moveStep<T>(steps: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= steps.length) return [...steps];
  const out = [...steps];
  const [step] = out.splice(index, 1);
  out.splice(to, 0, step);
  return out;
}
