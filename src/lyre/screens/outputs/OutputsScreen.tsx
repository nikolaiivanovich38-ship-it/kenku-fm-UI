/**
 * Outputs (route `outputs`, OUT-5, OUT-6): where Lyre's sound goes in Discord, and moving bots between rooms during
 * play. Ported from design/prototype/src/views/outputs.js and outputs.css.
 *
 * One On air box per bot, titled with its room (the voice channel it is in) or, in none, with the bot's name, with one
 * status pill; a quiet "via <bot>" line; Room (server › channel, a menu of every voice channel to move it to) and
 * Leave; what the room plays now; who hears it; its volume. Mute and Test in the header. All voice channels: every
 * channel of every server with who is in it and which bot is there, Bring… to move a bot there, and Swap rooms.
 *
 * The bots come from the main process (useOutputs, src/lyre/outputs); what each room plays from the audio host
 * (useNowPlaying); the Test chime plays through the audio host into that room only.
 *
 * w6-rooms (round 6): OUT-7 Add bot and Kick. Each bot in a channel is a chip with its own Kick (×); a channel with no
 * bot has Add, which puts the one free bot there in one click or offers a short choice. Kick never asks: when the
 * players there were hearing something, the undo bar's Undo puts the bot back and plays what it played from where it
 * was. A move that leaves listeners in silence has the same Undo (review Must 2), and a room in a channel with nobody
 * in it offers to move to the channel with the players. OUT-8: Tokens and new bots is Settings in Lyre. OUT-10: a level
 * meter beside each room's volume, read from the audio host (roomLevel) while the screen is open.
 */
import React, { useEffect, useId, useRef, useState } from "react";

import { restoreRoom } from "../../outputs/roomRestore";
import { useUndoNote } from "../../shell/UndoNote";

