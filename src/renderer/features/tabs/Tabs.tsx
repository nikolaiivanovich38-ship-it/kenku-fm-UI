import React, { useEffect, useMemo, useRef } from "react";
import Stack from "@mui/material/Stack";

import { RootState } from "../../app/store";
import { useSelector, useDispatch } from "react-redux";
import {
  addTab,
  decreaseTabPlayingMedia,
  editTab,
  increaseTabPlayingMedia,
  removeTab,
  replaceTab,
  selectTab,
} from "./tabsSlice";

import { OpenableAddress, URLBar } from "./URLBar";
import { TabBar } from "./TabBar";
import { getBounds } from "./getBounds";
import { openAddressInNewView, openBrowserView } from "./openBrowserView";
import {
  decreasePlayingMedia,
  increasePlayingMedia,
} from "../player/playerSlice";
import { editBookmark } from "../bookmarks/bookmarksSlice";
import { addressErrorsResolved } from "../errors/errorsSlice";
import { useViewOverlay } from "../../common/viewOverlay";
import { isBuiltInTab } from "../lyre/lyreSlice";

/**
 * Safely parse a URL string. Returns a URL object if valid, otherwise null.
 * Logs a warning when the URL is malformed.
 */
export const safeURL = (urlString: string): URL | null => {
  try {
    return new URL(urlString);
  } catch {
    console.warn(`Invalid URL detected: ${urlString}`);
    return null;
  }
};

