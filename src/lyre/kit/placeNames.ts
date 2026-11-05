/**
 * The names the domain's place words need (placeLabel, orderPlaceWords, originWords), from the campaign trees, so
 * the Now playing bar, the play order menu and the round 5 screens all say "The abbey ruins (Session 14)" alike.
 */
import { useMemo } from "react";

import type { PlaceNames } from "../../common/domain";
import type { CampaignInfo } from "../../common/lyre/api";
import { useCampaigns } from "../api";

export function placeNamesOf(campaigns: readonly CampaignInfo[]): PlaceNames {
  const campaign = (id: string) => campaigns.find((c) => c.id === id);
  const session = (cid: string, sid: string) => campaign(cid)?.sessions.find((s) => s.id === sid);
  return {
    campaign: (cid) => campaign(cid)?.name,
    session: (cid, sid) => {
      const s = session(cid, sid);
      return s && { number: s.number, name: s.name };
    },
    scene: (cid, sid, scid) => session(cid, sid)?.scenes.find((sc) => sc.id === scid)?.name,
  };
}

/** Place names from the campaigns as they are now (none until they have loaded). */
export function usePlaceNames(): PlaceNames {
  const campaigns = useCampaigns().data;
  return useMemo(() => placeNamesOf(campaigns ?? []), [campaigns]);
}
