/**
 * UX-16 the Now playing bar (core.js onAirBar, roomRow, previewRow; ui.css .onairbar). Nik: "a universal bar that
 * appears when any music is playing … clearly indicating which output each is going to."
 *
 * At the foot of every screen while anything plays or is paused; gone when everything stops. One row per room that
 * plays music or ambience (effects alone bring up no row: they are short), and one row for the preview, so a preview
 * and music on air show together, as do two rooms. The rows share one grid, so their parts line up.
 *   - A room row: the On air tag (naming the room when there are two or more, "no room" while no bot is in a voice
 *     channel), the track (the scene's name for it, its own name on hover), where it comes from, the ambience under it
 *     and how many effects sound there, the time, Pause/Play, Stop (that room only), Next, Shuffle (the playlist's
 *     own shuffle where it plays from, PLY-13, saved), Repeat (the room's, for what plays now, never saved, PLY-17),
 *     What played (round 7, PLY-1: a sheet with Play again and Play next), that room's volume, and Go to Live on the
 *     first row.
 *   - The preview row: the Only you tag, what previews, where it was previewed from, the time, Pause/Play, Stop and the
 *     headphone volume.
 * In Live (`previewOnly`) the room boxes show what each room hears, so only the preview row shows.
 *
 * Reads the audio host's getNowPlaying() only (names of places and playlists come from the library). When the bar,
 * or the row that held the keyboard focus, goes away (Stop), focus goes to the bar's first control, or to the
 * screen's heading when the whole bar has gone, so keyboard users are not sent back to the top of the page.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_LIBRARY_NORMALISE, normaliseHover, originWords } from "../../common/domain";
import { isRefused } from "../../common/lyre/api";
import { useLyreApi, useLyreQuery, usePlaylists, useTracks } from "../api";
import { useNowPlaying, useOptionalLyreAudio, usePlayPosition, type LaneNowPlaying, type LyreAudio, type MusicOrAmbience, type PlayPositions, type PreviewNowPlaying, type RoomNowPlaying } from "../audio";
import { SeekBar } from "../kit/SeekBar";
import { DestTag } from "../kit/DestTag";
import { Icon } from "../kit/Icon";
import { Dialog } from "../kit/Dialog";
import { usePlaceNames } from "../kit/placeNames";
import { playOrderIn, playOrderStoreOf, usePlayOrders } from "../kit/playOrders";
import { TrackName, trackNameAt, useTrackNames } from "../kit/trackName";
import { cx } from "../kit/cx";
import { useOutputs } from "../outputs/OutputsProvider";
import { roomVolumeControl } from "../outputs/roomVolume";
import { useAnnounce } from "./Announcer";

/** Stop on a room's row fades that room out this fast (the prototype's L.stopLane(…, 1)). */
export const STOP_FADE_MS = 1000;
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

/**
 * The time line and the time. It reads its own position (usePlayPosition: every 250 ms while it plays), so only it
 * redraws as the sound moves on, not the row or the screen (Nik, 0.5.0: it stayed at 0:00 until Pause). Since 0.5.1
 * the line is a seek bar: click, drag or the arrow keys jump the track (kit/SeekBar.tsx).
 */
function Time({ lane, at: pick, length, name, onSeek }: { lane: "music" | "amb" | "preview"; at: (positions: PlayPositions) => number | null; length: number | null; name: string; onSeek: (seconds: number) => void }) {
  const at = usePlayPosition(pick) ?? 0;
  return (
    <div className="oab-time">
      <SeekBar name={name} position={at} length={length} lane={lane} onSeek={onSeek} />
      <span className="num" aria-hidden="true">
        {length ? `${clockTime(at)} / ${clockTime(length)}` : clockTime(at)}
      </span>
    </div>
  );
}

/**
 * PLY-15: how much a track's volume is evened out where it plays (its playlist's choice applies), for the hover on its
 * name in a row; words from the domain's normaliseHover.
 */
function useNormaliseHover(): (trackId: string | null, playlistId: string | null) => string | undefined {
  const tracks = useTracks().data;
  const playlists = usePlaylists().data;
  const library = useLyreQuery("normalise-settings", (api) => api.library.normaliseSettings(), ["tracks"]).data ?? DEFAULT_LIBRARY_NORMALISE;
  const byId = useMemo(() => new Map((tracks ?? []).map((t) => [t.id, t])), [tracks]);
  return useCallback(
    (trackId, playlistId) => {
      if (!tracks || !trackId) return undefined;
      return normaliseHover(byId.get(trackId), playlistId ? playlists?.find((p) => p.id === playlistId) : null, library);
    },
    [tracks, byId, playlists, library],
  );
}