import { useCampaigns } from "../../api";
import { useLyreAudio, useNowPlaying } from "../../audio";
import type { LaneNowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
import { DestTag } from "../../kit/DestTag";
import { Icon } from "../../kit/Icon";
import { useLiveSession } from "../../kit/liveSession";
import { Pane } from "../../kit/Pane";
import { PopMenu, type PopMenuEntry } from "../../kit/PopMenu";
import { cx } from "../../kit/cx";
import { useOutputs, type OutputsClient } from "../../outputs/OutputsProvider";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { ModeSwitch } from "../campaigns/parts";
import {
  addBotChoice,
  busiestChannel,
  chimeMessage,
  heardTwice,
  isPlaying,
  kickLosesSound,
  meterFill,
  moveLosesSound,
  moveMessage,
  names,
  nobodyThere,
  outputName,
  people,
  pill,
  roomBots,
  roomItems,
  roomToRestore,
  swapPair,
  viewOf,
  type BotView,
  type OutputsView,
} from "./outputsModel";
import "./outputs.css";
import { TopLead } from "../../shell/TopBar";

/* ---------- the prototype's own four icons (outputs.js PATHS) ---------- */
const PATHS = {
  alert: "M12 3 2 20h20zM12 10v4M12 17h.01",
  off: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8",
  mute: "M3 10v4h3l8 5V5L6 10zM17 9.5l5 5M22 9.5l-5 5",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  // core.js leave: Kick (a door with an arrow out).
  leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
} as const;

function OpIcon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** What the screen does with a bot: through the main process, with the prototype's messages. */
interface Actions {
  move: (of: BotView, channelId: string) => void;
  leave: (of: BotView) => void;
}

function useActions(view: OutputsView | null, client: OutputsClient | null): Actions {
  const { toast, say } = useAnnounce();
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const { offerUndo } = useUndoNote();
  const roomOf = (of: BotView) => now.rooms.find((r) => r.roomId === of.bot.id);
  return {
    move: (of, channelId) => {
      if (!view || !client) return;
      const text = moveMessage(view, of, channelId);
      if (of.inRoom && of.bot.room?.channelId === channelId) {
        toast(text);
        return;
      }
      // Must 2: one click and no question, so a move that leaves the players in silence can be undone.
      const back = of.bot.room?.channelId;
      const lost = back !== undefined && moveLosesSound(of, roomOf(of), channelId);
      client.move(of.bot.id, channelId);
      say(text);
      if (lost) offerUndo(`${of.bot.name} moved from ${of.channel!.name}: the players there hear nothing now.`, () => client.move(of.bot.id, back));
      else toast(text);
    },
    leave: (of) => {
      if (!client || !of.channel) return;
      // OUT-7: Kick never asks; Undo puts the bot back with what it played when the players were hearing it.
      const restore = kickLosesSound(of, roomOf(of)) ? roomToRestore(of, roomOf(of)) : null;
      client.leave(of.bot.id);
      if (restore) {
        offerUndo(`${of.bot.name} left ${of.channel.name}: the players there hear nothing now.`, () => {
          void restoreRoom(restore, { client, audio }).then((back) => {
            if (!back) toast(`${of.bot.name} could not go back to ${of.channel!.name}. Add it there again from the list.`);
          });
        });
        say(`${of.bot.name} left ${of.channel.name}. Undo is at the foot of the screen, or press Ctrl+Z.`);
      } else toast(`${of.bot.name} left ${of.channel.name}`);
    },
  };
}

export function OutputsScreen() {
  const { outputs, client } = useOutputs();
  const view = outputs ? viewOf(outputs) : null;
  const actions = useActions(view, client);
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Rooms</h1>
        <span className="grow" />
        <PrepOrLive />
      </div>
      <div className="viewbody fill op-body" data-scroll="body">
        {view && view.bots.length > 0 ? (
          <div className="op-split">
            <div className="col op-roomcol">
              {view.bots.map((b) => (
                <RoomBox key={b.bot.id} view={view} of={b} client={client!} actions={actions} />
              ))}
            </div>
            <div className="col op-chcol">
              <ChannelsPane view={view} client={client!} actions={actions} />
            </div>
          </div>
        ) : (
          <p className="hint op-none">
            <Icon name="gear" size="s" />
            {outputs ? (
              <span>
                No Discord bot yet. <a href="#/settings">Add one in Settings</a>, with its token.
              </span>
            ) : (
              <span>Looking for your Discord bots…</span>
            )}
          </p>
        )}
      </div>
    </>
  );
}

/** The Prep | Live switch, for the session loaded in Live, else the campaign last opened, else the first. */
function PrepOrLive() {
  const campaigns = useCampaigns().data;
  const live = useLiveSession();
  const inHand = useCampaignInHand();
  const campaign = campaigns?.find((c) => c.id === live?.campaignId) ?? campaigns?.find((c) => c.id === inHand) ?? campaigns?.[0];
  return campaign ? <ModeSwitch campaign={campaign} /> : null;
}

/* ---------- one On air box per bot ---------- */

