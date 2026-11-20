/**
 * What a track title outside the Track library opens (R60-GAPS.md, the Track panel: rows 13 and 38). The shell hands
 * this to the side-panel host (kit/SidePanel.tsx), and every title reaches it through `useOpenTrackPanel()`.
 *
 * Stand-in (r10-prep, step 0): the Track library with the track's details shown, as 0.5.2 does. r10-tracks replaces
 * it with the Track panel, for example:
 *   (trackId, from, panels) => panels.openSidePanel("trackPanel", <TrackPanel trackId={trackId} from={from} />)
 * (the panel's × and Esc call panels.closeSidePanel("trackPanel") and give focus back to `from`).
 */
import { goToTrackLibrary, type OpenTrackPanel } from "../../kit/SidePanel";

export const openTrackPanel: OpenTrackPanel = goToTrackLibrary;
