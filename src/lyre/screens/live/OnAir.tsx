/**
 * One On air box per room (live.js roomBox, laneBlock): its one status, Mute, its volume (the bot's, the same slider
 * as on Outputs and in the Now playing bar) and its ⋯ menu (move, copy another room, leave); in the box the music
 * with where it comes from and what is up next, its queue, the ambience and the effects sounding. Add a room under
 * the boxes brings another bot in. Everything shown comes from the audio host's getNowPlaying().
 */
import React, { useEffect, useRef, useState } from "react";

import { normaliseHover } from "../../../common/domain";
import type { LaneNowPlaying, MusicOrAmbience, RoomNowPlaying } from "../../audio/lyreAudio";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { trackNameAt } from "../../kit/trackName";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { clockTime } from "../../shell/NowPlayingBar";
import { laneProfile, sceneSteps, showLibraryOf, useLive } from "./liveData";
import { addRoomChoices, channelChoices, endWords, roomStatus, TABLE, type LiveRoom } from "./liveModel";
import { useFoldedSummary } from "./Scenes";
import { LIVE_FADE_MS } from "./TrackRow";

export function OnAirBoxes() {
  const { rooms, now, outputs } = useLive();
  const table = now.rooms.find((r) => r.roomId === TABLE) ?? now.rooms[0] ?? null;
  return (
    <>
      {rooms.length ? (
        rooms.map((r) => <RoomBox key={r.roomId} r={r} />)
      ) : (
        <Pane id="lv-room-none" title="On air: no room yet" icon="broadcast" kind="onair" size="auto" flush noMax status={{ text: "Silent", tone: "idle" }}>
          <div className="lv-onair">
            <Lane lane="music" room={table} roomName="Table" />
            <Lane lane="ambience" room={table} roomName="Table" />
          </div>
        </Pane>
      )}
      {addRoomChoices(outputs).length > 0 && <AddRoom />}
    </>
  );
}

function RoomBox({ r }: { r: LiveRoom }) {
  const { rooms, index, names } = useLive();
  const status = roomStatus(r);
  const room = r.room;
  const fx = room?.effects ?? [];
  const silent = !room || (!room.music && !room.ambience && !fx.length);
  const music = room?.music && index.track(room.music.trackId);
  const summary = useFoldedSummary(`lv-room-${r.roomId}`, true, music ? trackNameAt(music, room!.music!.place, names).name : undefined);
  return (
    <Pane
      id={`lv-room-${r.roomId}`}
      title={`On air: ${r.name}`}
      icon="broadcast"
      kind="onair"
      size="auto"
      flush
      noMax
      className="lv-room"
      silent={status.text !== "Playing"}
      status={status}
      actions={<RoomActions r={r} />}
      summary={summary}
    >
      <div className="lv-onair">
        {silent ? (
          <p className="lv-room-hint">{rooms.length > 1 ? `To play here, choose “To: ${r.name}” in Scene music, Off script or Pads.` : "What you play next comes here."}</p>
        ) : (
          <>
            <Lane lane="music" room={room} roomName={r.name} />
            <Lane lane="ambience" room={room} roomName={r.name} />
            <Effects room={room!} roomName={r.name} />
          </>
        )}
      </div>
    </Pane>
  );
}

/** Mute, Volume, ⋯ in the box's header. */
function RoomActions({ r }: { r: LiveRoom }) {
  const { client, audio } = useLive();
  const { say } = useAnnounce();
  const bot = r.bot;
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
            client.setMuted(bot.id, !bot.muted);
            say(`${r.name} ${bot.muted ? "unmuted" : "muted"}`);
          }}
        >
          <Icon name={bot.muted ? "close" : "horn"} size="s" />
        </button>
      )}
      <RoomVolume
        name={r.name}
        saved={Math.round((bot && client ? bot.volume : (r.room?.volume ?? 1)) * 100)}
        onChange={(v) => (bot && client ? client.setVolume(bot.id, v / 100) : audio.setRoomVolume({ room: r.roomId }, v / 100))}
      />
      <RoomMenu r={r} />
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
        onChange(value);
      }}
    />
  );
}

