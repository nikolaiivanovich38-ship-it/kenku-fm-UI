/**
 * The Audio profile's boxes and its "Settings for" bar (the prototype's listenHTML, endHTML, fadesHTML, markersHTML
 * and placeHTML in views/profile.js), drawn from the screen's controller.
 */
import React from "react";

import { shapeName } from "../../../common/domain";
import { shownTitle } from "../../../common/lyre/text";
import { useNowPlaying } from "../../audio/LyreAudioProvider";
import { Button, IconButton } from "../../kit/Button";
import { Icon, type IconName } from "../../kit/Icon";
import { Kbd } from "../../kit/Pills";
import { cx } from "../../kit/cx";
import { hasOwn, ownPlaceKeys, placeName, placesOf } from "./places";
import { envAt, fmt, fmt1, POINT, sketchPath, times, type Which } from "./profileModel";
import { ProfileLink } from "../../kit/ProfileLink";
import type { ProfileController } from "./useProfileController";
import { levelAt } from "./waveDrawing";
import { Waveform } from "./Waveform";

type C = { c: ProfileController };

/* ---------- typed times and lengths ---------- */

function TimeInput({ c, which, value, secsOnly, label }: C & { which: Which; value: string; secsOnly?: boolean; label?: string }) {
  const id = `ap-f-${which}`;
  const bad = c.invalid[which];
  return (
    <input
      id={id}
      className={cx("input", "num", "ap-time", secsOnly && "ap-secs")}
      data-k={id}
      value={c.editing?.which === which ? c.editing.text : value}
      inputMode={secsOnly ? "decimal" : "numeric"}
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={bad ? true : undefined}
      aria-describedby={bad ? `${id}-err` : undefined}
      disabled={!c.editable}
      onChange={(e) => c.actions.typeField(which, e.target.value)}
      onBlur={() => c.actions.commitField()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          c.actions.commitField();
        } else if (e.key === "Escape") {
          e.preventDefault();
          c.actions.cancelField();
        }
      }}
    />
  );
}

function FieldError({ c, which }: C & { which: Which }) {
  const text = c.invalid[which];
  return text ? (
    <span className="ap-err" id={`ap-f-${which}-err`}>
      {text}
    </span>
  ) : null;
}

/* ---------- Waveform and listening ---------- */

export function listenStatus(c: ProfileController) {
  return c.clock.playing ? { text: `Previewing ${fmt(c.clock.pos)}`, tone: "on" as const } : c.clock.event ? { text: "Paused", tone: "idle" as const } : undefined;
}

