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

/** The rail: Lyre's sections (Live first since 0.5.1; then the prototype's order), with Look and feel, Help and "Icons only" at the bottom. */
export function Rail({ section, min, onToggleMin, helpOpen = false, onHelp }: RailProps) {
  const { liveLabel, liveName, outputsLabel, outputsHint } = useShellData();
  const link = (to: Section, icon: IconName, label: string, name?: string, hint?: string, className?: string) => (
    <a
      href={hashOf(to)}
      className={className}
      aria-current={section === to ? "page" : undefined}
      title={hint ? (min ? `${label}: ${hint}` : hint) : min ? label : undefined}
      // With hover text of its own, the link keeps its words as its name (the label is hidden when the rail is folded).
      aria-label={name ?? (hint ? label : undefined)}
    >
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
          {/* 0.5.1 (Nik, 11 Nov): Live first. */}
          {link("live", "broadcast", liveLabel ?? "Live", liveLabel ? liveName : undefined)}
          {link("campaigns", "crown", "Campaigns")}
          {link("library", "library", "Track library")}
          {link("playlists", "playlist", "Playlists")}
          {link("boards", "grid", "Pad boards")}
        </div>
      </nav>
      <div className="bottom stack" style={{ gap: 2 }}>
        {/* w6-rooms (OUT-8): Settings, gear, above Look and feel. */}
        {link("settings", "gear", "Settings")}
        {/* --- r10-live --- Round 10 (Nik, 18 Nov 03:14, answer 2: "keep the room screen as an option as it stands under
            settings"): Rooms, under Settings. OUT-9: the screen is Rooms; its address stays #/outputs. */}
        {link("outputs", "broadcast", outputsLabel ?? "Rooms", undefined, outputsHint ?? "Which bot is in which voice channel", "rail-sub")}
        {/* --- end r10-live --- */}
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
