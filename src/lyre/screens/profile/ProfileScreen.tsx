/**
 * Audio profile (route `profile`, `#/profile/<trackId>` and `#/profile/<trackId>/<place>`): where a track starts and
 * ends, how it fades in and out, what happens at the end (loop back, move on to the next track, or stop), and markers,
 * for the track everywhere or for one playlist or scene. Ported from the prototype (design/prototype/src/views/profile.js).
 *
 * Listening here is a Preview: only the game master hears it (useLyreAudio().previewTrack), never the rooms.
 */
import React, { useRef } from "react";

import { DEFAULT_LIBRARY_NORMALISE, normaliseLine, parsePlaceKey, shapeFromPeaks, type NormaliseChoice as Choice } from "../../../common/domain";
import { isRefused } from "../../../common/lyre/api";
import { useLyreApi, useLyreQuery } from "../../api";
import { NormaliseChoice, profileNormaliseHint } from "../../kit/NormaliseChoice";
import { Button } from "../../kit/Button";
import { Pane } from "../../kit/Pane";
import { returnToSession } from "../../kit/sceneReturn";
import { ShapeTag } from "../../kit/ShapeGlyph";
import { useAnnounce } from "../../shell/Announcer";
import { TopLead, type BackFallback } from "../../shell/TopBar";
import { shownTitle } from "../../../common/lyre/text";
import type { ScreenProps } from "..";
import { DraftField } from "../campaigns/parts";
import { sceneOf, sessionOf } from "./places";
import { AddMarkerButton, EndBox, endStatus, FadesBox, fadesStatus, ListenBox, listenStatus, MarkersBox, markersStatus, PlaceBar } from "./boxes";
import { fmt } from "./profileModel";
import { useProfileController } from "./useProfileController";
import { forgetUndoUnless, useProfileEditor, type ProfileEditor } from "./useProfileEditor";

import "./profile.css";

export function ProfileScreen({ route }: ScreenProps) {
  const trackId = route.params.tid ?? "";
  const key = route.params.ctx ?? "";
  forgetUndoUnless(trackId);
  const state = useProfileEditor(trackId, key);
  if (state.status === "ready") return <ProfileBody key={`${trackId}/${key}`} editor={state.editor} />;
  return (
    <>
      <div className="viewhead ap-head">
        <div className="ap-id">
          <div className="ap-titlerow">
            <TopLead />
            <h1>Audio profile</h1>
          </div>
        </div>
      </div>
      <div className="viewbody ap-body" data-scroll="body">
        {state.status === "missing" ? (
          <div className="empty">
            That track is not in the library. <a href="#/library">Back to the Library</a>
          </div>
        ) : (
          <p className="empty">Opening the track…</p>
        )}
      </div>
    </>
  );
}

/**
 * PLY-14, UX-18: with nothing in Back's history (the Audio profile opened by its address), Back goes to the scene or
 * session list it was opened for (the planner with the scene open and the track's button focused), else to the track
 * in the Library.
 */
function backFallback(editor: ProfileEditor): BackFallback {
  const { key, view, track } = editor;
  const scene = sceneOf(key, view);
  const session = scene ?? sessionOf(key, view);
  if (!session) return { label: `Library: ${shownTitle(track)}`, go: () => void (window.location.hash = `#/library/${track.id}`) };
  return {
    label: scene ? scene.scene.name || "the scene" : `Session ${session.session.number}`,
    go: () => returnToSession({ campaignId: session.campaign.id, sessionId: session.session.id, sceneId: scene?.scene.id ?? null, trackId: track.id }),
  };
}

/** DAT-14: opened from a scene, the track's name there; empty uses its own name. */
function SceneName({ editor }: { editor: ProfileEditor }) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const found = sceneOf(editor.key, editor.view);
  if (!found) return null;
  const { campaign, session, scene } = found;
  const own = editor.track.title || editor.track.metaTitle || editor.track.fileName;
  const save = async (name: string) => {
    const result = await api.sessions.setTrackName({ campaignId: campaign.id, sessionId: session.id, sceneId: scene.id }, editor.track.id, name.trim());
    if (isRefused(result)) toast(result.refusal.message);
  };
  return (
    <div className="field ap-scname">
      <label htmlFor="ap-scname">Name in this scene</label>
      <DraftField
        className="input"
        id="ap-scname"
        data-k="ap-scname"
        autoComplete="off"
        value={scene.trackNames[editor.track.id] ?? ""}
        placeholder={`${own} (its own name)`}
        onSave={(name) => void save(name)}
      />
    </div>
  );
}

