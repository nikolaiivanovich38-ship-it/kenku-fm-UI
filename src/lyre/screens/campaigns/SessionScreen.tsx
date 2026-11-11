/**
 * The session planner (round 4): a session's scenes in order, each with its Starts when line, its music (tracks and
 * playlists in any mix, played in order and then looped; the first starts the scene), its ambience (a track or an
 * ambience playlist), its pad boards (the first shows when the scene starts) and notes; the playlists and pad boards
 * on hand for the evening; and a reminder of the campaign's. Playlists and boards are only assigned here, never made.
 * (views/campaigns.js part 3.)
 */
import React, { useEffect, useRef, useState } from "react";

import type { SoundRef, TrackNames, UsePlace } from "../../../common/domain";
import { isRefused, type CampaignInfo, type SceneAddress, type SceneInfo, type SessionInfo, type SessionStatus } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useCampaign, useLyreApi, useTagGroups } from "../../api";
import { Button, IconButton } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { ExpanderButton } from "../../kit/Expander";
import { Icon } from "../../kit/Icon";
import { RenameField, renameKeys, useRenameInPlace } from "../../kit/RenameInPlace";
import { runInLive } from "../../kit/liveSession";
import type { MenuEntry } from "../../kit/Menu";
import { Column, Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { SceneMarks, StepsDialog } from "../steps/StepsDialog";
import { RepeatOneButton } from "../../kit/RepeatOneButton";
import type { ScreenProps } from "..";
import { carriesFiles, dropIndex, droppedPaths } from "./drops";
import { boardInfo, plural, sessionLabel, soundInfo, STATUS_WORDS, type ItemInfo, type LibraryIndex } from "./model";
import { OnHandList, OnHandPane } from "./OnHand";
import {
  Contents,
  DraftField,
  ModeSwitch,
  NotFound,
  ObsidianButton,
  Opening,
  useHeadingFocusWhenReady,
  RowMenu,
  StatusBadge,
 
  useFocusLater,
  useLibraryIndex,
  useOwnSettings,
  useWrite,
} from "./parts";
import { PlayOnAirButton, PreviewButton } from "../../kit/SoundButtons";
import { PlayOrderButton } from "../../kit/PlayOrderButton";
import { takeSceneReturn } from "../../kit/sceneReturn";
import { TagStrip } from "../../kit/TagStrip";
import { trackNameAt, useTrackNames } from "../../kit/trackName";
import type { TagGroup } from "../../../common/lyre/api";
import { NameInSceneDialog, TrackUseInDialog } from "./trackDialogs";
import { LibraryPicker, playlistKey, refOfKey, trackKey } from "./pickers";
import { useOptimisticScenes, type ScenePlay } from "./optimistic";
import { useDragReorder } from "./reorder";

import "./campaigns.css";
import { takeBackOpen, TopLead } from "../../shell/TopBar";
import { useSave } from "../../shell/useSave";

/** The scenes open in each session's planner, for this visit (UX-18: Back returns to the page as it was left). */
const OPEN_SCENES = new Map<string, Record<string, boolean>>();
/** A new start of the page (tests): every scene folded again. */
export function forgetOpenScenes(): void {
  OPEN_SCENES.clear();
}

export function SessionScreen({ route }: ScreenProps) {
  const query = useCampaign(route.params.cid ?? "");
  const index = useLibraryIndex();
  // UX-18: the page is drawn whole, its rows' tags too, so nothing moves under the game master as they arrive, and
  // Back puts the scenes box at its scroll position in the first drawing (a tag strip can make a row taller).
  const groups = useTagGroups().data;
  const campaign = query.data;
  const session = campaign?.sessions.find((s) => s.id === route.params.sid);
  if (campaign === null || (campaign && !session)) return <NotFound what="Session" />;
  if (!campaign || !session || !index || !groups) return <Opening />;
  return <SessionPage key={session.id} campaign={campaign} session={session} index={index} groups={groups} />;
}

type Picking = { kind: "music" | "ambience" | "boards"; sceneId: string } | null;

/** Everything a scene card needs from the page. */
interface SceneContext {
  campaign: CampaignInfo;
  session: SessionInfo;
  index: LibraryIndex;
  address: (scene: SceneInfo) => SceneAddress;
  /** Remember the scene worked on last ("Add scene" goes after it). */
  workedOn: (sceneId: string) => void;
  focusLater: (key: string, atIndex?: number, select?: boolean) => void;
  pick: (picking: Picking) => void;
  dropFiles: (scene: SceneInfo, where: "music" | "ambience", paths: string[], at: number) => void;
  /** Change a scene's music, ambience or pad boards: shown at once, then saved. Resolves false when refused. */
  saveScene: (scene: SceneInfo, patch: ScenePlay) => Promise<boolean>;
  /** ORG-11: the tag groups, for the tag strips. */
  groups: readonly TagGroup[];
  /** DAT-14: every scene's names for its tracks. */
  names: TrackNames;
  /** DAT-14: Name in this scene…; ORG-12: Use in… for a track. */
  nameInScene: (scene: SceneInfo, trackId: string) => void;
  useIn: (trackId: string) => void;
}

function SessionPage({ campaign: c, session: saved, index, groups }: { campaign: CampaignInfo; session: SessionInfo; index: LibraryIndex; groups: readonly TagGroup[] }) {
  const api = useLyreApi();
  const write = useWrite();
  const { session: s, saveScene: showAndSave } = useOptimisticScenes(saved);
  useHeadingFocusWhenReady();
  const { say, toast } = useAnnounce();
  const { offer } = useUndoNote();
  const focus = useFocusLater();
  // UX-18: the scenes open in this session stay open for the visit, so Back (and any return) finds the page as it was.
  const memoryKey = `${c.id}/${saved.id}`;
  const [open, setOpenNow] = useState<Record<string, boolean>>(() => OPEN_SCENES.get(memoryKey) ?? {});
  const setOpen = (change: React.SetStateAction<Record<string, boolean>>) =>
    setOpenNow((was) => {
      const next = typeof change === "function" ? change(was) : change;
      OPEN_SCENES.set(memoryKey, next);
      return next;
    });
  const [current, setCurrent] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** PLY-8: the scene whose steps are open (What it does when it starts…). */
  const [stepsOf, setStepsOf] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // BUG-21: the title renames the session in place (click or F2); only the name, never the number.
  const renameTitle = useRenameInPlace();
  useEffect(() => setNameDraft((d) => (d !== null && d.trim() === s.name ? null : d)), [s.name]);
  const names = useTrackNames();
  const [naming, setNaming] = useState<{ sceneId: string; trackId: string } | null>(null);
  const [usingIn, setUsingIn] = useState<string | null>(null);

  // PLY-14: back from the Audio profile ("Back to <scene>"): the scene opens and the track's wave button takes the focus.
  useEffect(() => {
    // UX-18: Back to a scene the game master left from (its card's data-back-open) opens it again.
    const reopen = takeBackOpen(`session/${c.id}/${s.id}`);
    if (reopen && s.scenes.some((x) => x.id === reopen)) {
      setOpen((o) => ({ ...o, [reopen]: true }));
      setCurrent(reopen);
    }
    const back = takeSceneReturn(c.id, s.id);
    if (!back) return;
    if (back.sceneId && s.scenes.some((x) => x.id === back.sceneId)) {
      const sceneId = back.sceneId;
      setOpen((o) => ({ ...o, [sceneId]: true }));
      setCurrent(sceneId);
      focus(`prof-${sceneId}-music-${back.trackId}`);
    } else {
      focus(`more-str${back.trackId}`);
    }
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const address = (scene: SceneInfo): SceneAddress => ({ campaignId: c.id, sessionId: s.id, sceneId: scene.id });
  const sceneAt = (id: string | null) => s.scenes.find((x) => x.id === id);
  const ctx: SceneContext = {
    campaign: c,
    session: s,
    index,
    address,
    workedOn: setCurrent,
    focusLater: (key, atIndex, select) => focus(key, atIndex, select),
    pick: setPicking,
    dropFiles: (scene, where, paths, at) => void dropFiles(scene, where, paths, at),
    saveScene: async (scene, patch) =>
      !!(await showAndSave(scene.id, patch, () => {
        const at = address(scene);
        if (patch.music) return write(api.sessions.setSceneMusic(at, patch.music));
        if (patch.boardIds) return write(api.sessions.setSceneBoards(at, patch.boardIds));
        return write(api.sessions.setSceneAmbience(at, patch.ambience ?? null));
      })),
    groups,
    names,
    nameInScene: (scene, trackId) => setNaming({ sceneId: scene.id, trackId }),
    useIn: setUsingIn,
  };

  /* ----- the session ----- */
  const saveWith = useSave();
  /** UX-19: a field's save, with the Saved pop-up. */
  const saveSession = (patch: Parameters<typeof api.sessions.update>[2], what: string) =>
    saveWith(what, () => api.sessions.update(c.id, s.id, patch), { key: `cp-s-${Object.keys(patch)[0]}` });

  /* ----- scenes ----- */
  const addScene = async (after?: string) => {
    const at = after ? s.scenes.findIndex((x) => x.id === after) + 1 : s.scenes.length;
    const made = (await write(api.sessions.createScene(c.id, s.id, after)))?.value;
    if (!made) return;
    // Round 6, Could 19: a new scene has a name of its own ("Scene 7"), so its buttons do too.
    let n = at + 1;
    while (s.scenes.some((x) => x.name === `Scene ${n}`)) n++;
    await write(api.sessions.updateScene(address(made), { name: `Scene ${n}` }));
    setOpen((o) => ({ ...o, [made.id]: true }));
    setCurrent(made.id);
    focus(`scname-${made.id}`, undefined, true);
    say(`New scene added as scene ${at + 1} of ${s.scenes.length + 1}`);
  };
  const moveScene = async (from: number, to: number) => {
    const scene = s.scenes[from];
    if (!scene || to < 0 || to >= s.scenes.length || from === to) return;
    focus(`scm-${scene.id}`, to);
    if ((await write(api.sessions.moveScene(address(scene), to))) === undefined) return;
    say(`Scene ${scene.name} moved to position ${to + 1} of ${s.scenes.length}`);
  };
  const duplicate = async (scene: SceneInfo) => {
    const at = s.scenes.indexOf(scene);
    const made = (await write(api.sessions.duplicateScene(address(scene))))?.value;
    if (!made) return;
    setCurrent(made.id);
    focus(`sct-${made.id}`);
    say(`Duplicated as scene ${at + 2}: ${made.name}`);
  };
  const remove = async (sceneId: string) => {
    setDeleting(null);
    const at = s.scenes.findIndex((x) => x.id === sceneId);
    const scene = s.scenes[at];
    if (!scene) return;
    const done = await write(api.sessions.deleteScene(address(scene)));
    if (done === undefined) return;
    const neighbour = s.scenes.filter((x) => x.id !== sceneId)[Math.max(0, at - 1)];
    setCurrent(neighbour?.id ?? null);
    focus(neighbour ? `sct-${neighbour.id}` : "addscene");
    // w3-ux 10: what was deleted, with Undo (and Ctrl+Z).
    offer(`Deleted scene "${scene.name || "Untitled scene"}" and its notes.`, done.undoLabel);
  };

  /* ----- files dropped on a scene ----- */
  const dropFiles = async (scene: SceneInfo, where: "music" | "ambience", paths: string[], at: number) => {
    setCurrent(scene.id);
    if (paths.length === 0) return toast("No audio files in what you dropped");
    const result = await api.import.start({ from: "paths", paths });
    if (isRefused(result)) return toast(result.refusal.message);
    const { trackIds, added } = result.value;
    if (trackIds.length === 0) return toast(result.value.summary);
    const lib = added.length ? `${plural(added.length, "new track")} added to the Library. ` : "";
    const name = scene.name || "this scene";
    if (where === "ambience") {
      // Dropped on Ambience: the new files are ambience beds.
      for (const id of added) await api.library.updateTrack(id, { kind: "amb" });
      if (!(await ctx.saveScene(scene, { ambience: { kind: "track", id: trackIds[0] } }))) return;
      const title = (await api.library.listTracks()).find((t) => t.id === trackIds[0]);
      focus(`pa-${scene.id}`);
      toast(`${lib}Ambience of "${name}": ${title ? shownTitle(title) : ""}${trackIds.length > 1 ? " (one ambience per scene; the others are in the Library)" : ""}`);
      return;
    }
    const placed: SoundRef[] = trackIds.map((id) => ({ kind: "track", id }));
    const music = [...scene.music.slice(0, at), ...placed, ...scene.music.slice(at)];
    if (!(await ctx.saveScene(scene, { music }))) return;
    focus(`im-${scene.id}-music-${trackIds[0]}`);
    toast(`${lib}${plural(trackIds.length, "track")} placed in the music of "${name}" at position ${at + 1}.`);
  };

  /* ----- pickers ----- */
  const pickedScene = picking ? sceneAt(picking.sceneId) : undefined;
  const choose = async (ids: string[]) => {
    const p = picking;
    setPicking(null);
    const scene = p && sceneAt(p.sceneId);
    if (!p || !scene) return;
    if (p.kind === "music") {
      ctx.focusLater(`am-${scene.id}`);
      const music = ids.map(refOfKey);
      if (!(await ctx.saveScene(scene, { music }))) return;
      const first = music[0] && soundInfo(music[0], index);
      say(`${plural(music.length, "music item")} in this scene${first ? `; ${first.name} starts it` : ""}`);
    } else if (p.kind === "ambience") {
      ctx.focusLater(`pa-${scene.id}`);
      if (!ids[0]) return;
      const ref = refOfKey(ids[0]);
      if (!(await ctx.saveScene(scene, { ambience: ref }))) return;
      say(`Ambience for this scene: ${soundInfo(ref, index)?.name ?? ""}`);
    } else {
      ctx.focusLater(`ab-${scene.id}`);
      const keep = scene.boardIds.filter((id) => ids.includes(id));
      const boards = [...keep, ...ids.filter((id) => !scene.boardIds.includes(id))];
      if (!(await ctx.saveScene(scene, { boardIds: boards }))) return;
      say(`${plural(boards.length, "pad board")} in this scene${boards.length ? `; ${index.board(boards[0])?.name} shows first` : ""}`);
    }
  };

  const drag = useDragReorder("scenes", (from, to) => void moveScene(from, to));
  const allOpen = s.scenes.length > 0 && s.scenes.every((x) => open[x.id]);
  const deletingScene = sceneAt(deleting);
  const stepsScene = sceneAt(stepsOf);
  const campaignBoards = c.boardIds.map((id) => index.board(id)?.name).filter(Boolean);

  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>
          {renameTitle.editing ? (
            <>
              Session {s.number}:{" "}
              <RenameField
                className="input cp-h1-rename"
                value={s.name}
                label={`Name of Session ${s.number}`}
                placeholder="No name yet"
                onSave={(name) => void saveSession({ name }, `session name “${name.trim()}”`).then((done) => done !== undefined && say(`Session ${s.number} is now called ${name}`))}
                onDone={renameTitle.done}
              />
            </>
          ) : (
            <button type="button" className="cp-h1-name" data-k="cp-h1-name" title="Rename (click or F2)" onClick={(event) => renameTitle.start(event.currentTarget)} onKeyDown={renameKeys(renameTitle.start)}>
              {sessionLabel({ number: s.number, name: (nameDraft ?? s.name).trim() })}
            </button>
          )}
        </h1>
        <StatusBadge status={s.status} />
        <span className="grow" />
        <ModeSwitch campaign={c} sessionId={s.id} />
        <Button variant={s.status === "next" ? "primary" : undefined} icon="broadcast" onClick={() => runInLive({ campaignId: c.id, sessionId: s.id })}>
          Run this session
        </Button>
      </div>
      <div className="viewbody fill cp-body" data-scroll="body">
        <div className="cp-details cp-sdetails">
          <div className="field cp-f-name">
            <label htmlFor="cp-s-name">Session name</label>
            <DraftField
              className="input"
              id="cp-s-name"
              placeholder="Name this session"
              autoComplete="off"
              value={s.name}
              onDraft={setNameDraft}
              onSave={(name) => void saveSession({ name }, `session name “${name.trim()}”`)}
            />
          </div>
          <div className="field cp-f-date">
            <label htmlFor="cp-s-date">Date</label>
            <input className="input" type="date" id="cp-s-date" value={s.date ?? ""} onChange={(event) => void saveSession({ date: event.target.value || null }, `Session ${s.number} date`)} />
          </div>
          <div className="field cp-f-status">
            <label htmlFor="cp-s-status">Status</label>
            <select
              className="input"
              id="cp-s-status"
              value={s.status}
              onChange={async (event) => {
                const status = event.target.value as SessionStatus;
                if ((await saveSession({ status }, `Session ${s.number} status`)) !== undefined) say(`Session ${s.number} is now ${STATUS_WORDS[status]}`);
              }}
            >
              {(["played", "next", "draft"] as const).map((k) => (
                <option key={k} value={k}>
                  {STATUS_WORDS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="cp-split cp-ssplit">
          <Column>
            <Pane
              id="ss-scenes"
              title="Scenes"
              icon="map"
              kind="scenes"
              // UX-19 (round 6 part 5, Nik: "Kill the scene count"): a status only when there is nothing.
              status={s.scenes.length ? undefined : { text: "Empty" }}
              actions={
                <>
                  {s.scenes.length > 0 && (
                    <IconButton
                      quiet
                      icon={allOpen ? "chevup" : "chevdown"}
                      label={allOpen ? "Fold all scenes" : "Open all scenes"}
                      data-k="allscenes"
                      onClick={() => {
                        const any = !allOpen;
                        setOpen(Object.fromEntries(s.scenes.map((x) => [x.id, any])));
                        say(any ? "All scenes open" : "All scenes folded");
                      }}
                    />
                  )}
                  <Button size="s" icon="plus" data-k="addscene" onClick={() => void addScene(sceneAt(current)?.id)}>
                    Add scene
                  </Button>
                </>
              }
            >
              {s.scenes.length ? (
                <ol className="cp-scenes" aria-label="Scenes in order">
                  {s.scenes.map((scene, i) => (
                    <SceneCard
                      key={scene.id}
                      scene={scene}
                      position={i}
                      ctx={ctx}
                      open={!!open[scene.id]}
                      onToggle={() => {
                        setOpen((o) => ({ ...o, [scene.id]: !o[scene.id] }));
                        setCurrent(scene.id);
                      }}
                      drag={drag}
                      menu={[
                        ...(i > 0 ? [{ label: "Move up", icon: "chevup" as const, onSelect: () => { void moveScene(i, i - 1); } }] : []),
                        ...(i < s.scenes.length - 1 ? [{ label: "Move down", icon: "chevdown" as const, onSelect: () => { void moveScene(i, i + 1); } }] : []),
                        { label: "Add a scene after this one", icon: "plus", onSelect: () => void addScene(scene.id) },
                        // Round 7 (PLY-8, SHW-3): what the scene does when it starts, as steps, and whether it moves on by itself.
                        { label: "What it does when it starts…", icon: "list", onSelect: () => setStepsOf(scene.id) },
                        { label: "Duplicate", icon: "queue", onSelect: () => void duplicate(scene) },
                        { separator: true },
                        { label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting(scene.id) },
                      ]}
                    />
                  ))}
                </ol>
              ) : (
                <p className="cp-none">No scenes yet. Use Add scene.</p>
              )}
            </Pane>
          </Column>
          <Column className="cp-side">
            <OnHandPane
              paneId="ss-spl"
              title="Session playlists"
              kind="playlists"
              owner={{ campaignId: c.id, sessionId: s.id }}
              ids={s.playlistIds}
              trackIds={s.trackIds}
              index={index}
              why="In every scene tonight."
              where={`every scene of Session ${s.number}`}
              ownerWord="session"
            />
            <OnHandPane
              paneId="ss-sbd"
              title="Session pads"
              kind="boards"
              owner={{ campaignId: c.id, sessionId: s.id }}
              ids={s.boardIds}
              index={index}
              why="In every scene tonight."
              where={`every scene of Session ${s.number}`}
              ownerWord="session"
            />
            <Pane
              id="ss-cpl"
              title="Campaign playlists"
              icon="crown"
              size="auto"
              kind="music"
              status={{ text: c.playlistIds.length ? String(c.playlistIds.length) : "Empty" }}
              // Round 6 rule 8 (UX-R3): Change sits where the other boxes have Add, as an icon link to the campaign.
              actions={
                <a className="btn s icon" href={`#/campaign/${c.id}`} data-k="tocamp" aria-label="Change the campaign's playlists" title="From the campaign: change them there">
                  <Icon name="edit" size="s" />
                </a>
              }
            >
              <OnHandList ids={c.playlistIds} trackIds={c.trackIds} kind="playlists" index={index} scope="r" place={{ kind: "campaign", campaignId: c.id }} />
              <p className="hint cp-make">Campaign pads: {campaignBoards.length ? campaignBoards.join(", ") : "none"}.</p>
            </Pane>
            <Pane id="ss-obs" title="Obsidian" icon="link" size="auto" collapsed kind="plain" status={{ text: "Coming later" }}>
              <div className="field">
                <label htmlFor="cp-s-obs">Session note</label>
                <DraftField
                  className="input"
                  id="cp-s-obs"
                  autoComplete="off"
                  value={s.noteLink}
                  placeholder={`${c.obsidian.sessionsFolder || "Sessions"}/Session ${s.number}.md`}
                  onSave={(noteLink) => void saveSession({ noteLink }, `Session ${s.number} Obsidian note`)}
                />
              </div>
              <ObsidianButton idPrefix="cp-s-o-" />
            </Pane>
          </Column>
        </div>
      </div>
      {picking && pickedScene && (
        <LibraryPicker
          open
          kind={picking.kind === "boards" ? "boards" : picking.kind}
          index={index}
          title={`${picking.kind === "music" ? "Music" : picking.kind === "ambience" ? "Ambience" : "Pad boards"} for "${pickedScene.name || "this scene"}"`}
          intro={
            picking.kind === "music"
              ? "Tick playlists, single tracks or both. They play in the scene in the order you tick them; you can reorder them afterwards."
              : picking.kind === "ambience"
                ? "One ambience track, or an ambience playlist that moves from bed to bed."
                : "Tick the boards to have in this scene. New ones are added at the end; the first one shows when the scene starts."
          }
          selected={
            picking.kind === "music"
              ? pickedScene.music.map((r) => (r.kind === "track" ? trackKey(r.id) : playlistKey(r.id)))
              : picking.kind === "ambience"
                ? pickedScene.ambience
                  ? [pickedScene.ambience.kind === "track" ? trackKey(pickedScene.ambience.id) : playlistKey(pickedScene.ambience.id)]
                  : []
                : pickedScene.boardIds
          }
          onDone={(ids) => void choose(ids)}
          onClose={() => {
            ctx.focusLater(`${picking.kind === "music" ? "am" : picking.kind === "ambience" ? "pa" : "ab"}-${pickedScene.id}`);
            setPicking(null);
          }}
        />
      )}
      {naming && sceneAt(naming.sceneId) && index.track(naming.trackId) && (
        <NameInSceneDialog
          scene={sceneAt(naming.sceneId)!}
          address={address(sceneAt(naming.sceneId)!)}
          track={index.track(naming.trackId)!}
          onClose={(saved) => {
            focus(`in-${naming.sceneId}-music-${naming.trackId}`);
            setNaming(null);
            if (saved !== null) say(saved ? `In this scene it is now called ${saved}` : "It uses its own name in this scene");
          }}
        />
      )}
      {usingIn && index.track(usingIn) && <TrackUseInDialog track={index.track(usingIn)!} index={index} onClose={() => setUsingIn(null)} />}
      {stepsScene && <StepsDialog owner={{ kind: "scene", campaignId: c.id, sessionId: s.id, scene: stepsScene }} onClose={() => setStepsOf(null)} />}
      <Dialog
        open={!!deletingScene}
        title="Delete this scene?"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="danger" icon="trash" onClick={() => deletingScene && void remove(deletingScene.id)}>
              Delete scene
            </Button>
          </>
        }
      >
        {deletingScene && (
          <p>
            Delete scene {s.scenes.indexOf(deletingScene) + 1}, <b>{deletingScene.name || "Untitled scene"}</b>, and its notes? Its tracks, playlists and pad boards stay
            in your library.
          </p>
        )}
      </Dialog>
    </>
  );
}

/* ---------- one scene ---------- */

interface SceneCardProps {
  scene: SceneInfo;
  position: number;
  ctx: SceneContext;
  open: boolean;
  onToggle: () => void;
  drag: ReturnType<typeof useDragReorder>;
  menu: MenuEntry[];
}

/** What a folded scene's tooltip says: its Starts when, music, ambience and pad boards. */
function sceneTip(scene: SceneInfo, index: LibraryIndex, names: TrackNames, place: UsePlace): string {
  const music = scene.music.map((r) => nameInScene(r, index, names, place)).filter(Boolean);
  const ambience = scene.ambience && soundInfo(scene.ambience, index);
  const boards = scene.boardIds.map((id) => index.board(id)?.name).filter(Boolean);
  return [
    scene.startsWhen ? `Starts when: ${scene.startsWhen}` : "No Starts when line yet",
    `Music: ${music.length ? music.join(", ") : "none"}`,
    `Ambience: ${ambience ? ambience.name : "none"}`,
    `Pad boards: ${boards.length ? boards.join(", ") : "none"}`,
  ].join("\n");
}

function SceneCard({ scene, position, ctx, open, onToggle, drag, menu }: SceneCardProps) {
  const api = useLyreApi();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [fileOver, setFileOver] = useState(false);
  useEffect(() => setNameDraft((d) => (d !== null && d === scene.name ? null : d)), [scene.name]);
  const name = (nameDraft ?? scene.name) || "Untitled scene";
  const number = position + 1;
  const saveWith = useSave();
  /** UX-19: a scene's field saves with the Saved pop-up ("Saved: The abbey ruins notes"). */
  const save = (patch: Parameters<typeof api.sessions.updateScene>[1], what: string) => {
    ctx.workedOn(scene.id);
    void saveWith(what, () => api.sessions.updateScene(ctx.address(scene), patch), { key: `sc-${scene.id}-${Object.keys(patch)[0]}` });
  };
  const rowProps = drag.rowProps(position);
  const f = `sc${scene.id}`;
  // EDT-1, BUG-18: double-click the name, F2 on it, or Rename in the ⋯ menu.
  const rename = useRenameInPlace();
  const toggle = useRef<HTMLButtonElement>(null);

  // A folded scene takes dropped files into its music, at the end.
  const foldedDrop = open
    ? {}
    : {
        onDragOver: (event: React.DragEvent<HTMLElement>) => {
          rowProps.onDragOver(event);
          if (drag.isDragging() || !carriesFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          setFileOver(true);
        },
        onDragLeave: () => setFileOver(false),
        onDrop: (event: React.DragEvent<HTMLElement>) => {
          rowProps.onDrop(event);
          if (drag.isDragging() || !carriesFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setFileOver(false);
          ctx.dropFiles(scene, "music", droppedPaths(event), scene.music.length);
        },
      };

  const scenePlace: UsePlace = { kind: "scene", ...ctx.address(scene) };
  const first = scene.music
    .map((r) => {
      const info = soundInfo(r, ctx.index);
      return info && { ...info, name: nameInScene(r, ctx.index, ctx.names, scenePlace) ?? info.name };
    })
    .filter((x): x is ItemInfo => !!x);
  return (
    <li
      className={`cp-scene${open ? " open" : ""}${fileOver ? " cp-fdrop" : ""} ${drag.rowClass(position)}`}
      aria-label={`Scene ${number}: ${name}`}
      // UX-18: a link in this scene names it for Back ("Back to The abbey ruins"), and Back opens it again.
      data-back-label={name}
      data-back-open={scene.id}
      {...rowProps}
      {...foldedDrop}
    >
      <div className="cp-scene-head">
        <span className="cp-handle" title="Drag to reorder" aria-hidden="true" {...drag.handleProps}>
          <Icon name="drag" size="s" />
        </span>
        {rename.editing ? (
          <span className="cp-scene-toggle cp-scene-renaming">
            <Icon name="chevdown" size="s" className="chev" />
            <span className="num cp-scn" aria-hidden="true">
              {number}
            </span>
            <RenameField
              className="input cp-rename"
              value={scene.name}
              label={`Name of scene ${number}`}
              placeholder="Untitled scene"
              onSave={(newName) => {
                setNameDraft(newName);
                save({ name: newName }, `scene name “${newName.trim()}”`);
              }}
              onDone={rename.done}
            />
          </span>
        ) : (
          <button
            ref={toggle}
            type="button"
            className="cp-scene-toggle"
            data-k={`sct-${scene.id}`}
            aria-expanded={open}
            aria-controls={open ? `scb-${scene.id}` : undefined}
            title={open ? undefined : sceneTip(scene, ctx.index, ctx.names, { kind: "scene", ...ctx.address(scene) })}
            onClick={onToggle}
            onKeyDown={renameKeys(rename.start)}
            onDoubleClick={(event) => {
              // The two clicks before it folded and unfolded the scene, so it is as it was.
              rename.start(event.currentTarget);
            }}
          >
            <Icon name="chevdown" size="s" className="chev" />
            <span className="num cp-scn" aria-hidden="true">
              {number}
            </span>
            <span className="ellipsis cp-scname">
              <span className="sr-only">Scene {number}:</span> {name}
            </span>
          </button>
        )}
        {!open && (
          <span className="cp-scchip">
            {first.length ? (
              <>
                <a className="chip cp-chip" href={first[0].href} title={`${first[0].label}: ${first[0].name}`}>
                  <span className={`lane-dot ${first[0].lane}`} aria-hidden="true" />
                  <span className="ellipsis">{first[0].name}</span>
                </a>
                {first.length > 1 && (
                  <span className="cp-more" title={plural(first.length - 1, "more music item")}>
                    +{first.length - 1} more
                  </span>
                )}
              </>
            ) : (
              <span className="cp-empty-chip">No music</span>
            )}
          </span>
        )}
        <SceneMarks scene={scene} />
        <RowMenu
          label={`More for ${name}`}
          title="More for this scene"
          k={`scm-${scene.id}`}
          items={[{ label: "Rename", icon: "edit", onSelect: () => rename.start(toggle.current) }, ...menu]}
        />
      </div>
      {open && (
        <div className="cp-scene-body" id={`scb-${scene.id}`}>
          <div className="field">
            <label htmlFor={`${f}n`}>Name</label>
            <DraftField
              className="input"
              id={`${f}n`}
              data-k={`scname-${scene.id}`}
              autoComplete="off"
              value={scene.name}
              onDraft={setNameDraft}
              onSave={(value) => save({ name: value }, `scene name “${value.trim()}”`)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${f}w`}>Starts when</label>
            <DraftField className="input" id={`${f}w`} placeholder="The moment in the story" autoComplete="off" value={scene.startsWhen} onSave={(value) => save({ startsWhen: value }, `when ${scene.name || "the scene"} starts`)} />
          </div>
          <div className="field cp-span" role="group" aria-labelledby={`${f}m`}>
            <span className="label" id={`${f}m`}>
              Music
            </span>
            <MusicList scene={scene} ctx={ctx} />
          </div>
          <div className="field cp-span" role="group" aria-labelledby={`${f}a`}>
            <span className="label" id={`${f}a`}>
              Ambience
            </span>
            <AmbienceSlot scene={scene} ctx={ctx} />
          </div>
          <div className="field cp-span" role="group" aria-labelledby={`${f}b`}>
            <span className="label" id={`${f}b`}>
              Pad boards
            </span>
            <BoardList scene={scene} ctx={ctx} />
          </div>
          <div className="field">
            <label htmlFor={`${f}x`}>Notes</label>
            <DraftField multiline className="input" id={`${f}x`} rows={2} placeholder="Reminders for this scene" value={scene.notes} onSave={(value) => save({ notes: value }, `${scene.name || "scene"} notes`)} />
          </div>
          <div className="field cp-obsfield">
            <label htmlFor={`${f}o`}>
              Note link <span className="cp-later">Coming later</span>
            </label>
            <DraftField
              className="input"
              id={`${f}o`}
              placeholder="Optional: an Obsidian note"
              title="Kept for later; Lyre does not open Obsidian notes yet"
              autoComplete="off"
              value={scene.noteLink}
              onSave={(value) => save({ noteLink: value }, `${scene.name || "scene"} note link`)}
            />
          </div>
        </div>
      )}
    </li>
  );
}

/** A music item's name in this scene: a track's name there (DAT-14), else its own; a playlist's name. */
function nameInScene(ref: SoundRef, index: LibraryIndex, names: TrackNames, place: UsePlace): string | undefined {
  const track = ref.kind === "track" ? index.track(ref.id) : undefined;
  return track ? trackNameAt(track, place, names).name : soundInfo(ref, index)?.name;
}

/* ---------- a scene's ordered lists: music items and pad boards ---------- */

type ListKind = "music" | "boards";

/** One row of a scene's music or pad boards: number, kind, name; Preview, Play on air, then ⋯ for the rest. */
function ItemRow({
  scene,
  list,
  info,
  position,
  count,
  ctx,
  dropBefore,
  onChange,
}: {
  scene: SceneInfo;
  list: ListKind;
  info: ItemInfo;
  position: number;
  count: number;
  ctx: SceneContext;
  /** Files dropped now would land before this row (an insertion line). */
  dropBefore?: boolean;
  onChange: (op: "first" | "up" | "down" | "remove") => void;
}) {
  const [open, setOpen] = useState(false);
  const ownSettings = useOwnSettings();
  const place = { kind: "scene" as const, ...ctx.address(scene) };
  const placeKey = `sc:${place.campaignId}:${place.sessionId}:${place.sceneId}`;
  const own = list === "music" && info.kind === "track" && ownSettings(info.id, place);
  const playlist = info.kind === "playlist" ? ctx.index.playlist(info.id) : undefined;
  const board = info.kind === "board" ? ctx.index.board(info.id) : undefined;
  const track = list === "music" && info.kind === "track" ? ctx.index.track(info.id) : undefined;
  // DAT-14: a track shows the scene's name for it, with its own name on a second line.
  const named = track ? trackNameAt(track, place, ctx.names) : null;
  const shown = named ? named.name : info.name;
  const items: MenuEntry[] = [
    ...(position > 0 ? [{ label: list === "boards" ? "Show it first" : "Start the scene with it", icon: "play" as const, onSelect: () => onChange("first") }] : []),
    ...(position > 0 ? [{ label: "Move up", icon: "chevup" as const, onSelect: () => onChange("up") }] : []),
    ...(position < count - 1 ? [{ label: "Move down", icon: "chevdown" as const, onSelect: () => onChange("down") }] : []),
    ...(track
      ? [
          { label: "Audio profile in this scene", icon: "wave" as const, onSelect: () => (window.location.hash = `#/profile/${info.id}/${placeKey}`) },
          { label: "Name in this scene…", icon: "tag" as const, onSelect: () => ctx.nameInScene(scene, info.id) },
          { label: "Use in…", icon: "link" as const, onSelect: () => ctx.useIn(info.id) },
        ]
      : []),
    { label: "Open", icon: "right", onSelect: () => (window.location.hash = info.href) },
    { separator: true },
    { label: "Remove from this scene", icon: "close", onSelect: () => onChange("remove") },
  ];
  return (
    <li className={`cp-it${position === 0 ? " first" : ""}${dropBefore ? " cp-ins-before" : ""}`}>
      <div className="cp-it-row">
        {playlist || board ? <ExpanderButton label={info.name} expanded={open} onToggle={() => setOpen(!open)} /> : <span className="cp-xpgap" aria-hidden="true" />}
        <span className="num cp-it-n" aria-hidden="true">
          {position + 1}
        </span>
        <span className={`lane-dot ${info.lane}`} aria-hidden="true" />
        {track && named ? (
          <span className="cp-it-main">
            <a
              className="ellipsis grow cp-it-name"
              href={info.href}
              data-k={`in-${scene.id}-music-${info.id}`}
              title={`${named.name !== named.own ? `${named.name} (in this scene) · its own name: ${named.own}` : shown} · ${info.label} · ${info.sub}`}
            >
              {shown}
              <span className="sr-only"> ({info.label})</span>
            </a>
            <span className="cp-it-sub">
              {named.name !== named.own && (
                <span className="cp-scname-mark" title="Named for this scene">
                  <Icon name="tag" size="s" />
                  <span className="ellipsis">{named.own}</span>
                  <span className="sr-only">: its own name</span>
                </span>
              )}
              <TagStrip track={track} groups={ctx.groups} />
            </span>
          </span>
        ) : (
          <a className="ellipsis grow cp-it-name" href={info.href} title={`${info.name} · ${info.label} · ${info.sub}`}>
            {info.name}
            <span className="sr-only"> ({info.label})</span>
          </a>
        )}
        {position === 0 && <span className="cp-firsttag">{list === "boards" ? "Shown first" : "Starts the scene"}</span>}
        {own && (
          <span className="cp-own" title="Has its own audio settings in this scene">
            <Icon name="wave" size="s" />
            <span className="sr-only">Own audio settings in this scene</span>
          </span>
        )}
        {board ? (
          <PreviewButton target={{ kind: "board", board }} name={info.name} />
        ) : (
          <PreviewButton target={info.kind === "playlist" ? { kind: "playlist", id: info.id } : { kind: "track", id: info.id }} name={shown} />
        )}
        {info.kind !== "board" && <PlayOnAirButton target={info.kind === "playlist" ? { kind: "playlist", id: info.id } : { kind: "track", id: info.id }} name={shown} />}
        {playlist && list === "music" && <PlayOrderButton playlistId={playlist.id} place={place} />}
        {track && (
          <a
            className="btn s icon cp-prof"
            href={`#/profile/${info.id}/${placeKey}`}
            data-k={`prof-${scene.id}-music-${info.id}`}
            title={`Waveform, end and fades of ${shown} in this scene`}
            aria-label={`Waveform, end and fades in this scene: ${shown}`}
          >
            <Icon name="wave" size="s" />
          </a>
        )}
        {/* Round 6 part 3 (PLY-17): a scene's Repeat one, saved with the scene, shows and changes here as in Live. */}
        {track && (
          <RepeatOneButton scene={ctx.address(scene)} sceneName={scene.name || "the scene"} trackId={info.id} name={shown} on={scene.repeatOnes.includes(info.id)} />
        )}
        <RowMenu label={`More for ${shown}`} k={`im-${scene.id}-${list}-${info.id}`} items={items} />
      </div>
      {open && (playlist || board) && (
        <div className="xp-body cp-xp">
          {playlist ? (
            <Contents item={{ kind: "playlist", playlist }} index={ctx.index} place={list === "music" ? placeKey : undefined} placeName={list === "music" ? `the scene ${scene.name}` : undefined} />
          ) : (
            board && <Contents item={{ kind: "board", board }} index={ctx.index} />
          )}
        </div>
      )}
    </li>
  );
}

/** Moves, "starts the scene" and removes in a scene's music or pad boards, with what the prototype says. */
function useListChange(scene: SceneInfo, list: ListKind, ctx: SceneContext) {
  const { say } = useAnnounce();
  const nameOf = (id: string) => (list === "boards" ? ctx.index.board(id)?.name : soundInfo(scene.music.find((r) => r.id === id) ?? { kind: "track", id }, ctx.index)?.name) ?? "item";
  return async (at: number, op: "first" | "up" | "down" | "remove") => {
    ctx.workedOn(scene.id);
    const items: (SoundRef | string)[] = list === "music" ? [...scene.music] : [...scene.boardIds];
    const idOf = (x: SoundRef | string) => (typeof x === "string" ? x : x.id);
    const id = idOf(items[at]);
    const name = nameOf(id);
    const lead = list === "boards" ? " now shows first" : " now starts the scene";
    const save = async () => ((await ctx.saveScene(scene, list === "music" ? { music: items as SoundRef[] } : { boardIds: items as string[] })) ? true : undefined);
    if (op === "remove") {
      items.splice(at, 1);
      ctx.focusLater(items.length ? `im-${scene.id}-${list}-${idOf(items[Math.min(at, items.length - 1)])}` : `${list === "boards" ? "ab" : "am"}-${scene.id}`);
      if ((await save()) === undefined) return;
      say(`Removed ${name} from this scene${at === 0 && items.length ? `. ${nameOf(idOf(items[0]))}${lead}` : ""}`);
      return;
    }
    const to = op === "first" ? 0 : op === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= items.length) return;
    const [moved] = items.splice(at, 1);
    items.splice(to, 0, moved);
    ctx.focusLater(`im-${scene.id}-${list}-${id}`);
    if ((await save()) === undefined) return;
    say(to === 0 ? `${name}${lead}` : `${name} moved to position ${to + 1} of ${items.length}${at === 0 ? `. ${nameOf(idOf(items[0]))}${lead}` : ""}`);
  };
}

/** A scene's music: tracks and playlists in play order, a drop zone for audio files, and Add tracks or playlists…. */
function MusicList({ scene, ctx }: { scene: SceneInfo; ctx: SceneContext }) {
  const change = useListChange(scene, "music", ctx);
  const [over, setOver] = useState<{ index: number } | null>(null);
  const rows = scene.music.map((ref, at) => ({ at, info: soundInfo(ref, ctx.index) })).filter((r): r is { at: number; info: ItemInfo } => !!r.info);
  return (
    <div
      className={`cp-box${over ? " cp-fdrop" : ""}${over && over.index >= rows.length ? " cp-ins-end" : ""}`}
      title="Drop audio files or folders here to add them"
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setOver({ index: dropIndex(event.currentTarget, event.clientY).index });
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(null);
        const position = dropIndex(event.currentTarget, event.clientY).index;
        const at = position < rows.length ? rows[position].at : scene.music.length;
        ctx.dropFiles(scene, "music", droppedPaths(event), at);
      }}
    >
      {rows.length ? (
        <ol className="cp-items" aria-label="Music in order">
          {rows.map((row, i) => (
            <ItemRow
              key={`${row.info.kind}:${row.info.id}:${row.at}`}
              scene={scene}
              list="music"
              info={row.info}
              position={i}
              count={rows.length}
              ctx={ctx}
              dropBefore={over?.index === i}
              onChange={(op) => void change(row.at, op)}
            />
          ))}
        </ol>
      ) : (
        <p className="faint cp-mnone">No music yet. The first item you add starts the scene.</p>
      )}
      <div className="cp-boxbtns">
        {/* Round 6 (UX-R3): how it plays and that files can be dropped are the button's hover text. */}
        <Button size="s" icon="plus" data-k={`am-${scene.id}`} title="Plays in order; drop audio files on the box to add them" onClick={() => ctx.pick({ kind: "music", sceneId: scene.id })}>
          Add tracks or playlists…
        </Button>
      </div>
    </div>
  );
}

/** A scene's pad boards in order; the first shows when the scene starts. */
function BoardList({ scene, ctx }: { scene: SceneInfo; ctx: SceneContext }) {
  const change = useListChange(scene, "boards", ctx);
  const rows = scene.boardIds.map((id, at) => ({ at, board: ctx.index.board(id) })).filter((r) => !!r.board);
  return (
    <div className="cp-box">
      {rows.length ? (
        <ol className="cp-items" aria-label="Pad boards in order">
          {rows.map((row, i) => (
            <ItemRow
              key={row.board!.id}
              scene={scene}
              list="boards"
              info={boardInfo(row.board!)}
              position={i}
              count={rows.length}
              ctx={ctx}
              onChange={(op) => void change(row.at, op)}
            />
          ))}
        </ol>
      ) : (
        <p className="faint cp-mnone">No pad boards yet.</p>
      )}
      <div className="cp-boxbtns">
        <Button
          size="s"
          icon="plus"
          data-k={`ab-${scene.id}`}
          aria-label={`Add pad boards… to ${scene.name}`}
          title="The first board shows when the scene starts"
          onClick={() => ctx.pick({ kind: "boards", sceneId: scene.id })}
        >
          Add pad boards…
        </Button>
      </div>
    </div>
  );
}

/** A scene's ambience: one track or ambience playlist, or none; a drop zone for an audio file. */
function AmbienceSlot({ scene, ctx }: { scene: SceneInfo; ctx: SceneContext }) {
  const { say } = useAnnounce();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const info = scene.ambience ? soundInfo(scene.ambience, ctx.index) : undefined;
  const playlist = info?.kind === "playlist" ? ctx.index.playlist(info.id) : undefined;
  const choose = () => {
    ctx.workedOn(scene.id);
    ctx.pick({ kind: "ambience", sceneId: scene.id });
  };
  const clear = async () => {
    ctx.workedOn(scene.id);
    ctx.focusLater(`pa-${scene.id}`);
    if (await ctx.saveScene(scene, { ambience: null })) say("No ambience in this scene");
  };
  const dropProps = {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      ctx.dropFiles(scene, "ambience", droppedPaths(event), 0);
    },
  };
  if (!info) {
    return (
      <div className={`cp-box cp-amb${over ? " cp-fdrop" : ""}`} title="Choose, or drop an audio file here" {...dropProps}>
        <div className="cp-it-row">
          <span className="faint grow">No ambience</span>
          <Button size="s" icon="plus" data-k={`pa-${scene.id}`} aria-label={`Choose ambience for ${scene.name || "Untitled scene"}`} onClick={choose}>
            Choose…
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={`cp-box cp-amb${over ? " cp-fdrop" : ""}`} title="Change, or drop an audio file here" {...dropProps}>
      <div className="cp-it-row">
        {playlist ? <ExpanderButton label={info.name} expanded={open} onToggle={() => setOpen(!open)} /> : <span className="cp-xpgap" aria-hidden="true" />}
        <span className={`lane-dot ${info.lane}`} aria-hidden="true" />
        <a className="ellipsis grow cp-it-name" href={info.href} title={`${info.name} · ${info.label} · ${info.sub}`}>
          {info.name}
        </a>
        <Button size="s" data-k={`pa-${scene.id}`} onClick={choose}>
          Change…
        </Button>
        <PreviewButton target={info.kind === "playlist" ? { kind: "playlist", id: info.id } : { kind: "track", id: info.id }} name={info.name} />
        <PlayOnAirButton target={info.kind === "playlist" ? { kind: "playlist", id: info.id } : { kind: "track", id: info.id }} name={info.name} />
        <RowMenu
          label={`More for ${info.name}`}
          k={`ma-${scene.id}`}
          items={[
            { label: "Change…", icon: "edit", onSelect: choose },
            { label: "Open", icon: "right", onSelect: () => (window.location.hash = info.href) },
            { separator: true },
            { label: "Remove from this scene", icon: "close", onSelect: () => void clear() },
          ]}
        />
      </div>
      {open && playlist && (
        <div className="xp-body">
          <Contents item={{ kind: "playlist", playlist }} index={ctx.index} />
        </div>
      )}
    </div>
  );
}
