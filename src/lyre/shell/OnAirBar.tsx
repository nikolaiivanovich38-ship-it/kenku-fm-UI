import React, { useLayoutEffect, useRef } from "react";

import { useNowPlaying, useOptionalLyreAudio, type LyreAudio } from "../audio";
import { Icon } from "../kit/Icon";
import { Badge } from "../kit/Pills";

/** Stop on the bar fades everything out this fast (the prototype's L.fadeAll(1)). */
const STOP_FADE_MS = 1000;

/**
 * Outside Live, the slim "On air" bar at the foot of every screen (the prototype's onAirBar in core.js): what the
 * players hear in the first room (music, ambience) and how many effects still sound in any room, with Stop and
 * Go to Live, so Play on air always shows that something happened. Nothing is drawn while nothing plays, or when
 * the page has no sound. AppProviders hands it to the shell as ShellData.onAirBar.
 *
 * When the bar goes away while it holds the keyboard focus (Stop was pressed), focus goes to the screen's heading,
 * so keyboard users are not sent back to the top of the page.
 */
export function OnAirBar() {
  const audio = useOptionalLyreAudio();
  return audio ? <Bar audio={audio} /> : null;
}

function Bar({ audio }: { audio: LyreAudio }) {
  const now = useNowPlaying();
  const first = now.rooms[0];
  const music = first?.music;
  const ambience = first?.ambience;
  const effects = now.rooms.reduce((n, room) => n + room.effects.length, 0);
  const empty = !music && !ambience && !effects;
  const holdsFocus = useRef(false);
  useLayoutEffect(() => {
    if (!empty || !holdsFocus.current) return;
    holdsFocus.current = false;
    const heading = document.querySelector<HTMLElement>("#view h1");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, [empty]);
  if (empty) return null;
  return (
    <div
      className="onairbar"
      role="region"
      aria-label="On air"
      onFocus={() => (holdsFocus.current = true)}
      onBlur={(event) => (holdsFocus.current = !!event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node))}
    >
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
      <button type="button" className="btn s" aria-label="Stop everything on air" onClick={() => audio.fadeAll(STOP_FADE_MS)}>
        <Icon name="stop" size="s" />
        Stop
      </button>
      <a className="btn s" href="#/live">
        <Icon name="broadcast" size="s" />
        Go to Live
      </a>
    </div>
  );
}
