import React from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CollapseIcon from "@mui/icons-material/KeyboardDoubleArrowLeftRounded";
import ExpandIcon from "@mui/icons-material/KeyboardDoubleArrowRightRounded";
import { useDispatch, useSelector } from "react-redux";

import type { RootState } from "../../app/store";
import { setSidebarCollapsed } from "./bookmarksSlice";

/**
 * UX-10: collapse the sidebar to a column of bookmark icons, or expand it
 * again. The choice is saved with the bookmarks.
 */
export function SidebarToggle() {
  const dispatch = useDispatch();
  const collapsed = useSelector((state: RootState) => state.bookmarks.sidebarCollapsed);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <Tooltip title={label} placement="right">
      <IconButton
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="sidebar"
        onClick={() => dispatch(setSidebarCollapsed(!collapsed))}
      >
        {collapsed ? <ExpandIcon /> : <CollapseIcon />}
      </IconButton>
    </Tooltip>
  );
}
