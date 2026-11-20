/**
 * What a track title outside the Track library opens (R60-GAPS.md, the Track panel: rows 13 and 38). The shell hands
 * this to the side-panel host (kit/SidePanel.tsx), and every title reaches it through `useOpenTrackPanel()`.
 *
 * r10-tracks: the Track panel (TrackPanel.tsx) beside the screen; its × and Esc close it and give focus back to the
 * title that opened it. On the Track library and the Audio profile the title goes to the Library's own details, as
 * there is no panel there (r9nav.js NO_PANEL).
 */
import React from "react";
import { goToTrackLibrary, type OpenTrackPanel } from "../../kit/SidePanel";
import { TrackPanel } from "./TrackPanel";

/** The screens where a track's title goes to the Track library itself. */
const NO_PANEL = /^#\/?(library|profile)(\/|$)/;

export const openTrackPanel: OpenTrackPanel = (trackId, from, panels) => {
  if (NO_PANEL.test(window.location.hash)) return goToTrackLibrary(trackId, from, panels);
  const close = () => {
    panels.closeSidePanel("trackPanel");
    if (from && document.contains(from)) setTimeout(() => from.focus(), 0);
  };
  panels.openSidePanel("trackPanel", React.createElement(TrackPanel, { key: trackId, trackId, onClose: close }));
};
