/**
 * One playlist (route `playlist/<id>`, playlists.js renderOne): a manual playlist's tracks in order with Add tracks,
 * or a dynamic playlist's rules with the matching tracks; beside them, where it is used and its details.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PlaylistRule, TagCondition } from "../../../common/domain";
import { isFx } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { Column, Pane } from "../../kit/Pane";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { hashOf } from "../../shell/routes";
import { useRememberedOpen } from "../../shell/ShellSettings";
import type { ScreenProps } from "../index";
import { fmt, fmtLong, KIND_NAMES, plural, ruleWords, shownTitle, tagsOf } from "./model";
import { nameUses, usePlaylistData, usedText, type PlaylistData } from "./playlistData";
import { DropNotice, DropZone, dropFiles, useDropState, useFileDrops, type DropTarget } from "./playlistDrops";
import { KindLane, matchesQuery, newlyMade, soundName, useDropActions } from "./playlistParts";
import { focusSoon, OnAirBarFallback, onAirPlaylistIds, onAirTrackIds, PopMenuButton, previewKey, useSoundMessages, useWriteOk, useWriteResult, type PopMenuEntry } from "./shared";
import { UseInDialog } from "./UseInDialog";
import "./library.css";
import "./playlists.css";

/** How many Add tracks results show at first, and how many more each "Show more" adds. */
const ADD_FIRST = 20;
const ADD_MORE = 25;
/** Typing a name is saved this long after the last key. */
const NAME_SAVE_MS = 400;
/** The Add tracks box's lane per playlist, kept for the visit (the prototype's addLane). */
const addLanes = new Map<string, "music" | "amb" | "fx">();

const haystack = (t: LibraryTrack) => [t.title, t.metaTitle, t.fileName, t.album, t.artist, t.folder, t.role ?? "", ...tagsOf(t)].join(" ").toLowerCase();
const laneTest = (lane: string) => (t: LibraryTrack) => (lane === "fx" ? isFx(t) : t.kind === lane);
function trackTip(t: LibraryTrack): string {
  const tags = tagsOf(t);
  return (
    shownTitle(t) +
    (t.title && t.metaTitle && t.metaTitle !== t.title ? `\nIn the file: ${t.metaTitle}` : "") +
    (t.title ? "" : "\nNo title of your own yet") +
    `\nFile: ${t.fileName}` +
    (tags.length ? `\nTags: ${tags.join(", ")}` : "") +
    (t.energy ? `\nEnergy ${t.energy} of 5` : "") +
    "\nClick to open in the Library"
  );
}

export function PlaylistPage({ route }: ScreenProps) {
  useSoundMessages();
  const data = usePlaylistData();
  const pl = data.playlists.find((p) => p.id === route.params.pid);
  if (!pl) {
    if (!data.ready) {
      return (
        <div className="viewhead">
          <h1>Playlist</h1>
        </div>
      );
    }
    return (
      <>
        <div className="viewhead">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href={hashOf("playlists")}>Playlists</a>
          </nav>
          <h1>Playlist not found</h1>
        </div>
        <div className="empty">
          This playlist no longer exists. <a href={hashOf("playlists")}>Back to all playlists</a>
        </div>
      </>
    );
  }
  return <OnePlaylist key={pl.id} pl={pl} data={data} />;
}

/**
 * A change made here shows at once, before the library answers (the prototype changes its data at once): `edit`
 * keeps the edited playlist until the library's next answer replaces the playlist, or a refusal drops it.
 */
export type EditPlaylist = (next: PlaylistInfo | null) => void;

