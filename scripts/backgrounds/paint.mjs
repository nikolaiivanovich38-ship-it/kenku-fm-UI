/* global document */
/**
 * Lyre's built-in background pictures, painted in code.
 *
 * Kenku FM stored a background on each playlist and soundboard as one of 23
 * names ("tavern"). Its pictures are not open source, so Lyre paints its
 * own under the same names: libraries brought over from Kenku FM show a
 * picture without any change to their data.
 *
 * This module runs in a browser page (render.mjs opens it in Playwright's
 * Chromium) and paints on a 2D canvas. Everything comes from a seeded random
 * number generator, so the same Chromium build always gives the same pixels.
 * The pure helpers at the top are also imported by the Node tests.
 *
 * Style, shared by every picture: dark, soft, painterly scenes built from
 * gradients, noise, glows, mist and simple silhouettes. They sit behind white
 * text in the player, so they stay mid-to-dark with little detail at the top
 * (title) and bottom (track list); `finish` checks and caps the brightness.
 */

export const WIDTH = 1600;
export const HEIGHT = 1000;
/** Changing this repaints every picture differently. */
export const SEED = 20261104;

export const NAMES = [
  "autumn", "beach", "butterflys", "castle", "cathedral", "dragon", "haunted", "lines",
  "mountain", "sand", "skulls", "sky", "smoke", "sparks", "stars", "tavern", "texture",
  "town", "tree", "veins", "volcano", "war", "winter",
];

// ---------------------------------------------------------------------------
// Pure helpers (no browser needed)

