/**
 * On air (live.js onAir, roomPart, laneBlock, upNextBlock; round 6 parts 3 and 6): one box at the top of Live, the
 * whole width, always in view, with a part per room (each bot in a voice channel). A room's part: its name and one
 * status, What played (round 7, PLY-1), Mute, its volume, its bot as a button that changes the channel or the bot
 * (OUT-7), and Kick; then its music (with where it comes from, Previous, Pause, Next, Repeat for what plays now and
 * never saved, PLY-17, and Fade), its ambience, the effects sounding, and Up next (PLY-16), the room's running list for
 * the evening. BUG-19: with no bot in a voice channel the part is "No room", which says nobody hears it and offers the
 * one-click Join; Must 2: a room nobody is in says so and offers Move to where the players are. Must 4: in a window
 * under 480 px high each room is one line and opens on demand. Everything shown comes from getNowPlaying().
 */
import React, { useEffect, useRef, useState } from "react";

import { normaliseHover, type UsePlace } from "../../../common/domain";
import { usePlayPosition } from "../../audio";
import type { LaneNowPlaying, MusicOrAmbience, RoomNowPlaying, UpNextEntryNow } from "../../audio/lyreAudio";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { SeekBar } from "../../kit/SeekBar";
import { StatusPill } from "../../kit/Pills";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { trackNameAt } from "../../kit/trackName";
import { cx } from "../../kit/cx";
import { restoreRoom } from "../../outputs/roomRestore";
import { roomVolumeControl } from "../../outputs/roomVolume";
import { useAnnounce } from "../../shell/Announcer";
import { clockTime, STOP_FADE_MS } from "../../shell/NowPlayingBar";
import { formatLength } from "../campaigns/model";
import { busiestChannel as moveToChannel, kickLosesSound, moveLosesSound, roomToRestore, viewOf } from "../outputs/outputsModel";
import { clearAdded, FADE_BUTTON_MS, LIVE_FADE_MS, nextInRoom, takeOut } from "./liveActions";
import { laneProfile, sceneSteps, showLibraryOf, useLive, type LiveData } from "./liveData";
import { addRoomChoices, busiestChannel, channelChoices, endWords, noRoomStatus, roomStatus, TABLE, UNDO_MS, upNextRows, type LiveRoom } from "./liveModel";
import { offerSoftUndo, touched, updateLive } from "./liveState";
import { focusLive, focusLiveSoon } from "./focus";
import { useFoldedSummary } from "./Scenes";
import { SoftUndoStrip } from "./UndoStrips";

/** Must 4: under this height of window (1280×800 at 200 %), each room is one line. */
const SHORT_WINDOW_PX = 480;
/** PLY-1: What played shows this many, newest first. */
const PLAYED_SHOWN = 6;

