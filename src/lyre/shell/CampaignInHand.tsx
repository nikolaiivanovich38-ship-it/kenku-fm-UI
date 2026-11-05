import { createContext, useContext } from "react";

/**
 * The campaign in hand: the last one opened in this visit (the prototype's L.state.ctx.cid). The shell provides it
 * around each screen; shared screens start from it ("Use in…" opens its group first). Its own file, so screens can
 * read it without importing the shell (which imports the screens).
 */
export const CampaignInHandContext = createContext<string | undefined>(undefined);

/** The id of the campaign in hand, if one was opened. */
export function useCampaignInHand(): string | undefined {
  return useContext(CampaignInHandContext);
}
