import { SIDEBAR_WIDTH } from "../bookmarks/sidebar";

/**
 * Where website views go: right of the sidebar, below the tab bar and
 * address bar. UX-10: the sidebar can be collapsed, so its current width is
 * read from the sidebar element (`data-width`, set by ActionDrawer).
 */
export function getBounds() {
  const controls = document.getElementById("controls");
  const y = controls?.clientHeight || 0;
  const sidebarWidth = Number(document.getElementById("sidebar")?.dataset.width) || SIDEBAR_WIDTH;
  return {
    x: sidebarWidth,
    y,
    width: window.innerWidth - sidebarWidth,
    height: window.innerHeight - y,
  };
}
