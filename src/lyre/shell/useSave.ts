/**
 * UX-19 (round 6 part 5): the one way a screen saves. `save(what, write)` runs a LyreApi write and shows the outcome
 * in the Saved pop-up: "Saved: <what>" when it is saved; a failure card with Try again (which runs the same write
 * again) when the computer could not save it ("not-saved", a full drive); and the refusal's own words as a note for
 * any other refusal (the change is not allowed, nothing was saved). Not for a change that shows its own message with
 * an action (an Undo note, an export's "Saved … in Documents\Lyre"): one event, one message.
 */
import { useCallback } from "react";

import { isRefused, type Done, type WriteResult } from "../../common/lyre/api";
import { useAnnounce, type SavedOptions } from "./Announcer";

export type SaveWrite = <T>(what: string, write: () => Promise<WriteResult<T>>, options?: SavedOptions) => Promise<Done<T> | undefined>;

export function useSave(): SaveWrite {
  const { saved, saveFailed, toast } = useAnnounce();
  const save: SaveWrite = useCallback(
    async <T>(what: string, write: () => Promise<WriteResult<T>>, options?: SavedOptions): Promise<Done<T> | undefined> => {
      const result = await write();
      if (!isRefused(result)) {
        saved(what, options);
        return result;
      }
      if (result.refusal.code === "not-saved") saveFailed(what, () => void save(what, write, options));
      else toast(result.refusal.message);
      return undefined;
    },
    [saved, saveFailed, toast],
  );
  return save;
}
