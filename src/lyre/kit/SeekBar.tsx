/**
 * A playing track's position bar that can be clicked or dragged to jump (0.5.1, Nik 11 Nov: "I can't click and
 * interact with the tracking bar in the now playing bar, and choose to skip to a certain point in the track"). The
 * standard slider pattern (WAI-ARIA APG "Slider"): role slider, named "Position in <track>", its value in seconds with
 * the words "1:23 of 4:05"; Left and Right (or Down and Up) move 5 s, Page Down and Page Up 30 s, Home goes to the
 * start, End to the end. A click jumps there; a drag shows where it will go and jumps once it is let go. The bar is
 * thin, its hit area 24 px high (WCAG 2.5.8). While the length is not known it is greyed and does nothing.
 *
 * Used by the Now playing bar (on air and the preview) and Live's On air; `children` draws on the bar (markers).
 */
import React, { useRef, useState } from "react";

import { cx } from "./cx";

/** "1:23", "1:02:03", rounded as the time beside the bar is (clockTime). */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Seconds the arrow keys and Page keys move. */
export const SEEK_STEP_S = 5;
export const SEEK_PAGE_S = 30;

export interface SeekBarProps {
  /** The track's name as the screen shows it: the slider is "Position in <name>". */
  name: string;
  /** Seconds into the file; null while it loads. */
  position: number | null;
  /** Where the bar ends, in seconds (the track's End, or the file's length); null until known. */
  length: number | null;
  /** The bar's colour: the lane's (music, amb, preview). */
  lane: "music" | "amb" | "preview" | "fx";
  /** Jump to this many seconds (0 to `length`). */
  onSeek: (seconds: number) => void;
  /** Classes for the bar itself (e.g. Live's marker bar). */
  barClassName?: string;
  className?: string;
  children?: React.ReactNode;
}

export function SeekBar({ name, position, length, lane, onSeek, barClassName, className, children }: SeekBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** Where a drag is now, in seconds (null when not dragging). */
  const [dragAt, setDragAt] = useState<number | null>(null);
  const known = length !== null && length > 0;
  const max = known ? length : 0;
  const shown = dragAt ?? position ?? 0;
  const clamp = (s: number) => Math.min(max, Math.max(0, s));
  const at = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return clamp(((clientX - box.left) / box.width) * max);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!known) return;
    const from = position ?? 0;
    const to: Record<string, number> = {
      ArrowRight: from + SEEK_STEP_S,
      ArrowUp: from + SEEK_STEP_S,
      ArrowLeft: from - SEEK_STEP_S,
      ArrowDown: from - SEEK_STEP_S,
      PageUp: from + SEEK_PAGE_S,
      PageDown: from - SEEK_PAGE_S,
      Home: 0,
      End: max,
    };
    if (!(event.key in to)) return;
    event.preventDefault();
    onSeek(clamp(to[event.key]));
  };

  return (
    <div
      ref={ref}
      className={cx("seek", !known && "off", dragAt !== null && "dragging", className)}
      role="slider"
      tabIndex={0}
      aria-label={`Position in ${name}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(known ? shown : 0)}
      aria-valuetext={known ? `${clock(shown)} of ${clock(max)}` : "Loading"}
      aria-disabled={known ? undefined : true}
      title={known ? "Click or drag to jump; the arrow keys move 5 seconds" : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!known || event.button !== 0) return;
        event.preventDefault();
        ref.current?.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragAt(at(event.clientX));
      }}
      onPointerMove={(event) => {
        if (dragAt !== null) setDragAt(at(event.clientX));
      }}
      onPointerUp={(event) => {
        if (dragAt === null) return;
        setDragAt(null);
        onSeek(at(event.clientX));
      }}
      onPointerCancel={() => setDragAt(null)}
    >
      <div className={cx("progress", lane, barClassName)}>
        <span style={{ width: `${known ? Math.min(100, (shown / max) * 100) : 0}%` }} />
        {children}
      </div>
    </div>
  );
}