function RoomRow({ audio, room, named, broadcasting, first }: { audio: LyreAudio; room: RoomNowPlaying; named: boolean; broadcasting: boolean; first: boolean }) {
  const { say } = useAnnounce();
  const places = usePlaceNames();
  const names = useTrackNames();
  const playlists = usePlayOrders()?.playlists;
  const hoverOf = useNormaliseHover();
  const laneName: MusicOrAmbience = room.music ? "music" : "ambience";
  const lane = (room.music ?? room.ambience) as LaneNowPlaying;
  const paused = lane.paused;
  const word = laneName === "music" ? "music" : "ambience";
  const where = broadcasting ? ` in ${room.name}` : "";
  const target = { room: room.roomId };
  const playlistName = lane.playlistId ? (playlists?.get(lane.playlistId)?.name ?? null) : null;
  const from = originWords({ place: lane.place, playlistName }, places);
  const canNext = lane.origin.kind !== "single";
  // One room volume: the bot's own (kept by the main process, the same slider as on Outputs and in Live). The table,
  // and a page without the Outputs bridge (tests), use the audio host's room level (roomVolume.ts).
  const { outputs, client } = useOutputs();
  const bot = outputs?.bots.find((b) => b.id === room.roomId) ?? null;
  const { volume, change: changeVolume } = roomVolumeControl({ roomId: room.roomId, level: room.volume }, bot, client, audio);
  // UX-R9 (round 6 part 4 #10): a room nobody is in is tagged "On air · nobody there", in the warning colour.
  const channel = bot?.room?.status === "connected" ? outputs?.servers.flatMap((s) => s.channels).find((c) => c.id === bot.room!.channelId) : undefined;
  const nobody = !!channel && channel.members.length === 0;
  const tagRoom = !broadcasting ? "no room" : nobody ? "nobody there" : named ? room.name : undefined;
  const extras = [
    room.music && room.ambience ? `Ambience: ${room.ambience.title}` : "",
    room.effects.length ? `${room.effects.length} effect${room.effects.length > 1 ? "s" : ""} sounding` : "",
    // BUG-19: the players' sound goes only to Discord, so with no bot in a voice channel nobody hears it.
    broadcasting ? "" : "No bot is in a voice channel: nobody hears it",
  ].filter(Boolean);

  return (
    <div className={cx("oab-row", "air", paused && "paused")} role="group" aria-label={`${paused ? "Paused" : "On air"}${nobody ? `: ${room.name}, nobody there` : tagRoom ? `: ${tagRoom}` : ""}`}>
      <span className="oab-dest">
        <DestTag to="air" room={tagRoom} paused={paused} nobody={nobody ? `Nobody hears it: nobody is in ${room.name}` : undefined} />
        {paused && <span className="badge oab-paused">Paused</span>}
      </span>
      <div className="oab-now">
        <div className="oab-title">
          <span className={cx("lane-dot", laneName === "music" ? "music" : "amb")} aria-hidden="true" />
          <TrackName className="ellipsis" track={{ id: lane.trackId, title: lane.title, metaTitle: "", fileName: "" }} place={lane.place} names={names} hover={hoverOf(lane.trackId, lane.playlistId)} />
        </div>
        <div className="oab-from ellipsis" title={[from, ...extras].join(" · ")}>
          {from}
          {extras.map((extra) => (
            <React.Fragment key={extra}>
              {" · "}
              {extra.startsWith("Ambience: ") && <span className="lane-dot amb" aria-hidden="true" />}
              {extra}
            </React.Fragment>
          ))}
        </div>
      </div>
      <Time
        lane={laneName === "music" ? "music" : "amb"}
        at={(p) => p.rooms[room.roomId]?.[laneName] ?? null}
        length={lane.length}
        name={lane.title}
        onSeek={(seconds) => audio.seek(laneName, seconds, target)}
      />
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
        {lane.playlistId && <ShuffleButton playlistId={lane.playlistId} place={lane.place} />}
        {room.music && <RepeatButton audio={audio} room={room} where={where} />}
        <WhatPlayed audio={audio} room={room} named={named} />
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

/** PLY-13: the playlist's shuffle where it plays from; it is its play order there, so it is saved. */
function ShuffleButton({ playlistId, place }: { playlistId: string; place: LaneNowPlaying["place"] }) {
  const api = useLyreApi();
  const data = usePlayOrders();
  const { say, toast } = useAnnounce();
  if (!data?.playlists.has(playlistId)) return null;
  const { order } = playOrderIn(data, playlistId, place);
  const toggle = async () => {
    const next = { ...order, shuffle: !order.shuffle };
    const store = playOrderStoreOf(api);
    store.put(playlistId, place, next);
    const result = await api.playlists.setPlayOrder(playlistId, place, next);
    if (isRefused(result)) {
      toast(result.refusal.message);
      store.load();
      return;
    }
    say(next.shuffle ? "Shuffle on" : "Shuffle off");
  };
  return (
    <button type="button" className={cx("btn s icon rep", order.shuffle && "on")} aria-pressed={order.shuffle} aria-label="Shuffle" title={`Shuffle ${order.shuffle ? "on" : "off"}`} onClick={() => void toggle()}>
      <Icon name={order.shuffle ? "shuffle" : "inorder"} size="s" />
    </button>
  );
}

const REPEAT_WORDS = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" } as const;
const REPEAT_NEXT = { off: "repeat all", all: "repeat one", one: "no repeat" } as const;

/** PLY-17 (Nik, 6 Nov 12:24): the room's Repeat, for what plays now; never saved; off again when the music stops. */
function RepeatButton({ audio, room, where }: { audio: LyreAudio; room: RoomNowPlaying; where: string }) {
  const { say } = useAnnounce();
  const shown = room.repeat.shown;
  return (
    <button
      type="button"
      className={cx("btn s icon rep", shown !== "off" && "on")}
      aria-pressed={shown !== "off"}
      aria-label={REPEAT_WORDS[shown]}
      title={`${REPEAT_WORDS[shown]}, for what plays now${where} (not saved). Press for ${REPEAT_NEXT[shown]}`}
      onClick={() => {
        audio.cycleRepeat({ room: room.roomId });
        say(`${REPEAT_WORDS[shown === "off" ? "all" : shown === "all" ? "one" : "off"]}, for what plays now`);
      }}
    >
      <Icon name={shown === "one" ? "repeat1" : "loop"} size="s" />
    </button>
  );
}

/** "Now", "2 min ago". */
function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? "Now" : `${minutes} min ago`;
}

/**
 * Round 7 (PLY-1): what played in this room tonight, newest first, in a sheet (prep screens only: Live shows it in the
 * room itself), each with Play again (as it came: its scene step or playlist) and Play next. Shown on hover and focus.
 */
function WhatPlayed({ audio, room, named }: { audio: LyreAudio; room: RoomNowPlaying; named: boolean }) {
  const [open, setOpen] = useState(false);
  const { say } = useAnnounce();
  const names = useTrackNames();
  const target = { room: room.roomId };
  const title = `What played${named ? ` in ${room.name}` : ""}`;
  const nameOf = (x: RoomNowPlaying["played"][number]) => {
    const place = x.from && "scene" in x.from ? ({ kind: "scene", ...x.from.scene } as const) : x.from && "place" in x.from ? (x.from.place ?? null) : null;
    return trackNameAt({ id: x.trackId, title: x.title, metaTitle: "", fileName: "" }, place, names).name;
  };
  return (
    <>
      <button type="button" className="btn s icon r7-hov" aria-label="What played" title={`${title}, with Play again`} onClick={() => setOpen(true)}>
        <Icon name="history" size="s" />
      </button>
      <Dialog
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Close
          </button>
        }
      >
        {room.played.length ? (
          <ol className="list r7-played" aria-label="Played, newest first">
            {room.played.map((x, i) => {
              const name = nameOf(x);
              return (
                <li className="lrow" key={`${x.trackId}-${x.at}-${i}`}>
                  <span className="grow ellipsis" title={x.title}>
                    {name}
                  </span>
                  <span className="faint num">{ago(x.at)}</span>
                  <button
                    type="button"
                    className="btn s"
                    aria-label={`Play again: ${name}`}
                    onClick={() => {
                      setOpen(false);
                      audio.playTrack(x.trackId, { target, ...(x.from ? { from: x.from as never } : {}) });
                    }}
                  >
                    <Icon name="playair" size="s" />
                    Play again
                  </button>
                  <button
                    type="button"
                    className="btn s ghost"
                    aria-label={`Play next: ${name}`}
                    onClick={() => {
                      setOpen(false);
                      audio.playNext({ kind: "track", trackId: x.trackId, ...(x.from ? { from: x.from as never } : {}), name }, { target });
                      say(`Plays next: ${name}`);
                    }}
                  >
                    <Icon name="next" size="s" />
                    Play next
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="empty">Nothing has played here yet.</p>
        )}
      </Dialog>
    </>
  );
}

function PreviewRow({ audio, preview }: { audio: LyreAudio; preview: PreviewNowPlaying }) {
  const paused = preview.paused;
  const hover = useNormaliseHover()(preview.trackId, preview.kind === "pad" ? null : preview.playlistId);
  const from = preview.from ? `Previewed from ${preview.from}` : "Preview";
  const volume = Math.round(preview.volume * 100);
  return (
    <div className={cx("oab-row", "you", paused && "paused")} role="group" aria-label={`Only you${paused ? ": paused" : ""}`}>
      <span className="oab-dest">
        <DestTag to="you" paused={paused} />
        {paused && <span className="badge oab-paused">Paused</span>}
      </span>
      <div className="oab-now">
        <div className="oab-title" title={hover ? `${preview.label} · ${hover}` : preview.label}>
          <span className="lane-dot preview" aria-hidden="true" />
          <span className="ellipsis">{preview.label}</span>
          {hover && <span className="sr-only"> · {hover}</span>}
        </div>
        <div className="oab-from ellipsis" title={from}>
          {from}
        </div>
      </div>
      <Time lane="preview" at={(p) => p.preview} length={preview.length} name={preview.label} onSeek={(seconds) => audio.seekPreview(seconds)} />
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
