import createTheme, { ThemeOptions } from "@mui/material/styles/createTheme";

/**
 * UX finding 3: one keyboard focus outline for the whole app (main window and
 * player). A warm gold, so it never looks like the purple tint of a selected
 * item, and at least 3:1 against every dark surface (see theme.test.ts).
 * Shown for keyboard focus only (`:focus-visible`), not for mouse clicks.
 */
export const FOCUS_RING_COLOR = "#ffd866";

const focusRing = {
  outline: `2px solid ${FOCUS_RING_COLOR}`,
  outlineOffset: "2px",
} as const;

/** Rows sit in scrolling lists that clip anything drawn outside them, so their outline is drawn inside. */
const insetFocusRing = { ...focusRing, outlineOffset: "-2px" } as const;

export const themeOptions: ThemeOptions = {
  palette: {
    mode: "dark",
    primary: {
      main: "#bb99ff",
    },
    secondary: {
      main: "#ee99ff",
    },
    background: {
      paper: "#222639",
      default: "#1e2231",
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Anything focusable that is not an MUI control (drag handles, links, plain buttons).
        ":focus-visible": focusRing,
        // Text fields already show focus with their underline or border.
        "input:focus-visible, textarea:focus-visible": { outline: "none" },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          color: "secondary",
        },
      },
    },
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true,
      },
      styleOverrides: {
        // ButtonBase removes the browser's outline; put the app's one back.
        root: { "&.Mui-focusVisible": focusRing },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: { "&.Mui-focusVisible": focusRing },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          padding: 8,
          "& .MuiSwitch-track": {
            borderRadius: 22 / 2,
          },
          "& .MuiSwitch-thumb": {
            boxShadow: "none",
            width: 16,
            height: 16,
            margin: 2,
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          margin: "4px 8px",
          borderRadius: "16px",
          "&.Mui-focusVisible": insetFocusRing,
        },
        dense: {
          borderRadius: "12px",
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          minWidth: "192px !important",
        },
      },
    },
  },
};

export const theme = createTheme(themeOptions);