export function ListenBox({ c }: C) {
  const { p, clock, keys1, actions, view } = c;
  const now = useNowPlaying();
  const onAir = now.rooms[0]?.music?.trackId === c.editor.track.id;
  const next = clock.handover ? view.track(clock.handover.id) : undefined;
  const nextProf = clock.handover && next ? c.profileOf(next.id, clock.handover.place) : null;
  const xfading = !clock.handover && p.after === "loop" && p.loopXfade > 0 && clock.pos > p.end - p.loopXfade && clock.pos < p.end;
  const gain = clock.handover ? (nextProf ? envAt(nextProf, clock.handover.pos, false) : 1) : xfading ? 1 : envAt(p, clock.pos, clock.loops > 0);
  const level = clock.playing ? gain * (0.35 + 0.65 * levelAt(c.levels, clock.pos, c.dur)) : 0;
  const meterWords = xfading ? "crossfading" : gain < 0.995 ? (clock.handover || clock.pos < p.start + p.fadeIn.dur ? "fading in" : "fading out") : "";
  const eventIcon: IconName = clock.event?.type === "loop" ? "loop" : clock.event?.type === "stop" ? "stop" : "note";
  return (
    <>
      <Waveform c={c} />
      <div className="ap-listen">
        <div className="ap-transport" role="group" aria-label="Preview: only you hear it">
          <button
            type="button"
            className="btn ap-pvbtn"
            data-k="ap-play"
            aria-pressed={clock.playing}
            aria-keyshortcuts={keys1 ? "Space" : undefined}
            title={`${clock.playing ? "Pause the preview" : "Preview from the playhead, going round until you stop it: only you hear it"}${keys1 ? " (Space)" : ""}`}
            onClick={actions.togglePlay}
          >
            <Icon name={clock.playing ? "pause" : "headphones"} size="s" />
            {clock.playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="btn ap-pvbtn" data-k="ap-last" title="Preview from 10 seconds before End, to hear the fade, the end and what follows it" onClick={actions.playLast10}>
            <Icon name="headphones" size="s" />
            Play the last 10 s before End
          </button>
          <IconButton icon="stop" size="s" label="Stop the preview" hint="Stop the preview and go back to Start" data-k="ap-stop" onClick={actions.stop} />
        </div>
        <div className="ap-readouts">
          <div className="ap-ro">
            <span className="ap-ro-l">Position</span>
            <span className="ap-pos num">{fmt1(clock.pos)}</span>
          </div>
          <div className="ap-ro">
            <span className="ap-ro-l">Time to End</span>
            <span className="ap-toend num">{clock.pos > p.end + 0.05 ? "past End" : fmt1(p.end - clock.pos)}</span>
          </div>
          {/* BUG-17: Play goes round from Start to End for any track, so a track that does not loop counts its passes too. */}
          {(p.after === "loop" || clock.loops > 0) && (
            <div className="ap-ro">
              <span className="ap-ro-l">Looped</span>
              <span className="ap-loops num">{clock.loops ? times(clock.loops) : "not yet"}</span>
            </div>
          )}
          <div className="ap-ro ap-meter" role="meter" aria-label="Volume after fades" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(gain * 100)}>
            <span className="ap-ro-l">
              Volume <span className="ap-meter-s">{meterWords}</span>
            </span>
            <span className="ap-meter-row">
              <span className="ap-meter-track">
                <span className="ap-meter-bar" style={{ width: `${Math.round(level * 100)}%` }} />
              </span>
              <span className="ap-meter-v num">{Math.round(gain * 100)}%</span>
            </span>
          </div>
        </div>
        <div className="ap-air">
          <Button size="s" icon="playair" data-k="ap-air" title={`Play on air: the players hear it, from Start, with ${placeName(c.key, view)}`} onClick={actions.playOnAir}>
            Play on air
          </Button>
          {onAir && <span className="badge onair">On air</span>}
        </div>
      </div>
      {clock.handover && next ? (
        <div className="ap-event ap-ho">
          <Icon name="next" size="s" />
          <div className="grow">
            <div className="ellipsis">
              Moved on to <b>{shownTitle(next)}</b> <span className="faint">· {c.ctx?.label}</span>
            </div>
            <div className="ap-ho-p">
              <div className="progress preview grow">
                <span className="ap-ho-bar" style={{ width: `${Math.min(100, nextProf ? (clock.handover.pos / nextProf.end) * 100 : 0)}%` }} />
              </div>
              <span className="ap-ho-time num">{fmt1(clock.handover.pos)}</span>
            </div>
          </div>
          <ProfileLink trackId={next.id} title={shownTitle(next)} place={clock.handover.place} placeName={placeName(clock.handover.place, view)} hasOwn={hasOwn(next.id, clock.handover.place, view.overrides)} />
        </div>
      ) : clock.event ? (
        <div className="ap-event">
          <Icon name={eventIcon} size="s" />
          <span>{clock.event.text}</span>
        </div>
      ) : null}
      <div className="ap-keys">
        <label className="ap-switch">
          <input type="checkbox" role="switch" data-k="ap-keys1" checked={keys1} onChange={(e) => actions.setKeys1(e.target.checked)} />
          Single-key shortcuts
        </label>
        {/* Round 6 rule 5 (UX-R3): the legend shows while the keyboard is in the box; with keys off, the switch says so. */}
        {keys1 && (
          <span className="hint keys-on-focus" title="Space play or pause · I Start · O End · L loop start · M marker · arrows move the playhead 1 s (Shift: 10 s). Keys do nothing while you type.">
            <Kbd>Space</Kbd> <Kbd>I</Kbd> <Kbd>O</Kbd> <Kbd>L</Kbd> <Kbd>M</Kbd> <Kbd>←</Kbd>
            <Kbd>→</Kbd> play, Start, End, loop, marker, playhead
          </span>
        )}
      </div>
    </>
  );
}

/* ---------- At the end ---------- */

export function endStatus(c: ProfileController): string {
  const { p } = c;
  return p.after === "loop" ? `Loops from ${fmt(p.loopStart)}` : p.after === "next" ? `Moves on at ${fmt(p.end)}` : `Stops at ${fmt(p.end)}`;
}