function RoomMenu({ r }: { r: LiveRoom }) {
  const { rooms, outputs, client, audio } = useLive();
  const { toast, say } = useAnnounce();
  const items = (): PopMenuEntry[] => {
    const entries: PopMenuEntry[] = [];
    if (outputs && client && r.bot) {
      const bot = r.bot;
      entries.push({ group: `Move ${r.name} to another channel` });
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
            onSelect: () => {
              client.move(bot.id, c.channelId);
              toast(`${bot.name} is joining ${c.name}`);
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
          copyRoom(audio, other.room!, r.roomId);
          say(`${r.name} now plays what ${other.name} plays`);
        },
      });
    }
    if (client && r.bot) {
      const bot = r.bot;
      entries.push({
        key: "leave",
        content: (
          <>
            <Icon name="close" size="s" />
            Leave ({r.name} goes silent)
          </>
        ),
        onSelect: () => {
          client.leave(bot.id);
          toast(`${bot.name} left ${r.name}`);
        },
      });
    }
    entries.push({
      key: "outputs",
      content: (
        <>
          <Icon name="users" size="s" />
          All outputs…
        </>
      ),
      onSelect: () => (window.location.hash = "#/outputs"),
    });
    return entries;
  };
  return (
    <PopMenuButton label={`Room ${r.name}`} className="btn s icon" ariaLabel={`More for ${r.name}`} title={`More for ${r.name}`} items={items}>
      <Icon name="more" size="s" />
    </PopMenuButton>
  );
}

/**
 * Copy: the other room's music and ambience start here from the same place (scene step or playlist), so Next goes on
 * the same way. The audio host cannot start a track part-way, so they start from the top.
 */
function copyRoom(audio: ReturnType<typeof useLive>["audio"], from: RoomNowPlaying, to: string) {
  const target = { room: to };
  for (const [lane, playing] of [["music", from.music], ["ambience", from.ambience]] as const) {
    if (!playing) {
      audio.stopLane(lane, { target, fadeMs: 2000 });
      continue;
    }
    const o = playing.origin;
    const source = o.kind === "scene" ? { scene: o.scene, at: o.at } : o.kind === "playlist" ? { playlistId: o.playlistId, ...(o.place ? { place: o.place } : {}) } : undefined;
    audio.playTrack(playing.trackId, { target, from: source, fadeMs: 2000 });
  }
}

/** One lane's line: its name, the track, its time and controls; the music adds where it comes from and Up next. */
function Lane({ lane, room, roomName }: { lane: MusicOrAmbience; room: RoomNowPlaying | null; roomName: string }) {
  const live = useLive();
  const { audio, index, names, overrides, campaigns, orders } = live;
  const playing: LaneNowPlaying | null = (lane === "music" ? room?.music : room?.ambience) ?? null;
  const isMusic = lane === "music";
  const word = isMusic ? "Music" : "Ambience";
  const target = room ? { room: room.roomId } : undefined;
  const track = playing ? index.track(playing.trackId) : undefined;
  const shown = playing && track ? trackNameAt(track, playing.place, names) : playing ? { name: playing.title, own: playing.title } : null;
  // PLY-15: how its volume is evened out where it plays, on hover only (Nik: no added words on screen).
  const volumeHover = playing ? normaliseHover(track, playing.playlistId ? index.playlist(playing.playlistId) : null, live.normalise) : "";
  const single = !playing || playing.origin.kind === "single";
  const canNext = !!playing && (!single || (isMusic && !!room?.queued.length) || (isMusic && !!room?.upNext));
  let sub: React.ReactNode = null;
  if (isMusic && playing) {
    const o = playing.origin;
    const listName = playing.playlistId ? (index.playlist(playing.playlistId)?.name ?? "") : "";
    let src = listName || "Off script";
    if (o.kind === "scene") {
      const lib = showLibraryOf(index, campaigns, overrides, orders);
      const steps = sceneSteps(lib, o.scene, o.seed ?? 0);
      const n = lib.scene(o.scene)?.music.length ?? 0;
      const step = steps[o.at];
      if (step) src = `Item ${step.itemIndex + 1} of ${n}${listName ? ` · ${listName}` : ""}`;
    }
    const resolved = laneProfile(playing, index, overrides);
    const upNext = room?.upNext;
    const queued = !!room?.queued.length && room.queued[0].trackId === upNext?.trackId;
    sub = (
      <div className="lv-lane-sub ellipsis" title={resolved ? endWords(resolved.profile, resolved.source) : undefined}>
        {src} · <span className="lv-upnext">up next {upNext ? <b>{nameOf(live, upNext.trackId, upNext.title)}</b> : "nothing"}{queued ? " (queued)" : ""}</span>
      </div>
    );
  }
  return (
    <>
      <div className={cx("lv-lane", isMusic ? "lv-m" : "lv-a", !playing && "empty")}>
        <div className="lv-lane-l">
          <span className="lv-lane-n">
            <span className={cx("lane-dot", isMusic ? "music" : "amb")} />
            {word}
          </span>
          {playing?.paused && <span className="badge">Paused</span>}
        </div>
        <div className="lv-lane-t ellipsis" title={shown ? [shown.name !== shown.own ? `Its own name: ${shown.own}` : shown.own, volumeHover].join("\n") : undefined}>
          {shown ? (
            <>
              {shown.name}
              {shown.name !== shown.own && <span className="sr-only"> (its own name: {shown.own})</span>}
            </>
          ) : (
            <span className="muted">Silent</span>
          )}
        </div>
        {playing && (
          <div className="lv-lane-pr">
            <div className={cx("progress", isMusic ? "music" : "amb")} aria-hidden="true">
              <span style={{ width: `${playing.length && playing.position !== null ? Math.min(100, (playing.position / playing.length) * 100) : 0}%` }} />
            </div>
            <span className="num lv-time">{playing.position !== null ? `${clockTime(playing.position)}${playing.length ? ` / ${clockTime(playing.length)}` : ""}` : "…"}</span>
          </div>
        )}
        {sub}
        {playing && target && (
          <div className="lv-lane-c" role="group" aria-label={`${word} in ${roomName}`}>
            {isMusic && (
              <button type="button" className="btn s icon" aria-label="Previous music track" title="Previous track" disabled={single} onClick={() => audio.previous("music", target)}>
                <Icon name="prev" size="s" />
              </button>
            )}
            <button
              type="button"
              className="btn s icon"
              aria-label={`${playing.paused ? "Resume" : "Pause"} ${word.toLowerCase()}`}
              title={`${playing.paused ? "Resume" : "Pause"} ${word.toLowerCase()}`}
              onClick={() => audio.togglePause(lane, target)}
            >
              <Icon name={playing.paused ? "play" : "pause"} size="s" />
            </button>
            <button
              type="button"
              className="btn s icon"
              aria-label={`Next ${word.toLowerCase()} track`}
              title={`Next ${isMusic ? "track" : "ambience"} (crossfade)`}
              disabled={!canNext}
              onClick={() => audio.next(lane, target)}
            >
              <Icon name="next" size="s" />
            </button>
            <button
              type="button"
              className="btn s icon"
              aria-label={`Fade ${word.toLowerCase()} out`}
              title={`Fade ${word.toLowerCase()} out over 3 seconds`}
              onClick={() => audio.stopLane(lane, { target, fadeMs: LIVE_FADE_MS })}
            >
              <Icon name="fade" size="s" />
            </button>
          </div>
        )}
      </div>
      {isMusic && room && room.queued.length > 0 && <Queue room={room} />}
    </>
  );
}

