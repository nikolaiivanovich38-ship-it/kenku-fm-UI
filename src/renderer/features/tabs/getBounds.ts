import { SIDEBAR_WIDTH } from "../bookmarks/sidebar";
import { currentViewOverlay } from "../../common/viewOverlay";

/**
 * Where website views go: right of the sidebar, below the tab bar and
 * address bar. UX-10: the sidebar can be collapsed, so its current width is
 * read from the sidebar element (`data-width`, set by ActionDrawer). A side
 * panel such as Settings pushes the view further right while it is open.
 */
export function getBounds() {
  const controls = document.getElementById("controls");
  const y = controls?.clientHeight || 0;
  const sidebarWidth = Number(document.getElementById("sidebar")?.dataset.width) || SIDEBAR_WIDTH;
  // UX finding 1/8: an open side panel (Settings) may be wider than the sidebar.
  const x = Math.max(sidebarWidth, currentViewOverlay().inset);
  return {
    x,
    y,
    width: window.innerWidth - x,
    height: window.innerHeight - y,
  };
}