/**
 * PLY-15: the track's own normalising choice, with the loudness and gain where these settings apply: in the playlist
 * that "Settings for" names, else the track on its own (profile.js normHTML). Whose choice counts is on hover.
 */
function Normalise({ editor }: { editor: ProfileEditor }) {
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  const library = useLyreQuery("normalise-settings", (a) => a.library.normaliseSettings(), ["tracks"]).data ?? DEFAULT_LIBRARY_NORMALISE;
  const { track, view, key } = editor;
  const place = parsePlaceKey(key);
  const playlist = place?.kind === "playlist" ? (view.playlists.find((p) => p.id === place.playlistId) ?? null) : null;
  // The choice shows at once while the library keeps it.
  const [chosen, setChosen] = React.useState<{ value: Choice | null } | null>(null);
  React.useEffect(() => setChosen(null), [track.normalise]);
  const value = chosen ? chosen.value : (track.normalise ?? null);
  const shown = { ...track, normalise: value };
  const change = async (next: Choice | null) => {
    setChosen({ value: next });
    const result = await api.library.setNormalise(track.id, next);
    if (isRefused(result)) {
      setChosen(null);
      toast(result.refusal.message);
      return;
    }
    say(`Normalise volume: ${normaliseLine({ ...track, normalise: next }, playlist, library)}`);
  };
  return (
    <div className="ap-norm">
      <NormaliseChoice
        value={value}
        onChange={(next) => void change(next)}
        library={library}
        line={normaliseLine(shown, playlist, library)}
        hint={profileNormaliseHint(shown, playlist, library)}
      />
    </div>
  );
}

function ProfileBody({ editor }: { editor: ProfileEditor }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const c = useProfileController(editor, rootRef);
  const { track, dur, editable } = editor;
  const title = c.title;
  return (
    <div className="ap-root" ref={rootRef}>
      <div className="viewhead ap-head">
        <div className="ap-id">
          {/* Round 6 part 6: Back and the trail lead the title row; the h1 is the track, then "› Audio profile". */}
          <div className="ap-titlerow">
            <TopLead fallback={backFallback(editor)} />
            <h1 title={`${title} › Audio profile`}>
              <span className="ap-h1-t">{title}</span>
              <span className="ap-h1-k">
                <span aria-hidden="true">›</span> Audio profile
              </span>
            </h1>
          </div>
          <p className="ap-meta">
            <span>
              <span className="faint">Title in the file</span> {track.metaTitle || "none"}
            </span>
            <span>
              <span className="faint">File name</span> {track.fileName}
            </span>
            <span>
              <span className="faint">Length</span> <span className="num">{fmt(dur)}</span>
            </span>
            <span>
              {/* A suggestion worked out since the track list loaded comes from the same peaks the waveform draws. */}
              <ShapeTag track={{ shape: track.shape, suggestedShape: track.suggestedShape ?? (c.levels ? shapeFromPeaks([...c.levels]) : null) }} />
            </span>
          </p>
          <SceneName editor={editor} />
          <Normalise editor={editor} />
        </div>
        <div className="ap-headacts">
          {/* Round 6 part 5: no "Saved" here (saving shows in the Saved pop-up); the read-only note says why nothing changes. */}
          <span className="ap-saved" role="status">
            {!editable ? "Uses the track's settings (read-only until you give it its own)" : null}
          </span>
          <Button size="s" variant="ghost" icon="restart" data-k="ap-reset" title={`Start at 0:00 and End at ${fmt(dur)}, no fades`} disabled={!editable} onClick={c.actions.reset}>
            Reset to whole track
          </Button>
        </div>
        <PlaceBar c={c} />
      </div>
      <div className="viewbody ap-body" data-scroll="body">
        <div className="ap-grid">
          <Pane id="ap-wave" title="Waveform and listening" icon="wave" className="ap-wavepane" noMax kind="music" status={listenStatus(c)}>
            <ListenBox c={c} />
          </Pane>
          <Pane id="ap-end" title="At the end" icon="loop" className="ap-endpane" noMax kind="plain" status={{ text: endStatus(c), tone: "idle" }}>
            <EndBox c={c} />
          </Pane>
          <Pane id="ap-fades" title="Fades" icon="fade" className="ap-fadepane" noMax kind="plain" status={{ text: fadesStatus(c), tone: "idle" }}>
            <FadesBox c={c} />
          </Pane>
          <Pane
            id="ap-markers"
            title="Markers"
            icon="tag"
            className="ap-mpane"
            noMax
            kind="plain"
            status={{ text: markersStatus(c), tone: "idle" }}
            actions={<AddMarkerButton c={c} />}
          >
            <MarkersBox c={c} />
          </Pane>
        </div>
      </div>
    </div>
  );
}
