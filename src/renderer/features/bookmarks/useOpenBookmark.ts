import { useDispatch } from "react-redux";
import { Bookmark } from "./bookmarksSlice";
import { addTab, selectTab } from "../tabs/tabsSlice";
import { openAddressInNewView } from "../tabs/openBrowserView";
import { showAppError } from "../../common/appErrors";
import { addressErrorsResolved } from "../errors/errorsSlice";
import { checkTypedTabUrl, isRefused } from "../../../common/security/urlPolicy";

/**
 * Open a bookmark in a new tab (used by the sidebar list and the collapsed
 * icon rail). Bookmarks saved by Kenku FM before SEC-6 may lack https://
 * ("youtube.com"), so the address is normalised like a typed one; a refused
 * address is explained instead of opening a blank tab. SEC-15: a bookmark to a
 * file opens in a file's tab once the main process has asked the user.
 */
export function useOpenBookmark(): (bookmark: Bookmark) => Promise<void> {
  const dispatch = useDispatch();
  return async (bookmark) => {
    const check = checkTypedTabUrl(bookmark.url);
    if (isRefused(check)) {
      showAppError(`That page was not opened. ${check.reason}`, { kind: "address" });
      return;
    }
    const tab = await openAddressInNewView(check, bookmark.title, bookmark.icon);
    if (!tab) {
      return;
    }
    dispatch(addTab(tab));
    dispatch(selectTab(tab.id));
    // UX finding 4: an earlier "could not open" message is out of date now.
    dispatch(addressErrorsResolved());
  };
}