function nameOf(live: ReturnType<typeof useLive>, trackId: string, fallback: string): string {
  const t = live.index.track(trackId);
  return t ? t.title || t.metaTitle || t.fileName : fallback;
}

function Queue({ room }: { room: RoomNowPlaying }) {
  const { audio } = useLive();
  const { say } = useAnnounce();
  const target = { room: room.roomId };
  return (
    <div className="lv-queue">
      <span className="lv-q-l">Queued</span>
      <ol className="chips">
        {room.queued.map((q, i) => (
          <li className="chip lv-q-item" key={q.entryId} title={q.title}>
            <span className="num">{i + 1}</span>
            <span className="ellipsis">{q.title}</span>
            <button type="button" className="x" aria-label={`Remove ${q.title} from the queue`} title="Remove from the queue" onClick={() => audio.removeQueued(q.entryId, target) && say(`Removed from the queue: ${q.title}`)}>
              <Icon name="close" size="s" />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn s ghost"
        onClick={() => {
          room.queued.forEach((q) => audio.removeQueued(q.entryId, target));
          say("Queue cleared");
        }}
      >
        Clear
      </button>
    </div>
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
  return (
    <div className="lv-line lv-fx">
      <span className="lv-line-l">
        <span className="lane-dot fx" />
        Effects
      </span>
      <span className="ellipsis grow">
        {fx.length ? (
          <>
            <b>{fx.length} sounding</b>: {fx.map(label).join(", ")}
          </>
        ) : (
          <span className="muted">None</span>
        )}
      </span>
      {fx.length > 0 && (
        <button
          type="button"
          className="btn s icon"
          aria-label={`Stop effects in ${roomName}`}
          title={`Stop effects in ${roomName}`}
          onClick={() => {
            audio.stopLane("effects", { target: { room: room.roomId } });
            say(`Effects stopped in ${roomName}`);
          }}
        >
          <Icon name="stop" size="s" />
        </button>
      )}
    </div>
  );
}

function AddRoom() {
  const { outputs, client } = useLive();
  const { toast } = useAnnounce();
  const items = (): PopMenuEntry[] =>
    addRoomChoices(outputs).flatMap(({ bot, servers }): PopMenuEntry[] => [
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
              toast(`${c.name} is joining. It starts silent: choose To: ${c.name} to play there.`);
            },
          }),
        ),
      ]),
    ]);
  return (
    <div className="lv-addroom">
      <PopMenuButton label="Add a room" className="btn s ghost" items={items}>
        <Icon name="plus" size="s" />
        Add a room
      </PopMenuButton>
    </div>
  );
}
