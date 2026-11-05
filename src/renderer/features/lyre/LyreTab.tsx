import React, { useEffect } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";

import type { RootState } from "../../app/store";
import { TabItem } from "../tabs/TabItem";
import { openBrowserView } from "../tabs/openBrowserView";
import { setLyreId } from "./lyreSlice";

/**
 * WP5 (w3-shell): the built-in "Lyre" tab, opening the new interface. It sits
 * beside the old player tab and, like it, cannot be closed. Its page is
 * created at start but stays behind the player until the tab is chosen, so the
 * old player keeps opening first, as before.
 */
export function LyreTab() {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const lyre = useSelector((state: RootState) => state.lyre);
  const selectedTab = useSelector((state: RootState) => state.tabs.selectedTab);

  useEffect(() => {
    const createTab = async () => {
      // SEC-8: the main process picks the Lyre page's preload from the kind.
      const id = await openBrowserView(lyre.tab.url, "lyre");
      if (id === undefined) {
        return;
      }
      dispatch(setLyreId(id));
      // A new view is drawn on top of the others; step back unless chosen meanwhile.
      if (store.getState().tabs.selectedTab !== id) {
        window.kenku.hideBrowserView(id);
      }
    };

    if (lyre.tab.id === -1) {
      createTab();
    }
  }, [lyre.tab.id, lyre.tab.url, dispatch, store]);

  return <TabItem tab={lyre.tab} selected={selectedTab === lyre.tab.id} />;
}
