/** UX-10: width of the sidebar (bookmarks, inputs, outputs) when expanded. */
export const SIDEBAR_WIDTH = 240;

/** UX-10: width of the sidebar collapsed to a column of icons. */
export const COLLAPSED_SIDEBAR_WIDTH = 56;

export function sidebarWidth(collapsed: boolean): number {
  return collapsed ? COLLAPSED_SIDEBAR_WIDTH : SIDEBAR_WIDTH;
}

/**
 * UX finding 1/4: while error messages are shown and the sidebar is collapsed,
 * they appear in a column of this width beside the icons, and the website or
 * player view moves right of it, so nothing covers them.
 */
export const ERROR_COLUMN_WIDTH = 248;

/** The sidebar's width, including the error column next to the collapsed icons. */
export function sidebarSpace(collapsed: boolean, showingErrors: boolean): number {
  return collapsed && showingErrors ? COLLAPSED_SIDEBAR_WIDTH + ERROR_COLUMN_WIDTH : sidebarWidth(collapsed);
}
