/** UX-10: width of the sidebar (bookmarks, inputs, outputs) when expanded. */
export const SIDEBAR_WIDTH = 240;

/** UX-10: width of the sidebar collapsed to a column of icons. */
export const COLLAPSED_SIDEBAR_WIDTH = 56;

export function sidebarWidth(collapsed: boolean): number {
  return collapsed ? COLLAPSED_SIDEBAR_WIDTH : SIDEBAR_WIDTH;
}
