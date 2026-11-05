/**
 * Audio profile (route `profile`, `#/profile/<trackId>` and `#/profile/<trackId>/<place>`): where a track starts and
 * ends, how it fades in and out, what happens at the end (loop back, move on to the next track, or stop), and markers,
 * for the track everywhere or for one playlist or scene. Ported from the prototype (design/prototype/src/views/profile.js).
 *
 * Listening here is a Preview: only the game master hears it (useLyreAudio().previewTrack), never the rooms.
 */
import React, { useRef } from "react";

import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import type { ScreenProps } from "..";
import { AddMarkerButton, EndBox, endStatus, FadesBox, fadesStatus, ListenBox, listenStatus, MarkersBox, markersStatus, PlaceBar } from "./boxes";
import { OnAirFallback } from "./OnAirFallback";
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
          <h1>Audio profile</h1>
        </div>
      </div>
      <div className="viewbody ap-body">
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

function ProfileBody({ editor }: { editor: ProfileEditor }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const c = useProfileController(editor, rootRef);
  const { track, dur, editable, saved } = editor;
  const title = c.title;
  return (
    <div className="ap-root" ref={rootRef}>
      <div className="viewhead ap-head">
        <div className="ap-id">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="#/library">Library</a>
            <span className="sep" aria-hidden="true">
              ›
            </span>
            <a className="ap-cr-t" href={`#/library/${track.id}`} title={title}>
              {title}
            </a>
            <span className="sep" aria-hidden="true">
              ›
            </span>
            <span>Audio profile</span>
          </nav>
          <h1 title={title}>{title}</h1>
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
          </p>
        </div>
        <div className="ap-headacts">
          <a className="btn s" href={`#/library/${track.id}`}>
            <Icon name="chevleft" size="s" />
            Back to track
          </a>
          <span className="ap-saved" role="status">
            {!editable ? (
              "Uses the track's settings (read-only until you give it its own)"
            ) : saved ? (
              <>
                <Icon name="check" size="s" />
                Saved
              </>
            ) : null}
          </span>
          <Button size="s" variant="ghost" icon="restart" data-k="ap-reset" title={`Start at 0:00 and End at ${fmt(dur)}, no fades`} disabled={!editable} onClick={c.actions.reset}>
            Reset to whole track
          </Button>
        </div>
        <PlaceBar c={c} />
      </div>
      <div className="viewbody ap-body">
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
      <OnAirFallback />
    </div>
  );
}