function RoomBox({ view, of, client, actions }: { view: OutputsView; of: BotView; client: OutputsClient; actions: Actions }) {
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const { toast, say } = useAnnounce();
  const { bot } = of;
  const room = now.rooms.find((r) => r.roomId === bot.id);
  const status = pill(of, room);
  const name = outputName(of);
  const onTest = () => {
    const words = chimeMessage(of);
    if (!words.ok) return toast(words.toast);
    const outcome = audio.testChime(bot.id);
    if (!outcome.ok) return; // the shell shows the audio host's message
    toast(words.toast);
    say(words.say);
  };
  const actionsHtml = (
    <>
      <button
        type="button"
        className="btn s icon"
        aria-pressed={bot.muted}
        aria-label={`Mute ${name}`}
        title={bot.muted ? "Muted: press to let the room hear Lyre again" : "Mute this room"}
        onClick={() => {
          client.setMuted(bot.id, !bot.muted);
          say(`${bot.name} ${bot.muted ? "unmuted" : "muted"}`);
        }}
      >
        {bot.muted ? <OpIcon name="mute" /> : <Icon name="horn" size="s" />}
      </button>
      <button type="button" className="btn s icon" aria-label={`Test ${name}: a short chime in this room only`} title="Test: a short chime in this room only" onClick={onTest}>
        <Icon name="bell" size="s" />
      </button>
    </>
  );
  return (
    <Pane id={`op-r-${bot.id}`} title={name} icon="broadcast" kind="onair" size="auto" noMax className="op-box-room" silent={status.text !== "Playing"} status={status} actions={actionsHtml}>
      {of.inRoom && <p className="op-via">via {bot.name}</p>}
      <div className="op-f">
        {bot.login === "ready" ? (
          <RoomRow view={view} of={of} actions={actions} />
        ) : (
          <>
            <span className="op-l">Discord</span>
            <p className="op-login">{loginWords(of)}</p>
          </>
        )}
        {of.inRoom && (
          <>
            <span className="op-l">Playing</span>
            <div className="op-play">
              <Playing room={room} muted={bot.muted} />
            </div>
            <span className="op-l">Hears it</span>
            <div className="op-who ellipsis" title={of.listeners.join(", ")}>
              {of.listeners.length ? (
                <>
                  <b>{people(of.listeners.length)}</b>
                  <span className="muted">: {of.listeners.join(", ")}</span>
                </>
              ) : (
                <span className="op-nobody">
                  <OpIcon name="alert" />
                  Nobody here yet
                </span>
              )}
            </div>
          </>
        )}
        <Volume of={of} client={client} />
      </div>
      <Warnings view={view} of={of} client={client} actions={actions} />
    </Pane>
  );
}

function loginWords(of: BotView): React.ReactNode {
  if (of.bot.login === "connecting") return "Logging in to Discord…";
  const settings = <a href="#/settings">Settings</a>;
  if (of.bot.login === "error") return <>{of.bot.error ?? "Discord refused this bot."} Fix it in {settings}.</>;
  return <>Not connected to Discord. Connect it, or give it a new token, in {settings}.</>;
}

/** Room (server › channel, or Choose a room…) and Leave. */
function RoomRow({ view, of, actions }: { view: OutputsView; of: BotView; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const menuId = useId();
  const { bot } = of;
  const items = (): PopMenuEntry[] => {
    const entries: PopMenuEntry[] = roomItems(view, of).flatMap(({ server, items: rooms }): PopMenuEntry[] => [
      { group: server },
      ...rooms.map(
        (r): PopMenuEntry => ({
          key: r.channelId,
          role: "menuitemradio",
          checked: r.here,
          className: cx("op-mi", r.here && "here"),
          onSelect: () => actions.move(of, r.channelId),
          content: (
            <>
              {r.here ? <Icon name="check" size="s" /> : <Icon name="horn" size="s" />}
              <span className="grow op-mi-t">
                <span className="op-mi-n">{r.name}</span>{" "}
                {r.sub && <span className="op-mi-s">{r.sub}</span>}{" "}
                {r.warn && (
                  <span className="op-mi-w">
                    <OpIcon name="alert" />
                    {r.warn}
                  </span>
                )}
              </span>
            </>
          ),
        }),
      ),
    ]);
    if (of.inRoom) {
      entries.push({ separator: true }, { key: "leave", content: <><OpIcon name="off" />Kick from {of.channel!.name}</>, onSelect: () => actions.leave(of) });
    }
    return entries;
  };
  return (
    <>
      <span className="op-l" id={`${id}-l`}>
        Room
      </span>
      <div className="op-roomrow">
        <button
          ref={ref}
          type="button"
          className={cx("btn s op-room", !of.inRoom && "primary")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-labelledby={`${id}-l ${id}-v`}
          title={`Move ${bot.name} to another voice channel`}
          onClick={() => setOpen(!open)}
        >
          <span className="op-rv ellipsis" id={`${id}-v`}>
            {of.inRoom ? (
              <>
                <span className="muted">{of.server!.name} ›</span> <b>{of.channel!.name}</b>
              </>
            ) : (
              "Choose a room…"
            )}
          </span>
          <Icon name="chevdown" size="s" />
        </button>
        {of.inRoom && <KickButton of={of} actions={actions} />}
      </div>
      {open && (
        <PopMenu
          id={menuId}
          label={`Room for ${bot.name}`}
          items={items()}
          anchor={ref}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus && ref.current && document.contains(ref.current)) ref.current.focus();
          }}
        />
      )}
    </>
  );
}

