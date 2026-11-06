/**
 * UX-16 the Now playing bar (core.js onAirBar, roomRow, previewRow; ui.css .onairbar). Nik: "a universal bar that
 * appears when any music is playing … clearly indicating which output each is going to."
 *
 * At the foot of every screen while anything plays or is paused; gone when everything stops. One row per room that
 * plays music or ambience (effects alone bring up no row: they are short), and one row for the preview, so a preview
 * and music on air show together, as do two rooms. The rows share one grid, so their parts line up.
 *   - A room row: the On air tag (naming the room when there are two or more, "no room" while no bot is in a voice
 *     channel), the track (the scene's name for it, its own name on hover), where it comes from, the ambience under it
 *     and how many effects sound there, the time, Pause/Play, Stop (that room only), Next, the play order where it
 *     plays from, that room's volume, and Go to Live on the first row.
 *   - The preview row: the Only you tag, what previews, where it was previewed from, the time, Pause/Play, Stop and the
 *     headphone volume.
 * In Live (`previewOnly`) the room boxes show what each room hears, so only the preview row shows.
 *
 * Reads the audio host's getNowPlaying() only (names of places and playlists come from the library). When the bar,
 * or the row that held the keyboard focus, goes away (Stop), focus goes to the bar's first control, or to the
 * screen's heading when the whole bar has gone, so keyboard users are not sent back to the top of the page.
 */
import React, { useLayoutEffect, useRef } from "react";

import { formatGainDb, originWords } from "../../common/domain";
import { useNowPlaying, useOptionalLyreAudio, type LaneNowPlaying, type LyreAudio, type MusicOrAmbience, type PreviewNowPlaying, type RoomNowPlaying } from "../audio";
import { DestTag } from "../kit/DestTag";
import { Icon } from "../kit/Icon";
import { PlayOrderButton } from "../kit/PlayOrderButton";
import { usePlaceNames } from "../kit/placeNames";
import { usePlayOrders } from "../kit/playOrders";
import { TrackName, useTrackNames } from "../kit/trackName";
import { cx } from "../kit/cx";
import { useOutputs } from "../outputs/OutputsProvider";
import { useAnnounce } from "./Announcer";

/** Stop on a room's row fades that room out this fast (the prototype's L.stopLane(…, 1)). */
const STOP_FADE_MS = 1000;
/** The volume sliders move in steps of 5, as in the prototype. */
const VOLUME_STEP = 5;

/** Seconds as the prototype writes them: 3:57. */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function NowPlayingBar({ previewOnly = false }: { previewOnly?: boolean }) {
  const audio = useOptionalLyreAudio();
  return audio ? <Bar audio={audio} previewOnly={previewOnly} /> : null;
}