export function Tabs() {
  const dispatch = useDispatch();
  const player = useSelector((state: RootState) => state.player);
  const lyre = useSelector((state: RootState) => state.lyre);
  const tabs = useSelector((state: RootState) => state.tabs);
  const bookmarks = useSelector((state: RootState) => state.bookmarks);
  const settings = useSelector((state: RootState) => state.settings);

  const selectedTab = useMemo(() => tabs.tabs.byId[tabs.selectedTab], [tabs]);

  /** The old player or the new interface (WP5) is in front: no address bar. */
  const isPlayer = useMemo(
    () => isBuiltInTab(tabs.selectedTab, { playerId: player.tab.id, lyreId: lyre.tab.id }),
    [tabs.selectedTab, player.tab.id, lyre.tab.id],
  );

  useEffect(() => {
    window.kenku.on("BROWSER_VIEW_DID_NAVIGATE", (args) => {
      const viewId = args[0];
      const url = args[1];
      dispatch(editTab({ id: viewId, url }));
      // UX finding 4: a page opened in the tab in front, so an earlier
      // "could not open" message is out of date.
      if (viewId === tabs.selectedTab) {
        dispatch(addressErrorsResolved());
      }
    });
    window.kenku.on("BROWSER_VIEW_TITLE_UPDATED", (args) => {
      const viewId = args[0];
      const title = args[1];
      if (viewId === player.tab.id) {
        return;
      }
      dispatch(editTab({ id: viewId, title }));
    });
    window.kenku.on("BROWSER_VIEW_FAVICON_UPDATED", (args) => {
      const viewId = args[0];
      const favicons = args[1];

      if (viewId === player.tab.id) {
        return;
      }

      const validFavicons: string[] = [];
      if (Array.isArray(favicons)) {
        favicons.forEach((favicon) => {
          const url = safeURL(favicon);
          if (url) {
            validFavicons.push(favicon);
          }
        });
      }

      if (validFavicons.length === 0) {
        return;
      }

      const tab = tabs.tabs.byId[viewId];

      const getHostname = (url: URL) => {
        const hostname = url.hostname;

        return hostname;
      };

      if (tab) {
        const tabUrlObj = safeURL(tab.url);
        if (!tabUrlObj) {
          return;
        }
        const tabUrl = getHostname(tabUrlObj);

        const bookmarkItems = Object.values(bookmarks.bookmarks.byId);
        const hasMatch = bookmarkItems.filter((bookmark) => {
          const bookmarkUrlObj = safeURL(bookmark.url);
          if (!bookmarkUrlObj) return false;
          const url = getHostname(bookmarkUrlObj);
          return url === tabUrl;
        });

        if (hasMatch.length > 0) {
          hasMatch.forEach((match) => {
            dispatch(editBookmark({ id: match.id, icon: validFavicons[0] }));
          });
        }
      }

      dispatch(editTab({ id: viewId, icon: validFavicons[0] || "" }));
    });
    window.kenku.on("BROWSER_VIEW_MEDIA_STARTED_PLAYING", (args) => {
      const viewId = args[0];
      if (viewId === player.tab.id) {
        dispatch(increasePlayingMedia());
      } else {
        dispatch(increaseTabPlayingMedia(viewId));
      }
    });
    window.kenku.on("BROWSER_VIEW_MEDIA_PAUSED", (args) => {
      const viewId = args[0];
      if (viewId === player.tab.id) {
        dispatch(decreasePlayingMedia());
      } else {
        dispatch(decreaseTabPlayingMedia(viewId));
      }
    });
    window.kenku.on("BROWSER_VIEW_NEW_TAB", async (args) => {
      const url = args[0] ?? "";
      const id = await openBrowserView(url);
      if (id === undefined) {
        return;
      }
      dispatch(
        addTab({
          id,
          url,
          title: "New Tab",
          icon: "",
          playingMedia: 0,
          muted: false,
        }),
      );
      dispatch(selectTab(id));
    });
    window.kenku.on("BROWSER_VIEW_CLOSE_TAB", async () => {
      const tabId = tabs.selectedTab;
      // Don't close the built-in tabs: the old player and Lyre (WP5)
      if (tabId && !isBuiltInTab(tabId, { playerId: player.tab.id, lyreId: lyre.tab.id })) {
        const tabIds = tabs.tabs.allIds;
        // Find previous tab so we can select when closing the tab
        const prevTabIndex = tabIds.indexOf(tabId) - 1;
        const prevTabId = tabIds[prevTabIndex] || player.tab.id; // If there's no previous use the kenku player tab

        // Remove tab and select previous
        dispatch(removeTab(tabId));
        window.kenku.removeBrowserView(tabId);
        dispatch(selectTab(prevTabId));
      }
    });

    return () => {
      window.kenku.removeAllListeners("BROWSER_VIEW_DID_NAVIGATE");
      window.kenku.removeAllListeners("BROWSER_VIEW_TITLE_UPDATED");
      window.kenku.removeAllListeners("BROWSER_VIEW_FAVICON_UPDATED");
      window.kenku.removeAllListeners("BROWSER_VIEW_MEDIA_STARTED_PLAYING");
      window.kenku.removeAllListeners("BROWSER_VIEW_MEDIA_PAUSED");
      window.kenku.removeAllListeners("BROWSER_VIEW_NEW_TAB");
      window.kenku.removeAllListeners("BROWSER_VIEW_CLOSE_TAB");
    };
  }, [player.tab.id, lyre.tab.id, tabs]);

  const overlay = useViewOverlay();
  // Errors beside the collapsed sidebar take space from the view (ActionDrawer).
  const errorsBesideRail = useSelector(
    (state: RootState) => state.bookmarks.sidebarCollapsed && state.errors.list.length > 0,
  );

  // UX finding 1: the view is drawn above this page, so it steps aside while
  // a dialog, menu or popover is open, and comes back when it closes.
  const hiddenForOverlay = useRef(false);
  useEffect(() => {
    const id = tabs.selectedTab;
    if (!id) {
      return;
    }
    if (overlay.hidden) {
      window.kenku.hideBrowserView(id);
      hiddenForOverlay.current = true;
    } else if (hiddenForOverlay.current) {
      window.kenku.showBrowserView(id);
      hiddenForOverlay.current = false;
    }
  }, [overlay.hidden, tabs.selectedTab]);

  useEffect(() => {
    if (tabs.selectedTab) {
      const bounds = getBounds();
      window.kenku.setBrowserViewBounds(
        tabs.selectedTab,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
      );
    }
    // UX-10: the sidebar's width changes when it is collapsed or expanded,
    // and a side panel such as Settings can push the view to the right.
  }, [settings.urlBarEnabled, isPlayer, tabs.selectedTab, bookmarks.sidebarCollapsed, overlay.inset, errorsBesideRail]);

  function handleURLChange(url: string) {
    dispatch(editTab({ id: tabs.selectedTab, url }));
  }

  /**
   * SEC-15: files and websites never share a tab, so a file typed in the
   * address bar (or a web address typed in a file's tab) opens in a new view
   * that takes the current tab's place.
   */
  async function handleOpenInNewTab(address: OpenableAddress) {
    const oldId = tabs.selectedTab;
    const tab = await openAddressInNewView(address);
    if (!tab) {
      return;
    }
    dispatch(replaceTab({ oldId, tab }));
    // UX finding 4: an earlier "could not open" message is out of date now.
    dispatch(addressErrorsResolved());
    if (oldId !== undefined) {
      window.kenku.removeBrowserView(oldId);
    }
  }

  return (
    <Stack sx={{ flexGrow: 1, minWidth: 0 }} id="controls">
      <TabBar />
      {settings.urlBarEnabled && !isPlayer && (
        <URLBar
          viewId={selectedTab?.id || -1}
          url={selectedTab?.url || ""}
          onURLChange={handleURLChange}
          disabled={!selectedTab}
          localFile={selectedTab?.kind === "local-file"}
          onOpenInNewTab={handleOpenInNewTab}
        />
      )}
    </Stack>
  );
}
