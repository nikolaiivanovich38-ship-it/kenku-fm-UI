/** Settings' words and rules, from design/prototype/src/views/settings.js and r7shell.js. */
import { describe, expect, it } from "vitest";

import { PROTOTYPE_OUTPUTS } from "../../outputs/testing/fakeOutputs";
import {
  ADD_BOT_STEPS,
  CROSSFADE_CHOICES,
  addedWords,
  crossfadeSaved,
  keyPressed,
  loginTone,
  loginWords,
  maskedToken,
  remoteListen,
  serverNames,
  shortcutRows,
} from "./settingsModel";

const [table] = PROTOTYPE_OUTPUTS.bots;

describe("Settings › Discord bots (OUT-8)", () => {
  it("words each bot's login as the prototype does", () => {
    expect(loginWords({ ...table, login: "ready" })).toBe("Connected");
    expect(loginWords({ ...table, login: "connecting" })).toBe("Connecting…");
    expect(loginWords({ ...table, login: "offline" })).toBe("Not connected");
    expect(loginWords({ ...table, login: "error" })).toBe("Could not connect");
    expect([loginTone({ ...table, login: "ready" }), loginTone({ ...table, login: "error" }), loginTone({ ...table, login: "offline" })]).toEqual(["on", "warn", "idle"]);
  });

  it("names the servers a bot is in, and shows only a token's last four characters", () => {
    expect(serverNames(PROTOTYPE_OUTPUTS, table)).toEqual(["The Gull and Lantern", "Night court"]);
    expect(maskedToken(table)).toBe("••••••••Kq7w");
    expect(maskedToken({ ...table, tokenEnd: null })).toBeNull();
  });

  it("walks through Discord in its order: create it, invite it, connect it", () => {
    expect(ADD_BOT_STEPS).toEqual(["Create it", "Invite it", "Connect it"]);
  });

  it("says after Connect whether the new bot is in a server yet", () => {
    expect(addedWords(PROTOTYPE_OUTPUTS, { ...table, name: "Lyre Third", serverIds: ["1001"] })).toEqual({ connected: "Lyre Third is connected.", where: "In The Gull and Lantern.", inNoServer: false });
    expect(addedWords(PROTOTYPE_OUTPUTS, { ...table, name: "Lyre Third", serverIds: [] })).toEqual({ connected: "Lyre Third is connected.", where: "It is in no server yet.", inNoServer: true });
  });
});

describe("Settings › Sound to Discord: the crossfade (PLY-8)", () => {
  it("offers Cut and the prototype's crossfades, and words a change for the Saved pop-up", () => {
    expect(CROSSFADE_CHOICES.map((c) => [c.seconds, c.label])).toEqual([["0", "Cut"], ["1", "Crossfade 1 s"], ["2", "Crossfade 2 s"], ["3", "Crossfade 3 s"], ["5", "Crossfade 5 s"], ["8", "Crossfade 8 s"]]);
    expect(crossfadeSaved(5000)).toBe("crossfade between tracks 5 s");
    expect(crossfadeSaved(0)).toBe("cut between tracks");
  });
});

describe("Settings › Remote control: where it listens (SEC-4)", () => {
  it("is this computer only at 127.0.0.1, else the home network", () => {
    expect(remoteListen({ address: "127.0.0.1" })).toBe("local");
    expect(remoteListen({ address: "localhost" })).toBe("local");
    expect(remoteListen({ address: "192.168.1.20" })).toBe("home");
  });
});

describe("Settings › Keyboard shortcuts (UX-12)", () => {
  it("lists every action with its key and where it works, a changed key in its place", () => {
    const rows = shortcutRows({ palette: "Ctrl+J" });
    expect(rows[0]).toEqual({ id: "palette", name: "Find and play", key: "Ctrl+J", where: "Everywhere" });
    expect(rows.map((r) => r.name)).toEqual(["Find and play", "Next scene", "Fade all", "Undo", "Find a track or playlist", "Next box", "Back", "Help"]);
    expect(rows[1].key).toBe("Space");
  });

  it("a pressed key: Esc keeps the old one, a modifier alone waits, a key in use is refused naming its action", () => {
    const press = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
    expect(keyPressed({}, "palette", press("Escape"))).toEqual({ kind: "keep", message: "Kept Ctrl+K for Find and play" });
    expect(keyPressed({}, "palette", press("Control", { ctrlKey: true }))).toEqual({ kind: "wait" });
    expect(keyPressed({}, "palette", press("Escape", { shiftKey: true }))).toEqual({ kind: "refused", message: "Shift+Esc is already Fade all. Press another key, or Esc to keep Ctrl+K" });
    expect(keyPressed({}, "palette", press("j", { ctrlKey: true }))).toEqual({ kind: "set", key: "Ctrl+J" });
    expect(keyPressed({}, "nextScene", press("n"))).toEqual({ kind: "set", key: "N" });
    // Its own key again is fine (nothing changes).
    expect(keyPressed({}, "palette", press("k", { ctrlKey: true }))).toEqual({ kind: "set", key: "Ctrl+K" });
  });
});
