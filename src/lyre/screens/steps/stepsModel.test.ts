import { describe, expect, it } from "vitest";
import { finished, movesOnOf, moveStep, NEW_STEPS, sceneKey, sceneOf, sentence, soundKey, soundOf, type DraftStep, type StepNames } from "./stepsModel";

const names: StepNames = {
  sound: (ref) => (ref.kind === "playlist" ? "Eerie dread" : "Bridge of Death"),
  board: () => "Drowned Abbey",
  pad: () => "Drowned Abbey › Abbey bell",
  scene: () => "The abbey ruins",
};

describe("a scene's or a pad's steps (r7play.js)", () => {
  it("each step reads as one sentence", () => {
    const steps: DraftStep[] = [
      { do: "music", what: { kind: "playlist", id: "p" }, how: "crossfade", upNext: "replace", fromMs: null },
      { do: "ambience", what: { kind: "track", id: "t" } },
      { do: "board", boardId: "abbey" },
      { do: "sound" },
      { do: "fade", level: 0.3, ms: 2000 },
      { do: "wait", ms: 5000 },
      { do: "pad", boardId: "abbey", padId: "bell" },
      { do: "pad", boardId: null, padId: null },
      { do: "stop", what: "all" },
      { do: "scene", scene: { campaignId: "c", sessionId: "s", sceneId: "x" } },
    ];
    expect(steps.map((s) => sentence(s, names))).toEqual([
      "Play the music: Eerie dread",
      "Play the ambience: Bridge of Death",
      "Show the pads: Drowned Abbey",
      "Play its sound",
      "Fade the music to 30% over 2 s",
      "Wait 5 s",
      "Fire a pad: Drowned Abbey › Abbey bell",
      "Fire a pad: …",
      "Stop everything",
      "Start the scene: The abbey ruins",
    ]);
  });

  it("Add a step offers the prototype's six, in order", () => {
    expect(NEW_STEPS.map(([label]) => label)).toEqual(["Play…", "Stop…", "Fade the music…", "Wait…", "Fire a pad…", "Start a scene…"]);
    expect(sentence(NEW_STEPS[2][1](), names)).toBe("Fade the music to 30% over 2 s");
  });

  it("Done keeps finished steps, and names the first that still waits for its choice", () => {
    const pad: DraftStep = { do: "pad", boardId: "abbey", padId: "bell" };
    expect(finished([{ do: "sound" }, pad])).toEqual({ steps: [{ do: "sound" }, pad] });
    expect(finished([{ do: "sound" }, NEW_STEPS[0][1]()])).toEqual({ waiting: 2 });
  });

  it("moves a step by one, and keys round-trip", () => {
    expect(moveStep(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveStep(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(soundOf(soundKey({ kind: "playlist", id: "p-abbey" }))).toEqual({ kind: "playlist", id: "p-abbey" });
    expect(sceneOf(sceneKey({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" }))).toEqual({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" });
    expect(movesOnOf("after")).toEqual({ when: "after", ms: 300000 });
  });
});
