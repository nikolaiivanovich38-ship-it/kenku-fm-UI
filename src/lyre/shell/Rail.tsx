import React from "react";
import { Icon, LyreLogo, type IconName } from "../kit/Icon";
import { hashOf, type Section } from "./routes";
import { useShellData } from "./ShellData";
import { HELP_BUTTON_ID } from "../help/useHelp";

interface RailProps {
  section: Section;
  /** Icons only (the window is narrow, or the user chose it). */
  min: boolean;
  onToggleMin: () => void;
  /** FND-8: whether Help's panel is open, and the Help button's press. */
  helpOpen?: boolean;
  onHelp?: () => void;
}

/** The rail: Lyre's sections, in the prototype's order, with Look and feel, Help and "Icons only" at the bottom. */
export function Rail({ section, min, onToggleMin, helpOpen = false, onHelp }: RailProps) {
  const { liveLabel, liveName, outputsLabel } = useShellData();
  const link = (to: Section, icon: IconName, label: string, name?: string) => (
    <a href={hashOf(to)} aria-current={section === to ? "page" : undefined} title={min ? label : undefined} aria-label={name}>
      <Icon name={icon} />
      <span className="lbl">{label}</span>
    </a>
  );
  return (
    <aside className={min ? "rail min" : "rail"}>
      <div className="logo">
        <LyreLogo />
        <b>Lyre</b>
      </div>
      <nav aria-label="Lyre">
        <div className="stack" style={{ gap: 2 }}>
          {link("campaigns", "crown", "Campaigns")}
          {link("library", "library", "Library")}
          {link("playlists", "playlist", "Playlists")}
          {link("boards", "grid", "Pad boards")}
          {link("live", "broadcast", liveLabel ?? "Live", liveLabel ? liveName : undefined)}
          {/* OUT-9 (round 6, Nik 6 Nov 13:55): the screen is Rooms; its address stays #/outputs. */}
          {link("outputs", "users", outputsLabel ?? "Rooms")}
        </div>
      </nav>
      <div className="bottom stack" style={{ gap: 2 }}>
        {/* w6-rooms (OUT-8): Settings, gear, above Look and feel. */}
        {link("settings", "gear", "Settings")}
        {link("look", "palette", "Look and feel")}
        {onHelp && (
          // FND-8: Help opens a side panel, not a screen, so it is a button (F1 does the same).
          <button
            type="button"
            id={HELP_BUTTON_ID}
            className="nav"
            aria-controls={helpOpen ? "lyre-help" : undefined}
            aria-expanded={helpOpen}
            aria-keyshortcuts="F1"
            title={min ? "Help" : undefined}
            onClick={onHelp}
          >
            <Icon name="help" />
            <span className="lbl">Help</span>
          </button>
        )}
        <button
          type="button"
          className="nav"
          aria-label={min ? "Show menu labels" : "Show icons only"}
          title={min ? "Show labels" : "Icons only"}
          onClick={onToggleMin}
        >
          <Icon name={min ? "chevright" : "chevleft"} />
          <span className="lbl">Icons only</span>
        </button>
      </div>
    </aside>
  );
}