function OnePlaylist({ pl: saved, data }: { pl: PlaylistInfo; data: PlaylistData }) {
  const [local, setLocal] = useState<{ base: PlaylistInfo; pl: PlaylistInfo } | null>(null);
  const pl = local && local.base === saved ? local.pl : saved;
  const edit: EditPlaylist = (next) => setLocal(next ? { base: saved, pl: next } : null);
  const api = useLyreApi();
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const { say, toast } = useAnnounce();
  const accept = useWriteResult();
  const ok = useWriteOk();
  const actions = useDropActions(data);
  const drops = useDropState();
  const tracks = pl === saved ? data.tracksOf(pl) : data.tracksNow(pl);
  const uses = data.usesOf(pl.id);
  const first = tracks[0];
  const airPlaylists = useMemo(() => onAirPlaylistIds(now), [now]);
  const airTracks = useMemo(() => onAirTrackIds(now), [now]);
  const air = airPlaylists.has(pl.id);
  const previewing = now.preview?.key ?? null;
  const pv = previewing === previewKey("playlist", pl.id) || tracks.some((t) => previewing === t.id);
  const [useIn, setUseIn] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useRememberedOpen("pl-details", true);
  const [addOpen, setAddOpen] = useRememberedOpen("pl-add", true);

  /* ----- the name: the heading follows the typing; saved shortly after ----- */
  const [name, setName] = useState(pl.name);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveName = (value: string) => {
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = null;
    // An empty name is not kept; the last one stays until a name is typed.
    if (value.trim() && value !== pl.name) void api.playlists.update(pl.id, { name: value }).then(accept);
  };
  useEffect(
    () => () => {
      if (nameTimer.current) clearTimeout(nameTimer.current);
    },
    [],
  );
  // A playlist just made from New playlist opens with its name ready to type.
  useEffect(() => {
    if (!newlyMade.has(pl.id)) return;
    newlyMade.delete(pl.id);
    setDetailsOpen(true);
    if (pl.kind === "manual") setAddOpen(true);
    focusSoon("plname", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, []);

  /* ----- files dropped on the page ----- */
  useFileDrops(
    (el, clientY): DropTarget | null => {
      if (pl.kind !== "manual") return { kind: "page", playlist: pl, index: null };
      const row = el?.closest<HTMLElement>('[data-pane="pl-tracks"] .pl-tr[draggable]');
      if (!row) return { kind: "page", playlist: pl, index: -1 };
      const r = row.getBoundingClientRect();
      const after = clientY > r.top + r.height / 2;
      return { kind: "page", playlist: pl, index: pl.trackIds.indexOf(row.dataset.tid as string) + (after ? 1 : 0) };
    },
    (t) =>
      t.kind !== "page" || pl.kind !== "manual"
        ? `Drop to add to your Library. They appear in ${pl.name} only when their tags match its rules.`
        : t.index !== null && t.index >= 0
          ? `Drop to add to ${pl.name} at position ${t.index + 1}. They also go into your Library.`
          : `Drop to add to ${pl.name} (at the end). They also go into your Library.`,
    (t, paths) => void dropFiles(actions, t, paths),
  );

  const main =
    pl.kind === "manual" ? (
      <>
        <TracksPane pl={pl} edit={edit} tracks={tracks} air={air} airTracks={airTracks} previewing={previewing} data={data} flash={drops.flash} onAdd={() => {
          setAddOpen(true);
          focusSoon("plq");
        }} />
        <AddPane pl={pl} edit={edit} data={data} airTracks={airTracks} previewing={previewing} open={addOpen} onOpenChange={setAddOpen} />
      </>
    ) : (
      <>
        <RulesPane pl={pl} edit={edit} data={data} matches={tracks.length} />
        <Pane
          id="pl-match"
          title="Matching tracks"
          icon="list"
          kind="music"
          flush
          status={air ? { text: "Playing", tone: "live" } : tracks.length ? { text: "Ready" } : { text: "Empty" }}
          summary={`${plural(tracks.length, "track")} · ${fmtLong(tracks.reduce((s, t) => s + t.durationMs, 0))}`}
          actions={
            <button
              type="button"
              className="btn s"
              title="Freeze these tracks into a new Manual playlist you can reorder"
              disabled={!tracks.length}
              onClick={async () => {
                const made = accept(await api.playlists.copyAsManual(pl.id));
                if (!made) return;
                window.location.hash = hashOf(`playlist/${made.id}`);
                toast(`Manual copy with ${plural(made.kind === "manual" ? made.trackIds.length : 0, "track")}. It will not change when tags change.`);
              }}
            >
              <Icon name="hand" size="s" />
              Make a manual copy
            </button>
          }
        >
          {tracks.length ? (
            <div className="pl-scroll">
              <ul className="pl-tracks" aria-label="Matching tracks">
                {tracks.map((t) => (
                  <TrackRow key={t.id} t={t} pl={pl} prefix="x-" data={data} onAir={airTracks.has(t.id)} previewing={previewing} />
                ))}
              </ul>
            </div>
          ) : (
            <div className="empty">No tracks match these rules yet. Loosen a condition or widen the energy range.</div>
          )}
        </Pane>
      </>
    );

  return (
    <>
      <div className="viewhead pl-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href={hashOf("playlists")}>Playlists</a>
          <span className="sep">›</span>
        </nav>
        <h1 className="pl-h1" title={name}>
          {name || "Untitled playlist"}
        </h1>
        <button
          type="button"
          className="closer"
          title="Rename"
          aria-label="Rename this playlist"
          onClick={() => {
            setDetailsOpen(true);
            focusSoon("plname", true);
          }}
        >
          <Icon name="edit" />
        </button>
        <span className="pl-headchips">
          <KindLane pl={pl} />
        </span>
        <span className="grow" />
        {air && (
          <span className="badge onair" title="Playing from this playlist">
            On air
          </span>
        )}
        <button
          type="button"
          className="btn pl-pvbtn"
          aria-pressed={pv}
          disabled={!first}
          title={pv ? "Stop the preview" : "Play the first track in your headphones only"}
          onClick={() => {
            if (pv) {
              audio.stopPreview();
              say("Preview stopped");
            } else audio.previewPlaylist(pl.id);
          }}
        >
          <Icon name={pv ? "stop" : "headphones"} size="s" />
          {pv ? "Stop preview" : "Preview"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!first}
          title="Start the first track for the players"
          onClick={() => {
            if (!first) return;
            const r = first.kind === "fx" ? audio.playTrack(first.id) : audio.playPlaylist(pl.id, { fadeMs: 3000 });
            if (r.ok) toast(`On air: ${shownTitle(first)}`);
          }}
        >
          <Icon name="broadcast" size="s" />
          Play on air
        </button>
        <button type="button" className="btn" onClick={() => setUseIn(true)}>
          <Icon name="link" size="s" />
          Use in…
        </button>
      </div>
      <div className="viewbody pl-body">
        <DropNotice where={`page:${pl.id}`} actions={actions} playlists={data.playlists} />
        <div className="pl-page">
          <Column className="pl-main">{main}</Column>
          <Column className="pl-side">
            <UsesPane data={data} uses={uses} onUseIn={() => setUseIn(true)} />
            <Pane id="pl-details" title="Details" icon="edit" kind="plain" size="auto" status={{ text: "Saved" }} summary={pl.notes ? "Has notes" : ""} open={detailsOpen} onOpenChange={setDetailsOpen}>
              <DetailsBody
                pl={pl}
                name={name}
                onName={(value) => {
                  setName(value);
                  if (nameTimer.current) clearTimeout(nameTimer.current);
                  nameTimer.current = setTimeout(() => saveName(value), NAME_SAVE_MS);
                }}
                onNameDone={() => saveName(name)}
                onDelete={() => setDeleting(true)}
              />
            </Pane>
          </Column>
        </div>
      </div>
      <DropZone />
      <OnAirBarFallback />
      {useIn && <UseInDialog playlist={pl} campaigns={data.campaigns} nameOf={soundName(data)} onClose={() => setUseIn(false)} />}
      <Dialog
        open={deleting}
        title={`Delete "${pl.name || "Untitled playlist"}"?`}
        onClose={() => setDeleting(false)}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Keep it</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                setDeleting(false);
                if (!ok(await api.playlists.delete(pl.id))) return;
                window.location.hash = hashOf("playlists");
                toast(`Deleted "${pl.name}"`);
              }}
            >
              Delete playlist
            </Button>
          </>
        }
      >
        {uses.length ? (
          <>
            <p>It is used in {usedText(uses)}. Deleting it takes it out of these:</p>
            <ul className="pl-dellist">
              {nameUses(uses, data.campaigns).map((u) => (
                <li key={u.label}>{u.label}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>It is not used in any campaign, session or scene.</p>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          The tracks stay in your library.
        </p>
      </Dialog>
    </>
  );
}

/* ---------- one track's line ---------- */

function TrackRow({
  t,
  pl,
  prefix,
  data,
  onAir,
  previewing,
  manual,
  add,
  flash,
  dropMark,
}: {
  t: LibraryTrack;
  pl: PlaylistInfo;
  prefix: string;
  data: PlaylistData;
  onAir: boolean;
  previewing: string | null;
  /** Its place in a manual playlist (1-based): drawn with a grip and number, draggable, with Move and Remove. */
  manual?: { pos: number; count: number; onMove: (to: number) => void; onRemove: () => void };
  /** In the Add tracks box: an Add button, or a tick when it is in the playlist already. */
  add?: { inList: boolean; onAdd: () => void };
  flash?: boolean;
  /** A row being dragged would land above or below this one. */
  dropMark?: "before" | "after" | null;
}) {
  const audio = useLyreAudio();
  const title = shownTitle(t);
  const pv = previewing === t.id;
  const own = !add && !!data.overrides[`pl:${pl.id}`]?.[t.id];
  const inThis = pl.kind === "manual" ? pl.trackIds.includes(t.id) : data.tracksOf(pl).some((x) => x.id === t.id);
  const menu = (): PopMenuEntry[] => {
    const entries: PopMenuEntry[] = [];
    if (manual) {
      const at = manual.pos - 1;
      entries.push(
        {
          content: (
            <>
              <Icon name="chevup" size="s" />
              Move up<span className="kbd pl-mk">Alt+↑</span>
            </>
          ),
          disabled: at === 0,
          onSelect: () => manual.onMove(at - 1),
        },
        {
          content: (
            <>
              <Icon name="chevdown" size="s" />
              Move down<span className="kbd pl-mk">Alt+↓</span>
            </>
          ),
          disabled: at === manual.count - 1,
          onSelect: () => manual.onMove(at + 1),
        },
        {
          content: (
            <>
              <Icon name="close" size="s" />
              Remove from this playlist
            </>
          ),
          onSelect: manual.onRemove,
        },
        { separator: true },
      );
    }
    entries.push(
      {
        content: (
          <>
            <Icon name="wave" size="s" />
            Audio profile in this playlist
          </>
        ),
        onSelect: () => (window.location.hash = hashOf(`profile/${t.id}/pl:${pl.id}`)),
      },
      {
        content: (
          <>
            <Icon name="library" size="s" />
            Open in the Library
          </>
        ),
        onSelect: () => (window.location.hash = hashOf(`library/${t.id}`)),
      },
    );
    return entries;
  };
  return (
    <li className={cx("pl-tr", pv && "pl-is-pv", flash && "pl-flash", dropMark && `pl-drop-${dropMark}`)} data-tid={t.id} draggable={manual ? true : undefined}>
      {manual && (
        <>
          <span className="pl-grip" title="Drag to change the order" aria-hidden="true">
            <Icon name="drag" />
          </span>
          <span className="pl-pos num">{manual.pos}</span>
        </>
      )}
      <div className="pl-tline">
        <a className="pl-tname" href={hashOf(`library/${t.id}`)} title={trackTip(t)}>
          {title}
        </a>
        {own && (
          <span className="pl-own" title="Has its own audio profile in this playlist">
            <span className="pl-own-dot" aria-hidden="true" />
            <span className="sr-only">Own audio profile in this playlist</span>
          </span>
        )}
        {onAir && <span className="badge onair">On air</span>}
        {isFx(t) && (
          <span className="chip">
            <span className="lane-dot fx" />
            {t.kind === "fx" ? "FX" : "FX · Sting"}
          </span>
        )}
      </div>
      <span className="num muted pl-dur">{fmt(t.durationMs)}</span>
      <span className="pl-tacts">
        <button
          type="button"
          className="btn s icon pv"
          aria-pressed={pv}
          title={pv ? "Stop preview" : "Preview in your headphones"}
          aria-label={`${pv ? "Stop preview of" : "Preview"} ${title}`}
          onClick={() => audio.previewTrack(t.id)}
        >
          <Icon name={pv ? "stop" : "headphones"} size="s" />
        </button>
        <button
          type="button"
          className="btn s icon"
          title={`Play on air (the players hear it)${t.kind === "fx" ? ", over the music" : ""}`}
          aria-label={`Play on air: ${title}`}
          onClick={() => (t.kind === "fx" ? audio.playTrack(t.id) : audio.playTrack(t.id, inThis ? { from: { playlistId: pl.id } } : undefined))}
        >
          <Icon name="broadcast" size="s" />
        </button>
        {add ? (
          add.inList ? (
            <button type="button" className="btn s icon pl-added" aria-disabled="true" title="Already in this playlist" aria-label={`${title} is already in this playlist`} onClick={add.onAdd}>
              <Icon name="check" size="s" />
            </button>
          ) : (
            <button type="button" className="btn s icon" title="Add to this playlist" aria-label={`Add ${title}`} onClick={add.onAdd}>
              <Icon name="plus" size="s" />
            </button>
          )
        ) : (
          <PopMenuButton label={`More for ${title}`} ariaLabel={`More for ${title}`} title="More" className="btn s icon ghost pl-more-btn" focusKey={`${prefix}more-${t.id}`} items={menu}>
            <Icon name="more" size="s" />
          </PopMenuButton>
        )}
      </span>
    </li>
  );
}

/* ---------- a manual playlist's tracks ---------- */

function TracksPane({
  pl,
  edit,
  tracks,
  air,
  airTracks,
  previewing,
  data,
  flash,
  onAdd,
}: {
  pl: Extract<PlaylistInfo, { kind: "manual" }>;
  edit: EditPlaylist;
  tracks: LibraryTrack[];
  air: boolean;
  airTracks: ReadonlySet<string>;
  previewing: string | null;
  data: PlaylistData;
  flash: string[];
  onAdd: () => void;
}) {
  const api = useLyreApi();
  const { say } = useAnnounce();
  const ok = useWriteOk();
  const drag = useRef<string | null>(null);
  const [mark, setMark] = useState<{ id: string; after: boolean } | null>(null);

  const moveTo = async (tid: string, to: number) => {
    const from = pl.trackIds.indexOf(tid);
    const target = Math.max(0, Math.min(pl.trackIds.length - 1, to));
    if (from < 0 || target === from) return;
    const order = pl.trackIds.filter((x) => x !== tid);
    order.splice(target, 0, tid);
    edit({ ...pl, trackIds: order });
    if (!ok(await api.playlists.moveTrack(pl.id, tid, target))) {
      edit(null);
      return;
    }
    const t = data.byId.get(tid);
    say(`Moved ${t ? shownTitle(t) : "the track"} to position ${target + 1} of ${pl.trackIds.length}`);
    focusSoon(`m-more-${tid}`);
  };
  const remove = async (tid: string) => {
    const i = pl.trackIds.indexOf(tid);
    const rest = pl.trackIds.filter((x) => x !== tid);
    edit({ ...pl, trackIds: rest });
    if (!ok(await api.playlists.removeTrack(pl.id, tid))) {
      edit(null);
      return;
    }
    const next = rest[i] ?? rest[i - 1];
    const t = data.byId.get(tid);
    say(`Removed ${t ? shownTitle(t) : "the track"}. ${plural(rest.length, "track")} left.`);
    focusSoon(next ? `m-more-${next}` : "pladdopen");
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".pl-tr[draggable]");
    if (!row) return;
    e.preventDefault();
    const tid = row.dataset.tid as string;
    void moveTo(tid, pl.trackIds.indexOf(tid) + (e.key === "ArrowUp" ? -1 : 1));
  };
  const total = tracks.reduce((s, t) => s + t.durationMs, 0);

  return (
    <Pane
      id="pl-tracks"
      title="Tracks"
      icon="list"
      kind="music"
      flush
      size="auto"
      status={air ? { text: "Playing", tone: "live" } : tracks.length ? { text: "Ready" } : { text: "Empty" }}
      summary={`${plural(tracks.length, "track")} · ${fmtLong(total)}`}
      actions={
        <button type="button" className="btn s" data-focus="pladdopen" onClick={onAdd}>
          <Icon name="plus" size="s" />
          Add tracks
        </button>
      }
    >
      {tracks.length ? (
        <>
          <div className="pl-scroll">
            <ol
              className="pl-tracks"
              aria-label="Tracks in order"
              onKeyDown={onKeyDown}
              onDragStart={(e) => {
                const li = (e.target as HTMLElement).closest<HTMLElement>(".pl-tr[draggable]");
                if (!li) return;
                drag.current = li.dataset.tid as string;
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", drag.current);
                } catch {
                  /* older engines */
                }
                li.classList.add("pl-dragging");
              }}
              onDragEnd={(e) => {
                drag.current = null;
                (e.target as HTMLElement).closest(".pl-tr")?.classList.remove("pl-dragging");
                setMark(null);
              }}
              onDragOver={(e) => {
                const li = (e.target as HTMLElement).closest<HTMLElement>(".pl-tr[draggable]");
                if (!drag.current || !li) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = li.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (mark?.id !== li.dataset.tid || mark.after !== after) setMark({ id: li.dataset.tid as string, after });
              }}
              onDrop={(e) => {
                const li = (e.target as HTMLElement).closest<HTMLElement>(".pl-tr[draggable]");
                const id = drag.current;
                if (!id || !li) return;
                e.preventDefault();
                drag.current = null;
                setMark(null);
                if (li.dataset.tid === id) return;
                const r = li.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                const others = pl.trackIds.filter((x) => x !== id);
                void moveTo(id, others.indexOf(li.dataset.tid as string) + (after ? 1 : 0));
              }}
            >
              {tracks.map((t, i) => (
                <TrackRow
                    key={t.id}
                    dropMark={mark?.id === t.id ? (mark.after ? "after" : "before") : null}
                    t={t}
                    pl={pl}
                    prefix="m-"
                    data={data}
                    onAir={airTracks.has(t.id)}
                    previewing={previewing}
                    flash={flash.includes(t.id)}
                    manual={{ pos: i + 1, count: tracks.length, onMove: (to) => void moveTo(t.id, to), onRemove: () => void remove(t.id) }}
                  />
              ))}
            </ol>
          </div>
          <p className="hint pl-foot">Drag rows, or press Alt+Up / Alt+Down, to change the order.</p>
        </>
      ) : (
        <div className="empty">
          No tracks yet. Add them from <b>Add tracks</b>, or drop audio files or folders here.
        </div>
      )}
    </Pane>
  );
}

/* ---------- Add tracks ---------- */

function AddPane({
  pl,
  edit,
  data,
  airTracks,
  previewing,
  open,
  onOpenChange,
}: {
  pl: Extract<PlaylistInfo, { kind: "manual" }>;
  edit: EditPlaylist;
  data: PlaylistData;
  airTracks: ReadonlySet<string>;
  previewing: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  const accept = useWriteResult();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(ADD_FIRST);
  const [lane, setLaneState] = useState(addLanes.get(pl.id) ?? pl.lane);
  const q = query.trim();
  const hits = useMemo(() => {
    const pool = data.tracks.filter(laneTest(lane));
    return q ? pool.filter((t) => matchesQuery(haystack(t), q)) : pool;
  }, [data.tracks, lane, q]);
  const add = async (t: LibraryTrack) => {
    if (pl.trackIds.includes(t.id)) {
      toast("Already in this playlist");
      return;
    }
    edit({ ...pl, trackIds: [...pl.trackIds, t.id] });
    if (accept(await api.playlists.addTracks(pl.id, [t.id]))) say(`Added ${shownTitle(t)} at position ${pl.trackIds.length + 1}`);
    else edit(null);
  };
  return (
    <Pane id="pl-add" title="Add tracks" icon="search" kind="search" flush status={{ text: "Ready" }} summary="Search the library, or drop files here" open={open} onOpenChange={onOpenChange}>
      <div className="pl-addbar">
        <div className="search grow">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            data-focus="plq"
            value={query}
            placeholder="Any name or tag: Abbess, Eerie, Conan, Lothlorien…"
            aria-label="Search the library by any name or tag"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(ADD_FIRST);
            }}
          />
        </div>
        <div className="seg s" role="group" aria-label="Search in">
          {(["music", "amb", "fx"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lane === l}
              onClick={() => {
                addLanes.set(pl.id, l);
                setLaneState(l);
                setLimit(ADD_FIRST);
                say(`Searching ${KIND_NAMES[l]}`);
              }}
            >
              {KIND_NAMES[l]}
            </button>
          ))}
        </div>
        <span className="muted pl-count" aria-live="polite">
          {q ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}` : plural(hits.length, "track")}
        </span>
      </div>
      <div className="pl-scroll">
        {hits.length ? (
          <>
            <ul className="pl-tracks">
              {hits.slice(0, limit).map((t) => (
                <TrackRow key={t.id} t={t} pl={pl} prefix="a-" data={data} onAir={airTracks.has(t.id)} previewing={previewing} add={{ inList: pl.trackIds.includes(t.id), onAdd: () => void add(t) }} />
              ))}
            </ul>
            {hits.length > limit && (
              <div className="pl-more">
                <button
                  type="button"
                  className="btn s"
                  onClick={() => {
                    const firstNew = hits[limit];
                    setLimit(limit + ADD_MORE);
                    setTimeout(() => document.querySelector<HTMLElement>(`[data-pane="pl-add"] .pl-tr[data-tid="${firstNew.id}"] a`)?.focus(), 30);
                  }}
                >
                  Show {Math.min(ADD_MORE, hits.length - limit)} more of {hits.length}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty">Nothing in the library matches &quot;{q}&quot;.</div>
        )}
      </div>
    </Pane>
  );
}

/* ---------- a dynamic playlist's rules ---------- */

function RulesPane({ pl, edit, data, matches }: { pl: Extract<PlaylistInfo, { kind: "dynamic" }>; edit: EditPlaylist; data: PlaylistData; matches: number }) {
  const api = useLyreApi();
  const { say } = useAnnounce();
  const accept = useWriteResult();
  const rule = pl.rule;
  const en = rule.energy ?? [0, 5];
  const words = ruleWords(rule, data.groupNames);
  const waiting = rule.conds.some((c) => !c.values.length);
  const laneLower = KIND_NAMES[pl.lane].toLowerCase();

  /** Saves the changed rule (a full energy range and an unticked stings box are left out, as the prototype's cleanRule). */
  const change = async (next: PlaylistRule, message?: string, focus?: string) => {
    const clean: PlaylistRule = { conds: next.conds };
    if (next.energy && !(next.energy[0] <= 0 && next.energy[1] >= 5)) clean.energy = next.energy;
    if (next.leaveOutStings) clean.leaveOutStings = true;
    edit({ ...pl, rule: clean });
    const done = accept(await api.playlists.update(pl.id, { rule: clean }));
    if (!done) {
      edit(null);
      return;
    }
    const count = data.tracksNow(done).length;
    say(`${message ? `${message}. ` : ""}${plural(count, "track")} match`);
    if (focus) focusSoon(focus);
  };
  const setCond = (i: number, c: TagCondition) => rule.conds.map((x, j) => (j === i ? c : x));

  return (
    <Pane
      id="pl-rules"
      title="Rules"
      icon="rule"
      kind="search"
      size="auto"
      status={matches ? { text: "Ready" } : { text: "Empty", tone: "warn" }}
      summary={words || `Every ${laneLower} track`}
    >
      <div className="pl-conds">
        {rule.conds.length ? (
          rule.conds.map((c, i) => {
            const g = data.groups.find((x) => x.id === c.group) ?? data.groups[0];
            const gName = g?.name ?? c.group;
            const left = (g?.values ?? []).filter((v) => !c.values.includes(v));
            return (
              <div key={i} className="pl-cond" role="group" aria-label={`Condition ${i + 1}`}>
                <span className="pl-and faint">{i ? "and" : "Where"}</span>
                <select
                  className="input pl-sel"
                  aria-label={`Tag group, condition ${i + 1}`}
                  value={c.group}
                  onChange={(e) => {
                    const ng = data.groups.find((x) => x.id === e.target.value);
                    void change({ ...rule, conds: setCond(i, { ...c, group: e.target.value, values: [] }) }, `Tag group is now ${ng?.name ?? e.target.value}`);
                  }}
                >
                  {data.groups.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <span className="faint">matches</span>
                <select
                  className="input pl-sel"
                  aria-label={`How it matches, condition ${i + 1}`}
                  value={c.match}
                  onChange={(e) => void change({ ...rule, conds: setCond(i, { ...c, match: e.target.value as TagCondition["match"] }) })}
                >
                  <option value="any">any of</option>
                  <option value="all">all of</option>
                  <option value="none">none of</option>
                </select>
                <span className="chips pl-vals">
                  {c.values.map((v, j) => (
                    <span key={v} className="chip">
                      {v}
                      <button
                        type="button"
                        className="x"
                        title={`Remove ${v}`}
                        aria-label={`Remove ${v}`}
                        onClick={() => void change({ ...rule, conds: setCond(i, { ...c, values: c.values.filter((_, k) => k !== j) }) }, `Removed ${v}`, `va-${i}`)}
                      >
                        <Icon name="close" size="s" />
                      </button>
                    </span>
                  ))}
                  <ValueMenu
                    index={i}
                    groupName={gName}
                    values={left}
                    onPick={(v) => void change({ ...rule, conds: setCond(i, { ...c, values: [...c.values, v] }) }, `Added ${v}`, `va-${i}`)}
                  />
                  {!c.values.length && <span className="hint pl-warn">Needs a value</span>}
                </span>
                <button
                  type="button"
                  className="closer"
                  title="Remove this condition"
                  aria-label={`Remove condition ${i + 1}`}
                  data-focus={`cr-${i}`}
                  onClick={() => void change({ ...rule, conds: rule.conds.filter((_, k) => k !== i) }, "Condition removed", rule.conds.length > 1 ? "cr-0" : "plcadd")}
                >
                  <Icon name="trash" />
                </button>
              </div>
            );
          })
        ) : (
          <p className="muted">No conditions yet, so every {laneLower} track in the library matches.</p>
        )}
      </div>
      <div className="pl-rulebar">
        <button
          type="button"
          className="btn s"
          data-focus="plcadd"
          onClick={() => {
            const used = rule.conds.map((c) => c.group);
            const g = data.groups.find((x) => !used.includes(x.id)) ?? data.groups[0];
            if (!g) return;
            void change({ ...rule, conds: [...rule.conds, { group: g.id, match: "any", values: [] }] }, "Condition added", `va-${rule.conds.length}`);
          }}
        >
          <Icon name="plus" size="s" />
          Add condition
        </button>
        <span className="pl-energy">
          <span className="faint">Energy from</span>
          <select
            className="input pl-sel pl-num"
            aria-label="Lowest energy"
            value={en[0]}
            onChange={(e) => {
              const lo = Number(e.target.value);
              const next: [number, number] = lo > en[1] ? [en[1], lo] : [lo, en[1]];
              void change({ ...rule, energy: next }, `Energy ${next[0]} to ${next[1]}`);
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <span className="faint">to</span>
          <select
            className="input pl-sel pl-num"
            aria-label="Highest energy"
            value={en[1]}
            onChange={(e) => {
              const hi = Number(e.target.value);
              const next: [number, number] = en[0] > hi ? [hi, en[0]] : [en[0], hi];
              void change({ ...rule, energy: next }, `Energy ${next[0]} to ${next[1]}`);
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </span>
        <label className="pl-check">
          <input
            type="checkbox"
            checked={!!rule.leaveOutStings}
            onChange={(e) => void change({ ...rule, leaveOutStings: e.target.checked }, e.target.checked ? "Stings left out" : "Stings included")}
          />
          Leave out stings
        </label>
      </div>
      <p className="pl-words">
        <span className="faint">In plain words:</span> {KIND_NAMES[pl.lane]} tracks{words ? ` with ${words}` : ", all of them"}.
        {waiting && <span className="pl-warn"> A condition still needs a value, so nothing matches yet.</span>}
      </p>
    </Pane>
  );
}

/** "Add mood": a menu of the group's values with a box to filter them (Enter adds the first match). */
function ValueMenu({ index, groupName, values, onPick }: { index: number; groupName: string; values: string[]; onPick: (v: string) => void }) {
  const [filter, setFilter] = useState("");
  const lower = groupName.toLowerCase();
  const shown = values.filter((v) => v.toLowerCase().includes(filter.toLowerCase()));
  return (
    <PopMenuButton
      label={`Add a ${lower}`}
      className="btn s ghost"
      focusKey={`va-${index}`}
      top={
        <div className="pl-mq">
          <input
            className="input"
            type="search"
            placeholder="Type to filter"
            aria-label={`Filter ${lower} values`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                (e.currentTarget.closest(".menu")?.querySelector('button[role="menuitem"]:not([hidden])') as HTMLButtonElement | null)?.click();
              }
            }}
          />
        </div>
      }
      items={() =>
        values.length
          ? values.map((v) => ({ key: v, hidden: !v.toLowerCase().includes(filter.toLowerCase()), content: <span className="chip">{v}</span>, onSelect: () => onPick(v) }))
          : [{ group: `Every ${lower} is already in this condition.` }]
      }
    >
      <Icon name="plus" size="s" />
      Add {lower}
    </PopMenuButton>
  );
}

/* ---------- Used in and Details ---------- */

function UsesPane({ data, uses, onUseIn }: { data: PlaylistData; uses: ReturnType<PlaylistData["usesOf"]>; onUseIn: () => void }) {
  const named = nameUses(uses, data.campaigns);
  const LEVEL = { campaign: "Campaign", session: "Session", scene: "Scene" } as const;
  return (
    <Pane
      id="pl-uses"
      title="Used in"
      icon="link"
      kind="scenes"
      size="auto"
      flush
      status={uses.length ? { text: "Ready" } : { text: "Empty" }}
      actions={
        <button type="button" className="btn s" onClick={onUseIn}>
          Use in…
        </button>
      }
    >
      {named.length ? (
        <ul className="list">
          {named.map((n, i) => {
            const u = n.use;
            const href = u.level === "campaign" ? hashOf(`campaign/${u.campaignId}`) : hashOf(`session/${u.campaignId}/${u.sessionId}`);
            const main = u.level === "campaign" ? n.campaign.name : u.level === "session" ? `Session ${n.sessionNumber}: ${n.sessionName}` : n.sceneName;
            const amb = u.level === "scene" && u.role === "ambience";
            const pos = u.level === "scene" ? (amb ? "Amb." : `${u.position + 1} of ${n.sceneItems}`) : "";
            const sub =
              u.level === "campaign"
                ? "Whole campaign"
                : u.level === "session"
                  ? `${n.campaign.name} · that evening`
                  : `${amb ? "Ambience in this scene" : `Plays in this scene (${pos})`} · Session ${n.sessionNumber} · ${n.campaign.name}`;
            return (
              <li key={i} className="lrow pl-use" title={`${main}\n${sub}`}>
                <span className="pl-lv">{LEVEL[u.level]}</span>
                <a className="ellipsis pl-ulink grow" href={href}>
                  {main}
                  <span className="sr-only">, {sub}</span>
                </a>
                {pos && <span className="num muted pl-upos">{pos}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">Not used yet.</div>
      )}
      <p className="hint pl-levels">Campaign: every session. Session: that evening. Scene: plays in that scene, in its place in the list.</p>
    </Pane>
  );
}

function DetailsBody({ pl, name, onName, onNameDone, onDelete }: { pl: PlaylistInfo; name: string; onName: (v: string) => void; onNameDone: () => void; onDelete: () => void }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const [notes, setNotes] = useState(pl.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNotes = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (value !== pl.notes) void api.playlists.update(pl.id, { notes: value }).then(accept);
  };
  return (
    <div className="stack pl-details">
      <div className="field">
        <label htmlFor="pl-name">Name</label>
        <input id="pl-name" className="input" type="text" data-focus="plname" value={name} onChange={(e) => onName(e.target.value)} onBlur={onNameDone} />
      </div>
      <p className="pl-facts" title={pl.kind === "manual" ? "Manual: you pick the tracks and their order." : "Dynamic: Lyre fills it with every track that matches the rules, including tracks you tag later."}>
        <KindLane pl={pl} />
      </p>
      <div className="field">
        <label htmlFor="pl-notes">Notes</label>
        <textarea
          id="pl-notes"
          className="input"
          rows={3}
          placeholder="When to use it, what to avoid…"
          value={notes}
          onChange={(e) => {
            const value = e.target.value;
            setNotes(value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => saveNotes(value), NAME_SAVE_MS);
          }}
          onBlur={() => saveNotes(notes)}
        />
      </div>
      <div className="row-flex pl-danger">
        <span className="grow" />
        <button type="button" className="btn s danger" onClick={onDelete}>
          <Icon name="trash" size="s" />
          Delete playlist…
        </button>
      </div>
    </div>
  );
}
