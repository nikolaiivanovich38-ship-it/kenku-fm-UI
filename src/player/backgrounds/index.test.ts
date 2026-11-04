import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../assets/blank.png", () => ({ default: "blank.png" }));

type PlayerApi = Window["player"];

/** Load the module afresh with `getBackgrounds` answering as given. */
async function loadWith(getBackgrounds: (() => unknown) | undefined) {
  vi.resetModules();
  (window as { player?: Partial<PlayerApi> }).player =
    getBackgrounds === undefined ? undefined : { getBackgrounds: getBackgrounds as PlayerApi["getBackgrounds"] };
  return import("./index");
}

afterEach(() => {
  delete (window as { player?: unknown }).player;
});

describe("player backgrounds", () => {
  it("come from the main process's answer, asked once when the player loads", async () => {
    const getBackgrounds = vi.fn(() => ({
      autumn: "file:///C:/Users/nik/AppData/Roaming/cue-desk/backgrounds/autumn.jpg",
      tavern: "file:///C:/Users/nik/AppData/Roaming/cue-desk/backgrounds/tavern.jpg",
    }));
    const { backgrounds, isBackground, getRandomBackground } = await loadWith(getBackgrounds);
    expect(backgrounds).toEqual({ ...getBackgrounds.mock.results[0].value, blank: "blank.png" });
    expect(getBackgrounds).toHaveBeenCalledTimes(1);
    expect(isBackground("tavern")).toBe(true);
    // 0.1.0 saved "blank" on new playlists; it must keep working (0.1.1 review).
    expect(isBackground("blank")).toBe(true);
    expect(isBackground("https://example.com/x.jpg")).toBe(false);
    for (let i = 0; i < 50; i++) {
      expect(["autumn", "tavern"]).toContain(getRandomBackground());
    }
  });

  it("fall back to the blank picture when there are none", async () => {
    const { backgrounds, isBackground, getRandomBackground } = await loadWith(() => ({}));
    expect(backgrounds).toEqual({ blank: "blank.png" });
    expect(isBackground("tavern")).toBe(false);
    expect(getRandomBackground()).toBe("blank");
  });

  it("ignore odd answers and fall back to blank", async () => {
    for (const answer of [undefined, null, "", 42, ["x"], { tavern: 1 }, { tavern: "" }]) {
      const { backgrounds } = await loadWith(() => answer);
      expect(backgrounds, JSON.stringify(answer)).toEqual({ blank: "blank.png" });
    }
    const { backgrounds } = await loadWith(() => ({ ok: "file:///ok.jpg", bad: 3 }));
    expect(backgrounds).toEqual({ ok: "file:///ok.jpg", blank: "blank.png" });
  });

  it("still load when the bridge is missing or fails", async () => {
    expect((await loadWith(undefined)).backgrounds).toEqual({ blank: "blank.png" });
    const failing = await loadWith(() => {
      throw new Error("no main process");
    });
    expect(failing.backgrounds).toEqual({ blank: "blank.png" });
  });
});