/** What the room plays now: music and ambience with their progress, and how many effects sound. */
function Playing({ room, muted }: { room: RoomNowPlaying | undefined; muted: boolean }) {
  const lanes: readonly (readonly ["music" | "amb", LaneNowPlaying | null])[] = room ? [["music", room.music], ["amb", room.ambience]] : [];
  const rows = lanes.filter(([, lane]) => lane);
  const fx = room?.effects ?? [];
  if (!rows.length && !fx.length) return <div className="op-pl hint">Nothing playing</div>;
  const heard = isPlaying(room) && !muted;
  return (
    <>
      {heard && (
        <div className="op-pl">
          <DestTag to="air" />
        </div>
      )}
      {rows.map(([kind, lane]) => (
        <div className="op-pl" key={kind}>
          <span className={`lane-dot ${kind}`} />
          <span className="sr-only">{kind === "music" ? "Music" : "Ambience"}: </span>
          <span className="ellipsis grow" title={lane!.title}>
            {lane!.title}
          </span>
          {lane!.paused && <span className="hint">Paused</span>}
          <span className={`progress ${kind} op-pp`} aria-hidden="true">
            <span style={{ width: `${lane!.length && lane!.position !== null ? Math.min(100, (lane!.position / lane!.length) * 100) : 0}%` }} />
          </span>
        </div>
      ))}
      {fx.length > 0 && (
        <div className="op-pl">
          <span className="lane-dot fx" />
          <span className="sr-only">Effects: </span>
          <span className="ellipsis grow" title={fx.map((f) => f.title).join(", ")}>
            {fx.length} sounding
          </span>
        </div>
      )}
    </>
  );
}

/** Volume: the number follows the thumb at once; the room's volume follows each step. */
function Volume({ of, client }: { of: BotView; client: OutputsClient }) {
  const id = useId();
  const saved = Math.round(of.bot.volume * 100);
  const [shown, setShown] = useState(saved);
  const lastMove = useRef(0);
  useEffect(() => {
    // An answer to an older step must not pull the thumb back while it moves.
    if (Date.now() - lastMove.current > 400) setShown(saved);
  }, [saved]);
  return (
    <>
      <label className="op-l" htmlFor={id}>
        Volume
      </label>
      <div className="op-volrow">
        <input
          type="range"
          id={id}
          min={0}
          max={100}
          step={5}
          value={shown}
          aria-valuetext={`${shown}%`}
          onChange={(event) => {
            const value = Number(event.target.value);
            lastMove.current = Date.now();
            setShown(value);
            client.setVolume(of.bot.id, value / 100);
          }}
        />
        <output className="num" htmlFor={id}>
          {shown}%
        </output>
        <span className="op-lvl" title="Level: how loud the room is right now">
          <span className="op-lvl-l" aria-hidden="true">
            Level
          </span>
          <LevelMeter roomId={of.bot.id} live={of.inRoom && !of.bot.muted} />
        </span>
      </div>
    </>
  );
}

/** How often the meters read the rooms' levels (the prototype's 160 ms). */
const METER_MS = 160;

/**
 * OUT-10: how loud the room is now, while it plays (or a Test chime rings). Moves the bar's width directly, a few
 * times a second, so the screen does not draw itself again; hidden from screen readers (the status pill says Playing).
 */
