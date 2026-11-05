import React from "react";
import { Select } from "../kit/Fields";
import { THEME_CHOICES, type ThemeChoice } from "../shell/themes";
import { useThemeChoice } from "../shell/useThemeChoice";

/**
 * Look and feel, until its screen is built: the heading, the prototype's subtitle and the theme choice, so the theme
 * can already be switched here (UX-11). The theme cards of the prototype come with the screen.
 */
export function LookPlaceholder() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <>
      <div className="viewhead">
        <h1>Look and feel</h1>
        <span className="muted">One Lyre, a theme per table</span>
      </div>
      <div className="viewbody">
        <div className="placeholder">
          <p className="empty">Not built yet.</p>
          <p className="muted">
            Each campaign can pick its own table theme, and Lyre switches to it when you open that campaign. Pick a theme
            here to use it everywhere instead.
          </p>
          <Select<ThemeChoice> className="theme-choice" label="Theme" value={choice} options={THEME_CHOICES} onChange={setChoice} />
        </div>
      </div>
    </>
  );
}
