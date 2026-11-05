import React from "react";

import { useLyreAudio, useNowPlaying } from "../../audio/LyreAudioProvider";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Badge } from "../../kit/Pills";
import { useShellData } from "../../shell/ShellData";

/**
 * The slim "On air" bar at the foot of the screen (the prototype's onAirBar in core.js): what the players hear, with
 * Stop and Go to Live, so Play on air always shows something happened.
 *
 * The shell owns this bar (ShellData.onAirBar) but nothing feeds it yet, so this screen shows it itself until the
 * shell does; as soon as ShellData has an on-air bar, this one steps aside and only the shell's shows.
 */
export function OnAirFallback() {
  const { onAirBar } = useShellData();
  const audio = useLyreAudio();
  const now = useNowPlaying();
  if (onAirBar !== undefined) return null;
  const first = now.rooms[0];
  const music = first?.music;
  const ambience = first?.ambience;
  const effects = now.rooms.reduce((n, r) => n + r.effects.length, 0);
  if (!music && !ambience && !effects) return null;
  return (
    <div className="onairbar" role="region" aria-label="On air">
      <Badge tone="onair">On air</Badge>
      <div className="oab-items">
        {music && (
          <span className="oab-item">
            <span className="lane-dot music" />
            <span className="ellipsis">{music.title}</span>
          </span>
        )}
        {ambience && (
          <span className="oab-item">
            <span className="lane-dot amb" />
            <span className="ellipsis">{ambience.title}</span>
          </span>
        )}
        {effects > 0 && (
          <span className="oab-item">
            <span className="lane-dot fx" />
            <span>
              {effects} effect{effects > 1 ? "s" : ""}
            </span>
          </span>
        )}
      </div>
      <Button size="s" icon="stop" onClick={() => audio.fadeAll(1000)}>
        Stop
      </Button>
      <a className="btn s" href="#/live">
        <Icon name="broadcast" size="s" />
        Go to Live
      </a>
    </div>
  );
}