/** Small, fast seeded random numbers in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a name, so each picture gets its own random sequence. */
export function hashName(name) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seeded 2D gradient noise with fractal sums. Values roughly in [-1, 1]. */
export function makeNoise(rand) {
  const perm = new Uint8Array(512);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
  const gx = new Float64Array(256);
  const gy = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const angle = rand() * Math.PI * 2;
    gx[i] = Math.cos(angle);
    gy[i] = Math.sin(angle);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise(x, y) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const xf = x - fx;
    const yf = y - fy;
    const xi = fx & 255;
    const yi = fy & 255;
    const h00 = perm[perm[xi] + yi];
    const h10 = perm[perm[xi + 1] + yi];
    const h01 = perm[perm[xi] + yi + 1];
    const h11 = perm[perm[xi + 1] + yi + 1];
    const d00 = gx[h00] * xf + gy[h00] * yf;
    const d10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const d01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const d11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const top = d00 + (d10 - d00) * u;
    const bottom = d01 + (d11 - d01) * u;
    return (top + (bottom - top) * v) * 1.41;
  }

  function fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * noise(x * frequency + i * 17.3, y * frequency - i * 9.1);
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / total;
  }

  /** Sharp-crested noise in [0, 1], for peaks and veins. */
  function ridged(x, y, octaves = 5) {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise(x * frequency + i * 5.7, y * frequency + i * 3.1));
      sum += amplitude * n * n;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / total;
  }

  return { noise, fbm, ridged };
}

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (lo, hi, v) => {
  const t = clamp((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** "#rrggbb" to [r, g, b]. */
function hex(color) {
  if (Array.isArray(color)) return color;
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(color, alpha = 1) {
  // Already a CSS colour with its own alpha.
  if (typeof color === "string" && color.startsWith("rgb")) return color;
  const [r, g, b] = hex(color);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

function mix(a, b, t) {
  const ca = hex(a);
  const cb = hex(b);
  return [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)];
}

/** Colour along [[position, colour], …] stops (positions ascending, 0..1). */
function ramp(stops, t) {
  if (t <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      return mix(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return hex(stops[stops.length - 1][1]);
}

// ---------------------------------------------------------------------------
// The painting kit: one per picture, around a canvas and its random numbers

function createStudio(canvas, name) {
  const W = WIDTH;
  const H = HEIGHT;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(hashName(name) ^ SEED);
  const noise = makeNoise(rand);
  const S = { ctx, W, H, rand, noise };

  S.r = (lo = 0, hi = 1) => lo + (hi - lo) * rand();
  S.pick = (list) => list[Math.floor(rand() * list.length)];
  S.gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

  S.newCanvas = (w = W, h = H) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };

  /** Paint `draw` on a layer of its own, then lay it on the picture. */
  S.layer = (draw, { blur = 0, composite = "source-over", alpha = 1 } = {}) => {
    const c = S.newCanvas();
    draw(c.getContext("2d"));
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = alpha;
    if (blur > 0) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  };

  /**
   * Paint a layer pixel by pixel. `shade(x, y, out)` writes [r, g, b, alpha 0..1]
   * into `out`. Works at 1/scale resolution and is smoothed up, which keeps
   * it soft (and the JPEG small).
   */
  S.field = (shade, { scale = 2, composite = "source-over", alpha = 1, blur = 0 } = {}) => {
    const w = Math.ceil(W / scale);
    const h = Math.ceil(H / scale);
    const c = S.newCanvas(w, h);
    const cx = c.getContext("2d");
    const image = cx.createImageData(w, h);
    const data = image.data;
    const out = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[3] = 1;
        shade(x * scale, y * scale, out);
        const i = (y * w + x) * 4;
        data[i] = out[0];
        data[i + 1] = out[1];
        data[i + 2] = out[2];
        data[i + 3] = clamp(out[3]) * 255;
      }
    }
    cx.putImageData(image, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (blur > 0) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(c, 0, 0, W, H);
    ctx.restore();
  };

  /** Vertical gradient over [y0, y1] (whole picture by default). */
  S.vgrad = (l, stops, y0 = 0, y1 = H) => {
    const g = l.createLinearGradient(0, y0, 0, y1);
    for (const [p, c] of stops) g.addColorStop(p, rgba(c));
    l.fillStyle = g;
    l.fillRect(0, y0, W, y1 - y0);
  };

  /** A soft round light. */
  S.glow = (l, x, y, radius, color, alpha = 1) => {
    const g = l.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.18, rgba(color, alpha * 0.6));
    g.addColorStop(0.45, rgba(color, alpha * 0.2));
    g.addColorStop(1, rgba(color, 0));
    l.fillStyle = g;
    l.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  /** Heights along x (every 4 px) for a hill or mountain line. */
  S.ridge = (base, amplitude, frequency, { octaves = 5, sharp = false, offset = S.r(0, 100), shape } = {}) => {
    const ys = [];
    for (let x = 0; x <= W + 4; x += 4) {
      const n = sharp
        ? noise.ridged(x * frequency + offset, offset) * 2 - 1
        : noise.fbm(x * frequency + offset, offset * 0.37, octaves);
      ys.push(base - amplitude * n - (shape ? shape(x) : 0));
    }
    return ys;
  };

  S.fillUnder = (l, ys, style, bottom = H) => {
    l.beginPath();
    l.moveTo(0, bottom);
    for (let i = 0; i < ys.length; i++) l.lineTo(i * 4, ys[i]);
    l.lineTo(W, bottom);
    l.closePath();
    l.fillStyle = style;
    l.fill();
  };

  /** A drifting band of mist between y0 and y1. */
  S.mist = (y0, y1, color, alpha, { frequency = 0.0025, blur = 4, stretch = 4 } = {}) => {
    const [r, g, b] = hex(color);
    const offset = S.r(0, 50);
    S.field(
      (x, y, out) => {
        out[0] = r;
        out[1] = g;
        out[2] = b;
        const band = smooth(y0, lerp(y0, y1, 0.4), y) * (1 - smooth(lerp(y0, y1, 0.6), y1, y));
        const n = noise.fbm((x * frequency) / stretch + offset, y * frequency + offset, 4);
        out[3] = band * alpha * smooth(-0.35, 0.45, n);
      },
      { scale: 4, blur },
    );
  };

  /**
   * Painterly pass: short strokes in the picture's own colours, laid along a
   * flowing direction. Run it before fine details (stars, sparks) so those stay crisp.
   */
  S.paint = (strength = 1, { size = 1 } = {}) => {
    const source = ctx.getImageData(0, 0, W, H).data;
    const count = Math.round(16000 * strength);
    const offset = S.r(0, 100);
    ctx.save();
    ctx.lineCap = "round";
    const lumAt = (x, y) => {
      const i = ((clamp(y, 0, H - 1) | 0) * W + (clamp(x, 0, W - 1) | 0)) * 4;
      return (0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2]) / 255;
    };
    for (let i = 0; i < count; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const index = ((y | 0) * W + (x | 0)) * 4;
      const angle = noise.fbm(x * 0.0018 + offset, y * 0.0018, 3) * Math.PI * 1.6;
      const length = S.r(8, 22) * size;
      const dx = (Math.cos(angle) * length) / 2;
      const dy = (Math.sin(angle) * length) / 2;
      const jitter = S.r(0.94, 1.06);
      // Strokes across a sharp edge would make silhouettes look furry: leave edges alone.
      if (Math.abs(lumAt(x - dx, y - dy) - lumAt(x + dx, y + dy)) > 0.05) continue;
      ctx.strokeStyle = rgba(
        [source[index] * jitter, source[index + 1] * jitter, source[index + 2] * jitter],
        0.32,
      );
      ctx.lineWidth = S.r(2, 5) * size;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * Last step for every picture: cap the highlights, darken the edges and add
   * a little grain. The playlist page lightens the lower part of the picture
   * under its track list, so that part is darkened a little (`lowerShade`)
   * and its highlights are held lower (`lowerCap`).
   */
  S.finish = ({ exposure = 1, maxLum = 0.72, vignette = 0.5, grain = 2.2, lowerCap = 0.4, lowerShade = 0.15 } = {}) => {
    const image = ctx.getImageData(0, 0, W, H);
    const d = image.data;
    for (let y = 0; y < H; y++) {
      const vy = (y / H - 0.5) * 2;
      const lower = smooth(0.5, 0.7, y / H);
      const cap = maxLum * (1 - lowerCap * lower);
      const gain = exposure * (1 - lowerShade * smooth(0.45, 0.7, y / H));
      const knee = cap * 0.6;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const vx = (x / W - 0.5) * 2;
        const edge = 1 - vignette * smooth(0.35, 1.5, Math.sqrt(vx * vx * 0.8 + vy * vy));
        let r = (d[i] / 255) * gain * edge;
        let g = (d[i + 1] / 255) * gain * edge;
        let b = (d[i + 2] / 255) * gain * edge;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > knee) {
          const capped = knee + (cap - knee) * (1 - Math.exp(-(lum - knee) / (cap - knee)));
          const k = capped / lum;
          r *= k;
          g *= k;
          b *= k;
        }
        const n = (rand() - 0.5) * grain;
        d[i] = clamp(r * 255 + n, 0, 255);
        d[i + 1] = clamp(g * 255 + n, 0, 255);
        d[i + 2] = clamp(b * 255 + n, 0, 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  };

  return S;
}

/** sRGB channel (0..255) to linear light. */
function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * How the finished picture will read behind white text.
 * - brightness: mean sRGB luma (0..1) of the top, middle and bottom bands.
 * - contrast: WCAG contrast of white text against the brightest 5% of the
 *   picture as the playlist page shows it, under its own overlay
 *   (linear-gradient(0deg, #ffffff44 30%, #00000088 100%), src/player/features/playlists/Playlist.tsx),
 *   for the title (top 15%) and the track list (the rest).
 */
function measure(ctx) {
  const d = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const bands = { top: [0, 0.25], middle: [0.25, 0.7], bottom: [0.7, 1], all: [0, 1] };
  const brightness = {};
  for (const [band, [from, to]] of Object.entries(bands)) {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(from * HEIGHT); y < to * HEIGHT; y += 2) {
      for (let x = 0; x < WIDTH; x += 2) {
        const i = (y * WIDTH + x) * 4;
        sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        n++;
      }
    }
    brightness[band] = Math.round((sum / n) * 1000) / 1000;
  }
  const title = [];
  const tracks = [];
  for (let y = 0; y < HEIGHT; y += 4) {
    const fromBottom = 1 - (y + 0.5) / HEIGHT;
    const white = fromBottom <= 0.3 ? 0x44 / 255 : (0x44 / 255) * (1 - (fromBottom - 0.3) / 0.7);
    const black = fromBottom <= 0.3 ? 0 : (0x88 / 255) * ((fromBottom - 0.3) / 0.7);
    const alpha = white + black;
    const tint = alpha > 0 ? (255 * white) / alpha : 0;
    for (let x = 0; x < WIDTH; x += 4) {
      const i = (y * WIDTH + x) * 4;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]].map((c) => c * (1 - alpha) + tint * alpha);
      const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      (y < HEIGHT * 0.15 ? title : tracks).push(lum);
    }
  }
  const worst = (values) => {
    values.sort((a, b) => a - b);
    const p95 = values[Math.floor(values.length * 0.95)];
    return Math.round((1.05 / (p95 + 0.05)) * 10) / 10;
  };
  return { brightness, contrast: { title: worst(title), tracks: worst(tracks) } };
}

// ---------------------------------------------------------------------------
// Shapes shared by several scenes

/** A tapering trunk with a few branches, from (x, bottom) up to `top`. */
function trunk(S, l, x, bottom, top, width, color) {
  const { r } = S;
  const lean = r(-30, 30);
  l.fillStyle = color;
  l.beginPath();
  l.moveTo(x - width / 2, bottom);
  l.quadraticCurveTo(x - width * 0.45 + lean * 0.5, (bottom + top) / 2, x - width * 0.3 + lean, top);
  l.lineTo(x + width * 0.3 + lean, top);
  l.quadraticCurveTo(x + width * 0.45 + lean * 0.5, (bottom + top) / 2, x + width / 2, bottom);
  l.closePath();
  l.fill();
  l.strokeStyle = color;
  l.lineCap = "round";
  const branches = Math.floor(r(1, 4));
  for (let i = 0; i < branches; i++) {
    const t = r(0.3, 0.85);
    const by = lerp(bottom, top, t);
    const bx = x + lean * t;
    const side = S.rand() < 0.5 ? -1 : 1;
    const length = r(60, 180) * (width / 30);
    l.lineWidth = width * r(0.18, 0.3);
    l.beginPath();
    l.moveTo(bx, by);
    l.quadraticCurveTo(bx + side * length * 0.5, by - length * 0.2, bx + side * length, by - length * r(0.4, 0.9));
    l.stroke();
  }
}

/** A recursive branching tree (bare or with leaf clumps), drawn in one colour. */
function branch(S, l, x, y, angle, length, width, depth, { color, leaves = null, twist = 0.45 }) {
  const { r } = S;
  const bend = r(-twist, twist) * 0.6;
  const ex = x + Math.cos(angle) * length;
  const ey = y + Math.sin(angle) * length;
  const cx = x + Math.cos(angle + bend) * length * 0.5;
  const cy = y + Math.sin(angle + bend) * length * 0.5;
  l.strokeStyle = color;
  l.lineCap = "round";
  l.lineWidth = Math.max(width, 0.8);
  l.beginPath();
  l.moveTo(x, y);
  l.quadraticCurveTo(cx, cy, ex, ey);
  l.stroke();
  if (depth <= 0) {
    if (leaves) leaves(ex, ey);
    return;
  }
  const children = S.rand() < 0.35 ? 3 : 2;
  for (let i = 0; i < children; i++) {
    const spread = (i - (children - 1) / 2) * r(0.35, 0.7) + r(-twist, twist) * 0.5;
    branch(S, l, ex, ey, angle + spread, length * r(0.66, 0.8), width * 0.68, depth - 1, { color, leaves, twist });
  }
}

/** A pointed (equilateral) Gothic arch outline. */
function gothicArch(l, cx, top, width, bottom) {
  const spring = top + width * 0.866;
  l.beginPath();
  l.moveTo(cx - width / 2, bottom);
  l.lineTo(cx - width / 2, spring);
  l.arc(cx + width / 2, spring, width, Math.PI, Math.PI + Math.PI / 3);
  l.arc(cx - width / 2, spring, width, -Math.PI / 3, 0);
  l.lineTo(cx + width / 2, bottom);
  l.closePath();
}

/** A pine tree: a thin trunk and stacked tiers, optional snow on the tiers. */
function pine(S, l, x, base, height, color, snow = null) {
  const { r } = S;
  const tiers = Math.floor(r(5, 8));
  const width = height * r(0.32, 0.42);
  l.fillStyle = color;
  l.fillRect(x - height * 0.015, base - height * 0.15, height * 0.03, height * 0.2);
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const tierBottom = base - height * 0.12 - k * height * 0.8;
    const tierTop = tierBottom - height * 0.3;
    const half = (width / 2) * (1 - k * 0.8);
    l.fillStyle = color;
    l.beginPath();
    l.moveTo(x - half, tierBottom);
    l.quadraticCurveTo(x - half * 0.3, tierBottom - height * 0.04, x, tierTop);
    l.quadraticCurveTo(x + half * 0.3, tierBottom - height * 0.04, x + half, tierBottom);
    l.quadraticCurveTo(x, tierBottom - height * 0.03, x - half, tierBottom);
    l.fill();
    if (snow) {
      l.strokeStyle = snow;
      l.lineWidth = Math.max(1, height * 0.012);
      l.beginPath();
      l.moveTo(x - half * 0.85, tierBottom - 1);
      l.quadraticCurveTo(x - half * 0.3, tierBottom - height * 0.05, x - half * 0.05, tierTop + height * 0.06);
      l.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// The 23 scenes

export const SCENES = {
  autumn(S) {
    const { ctx, W, H, r } = S;
    S.vgrad(ctx, [[0, "#120a10"], [0.3, "#2e1614"], [0.55, "#6a3018"], [0.63, "#7a3a1a"], [0.72, "#3a1a0e"], [1, "#120804"]]);
    S.layer((l) => S.glow(l, 820, 590, 560, "#ffa050", 0.5), { composite: "screen" });
    S.layer((l) => S.fillUnder(l, S.ridge(600, 40, 0.01, { octaves: 5 }), "#40200f"), { blur: 6, alpha: 0.85 });
    S.mist(520, 720, "#c87038", 0.4);
    // Far trunks in the haze, then near ones; the middle stays open.
    S.layer((l) => {
      for (let i = 0; i < 16; i++) {
        const x = S.rand() < 0.5 ? r(0, 600) : r(1000, W);
        trunk(S, l, x, 780, r(-50, 200), r(6, 16), "#2a130b");
      }
    }, { blur: 4, alpha: 0.9 });
    // Foliage: warm clumps along the top.
    S.layer((l) => {
      for (let i = 0; i < 260; i++) {
        const x = r(-100, W + 100);
        const y = Math.abs(S.gauss()) * 260 - 60 + (Math.abs(x - 800) < 300 ? -60 : 0);
        l.fillStyle = rgba(S.pick(["#a8401a", "#c86a22", "#7a2a12", "#d8902e", "#8a3a14"]), 0.3);
        l.beginPath();
        l.arc(x, y, r(30, 110), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 14 });
    S.layer((l) => {
      S.vgrad(l, [[0, "rgba(0,0,0,0)"], [0.3, "#2a1408"], [1, "#0c0503"]], 740, H);
    });
    S.paint(1);
    S.layer((l) => {
      for (let i = 0; i < 5; i++) {
        const x = i < 3 ? r(20, 520) : r(1100, 1580);
        trunk(S, l, x, H + 20, -40, r(26, 52), "#0f0705");
      }
    }, { blur: 1.2 });
    // Falling leaves: far ones soft, near ones sharper.
    const leaf = (l, x, y, size, angle, color) => {
      l.save();
      l.translate(x, y);
      l.rotate(angle);
      l.fillStyle = color;
      l.beginPath();
      l.moveTo(-size, 0);
      l.quadraticCurveTo(0, -size * 0.55, size, 0);
      l.quadraticCurveTo(0, size * 0.55, -size, 0);
      l.fill();
      l.restore();
    };
    S.layer((l) => {
      for (let i = 0; i < 90; i++) leaf(l, r(0, W), r(0, 900), r(5, 9), r(0, 6.3), rgba(S.pick(["#c0602a", "#d8902e", "#9a3418"]), 0.7));
    }, { blur: 2.5 });
    S.layer((l) => {
      for (let i = 0; i < 26; i++) leaf(l, r(0, W), r(60, 940), r(10, 16), r(0, 6.3), rgba(S.pick(["#b8501e", "#d08a2a", "#8a2c14"]), 0.85));
    }, { blur: 0.6 });
    S.finish({ vignette: 0.55 });
  },

  beach(S) {
    const { ctx, W, H, r, noise } = S;
    const horizon = 500;
    S.vgrad(ctx, [[0, "#0a1220"], [0.55, "#1c2a4c"], [0.85, "#3e3454"], [1, "#9a6058"]], 0, horizon);
    S.vgrad(ctx, [[0, "#3e3450"], [0.12, "#20263f"], [0.6, "#10182c"], [1, "#0a101e"]], horizon, 830);
    // Streaky clouds lit from the low sun.
    S.field((x, y, out) => {
      const d = noise.fbm(x * 0.0012, y * 0.007, 5);
      const c = mix("#3a3054", "#c08878", smooth(150, horizon, y));
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(0.05, 0.5, d) * 0.55 * (1 - smooth(horizon - 30, horizon, y));
    }, { blur: 2 });
    S.layer((l) => S.glow(l, 800, horizon, 300, "#ffc090", 0.38), { composite: "screen" });
    S.layer((l) => {
      l.save();
      l.beginPath();
      l.rect(0, 0, W, horizon);
      l.clip();
      l.fillStyle = "#ffe2b8";
      l.beginPath();
      l.arc(800, horizon + 6, 30, 0, Math.PI * 2);
      l.fill();
      l.restore();
    }, { blur: 1.5 });
    // Wave lines, wider and brighter nearer the shore; glitter under the sun.
    S.layer((l) => {
      for (let i = 0; i < 190; i++) {
        const t = i / 190;
        const y = horizon + 3 + Math.pow(t, 1.7) * 300;
        const segments = 4 + Math.floor(t * 6);
        for (let s = 0; s < segments; s++) {
          const x = r(-100, W);
          const length = r(40, 160) * (0.4 + t * 2);
          const near = Math.exp(-Math.pow((x + length / 2 - 800) / (60 + t * 260), 2));
          l.strokeStyle = near > 0.3 ? rgba("#ffc890", 0.2 + near * 0.3) : rgba("#8a8aaa", 0.07 + t * 0.1);
          l.lineWidth = 0.8 + t * 2.4;
          l.beginPath();
          l.moveTo(x, y);
          l.lineTo(x + length, y + r(-1, 1));
          l.stroke();
        }
      }
    }, { blur: 0.8 });
    // Shore: foam line, wet sand, dry sand.
    const shore = S.ridge(800, 18, 0.004, { octaves: 3 });
    S.layer((l) => {
      S.fillUnder(l, shore, "#2a2230");
      S.vgrad(l, [[0, "rgba(0,0,0,0)"], [0.4, "#1c1418"], [1, "#0c0808"]], 820, H);
    });
    S.layer((l) => {
      l.strokeStyle = rgba("#d8d0d8", 0.4);
      l.lineWidth = 3;
      l.beginPath();
      shore.forEach((y, i) => (i ? l.lineTo(i * 4, y) : l.moveTo(0, y)));
      l.stroke();
      l.strokeStyle = rgba("#b0a8c0", 0.25);
      l.lineWidth = 8;
      l.beginPath();
      shore.forEach((y, i) => (i ? l.lineTo(i * 4, y - 14) : l.moveTo(0, y - 14)));
      l.stroke();
    }, { blur: 2.5 });
    S.field((x, y, out) => {
      out[0] = 70;
      out[1] = 56;
      out[2] = 60;
      const ripple = Math.sin(y * 0.18 + noise.fbm(x * 0.004, y * 0.01, 3) * 8);
      out[3] = y > 840 ? (ripple * 0.5 + 0.5) * 0.18 * (1 - smooth(900, H, y)) : 0;
    }, { blur: 1 });
    S.paint(0.8);
    S.finish({ vignette: 0.5, maxLum: 0.58, lowerShade: 0.3 });
  },

  butterflys(S) {
    const { ctx, W, H, r } = S;
    S.vgrad(ctx, [[0, "#070c14"], [0.5, "#0e1c26"], [1, "#05080c"]]);
    S.layer((l) => {
      S.glow(l, 420, 380, 620, "#1a6a6a", 0.35);
      S.glow(l, 1200, 420, 560, "#4a2a7a", 0.35);
      S.glow(l, 820, 700, 500, "#2a4a3a", 0.3);
    }, { composite: "screen" });
    // Out-of-focus lights.
    S.layer((l) => {
      for (let i = 0; i < 70; i++) {
        l.fillStyle = rgba(S.pick(["#3ac0b0", "#d0a040", "#8a6ad0", "#60d080"]), r(0.05, 0.16));
        l.beginPath();
        l.arc(r(0, W), r(0, H), r(8, 60), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 7 });
    // Grass and fern silhouettes along the bottom.
    S.layer((l) => {
      l.strokeStyle = "#03070a";
      l.lineCap = "round";
      for (let i = 0; i < 320; i++) {
        const x = r(-40, W + 40);
        const height = r(60, 320) * (Math.abs(x - 800) > 450 ? 1.3 : 0.7);
        const bend = r(-80, 80);
        l.lineWidth = r(2, 6);
        l.beginPath();
        l.moveTo(x, H + 10);
        l.quadraticCurveTo(x + bend * 0.2, H - height * 0.6, x + bend, H - height);
        l.stroke();
      }
    }, { blur: 1.2 });
    S.paint(0.7);
    // Butterflies: wings shaded from body to edge, with a soft glow.
    const flock = Array.from({ length: 9 }, (_, i) => ({
      x: [330, 560, 820, 1080, 1290, 440, 960, 1180, 700][i] + r(-40, 40),
      y: [360, 250, 420, 300, 520, 600, 640, 200, 560][i] + r(-40, 40),
      size: r(0.35, 0.85) * (i === 2 ? 1.5 : 1),
      angle: r(-0.5, 0.5),
      open: r(0.45, 1),
      inner: S.pick(["#70e0e0", "#f0c060", "#b090ff", "#80c0ff"]),
      outer: S.pick(["#1a5a8a", "#8a3a1a", "#3a2a8a", "#1a6a5a"]),
      blur: i >= 5 ? 2.5 : 0,
    }));
    const drawFlock = (l, only) => {
      for (const b of flock) {
        if (only && only !== (b.blur > 0 ? "far" : "near")) continue;
        l.save();
        l.translate(b.x, b.y);
        l.rotate(b.angle);
        l.scale(b.size, b.size);
        for (const side of [-1, 1]) {
          l.save();
          l.scale(side * b.open, 1);
          const g = l.createRadialGradient(10, -10, 4, 30, -20, 110);
          g.addColorStop(0, rgba(b.inner, 0.95));
          g.addColorStop(0.55, rgba(b.outer, 0.9));
          g.addColorStop(1, rgba("#05060a", 0.95));
          l.fillStyle = g;
          l.beginPath();
          l.moveTo(0, -4);
          l.bezierCurveTo(28, -78, 98, -92, 104, -50);
          l.bezierCurveTo(108, -18, 60, 0, 0, 2);
          l.closePath();
          l.fill();
          l.beginPath();
          l.moveTo(0, 2);
          l.bezierCurveTo(58, 6, 84, 40, 62, 74);
          l.bezierCurveTo(42, 94, 10, 56, 0, 10);
          l.closePath();
          l.fill();
          l.fillStyle = rgba(b.inner, 0.6);
          l.beginPath();
          l.arc(72, -48, 7, 0, Math.PI * 2);
          l.fill();
          l.restore();
        }
        l.fillStyle = "#06070a";
        l.beginPath();
        l.ellipse(0, 12, 4.5, 30, 0, 0, Math.PI * 2);
        l.fill();
        l.strokeStyle = "#06070a";
        l.lineWidth = 1.6;
        l.beginPath();
        l.moveTo(-2, -16);
        l.quadraticCurveTo(-10, -40, -18, -46);
        l.moveTo(2, -16);
        l.quadraticCurveTo(10, -40, 18, -46);
        l.stroke();
        l.restore();
      }
    };
    S.layer((l) => drawFlock(l), { blur: 24, composite: "screen", alpha: 0.55 });
    S.layer((l) => drawFlock(l, "far"), { blur: 2.5, alpha: 0.85 });
    S.layer((l) => drawFlock(l, "near"), { blur: 0.5 });
    S.layer((l) => {
      for (let i = 0; i < 120; i++) {
        l.fillStyle = rgba(S.pick(["#c0f0e0", "#f0d890"]), r(0.3, 0.8));
        l.beginPath();
        l.arc(r(150, 1450), r(150, 750), r(0.8, 2), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 0.8 });
    S.finish({ vignette: 0.55 });
  },

  castle(S) {
    const { ctx, noise } = S;
    S.vgrad(ctx, [[0, "#0b0a1c"], [0.28, "#241c40"], [0.48, "#5a2c48"], [0.6, "#b0583a"], [0.66, "#d08a50"], [0.7, "#3a2030"], [1, "#0a0710"]]);
    S.field((x, y, out) => {
      const d = noise.fbm(x * 0.0011, y * 0.006, 5);
      const c = mix("#2a1e3e", "#e08a5a", smooth(250, 640, y));
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(0.0, 0.5, d) * 0.6 * (1 - smooth(560, 660, y));
    }, { blur: 2 });
    S.layer((l) => S.glow(l, 820, 650, 520, "#ff9a5a", 0.35), { composite: "screen" });
    S.layer((l) => S.fillUnder(l, S.ridge(655, 25, 0.004), "#3a2236"), { blur: 3 });
    S.mist(600, 720, "#8a4a58", 0.4);
    S.paint(0.9);
    // The castle on its hill.
    const ink = "#100912";
    const base = 640;
    S.layer((l) => {
      S.fillUnder(l, S.ridge(780, 10, 0.006, { shape: (x) => 150 * Math.exp(-Math.pow((x - 820) / 430, 2)) }), ink);
      const walls = [
        [600, 200, 120], [790, 130, 160], [910, 150, 170], [1040, 120, 110],
      ];
      for (const [x, w, h] of walls) {
        l.fillStyle = ink;
        l.fillRect(x, base - h, w, h + 60);
        for (let m = x; m < x + w - 8; m += 18) l.fillRect(m, base - h - 12, 10, 12);
      }
      const towers = [
        [580, 56, 230, "cone"], [700, 44, 190, "flat"], [790, 70, 330, "cone"], [880, 50, 260, "cone"],
        [1040, 58, 250, "cone"], [1150, 48, 180, "flat"],
      ];
      for (const [x, w, h, roof] of towers) {
        l.fillStyle = ink;
        l.fillRect(x, base - h, w, h + 60);
        if (roof === "cone") {
          l.beginPath();
          l.moveTo(x - 8, base - h);
          l.lineTo(x + w / 2, base - h - w * 1.5);
          l.lineTo(x + w + 8, base - h);
          l.fill();
        } else {
          for (let m = x - 4; m < x + w; m += 14) l.fillRect(m, base - h - 10, 8, 10);
        }
      }
      l.strokeStyle = ink;
      l.lineWidth = 2;
      l.beginPath();
      l.moveTo(825, base - 330 - 105);
      l.lineTo(825, base - 330 - 140);
      l.stroke();
      l.fillStyle = ink;
      l.beginPath();
      l.moveTo(825, base - 470);
      l.quadraticCurveTo(845, base - 468, 862, base - 462);
      l.lineTo(825, base - 452);
      l.fill();
    }, { blur: 0.7 });
    // Lit windows.
    const windows = [[600, 500], [818, 420], [820, 470], [900, 520], [1060, 470], [960, 560], [1080, 580], [640, 580]];
    const drawWindows = (l) => {
      l.fillStyle = "#ffb860";
      for (const [x, y] of windows) {
        l.beginPath();
        l.moveTo(x, y + 14);
        l.lineTo(x, y + 4);
        l.arc(x + 4, y + 4, 4, Math.PI, 0);
        l.lineTo(x + 8, y + 14);
        l.fill();
      }
    };
    S.layer(drawWindows, { blur: 10, composite: "screen", alpha: 0.9 });
    S.layer(drawWindows, { blur: 0.5, alpha: 0.9 });
    S.mist(700, 860, "#6a4058", 0.35);
    S.layer((l) => S.fillUnder(l, S.ridge(900, 25, 0.003), "#050307"), { blur: 2 });
    S.finish({ vignette: 0.5, lowerShade: 0.25 });
  },

  cathedral(S) {
    const { ctx, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#0b0910"], [0.5, "#16121c"], [1, "#08070a"]]);
    // Stone wall: faint blocks.
    S.field((x, y, out) => {
      const row = Math.floor(y / 46);
      const block = Math.floor((x + (row % 2) * 40) / 80);
      const n = noise.fbm(block * 3.1 + row * 7.7, row * 1.3, 2);
      const v = 22 + n * 8 + noise.fbm(x * 0.01, y * 0.01, 3) * 5;
      out[0] = v;
      out[1] = v * 0.92;
      out[2] = v * 1.08;
      out[3] = 0.6;
    }, { scale: 2, blur: 0.8 });
    // Stained glass: diamond panes whose colours drift in patches (mostly
    // blue, with red, gold and green), three lancets and a rose at the top.
    const palette = [[0, "#1c3a8a"], [0.3, "#2a50b0"], [0.45, "#6a2a8a"], [0.58, "#a02234"], [0.7, "#c8902a"], [0.82, "#2a7a5a"], [1, "#3a64c0"]];
    const glass = (l, cx, top, width, bottom, brightness) => {
      l.save();
      gothicArch(l, cx, top, width, bottom);
      l.clip();
      const size = width / 9;
      for (let i = -14; i < 40; i++) {
        for (let j = -14; j < 40; j++) {
          const px = cx - width / 2 + (i - j) * (size / 2);
          const py = top + (i + j) * (size * 0.65);
          if (px < cx - width / 2 - size || px > cx + width / 2 + size || py < top - size || py > bottom + size) continue;
          const tone = clamp(noise.fbm(px * 0.012, py * 0.008, 2) * 0.9 + 0.5);
          const lift = 0.55 + 0.45 * (1 - (py - top) / (bottom - top));
          l.fillStyle = rgba(ramp(palette, tone), (0.55 + r(0, 0.35)) * brightness * lift);
          l.beginPath();
          l.moveTo(px, py - size * 0.65);
          l.lineTo(px + size / 2, py);
          l.lineTo(px, py + size * 0.65);
          l.lineTo(px - size / 2, py);
          l.closePath();
          l.fill();
          l.strokeStyle = "#0a080c";
          l.lineWidth = 1.6;
          l.stroke();
        }
      }
      l.strokeStyle = "#0a080c";
      l.lineWidth = Math.max(4, width * 0.025);
      for (let k = 1; k < 3; k++) {
        const x = cx - width / 2 + (width * k) / 3;
        l.beginPath();
        l.moveTo(x, top + width * 0.66);
        l.lineTo(x, bottom);
        l.stroke();
      }
      const rose = [cx, top + width * 0.42, width * 0.2];
      l.fillStyle = "#0a080c";
      l.beginPath();
      l.arc(rose[0], rose[1], rose[2] + 4, 0, Math.PI * 2);
      l.fill();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        l.fillStyle = rgba(k % 2 ? "#c8902a" : "#a02234", 0.85 * brightness);
        l.beginPath();
        l.arc(rose[0] + Math.cos(a) * rose[2] * 0.6, rose[1] + Math.sin(a) * rose[2] * 0.6, rose[2] * 0.3, 0, Math.PI * 2);
        l.fill();
      }
      l.fillStyle = rgba("#3a64c0", 0.9 * brightness);
      l.beginPath();
      l.arc(rose[0], rose[1], rose[2] * 0.28, 0, Math.PI * 2);
      l.fill();
      l.restore();
      l.strokeStyle = "#0a080c";
      l.lineWidth = 14;
      gothicArch(l, cx, top, width, bottom);
      l.stroke();
    };
    const windows = (l) => {
      glass(l, 800, 110, 300, 650, 1);
      glass(l, 360, 250, 150, 640, 0.6);
      glass(l, 1240, 250, 150, 640, 0.6);
    };
    S.layer(windows, { blur: 40, composite: "screen", alpha: 0.8 });
    S.layer(windows, { blur: 0.6, alpha: 0.9 });
    // Light shafts from the great window to the floor.
    S.layer((l) => {
      const shaft = (x0, x1, x2, x3, alpha) => {
        const g = l.createLinearGradient(0, 330, 0, H);
        g.addColorStop(0, rgba("#e8d8b0", alpha));
        g.addColorStop(1, rgba("#e8d8b0", alpha * 0.15));
        l.fillStyle = g;
        l.beginPath();
        l.moveTo(x0, 330);
        l.lineTo(x1, 330);
        l.lineTo(x2, H);
        l.lineTo(x3, H);
        l.closePath();
        l.fill();
      };
      shaft(680, 920, 700, 300, 0.22);
      shaft(730, 780, 540, 450, 0.16);
      shaft(840, 880, 690, 630, 0.14);
    }, { blur: 16, composite: "screen" });
    S.layer((l) => {
      l.fillStyle = rgba("#e8d8b0", 0.12);
      l.beginPath();
      l.ellipse(500, 980, 260, 40, 0, 0, Math.PI * 2);
      l.fill();
    }, { blur: 20, composite: "screen" });
    // Pillars.
    S.layer((l) => {
      for (const [x, w] of [[520, 90], [990, 90], [40, 120], [1440, 120]]) {
        const g = l.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, "#050407");
        g.addColorStop(0.35, "#1c1820");
        g.addColorStop(1, "#050407");
        l.fillStyle = g;
        l.fillRect(x, 0, w, H);
      }
    }, { blur: 1 });
    S.layer((l) => S.vgrad(l, [[0, "rgba(0,0,0,0)"], [1, "rgba(5,4,7,0.8)"]], 760, H));
    S.paint(0.5);
    S.layer((l) => {
      for (let i = 0; i < 220; i++) {
        const t = r(0, 1);
        const y = 340 + t * 640;
        const x = lerp(800, 500, t) + r(-120, 120) * (0.4 + t);
        l.fillStyle = rgba("#fff0d0", r(0.2, 0.6));
        l.beginPath();
        l.arc(x, y, r(0.6, 1.6), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 0.6 });
    S.finish({ vignette: 0.45 });
  },
  dragon(S) {
    const { ctx, W, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#0a0404"], [0.35, "#260a07"], [0.6, "#6a1e0c"], [0.72, "#b04816"], [0.8, "#3a1008"], [1, "#0a0302"]]);
    S.field((x, y, out) => {
      const q = noise.fbm(x * 0.0015, y * 0.0022, 4);
      const d = noise.fbm(x * 0.0012 + q * 1.5, y * 0.003 + q, 5);
      const lit = smooth(300, 760, y);
      const c = mix("#140605", "#c04a18", lit * smooth(0, 0.5, -d + 0.3) * 0.6);
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(-0.1, 0.45, d) * 0.75;
    }, { blur: 3 });
    S.layer((l) => S.glow(l, 800, 760, 700, "#ff6a20", 0.35), { composite: "screen" });
    S.layer((l) => S.fillUnder(l, S.ridge(730, 70, 0.0035, { sharp: true }), "#1c0805"), { blur: 2 });
    S.layer((l) => S.fillUnder(l, S.ridge(850, 50, 0.003), "#070202"), { blur: 1.5 });
    S.paint(0.9);
    // The dragon: a tapering body along a curve, head and horns, two bat
    // wings with long fingers, rim-lit from the fire below.
    const body = (l) => {
      const spine = [[500, 318], [545, 322], [590, 334], [640, 352], [700, 372], [770, 386], [840, 392], [905, 396], [970, 406], [1040, 424], [1110, 440], [1180, 446], [1250, 436], [1310, 414], [1360, 388], [1398, 364]];
      const widths = [13, 14, 16, 22, 33, 38, 36, 29, 21, 15, 11, 8, 6, 4, 2.5, 1];
      const left = [];
      const right = [];
      for (let i = 0; i < spine.length; i++) {
        const [x0, y0] = spine[Math.max(0, i - 1)];
        const [x1, y1] = spine[Math.min(spine.length - 1, i + 1)];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const nx = -(y1 - y0) / len;
        const ny = (x1 - x0) / len;
        left.push([spine[i][0] + nx * widths[i], spine[i][1] + ny * widths[i]]);
        right.push([spine[i][0] - nx * widths[i], spine[i][1] - ny * widths[i]]);
      }
      l.beginPath();
      l.moveTo(left[0][0], left[0][1]);
      for (const [x, y] of left) l.lineTo(x, y);
      for (const [x, y] of right.reverse()) l.lineTo(x, y);
      l.closePath();
      l.fill();
      // Spines along the back.
      for (let i = 2; i < spine.length - 3; i++) {
        const [x, y] = right[spine.length - 1 - i];
        l.beginPath();
        l.moveTo(x - 7, y + 2);
        l.lineTo(x + 4, y - 12 - widths[i] * 0.2);
        l.lineTo(x + 9, y + 2);
        l.fill();
      }
      // Tail tip.
      l.beginPath();
      l.moveTo(1392, 368);
      l.lineTo(1414, 336);
      l.lineTo(1432, 356);
      l.lineTo(1410, 372);
      l.closePath();
      l.fill();
      // Head, jaw and horns.
      l.beginPath();
      l.moveTo(514, 306);
      l.lineTo(470, 300);
      l.lineTo(430, 310);
      l.lineTo(394, 326);
      l.lineTo(428, 333);
      l.lineTo(406, 344);
      l.lineTo(452, 346);
      l.lineTo(504, 338);
      l.closePath();
      l.fill();
      l.beginPath();
      l.moveTo(494, 306);
      l.quadraticCurveTo(522, 282, 562, 270);
      l.quadraticCurveTo(530, 292, 508, 314);
      l.fill();
      l.beginPath();
      l.moveTo(478, 306);
      l.quadraticCurveTo(498, 278, 532, 258);
      l.quadraticCurveTo(508, 286, 494, 312);
      l.fill();
      // Legs tucked under the body, with claws.
      const leg = (points) => {
        l.beginPath();
        l.moveTo(...points[0]);
        for (const p of points.slice(1)) l.lineTo(...p);
        l.closePath();
        l.fill();
      };
      leg([[870, 410], [888, 470], [918, 502], [934, 498], [912, 466], [930, 414]]);
      leg([[930, 498], [952, 506], [928, 506]]);
      leg([[716, 384], [700, 436], [722, 458], [736, 452], [722, 432], [746, 392]]);
      // Wings: arm to the wrist, fingers to the tips, membrane scalloped deep between them.
      const wing = (shoulder, elbow, wrist, tips, root) => {
        l.beginPath();
        l.moveTo(...shoulder);
        l.lineTo(...elbow);
        l.lineTo(...wrist);
        l.lineTo(...tips[0]);
        let previous = tips[0];
        for (const tip of [...tips.slice(1), root]) {
          const mx = (previous[0] + tip[0]) / 2;
          const my = (previous[1] + tip[1]) / 2;
          l.quadraticCurveTo(lerp(mx, wrist[0], 0.28), lerp(my, wrist[1], 0.28), tip[0], tip[1]);
          previous = tip;
        }
        l.closePath();
        l.fill();
        l.lineCap = "round";
        l.lineWidth = 5;
        for (const tip of tips) {
          l.beginPath();
          l.moveTo(...wrist);
          l.lineTo(...tip);
          l.stroke();
        }
        l.lineWidth = 11;
        l.beginPath();
        l.moveTo(...shoulder);
        l.lineTo(...elbow);
        l.lineTo(...wrist);
        l.stroke();
        l.beginPath();
        l.moveTo(wrist[0] - 4, wrist[1] + 4);
        l.lineTo(wrist[0] - 2, wrist[1] - 22);
        l.lineTo(wrist[0] + 8, wrist[1] + 2);
        l.fill();
      };
      wing([730, 362], [610, 215], [520, 80], [[220, 70], [250, 210], [350, 310], [500, 362]], [690, 388]);
      wing([800, 372], [960, 200], [1090, 70], [[1390, 60], [1370, 180], [1260, 282], [1080, 352]], [872, 398]);
    };
    const place = (l) => {
      l.translate(800, 400);
      l.scale(0.86, 0.86);
      l.translate(-800, -330);
    };
    S.layer((l) => {
      l.fillStyle = "#ff7a30";
      l.strokeStyle = "#ff7a30";
      place(l);
      l.translate(0, 8);
      body(l);
    }, { blur: 8, composite: "screen", alpha: 0.55 });
    S.layer((l) => {
      l.fillStyle = "#070202";
      l.strokeStyle = "#070202";
      place(l);
      body(l);
    }, { blur: 0.8 });
    const embers = Array.from({ length: 240 }, () => [r(0, W), H - Math.pow(r(0, 1), 1.6) * H * 0.95, r(0.8, 2.6), r(0.4, 1)]);
    const drawEmbers = (l) => {
      for (const [x, y, size, a] of embers) {
        l.fillStyle = rgba(y > 600 ? "#ffb050" : "#ff7a30", a);
        l.beginPath();
        l.ellipse(x, y, size, size * 2.2, 0.3, 0, Math.PI * 2);
        l.fill();
      }
    };
    S.layer(drawEmbers, { blur: 6, composite: "screen" });
    S.layer(drawEmbers, { blur: 0.5, alpha: 0.9 });
    S.finish({ vignette: 0.5 });
  },
  haunted(S) {
    const { ctx, r, noise } = S;
    S.vgrad(ctx, [[0, "#06090c"], [0.4, "#121c20"], [0.66, "#26342f"], [0.72, "#2c3a35"], [1, "#080b0b"]]);
    S.layer((l) => S.glow(l, 1060, 240, 460, "#a8c0b0", 0.4), { composite: "screen" });
    S.layer((l) => {
      l.fillStyle = "#d4dccb";
      l.beginPath();
      l.arc(1060, 240, 86, 0, Math.PI * 2);
      l.fill();
    }, { blur: 1.5 });
    S.field((x, y, out) => {
      const dx = (x - 1060) / 86;
      const dy = (y - 240) / 86;
      out[0] = 120;
      out[1] = 130;
      out[2] = 115;
      out[3] = dx * dx + dy * dy < 1 ? smooth(0.1, 0.5, noise.fbm(x * 0.02, y * 0.02, 3)) * 0.35 : 0;
    }, { scale: 2, blur: 2 });
    S.field((x, y, out) => {
      const d = noise.fbm(x * 0.0014, y * 0.005, 5);
      const near = Math.exp(-Math.hypot(x - 1060, (y - 240) * 2) / 400);
      const c = mix("#0c1214", "#6a7a72", near);
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(0.0, 0.45, d) * 0.8 * (1 - smooth(500, 640, y));
    }, { blur: 2 });
    S.paint(0.7);
    const ink = "#060908";
    S.layer((l) => {
      S.fillUnder(l, S.ridge(740, 10, 0.004, { shape: (x) => 190 * Math.exp(-Math.pow((x - 1000) / 360, 2)) }), ink);
      // The house: main block, steep gables, a tower and chimneys.
      l.fillStyle = ink;
      l.fillRect(920, 420, 220, 160);
      for (const [x, w, h] of [[910, 110, 110], [1030, 120, 140]]) {
        l.beginPath();
        l.moveTo(x, 425);
        l.lineTo(x + w / 2, 425 - h);
        l.lineTo(x + w, 425);
        l.fill();
      }
      l.fillRect(870, 330, 56, 250);
      l.beginPath();
      l.moveTo(860, 334);
      l.lineTo(898, 200);
      l.lineTo(936, 334);
      l.fill();
      l.fillRect(1070, 300, 16, 70);
      l.fillRect(1110, 330, 14, 60);
      l.fillRect(1140, 470, 80, 110);
      l.beginPath();
      l.moveTo(1136, 474);
      l.lineTo(1190, 430);
      l.lineTo(1226, 474);
      l.fill();
      // Fence posts down the hill.
      l.strokeStyle = ink;
      l.lineWidth = 3;
      for (let x = 620; x < 900; x += 22) {
        const y = 740 - 190 * Math.exp(-Math.pow((x - 1000) / 360, 2));
        l.beginPath();
        l.moveTo(x, y + 4);
        l.lineTo(x + r(-3, 3), y - r(18, 30));
        l.stroke();
      }
    }, { blur: 0.7 });
    const lit = (l) => {
      l.fillStyle = "#c8d27a";
      l.fillRect(892, 380, 10, 16);
      l.fillRect(1060, 470, 12, 18);
    };
    S.layer(lit, { blur: 8, composite: "screen" });
    S.layer(lit, { blur: 0.5, alpha: 0.8 });
    // A dead tree in front, and bats near the moon.
    S.layer((l) => {
      S.fillUnder(l, S.ridge(860, 25, 0.003), "#030505");
      branch(S, l, 300, 870, -Math.PI / 2 + 0.1, 150, 26, 7, { color: "#030505", twist: 0.6 });
      l.fillStyle = "#050707";
      for (let i = 0; i < 5; i++) {
        const x = 980 + r(-200, 220);
        const y = 200 + r(-100, 140);
        const s = r(5, 10);
        l.beginPath();
        l.moveTo(x, y);
        l.quadraticCurveTo(x - s, y - s * 0.8, x - s * 2, y - s * 0.2);
        l.quadraticCurveTo(x - s * 1.2, y, x, y + s * 0.3);
        l.quadraticCurveTo(x + s * 1.2, y, x + s * 2, y - s * 0.2);
        l.quadraticCurveTo(x + s, y - s * 0.8, x, y);
        l.fill();
      }
    }, { blur: 0.8 });
    S.mist(620, 820, "#5a7068", 0.45);
    S.mist(840, 1000, "#4a5a56", 0.3);
    S.finish({ vignette: 0.55 });
  },

  lines(S) {
    const { ctx, W, r, noise } = S;
    S.vgrad(ctx, [[0, "#06091a"], [0.5, "#0a1024"], [1, "#05070f"]]);
    S.layer((l) => {
      S.glow(l, 450, 380, 600, "#123a50", 0.5);
      S.glow(l, 1180, 640, 600, "#3a2440", 0.5);
    }, { composite: "screen" });
    const palette = [[0, "#2ab8c0"], [0.35, "#3a68d0"], [0.65, "#9050c0"], [1, "#e0a040"]];
    const flow = (l, count, offset, alpha, width, spread) => {
      for (let k = 0; k < count; k++) {
        const t = k / count;
        let x = -60;
        let y = 500 + (t - 0.5) * spread + r(-4, 4);
        l.strokeStyle = rgba(ramp(palette, t), alpha);
        l.lineWidth = width;
        l.beginPath();
        l.moveTo(x, y);
        while (x < W + 60) {
          const angle = noise.fbm(x * 0.0011 + offset, y * 0.0011, 3) * 1.25;
          x += Math.cos(angle) * 6;
          y += Math.sin(angle) * 6;
          l.lineTo(x, y);
        }
        l.stroke();
      }
    };
    S.layer((l) => flow(l, 70, 30, 0.12, 6, 900), { blur: 10, composite: "screen" });
    S.layer((l) => flow(l, 180, 0, 0.22, 1.2, 760), { composite: "screen" });
    S.layer((l) => flow(l, 180, 0, 0.3, 4, 760), { blur: 8, composite: "screen", alpha: 0.6 });
    S.layer((l) => {
      for (let i = 0; i < 40; i++) {
        l.fillStyle = rgba("#ffe0a0", r(0.3, 0.7));
        l.beginPath();
        l.arc(r(0, W), r(200, 800), r(0.8, 1.8), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 0.6 });
    S.finish({ vignette: 0.5, grain: 1.6 });
  },

  mountain(S) {
    const { ctx, W, r } = S;
    S.vgrad(ctx, [[0, "#080e1c"], [0.3, "#18233e"], [0.5, "#3e4262"], [0.6, "#8a6476"], [0.7, "#6a5a70"], [1, "#0a0c14"]]);
    S.layer((l) => {
      for (let i = 0; i < 260; i++) {
        l.fillStyle = rgba("#dfe6ff", r(0.1, 0.6) * Math.pow(r(0, 1), 2));
        l.fillRect(r(0, W), Math.pow(r(0, 1), 1.5) * 380, 1.4, 1.4);
      }
    });
    S.layer((l) => S.glow(l, 820, 600, 600, "#c08080", 0.25), { composite: "screen" });
    const layers = [
      [480, 170, 0.0021, "#58587a", 0.28],
      [590, 110, 0.0026, "#3a3c5a", 0.3],
      [690, 80, 0.003, "#25283e", 0.3],
      [790, 60, 0.0035, "#151826", 0.28],
      [905, 40, 0.004, "#07080e", 0],
    ];
    layers.forEach(([base, amplitude, frequency, color, haze], i) => {
      const ys = S.ridge(base, amplitude, frequency, {
        sharp: i < 3,
        shape: i === 0 ? (x) => 150 * Math.exp(-Math.pow((x - 800) / 240, 2)) : undefined,
      });
      S.layer((l) => {
        S.fillUnder(l, ys, color);
        if (i === 0) {
          // Snow on the far summits.
          l.save();
          l.globalCompositeOperation = "source-atop";
          const top = Math.min(...ys);
          const g = l.createLinearGradient(0, top, 0, top + 170);
          g.addColorStop(0, rgba("#d0d4e8", 0.6));
          g.addColorStop(1, rgba("#d0d4e8", 0));
          l.fillStyle = g;
          l.fillRect(0, top, W, 170);
          l.restore();
        }
      }, { blur: i < 2 ? 1.2 : 0.8 });
      if (haze > 0) S.mist(base - 60, base + 120, "#6a6888", haze * 1.4, { stretch: 6 });
    });
    S.paint(1);
    S.finish({ vignette: 0.5 });
  },

  sand(S) {
    const { ctx, W, H, r, noise } = S;
    const horizon = 480;
    S.vgrad(ctx, [[0, "#120c1c"], [0.22, "#34203a"], [0.42, "#7a4240"], [0.48, "#b0704e"], [0.6, "#3a2228"], [1, "#100808"]]);
    S.field((x, y, out) => {
      const d = noise.fbm(x * 0.001, y * 0.008, 4);
      out[0] = 220;
      out[1] = 140;
      out[2] = 120;
      out[3] = smooth(0.15, 0.6, d) * 0.3 * (1 - smooth(horizon - 80, horizon, y));
    }, { blur: 2 });
    S.layer((l) => S.glow(l, 1120, horizon - 10, 620, "#ffb070", 0.4), { composite: "screen" });
    S.layer((l) => {
      l.fillStyle = rgba("#ffd8a0", 0.8);
      l.beginPath();
      l.arc(1120, horizon - 4, 26, 0, Math.PI * 2);
      l.fill();
    }, { blur: 2 });
    // Dunes, far to near. Each crest rises gently and drops steeply (the
    // lee face); slopes facing the low sun are lit, the lee faces fall into
    // shade, and the shading fades with depth below the crest.
    const dunes = [
      [494, 22, 0.0035, "#b07a5e", "#5e3644"],
      [565, 55, 0.0022, "#9a6448", "#46283a"],
      [670, 95, 0.0016, "#7e4a32", "#2e1a28"],
      [810, 140, 0.0011, "#5a3422", "#1e1018"],
      [985, 130, 0.0009, "#38200f", "#10070c"],
    ];
    dunes.forEach(([base, amplitude, frequency, litColor, shadeColor], i) => {
      const offset = r(0, 10);
      const crest = [];
      for (let x = 0; x <= W + 2; x += 2) {
        const u = x * frequency + offset + noise.fbm(x * frequency * 0.5, offset, 3) * 0.5;
        const t = u - Math.floor(u);
        const h = t < 0.72 ? smooth(0, 0.72, t) : Math.pow(1 - (t - 0.72) / 0.28, 2);
        crest.push(base - amplitude * (0.15 + 0.85 * h));
      }
      const slope = crest.map((y, k) => (crest[Math.min(crest.length - 1, k + 1)] - crest[Math.max(0, k - 1)]) / 4);
      S.field((x, y, out) => {
        const k = Math.min(crest.length - 1, Math.round(x / 2));
        if (y < crest[k]) {
          out[3] = 0;
          return;
        }
        const below = (y - crest[k]) / (amplitude * 0.9 + 30);
        const facing = clamp(0.55 - slope[k] * 1.4);
        const shade = (facing - 0.55) * Math.exp(-below * 1.4);
        const ripple = i >= 2 ? Math.sin((y - crest[k]) * (0.3 - i * 0.04) + noise.noise(x * 0.006, y * 0.01) * 2) * 0.05 : 0;
        const c = mix(shadeColor, litColor, clamp(0.45 + shade * 1.2 - below * 0.25 + ripple));
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
        out[3] = 1;
      }, { scale: 2, blur: 0.8 });
      if (i < 3) S.mist(base - 30, base + 50, "#b07a6a", 0.22, { stretch: 6 });
    });
    S.layer((l) => S.vgrad(l, [[0, "rgba(0,0,0,0)"], [1, "rgba(8,4,4,0.6)"]], 780, H));
    S.paint(0.8);
    S.finish({ vignette: 0.5 });
  },
  skulls(S) {
    const { ctx, W, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#0a0807"], [1, "#100c0a"]]);
    S.field((x, y, out) => {
      const v = 26 + noise.fbm(x * 0.006, y * 0.006, 4) * 10;
      out[0] = v;
      out[1] = v * 0.86;
      out[2] = v * 0.72;
      out[3] = 1;
    }, { scale: 4 });
    // An ossuary wall in candlelight: rows of skulls between rows of long
    // bones, uneven, mostly lost in the dark.
    const skull = (l, x, y, size, turn, light) => {
      l.save();
      l.translate(x, y);
      l.rotate(turn);
      l.scale(size / 50, size / 50);
      const g = l.createRadialGradient(-12, -22, 4, 0, -4, 60);
      g.addColorStop(0, rgba(mix("#6a5c48", "#a08c6c", light)));
      g.addColorStop(0.6, "#4a3e30");
      g.addColorStop(1, "#1a1510");
      l.fillStyle = g;
      l.beginPath();
      l.ellipse(0, -8, 42, 40, 0, 0, Math.PI * 2);
      l.fill();
      l.beginPath();
      l.moveTo(-34, 4);
      l.quadraticCurveTo(-36, 30, -22, 40);
      l.quadraticCurveTo(-14, 56, 0, 56);
      l.quadraticCurveTo(14, 56, 22, 40);
      l.quadraticCurveTo(36, 30, 34, 4);
      l.closePath();
      l.fill();
      l.fillStyle = "rgba(8,6,5,0.9)";
      for (const side of [-1, 1]) {
        l.beginPath();
        l.moveTo(side * 6, 2);
        l.quadraticCurveTo(side * 6, -10, side * 18, -9);
        l.quadraticCurveTo(side * 30, -8, side * 28, 6);
        l.quadraticCurveTo(side * 24, 20, side * 14, 18);
        l.quadraticCurveTo(side * 6, 16, side * 6, 2);
        l.fill();
      }
      l.beginPath();
      l.moveTo(0, 20);
      l.lineTo(-5, 33);
      l.quadraticCurveTo(0, 36, 5, 33);
      l.closePath();
      l.fill();
      l.fillStyle = "rgba(8,6,5,0.55)";
      for (let t = -12; t <= 12; t += 6) l.fillRect(t - 1.4, 42, 2.8, 9);
      l.restore();
    };
    const bone = (l, x, y, length, turn) => {
      l.save();
      l.translate(x, y);
      l.rotate(turn);
      const g = l.createLinearGradient(0, -9, 0, 9);
      g.addColorStop(0, "#6a5c48");
      g.addColorStop(1, "#241c14");
      l.fillStyle = g;
      l.fillRect(0, -5, length, 10);
      for (const end of [0, length]) {
        l.beginPath();
        l.arc(end, -5, 7, 0, Math.PI * 2);
        l.arc(end, 5, 7, 0, Math.PI * 2);
        l.fill();
      }
      l.restore();
    };
    S.layer((l) => {
      for (let row = 0; row < 7; row++) {
        const y = 100 + row * 134 + r(-8, 8);
        for (let x = -60; x < W + 60; x += r(70, 120)) bone(l, x, y - 54 + r(-4, 4), r(110, 160), r(-0.05, 0.05));
        for (let x = -40 + r(0, 50); x < W + 60; x += r(92, 124)) {
          if (r(0, 1) < 0.08) continue;
          skull(l, x, y + r(-8, 8), r(34, 48), r(-0.25, 0.25), r(0, 1));
        }
      }
    }, { blur: 2, alpha: 0.7 });
    // Candlelight from below; everything else falls into darkness.
    S.layer((l) => {
      const g = l.createRadialGradient(780, 880, 40, 780, 740, 860);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.45, "rgba(0,0,0,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0.9)");
      l.fillStyle = g;
      l.fillRect(0, 0, W, H);
    });
    S.layer((l) => S.glow(l, 780, 930, 520, "#ff9a40", 0.3), { composite: "screen" });
    S.layer((l) => S.vgrad(l, [[0, "rgba(0,0,0,0)"], [1, "rgba(6,4,3,0.8)"]], 820, H));
    S.mist(500, 1000, "#3a2a1e", 0.35, { stretch: 3 });
    S.paint(0.7);
    S.finish({ vignette: 0.55 });
  },
  sky(S) {
    const { ctx, noise } = S;
    S.vgrad(ctx, [[0, "#0a1226"], [0.35, "#1c2850"], [0.58, "#4a3e64"], [0.72, "#7a5464"], [1, "#22202e"]]);
    const sun = [820, 540];
    S.layer((l) => S.glow(l, sun[0], sun[1], 560, "#ffc090", 0.45), { composite: "screen" });
    // Banks of cloud, soft and billowing, lit on the edges that face the sun.
    const density = (px, py) => {
      const q = noise.fbm(px * 0.0012, py * 0.0018, 3) * 0.6;
      return (
        noise.fbm(px * 0.0016 + q, py * 0.0034, 6, 2, 0.5) +
        0.3 * Math.exp(-Math.pow((py - 280) / 140, 2)) +
        0.42 * Math.exp(-Math.pow((py - 820) / 180, 2)) -
        0.2
      );
    };
    S.field((x, y, out) => {
      const d = density(x, y);
      const dx = sun[0] - x;
      const dy = sun[1] - y;
      const len = Math.hypot(dx, dy) || 1;
      const towards = density(x + (dx / len) * 30, y + (dy / len) * 30);
      const rim = clamp((d - towards) * 5);
      const near = Math.exp(-len / 520);
      const body = mix("#1a1a34", "#3a3252", smooth(200, 900, y) * 0.6 + near * 0.4);
      const c = mix(body, "#e8a888", clamp(rim * (0.3 + near * 0.9) + near * 0.2));
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(-0.06, 0.3, d) * 0.95;
    }, { scale: 2, blur: 1.5 });
    S.layer((l) => S.vgrad(l, [[0, "rgba(0,0,0,0)"], [1, "rgba(8,8,16,0.7)"]], 720, 1000));
    S.paint(1);
    S.finish({ vignette: 0.5, maxLum: 0.62, lowerShade: 0.25 });
  },
  smoke(S) {
    const { ctx, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#040507"], [1, "#0a0b0e"]]);
    S.layer((l) => S.glow(l, 800, H + 60, 900, "#4a3020", 0.5), { composite: "screen" });
    // Wisps: many faint threads carried upward by a swirling (curl) field, as
    // smoke rising and spreading from embers below.
    const potential = (x, y) => noise.fbm(x * 0.0022, y * 0.0022, 3);
    const flow = (x, y) => {
      const e = 2;
      const ddx = (potential(x + e, y) - potential(x - e, y)) / (2 * e);
      const ddy = (potential(x, y + e) - potential(x, y - e)) / (2 * e);
      return [ddy * 1300, -ddx * 1300];
    };
    const trails = [];
    for (let i = 0; i < 900; i++) {
      let x = 800 + S.gauss() * 330;
      let y = H + r(0, 30);
      const points = [[x, y]];
      for (let step = 0; step < 320 && y > -40; step++) {
        const [vx, vy] = flow(x, y);
        const height = 1 - y / H;
        x += vx * (0.3 + height) + (x - 800) * 0.003;
        y += vy * 0.4 - 2.4;
        points.push([x, y]);
      }
      trails.push({ points, warm: r(0, 1) });
    }
    const draw = (l, alpha, width) => {
      for (const { points, warm } of trails) {
        const g = l.createLinearGradient(0, H, 0, 0);
        const c = mix("#8a96a6", "#c8a07a", warm);
        g.addColorStop(0, rgba(c, alpha * 0.4));
        g.addColorStop(0.35, rgba(c, alpha));
        g.addColorStop(1, rgba(c, alpha * 0.3));
        l.strokeStyle = g;
        l.lineWidth = width;
        l.beginPath();
        points.forEach(([x, y], k) => (k ? l.lineTo(x, y) : l.moveTo(x, y)));
        l.stroke();
      }
    };
    S.layer((l) => draw(l, 0.022, 12), { blur: 16, composite: "screen" });
    S.layer((l) => draw(l, 0.03, 1.3), { blur: 0.8, composite: "screen" });
    S.finish({ vignette: 0.45, maxLum: 0.6 });
  },
  sparks(S) {
    const { ctx, W, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#060303"], [0.65, "#140705"], [1, "#2e1006"]]);
    S.layer((l) => S.glow(l, 800, H + 80, 760, "#ff6a20", 0.5), { composite: "screen" });
    S.field((x, y, out) => {
      const d = noise.fbm(x * 0.002, y * 0.003 + 4, 4);
      out[0] = 60;
      out[1] = 36;
      out[2] = 28;
      out[3] = smooth(0.0, 0.5, d) * 0.35;
    }, { scale: 4, blur: 4 });
    // A bed of glowing coals along the bottom.
    S.field((x, y, out) => {
      const heat = smooth(0.0, 0.5, noise.fbm(x * 0.012, y * 0.02, 4)) * smooth(900, 1000, y);
      const c = ramp([[0, "#1a0604"], [0.5, "#a02a08"], [1, "#ff9030"]], heat);
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(880, 960, y);
    }, { scale: 2, blur: 1.5 });
    S.paint(0.5);
    // Sparks in flight: short glowing streaks, thickest and brightest at the head.
    const sparks = Array.from({ length: 260 }, () => {
      const y = H - Math.pow(r(0, 1), 1.4) * (H - 60);
      const x = 800 + S.gauss() * (300 + (H - y) * 0.6);
      const angle = -Math.PI / 2 + S.gauss() * 0.7 + noise.noise(x * 0.003, y * 0.003) * 0.4;
      const length = r(10, 70) * (0.5 + y / H);
      const bend = r(-0.25, 0.25);
      return { x, y, angle, length, bend, width: r(1, 2.6), bright: r(0.5, 1) };
    });
    const drawSparks = (l) => {
      l.lineCap = "round";
      for (const s of sparks) {
        const hx = s.x + Math.cos(s.angle) * s.length;
        const hy = s.y + Math.sin(s.angle) * s.length;
        const cx = s.x + Math.cos(s.angle + s.bend) * s.length * 0.5;
        const cy = s.y + Math.sin(s.angle + s.bend) * s.length * 0.5;
        const g = l.createLinearGradient(s.x, s.y, hx, hy);
        g.addColorStop(0, rgba("#ff3a10", 0));
        g.addColorStop(0.6, rgba("#ff8a30", 0.6 * s.bright));
        g.addColorStop(1, rgba("#fff0c0", s.bright));
        l.strokeStyle = g;
        l.lineWidth = s.width;
        l.beginPath();
        l.moveTo(s.x, s.y);
        l.quadraticCurveTo(cx, cy, hx, hy);
        l.stroke();
      }
    };
    S.layer(drawSparks, { blur: 5, composite: "screen" });
    S.layer(drawSparks, { blur: 0.3, composite: "screen" });
    S.layer((l) => {
      for (let i = 0; i < 50; i++) {
        l.fillStyle = rgba("#ff9a40", r(0.08, 0.25));
        l.beginPath();
        l.arc(r(0, W), r(150, H), r(6, 22), 0, Math.PI * 2);
        l.fill();
      }
    }, { blur: 8, composite: "screen" });
    S.finish({ vignette: 0.5, maxLum: 0.78 });
  },
  stars(S) {
    const { ctx, W, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#02030a"], [0.6, "#060a1a"], [1, "#0a0c18"]]);
    // The Milky Way: a diagonal band of glow cut by thin dark dust lanes.
    const band = (x, y) => {
      const dist = (0.4 * x + y - 820 + noise.fbm(x * 0.001, 2, 3) * 120) / 1.08;
      return Math.exp(-Math.pow(dist / 200, 2));
    };
    S.field((x, y, out) => {
      const b = band(x, y);
      const glow = b * (0.6 + 0.4 * noise.fbm(x * 0.003, y * 0.003, 5));
      const lanes = Math.pow(noise.ridged(x * 0.0035 + 9, y * 0.0035, 4), 4) * Math.exp(-Math.pow(((0.4 * x + y - 820) / 1.08) / 90, 2));
      const c = ramp([[0, "#2a2a6a"], [0.4, "#4a5a9a"], [0.7, "#a06a8a"], [1, "#e0b890"]], clamp(glow * 1.15));
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = clamp(glow * 0.85 - lanes * 0.9);
    }, { scale: 2, blur: 1.2 });
    S.layer((l) => {
      for (let i = 0; i < 4000; i++) {
        const x = r(0, W);
        const y = r(0, H);
        if (r(0, 1) > band(x, y)) continue;
        l.fillStyle = rgba("#e0e4ff", r(0.1, 0.35));
        l.fillRect(x, y, 1, 1);
      }
    }, { blur: 0.4 });
    S.paint(0.3);
    S.layer((l) => {
      let placed = 0;
      while (placed < 1200) {
        const x = r(0, W);
        const y = r(0, H);
        if (r(0, 1) > 0.3 + band(x, y) * 0.7) continue;
        placed++;
        const b = Math.pow(r(0, 1), 5);
        l.fillStyle = rgba(S.pick(["#ffffff", "#cfe0ff", "#ffe8c8"]), 0.25 + b * 0.75);
        const size = 0.7 + b * 1.8;
        l.fillRect(x, y, size, size);
      }
    });
    S.layer((l) => {
      for (let i = 0; i < 18; i++) {
        const x = r(60, W - 60);
        const y = r(40, 760);
        S.glow(l, x, y, r(8, 18), S.pick(["#ffffff", "#bcd4ff", "#ffe0b0"]), 0.8);
      }
    }, { composite: "screen" });
    S.layer((l) => S.fillUnder(l, S.ridge(910, 40, 0.003, { octaves: 4 }), "#020306"), { blur: 1.2 });
    S.finish({ vignette: 0.45, grain: 1.4 });
  },
  tavern(S) {
    const { W, H, r, noise } = S;
    const lights = [[560, 760, 520, 1], [1120, 300, 300, 0.6], [880, 250, 260, 0.5], [1320, 360, 260, 0.45]];
    const light = (x, y) => {
      let sum = 0;
      for (const [lx, ly, radius, strength] of lights) sum += strength * Math.exp(-Math.pow(Math.hypot(x - lx, y - ly) / radius, 2));
      return sum;
    };
    // Plank wall lit by the hearth and lanterns.
    S.field((x, y, out) => {
      const plank = Math.floor(x / 92);
      const seam = Math.min(x % 92, 92 - (x % 92)) < 2 ? 0.45 : 1;
      const grain = noise.fbm(x * 0.03, y * 0.0025 + plank * 7.1, 4);
      const v = (0.5 + 0.18 * grain + noise.fbm(plank * 3.3, 1.7, 2) * 0.1) * seam;
      const k = 0.18 + 0.9 * light(x, y);
      out[0] = 92 * v * k;
      out[1] = 52 * v * k;
      out[2] = 28 * v * k;
      out[3] = 1;
    }, { scale: 2 });
    // Hearth: a stone arch with fire inside.
    S.layer((l) => {
      // Rough stones around the opening, as wedge-shaped blocks.
      for (let ring = 0; ring < 2; ring++) {
        const inner = 165 + ring * 42;
        const outer = inner + 40;
        let a = Math.PI;
        while (a < Math.PI * 2 - 0.01) {
          const step = r(0.14, 0.24);
          const b = Math.min(a + step, Math.PI * 2);
          l.fillStyle = rgba(mix("#24180f", "#46301f", r(0, 1)));
          l.beginPath();
          l.ellipse(560, 830, inner, inner * 0.92, 0, a + 0.012, b - 0.012);
          l.ellipse(560, 830, outer, outer * 0.92, 0, b - 0.012, a + 0.012, true);
          l.closePath();
          l.fill();
          a = b;
        }
      }
      for (const side of [-1, 1]) {
        for (let y = 830; y < 905; y += 26) {
          l.fillStyle = rgba(mix("#24180f", "#46301f", r(0, 1)));
          l.fillRect(560 + side * 186 - (side < 0 ? 78 : 0), y + 1, 78, 24);
        }
      }
      l.fillStyle = "#0a0503";
      l.beginPath();
      l.ellipse(560, 830, 160, 150, 0, Math.PI, 0);
      l.lineTo(720, 900);
      l.lineTo(400, 900);
      l.fill();
    }, { blur: 1.5 });
    const flames = (l) => {
      for (let i = 0; i < 34; i++) {
        const x = 560 + S.gauss() * 60;
        const h = r(40, 140) * (1 - Math.abs(x - 560) / 260);
        const lean = r(-18, 18);
        l.fillStyle = rgba(S.pick(["#c83a10", "#ff7a20", "#ffb040", "#ffd890"]), r(0.35, 0.7));
        l.beginPath();
        l.moveTo(x - 16, 890);
        l.bezierCurveTo(x - 22, 890 - h * 0.4, x + lean - 6, 890 - h * 0.7, x + lean, 890 - h);
        l.bezierCurveTo(x + lean + 4, 890 - h * 0.6, x + 22, 890 - h * 0.4, x + 16, 890);
        l.fill();
      }
      l.fillStyle = "#1a0804";
      for (let i = 0; i < 4; i++) l.fillRect(470 + i * 40 + r(-6, 6), 880 + r(-4, 4), 60, 14);
    };
    S.layer(flames, { blur: 6 });
    S.layer((l) => S.glow(l, 560, 860, 120, "#ffd890", 0.6), { composite: "screen" });
    S.layer((l) => S.glow(l, 560, 820, 460, "#ff8a30", 0.55), { composite: "screen" });
    // Beams, posts and braces.
    S.layer((l) => {
      const wood = (x, y, w, h) => {
        const g = l.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, "#2a160c");
        g.addColorStop(1, "#0a0503");
        l.fillStyle = g;
        l.fillRect(x, y, w, h);
      };
      wood(0, 0, W, 70);
      wood(0, 190, W, 54);
      for (const x of [150, 1380]) {
        const g = l.createLinearGradient(x, 0, x + 80, 0);
        g.addColorStop(0, "#0a0503");
        g.addColorStop(0.5, "#2a170c");
        g.addColorStop(1, "#0a0503");
        l.fillStyle = g;
        l.fillRect(x, 0, 80, H);
      }
      l.fillStyle = "#140a05";
      for (const [x, dir] of [[230, 1], [1380, -1]]) {
        l.beginPath();
        l.moveTo(x, 360);
        l.lineTo(x, 300);
        l.lineTo(x + dir * 160, 244);
        l.lineTo(x + dir * 230, 244);
        l.closePath();
        l.fill();
      }
    }, { blur: 1.2 });
    // Lanterns on chains.
    const lantern = (l, x, y) => {
      l.strokeStyle = "#0c0604";
      l.lineWidth = 2;
      l.beginPath();
      l.moveTo(x, 244);
      l.lineTo(x, y - 22);
      l.stroke();
      l.fillStyle = "#0c0604";
      l.fillRect(x - 16, y - 24, 32, 6);
      l.fillRect(x - 13, y + 20, 26, 6);
      l.fillStyle = "#ffc070";
      l.fillRect(x - 11, y - 18, 22, 38);
      l.fillStyle = "#0c0604";
      l.fillRect(x - 1.5, y - 18, 3, 38);
    };
    S.layer((l) => {
      for (const [x, y] of [[880, 330], [1120, 380], [1320, 330]]) S.glow(l, x, y, 220, "#ffa040", 0.45);
    }, { composite: "screen" });
    S.layer((l) => {
      for (const [x, y] of [[880, 330], [1120, 380], [1320, 330]]) lantern(l, x, y);
    }, { blur: 0.8 });
    // Table, mugs, a candle and barrels in the foreground.
    S.layer((l) => {
      l.fillStyle = "#0c0603";
      l.fillRect(0, 905, W, 120);
      l.fillStyle = rgba("#a05a28", 0.5);
      l.fillRect(0, 903, W, 4);
      l.fillStyle = "#0a0503";
      for (const [x, w, h] of [[960, 52, 64], [1030, 46, 56], [300, 50, 60]]) {
        l.fillRect(x, 905 - h, w, h);
        l.lineWidth = 9;
        l.strokeStyle = "#0a0503";
        l.beginPath();
        l.arc(x + w + 4, 905 - h / 2, h * 0.24, -Math.PI / 2, Math.PI / 2);
        l.stroke();
      }
      for (const x of [1330, 1480]) {
        const g = l.createLinearGradient(x - 80, 0, x + 80, 0);
        g.addColorStop(0, "#3a200e");
        g.addColorStop(0.35, "#24140a");
        g.addColorStop(1, "#080402");
        l.fillStyle = g;
        l.beginPath();
        l.moveTo(x - 70, 720);
        l.quadraticCurveTo(x - 92, 812, x - 70, 905);
        l.lineTo(x + 70, 905);
        l.quadraticCurveTo(x + 92, 812, x + 70, 720);
        l.closePath();
        l.fill();
        l.strokeStyle = rgba("#6a3a1a", 0.6);
        l.lineWidth = 4;
        for (const y of [745, 880]) {
          l.beginPath();
          l.moveTo(x - 76, y);
          l.lineTo(x + 76, y);
          l.stroke();
        }
      }
      l.fillStyle = "#c8a070";
      l.fillRect(1180, 852, 12, 52);
    }, { blur: 0.8 });
    S.layer((l) => S.glow(l, 1186, 840, 160, "#ffb050", 0.6), { composite: "screen" });
    S.mist(60, 420, "#a0602a", 0.25, { stretch: 3 });
    S.paint(0.9);
    S.finish({ vignette: 0.55 });
  },

  texture(S) {
    const { W, H, noise } = S;
    // Aged leather: mottled tones, fine pores and a few creases.
    S.field((x, y, out) => {
      const m = noise.fbm(x * 0.0035, y * 0.0035, 5);
      const fine = noise.fbm(x * 0.045, y * 0.045, 2);
      const crease = Math.pow(noise.ridged(x * 0.004 + 3, y * 0.004, 3), 12);
      const v = 0.78 + 0.32 * m + 0.06 * fine - crease * 0.35;
      const c = mix("#3e2818", "#5a3a22", clamp(m * 0.8 + 0.5));
      out[0] = c[0] * v;
      out[1] = c[1] * v;
      out[2] = c[2] * v;
      out[3] = 1;
    }, { scale: 1 });
    S.layer((l) => {
      const g = l.createRadialGradient(W * 0.45, H * 0.4, 50, W * 0.5, H * 0.5, 900);
      g.addColorStop(0, "rgba(255,220,170,0.07)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      l.fillStyle = g;
      l.fillRect(0, 0, W, H);
    }, { composite: "screen" });
    S.finish({ vignette: 0.65, grain: 2.5 });
  },

  town(S) {
    const { ctx, W, r } = S;
    S.vgrad(ctx, [[0, "#0a0f1e"], [0.32, "#1a2244"], [0.5, "#463a5a"], [0.62, "#a05a48"], [0.7, "#5a3a44"], [1, "#0a080e"]]);
    S.layer((l) => S.glow(l, 820, 620, 640, "#e08a5a", 0.3), { composite: "screen" });
    S.layer((l) => {
      l.fillStyle = "#e8e0c8";
      l.beginPath();
      l.arc(1260, 170, 34, 0, Math.PI * 2);
      l.fill();
      l.globalCompositeOperation = "destination-out";
      l.beginPath();
      l.arc(1276, 160, 32, 0, Math.PI * 2);
      l.fill();
    }, { blur: 0.8 });
    S.layer((l) => S.glow(l, 1250, 175, 160, "#c8c0b0", 0.2), { composite: "screen" });
    // Rows of houses climbing a hill, further rows paler in the haze.
    const rows = [
      [610, 0.6, "#3a2c44"],
      [700, 0.78, "#251c30"],
      [820, 0.95, "#16101e"],
      [960, 1.15, "#08060c"],
    ];
    const lit = [];
    rows.forEach(([base, scale, color], rowIndex) => {
      S.layer((l) => {
        l.fillStyle = color;
        let x = r(-80, -20);
        while (x < W + 40) {
          const w = r(70, 170) * scale;
          const h = r(40, 150) * scale;
          const top = base - h + Math.sin(x * 0.004 + rowIndex) * 20 * scale;
          l.fillRect(x, top, w, 400);
          const roof = r(0, 1);
          const pitch = r(0.35, 0.8);
          l.beginPath();
          if (roof < 0.5) {
            l.moveTo(x - 5, top);
            l.lineTo(x + w / 2, top - w * pitch * 0.6);
            l.lineTo(x + w + 5, top);
          } else if (roof < 0.85) {
            l.moveTo(x - 5, top);
            l.lineTo(x + w * 0.25, top - w * 0.3);
            l.lineTo(x + w * 0.75, top - w * 0.3);
            l.lineTo(x + w + 5, top);
          } else {
            // A narrow stepped gable, as on old Flemish town houses.
            const steps = 4;
            l.moveTo(x, top);
            for (let k = 0; k < steps; k++) {
              const inset = (w / 2) * (k / steps);
              const y = top - (k + 1) * w * 0.12;
              l.lineTo(x + inset, y);
              l.lineTo(x + inset + w / (2 * steps), y);
            }
            for (let k = steps - 1; k >= 0; k--) {
              const inset = (w / 2) * (k / steps);
              const y = top - (k + 1) * w * 0.12;
              l.lineTo(x + w - inset - w / (2 * steps), y);
              l.lineTo(x + w - inset, y);
            }
            l.lineTo(x + w, top);
          }
          l.fill();
          if (r(0, 1) < 0.45) {
            l.fillRect(x + w * r(0.15, 0.7), top - w * 0.42, 10 * scale, w * 0.3);
          }
          if (rowIndex > 0) {
            for (let k = 0; k < 4; k++) {
              if (r(0, 1) < 0.3) lit.push([x + r(0.12, 0.8) * w, top + r(0.15, 0.7) * h, 7 * scale, 10 * scale]);
            }
          }
          x += w + r(-10, 14);
        }
        if (rowIndex === 1) {
          // The belfry and church spire.
          l.fillRect(760, 380, 64, 330);
          l.fillRect(752, 372, 80, 12);
          l.beginPath();
          l.moveTo(756, 372);
          l.lineTo(792, 230);
          l.lineTo(828, 372);
          l.fill();
        }
      }, { blur: rowIndex < 2 ? 1.2 : 0.7 });
      if (rowIndex < 3) S.mist(base - 40, base + 80, "#6a4a5a", 0.32);
    });
    S.paint(0.5);
    const windows = (l) => {
      l.fillStyle = "#ffb460";
      for (const [x, y, w, h] of lit) l.fillRect(x, y, w, h);
    };
    S.layer(windows, { blur: 8, composite: "screen", alpha: 0.8 });
    S.layer(windows, { blur: 0.4, alpha: 0.85 });
    S.finish({ vignette: 0.5 });
  },
  tree(S) {
    const { ctx, W, r } = S;
    S.vgrad(ctx, [[0, "#050a12"], [0.38, "#102136"], [0.6, "#284456"], [0.72, "#3e5a62"], [1, "#0a1014"]]);
    S.layer((l) => S.glow(l, 1010, 270, 480, "#9ac0c0", 0.4), { composite: "screen" });
    S.layer((l) => {
      l.fillStyle = "#dfe8e0";
      l.beginPath();
      l.arc(1010, 270, 64, 0, Math.PI * 2);
      l.fill();
    }, { blur: 1.5 });
    S.mist(420, 640, "#5a7a80", 0.3);
    S.paint(0.6);
    const ink = "#040809";
    const hill = S.ridge(770, 8, 0.004, { shape: (x) => 110 * Math.exp(-Math.pow((x - 800) / 520, 2)) });
    S.layer((l) => {
      S.fillUnder(l, hill, ink);
      // A broad old tree: trunk, branches, leaf clumps at the tips.
      const leaves = (x, y) => {
        for (let i = 0; i < 3; i++) {
          l.fillStyle = rgba(ink, r(0.5, 0.9));
          l.beginPath();
          l.arc(x + r(-20, 20), y + r(-16, 12), r(10, 26), 0, Math.PI * 2);
          l.fill();
        }
      };
      l.fillStyle = ink;
      l.beginPath();
      l.moveTo(760, 680);
      l.quadraticCurveTo(780, 560, 790, 470);
      l.lineTo(814, 470);
      l.quadraticCurveTo(820, 560, 846, 680);
      l.fill();
      for (const [angle, length] of [[-2.5, 120], [-2.0, 130], [-1.55, 120], [-1.1, 130], [-0.6, 120]]) {
        branch(S, l, 802, 480, angle, length, 20, 6, { color: ink, leaves, twist: 0.4 });
      }
      l.strokeStyle = ink;
      l.lineWidth = 1.5;
      for (let i = 0; i < 360; i++) {
        const x = r(0, W);
        const y = hill[Math.round(x / 4)] + 2;
        l.beginPath();
        l.moveTo(x, y);
        l.lineTo(x + r(-6, 6), y - r(6, 20));
        l.stroke();
      }
    }, { blur: 0.8 });
    S.mist(700, 900, "#3a5a60", 0.3);
    S.layer((l) => {
      for (let i = 0; i < 30; i++) S.glow(l, r(200, 1400), r(620, 900), r(5, 10), "#d8e880", 0.9);
    }, { composite: "screen" });
    S.finish({ vignette: 0.5 });
  },

  veins(S) {
    const { noise } = S;
    S.field((x, y, out) => {
      const px = x * 0.0016;
      const py = y * 0.0016;
      const qx = noise.fbm(px, py, 4);
      const qy = noise.fbm(px + 3.7, py + 8.1, 4);
      const wx = px + qx * 1.6;
      const wy = py + qy * 1.6;
      const cloud = noise.fbm(wx * 1.5, wy * 1.5, 5);
      const main = Math.abs(noise.fbm(wx * 1.2, wy * 1.2, 5));
      const fine = Math.abs(noise.fbm(wx * 4 + 7, wy * 4, 4));
      const vein = Math.exp(-Math.pow(main / 0.018, 2));
      const halo = Math.exp(-Math.pow(main / 0.08, 2));
      const thread = Math.exp(-Math.pow(fine / 0.012, 2));
      let c = mix("#08100e", "#1e2e28", clamp(cloud * 0.8 + 0.4));
      c = mix(c, "#4a5a3e", halo * 0.35);
      c = mix(c, "#6a8a7a", thread * 0.35);
      c = mix(c, "#d0a858", vein * 0.85);
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = 1;
    }, { scale: 1 });
    S.layer((l) => {
      const g = l.createLinearGradient(0, 0, 1600, 1000);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.45, "rgba(255,255,255,0.05)");
      g.addColorStop(0.55, "rgba(255,255,255,0)");
      l.fillStyle = g;
      l.fillRect(0, 0, 1600, 1000);
    }, { composite: "screen" });
    S.finish({ vignette: 0.5, grain: 1.4, lowerShade: 0.22 });
  },

  volcano(S) {
    const { ctx, W, H, r, noise } = S;
    S.vgrad(ctx, [[0, "#0a0505"], [0.3, "#220c09"], [0.55, "#4e180d"], [0.66, "#7a2a10"], [1, "#100504"]]);
    const crater = [800, 430];
    // Ash plume, lit orange from below.
    S.field((x, y, out) => {
      if (y > crater[1] + 20) {
        out[3] = 0;
        return;
      }
      const rise = crater[1] - y;
      const centre = crater[0] + rise * 0.55 + noise.noise(y * 0.004, 1.1) * 60;
      const width = 70 + rise * 0.9;
      const shape = Math.exp(-Math.pow((x - centre) / width, 2));
      const d = shape * (0.55 + 0.6 * noise.fbm(x * 0.004, y * 0.004 - 2, 5));
      const c = mix("#1a0e0c", "#d05a20", Math.exp(-rise / 110) * 0.8 + 0.05);
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = smooth(0.1, 0.6, d) * 0.95;
    }, { scale: 2, blur: 2 });
    S.layer((l) => S.glow(l, crater[0], crater[1], 360, "#ff6a20", 0.6), { composite: "screen" });
    const cone = [];
    for (let x = 0; x <= W + 4; x += 4) {
      const t = Math.abs(x - crater[0]);
      let y = t < 70 ? crater[1] + 12 - Math.pow(t / 70, 2) * 14 : crater[1] + Math.pow((t - 70) / 760, 1.5) * 620;
      y += noise.fbm(x * 0.01, 7, 3) * 10;
      cone.push(y);
    }
    S.layer((l) => {
      S.fillUnder(l, cone, "#120706");
      l.save();
      l.globalCompositeOperation = "source-atop";
      const g = l.createLinearGradient(0, crater[1], 0, H);
      g.addColorStop(0, "rgba(120,40,20,0.35)");
      g.addColorStop(0.3, "rgba(0,0,0,0)");
      l.fillStyle = g;
      l.fillRect(0, 0, W, H);
      l.restore();
    }, { blur: 1 });
    S.paint(0.7);
    // Lava running down the slopes.
    const flows = [-1, 1, -1, 1].map((side, i) => {
      const points = [];
      let x = crater[0] + side * r(10, 40);
      let y = crater[1] + 8;
      while (y < H) {
        points.push([x, y]);
        y += 8;
        x += side * (1.5 + i * 0.5) + noise.noise(y * 0.02, i * 9) * 6;
      }
      return points;
    });
    const drawFlows = (l, width) => {
      l.lineCap = "round";
      l.lineJoin = "round";
      flows.forEach((points, i) => {
        l.lineWidth = width * (1 - i * 0.15);
        l.beginPath();
        points.forEach(([x, y], k) => (k ? l.lineTo(x, y) : l.moveTo(x, y)));
        l.stroke();
      });
    };
    S.layer((l) => {
      l.strokeStyle = "#ff4a10";
      drawFlows(l, 22);
    }, { blur: 14, composite: "screen", alpha: 0.7 });
    S.layer((l) => {
      const g = l.createLinearGradient(0, crater[1], 0, H);
      g.addColorStop(0, "#ffd070");
      g.addColorStop(0.5, "#ff7a20");
      g.addColorStop(1, "#7a1a08");
      l.strokeStyle = g;
      drawFlows(l, 5);
    }, { blur: 1 });
    const bombs = (l) => {
      for (let i = 0; i < 70; i++) {
        const a = -Math.PI / 2 + S.gauss() * 0.8;
        const d = r(20, 260);
        l.fillStyle = rgba(S.pick(["#ffb040", "#ff6a20"]), r(0.5, 1));
        l.beginPath();
        l.arc(crater[0] + Math.cos(a) * d, crater[1] + Math.sin(a) * d * 0.9, r(1, 3), 0, Math.PI * 2);
        l.fill();
      }
    };
    S.layer(bombs, { blur: 4, composite: "screen" });
    S.layer(bombs, { blur: 0.5 });
    S.layer((l) => S.fillUnder(l, S.ridge(930, 30, 0.003), "#060202"), { blur: 1 });
    S.finish({ vignette: 0.5, maxLum: 0.76 });
  },

  war(S) {
    const { ctx, W, r, noise } = S;
    S.vgrad(ctx, [[0, "#100c0a"], [0.35, "#34261c"], [0.58, "#6e4a30"], [0.66, "#8a5e3c"], [1, "#0c0806"]]);
    S.layer((l) => S.glow(l, 1120, 380, 420, "#e08a50", 0.4), { composite: "screen" });
    S.layer((l) => {
      l.fillStyle = rgba("#e8a070", 0.7);
      l.beginPath();
      l.arc(1120, 380, 46, 0, Math.PI * 2);
      l.fill();
    }, { blur: 3 });
    // Smoke rising from the field.
    S.field((x, y, out) => {
      let d = 0;
      for (const cx of [260, 640, 1300]) {
        const rise = 660 - y;
        const width = 60 + Math.max(rise, 0) * 0.5;
        d += Math.exp(-Math.pow((x - cx - rise * 0.25) / width, 2)) * (rise > 0 ? 1 : 0);
      }
      d *= 0.5 + 0.7 * noise.fbm(x * 0.004, y * 0.004, 5);
      const haze = noise.fbm(x * 0.0012, y * 0.004, 4);
      out[0] = 30;
      out[1] = 24;
      out[2] = 20;
      out[3] = clamp(smooth(0.1, 0.7, d) * 0.85 + smooth(0.1, 0.6, haze) * 0.25);
    }, { scale: 2, blur: 2 });
    S.layer((l) => S.fillUnder(l, S.ridge(650, 20, 0.004), "#4a3428"), { blur: 2 });
    S.layer((l) => {
      for (const x of [180, 520, 980, 1420]) S.glow(l, x + r(-40, 40), 650, r(40, 80), "#ff7a30", 0.6);
    }, { composite: "screen" });
    S.paint(0.8);
    // Ranks of spears and banners, nearer ranks darker.
    const ranks = [
      [720, 0.6, "#3a2a22"],
      [810, 0.9, "#21170f"],
      [940, 1.4, "#0a0705"],
    ];
    ranks.forEach(([base, scale, color], i) => {
      S.layer((l) => {
        const ground = S.ridge(base, 8, 0.004, { octaves: 3 });
        S.fillUnder(l, ground, color);
        l.strokeStyle = color;
        l.fillStyle = color;
        // Soldiers shoulder to shoulder: helmet, body, now and then a round shield and a spear.
        for (let x = r(-10, 0); x < W + 10; x += r(12, 20) * scale) {
          const y = ground[Math.round(clamp(x, 0, W) / 4)] + r(-3, 3) * scale;
          const tall = r(42, 54) * scale;
          l.beginPath();
          l.arc(x, y - tall, 8 * scale, Math.PI, 0);
          l.lineTo(x + 9 * scale, y - tall + 4 * scale);
          l.lineTo(x - 9 * scale, y - tall + 4 * scale);
          l.fill();
          l.beginPath();
          l.moveTo(x - 7 * scale, y - tall + 6 * scale);
          l.lineTo(x + 7 * scale, y - tall + 6 * scale);
          l.lineTo(x + 11 * scale, y);
          l.lineTo(x - 11 * scale, y);
          l.fill();
          if (r(0, 1) < 0.3) {
            l.beginPath();
            l.arc(x + 6 * scale, y - tall * 0.45, 13 * scale, 0, Math.PI * 2);
            l.fill();
          }
          if (r(0, 1) < 0.55) {
            const lean = r(-0.08, 0.08);
            const height = r(110, 160) * scale;
            l.lineWidth = 2.2 * scale;
            l.beginPath();
            l.moveTo(x - 8 * scale, y);
            l.lineTo(x - 8 * scale + Math.sin(lean) * height, y - height);
            l.stroke();
            l.beginPath();
            l.moveTo(x - 8 * scale + Math.sin(lean) * height, y - height - 10 * scale);
            l.lineTo(x - 11 * scale + Math.sin(lean) * height, y - height + 2 * scale);
            l.lineTo(x - 5 * scale + Math.sin(lean) * height, y - height + 2 * scale);
            l.fill();
          }
        }
        const banners = i === 2 ? 4 : 3;
        for (let k = 0; k < banners; k++) {
          const x = (W / banners) * (k + r(0.2, 0.8));
          const y = ground[Math.round(x / 4)];
          const height = r(260, 380) * scale;
          const top = y - height;
          l.lineWidth = 4 * scale;
          l.beginPath();
          l.moveTo(x, y);
          l.lineTo(x, top);
          l.stroke();
          const fw = r(90, 140) * scale;
          const fh = r(60, 90) * scale;
          l.fillStyle = i === 2 ? S.pick(["#3a0e0a", "#0a0705"]) : color;
          l.beginPath();
          l.moveTo(x, top);
          for (let s = 0; s <= 10; s++) l.lineTo(x + (fw * s) / 10, top + Math.sin(s * 0.7 + k) * 8 * scale);
          l.lineTo(x + fw * 0.8, top + fh * 0.5);
          l.lineTo(x + fw, top + fh);
          for (let s = 10; s >= 0; s--) l.lineTo(x + (fw * s) / 10, top + fh + Math.sin(s * 0.7 + k) * 8 * scale);
          l.fill();
          l.fillStyle = color;
        }
      }, { blur: i === 0 ? 1.5 : 0.8 });
      if (i < 2) S.mist(base - 40, base + 70, "#7a5a44", 0.35);
    });
    S.layer((l) => {
      for (let i = 0; i < 120; i++) {
        l.fillStyle = rgba(S.pick(["#ff9a40", "#ffcf80", "#8a7a6a"]), r(0.3, 0.8));
        l.fillRect(r(0, W), r(0, 900), r(1, 2.4), r(1, 2.4));
      }
    }, { blur: 0.6 });
    S.finish({ vignette: 0.5 });
  },

  winter(S) {
    const { ctx, W, H, r } = S;
    S.vgrad(ctx, [[0, "#0c121c"], [0.35, "#26303f"], [0.58, "#4a5464"], [0.64, "#525c6a"], [1, "#141a22"]]);
    S.layer((l) => S.glow(l, 820, 520, 520, "#b8c0c8", 0.25), { composite: "screen" });
    S.layer((l) => S.fillUnder(l, S.ridge(600, 30, 0.003), "#3e4856"), { blur: 2 });
    S.mist(520, 700, "#8a96a6", 0.35);
    // Snowy ground and rows of pines, far rows lost in the haze.
    S.layer((l) => S.vgrad(l, [[0, "#4a5464"], [0.4, "#343e4c"], [1, "#10151c"]], 640, H));
    const rows = [
      [650, 60, 120, "#3a4454", 90, null],
      [730, 100, 180, "#262e3c", 55, "rgba(170,182,198,0.35)"],
      [840, 160, 260, "#141a24", 22, "rgba(190,200,214,0.45)"],
    ];
    rows.forEach(([base, minH, maxH, color, count, snow], i) => {
      S.layer((l) => {
        for (let k = 0; k < count; k++) {
          const x = r(-40, W + 40);
          if (i === 2 && Math.abs(x - 800) < 260) continue;
          pine(S, l, x, base + r(-10, 10), r(minH, maxH), color, snow);
        }
      }, { blur: i === 0 ? 1.6 : 0.8 });
      S.mist(base - 60, base + 60, "#8a96a6", 0.3);
    });
    S.layer((l) => {
      for (const [x, h] of [[90, 520], [230, 400], [1380, 460], [1520, 540]]) pine(S, l, x, H + 30, h, "#080b10", "rgba(200,210,222,0.4)");
    }, { blur: 0.8 });
    S.paint(0.8);
    const flakes = (l, n, size, alpha) => {
      for (let i = 0; i < n; i++) {
        l.fillStyle = rgba("#e8eef6", r(alpha * 0.4, alpha));
        l.beginPath();
        l.arc(r(0, W), r(0, H), r(size * 0.5, size), 0, Math.PI * 2);
        l.fill();
      }
    };
    S.layer((l) => flakes(l, 500, 1.8, 0.6), { blur: 0.6 });
    S.layer((l) => flakes(l, 40, 6, 0.4), { blur: 4 });
    S.finish({ vignette: 0.5, lowerShade: 0.22 });
  },
};

// ---------------------------------------------------------------------------
// Browser entry points used by render.mjs

/** Paint one picture; answers the JPEG as a data URL with its brightness and text contrast. */
export function render(name, quality = 0.82) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const studio = createStudio(canvas, name);
  studio.ctx.fillStyle = "#000";
  studio.ctx.fillRect(0, 0, WIDTH, HEIGHT);
  SCENES[name](studio);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), ...measure(studio.ctx) };
}

if (typeof document !== "undefined") {
  globalThis.cueDeskBackgrounds = { NAMES, render };
}
