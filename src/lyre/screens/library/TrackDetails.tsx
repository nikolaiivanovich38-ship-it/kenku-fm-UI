/**
 * One track's Details (library.js detailsBody): your title beside the title in the file, the file name and folder;
 * Preview, Play on air and the Audio profile; tags by typing; energy, role, looping and notes; the playlists it is in
 * and the scenes that use it.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { isFx, matchesRule, usesOfPlaylist, usesOfTrack, type ProfileOverrides } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PlaylistInfo, TagGroup } from "../../../common/lyre/api";
import { tagValue } from "../../../common/lyre/text";
import { useLyreApi } from "../../api";
import { useLyreAudio } from "../../audio";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { addedText, EFFECT_ROLE, ENERGY_WORDS, fmt, KIND_NAMES, LOOPS, plural, profileSummary, ROLES, shownTitle } from "./model";
import { focusSoon, useWriteOk, useWriteResult } from "./shared";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { ProfileLink } from "../../kit/ProfileLink";
import { previewKeyOf } from "../../kit/SoundButtons";
import type { TrackStore } from "./trackStore";

/** Typing in Your title or Notes is saved this long after the last key, as one change. */
const TYPING_SAVE_MS = 400;

export interface TrackDetailsProps {
  t: LibraryTrack;
  store: TrackStore;
  groups: TagGroup[];
  playlists: PlaylistInfo[];
  campaigns: CampaignInfo[];
  overrides: ProfileOverrides;
  previewing: string | null;
  /** A new manual playlist with these tracks (library.js newPlaylist). */
  onNewPlaylist: (ids: string[]) => void;
}

