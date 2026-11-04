import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ErrorCause } from "../../../common/errorCause";
import type { BotState } from "../../../common/outputs";
import { setOutputsState } from "../output/outputSlice";

/** UX finding 4: an error message on screen. */
export type ShownError = {
  id: number;
  message: string;
  cause?: ErrorCause;
  /**
   * The cause's problem has been seen in the outputs' state. The message
   * often arrives just before that state, so a bot that looks fine at that
   * moment has not been fixed yet: the message closes only after its problem
   * has been seen and then gone.
   */
  causeSeen: boolean;
};

export type ErrorsState = { list: ShownError[]; nextId: number };

/** More than this and the oldest message goes, so the sidebar is not filled with them. */
export const MAX_SHOWN_ERRORS = 3;

const initialState: ErrorsState = { list: [], nextId: 1 };

/**
 * The bot has something wrong that its error message could be about. A
 * notice (WP1 review 5: a moderator moved the bot out) counts until the bot
 * joins a channel again, which clears it.
 */
export function outputHasProblem(bot: BotState): boolean {
  return (
    bot.status === "error" ||
    Boolean(bot.error) ||
    Boolean(bot.notice) ||
    bot.voice.some((session) => session.status === "error")
  );
}

export const errorsSlice = createSlice({
  name: "errors",
  initialState,
  reducers: {
    errorShown: (state, action: PayloadAction<{ message: string; cause?: ErrorCause; causeSeen?: boolean }>) => {
      const { message, cause, causeSeen = false } = action.payload;
      const list = state.list.filter((error) => error.message !== message);
      list.unshift({ id: state.nextId, message, ...(cause ? { cause } : {}), causeSeen });
      state.list = list.slice(0, MAX_SHOWN_ERRORS);
      state.nextId += 1;
    },
    errorClosed: (state, action: PayloadAction<number>) => {
      state.list = state.list.filter((error) => error.id !== action.payload);
    },
    /** An address or file opened, so earlier "could not open" messages are out of date. */
    addressErrorsResolved: (state) => {
      state.list = state.list.filter((error) => error.cause?.kind !== "address");
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setOutputsState, (state, action) => {
      const bots = new Map(action.payload.bots.map((bot) => [bot.id, bot]));
      state.list = state.list.filter((error) => {
        if (error.cause?.kind !== "output") {
          return true;
        }
        const bot = bots.get(error.cause.id);
        if (!bot) {
          return false;
        }
        if (outputHasProblem(bot)) {
          error.causeSeen = true;
          return true;
        }
        return !error.causeSeen;
      });
    });
  },
});

export const { errorShown, errorClosed, addressErrorsResolved } = errorsSlice.actions;

export default errorsSlice.reducer;
