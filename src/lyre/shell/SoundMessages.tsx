import { useEffect } from "react";

import { useOptionalLyreAudio } from "../audio";
import { useAnnounce } from "./Announcer";

/**
 * The audio host's sentences ("Previewing in your headphones: Tavern") go to the page's live region and its
 * failures ("Unable to preview: Tavern") to a toast, once for the whole page, whatever screen is open. Screens do
 * not listen themselves, so nothing is said twice. Nothing happens when the page has no sound.
 */
export function SoundMessages(): null {
  const audio = useOptionalLyreAudio();
  const { say, toast } = useAnnounce();
  useEffect(() => {
    if (!audio) return;
    audio.on("announce", say);
    audio.on("error", toast);
    return () => {
      audio.off("announce", say);
      audio.off("error", toast);
    };
  }, [audio, say, toast]);
  return null;
}
