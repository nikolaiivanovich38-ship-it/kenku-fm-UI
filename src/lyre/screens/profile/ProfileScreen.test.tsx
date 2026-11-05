/**
 * The Audio profile screen (route `profile`), against the in-memory LyreApi seeded from the prototype and a fake
 * audio host. Opened on "Eerie dread, low cello and choir" (t13): it loops from 1:04 to 5:18 with a 2 s crossfade,
 * the file is 7:21 long, and the scene "The abbey ruins" has its own settings (End 3:10, moves on).
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../../../common/lyre/fake";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { Shell } from "../../shell/Shell";
import { expectNoAxeViolations } from "../../test/axe";
import { SCREENS } from "..";
import { ProfileScreen } from "./ProfileScreen";

const TITLE = /^Eerie dread, low cello and choir/;

beforeEach(() => {
  localStorage.clear();
});

async function open(path = "profile/t13", api = createFakeLyreApi()) {
  window.history.replaceState(null, "", `#/${path}`);
  const audio = new FakeLyreAudio();
  const user = userEvent.setup();
  render(
    <LyreApiProvider api={api}>
      <LyreAudioProvider audio={audio}>
        <Shell screens={{ ...SCREENS, profile: ProfileScreen }} />
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  await screen.findByRole("slider", { name: "End" });
  return { api, audio, user };
}

function go(path: string) {
  act(() => {
    window.location.hash = `#/${path}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

const slider = (name: string) => screen.getByRole("slider", { name });
const value = (name: string) => Number(slider(name).getAttribute("aria-valuenow"));
const region = (name: string) => screen.getByRole("region", { name });
const atEnd = () => within(region("At the end"));
const fades = () => within(region("Fades"));

async function savedProfile(api: ReturnType<typeof createFakeLyreApi>, id = "t13") {
  return (await api.library.listTracks()).find((t) => t.id === id)?.profile;
}

describe("the Audio profile screen", () => {
  it("names the track, where it comes from and how long it is", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TITLE);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Library" })).toHaveAttribute("href", "#/library");
    expect(screen.getByText("06 Bridge of Death.flac")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to track/ })).toHaveAttribute("href", "#/library/t13");
    expect(screen.getAllByText("Length")[0].parentElement).toHaveTextContent("Length 7:21");
  });

  it("is part of the Library: the rail's Library section is lit, also for a place", async () => {
    await open("profile/t13/sc:crown:s14:sc3");
    const rail = screen.getByRole("navigation", { name: "Lyre" });
    expect(within(rail).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  it("says so when the track is not in the library", async () => {
    window.history.replaceState(null, "", "#/profile/nope");
    render(
      <LyreApiProvider api={createFakeLyreApi()}>
        <LyreAudioProvider audio={new FakeLyreAudio()}>
          <Shell screens={{ ...SCREENS, profile: ProfileScreen }} />
        </LyreAudioProvider>
      </LyreApiProvider>,
    );
    expect(await screen.findByText(/That track is not in the library/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the Library" })).toHaveAttribute("href", "#/library");
  });

  it("has no accessibility failures", async () => {
    await open();
    await expectNoAxeViolations(document.body);
  });
});

describe("the handles", () => {
  it("are sliders for the playhead, Start, End, Loop start and both fade lengths", async () => {
    await open();
    expect(value("Playhead")).toBe(0);
    expect(value("Start")).toBe(0);
    expect(value("End")).toBe(318);
    expect(value("Loop start")).toBe(64);
    expect(slider("End")).toHaveAttribute("aria-valuetext", "5:18");
    expect(slider("Fade out length")).toHaveAttribute("aria-valuetext", "0 s");
  });

  it("move 1 s with the arrow keys and 10 s with Shift, announce it, and keep it", async () => {
    const { api, user } = await open();
    slider("End").focus();
    await user.keyboard("{ArrowLeft}");
    expect(value("End")).toBe(317);
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(value("End")).toBe(307);
    expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("5:07");
    await waitFor(() => expect(document.getElementById("lyre-live")).toHaveTextContent("End 5:07"));
    await waitFor(async () => expect((await savedProfile(api))?.endMs).toBe(307000));
  });

  it("change a fade length by a second per arrow key", async () => {
    const { user } = await open();
    slider("Fade out length").focus();
    for (let i = 0; i < 4; i++) await user.keyboard("{ArrowRight}");
    expect(fades().getByRole("textbox", { name: "fade out in seconds" })).toHaveValue("4");
  });
});

describe("what happens at the end", () => {
  it("offers loop, next track and stop, with the loop chosen for t13", async () => {
    await open();
    const group = atEnd().getByRole("group", { name: "At the end" });
    expect(within(group).getByRole("radio", { name: /^Loop back to loop start/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /^Move to the next track/ })).not.toBeChecked();
    expect(within(group).getByRole("radio", { name: /^Stop/ })).not.toBeChecked();
    expect(region("At the end")).toHaveTextContent("Loops from 1:04");
  });

  it("moving on drops the loop start and names the next track", async () => {
    const { api, user } = await open();
    await user.click(atEnd().getByRole("radio", { name: /^Move to the next track/ }));
    expect(region("At the end")).toHaveTextContent("Moves on at 5:18");
    expect(screen.queryByRole("slider", { name: "Loop start" })).toBeNull();
    expect(region("At the end")).toHaveTextContent("Next track");
    await waitFor(async () => expect((await savedProfile(api))?.after).toBe("next"));
  });

  it("takes typed times, and says what is wrong with one it cannot use", async () => {
    const { user } = await open();
    const end = atEnd().getByRole("textbox", { name: "End" });
    await user.clear(end);
    await user.type(end, "4:30{Enter}");
    expect(value("End")).toBe(270);
    // Typing on the way to 4:30 never moved the loop start: each keystroke starts from where End was.
    expect(value("Loop start")).toBe(64);
    await user.clear(end);
    await user.type(end, "4:75");
    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(region("At the end")).toHaveTextContent("Type minutes and seconds, like 5:18");
    await user.clear(end);
    await user.type(end, "9:00");
    expect(region("At the end")).toHaveTextContent("Between 0:01 and 7:21");
    await user.keyboard("{Escape}");
    expect(end).toHaveValue("4:30");
  });

  it("Start at playhead takes the time from the playhead", async () => {
    const { user } = await open();
    slider("Playhead").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(value("Playhead")).toBe(2);
    await user.click(atEnd().getByRole("button", { name: "Start at playhead" }));
    expect(value("Start")).toBe(2);
  });

  it("Reset to whole track takes Start and End back to the ends of the file", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Reset to whole track" }));
    expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("7:21");
    expect(atEnd().getByRole("textbox", { name: "Start" })).toHaveValue("0:00");
    expect(document.getElementById("lyre-toast")).toHaveTextContent("Back to the whole track: 0:00 to 7:21, no fades");
  });
});

describe("fades", () => {
  it("have a length with shorter and longer buttons and an intensity from gentle to sharp", async () => {
    const { user } = await open();
    expect(region("Fades")).toHaveTextContent("No fades");
    await user.click(fades().getByRole("button", { name: "Longer fade in" }));
    await user.click(fades().getByRole("button", { name: "Longer fade in" }));
    expect(fades().getByRole("textbox", { name: "fade in in seconds" })).toHaveValue("2");
    await user.click(fades().getByRole("button", { name: "Shorter fade in" }));
    expect(fades().getByRole("textbox", { name: "fade in in seconds" })).toHaveValue("1");
    expect(region("Fades")).toHaveTextContent("In 1 s · out 0 s");
    const intensity = fades().getAllByRole("slider", { name: "Intensity" });
    expect(intensity).toHaveLength(2);
    expect(intensity[0]).toHaveAttribute("aria-valuetext", "Even, 50 of 100");
  });

  it("a looping track has a loop crossfade", async () => {
    await open();
    expect(region("Fades")).toHaveTextContent(/Crossfade the loop\s*smooths the jump back to 1:04/);
    expect(fades().getByRole("textbox", { name: "loop crossfade in seconds" })).toHaveValue("2");
  });
});

describe("listening while you set it", () => {
  it("Space previews from the playhead in your headphones only, and Space pauses", async () => {
    const { audio, user } = await open();
    const transport = within(region("Waveform and listening")).getByRole("group", { name: "Preview: only you hear it" });
    await user.click(screen.getByRole("heading", { level: 1 }));
    await user.keyboard(" ");
    expect(within(transport).getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
    expect(region("Waveform and listening")).toHaveTextContent(/Previewing/);
    expect(audio.calls.find(([m]) => m === "previewTrack")?.slice(0, 2)).toEqual(["previewTrack", "t13"]);
    expect(audio.calls.some(([m]) => m === "playTrack")).toBe(false);
    await user.keyboard(" ");
    expect(within(transport).getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
    expect(audio.calls[audio.calls.length - 1]).toEqual(["stopPreview"]);
  });

  it("shows the position, the time to End, the loops and the volume after fades", async () => {
    await open();
    const wave = region("Waveform and listening");
    expect(wave).toHaveTextContent(/Position\s*0:00\.0/);
    expect(wave).toHaveTextContent(/Time to End\s*5:18\.0/);
    expect(wave).toHaveTextContent(/Looped\s*not yet/);
    expect(within(wave).getByRole("meter", { name: "Volume after fades" })).toBeInTheDocument();
  });

  it("Play on air sends the track to the first room with these settings", async () => {
    const { audio, user } = await open();
    await user.click(within(region("Waveform and listening")).getByRole("button", { name: "Play on air" }));
    expect(audio.calls).toContainEqual(["playTrack", "t13", { fadeMs: 3000 }]);
    expect(document.getElementById("lyre-toast")).toHaveTextContent("On air: Eerie dread");
  });

  it("in a scene, Play on air plays it as that scene's step, so the scene's settings apply", async () => {
    const { audio, user } = await open("profile/t13/sc:crown:s14:sc3");
    await user.click(screen.getByRole("button", { name: "Play on air" }));
    expect(audio.calls).toContainEqual(["playTrack", "t13", { fadeMs: 3000, from: { scene: { campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, at: 0 } }]);
  });

  it("leaving the screen stops its preview", async () => {
    const { audio, user } = await open();
    await user.click(screen.getByRole("button", { name: "Play the last 10 s before End" }));
    audio.setNowPlaying({ preview: { key: "t13", label: "Eerie dread" } });
    go("library");
    expect(audio.calls[audio.calls.length - 1]).toEqual(["stopPreview"]);
  });
});

describe("the preview's sound follows the profile shown", () => {
  const position = (audio: FakeLyreAudio, seconds: number, key = "t13") => act(() => void audio.emit("preview-position", { key, positionMs: seconds * 1000 }));
  const previews = (audio: FakeLyreAudio) => audio.calls.filter(([m]) => m === "previewTrack");

  it("Play previews from the playhead with the profile shown, and says it itself", async () => {
    const { audio, user } = await open();
    slider("Playhead").focus();
    await user.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    await user.click(within(region("Waveform and listening")).getByRole("button", { name: "Play" }));
    const [, id, options] = previews(audio)[0] as [string, string, { startAtMs: number; profile: { startMs: number; endMs: number; after: string; loopStartMs: number }; quiet: boolean }];
    expect(id).toBe("t13");
    expect(options.startAtMs).toBe(20_000);
    expect(options.profile).toMatchObject({ startMs: 0, endMs: 318_000, after: "loop", loopStartMs: 64_000 });
    expect(options.quiet).toBe(true);
  });

  it("Play the last 10 s before End plays from there", async () => {
    const { audio, user } = await open();
    await user.click(screen.getByRole("button", { name: "Play the last 10 s before End" }));
    expect((previews(audio)[0][2] as { startAtMs: number }).startAtMs).toBe(308_000);
  });

  it("the playhead, the loop count and the meter follow where the preview really is", async () => {
    const { audio, user } = await open();
    await user.click(screen.getByRole("button", { name: "Play the last 10 s before End" }));
    const wave = region("Waveform and listening");
    position(audio, 312.5);
    expect(wave).toHaveTextContent(/Position\s*5:12\.5/);
    expect(value("Playhead")).toBe(312);
    position(audio, 317.9);
    expect(wave).toHaveTextContent(/Looped\s*not yet/);
    // Back to Loop start: the preview looped.
    position(audio, 64.4);
    expect(wave).toHaveTextContent(/Position\s*1:04\.4/);
    expect(wave).toHaveTextContent(/Looped\s*once/);
    await waitFor(() => expect(document.getElementById("lyre-live")).toHaveTextContent("Crossfaded over 2 s back to 1:04"));
    expect(Number(within(wave).getByRole("meter", { name: "Volume after fades" }).getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    // Another preview's position (a Preview button elsewhere) is not this one's.
    position(audio, 10, "t44");
    expect(wave).toHaveTextContent(/Position\s*1:04\.4/);
  });

  it("moving on, it previews the next track from its Start with its settings there, then stops", async () => {
    const { audio, user } = await open("profile/t13/sc:crown:s14:sc3");
    await user.click(screen.getByRole("button", { name: "Play the last 10 s before End" }));
    const first = previews(audio)[0] as [string, string, { startAtMs: number; profile: { endMs: number; after: string } }];
    expect(first[2].startAtMs).toBe(180_000);
    expect(first[2].profile).toMatchObject({ endMs: 190_000, after: "next" });
    act(() => audio.setNowPlaying({ preview: { key: "t13", label: "Eerie dread" } }));
    position(audio, 189.9);
    // The track ends at End; the screen hands over to the next track.
    act(() => audio.setNowPlaying({ preview: null }));
    await waitFor(() => expect(previews(audio)).toHaveLength(2));
    const next = previews(audio)[1] as [string, string, { quiet: boolean }];
    expect(next[1]).not.toBe("t13");
    expect(next[2].quiet).toBe(true);
    await waitFor(() => expect(document.getElementById("lyre-live")).toHaveTextContent(/Moved on to the next track/));
  });
});

describe("a preview that cannot play (review w3-polish 1)", () => {
  it("refused, the clock does not start and nothing says it plays", async () => {
    const { audio, user } = await open();
    audio.answer = { ok: false, message: "Unable to preview: Eerie dread" };
    const wave = region("Waveform and listening");
    await user.click(within(wave).getByRole("button", { name: "Play" }));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(within(wave).getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
    expect(value("Playhead")).toBe(0);
    expect(document.getElementById("lyre-live")).not.toHaveTextContent("Preview from");
  });

  it("failing while it loads, the clock stops where it is, says why, and never claims End", async () => {
    const { audio, user } = await open();
    const wave = region("Waveform and listening");
    await user.click(screen.getByRole("button", { name: "Play the last 10 s before End" }));
    act(() => audio.setNowPlaying({ preview: { key: "t13", label: "Eerie dread" } }));
    act(() => {
      audio.emit("preview-failed", { key: "t13", message: "Could not play the preview of Eerie dread, low cello and choir." });
      audio.setNowPlaying({ preview: null });
    });
    expect(within(wave).getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
    expect(document.getElementById("lyre-toast")).toHaveTextContent("Could not play the preview of Eerie dread");
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(document.getElementById("lyre-live")).not.toHaveTextContent(/Stopped at End|Moved on/);
    expect(wave).not.toHaveTextContent(/Stopped at End/);
  });
});

describe("the file's loudness (peaks from the library)", () => {
  const meterBar = () => region("Waveform and listening").querySelector<HTMLElement>(".ap-meter-bar")!;

  it("while unknown, the meter shows the even band", async () => {
    const api = createFakeLyreApi();
    vi.spyOn(api.library, "peaksOf").mockResolvedValue(null);
    const { user } = await open("profile/t13", api);
    await user.click(within(region("Waveform and listening")).getByRole("button", { name: "Play" }));
    expect(meterBar().style.width).toBe("75%");
  });

  it("once worked out, the meter follows the file's own loudness at the playhead", async () => {
    const api = createFakeLyreApi();
    const peaks = vi.spyOn(api.library, "peaksOf").mockResolvedValue(new Array(1000).fill(0));
    const { user } = await open("profile/t13", api);
    await waitFor(() => expect(peaks).toHaveBeenCalledWith("t13"));
    await user.click(within(region("Waveform and listening")).getByRole("button", { name: "Play" }));
    await waitFor(() => expect(meterBar().style.width).toBe("35%"));
  });
});

describe("markers and keys", () => {
  it("M adds a marker at the playhead, which can be named, jumped to and removed", async () => {
    const { user } = await open();
    slider("Playhead").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}m");
    const markers = within(region("Markers"));
    expect(region("Markers")).toHaveTextContent("4 markers");
    const label = markers.getByRole("textbox", { name: "Marker label at 0:02" });
    await user.clear(label);
    await user.type(label, "First bell");
    await user.click(markers.getByRole("button", { name: "Go to Low swell" }));
    expect(value("Playhead")).toBe(190);
    await user.click(markers.getByRole("button", { name: "Remove marker First bell" }));
    expect(region("Markers")).toHaveTextContent("3 markers");
    expect(markers.getByRole("button", { name: "Add marker at playhead" })).toHaveFocus();
  });

  it("with single-key shortcuts off, O does nothing, and the choice is remembered", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("switch", { name: "Single-key shortcuts" }));
    slider("Playhead").focus();
    await user.keyboard("{ArrowRight}o");
    expect(value("End")).toBe(318);
    expect(localStorage.getItem("lyre-profile-keys1")).toBe("off");
  });

  it("with them on, O sets End at the playhead", async () => {
    const { user } = await open();
    slider("Playhead").focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}o");
    expect(value("End")).toBe(10);
  });
});

describe("different settings for different places", () => {
  it("lists every place that uses the track, and which have their own settings", async () => {
    await open();
    const options = Array.from((screen.getByRole("combobox", { name: "Settings for" }) as HTMLSelectElement).options).map((o) => o.label);
    expect(options[0]).toBe("This track everywhere (its own)");
    expect(options).toEqual(
      expect.arrayContaining(["Playlist: Abbey: eerie, low energy · uses the track's", "Scene: The abbey ruins (The Sunken Crown, session 14) · own settings"]),
    );
  });

  it("a scene with its own settings shows them, with Back to the track's settings", async () => {
    await open("profile/t13/sc:crown:s14:sc3");
    expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("3:10");
    expect(screen.getByText("Editing own settings for the scene The abbey ruins")).toBeInTheDocument();
  });

  it("choosing a place opens it, keeps the choice focused, and shows the track's settings read-only", async () => {
    const { user } = await open();
    await user.selectOptions(screen.getByRole("combobox", { name: "Settings for" }), "Playlist: Gothic dread · uses the track's");
    await waitFor(() => expect(window.location.hash).toBe("#/profile/t13/pl:p-gothic"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Settings for" })).toHaveFocus());
    expect(atEnd().getByRole("textbox", { name: "End" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Uses the track's settings (read-only until you give it its own)");
  });

  it("giving a place its own settings copies them, and a change there leaves the track's own alone", async () => {
    const { api, user } = await open("profile/t13/pl:p-gothic");
    await user.click(screen.getByRole("button", { name: "Give this place its own settings" }));
    const end = atEnd().getByRole("textbox", { name: "End" });
    await waitFor(() => expect(end).toBeEnabled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Back to the track's settings" })).toHaveFocus());
    await user.clear(end);
    await user.type(end, "4:30{Enter}");
    await waitFor(async () => expect((await api.profiles.overrides())["pl:p-gothic"]?.t13?.endMs).toBe(270000));
    expect((await savedProfile(api))?.endMs).toBe(318000);
  });

  it("Back to the track's settings removes the place's own, with an Undo", async () => {
    const { api, user } = await open("profile/t13/sc:crown:s14:sc3");
    await user.click(screen.getByRole("button", { name: "Back to the track's settings" }));
    await waitFor(() => expect(atEnd().getByRole("textbox", { name: "End" })).toBeDisabled());
    expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("5:18");
    expect((await api.profiles.overrides())["sc:crown:s14:sc3"]).toBeUndefined();
    await user.click(screen.getByRole("button", { name: /^Undo/ }));
    await waitFor(() => expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("3:10"));
    expect(atEnd().getByRole("textbox", { name: "End" })).toBeEnabled();
  });

  it("dragging or typing in a read-only place explains how to change it", async () => {
    const { user } = await open("profile/t13/pl:p-gothic");
    slider("End").focus();
    await user.keyboard("{ArrowLeft}");
    expect(value("End")).toBe(318);
    expect(document.getElementById("lyre-toast")).toHaveTextContent("These are the track's settings. Give this place its own settings to change them here.");
  });
});

describe("keeping the changes", () => {
  it("a run of key presses is kept as one change, so Undo is not filled with single seconds", async () => {
    const { api, user } = await open();
    const set = vi.spyOn(api.profiles, "set");
    slider("End").focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][2]).toMatchObject({ endMs: 315000, loopStartMs: 64000 });
  });

  it("a change the library refuses is shown in its words and taken back", async () => {
    const { api, user } = await open();
    vi.spyOn(api.profiles, "set").mockResolvedValue({ ok: false, refusal: { code: "invalid", message: "End must come after Start." } });
    await user.click(screen.getByRole("button", { name: "Reset to whole track" }));
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent("End must come after Start."));
    expect(atEnd().getByRole("textbox", { name: "End" })).toHaveValue("5:18");
  });
});
