import React from "react";
import { Icon, LyreLogo, type IconName } from "../kit/Icon";
import { hashOf, type Section } from "./routes";
import { useShellData } from "./ShellData";
import { HELP_BUTTON_ID } from "../help/useHelp";
import { useSetupProgress } from "../help/setup";
import { useHasLyreApi } from "../api";

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
  const hasLibrary = useHasLyreApi();
  const link = (to: Section, icon: IconName, label: string, name?: string, hint?: string) => (
    <a
      href={hashOf(to)}
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
          {/* OUT-9 (round 6, Nik 6 Nov 13:55): the screen is Rooms; its address stays #/outputs. */}
          {link("outputs", "users", outputsLabel ?? "Rooms", undefined, outputsHint)}
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
            {section !== "live" && hasLibrary && <SetupDot />}
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

/**
 * Round 9 §4 and round 10 (look D12, R10-FIX §3): Set up Lyre's progress on Help's button, a quiet outline chip
 * ("4/9"; a dot inside the button when the menu shows icons only), its count in its hover text, until all nine are
 * done or the checklist is hidden. Not while Live is open, where a scene may be running.
 */
function SetupDot() {
  const p = useSetupProgress(false);
  // The theme task is optional: the chip counts it as Help's panel does, but never shows only for it.
  const left = p.tasks.filter((t) => !t.done && t.task.id !== "look").length;
  if (p.hidden || left === 0) return null;
  return <span className="help-ring" aria-hidden="true" title={`Set up Lyre: ${p.done} of ${p.of} done`} data-count={`${p.done}/${p.of}`} />;
}