export function EndBox({ c }: C) {
  const { p, editable, actions, keys1, view } = c;
  const pos = c.clock.pos;
  const radio = (v: "loop" | "next" | "stop", icon: IconName, label: string, sub: string) => (
    <label className={cx("ap-opt", p.after === v && "on")}>
      <input type="radio" name="ap-after" value={v} data-k={`ap-after-${v}`} checked={p.after === v} disabled={!editable} onChange={() => actions.setAfter(v)} />
      <span className="ap-opt-t">
        <Icon name={icon} size="s" />
        <b>{label}</b>
      </span>
      <span className="ap-opt-s">{sub}</span>
    </label>
  );
  const field = (which: Which, value: number, buttonLabel: string, key: string) => (
    <div className="ap-frow">
      <label htmlFor={`ap-f-${which}`}>{POINT[which]}</label>
      <TimeInput c={c} which={which} value={fmt(value)} />
      <button
        type="button"
        className="btn s"
        data-k={`ap-here-${which}`}
        aria-keyshortcuts={keys1 ? key : undefined}
        title={`${buttonLabel} (${fmt(pos)})${keys1 ? `, key ${key}` : ""}`}
        disabled={!editable}
        onClick={() => actions.setHere(which)}
      >
        <Icon name="arrow" size="s" />
        {buttonLabel}
      </button>
      <FieldError c={c} which={which} />
    </div>
  );
  const ctx = c.ctx;
  const next = ctx ? view.track(ctx.next) : undefined;
  return (
    <>
      <fieldset className="ap-opts" disabled={!editable}>
        <legend className="sr-only">At the end</legend>
        {radio("loop", "loop", "Loop back to loop start", `Repeats ${fmt(p.loopStart)} to ${fmt(p.end)}`)}
        {radio("next", "next", "Move to the next track", "The scene or playlist moves on; played on its own, it stops")}
        {radio("stop", "stop", "Stop", "Then silence")}
      </fieldset>
      {p.after === "next" && ctx && next && (
        <div className="ap-next">
          <span className="ap-ro-l">Next track</span>
          {c.contexts.length > 1 ? (
            <>
              <label className="sr-only" htmlFor="ap-ctx">
                Hear the hand-over as it plays
              </label>
              <select id="ap-ctx" className="input" data-k="ap-ctx" value={c.contexts.indexOf(ctx)} onChange={(e) => actions.chooseContext(Number(e.target.value))}>
                {c.contexts.map((x, i) => (
                  <option key={`${x.place}-${i}`} value={i}>
                    {x.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="muted">{ctx.label}</span>
          )}
          <div className="row-flex">
            <span className="grow ellipsis" title={shownTitle(next)}>
              <b>{shownTitle(next)}</b>
            </span>
            <ProfileLink trackId={next.id} title={shownTitle(next)} place={ctx.place} placeName={placeName(ctx.place, view)} iconOnly />
          </div>
          {ctx.lib && <p className="hint">Not in a scene or playlist yet: the preview uses the next Library track.</p>}
        </div>
      )}
      <div className="ap-fields">
        {field("start", p.start, "Start at playhead", "I")}
        {field("end", p.end, "End at playhead", "O")}
        {p.after === "loop" && field("loop", p.loopStart, "Loop from playhead", "L")}
      </div>
    </>
  );
}

/* ---------- Fades ---------- */

export function fadesStatus(c: ProfileController): string {
  const { p } = c;
  return p.fadeIn.dur || p.fadeOut.dur ? `In ${Math.round(p.fadeIn.dur * 10) / 10} s · out ${Math.round(p.fadeOut.dur * 10) / 10} s` : "No fades";
}

function Stepper({ c, which, value, unit }: C & { which: Which; value: number; unit: string }) {
  return (
    <span className="ap-step">
      <IconButton icon="minus" size="s" label={`Shorter ${unit}`} hint={`Shorter ${unit} (1 s less)`} data-k={`ap-st-${which}-m`} disabled={!c.editable} onClick={() => c.actions.step(which, -1)} />
      <TimeInput c={c} which={which} value={String(value)} secsOnly label={`${unit} length in seconds`} />
      <IconButton icon="plus" size="s" label={`Longer ${unit}`} hint={`Longer ${unit} (1 s more)`} data-k={`ap-st-${which}-p`} disabled={!c.editable} onClick={() => c.actions.step(which, 1)} />
      <span className="faint">s</span>
    </span>
  );
}

function FadeBlock({ c, kind }: C & { kind: "in" | "out" }) {
  const f = kind === "in" ? c.p.fadeIn : c.p.fadeOut;
  const which: Which = kind === "in" ? "fadein" : "fadeout";
  const label = kind === "in" ? "Fade in" : "Fade out";
  return (
    <div className="ap-fadeblock">
      <div className="ap-fb-h">
        <b id={`ap-fl-${kind}`}>{label}</b>
      </div>
      <div className="ap-fb-row">
        <span className="ap-fb-l">Length</span>
        <Stepper c={c} which={which} value={f.dur} unit={label.toLowerCase()} />
        <button
          type="button"
          className="btn s ghost"
          data-k={`ap-here-${which}`}
          title={`${kind === "in" ? "Fade in from Start up to the playhead" : "Fade out from the playhead to End"} (${fmt(c.clock.pos)})`}
          disabled={!c.editable}
          onClick={() => c.actions.setHere(which)}
        >
          <Icon name="arrow" size="s" />
          {kind === "in" ? "Up to playhead" : "From playhead"}
        </button>
        <FieldError c={c} which={which} />
      </div>
      <div className="ap-fb-row">
        <label className="ap-fb-l" htmlFor={`ap-sh-${kind}`}>
          Intensity
        </label>
        <span className="ap-int">
          <span className="hint" aria-hidden="true">
            Gentle
          </span>
          <input
            type="range"
            id={`ap-sh-${kind}`}
            aria-label={`${label} intensity`}
            data-k={`ap-sh-${kind}`}
            min={0}
            max={100}
            step={5}
            value={f.shape}
            aria-valuetext={`${shapeName(f.shape)}, ${f.shape} of 100`}
            disabled={!c.editable}
            onChange={(e) => c.actions.setShape(kind, Number(e.target.value))}
          />
          <span className="hint" aria-hidden="true">
            Sharp
          </span>
        </span>
        <svg className="ap-sketch" viewBox="0 0 64 28" aria-hidden="true" focusable="false">
          <path className="ap-sk-base" d="M2 25H62" />
          <path className="ap-sk" d={sketchPath(kind, f.shape)} />
        </svg>
        <span className="ap-shname">{shapeName(f.shape)}</span>
      </div>
    </div>
  );
}

export function FadesBox({ c }: C) {
  return (
    <>
      <FadeBlock c={c} kind="in" />
      <FadeBlock c={c} kind="out" />
      {c.p.after === "loop" && (
        // Round 6: what the crossfade does is read out with its group and shown on hover, not a line on screen.
        <div className="ap-fadeblock" role="group" aria-labelledby="ap-xf-h" aria-describedby="ap-xf-d" title={`Smooths the jump back to ${fmt(c.p.loopStart)}`}>
          <div className="ap-fb-h">
            <b id="ap-xf-h">Crossfade the loop</b>
            <span className="sr-only" id="ap-xf-d">
              Smooths the jump back to {fmt(c.p.loopStart)}
            </span>
          </div>
          <div className="ap-fb-row">
            <span className="ap-fb-l">Length</span>
            <Stepper c={c} which="xfade" value={c.p.loopXfade} unit="loop crossfade" />
            <FieldError c={c} which="xfade" />
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Markers ---------- */

export function markersStatus(c: ProfileController): string {
  const n = c.p.markers.length;
  return n ? `${n} marker${n === 1 ? "" : "s"}` : "Empty";
}

export function AddMarkerButton({ c }: C) {
  return (
    <Button
      size="s"
      icon="plus"
      data-k="ap-madd"
      aria-keyshortcuts={c.keys1 ? "M" : undefined}
      title={`Add a marker at the playhead (${fmt(c.clock.pos)})`}
      disabled={!c.editable}
      onClick={() => c.actions.addMarker(true)}
    >
      Add marker at playhead
    </Button>
  );
}

export function MarkersBox({ c }: C) {
  const { p, editable, actions } = c;
  if (!p.markers.length) return <p className="empty">No markers yet.</p>;
  return (
    <ol className="list ap-mlist">
      {p.markers.map((m, i) => (
        <li className="lrow ap-mrow" key={i}>
          <span className="num faint ap-mt">{fmt(m.at)}</span>
          <input className="input ap-ml" data-k={`ap-ml-${i}`} value={m.label} aria-label={`Marker label at ${fmt(m.at)}`} disabled={!editable} onChange={(e) => actions.renameMarker(i, e.target.value)} />
          <button type="button" className="btn s" data-k={`ap-mgo-${i}`} title={`Move the playhead to ${fmt(m.at)}`} aria-label={`Go to ${m.label}`} onClick={() => actions.seek(m.at)}>
            <Icon name="right" size="s" />
            Go to
          </button>
          {/* Round 7 (DAT-3): the mix-out point (where the next track crossfades in; one per track) and playing from here. */}
          <button
            type="button"
            className={cx("btn s", m.mix ? "primary" : "ghost r7-hov")}
            data-k={`ap-mmix-${i}`}
            aria-pressed={!!m.mix}
            aria-label={`Mix out at ${m.label}`}
            title="The next track crossfades in here"
            disabled={!editable}
            onClick={() => actions.mixOutAt(i)}
          >
            <Icon name="fade" size="s" />
            Mix out
          </button>
          <button
            type="button"
            className="btn s icon r7-hov"
            data-k={`ap-mfrom-${i}`}
            aria-label={`Play on air from ${m.label}`}
            title={`Play on air from ${fmt(m.at)} (the players hear it)`}
            onClick={() => actions.playFrom(m.at)}
          >
            <Icon name="playair" size="s" />
          </button>
          <button type="button" className="closer" data-k={`ap-mdel-${i}`} title="Remove this marker" aria-label={`Remove marker ${m.label}`} disabled={!editable} onClick={() => actions.removeMarker(i)}>
            <Icon name="trash" />
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Settings for: which place is being edited ---------- */

export function PlaceBar({ c }: C) {
  const { view, key, editable, actions } = c;
  const trackId = c.editor.track.id;
  const { pls, scs, sss } = placesOf(trackId, view);
  // An address can name a place that no longer uses the track and has no settings of its own; it is listed so the choice shows it.
  if (key && ![...pls, ...scs, ...sss].some((x) => x.key === key)) {
    (key.startsWith("pl:") ? pls : key.startsWith("ss:") ? sss : scs).push({ key, label: placeName(key, view).replace(/^the (playlist|scene|session) /, "") });
  }
  const option = (k: string, label: string) => (
    <option key={k} value={k}>
      {`${label}${!k ? "" : hasOwn(trackId, k, view.overrides) ? " · own settings" : " · uses the track's"}`}
    </option>
  );
  const kind = key.startsWith("sc:") ? "scene" : key.startsWith("ss:") ? "session" : "playlist";
  let status: React.ReactNode;
  if (!key) {
    const others = ownPlaceKeys(trackId, view.overrides);
    // Round 6 (UX-R3): "This track everywhere (its own)" in the list already says whose settings these are.
    status = (
      <>
        {others.length > 0 && <span className="hint ap-place-h">Not used in {others.map((k) => placeName(k, view)).join(", ")} (own settings)</span>}
      </>
    );
  } else if (editable) {
    status = (
      <>
        <span className="ap-badge own">
          <Icon name="edit" size="s" />
          Editing own settings for {placeName(key, view)}
        </span>
        <Button size="s" icon="restart" data-k="ap-clear" title={`Remove the settings for this ${kind} and use the track's own settings here`} onClick={() => void actions.clearOwn()}>
          Back to the track&apos;s settings
        </Button>
      </>
    );
  } else {
    status = (
      <>
        <div className="seg s ap-choice" role="group" aria-label={`Settings in ${placeName(key, view)}`}>
          <button type="button" data-k="ap-use" aria-pressed="true" onClick={actions.useTracks}>
            <Icon name="check" size="s" />
            Use the track&apos;s settings here
          </button>
          <button type="button" data-k="ap-own" aria-pressed="false" onClick={() => void actions.giveOwn()}>
            <Icon name="edit" size="s" />
            Give this place its own settings
          </button>
        </div>
        {c.editor.canUndoClear && (
          <Button size="s" variant="ghost" data-k="ap-undo" onClick={() => void actions.undoClear()}>
            Undo: bring its own settings back
          </Button>
        )}
      </>
    );
  }
  return (
    <div className={cx("ap-place", key && (editable ? "is-own" : "is-ro"))}>
      <label className="ap-place-l" htmlFor="ap-place">
        Settings for
      </label>
      <select id="ap-place" className="input ap-place-sel" data-k="ap-place" value={key} onChange={(e) => actions.choosePlace(e.target.value)}>
        {option("", "This track everywhere (its own)")}
        {pls.length > 0 && <optgroup label="Playlists">{pls.map((x) => option(x.key, `Playlist: ${x.label}`))}</optgroup>}
        {scs.length > 0 && <optgroup label="Scenes (cues)">{scs.map((x) => option(x.key, `Scene: ${x.label}`))}</optgroup>}
        {sss.length > 0 && <optgroup label="Sessions">{sss.map((x) => option(x.key, `Session list: ${x.label}`))}</optgroup>}
      </select>
      <div className="ap-place-st">{status}</div>
    </div>
  );
}
