import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import CloseIcon from "@mui/icons-material/CloseRounded";
import PublicIcon from "@mui/icons-material/PublicRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";
import VolumeIcon from "@mui/icons-material/VolumeUpRounded";
import IconButton from "@mui/material/IconButton";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import React from "react";

import { v4 as uuid } from "uuid";

import { useDispatch, useSelector } from "react-redux";
import { type RootState } from "../../app/store";
import { DragHandle } from "../../common/SortableItem";
import { addBookmark, removeBookmark } from "../bookmarks/bookmarksSlice";
import { setMuted } from "../player/playerSlice";
import { safeURL } from "./Tabs";
import { Tab, editTab, removeTab, selectTab } from "./tabsSlice";

type TabType = {
  tab: Tab;
  selected?: boolean;
  allowClose?: boolean;
  shadow?: boolean;
};

/** Space at the tab's left for its site icon, which is also its drag handle. */
const ICON_SPACE = 28;

/**
 * One tab in the tab bar. The tab's own button selects it; the drag handle
 * (its site icon), mute, bookmark and close buttons sit beside that button,
 * never inside it (minor finding: nested controls), and are named after the
 * tab so a screen reader can tell them apart.
 */
export function TabItem({ tab, selected, allowClose, shadow }: TabType) {
  const playerTabId = useSelector((state: RootState) => state.player.tab.id);
  const tabIds = useSelector((state: RootState) => state.tabs.tabs.allIds);
  const bookmarks = useSelector(
    (state: RootState) => state.bookmarks.bookmarks.byId,
  );
  const dispatch = useDispatch();

  const isBookmarked = Object.values(bookmarks).filter((bookmark) => {
    return bookmark.url === tab.url;
  });

  const isPlayer = tab.id === playerTabId;
  const showMedia = tab.playingMedia > 0;
  const showBookmark = Boolean(safeURL(tab.url) && selected && allowClose);
  const showClose = Boolean(allowClose);
  const shownIcons =
    Number(showBookmark) + Number(showClose) + Number(showMedia);

  const icon = tab.icon ? (
    // Not draggable: the browser's own image drag would stop the tab drag.
    <img src={tab.icon} alt="" draggable={false} width={16} height={16} style={{ objectFit: "cover" }} />
  ) : isPlayer ? null : (
    <PublicIcon sx={{ fontSize: 16, color: "text.secondary" }} />
  );

  return (
    <ListItem
      secondaryAction={
        <>
          {showMedia && (
            <IconButton
              edge="end"
              // A fixed name with aria-pressed: "Mute …, pressed" means muted.
              aria-label={`Mute ${tab.title}`}
              aria-pressed={tab.muted}
              size="small"
              onClick={() => {
                const muted = !tab.muted;
                window.kenku.setMuted(tab.id, muted);
                if (tab.id === playerTabId) {
                  dispatch(setMuted(muted));
                } else {
                  dispatch(editTab({ id: tab.id, muted }));
                }
              }}
            >
              {tab.muted ? (
                <VolumeOffIcon sx={{ fontSize: "1rem" }} />
              ) : (
                <VolumeIcon sx={{ fontSize: "1rem" }} />
              )}
            </IconButton>
          )}
          {showBookmark && (
            <IconButton
              edge="end"
              size="small"
              aria-label={`Bookmark ${tab.title}`}
              aria-pressed={isBookmarked.length > 0}
              onClick={() => {
                if (isBookmarked.length === 0) {
                  const id = uuid();
                  dispatch(
                    addBookmark({
                      id,
                      url: tab.url,
                      title: tab.title,
                      icon: tab.icon,
                    }),
                  );
                } else {
                  dispatch(removeBookmark(isBookmarked[0].id));
                }
              }}
            >
              {isBookmarked.length === 0 ? (
                <BookmarkBorderIcon sx={{ fontSize: "1rem" }} />
              ) : (
                <BookmarkIcon sx={{ fontSize: "1rem" }} />
              )}
            </IconButton>
          )}
          {showClose && (
            <IconButton
              edge="end"
              aria-label={`Close tab ${tab.title}`}
              size="small"
              onClick={() => {
                // Find previous tab so we can select when closing the tab
                const prevTabIndex = tabIds.indexOf(tab.id) - 1;
                const prevTabId = tabIds[prevTabIndex] || playerTabId; // If there's no previous use the kenku player tab

                // Remove tab and select previous
                dispatch(removeTab(tab.id));
                window.kenku.removeBrowserView(tab.id);

                // Only change if this is the selected app
                if (selected) {
                  dispatch(selectTab(prevTabId));
                }
              }}
            >
              <CloseIcon sx={{ fontSize: "1rem" }} />
            </IconButton>
          )}
        </>
      }
      sx={{
        minWidth: "120px",
        position: "relative",
        "& .MuiListItemSecondaryAction-root": {
          right: "12px",
        },
        "& .MuiListItemButton-root": {
          pr: `${shownIcons * 23 + 8}px`,
          pl: icon ? `${ICON_SPACE + 4}px` : undefined,
        },
        WebkitAppRegion: "no-drag",
      }}
      disablePadding
    >
      {icon && (
        // UX finding 2: the keyboard moves a tab from its icon (Space, arrows, Space).
        <DragHandle
          label={`Move ${tab.title}`}
          sx={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 1,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </DragHandle>
      )}
      <ListItemButton
        sx={{
          backgroundImage:
            "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))",
          minWidth: 0,
          mx: 0.5,
          my: 0,
          boxShadow: shadow ? 4 : "none",
        }}
        dense
        selected={selected}
        aria-current={selected ? "page" : undefined}
        onClick={() => dispatch(selectTab(tab.id))}
      >
        <ListItemText
          primary={tab.title}
          sx={{
            ".MuiListItemText-primary": {
              whiteSpace: "nowrap",
              overflow: "hidden",
            },
          }}
        />
      </ListItemButton>
    </ListItem>
  );
}
