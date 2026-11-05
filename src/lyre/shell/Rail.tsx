import React from "react";
import { Icon, LyreLogo, type IconName } from "../kit/Icon";
import { hashOf, type Section } from "./routes";
import { useShellData } from "./ShellData";

interface RailProps {
  section: Section;
  /** Icons only (the window is narrow, or the user chose it). */
  min: boolean;
  onToggleMin: () => void;
}

/** The rail: Lyre's sections, in the prototype's order, with Look and feel and "Icons only" at the bottom. */
export function Rail({ section, min, onToggleMin }: RailProps) {
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
          {link("outputs", "users", outputsLabel ?? "Outputs")}
        </div>
      </nav>
      <div className="bottom stack" style={{ gap: 2 }}>
        {link("look", "palette", "Look and feel")}
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
