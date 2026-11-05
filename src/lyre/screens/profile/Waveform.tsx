/**
 * The waveform strip (the prototype's waveHTML and layout in views/profile.js): the whole file, the parts not played
 * shaded, the looped part marked, the playhead, the marker flags, the time ruler, and handles for Start, End, Loop
 * start and both fade lengths. Every handle is a slider: drag it, or use the arrow keys (Shift for 10 s).
 */
import React, { useLayoutEffect, useRef, useState } from "react";

import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { clamp, fmt, isLength, pointText, rangeOf, type Which } from "./profileModel";
import type { ProfileController } from "./useProfileController";
import { drawWave } from "./waveDrawing";

/** Ruler steps in seconds; the first that leaves at least 54 px between ticks is used. */
const RULER_STEPS = [5, 10, 15, 30, 60, 120, 300];

function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Waveform({ c }: { c: ProfileController }) {
  const { p, dur, editable, clock, actions } = c;
  const waveRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = useWidth(waveRef);

  useLayoutEffect(() => {
    if (canvasRef.current) drawWave(canvasRef.current, { prof: p, dur, pos: clock.pos, playing: clock.playing, levels: null });
  });

  const pct = (s: number) => `${((clamp(s, 0, dur) / dur) * 100).toFixed(3)}%`;
  const secAt = (e: { clientX: number }) => {
    const r = waveRef.current?.getBoundingClientRect();
    return r && r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) * dur : 0;
  };

  const step = RULER_STEPS.find((s) => W / (dur / s) >= 54) ?? 600;
  const ticks: number[] = [];
  for (let s = 0; s <= dur - step * 0.4; s += step) ticks.push(s);

  const xs = p.markers.map((m) => (m.at / dur) * W);
  const startOutPx = (p.start / dur) * W;
  const endOutPx = ((dur - p.end) / dur) * W;

  const handle = (which: Which, v: number, label: string, cls: string) => {
    const [lo, hi] = rangeOf(p, dur, which);
    const len = isLength(which);
    const at = which === "fadein" ? p.start + v : which === "fadeout" ? p.end - v : v;
    const words = pointText(which, v);
    const tip = !editable
      ? " (the track's settings: not editable in this place)"
      : len
        ? ": drag along the volume line, or arrow keys to change the length"
        : ": drag, or use the arrow keys (Shift for 10 s)";
    return (
      <div
        className={cx("ap-h", cls)}
        role="slider"
        tabIndex={0}
        data-k={`ap-h-${which}`}
        style={{ left: pct(at) }}
        aria-label={label}
        aria-orientation="horizontal"
        aria-readonly={editable ? undefined : true}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={v}
        aria-valuetext={words}
        title={`${label} ${words}${tip}`}
        onPointerDown={(e) => actions.dragHandle(which, e, secAt)}
        onKeyDown={(e) => actions.keyOnHandle(which, e)}
      >
        {len ? (
          <span className="ap-knob" />
        ) : (
          <span className="ap-htab">
            <Icon name="drag" size="s" />
            {which === "loop" ? "Loop" : label}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={cx("ap-wave", !editable && "ro")} ref={waveRef}>
      <div className="ap-out" style={{ left: 0, width: pct(p.start) }}>
        <span hidden={startOutPx < 84}>Not played</span>
      </div>
      <div className="ap-out" style={{ left: pct(p.end), right: 0 }}>
        <span hidden={endOutPx < 84}>Not played</span>
      </div>
      {p.after === "loop" && <div className="ap-loop" style={{ left: pct(p.loopStart), width: `${(((p.end - p.loopStart) / dur) * 100).toFixed(3)}%` }} />}
      <canvas className="ap-canvas" ref={canvasRef} aria-hidden="true" />
      <div
        className="ap-scrub"
        role="slider"
        tabIndex={0}
        data-k="ap-scrub"
        aria-label="Playhead"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={Math.floor(clock.pos)}
        aria-valuetext={fmt(clock.pos)}
        title="Click or drag to move the playhead; arrow keys move it 1 s (Shift: 10 s)"
        onPointerDown={(e) => actions.scrubFrom(e, secAt)}
        onKeyDown={(e) => actions.keyOnScrub(e)}
      />
      <div className={cx("ap-ph", clock.playing && "on")} style={{ left: pct(clock.pos) }} aria-hidden="true" />
      {p.markers.map((m, i) => {
        const flip = xs[i] > W - 60;
        const room = flip ? xs[i] - (i ? xs[i - 1] : 0) - 14 : (i < xs.length - 1 ? xs[i + 1] : W) - xs[i] - 14;
        return (
          <span
            key={`${m.at}-${i}`}
            className={cx("ap-flag", flip && "flip", room < 70 && "crowd")}
            style={{ left: pct(m.at) }}
            title={`${m.label} (${fmt(m.at)}): go there`}
            aria-hidden="true"
            onClick={() => actions.seek(m.at)}
          >
            <span className="ap-flag-l" style={{ maxWidth: `${Math.min(140, Math.max(room, 90))}px` }}>
              {m.label}
            </span>
          </span>
        );
      })}
      {handle("start", p.start, "Start", "ap-h-start")}
      {handle("end", p.end, "End", "ap-h-end")}
      {p.after === "loop" && handle("loop", p.loopStart, "Loop start", "ap-h-loop")}
      {handle("fadein", p.fadeIn.dur, "Fade in length", "ap-fk ap-fk-in")}
      {handle("fadeout", p.fadeOut.dur, "Fade out length", "ap-fk ap-fk-out")}
      <div className="ap-ruler" aria-hidden="true">
        {ticks.map((s) => (
          <span key={s} className={cx("ap-tick", s === 0 && "first")} style={{ left: pct(s) }}>
            {fmt(s)}
          </span>
        ))}
        <span className="ap-tick last" style={{ left: "100%" }}>
          {fmt(dur)}
        </span>
      </div>
    </div>
  );
}