function LevelMeter({ roomId, live }: { roomId: string; live: boolean }) {
  const audio = useLyreAudio();
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const show = (fill: number) => {
      if (bar.current) bar.current.style.width = `${Math.round(fill * 100)}%`;
    };
    if (!live) {
      show(0);
      return;
    }
    const timer = setInterval(() => show(meterFill(audio.roomLevel(roomId))), METER_MS);
    return () => {
      clearInterval(timer);
      show(0);
    };
  }, [audio, roomId, live]);
  return (
    <span className="op-meter" aria-hidden="true" data-testid={`meter-${roomId}`}>
      <span ref={bar} />
    </span>
  );
}

/** OUT-7: Kick (×), the same in the bot's box and in the channel list. */
function KickButton({ of, actions, className }: { of: BotView; actions: Actions; className?: string }) {
  const name = `Kick ${of.bot.name} from ${of.channel!.name}`;
  return (
    <button type="button" className={cx("btn s icon op-kick", className)} aria-label={name} title={name} onClick={() => actions.leave(of)}>
      <OpIcon name="leave" />
    </button>
  );
}

/** Two bots in one room (the players hear both), and a join or login that failed. */
function Warnings({ view, of, client, actions }: { view: OutputsView; of: BotView; client: OutputsClient; actions: Actions }) {
  const twice = heardTwice(view, of);
  const failed = of.bot.room?.status === "error" ? of.bot.room : null;
  // Must 2: nobody is in this bot's channel; the one-click fix moves it to where the players are.
  const empty = nobodyThere(of);
  const to = empty ? busiestChannel(view, of) : null;
  if (!twice.length && !failed && !empty) return null;
  return (
    <>
      {twice.length > 0 && (
        <p className="op-warn">
          <OpIcon name="alert" />
          <span className="grow">
            {names(twice)} is in {of.channel!.name} too: the players hear both.
          </span>
          <button type="button" className="btn s" aria-label={`Kick ${of.bot.name} from ${of.channel!.name}`} onClick={() => actions.leave(of)}>
            Kick
          </button>
        </p>
      )}
      {empty && (
        <p className="op-warn">
          <OpIcon name="alert" />
          <span className="grow">Nobody is in {of.channel!.name}: players hear nothing.</span>
          {to && (
            <button type="button" className="btn s" title={`${of.bot.name} moves to ${to.where} (${people(to.people)})`} onClick={() => actions.move(of, to.channelId)}>
              Move to {to.name}
            </button>
          )}
        </p>
      )}
      {failed && (
        <p className="op-warn op-err">
          <OpIcon name="alert" />
          <span className="grow">Could not join: {failed.error ?? "try again"}</span>
          <button type="button" className="btn s" onClick={() => client.retry(of.bot.id)}>
            Try again
          </button>
        </p>
      )}
    </>
  );
}

/* ---------- all voice channels ---------- */

function ChannelsPane({ view, client, actions }: { view: OutputsView; client: OutputsClient; actions: Actions }) {
  const { say } = useAnnounce();
  const pair = swapPair(view);
  const swap = () => {
    if (!pair) return;
    const [a, b] = pair;
    client.move(a.bot.id, b.bot.room!.channelId);
    client.move(b.bot.id, a.bot.room!.channelId);
    say(`Swapping rooms: ${a.bot.name} to ${b.channel!.name}, ${b.bot.name} to ${a.channel!.name}`);
  };
  const servers = view.outputs.servers;
  return (
    <Pane
      id="op-rooms"
      title="All voice channels"
      icon="map"
      kind="plain"
      noMax
      status={{ text: `${view.inRooms} of ${view.bots.length} bots in rooms`, tone: "idle" }}
      summary={`${view.channelCount} channels in ${servers.length} servers`}
      actions={
        pair && (
          <button type="button" className="btn s" title={`${pair[0].bot.name} to ${pair[1].channel!.name}, ${pair[1].bot.name} to ${pair[0].channel!.name}`} onClick={swap}>
            <OpIcon name="swap" />
            Swap rooms
          </button>
        )
      }
    >
      {servers.length === 0 && (
        <p className="hint">
          No voice channels yet: connect a bot to Discord in <a href="#/settings">Settings</a>.
        </p>
      )}
      {servers.map((server) => (
        <section className="op-srv" aria-labelledby={`op-srv-${server.id}`} key={server.id}>
          <h3 className="op-srv-h" id={`op-srv-${server.id}`}>
            <Icon name="users" size="s" />
            <span className="ellipsis">{server.name}</span>
          </h3>
          <ul className="list op-chs">
            {server.channels.map((channel) => (
              <ChannelRow key={channel.id} view={view} serverId={server.id} channelId={channel.id} actions={actions} />
            ))}
          </ul>
        </section>
      ))}
      <p className="hint op-foot">
        <Icon name="gear" size="s" />
        <a href="#/settings">Tokens and new bots</a>
      </p>
    </Pane>
  );
}

