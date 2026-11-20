/**
 * Round 9 (r9nav.js, the trail): an address that names a track after a playlist or a session (#/playlist/<pid>/<tid>,
 * #/session/<cid>/<sid>/<tid>) opens that place with the Track panel open on the track. The Audio profile's trail
 * leads there; Back comes here too.
 */
import { useEffect } from "react";
import { useOpenTrackPanel } from "../../kit/SidePanel";
import type { Route } from "../../shell/routes";

export function TrackPanelFromRoute({ route }: { route: Route }): null {
  const openTrackPanel = useOpenTrackPanel();
  const tid = route.name === "playlist" || route.name === "session" ? route.params.tid : undefined;
  useEffect(() => {
    if (tid) openTrackPanel(tid, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the address names another track
  }, [route.path]);
  return null;
}
