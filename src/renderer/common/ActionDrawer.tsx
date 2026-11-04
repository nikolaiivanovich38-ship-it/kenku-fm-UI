import React, { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import { Toolbar, Stack, Typography, Link } from "@mui/material";
import { OutputListItems } from "../features/output/OutputListItems";
import { InputListItems } from "../features/input/InputListItems";
import { BookmarkListItems } from "../features/bookmarks/BookmarkListItems";
import { BookmarkRail } from "../features/bookmarks/BookmarkRail";
import { SidebarToggle } from "../features/bookmarks/SidebarToggle";
import { setSidebarCollapsed } from "../features/bookmarks/bookmarksSlice";
import { SIDEBAR_WIDTH, sidebarWidth } from "../features/bookmarks/sidebar";
import { Settings } from "../features/settings/Settings";

import { RootState } from "../app/store";
import { useDispatch, useSelector } from "react-redux";

import icon from "../../assets/icon.svg";
import { useHideScrollbar } from "./useHideScrollbar";
import { showWindowControls } from "./showWindowControls";

export const drawerWidth = SIDEBAR_WIDTH;

export function ActionDrawer() {
  const settings = useSelector((state: RootState) => state.settings);
  const connection = useSelector((state: RootState) => state.connection);
  // UX-10: the sidebar can be collapsed to a column of bookmark icons.
  const collapsed = useSelector((state: RootState) => state.bookmarks.sidebarCollapsed);
  const width = sidebarWidth(collapsed);
  const dispatch = useDispatch();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hideScrollbar = useHideScrollbar(scrollRef);

  // Settings is as wide as the expanded sidebar; website views are drawn over
  // the rest of the window, so the sidebar expands first.
  function openSettings() {
    dispatch(setSidebarCollapsed(false));
    setSettingsOpen(true);
  }

  return (
    <Box
      component="nav"
      id="sidebar"
      aria-label="Sidebar"
      data-width={width}
      sx={{ width, flexShrink: 0 }}
    >
      <Drawer
        variant="permanent"
        sx={{
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            width,
            border: "none",
            bgcolor: "background.default",
            overflowY: "initial",
          },
        }}
        open
      >
        <Toolbar
          sx={{
            justifyContent: collapsed ? "center" : showWindowControls ? "space-between" : "end",
            bgcolor: "background.paper",
            px: 1,
            WebkitAppRegion: "drag",
            minHeight: "52px",
          }}
          disableGutters
          variant="dense"
          onDoubleClick={(e) =>
            e.target === e.currentTarget && window.kenku.toggleMaximize()
          }
        >
          {showWindowControls && !collapsed && (
            <Box sx={{ width: "36px", height: "36px", m: 1 }}>
              <img src={icon} alt="Lyre" />
            </Box>
          )}
          <IconButton
            aria-label="Settings"
            onClick={openSettings}
            sx={{ WebkitAppRegion: "no-drag" }}
          >
            <SettingsIcon />
          </IconButton>
          <Settings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </Toolbar>
        <Box sx={{ overflowY: "auto", flexGrow: 1, minHeight: 0 }} ref={scrollRef} {...hideScrollbar}>
          {collapsed && <BookmarkRail />}
          {/* Kept mounted while collapsed: the input and output lists keep
              external inputs running and listen for Discord's server list. */}
          <Stack sx={{ display: collapsed ? "none" : undefined }}>
            <BookmarkListItems />
            {settings.externalInputsEnabled && <InputListItems />}
            <OutputListItems />
            {connection.status === "disconnected" && (
              <Typography variant="caption" align="center" marginY={2}>
                Connect{" "}
                <Link
                  component="button"
                  variant="caption"
                  onClick={openSettings}
                >
                  Discord
                </Link>{" "}
                for more outputs
              </Typography>
            )}
          </Stack>
        </Box>
        <Box sx={{ display: "flex", justifyContent: collapsed ? "center" : "flex-end", p: 0.5 }}>
          <SidebarToggle />
        </Box>
      </Drawer>
    </Box>
  );
}