function Bar({ audio, previewOnly }: { audio: LyreAudio; previewOnly: boolean }) {
  const now = useNowPlaying();
  const rooms = previewOnly ? [] : now.rooms.filter((room) => room.music || room.ambience);
  const named = now.rooms.length > 1;
  const preview = now.preview;
  const empty = rooms.length === 0 && !preview;

  const barRef = useRef<HTMLDivElement>(null);
  const holdsFocus = useRef(false);
  useLayoutEffect(() => {
    if (!holdsFocus.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const first = barRef.current?.querySelector<HTMLElement>("button:not([disabled]), input, a[href]");
    if (first) {
      first.focus();
      return;
    }
    holdsFocus.current = false;
    const heading = document.querySelector<HTMLElement>("#view h1");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  });

  if (empty) return null;
  return (
    <div
      ref={barRef}
      className="onairbar"
      role="region"
      aria-label="Now playing"
      onFocus={() => (holdsFocus.current = true)}
      onBlur={(event) => (holdsFocus.current = !event.relatedTarget || event.currentTarget.contains(event.relatedTarget as Node))}
    >
      <div className="oab-rows">
        {rooms.map((room, i) => (
          <RoomRow key={room.roomId} audio={audio} room={room} named={named} broadcasting={now.broadcasting} first={i === 0} />
        ))}
        {preview && <PreviewRow audio={audio} preview={preview} />}
      </div>
    </div>
  );
}

function Time({ lane, position, length }: { lane: string; position: number | null; length: number | null }) {
  const at = position ?? 0;
  const share = length && length > 0 ? Math.min(100, (at / length) * 100) : 0;
  return (
    <div className="oab-time">
      <div className={cx("progress", lane)} aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </div>
      <span className="num">{length ? `${clockTime(at)} / ${clockTime(length)}` : clockTime(at)}</span>
    </div>
  );
}

function RoomRow({ audio, room, named, broadcasting, first }: { audio: LyreAudio; room: RoomNowPlaying; named: boolean; broadcasting: boolean; first: boolean }) {
  const { say } = useAnnounce();
  const places = usePlaceNames();
  const names = useTrackNames();
  const playlists = usePlayOrders()?.playlists;
  const laneName: MusicOrAmbience = room.music ? "music" : "ambience";
  const lane = (room.music ?? room.ambience) as LaneNowPlaying;
  const paused = lane.paused;
  const word = laneName === "music" ? "music" : "ambience";
  const tagRoom = !broadcasting ? "no room" : named ? room.name : undefined;
  const where = broadcasting ? ` in ${room.name}` : "";
  const target = { room: room.roomId };
  const playlistName = lane.playlistId ? (playlists?.get(lane.playlistId)?.name ?? null) : null;
  const from = originWords({ place: lane.place, playlistName }, places);
  const canNext = lane.origin.kind !== "single";
  // One room volume: the bot's own (kept by the main process, the same slider as on Outputs and in Live). Without the
  // Outputs bridge (tests, a page with no bots) the audio host's room level stands in.
  const { outputs, client } = useOutputs();
  const bot = outputs?.bots.find((b) => b.id === room.roomId) ?? null;
  const volume = Math.round((bot && client ? bot.volume : room.volume) * 100);
  const changeVolume = (value: number) => {
    if (bot && client) client.setVolume(bot.id, value / 100);
    else audio.setRoomVolume(target, value / 100);
  };
  const extras = [
    room.music && room.ambience ? `Ambience: ${room.ambience.title}` : "",
    room.effects.length ? `${room.effects.length} effect${room.effects.length > 1 ? "s" : ""} sounding` : "",
    broadcasting ? "" : "No bot is in a voice channel: only this computer plays it",
  ].filter(Boolean);

  return (
    <div className={cx("oab-row", "air", paused && "paused")} role="group" aria-label={`${paused ? "Paused" : "On air"}${tagRoom ? `: ${tagRoom}` : ""}`}>
      <span className="oab-dest">
        <DestTag to="air" room={tagRoom} paused={paused} />
        {paused && <span className="badge oab-paused">Paused</span>}
      </span>
      <div className="oab-now">
        <div className="oab-title">
          <span className={cx("lane-dot", laneName === "music" ? "music" : "amb")} aria-hidden="true" />
          <TrackName className="ellipsis" track={{ id: lane.trackId, title: lane.title, metaTitle: "", fileName: "" }} place={lane.place} names={names} />
        </div>
        <div className="oab-from ellipsis" title={[from, ...extras, gainWords(lane.gainDb)].filter(Boolean).join(" · ")}>
          {from}
          {extras.map((extra) => (
            <React.Fragment key={extra}>
              {" · "}
              {extra.startsWith("Ambience: ") && <span className="lane-dot amb" aria-hidden="true" />}
              {extra}
            </React.Fragment>
          ))}
          <GainForScreenReaders db={lane.gainDb} />
        </div>
      </div>
      <Time lane={laneName === "music" ? "music" : "amb"} position={lane.position} length={lane.length} />
      <div className="oab-ctl" role="group" aria-label={`Control what the players hear${where}`}>
        <button
          type="button"
          className="btn s icon"
          aria-label={paused ? "Play" : "Pause"}
          title={`${paused ? `Play the ${word} again` : `Pause the ${word}`}${where}`}
          onClick={() => {
            if (audio.togglePause(laneName, target).ok) say(paused ? "Playing again" : "Paused");
          }}
        >
          <Icon name={paused ? "play" : "pause"} size="s" />
        </button>
        <button
          type="button"
          className="btn s"
          title={`Stop what the players hear${where} (fades out in a second)`}
          onClick={() => {
            audio.stopLane("music", { target, fadeMs: STOP_FADE_MS });
            audio.stopLane("ambience", { target, fadeMs: STOP_FADE_MS });
            say("Stopped");
          }}
        >
          <Icon name="stop" size="s" />
          Stop
        </button>
        <button
          type="button"
          className="btn s icon"
          aria-label="Next"
          title={canNext ? "Next track (crossfade)" : "A single track has no next one"}
          disabled={!canNext}
          onClick={() => audio.next(laneName, target)}
        >
          <Icon name="next" size="s" />
        </button>
        {lane.playlistId && <PlayOrderButton playlistId={lane.playlistId} place={lane.place} />}
      </div>
      <label className="oab-vol" title={`Volume of what the players hear${where}`}>
        <Icon name="volume" size="s" />
        <span className="sr-only">Volume in {room.name}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={VOLUME_STEP}
          value={volume}
          aria-valuetext={`${volume} percent`}
          onChange={(event) => changeVolume(Number(event.currentTarget.value))}
        />
      </label>
      {first && (
        <a className="btn s" href="#/live">
          <Icon name="broadcast" size="s" />
          Go to Live
        </a>
      )}
    </div>
  );
}

/** PLY-15: how the track's volume is evened out where it plays; nothing when it plays as it is (Nik: no words added on screen). */
function gainWords(db: number | undefined): string {
  return db ? `Volume evened out: ${formatGainDb(db)}` : "";
}

/** The hover words for keyboard and screen-reader users too (round 6: nothing on hover only). */
function GainForScreenReaders({ db }: { db: number | undefined }) {
  const words = gainWords(db);
  return words ? <span className="sr-only">{` · ${words}`}</span> : null;
}

function PreviewRow({ audio, preview }: { audio: LyreAudio; preview: PreviewNowPlaying }) {
  const paused = preview.paused;
  const from = preview.from ? `Previewed from ${preview.from}` : "Preview";
  const volume = Math.round(preview.volume * 100);
  return (
    <div className={cx("oab-row", "you", paused && "paused")} role="group" aria-label={`Only you${paused ? ": paused" : ""}`}>
      <span className="oab-dest">
        <DestTag to="you" paused={paused} />
        {paused && <span className="badge oab-paused">Paused</span>}
      </span>
      <div className="oab-now">
        <div className="oab-title" title={preview.label}>
          <span className="lane-dot preview" aria-hidden="true" />
          <span className="ellipsis">{preview.label}</span>
        </div>
        <div className="oab-from ellipsis" title={[from, gainWords(preview.gainDb)].filter(Boolean).join(" · ")}>
          {from}
          <GainForScreenReaders db={preview.gainDb} />
        </div>
      </div>
      <Time lane="preview" position={preview.position} length={preview.length} />
      <div className="oab-ctl" role="group" aria-label="Control your preview">
        <button
          type="button"
          className="btn s icon"
          aria-label={paused ? "Play the preview" : "Pause the preview"}
          title={paused ? "Play the preview again" : "Pause the preview"}
          onClick={() => audio.togglePreviewPause()}
        >
          <Icon name={paused ? "play" : "pause"} size="s" />
        </button>
        <button type="button" className="btn s" aria-label="Stop the preview" title="Stop the preview" onClick={() => audio.stopPreview()}>
          <Icon name="stop" size="s" />
          Stop
        </button>
      </div>
      <label className="oab-vol" title="Volume in your headphones">
        <Icon name="headphones" size="s" />
        <span className="sr-only">Headphone volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={VOLUME_STEP}
          value={volume}
          aria-valuetext={`${volume} percent`}
          onChange={(event) => audio.setPreviewVolume(Number(event.currentTarget.value) / 100)}
        />
      </label>
    </div>
  );
}
