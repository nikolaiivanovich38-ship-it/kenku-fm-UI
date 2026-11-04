/**
 * PERF-6 (review 7): while a slider is dragged, the player holds back saving
 * for up to 500 ms. When the main window closes, Electron destroys the player
 * view without running its page-hide handlers, so a change held back at that
 * moment would be lost. The first quit (or the first close of the main
 * window) is therefore held until the player has saved, or a time limit has
 * passed (PlayerManager.saveBeforeClose), and then repeated.
 *
 * A quit is held at "before-quit", before any window is touched: holding a
 * window's "close" in the middle of a quit cancels the quit, and Electron
 * then does not close that window again when the quit is repeated.
 *
 * No Electron import, so it can be tested on its own.
 */
type Holdable = { preventDefault(): void };

export type SaveBeforeClose = {
  /**
   * Call first in the app's "before-quit" handler. True: the quit was held
   * and will be repeated after saving. False: go ahead.
   */
  holdQuit(event: Holdable): boolean;
  /**
   * Call first in the main window's "close" handler. True: the close was held
   * and will be repeated after saving, so the handler stops there. False: go
   * ahead and close.
   */
  holdClose(event: Holdable): boolean;
};

export function holdCloseUntilSaved(options: {
  /** Resolves once the player has saved (or gave up waiting). */
  save: () => Promise<void>;
  /** Closes the main window again. */
  close: () => void;
  /** Quits the app again. */
  quit: () => void;
}): SaveBeforeClose {
  let state: "open" | "saving" | "saved" = "open";
  let quitAfterSaving = false;

  const hold = (event: Holdable) => {
    event.preventDefault();
    if (state === "open") {
      state = "saving";
      options
        .save()
        .catch((): void => undefined)
        .then(() => {
          state = "saved";
          // Not from inside the player's PLAYER_SAVED message: quitting
          // destroys the player view, and destroying a page while its own
          // message is being handled left the app hanging.
          setTimeout(() => (quitAfterSaving ? options.quit() : options.close()), 0);
        });
    }
  };

  return {
    holdQuit(event) {
      if (state === "saved") {
        return false;
      }
      quitAfterSaving = true;
      hold(event);
      return true;
    },
    holdClose(event) {
      if (state === "saved") {
        return false;
      }
      hold(event);
      return true;
    },
  };
}