function useShortWindow(): boolean {
  const [short, setShort] = useState(() => window.innerHeight < SHORT_WINDOW_PX);
  useEffect(() => {
    const update = () => setShort(window.innerHeight < SHORT_WINDOW_PX);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return short;
}

/** A room's id as part of a data-lv or an element id. */
const lk = (roomId: string) => roomId.replace(/[^\w-]/g, "-");

export function OnAirPane({ undo }: { undo: () => boolean }) {
  const d = useLive();
  const { rooms, now, outputs } = d;
  const short = useShortWindow();
  const table = now.rooms.find((r) => r.roomId === TABLE) ?? now.rooms[0] ?? null;
  const canAdd = addRoomChoices(outputs).length > 0;
  const words = (rooms.length ? rooms.map((r) => ({ name: r.name, music: r.room?.music })) : [{ name: "No room", music: table?.music }]).map((r) => `${r.name}: ${r.music ? r.music.title : "silent"}`).join(" · ");
  const summary = useFoldedSummary("lv-onair", true, <span className="ellipsis" title={words}>{words}</span>);
  return (
    <div className="lv-dock">
      <Pane id="lv-onair" title="On air" icon="broadcast" kind="onair" size="auto" flush noMax keys="Alt+1" actions={canAdd ? <AddRoom /> : undefined} summary={summary}>
        <SoftUndoStrip where="onair" onUndo={undo} />
        <div className={cx("lv-rooms", rooms.length > 1 && "many")}>
          {rooms.length ? rooms.map((r) => <RoomPart key={r.roomId} r={r} short={short} undo={undo} />) : <NoRoomPart table={table} short={short} />}
        </div>
      </Pane>
    </div>
  );
}

/** BUG-19: no bot in a voice channel: what plays goes nowhere (Lyre never plays it on this computer). */
function NoRoomPart({ table, short }: { table: RoomNowPlaying | null; short: boolean }) {
  const { outputs, client } = useLive();
  const { toast } = useAnnounce();
  const status = noRoomStatus(table);
  const joining = outputs?.bots.some((b) => b.room?.status === "joining") ?? false;
  const bot = outputs?.bots.find((b) => b.login === "ready" && !b.room);
  const best = busiestChannel(outputs);
  return (
    <div className="lv-rm is-silent" role="group" aria-labelledby="lv-rm-h-none">
      <div className="lv-rm-h">
        <h3 id="lv-rm-h-none" className="lv-rm-n ellipsis">
          No room
        </h3>
        <StatusPill text={status.text} tone={status.tone} />
        <span className="grow" />
      </div>
      <div className="lv-noroom" role="status">
        <Icon name="broadcast" size="s" />
        <span className="grow">{joining ? "Joining…" : "No bot is in a voice channel: players hear nothing"}</span>
        {client && bot && best && !joining && (
          <button
            type="button"
            className="btn s lv-fix"
            data-lv="fix"
            title={`${bot.name} joins ${best.serverName} › ${best.name} (${best.people} there)`}
            onClick={() => {
              client.move(bot.id, best.channelId);
              toast(`${bot.name} is joining ${best.name}`);
            }}
          >
            Join {best.name}
          </button>
        )}
      </div>
      {!short && table && (table.music || table.ambience) && (
        <div className="lv-rm-b">
          <div className="lv-rm-lanes">
            <Lane lane="music" room={table} roomName="No room" />
            <Lane lane="ambience" room={table} roomName="No room" />
          </div>
        </div>
      )}
    </div>
  );
}

function RoomPart({ r, short, undo }: { r: LiveRoom; short: boolean; undo: () => boolean }) {
  const d = useLive();
  const { names, index, state } = d;
  const status = roomStatus(r);
  const room = r.room;
  const k = lk(r.roomId);
  const headId = `lv-rm-h-${k}`;
  const open = !!state.rmOpen[r.roomId];
  const toggleOpen = () => {
    updateLive((s) => ({ rmOpen: { ...s.rmOpen, [r.roomId]: !open } }));
    focusLive(`rmopen-${k}`);
  };
  if (short && !open) {
    const lane = room?.music ?? room?.ambience ?? null;
    const laneWord: MusicOrAmbience = room?.music ? "music" : "ambience";
    const track = lane ? index.track(lane.trackId) : undefined;
    const name = lane ? (track ? trackNameAt(track, lane.place, names).name : lane.title) : "";
    return (
      <div className={cx("lv-rm lv-rm-1", status.text !== "Playing" && "is-silent")} role="group" aria-labelledby={headId}>
        <div className="lv-rm-h">
          <button type="button" className="xp-btn" data-lv={`rmopen-${k}`} aria-expanded={false} aria-label={`Show everything in ${r.name}`} title={`Show everything in ${r.name}`} onClick={toggleOpen}>
            <Icon name="chevdown" size="s" />
          </button>
          <h3 id={headId} className="lv-rm-n ellipsis" title={r.name}>
            {r.name}
          </h3>
          <StatusPill text={status.text} tone={status.tone} />
          <span className="ellipsis grow lv-rm-t" title={name || undefined}>
            {name}
          </span>
          {lane && (
            <button
              type="button"
              className="btn s icon"
              aria-label={`${lane.paused ? "Resume" : "Pause"} ${laneWord}`}
              title={lane.paused ? "Resume" : "Pause"}
              onClick={() => {
                touched();
                d.audio.togglePause(laneWord, { room: r.roomId });
              }}
            >
              <Icon name={lane.paused ? "play" : "pause"} size="s" />
            </button>
          )}
        </div>
        <SoftUndoStrip where={`room:${r.roomId}`} onUndo={undo} />
      </div>
    );
  }
  const fx = room?.effects ?? [];
  const waiting = state.aq[r.roomId] ?? [];
  const showUp = !!room?.music || waiting.length > 0;
  return (
    <div className={cx("lv-rm", status.text !== "Playing" && "is-silent")} role="group" aria-labelledby={headId} title={d.rooms.length > 1 ? `To play in ${r.name}, choose To: ${r.name} in a box` : undefined}>
      <div className="lv-rm-h">
        {short && (
          <button type="button" className="xp-btn" data-lv={`rmopen-${k}`} aria-expanded aria-label={`Show everything in ${r.name}`} title={`Show one line for ${r.name}`} onClick={toggleOpen}>
            <Icon name="chevdown" size="s" />
          </button>
        )}
        <h3 id={headId} className="lv-rm-n ellipsis" title={r.name}>
          {r.name}
        </h3>
        <StatusPill text={status.text} tone={status.tone} />
        <span className="grow" />
        <PlayedButton r={r} />
        <RoomControls r={r} />
      </div>
      {r.nobody && r.view && <NobodyThere r={r} />}
      <PlayedList r={r} />
      {(room?.music || room?.ambience || fx.length > 0 || showUp) && (
        <div className="lv-rm-b">
          <div className="lv-rm-lanes">
            <Lane lane="music" room={room} roomName={r.name} />
            <Lane lane="ambience" room={room} roomName={r.name} />
            {fx.length > 0 && <Effects room={room!} roomName={r.name} />}
          </div>
          {showUp && (
            <div className="lv-rm-up">
              <UpNext roomId={r.roomId} room={room} />
            </div>
          )}
        </div>
      )}
      <SoftUndoStrip where={`room:${r.roomId}`} onUndo={undo} />
    </div>
  );
}

/** Must 2: a room nobody is in: the one-click fix moves its bot to where the players are. */
function NobodyThere({ r }: { r: LiveRoom }) {
  const d = useLive();
  const view = r.view!;
  const to = d.outputs ? moveToChannel(viewOf(d.outputs), view) : null;
  const move = useMoveBot();
  return (
    <div className="lv-noroom" role="status">
      <Icon name="warn" size="s" />
      {/* UX-R9: the room's status says Nobody there; this line says what it means. */}
      <span className="grow">Players hear nothing</span>
      {to && (
        <button type="button" className="btn s lv-fix" title={`${view.bot.name} moves to ${to.where} (${to.people} people)`} onClick={() => move(r, to.channelId)}>
          Move to {to.name}
        </button>
      )}
    </div>
  );
}

/**
 * Must 2 (b): moving a bot from the room's menu takes one click and asks nothing, so it gets the same 8-second Undo as
 * Kick when the players there were hearing something.
 */
function useMoveBot(): (r: LiveRoom, channelId: string) => void {
  const d = useLive();
  const { say, toast } = useAnnounce();
  return (r, channelId) => {
    const view = r.view;
    const client = d.client;
    if (!view || !client || !d.outputs) return;
    const channel = d.outputs.servers.flatMap((s) => s.channels).find((c) => c.id === channelId);
    const to = channel?.name ?? "another channel";
    const back = view.bot.room?.channelId;
    const lost = back !== undefined && moveLosesSound(view, r.room ?? undefined, channelId);
    touched();
    client.move(view.bot.id, channelId);
    if (lost && back) {
      offerSoftUndo({ text: `${view.bot.name} moved from ${r.name} to ${to}`, where: `room:${r.roomId}`, focus: `room-${lk(r.roomId)}`, restore: () => client.move(view.bot.id, back) }, UNDO_MS);
      say(`${view.bot.name} is joining ${to}. Undo is available for 8 seconds, or press Ctrl+Z.`);
    } else toast(`${view.bot.name} is joining ${to}`);
  };
}

/** Mute, the volume, the room's bot (a button with its menu) and Kick, in the room's header. */
function RoomControls({ r }: { r: LiveRoom }) {
  const d = useLive();
  const { client, audio } = d;
  const { say, toast } = useAnnounce();
  const bot = r.bot;
  const volume = roomVolumeControl({ roomId: r.roomId, level: r.room?.volume ?? 1 }, bot, client, audio);
  const kick = () => {
    const view = r.view;
    if (!client || !view?.channel) return;
    touched();
    // OUT-7: Kick never asks; Undo puts the bot back with what it played when the players were hearing it.
    const restore = kickLosesSound(view, r.room ?? undefined) ? roomToRestore(view, r.room ?? undefined) : null;
    client.leave(view.bot.id);
    if (restore) {
      offerSoftUndo(
        {
          text: `${view.bot.name} left ${r.name}`,
          where: "onair",
          // UX-R4: after Undo, focus goes back to the room's bot button once the bot has rejoined.
          focus: `room-${lk(r.roomId)}`,
          restore: () => {
            void restoreRoom(restore, { client, audio }).then((back) => {
              if (!back) toast(`${view.bot.name} could not go back to ${r.name}. Add it there again from Rooms.`);
            });
          },
        },
        UNDO_MS,
      );
      say(`${view.bot.name} left ${r.name}. Undo is available for 8 seconds, or press Ctrl+Z.`);
      focusLive("undo2");
    } else {
      say(`${view.bot.name} left ${r.name}`);
      focusLiveSoon(["addroom", "nextsc"]);
    }
  };
  return (
    <>
      {bot && client && (
        <button
          type="button"
          className="btn s icon lv-mute"
          aria-pressed={bot.muted}
          aria-label={`Mute ${r.name}`}
          title={`${bot.muted ? "Unmute" : "Mute"} ${r.name}`}
          onClick={() => {
            touched();
            client.setMuted(bot.id, !bot.muted);
            say(`${r.name} ${bot.muted ? "unmuted" : "muted"}`);
          }}
        >
          <Icon name={bot.muted ? "mute" : "horn"} size="s" />
        </button>
      )}
      <RoomVolume name={r.name} saved={volume.volume} onChange={volume.change} />
      {bot && client && <BotButton r={r} />}
      {bot && client && r.view?.channel && (
        <button type="button" className="btn s lv-kick" data-lv={`kick-${lk(r.roomId)}`} aria-label={`Kick ${bot.name} from ${r.name}`} title={`Kick ${bot.name} from ${r.name}`} onClick={kick}>
          <Icon name="leave" size="s" />
          <span className="lv-kick-t">Kick</span>
        </button>
      )}
    </>
  );
}

/** The thumb follows at once; the saved volume comes back from the main process a moment later. */
function RoomVolume({ name, saved, onChange }: { name: string; saved: number; onChange: (value: number) => void }) {
  const [shown, setShown] = useState(saved);
  const lastMove = useRef(0);
  useEffect(() => {
    if (Date.now() - lastMove.current > 400) setShown(saved);
  }, [saved]);
  return (
    <input
      type="range"
      className="lv-vol"
      min={0}
      max={100}
      step={5}
      value={shown}
      aria-label={`Volume in ${name}`}
      aria-valuetext={`${shown} percent`}
      title={`Volume ${shown}%`}
      onChange={(event) => {
        const value = Number(event.target.value);
        lastMove.current = Date.now();
        setShown(value);
        touched();
        onChange(value);
      }}
    />
  );
}

/**
 * OUT-7: the room's bot, as a button: the channel it plays in (one click moves it), another bot for this channel, copy
 * what another room plays, the Rooms screen, and Settings for bots and tokens.
 */
function BotButton({ r }: { r: LiveRoom }) {
  const d = useLive();
  const { rooms, outputs, client, audio } = d;
  const { say } = useAnnounce();
  const move = useMoveBot();
  const bot = r.bot!;
  const items = (): PopMenuEntry[] => {
    const entries: PopMenuEntry[] = [];
    if (outputs && client) {
      entries.push({ group: `${bot.name} plays in` });
      for (const { server, items: channels } of channelChoices(outputs, bot)) {
        entries.push({ group: server });
        for (const c of channels) {
          entries.push({
            key: c.channelId,
            role: "menuitemradio",
            checked: c.here,
            disabled: c.here || c.taken,
            content: (
              <>
                {c.here ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
                <span className="grow ellipsis">{c.name}</span> <span className="faint">{c.sub}</span>
              </>
            ),
            onSelect: () => move(r, c.channelId),
          });
        }
      }
      const free = addRoomChoices(outputs).map((x) => x.bot);
      if (free.length) {
        entries.push({ separator: true }, { group: `Another bot for ${r.name}` });
        for (const f of free) {
          entries.push({
            key: `swap-${f.id}`,
            content: (
              <>
                <Icon name="users" size="s" />
                {f.name}
              </>
            ),
            onSelect: () => {
              const view = r.view;
              if (!view?.bot.room) return;
              touched();
              // Another bot takes over this channel: the old one leaves, the new one joins, and what played goes on.
              const what = roomToRestore(view, r.room ?? undefined);
              client.leave(bot.id);
              if (what) void restoreRoom({ ...what, botId: f.id }, { client, audio });
              say(`${f.name} now plays in ${r.name}`);
            },
          });
        }
      }
      entries.push({ separator: true });
    }
    for (const other of rooms.filter((x) => x.roomId !== r.roomId && (x.room?.music || x.room?.ambience))) {
      entries.push({
        key: `copy-${other.roomId}`,
        content: (
          <>
            <Icon name="loop" size="s" />
            Copy what {other.name} is playing
          </>
        ),
        onSelect: () => {
          touched();
          copyRoom(d, other.room!, r.roomId);
          say(`${r.name} now plays what ${other.name} plays`);
        },
      });
    }
    entries.push(
      {
        key: "rooms",
        content: (
          <>
            <Icon name="users" size="s" />
            Rooms
          </>
        ),
        onSelect: () => (window.location.hash = "#/outputs"),
      },
      {
        key: "settings",
        content: (
          <>
            <Icon name="gear" size="s" />
            Bots and tokens
          </>
        ),
        onSelect: () => (window.location.hash = "#/settings"),
      },
    );
    return entries;
  };
  return (
    <PopMenuButton
      label={`Room ${r.name}`}
      className="btn s lv-botpick"
      ariaLabel={`${bot.name} in ${r.name}: change`}
      title={`${bot.name} plays in ${r.name}: change the channel or the bot`}
      dataK={`room-${lk(r.roomId)}`}
      items={items}
    >
      <Icon name="users" size="s" />
      <span className="ellipsis">{bot.name}</span>
      <Icon name="chevdown" size="s" />
    </PopMenuButton>
  );
}

/**
 * Copy: the other room's music and ambience start here from the same place (scene step or playlist) and the same
 * point in the track, so Next goes on the same way.
 */
function copyRoom(d: LiveData, from: RoomNowPlaying, to: string) {
  const target = { room: to };
  for (const [lane, playing] of [
    ["music", from.music],
    ["ambience", from.ambience],
  ] as const) {
    if (!playing) {
      d.audio.stopLane(lane, { target, fadeMs: 2000 });
      continue;
    }
    const o = playing.origin;
    const source = o.kind === "scene" ? { scene: o.scene, at: o.at } : o.kind === "playlist" ? { playlistId: o.playlistId, ...(o.place ? { place: o.place } : {}) } : undefined;
    d.audio.playTrack(playing.trackId, { target, from: source, fadeMs: 2000, ...(playing.position !== null ? { fromMs: Math.round(playing.position * 1000) } : {}) });
  }
}

/** The name a room shows for what it plays: its place's name for it (DAT-14), and its own name. */
function laneName(d: LiveData, roomId: string, playing: LaneNowPlaying): { name: string; own: string } {
  const track = d.index.track(playing.trackId);
  if (!track) return { name: playing.title, own: playing.title };
  const remembered = d.state.airNames[roomId];
  const place: UsePlace | null = playing.place ?? (remembered && remembered.trackId === playing.trackId && playing.origin.kind === "single" ? remembered.place : null);
  return trackNameAt(track, place, d.names);
}

/**
 * A lane's progress line with its markers, and the time. It reads its own position (usePlayPosition: every 250 ms
 * while it plays), so only it redraws as the sound moves on, not the On air box (Nik, 0.5.0: the time stood still).
 */
function LaneTime({ roomId, lane, length, markers, name }: { roomId: string; lane: MusicOrAmbience; length: number | null; markers: readonly { atMs: number; label: string; mix?: boolean }[]; name: string }) {
  const { audio } = useLive();
  const position = usePlayPosition((at) => at.rooms[roomId]?.[lane] ?? null);
  const isMusic = lane === "music";
  // 0.5.1 (Nik, 11 Nov): the bar is a seek bar (kit/SeekBar.tsx): click, drag or the arrow keys jump in this room.
  return (
    <div className="lv-lane-pr">
      <SeekBar
        name={name}
        position={position}
        length={length}
        lane={isMusic ? "music" : "amb"}
        barClassName="lv-mkbar"
        onSeek={(seconds) => {
          touched();
          audio.seek(lane, seconds, { room: roomId });
        }}
      >
        {length &&
          markers.map((m) => <i key={`${m.atMs}-${m.label}`} className={cx("lv-mk", m.mix && "mix")} style={{ left: `${(m.atMs / 1000 / length) * 100}%` }} title={`${m.label} ${formatLength(m.atMs)}`} />)}
      </SeekBar>
      <span className="num lv-time" aria-hidden="true">
        {position !== null ? `${clockTime(position)}${length ? ` / ${clockTime(length)}` : ""}` : "…"}
      </span>
    </div>
  );
}

/** One lane: its name, the track, its progress with markers, the time and its controls; the music adds its playlist. */
function Lane({ lane, room, roomName }: { lane: MusicOrAmbience; room: RoomNowPlaying | null; roomName: string }) {
  const d = useLive();
  const { audio, index, overrides, campaigns, orders, state } = d;
  const playing: LaneNowPlaying | null = (lane === "music" ? room?.music : room?.ambience) ?? null;
  if (!playing || !room) return null;
  const isMusic = lane === "music";
  const word = isMusic ? "Music" : "Ambience";
  const target = { room: room.roomId };
  const shown = laneName(d, room.roomId, playing);
  const track = index.track(playing.trackId);
  const resolved = laneProfile(playing, index, overrides);
  // PLY-15: how its volume is evened out where it plays, on hover only (Nik: no added words on screen).
  const volumeHover = normaliseHover(track, playing.playlistId ? index.playlist(playing.playlistId) : null, d.normalise);
  const single = playing.origin.kind === "single";
  let pos = "";
  if (isMusic && playing.origin.kind === "scene") {
    const o = playing.origin;
    const lib = showLibraryOf(index, campaigns, overrides, orders);
    const step = sceneSteps(lib, o.scene, o.seed ?? 0)[o.at];
    const n = lib.scene(o.scene)?.music.length ?? 0;
    if (step) pos = `Item ${step.itemIndex + 1} of ${n}`;
  }
  const waiting = state.aq[room.roomId] ?? [];
  const canNext = !single || (isMusic && room.upNextList.length > 0) || (!isMusic && waiting.length > 0);
  // Where the music comes from: its playlist. What comes next is Up next, beside it.
  const sub = isMusic && playing.playlistId ? (index.playlist(playing.playlistId)?.name ?? "") : "";
  const endText = isMusic && resolved ? endWords(resolved.profile, resolved.source) : "";
  // The time runs to where the track ends here (its audio profile's End), as in the prototype; the file's own length
  // only when the profile does not know one.
  const length = resolved && resolved.profile.endMs > 0 ? resolved.profile.endMs / 1000 : playing.length;
  // Round 7 part 2 (DAT-3): the track's markers as ticks on its progress line; their names are hover text.
  const markers = resolved && length ? resolved.profile.markers.filter((m) => m.atMs > 0 && m.atMs < length * 1000) : [];
  const title = [shown.name !== shown.own ? `Its own name: ${shown.own}` : shown.own, pos, endText, volumeHover].filter(Boolean).join(" · ");
  const lv = lk(room.roomId);
  return (
    <div className={cx("lv-lane", isMusic ? "lv-m" : "lv-a")}>
      <div className="lv-lane-l">
        <span className="lv-lane-n">
          <span className={cx("lane-dot", isMusic ? "music" : "amb")} />
          {word}
        </span>
        {playing.paused && <span className="badge">Paused</span>}
      </div>
      <div className="lv-lane-m">
        <div className="lv-lane-t ellipsis" title={title}>
          {shown.name}
          {shown.name !== shown.own && <span className="sr-only"> (its own name: {shown.own})</span>}
          {pos && <span className="sr-only">, {pos}</span>}
        </div>
        <LaneTime roomId={room.roomId} lane={lane} length={length} markers={markers} name={shown.name} />
        {sub && (
          <div className="lv-lane-sub ellipsis" title={sub}>
            {sub}
          </div>
        )}
      </div>
      <div className="lv-lane-c" role="group" aria-label={`${word} in ${roomName}`}>
        {isMusic && (
          <button
            type="button"
            className="btn s icon"
            data-lv={`prev-m-${lv}`}
            aria-label="Previous music track"
            title="Previous track"
            disabled={single && !room.upNextList.length}
            onClick={() => {
              touched();
              audio.previous("music", target);
            }}
          >
            <Icon name="prev" size="s" />
          </button>
        )}
        <button
          type="button"
          className="btn s icon"
          data-lv={`pause-${lane}-${lv}`}
          aria-label={`${playing.paused ? "Resume" : "Pause"} ${word.toLowerCase()}`}
          title={`${playing.paused ? "Resume" : "Pause"} ${word.toLowerCase()}`}
          onClick={() => {
            touched();
            audio.togglePause(lane, target);
          }}
        >
          <Icon name={playing.paused ? "play" : "pause"} size="s" />
        </button>
        {/* 0.5.1 (Nik, 11 Nov): Stop beside Pause, as in the Now playing bar (a quick fade; Fade out is the slow one). */}
        <button
          type="button"
          className="btn s icon"
          data-lv={`stop-${lane}-${lv}`}
          aria-label={`Stop ${word.toLowerCase()}`}
          title={`Stop ${word.toLowerCase()} (fades out in a second)`}
          onClick={() => {
            touched();
            audio.stopLane(lane, { target, fadeMs: STOP_FADE_MS });
          }}
        >
          <Icon name="stop" size="s" />
        </button>
        <button
          type="button"
          className="btn s icon"
          data-lv={`next-${lane}-${lv}`}
          aria-label={`Next ${word.toLowerCase()} track`}
          title={`Next ${isMusic ? "track" : "ambience"} (crossfade)`}
          disabled={!canNext}
          onClick={() => nextInRoom(d, lane, room.roomId)}
        >
          <Icon name="next" size="s" />
        </button>
        {isMusic && <ShuffleButton room={room} roomName={roomName} />}
        {isMusic && <RepeatButton room={room} roomName={roomName} />}
        <button
          type="button"
          className="btn s icon"
          aria-label={`Fade ${word.toLowerCase()} out`}
          title={`Fade ${word.toLowerCase()} out over ${FADE_BUTTON_MS / 1000} seconds`}
          onClick={() => {
            touched();
            audio.stopLane(lane, { target, fadeMs: FADE_BUTTON_MS });
          }}
        >
          <Icon name="fade" size="s" />
        </button>
      </div>
    </div>
  );
}

const REPEAT_WORDS = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" } as const;
const REPEAT_NEXT = { off: "repeat all", all: "repeat one", one: "no repeat" } as const;

/** PLY-17 (Nik, 6 Nov 12:24): Repeat here is the room's, for what plays now; never saved; off again when it stops. */
function RepeatButton({ room, roomName }: { room: RoomNowPlaying; roomName: string }) {
  const { audio, rooms } = useLive();
  const { say } = useAnnounce();
  const shown = room.repeat.shown;
  const where = rooms.length > 1 ? ` in ${roomName}` : "";
  return (
    <button
      type="button"
      className={cx("btn s icon rep", shown !== "off" && "on")}
      aria-pressed={shown !== "off"}
      aria-label={REPEAT_WORDS[shown]}
      title={`${REPEAT_WORDS[shown]}, for what plays now${where} (not saved). Press for ${REPEAT_NEXT[shown]}`}
      onClick={() => {
        touched();
        audio.cycleRepeat({ room: room.roomId });
        const next = shown === "off" ? "all" : shown === "all" ? "one" : "off";
        say(`${REPEAT_WORDS[next]}, for what plays now`);
      }}
    >
      <Icon name={shown === "one" ? "repeat1" : "loop"} size="s" />
    </button>
  );
}

/** 0.5.1 (Nik, 11 Nov): the room's Shuffle, beside its Repeat and like it: for what plays now, never saved. */
function ShuffleButton({ room, roomName }: { room: RoomNowPlaying; roomName: string }) {
  const { audio, rooms } = useLive();
  const where = rooms.length > 1 ? ` in ${roomName}` : "";
  return (
    <button
      type="button"
      className={cx("btn s icon rep", room.shuffle && "on")}
      aria-pressed={room.shuffle}
      aria-label="Shuffle"
      title={`Shuffle ${room.shuffle ? "on" : "off"}, for what plays now${where} (not saved)`}
      onClick={() => {
        touched();
        audio.toggleShuffle({ room: room.roomId });
      }}
    >
      <Icon name={room.shuffle ? "shuffle" : "inorder"} size="s" />
    </button>
  );
}

function Effects({ room, roomName }: { room: RoomNowPlaying; roomName: string }) {
  const { audio, index } = useLive();
  const { say } = useAnnounce();
  const label = (e: RoomNowPlaying["effects"][number]) => {
    if (!e.padKey) return e.title;
    const [boardId, padId] = e.padKey.split("/");
    const b = index.board(boardId);
    return [...(b?.slots ?? []), ...(b?.spare ?? [])].find((p) => p?.id === padId)?.label ?? e.title;
  };
  const fx = room.effects;
  const words = fx.map(label).join(", ");
  return (
    <div className="lv-line lv-fx">
      <span className="lv-line-l">
        <span className="lane-dot fx" />
        Effects
      </span>
      <span className="ellipsis grow" title={`${fx.length} sounding: ${words}`}>
        <b>{fx.length} sounding</b>: {words}
      </span>
      <button
        type="button"
        className="btn s icon"
        aria-label={`Stop effects in ${roomName}`}
        title={`Stop effects in ${roomName}`}
        onClick={() => {
          touched();
          audio.stopLane("effects", { target: { room: room.roomId } });
          say(`Effects stopped in ${roomName}`);
        }}
      >
        <Icon name="stop" size="s" />
      </button>
    </div>
  );
}

/** An Up next entry's name: the place's name for a planned track (DAT-14), an added item's own. */
function entryName(d: LiveData, room: RoomNowPlaying | null, e: UpNextEntryNow): string {
  if (e.kind !== "planned") return e.title;
  const t = d.index.track(e.trackIds[0]);
  return t ? trackNameAt(t, room?.music?.place ?? null, d.names).name : e.title;
}

/**
 * Up next (PLY-16): the room's running list from the next track to the bottom, then the ambience waiting. Folded, the
 * plan shows its next track only; what was added shows, each with ×. Past four lines it folds to one line, its first
 * entry and "n more" (round 6 part 6: On air is at the top and must stay short).
 */
function UpNext({ roomId, room }: { roomId: string; room: RoomNowPlaying | null }) {
  const d = useLive();
  const { say } = useAnnounce();
  const list = room?.upNextList ?? [];
  const waiting = d.state.aq[roomId] ?? [];
  const open = !!d.state.upOpen[roomId];
  const { rows, fewer } = upNextRows(list, waiting.length, open);
  if (!rows.length) return null;
  const k = lk(roomId);
  const labelId = `lv-up-l-${k}`;
  /** UX-R4: after × the next entry's × (it takes the same place), else the one before, else Undo. */
  const nextX = (at: number, ambience = false) => {
    const x = (i: number) => (ambience ? `upx-a${i}-${k}` : `upx-${i}-${k}`);
    return [x(at), x(at - 1), `upx-a0-${k}`, `upopen-${k}`, "undo2"];
  };
  const toggle = () => {
    updateLive((s) => ({ upOpen: { ...s.upOpen, [roomId]: !open } }));
    focusLive(`upopen-${k}`);
  };
  const more = (n: number) => (
    <button type="button" className="lv-more" data-lv={`upopen-${k}`} aria-expanded={false} onClick={toggle}>
      {n} more
    </button>
  );
  const added = list.filter((e) => e.kind !== "planned").length + waiting.length;
  const oneLine = rows.some((r) => r.kind === "more" && r.inline);
  const items: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (row.kind === "more") {
      if (!row.inline)
        items.push(
          <li key={`more-${i}`} className="lv-up-gap">
            {more(row.n)}
          </li>,
        );
      return;
    }
    const after = rows[i + 1];
    const tail = after?.kind === "more" && after.inline ? more(after.n) : null;
    if (row.kind === "ambience") {
      const a = waiting[row.at];
      items.push(
        <li key={`amb-${row.at}`} className="lv-up-i added amb">
          <span className="lane-dot amb" aria-hidden="true" />
          <span className="sr-only">Ambience next: </span>
          <span className="ellipsis grow" title={a.name}>
            {a.name}
          </span>
          <button
            type="button"
            className="x"
            data-lv={`upx-a${row.at}-${k}`}
            aria-label={`Remove ${a.name} from Up next`}
            title="Take out of Up next (this evening only)"
            onClick={() => {
              const before = d.state.aq;
              updateLive((s) => ({ aq: { ...s.aq, [roomId]: (s.aq[roomId] ?? []).filter((_, j) => j !== row.at) } }));
              offerSoftUndo({ text: `Taken out of Up next: ${a.name}`, where: `room:${roomId}`, focus: "undo2", restore: () => updateLive({ aq: before }) }, UNDO_MS);
              say(`Taken out of Up next: ${a.name}. Undo is available for 8 seconds, or press Ctrl+Z.`);
              focusLiveSoon(nextX(row.at, true));
            }}
          >
            <Icon name="close" size="s" />
          </button>
          {tail}
        </li>,
      );
      return;
    }
    const e = row.entry;
    const name = entryName(d, room, e);
    const isAdded = e.kind !== "planned";
    const left = isAdded && e.trackIds.length > 1 ? `${e.trackIds.length} left` : "";
    items.push(
      <li key={`${e.kind}-${row.at}-${JSON.stringify(e.ref)}`} className={cx("lv-up-i", isAdded && "added")}>
        {isAdded && (
          <>
            <Icon name={e.kind === "playNext" ? "next" : "queue"} size="s" />
            <span className="sr-only">{e.kind === "playNext" ? "Play next: " : "Added: "}</span>
          </>
        )}
        <span className="ellipsis grow" title={`${name}${left ? ` (${left})` : ""}`}>
          {name}
        </span>
        {left && <span className="faint num">{left}</span>}
        <button
          type="button"
          className="x"
          data-lv={`upx-${row.at}-${k}`}
          aria-label={`Remove ${name} from Up next`}
          title="Take out of Up next (this evening only)"
          onClick={() => {
            takeOut(d, roomId, () => d.audio.removeFromUpNext(e.ref, { room: roomId }).ok, name, `upx-0-${k}`, { say });
            focusLiveSoon(nextX(row.at));
          }}
        >
          <Icon name="close" size="s" />
        </button>
        {tail}
      </li>,
    );
  });
  if (fewer) {
    items.push(
      <li key="fewer" className="lv-up-gap">
        <button type="button" className="lv-more" data-lv={`upopen-${k}`} aria-expanded onClick={toggle}>
          Show fewer
        </button>
      </li>,
    );
  }
  return (
    <div className="lv-up">
      <span className="lv-q-l" id={labelId}>
        Up next
      </span>
      <ol aria-labelledby={labelId}>{items}</ol>
      {added > 1 && !oneLine && (
        <button type="button" className="btn s ghost lv-qclear" data-lv={`qclear-${k}`} title="Take out everything you added this evening" onClick={() => clearAdded(d, roomId, "undo2", { say })}>
          Clear added
        </button>
      )}
    </div>
  );
}

/** PLY-1: What played, opened in the room itself (Live never covers its controls). */
function PlayedButton({ r }: { r: LiveRoom }) {
  const { state } = useLive();
  const open = !!state.playedOpen[r.roomId];
  return (
    <button
      type="button"
      className={cx("btn s icon lv-rm-played", open && "on")}
      data-lv={`played-${lk(r.roomId)}`}
      aria-expanded={open}
      aria-label="What played"
      title={`What played in ${r.name}, with Play again`}
      onClick={() => updateLive((s) => ({ playedOpen: { ...s.playedOpen, [r.roomId]: !open } }))}
    >
      <Icon name="history" size="s" />
    </button>
  );
}

function PlayedList({ r }: { r: LiveRoom }) {
  const d = useLive();
  const { say } = useAnnounce();
  if (!d.state.playedOpen[r.roomId]) return null;
  const played = (r.room?.played ?? []).slice(0, PLAYED_SHOWN);
  const target = { room: r.roomId };
  const close = () => {
    updateLive((s) => ({ playedOpen: { ...s.playedOpen, [r.roomId]: false } }));
    focusLive(`played-${lk(r.roomId)}`);
  };
  return (
    <div className="lv-played">
      <ol className="lv-played-l" aria-label={`What played in ${r.name}`}>
        {played.length ? (
          played.map((x, i) => {
            const t = d.index.track(x.trackId);
            const place: UsePlace | null = x.from && "scene" in x.from ? { kind: "scene", ...x.from.scene } : x.from && "place" in x.from ? (x.from.place ?? null) : null;
            const name = t ? trackNameAt(t, place, d.names).name : x.title;
            return (
              <li key={`${x.trackId}-${x.at}-${i}`} className="lv-trk-r">
                <span className="ellipsis grow" title={name}>
                  {name}
                </span>
                <span className="lv-trk-acts">
                  <button
                    type="button"
                    className="btn s icon lv-hov"
                    aria-label={`Play again: ${name}`}
                    title="Play again now"
                    onClick={() => {
                      touched();
                      d.audio.playTrack(x.trackId, { target, ...(x.from ? { from: x.from as never } : {}), fadeMs: LIVE_FADE_MS });
                      close();
                    }}
                  >
                    <Icon name="playair" size="s" />
                  </button>
                  <button
                    type="button"
                    className="btn s icon lv-hov"
                    aria-label={`Play next: ${name}`}
                    title="Play next, after the current track"
                    onClick={() => {
                      d.audio.playNext({ kind: "track", trackId: x.trackId, ...(x.from ? { from: x.from as never } : {}), name }, { target });
                      say(`Plays next: ${name}`);
                      close();
                    }}
                  >
                    <Icon name="next" size="s" />
                  </button>
                </span>
              </li>
            );
          })
        ) : (
          <li className="lv-in-none">Nothing yet</li>
        )}
      </ol>
    </div>
  );
}

/** Add a room: another bot joins a voice channel; the new room starts silent. */
function AddRoom() {
  const { outputs, client } = useLive();
  const { toast, say } = useAnnounce();
  const items = (): PopMenuEntry[] => [
    ...addRoomChoices(outputs).flatMap(({ bot, servers }): PopMenuEntry[] => [
      { group: `${bot.name} joins…` },
      ...servers.flatMap(({ server, items: channels }): PopMenuEntry[] => [
        { group: server },
        ...channels.map(
          (c): PopMenuEntry => ({
            key: `${bot.id}-${c.channelId}`,
            role: "menuitemradio",
            checked: c.here,
            disabled: c.here || c.taken,
            content: (
              <>
                <span className="grow ellipsis">{c.name}</span> <span className="faint">{c.sub}</span>
              </>
            ),
            onSelect: () => {
              client?.move(bot.id, c.channelId);
              // UX-R4: focus goes to the new room's bot button once it is drawn.
              focusLiveSoon([`room-${lk(bot.id)}`], { move: true });
              // UX-R9: a channel nobody is in says so in the room's own words.
              const words = c.empty ? `${c.name} is joining: nobody there.` : `${c.name} is joining. It starts silent: choose To: ${c.name} in a box to play there.`;
              say(words);
              toast(words);
            },
          }),
        ),
      ]),
    ]),
    { separator: true },
    {
      key: "newbot",
      content: (
        <>
          <Icon name="plus" size="s" />
          New bot…
        </>
      ),
      onSelect: () => (window.location.hash = "#/settings"),
    },
  ];
  return (
    <PopMenuButton label="Add a room" className="btn s icon" ariaLabel="Add a room" title="Add a room: put another bot in a voice channel" dataK="addroom" items={items}>
      <Icon name="plus" size="s" />
    </PopMenuButton>
  );
}