export function TrackDetails({ t, store, groups, playlists, campaigns, overrides, previewing, onNewPlaylist }: TrackDetailsProps) {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const { say, toast } = useAnnounce();
  const accept = useWriteResult();

  /* ----- Your title and notes: shown as typed, saved shortly after ----- */
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null; patch: { title?: string; notes?: string } }>({ timer: null, patch: {} });
  const flush = () => {
    const p = pending.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    const patch = p.patch;
    p.patch = {};
    if (Object.keys(patch).length) {
      void api.library.updateTrack(t.id, patch).then((r) => {
        const done = accept(r);
        if (done) store.put(done);
      });
    }
  };
  const saveSoon = (patch: { title?: string; notes?: string }) => {
    const p = pending.current;
    p.patch = { ...p.patch, ...patch };
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(flush, TYPING_SAVE_MS);
  };
  // A different track: show its words; leaving: save what was typed.
  useEffect(() => {
    setTitle(t.title);
    setNotes(t.notes);
    return flush;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another track opens
  }, [t.id]);

  const changeTitle = (value: string) => {
    setTitle(value);
    store.update(t.id, (now) => ({ ...now, title: value }));
    saveSoon({ title: value });
  };
  const write = async (patch: Parameters<typeof api.library.updateTrack>[1]) => {
    const done = accept(await api.library.updateTrack(t.id, patch));
    if (done) store.put(done);
    return done;
  };

  const shown = shownTitle({ ...t, title });
  const previewOn = previewing === previewKeyOf({ kind: "track", id: t.id });
  const roles = t.kind === "fx" ? [EFFECT_ROLE, ...ROLES] : ROLES;

  return (
    <div className="lb-d">
      <div className="field">
        <label htmlFor="lb-title">Your title</label>
        <input
          id="lb-title"
          data-focus="lb-title"
          className="input"
          value={title}
          placeholder="A title you will recognise at the table"
          onChange={(e) => changeTitle(e.target.value)}
          onBlur={flush}
        />
      </div>
      {!title && t.metaTitle && (
        <p className="lb-warn">
          <button
            type="button"
            className="btn s ghost"
            onClick={() => {
              changeTitle(t.metaTitle);
              flush();
              focusSoon("lb-title", true);
              say(`Your title is now ${t.metaTitle}. Type to change it.`);
            }}
          >
            <Icon name="edit" size="s" />
            Use the title in the file
          </button>
        </p>
      )}
      <dl className="lb-names">
        <dt>Title in the file</dt>
        <dd>{t.metaTitle ? t.metaTitle : <span className="lb-none">The file has no title</span>}</dd>
        <dt>File name</dt>
        <dd className="lb-file">{t.fileName}</dd>
        <dt>Folder</dt>
        <dd>
          <span className="lb-path">{t.folder}</span>
          <span className="lb-pathbtns">
            <button
              type="button"
              className="btn s"
              onClick={() => {
                const path = t.folder ? `${t.folder}\\${t.fileName}` : t.fileName;
                try {
                  void navigator.clipboard?.writeText(path).catch((): void => undefined);
                } catch {
                  /* the clipboard is not available: the toast still shows the path */
                }
                toast(`Path copied: ${path}`);
              }}
            >
              <Icon name="file" size="s" />
              Copy path
            </button>
            <button type="button" className="btn s" onClick={() => void api.library.showInFolder(t.id).then(accept)}>
              <Icon name="folder" size="s" />
              Show in folder
            </button>
          </span>
        </dd>
        <dt>Artist</dt>
        <dd>{t.artist}</dd>
        <dt>Album</dt>
        <dd>{t.album}</dd>
        <dt>Length</dt>
        <dd className="num">{fmt(t.durationMs)}</dd>
        <dt>Added</dt>
        <dd>
          {addedText(t.addedAt)}
          {t.isNew && (
            <>
              {" "}
              <span className="badge lb-newb">New</span>
            </>
          )}
        </dd>
      </dl>
      <div className="lb-acts">
        <button type="button" className="btn s lb-pvbtn" aria-pressed={previewOn} onClick={() => audio.previewTrack(t.id)}>
          <Icon name={previewOn ? "stop" : "headphones"} size="s" />
          {previewOn ? "Stop preview" : "Preview"}
        </button>
        <button
          type="button"
          className="btn s"
          onClick={() => {
            const r = audio.playTrack(t.id, { fadeMs: 3000 });
            if (r.ok) toast(`On air: ${shown}`);
          }}
        >
          <Icon name="broadcast" size="s" />
          Play on air
        </button>
        <ProfileLink trackId={t.id} title={shown} hasOwn={!!t.profile} />
      </div>
      <p className="lb-prof">
        <Icon name="fade" size="s" />
        <span>{profileSummary(t, overrides)}</span>
      </p>

      <section className="lb-sec" aria-labelledby="lb-h-tags">
        <h3 className="lb-h" id="lb-h-tags">
          Tags
        </h3>
        {groups.map((g) => (
          <TagRow key={g.id} t={t} group={g} store={store} />
        ))}
      </section>

      <section className="lb-sec" aria-labelledby="lb-h-play">
        <h3 className="lb-h" id="lb-h-play">
          How it plays
        </h3>
        <div className="lb-tg">
          <div className="lb-tgl">Energy</div>
          <div className="seg s lb-seg24" role="group" aria-label="Energy, 1 calm to 5 intense">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={t.energy === n}
                title={ENERGY_WORDS[n - 1]}
                onClick={async () => {
                  const done = await write({ energy: t.energy === n ? null : n });
                  if (done) say(done.energy ? `Energy ${n}` : "Energy cleared");
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="lb-tg">
          <div className="lb-tgl">Role</div>
          <ChoiceChips label="Role" options={roles} value={t.role} onChoose={(v) => void write({ role: t.role === v ? null : v })} />
        </div>
        <div className="lb-tg">
          <div className="lb-tgl">Looping</div>
          <ChoiceChips label="Loop advice" options={LOOPS} value={t.loop} onChoose={(v) => void write({ loop: t.loop === v ? null : v })} />
        </div>
        <div className="lb-tg">
          <label className="lb-tgl" htmlFor="lb-notes">
            Notes
          </label>
          <textarea
            id="lb-notes"
            className="input"
            rows={2}
            value={notes}
            placeholder="Cues, where it fades, what it reminds you of"
            onChange={(e) => {
              setNotes(e.target.value);
              saveSoon({ notes: e.target.value });
            }}
            onBlur={flush}
          />
        </div>
      </section>

      <InPlaylists t={t} playlists={playlists} onNewPlaylist={onNewPlaylist} />
      <UsedIn t={t} playlists={playlists} campaigns={campaigns} />
    </div>
  );
}

function ChoiceChips<T extends string>({ label, options, value, onChoose }: { label: string; options: readonly (readonly [T, string])[]; value: T | null; onChoose: (v: T) => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className="chip lb-pick" aria-pressed={value === v} onClick={() => onChoose(v)}>
          {value === v && <Icon name="check" size="s" />}
          {text}
        </button>
      ))}
    </div>
  );
}

/* ---------- tags by typing: a combobox per group ---------- */

