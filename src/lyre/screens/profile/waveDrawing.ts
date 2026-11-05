/**
 * Draws the waveform band and the volume line on the Audio profile's canvas (the prototype's draw() in
 * views/profile.js). Bars outside Start and End are drawn faint; under a fade they get smaller and fainter, so you can
 * see where it gets quieter; bars before the playhead take the preview colour while you listen.
 *
 * The library does not yet have the loudness of each file (no peaks are read on import), so every bar has the same
 * height; the prototype's made-up shape is not drawn, because it would show quiet and loud parts that are not in the
 * music. When peaks arrive they go in `levels` (0 to 1 across the file).
 */
import { envAt, type Prof } from "./profileModel";

export interface WaveDrawing {
  prof: Prof;
  dur: number;
  pos: number;
  playing: boolean;
  /** Loudness across the file, 0 to 1; null while unknown (an even band). */
  levels: readonly number[] | null;
}

/** The band's height where the loudness of the file is not known. */
const EVEN_LEVEL = 0.62;

/** The level at a point of the file (0 to 1). */
export function levelAt(levels: readonly number[] | null, sec: number, dur: number): number {
  if (!levels || levels.length === 0 || dur <= 0) return EVEN_LEVEL;
  return levels[Math.max(0, Math.min(levels.length - 1, Math.floor((sec / dur) * levels.length)))];
}

export function drawWave(cv: HTMLCanvasElement, d: WaveDrawing): void {
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  // Not laid out yet (or a test page that draws nothing).
  if (!W || !H) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const cs = getComputedStyle(cv);
  const colour = (name: string) => cs.getPropertyValue(name).trim();
  const c = { music: colour("--music"), ink: colour("--ink"), out: colour("--line-strong"), preview: colour("--preview"), env: colour("--ink-2") };
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const { prof: p, dur } = d;
  const stepPx = W >= 640 ? 3 : W >= 420 ? 4 : 5;
  const n = Math.floor(W / stepPx);
  const mid = H / 2;
  const top = 10;
  for (let i = 0; i < n; i++) {
    const sec = ((i + 0.5) / n) * dur;
    const inside = sec >= p.start && sec <= p.end;
    const e = envAt(p, sec, false);
    ctx.fillStyle = !inside ? c.out : sec <= d.pos ? (d.playing ? c.preview : c.ink) : c.music;
    ctx.globalAlpha = inside ? 0.45 + 0.55 * e : 0.5;
    const h = Math.max(2, levelAt(d.levels, sec, dur) * e * (H - 2 * top));
    ctx.fillRect(i * stepPx, Math.round(mid - h / 2), stepPx - 1, Math.round(h));
  }
  ctx.globalAlpha = 1;
  // The volume line: full volume along the top, falling towards the centre line as it fades.
  const x = (s: number) => (s / dur) * W;
  const y = (v: number) => mid - v * (mid - top);
  ctx.strokeStyle = c.env;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = Math.max(40, Math.round(x(p.end) - x(p.start)) / 2);
  for (let k = 0; k <= steps; k++) {
    const s = p.start + ((p.end - p.start) * k) / steps;
    if (k) ctx.lineTo(x(s), y(envAt(p, s, false)));
    else ctx.moveTo(x(s), y(envAt(p, s, false)));
  }
  ctx.stroke();
  // A crossfaded loop: the end slopes down and the loop start slopes up over the crossfade (dashed).
  if (p.after === "loop" && p.loopXfade > 0) {
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x(p.end - p.loopXfade), y(1));
    ctx.lineTo(x(p.end), y(0));
    ctx.moveTo(x(p.loopStart), y(0));
    ctx.lineTo(x(p.loopStart + p.loopXfade), y(1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
