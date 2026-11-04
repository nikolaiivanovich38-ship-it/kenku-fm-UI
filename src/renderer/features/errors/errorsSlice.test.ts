import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import type { BotState, OutputsState } from "../../../common/outputs";
import outputReducer, { setOutputsState } from "../output/outputSlice";
import errorsReducer, { addressErrorsResolved, errorClosed, errorShown, outputHasProblem } from "./errorsSlice";

function bot(overrides: Partial<BotState> = {}): BotState {
  return {
    id: "bot-1",
    name: "Bot 1",
    hasToken: true,
    tokenRemembered: true,
    status: "ready",
    guilds: [],
    voice: [],
    muted: false,
    ...overrides,
  };
}

function outputs(...bots: BotState[]): OutputsState {
  return { encryption: true, local: { muted: false }, bots };
}

function setup() {
  const store = configureStore({ reducer: { errors: errorsReducer, output: outputReducer } });
  const messages = () => store.getState().errors.list.map((error) => error.message);
  return { store, messages };
}

const refused = bot({ status: "error", hasToken: false, error: "Discord didn't accept this token." });

describe("error messages (UX finding 4)", () => {
  it("shows the newest message first, once, and at most three", () => {
    const { store, messages } = setup();
    for (const message of ["one", "two", "one", "three", "four"]) {
      store.dispatch(errorShown({ message }));
    }
    expect(messages()).toEqual(["four", "three", "one"]);
  });

  it("closes a message when the user closes it", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "one" }));
    store.dispatch(errorClosed(store.getState().errors.list[0].id));
    expect(messages()).toEqual([]);
  });

  it("keeps a message without a cause until it is closed, whatever happens to the outputs", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "Unable to play track" }));
    store.dispatch(setOutputsState(outputs(refused)));
    store.dispatch(setOutputsState(outputs(bot())));
    expect(messages()).toEqual(["Unable to play track"]);
  });

  it("closes a bot's message once the bot's problem is fixed", () => {
    const { store, messages } = setup();
    // The message often arrives before the state that shows the problem.
    store.dispatch(errorShown({ message: "Discord didn't accept this token.", cause: { kind: "output", id: "bot-1" } }));
    store.dispatch(setOutputsState(outputs(refused)));
    expect(messages()).toHaveLength(1);
    store.dispatch(setOutputsState(outputs(bot({ status: "connecting" }))));
    expect(messages()).toEqual([]);
  });

  it("keeps the moderator message while the bot is out of its channel, and closes it once it joins one (WP1 review 5)", () => {
    const { store, messages } = setup();
    const message = "A moderator moved or disconnected the bot from “Tavern”, so it left.";
    store.dispatch(errorShown({ message, cause: { kind: "output", id: "bot-1" } }));
    store.dispatch(setOutputsState(outputs(bot({ notice: message }))));
    expect(messages()).toEqual([message]);
    store.dispatch(
      setOutputsState(
        outputs(bot({ voice: [{ guildId: "1", channelId: "2", channelName: "Tavern", status: "connected" }] })),
      ),
    );
    expect(messages()).toEqual([]);
  });

  it("does not close a bot's message before its problem has even been seen", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "cannot join", cause: { kind: "output", id: "bot-1" } }));
    store.dispatch(setOutputsState(outputs(bot())));
    expect(messages()).toEqual(["cannot join"]);
  });

  it("closes a bot's message when the problem was already showing and is then fixed", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "cannot join", cause: { kind: "output", id: "bot-1" }, causeSeen: true }));
    store.dispatch(setOutputsState(outputs(bot())));
    expect(messages()).toEqual([]);
  });

  it("closes a bot's message when the bot is removed", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "x", cause: { kind: "output", id: "bot-2" } }));
    store.dispatch(setOutputsState(outputs(bot())));
    expect(messages()).toEqual([]);
  });

  it("closes messages about an address once an address opens", () => {
    const { store, messages } = setup();
    store.dispatch(errorShown({ message: "Can't find this file.", cause: { kind: "address" } }));
    store.dispatch(errorShown({ message: "other" }));
    store.dispatch(addressErrorsResolved());
    expect(messages()).toEqual(["other"]);
  });

  it("counts a failed channel, a lost login and an error status as problems", () => {
    expect(outputHasProblem(bot())).toBe(false);
    expect(outputHasProblem(bot({ status: "error" }))).toBe(true);
    expect(outputHasProblem(bot({ status: "connecting", error: "Cannot reach Discord." }))).toBe(true);
    expect(
      outputHasProblem(bot({ voice: [{ guildId: "1", channelId: "2", channelName: "Tavern", status: "error", error: "x" }] })),
    ).toBe(true);
  });
});
