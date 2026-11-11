/**
 * Settings (route `settings`, in the menu above Look and feel): OUT-8, round 6 part 2, with round 7's remote code
 * (SEC-4), headphones and speakers (PRV-2), the default crossfade (PLY-8) and keyboard shortcuts (UX-12). Ported from
 * design/prototype/src/views/settings.js and settings.css.
 *
 * Everything the old main window's Settings had that Lyre still needs: Discord bots first, then, folded because they
 * are set once, Sound to Discord, Headphones and speakers, Remote control, Keyboard shortcuts, Website tabs and Local
 * files. Look and feel stays its own screen in the menu.
 */
import React from "react";

import { TopLead } from "../../shell/TopBar";
import { BotsPane } from "./BotsPane";
import { DevicesPane, FilesPane, KeysPane, RemotePane, SoundPane, TabsPane } from "./OtherPanes";
import "./settings.css";
import { LYRE_VERSION } from "../../version";

export function SettingsScreen() {
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Settings</h1>
        <span className="grow" />
        {/* UX-R16 (ROUND6 part 4 #18): the app shows its own version. */}
        {LYRE_VERSION && (
          <span className="faint num" title="Lyre version">
            {LYRE_VERSION}
          </span>
        )}
      </div>
      <div className="viewbody st-body">
        <div className="st-split">
          <div className="col">
            <BotsPane />
          </div>
          <div className="col">
            <SoundPane />
            <DevicesPane />
            <RemotePane />
            <KeysPane />
            <TabsPane />
            <FilesPane />
          </div>
        </div>
      </div>
    </>
  );
}