function ChannelRow({ view, serverId, channelId, actions }: { view: OutputsView; serverId: string; channelId: string; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const channel = view.outputs.servers.find((s) => s.id === serverId)!.channels.find((c) => c.id === channelId)!;
  const here = roomBots(view, serverId, channelId);
  const n = channel.members.length;
  const choice = addBotChoice(view, serverId, channelId);
  const one = choice.one ? view.bots.find((v) => v.bot.id === choice.one) : undefined;
  const items = (): PopMenuEntry[] =>
    choice.choices.map(
      (c): PopMenuEntry => ({
        key: c.botId,
        className: "op-mi",
        onSelect: () => actions.move(view.bots.find((v) => v.bot.id === c.botId)!, channelId),
        content: (
          <>
            <Icon name="plus" size="s" />
            <span className="grow op-mi-t">
              <span className="op-mi-n">{c.name}</span>{" "}
              {c.leaves && (
                <span className="op-mi-w">
                  <OpIcon name="alert" />
                  Leaves {c.leaves}
                </span>
              )}
            </span>
          </>
        ),
      }),
    );
  const note = here.length ? " (the players would hear both)" : !n ? " (nobody is there yet)" : "";
  return (
    <li className={cx("op-ch", here.length > 0 && "live")}>
      <Icon name="horn" size="s" />
      <b className="op-ch-n ellipsis">{channel.name}</b>
      <span className="op-ch-who ellipsis" title={channel.members.join(", ")}>
        {n ? `${n}: ${channel.members.join(", ")}` : <span className="faint">Empty</span>}
      </span>
      <span className="op-ch-bots">
        {here.map((b) => (
          <span
            key={b.bot.id}
            className={cx("chip op-botchip", here.length > 1 && "op-twice")}
            title={`${b.bot.name}: ${pill(b, undefined).text}${here.length > 1 ? ". Two bots here: the players hear both" : ""}`}
          >
            {here.length > 1 ? <Icon name="warn" size="s" /> : <Icon name="broadcast" size="s" />}
            <span className="ellipsis">{b.bot.name}</span>
            <KickButton of={b} actions={actions} />
          </span>
        ))}
      </span>
      {here.length === 0 && choice.choices.length > 0 ? (
        <button
          ref={ref}
          type="button"
          className="btn s op-add"
          aria-haspopup={one ? undefined : "menu"}
          aria-expanded={one ? undefined : open}
          aria-controls={open ? menuId : undefined}
          aria-label={`Add bot to ${channel.name}`}
          title={(one ? `${one.bot.name} joins ${channel.name}` : `Choose a bot for ${channel.name}`) + note}
          onClick={() => (one ? actions.move(one, channelId) : setOpen(!open))}
        >
          <Icon name="plus" size="s" />
          Add
          {!one && <Icon name="chevdown" size="s" />}
        </button>
      ) : null}
      {open && (
        <PopMenu
          id={menuId}
          label={`Add a bot to ${channel.name}`}
          items={items()}
          anchor={ref}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus && ref.current && document.contains(ref.current)) ref.current.focus();
          }}
        />
      )}
    </li>
  );
}