function TagRow({ t, group, store }: { t: LibraryTrack; group: TagGroup; store: TrackStore }) {
  const api = useLyreApi();
  const { say } = useAnnounce();
  const accept = useWriteResult();
  const mine = useMemo(() => t.tags[group.id] ?? [], [t.tags, group.id]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-lbx`;
  const groupLower = group.name.toLowerCase();

  const options = useMemo(() => {
    if (!open) return [];
    const needle = q.trim().toLowerCase();
    const values = group.values.filter((v) => !mine.includes(v) && (!needle || v.toLowerCase().includes(needle)));
    values.sort((a, b) => Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle)));
    const out: { value: string; isNew: boolean }[] = values.slice(0, 8).map((value) => ({ value, isNew: false }));
    if (needle && !group.values.some((v) => v.toLowerCase() === needle)) out.push({ value: tagValue(q), isNew: true });
    return out;
  }, [open, q, group.values, mine]);
  const showList = open && options.length > 0;
  const active = Math.min(act, Math.max(0, options.length - 1));

  const pick = async (raw: string) => {
    const value = tagValue(raw);
    if (!value) return;
    setQ("");
    setOpen(false);
    setAct(0);
    const done = accept(await api.tags.tagTracks({ trackIds: [t.id], add: [{ group: group.id, value }] }));
    if (!done) return;
    const made = done.created.length > 0;
    const known = group.values.find((v) => v.toLowerCase() === value.toLowerCase()) ?? value;
    store.update(t.id, (now) => {
      const have = now.tags[group.id] ?? [];
      return { ...now, tags: { ...now.tags, [group.id]: have.includes(known) ? have : [...have, known] } };
    });
    say(`${made ? "Created and added" : "Added"} ${known} to ${group.name}`);
    inputRef.current?.focus();
  };
  const remove = async (value: string) => {
    const done = accept(await api.tags.tagTracks({ trackIds: [t.id], remove: [{ group: group.id, value }] }));
    if (!done) return;
    store.update(t.id, (now) => ({ ...now, tags: { ...now.tags, [group.id]: (now.tags[group.id] ?? []).filter((v) => v !== value) } }));
    say(`Removed ${value} from ${group.name}`);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setAct(0);
      } else if (options.length) setAct((active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showList && options[active]) void pick(options[active].value);
      else if (q.trim()) void pick(q);
    } else if (event.key === "Escape" && (open || q)) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      say("Cancelled");
    }
  };

  return (
    <div className="lb-tg">
      <div className="lb-tgl">{group.name}</div>
      <div className="chips">
        {mine.map((v) => (
          <span key={v} className="chip lb-chip" title={group.name}>
            <span className="ellipsis">{v}</span>
            <button type="button" className="x" title="Remove" aria-label={`Remove ${v} from ${group.name}`} onClick={() => void remove(v)}>
              <Icon name="close" />
            </button>
          </span>
        ))}
        <div className={cx("lb-cbx", showList && "open")}>
          <input
            ref={inputRef}
            className="input lb-cbxin"
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList ? `${listId}-${active}` : undefined}
            aria-label={`Add a ${groupLower} tag`}
            placeholder={`+ Add ${groupLower}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setAct(0);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false);
              setQ("");
            }}
          />
          <ul className="lb-lbx" id={listId} role="listbox" aria-label={`${group.name} values`} hidden={!showList} onMouseDown={(e) => e.preventDefault()}>
            {options.map((o, i) => (
              <li key={`${o.isNew}:${o.value}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} onClick={() => void pick(o.value)}>
                {o.isNew ? (
                  <>
                    <Icon name="plus" size="s" />
                    <span>
                      Create <b>{o.value}</b> in {group.name}
                    </span>
                  </>
                ) : (
                  o.value
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------- In playlists ---------- */

function InPlaylists({ t, playlists, onNewPlaylist }: { t: LibraryTrack; playlists: PlaylistInfo[]; onNewPlaylist: (ids: string[]) => void }) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const accept = useWriteResult();
  const ok = useWriteOk();
  const inLane = (p: PlaylistInfo) => (p.lane === "fx" ? isFx(t) : t.kind === p.lane);
  const manual = playlists.filter((p): p is Extract<PlaylistInfo, { kind: "manual" }> => p.kind === "manual" && p.trackIds.includes(t.id));
  const dynamic = playlists.filter((p): p is Extract<PlaylistInfo, { kind: "dynamic" }> => p.kind === "dynamic" && inLane(p) && matchesRule(t, p.rule));
  const menu = (): PopMenuEntry[] => {
    const options = playlists.filter(
      (p): p is Extract<PlaylistInfo, { kind: "manual" }> => p.kind === "manual" && (p.lane === t.kind || (p.lane === "fx" && isFx(t))) && !p.trackIds.includes(t.id),
    );
    return [
      { group: `Manual playlists: ${KIND_NAMES[t.kind]}${t.kind !== "fx" && isFx(t) ? " and FX" : ""}` },
      ...(options.length
        ? options.map(
            (p): PopMenuEntry => ({
              key: p.id,
              content: (
                <>
                  <Icon name="playlist" size="s" />
                  <span className="ellipsis grow">{p.name}</span>
                  <span className="hint">{p.trackIds.length}</span>
                </>
              ),
              onSelect: async () => {
                if (accept(await api.playlists.addTracks(p.id, [t.id]))) toast(`Added to ${p.name}`);
              },
            }),
          )
        : [{ group: "It is already in all of them." } as PopMenuEntry]),
      { separator: true },
      {
        content: (
          <>
            <Icon name="plus" size="s" />
            New playlist with this track
          </>
        ),
        onSelect: () => onNewPlaylist([t.id]),
      },
    ];
  };
  return (
    <section className="lb-sec" aria-labelledby="lb-h-pl">
      <div className="lb-hrow">
        <h3 className="lb-h" id="lb-h-pl">
          In playlists
        </h3>
        <PopMenuButton label="Add to playlist" className="btn s" focusKey="lb-pladd" items={menu}>
          <Icon name="plus" size="s" />
          Add to playlist
        </PopMenuButton>
      </div>
      {manual.length + dynamic.length ? (
        <ul className="lb-pls">
          {manual.map((p) => (
            <li key={p.id}>
              <span className={cx("lane-dot", p.lane)} />
              <a href={`#/playlist/${p.id}`} className="ellipsis">
                {p.name}
              </a>
              <span className="hint lb-plk">Manual</span>
              <button
                type="button"
                className="closer"
                title="Remove from this playlist"
                aria-label={`Remove from ${p.name}`}
                onClick={async () => {
                  if (ok(await api.playlists.removeTrack(p.id, t.id))) {
                    toast(`Removed from ${p.name}`);
                    focusSoon("lb-pladd");
                  }
                }}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
          {dynamic.map((p) => (
            <li key={p.id}>
              <span className={cx("lane-dot", p.lane)} />
              <a href={`#/playlist/${p.id}`} className="ellipsis">
                {p.name}
              </a>
              <span className="hint lb-plk">Dynamic: matches its tag rules</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Not in any playlist yet.</p>
      )}
    </section>
  );
}

/* ---------- Used in: scenes directly, or through a playlist ---------- */

function UsedIn({ t, playlists, campaigns }: { t: LibraryTrack; playlists: PlaylistInfo[]; campaigns: CampaignInfo[] }) {
  const inLane = (p: PlaylistInfo) => (p.lane === "fx" ? isFx(t) : t.kind === p.lane);
  const mine = playlists.filter((p) => (p.kind === "manual" ? p.trackIds.includes(t.id) : inLane(p) && matchesRule(t, p.rule)));
  const scenes = new Map<string, { campaignId: string; sessionId: string; sceneId: string; direct: boolean; via: string[] }>();
  const at = (u: { campaignId: string; sessionId: string; sceneId: string }) => {
    const key = `${u.campaignId}/${u.sessionId}/${u.sceneId}`;
    let e = scenes.get(key);
    if (!e) {
      e = { ...u, direct: false, via: [] };
      scenes.set(key, e);
    }
    return e;
  };
  for (const u of usesOfTrack(t.id, campaigns)) if (u.level === "scene") at(u).direct = true;
  let wider = 0;
  for (const p of mine) {
    for (const u of usesOfPlaylist(p.id, campaigns)) {
      if (u.level !== "scene") {
        wider++;
        continue;
      }
      const e = at(u);
      if (!e.via.includes(p.name)) e.via.push(p.name);
    }
  }
  const names = (e: { campaignId: string; sessionId: string; sceneId: string }) => {
    const c = campaigns.find((x) => x.id === e.campaignId);
    const s = c?.sessions.find((x) => x.id === e.sessionId);
    const sc = s?.scenes.find((x) => x.id === e.sceneId);
    return { campaign: c?.name ?? "", session: s?.number ?? 0, scene: sc?.name ?? "" };
  };
  return (
    <section className="lb-sec" aria-labelledby="lb-h-used">
      <h3 className="lb-h" id="lb-h-used">
        Used in
      </h3>
      {scenes.size ? (
        <ul className="lb-pls lb-used">
          {[...scenes.values()].map((e) => {
            const n = names(e);
            return (
              <li key={`${e.campaignId}/${e.sessionId}/${e.sceneId}`}>
                <a href={`#/session/${e.campaignId}/${e.sessionId}`}>
                  <span className="ellipsis">{n.scene}</span>
                </a>
                <span className="hint ellipsis grow">
                  {n.campaign} › Session {n.session}
                </span>
                {e.direct && (
                  <span className="lb-how direct">
                    <Icon name="note" size="s" />
                    Directly in the scene
                  </span>
                )}
                {e.via.length > 0 && (
                  <span className="lb-how">
                    <Icon name="playlist" size="s" />
                    Through {e.via.join(", ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">Not in any scene yet. Add it to a scene directly, or to a playlist a scene plays.</p>
      )}
      {wider > 0 && <p className="hint">Also available in {plural(wider, "campaign or session", "campaigns or sessions")} through its playlists.</p>}
    </section>
  );
}
