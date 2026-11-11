/**
 * What both pad board screens share: writes that show refusals in plain words, sound through the audio host, a
 * typed field that saves as you type, focus that waits for the screen to catch up, and moving to another screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isRefused, type WriteResult } from "../../../common/lyre/api";
import { useLyreAudio, useNowPlaying } from "../../audio/LyreAudioProvider";
import { padIsOn } from "../../audio/lyreAudio";
import { useAnnounce } from "../../shell/Announcer";
import { SAVE_AFTER_MS } from "../../kit/SavedField";

/** Go to another screen ("boards", "board/combat"). */
export function go(path: string): void {
  window.location.hash = `#/${path}`;
}

/**
 * Runs a write and answers its value, or null when it was refused (the refusal's words are toasted) or failed (a
 * fault, such as the library restarting, said in plain words).
 */
export function useWrite() {
  const { toast } = useAnnounce();
  return useCallback(
    async <T>(write: Promise<WriteResult<T>>): Promise<T | null> => {
      try {
        const result = await write;
        if (isRefused(result)) {
          toast(result.refusal.message);
          return null;
        }
        return result.value;
      } catch (error) {
        toast(`That did not work: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    [toast],
  );
}

/**
 * Pads and previews through the audio host (useLyreAudio). Its announcements and failures ("That pad has no
 * sound.") are said by the shell (shell/SoundMessages.tsx).
 */
export function useBoardSound() {
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const previewKey = now.preview?.key ?? null;
  return {
    audio,
    /** True while this pad (or "pad:<board>/<pad>" key) plays in the headphones. */
    previewing: (boardId: string, padId: string) => previewKey === `pad:${boardId}/${padId}`,
    /** True while this pad sounds on air in any room. */
    onAir: (boardId: string, padId: string) => padIsOn(now, boardId, padId),
    previewPad: (boardId: string, padId: string) => audio.previewPad(boardId, padId),
    previewTrack: (trackId: string) => audio.previewTrack(trackId),
    previewKey,
  };
}

export type BoardSound = ReturnType<typeof useBoardSound>;

/**
 * A focus move that waits until the screen shows what it is for: the element marked data-k="<k>" (and, when a pad
 * id is given, data-pid="<pid>"), found after a write's change has been loaded. Kept for a few seconds at most.
 */
export function usePendingFocus(root: React.RefObject<HTMLElement>) {
  const pending = useRef<{ k: string; pid?: string; select?: boolean; until: number } | null>(null);
  useLayoutEffect(() => {
    const want = pending.current;
    if (!want) return;
    if (Date.now() > want.until) {
      pending.current = null;
      return;
    }
    const element = root.current?.querySelector<HTMLElement>(`[data-k="${want.k}"]`);
    if (!element || (want.pid !== undefined && element.dataset.pid !== want.pid)) return;
    pending.current = null;
    element.focus();
    if (want.select && element instanceof HTMLInputElement) element.select();
  });
  return useCallback((k: string, options: { pid?: string; select?: boolean } = {}) => {
    pending.current = { k, ...options, until: Date.now() + 5000 };
  }, []);
}

/**
 * A text field that saves while you type (after a short pause, and when you leave it) and shows what you typed
 * until the library has it. `save` gets the text as typed; it decides what it can keep.
 * `owner` names what the field belongs to (a board, a pad): a new owner drops the old draft after saving it.
 */
export function useSavedText(saved: string, save: (text: string) => void, owner: string, delayMs = SAVE_AFTER_MS) {
  const [draft, setDraft] = useState<{ owner: string; text: string } | null>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What is typed but not saved yet, with the save of the owner it was typed for.
  const pending = useRef<{ text: string; save: (text: string) => void } | null>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const waiting = pending.current;
    pending.current = null;
    waiting?.save(waiting.text);
  }, []);
  // Leaving the owner (another pad selected, the screen closed) saves what was typed for it.
  useEffect(() => flush, [owner, flush]);

  const text = draft && draft.owner === owner ? draft.text : null;
  // Once the library has the text (and the field is left), show the library's text again.
  useEffect(() => {
    if (text !== null && !focused.current && pending.current === null && saved === text.trim()) setDraft(null);
  }, [saved, text]);

  return {
    value: text ?? saved,
    onChange: (typed: string) => {
      setDraft({ owner, text: typed });
      pending.current = { text: typed, save };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      flush();
      if (text !== null && (text.trim() === "" || text.trim() === saved)) setDraft(null);
    },
  };
}
