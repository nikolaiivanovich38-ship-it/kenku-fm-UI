// Ambience loops and one-shot effects for the Lyre demo kit, made from
// filtered noise and simple resonators. Each function returns
// { channels, rate } before mastering.
import {
  SAMPLE_RATE,
  addInto,
  bell,
  biquad,
  crossfadeLoop,
  drum,
  fades,
  filter,
  hz,
  mixIn,
  mulberry32,
  noise,
  reverb,
  samples,
  sweptFilter,
  wander,
} from "./synth.mjs";

// The ambience loops are mono at half the music's sample rate: rain and fire
// are noise, so they lose nothing a player would hear, and the kit stays
// small enough to download quickly.
export const AMBIENCE_RATE = 22_050;

/** A short decaying burst of band-limited noise: a droplet, a crackle, a click. */
function burst(random, seconds, centre, q, decaySeconds, rate) {
  const length = samples(seconds, rate);
  const out = filter(noise(length, random), biquad("bandpass", centre, q, rate));
  for (let i = 0; i < length; i++) out[i] *= Math.exp(-i / (decaySeconds * rate));
  return out;
}

/**
 * Rain and Wind: steady rain (high, soft hiss plus scattered droplets) and
 * wind gusts (a band of low noise whose pitch and level wander). 30 s,
 * cross-faded into its own start so it loops seamlessly.
 */
export function rainAndWind() {
  const rate = AMBIENCE_RATE;
  const random = mulberry32(0x4a1);
  const loop = 30;
  const length = samples(loop + 3, rate);
  const out = new Float64Array(length);

  // Rain bed: noise between about 500 Hz and 6 kHz, with a slow swell.
  const bed = filter(filter(noise(length, random), biquad("highpass", 500, 0.7, rate)), biquad("lowpass", 6000, 0.7, rate));
  const swell = wander(length, 3, random, rate);
  for (let i = 0; i < length; i++) out[i] += bed[i] * 0.25 * (0.8 + 0.2 * swell[i]);

  // Droplets on leaves and stone: about 60 a second, random pitch and level.
  const droplets = Math.round(60 * (length / rate));
  for (let n = 0; n < droplets; n++) {
    const at = random() * (length / rate);
    const drop = burst(random, 0.03, 1500 + 3500 * random(), 4, 0.004, rate);
    const level = 0.15 + 0.5 * random() ** 3;
    mixIn([out], drop, at, { gain: level, rate });
  }

  // Wind: low noise through a band-pass whose centre and level drift.
  const gust = wander(length, 2.5, random, rate);
  const wind = sweptFilter(noise(length, random), "bandpass", (i) => 250 + 600 * gust[i], 2.5, rate);
  for (let i = 0; i < length; i++) out[i] += wind[i] * (0.1 + 0.9 * gust[i] ** 2) * 1.6;

  return { channels: crossfadeLoop([out], loop, 3, rate), rate };
}

/**
 * Hearth Fire: a low roar, a faint hiss and crackles that come in little
 * clusters, as wood pops. 30 s, cross-faded into its own start.
 */
export function hearthFire() {
  const rate = AMBIENCE_RATE;
  const random = mulberry32(0xf12e);
  const loop = 30;
  const length = samples(loop + 3, rate);
  const out = new Float64Array(length);

  // Roar: noise below about 250 Hz, breathing slowly.
  const roar = filter(filter(noise(length, random), biquad("lowpass", 250, 0.7, rate)), biquad("highpass", 40, 0.7, rate));
  const breath = wander(length, 1.7, random, rate);
  for (let i = 0; i < length; i++) out[i] += roar[i] * (0.6 + 0.4 * breath[i]) * 0.9;

  // Hiss: a little high noise.
  const hiss = filter(noise(length, random), biquad("highpass", 3000, 0.7, rate));
  for (let i = 0; i < length; i++) out[i] += hiss[i] * 0.02;

  // Crackles: clusters of short bursts, each with its own pitch and level.
  const activity = wander(length, 0.8, random, rate);
  let t = 0;
  while (t < length / rate) {
    const busy = activity[Math.min(length - 1, Math.round(t * rate))];
    t += 0.02 + random() * (0.25 - 0.2 * busy);
    const pop = random() < 0.08;
    const seconds = pop ? 0.05 : 0.015;
    const crackle = burst(random, seconds, 1200 + 3200 * random(), pop ? 1.5 : 3, pop ? 0.008 : 0.002, rate);
    const level = pop ? 0.5 + 0.3 * random() : (0.15 + 0.45 * random() ** 2) * 1.6;
    mixIn([out], crackle, t, { gain: level, rate });
  }

  return { channels: crossfadeLoop([out], loop, 3, rate), rate };
}

/** Mono effect with a short room around it. */
function inRoom(sound, { size = 0.4, damping = 0.5, wet = 0.2 } = {}) {
  const room = reverb([sound, sound], { size, damping });
  const out = Float64Array.from(sound);
  addInto([out], [room[0].map((value, i) => (value + room[1][i]) / 2)], wet);
  return out;
}

/**
 * Sword Clash: a sharp metallic strike (bright noise) and the ringing of
 * the blades (inharmonic partials that beat against each other), then a
 * short scrape. 1.6 s.
 */
export function swordClash() {
  const random = mulberry32(0x5e0d);
  const length = samples(1.6);
  const out = new Float64Array(length);
  const strike = filter(noise(samples(0.06), random), biquad("highpass", 2500, 0.7));
  for (let i = 0; i < strike.length; i++) strike[i] *= Math.exp(-i / (0.012 * SAMPLE_RATE));
  mixIn([out], strike, 0, { gain: 0.7 });
  // Partials spread up to about 9 kHz; only a faint, slow beat between the
  // two lowest, so the blade shimmers without wobbling like a bell.
  const ring = bell(1430, 1.5, {
    partials: [[1, 0.3, 0.35], [1.0035, 0.15, 0.3], [2.17, 0.4, 0.3], [3.41, 0.45, 0.25], [4.9, 0.35, 0.18], [6.3, 0.25, 0.12]],
    decay: 1.2,
  });
  mixIn([out], ring, 0.002, { gain: 0.45 });
  const scrape = filter(noise(samples(0.35), random), biquad("bandpass", 4200, 3));
  for (let i = 0; i < scrape.length; i++) {
    const t = i / scrape.length;
    scrape[i] *= Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 30 * t));
  }
  mixIn([out], scrape, 0.12, { gain: 0.35 });
  return { channels: [inRoom(out, { wet: 0.15 })], rate: SAMPLE_RATE };
}

/** Door Knock: three knuckle knocks on a heavy wooden door. 1.8 s. */
export function doorKnock() {
  const random = mulberry32(0xd00e);
  const length = samples(1.8);
  const out = new Float64Array(length);
  for (const [at, level] of [[0.05, 1], [0.33, 0.9], [0.58, 1.05]]) {
    const knock = new Float64Array(samples(0.35));
    // The door panel: two low wooden resonances...
    const body = drum(118, 0.35, random, { drop: 1.15, decay: 0.05, noiseLevel: 0, noiseTone: 500 });
    const panel = drum(236, 0.35, random, { drop: 1.1, decay: 0.03, noiseLevel: 0, noiseTone: 500 });
    // ...and the knuckle itself, a soft band of noise.
    const knuckle = burst(random, 0.04, 900, 1.2, 0.006, SAMPLE_RATE);
    for (let i = 0; i < knock.length; i++) knock[i] = body[i] * 0.8 + panel[i] * 0.4 + (knuckle[i] ?? 0) * 2.2;
    mixIn([out], knock, at, { gain: level });
  }
  return { channels: [inRoom(out, { size: 0.35, wet: 0.25 })], rate: SAMPLE_RATE };
}

/** Magic Chime: a rising sparkle of bell notes over a soft shimmer. 3.2 s. */
export function magicChime() {
  const random = mulberry32(0x3a91c);
  const length = samples(3.2);
  const out = new Float64Array(length);
  // E major pentatonic, climbing.
  [76, 80, 83, 85, 88, 92, 95].forEach((note, index) => {
    const tone = bell(hz(note), 2.4, { partials: [[1, 1, 1], [2.0, 0.25, 0.6], [3.0, 0.1, 0.4], [4.07, 0.08, 0.25]], decay: 0.9 });
    mixIn([out], tone, 0.02 + index * 0.085 + random() * 0.01, { gain: 0.32 - index * 0.025 });
  });
  const shimmer = filter(noise(length, random), biquad("bandpass", 7000, 4));
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    shimmer[i] *= Math.min(1, t / 0.3) * Math.exp(-t / 0.9) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 11 * t));
  }
  mixIn([out], shimmer, 0, { gain: 0.25 });
  const wet = inRoom(out, { size: 0.7, damping: 0.3, wet: 0.35 });
  fades([wet], { fadeOut: 0.6 });
  return { channels: [wet], rate: SAMPLE_RATE };
}

/** Thunder: a near crack and a long rolling rumble. 6 s. */
export function thunder() {
  const random = mulberry32(0x7d2);
  const length = samples(6);
  const out = new Float64Array(length);
  const crack = filter(noise(samples(0.4), random), biquad("lowpass", 3500, 0.7));
  for (let i = 0; i < crack.length; i++) crack[i] *= Math.exp(-i / (0.06 * SAMPLE_RATE)) * (0.6 + 0.4 * random());
  mixIn([out], crack, 0.02, { gain: 0.9 });
  // Rumble: low noise, rolling in waves that slowly die away.
  const rumble = filter(filter(noise(length, random), biquad("lowpass", 160, 0.8)), biquad("lowpass", 300, 0.7));
  const rolls = wander(length, 0.35, random);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const swell = Math.min(1, t / 0.25) * Math.exp(-t / 1.9);
    rumble[i] *= swell * (0.35 + 0.65 * rolls[i] ** 2);
  }
  mixIn([out], rumble, 0, { gain: 5 });
  const wet = inRoom(out, { size: 0.85, damping: 0.6, wet: 0.3 });
  fades([wet], { fadeOut: 1.5 });
  return { channels: [wet], rate: SAMPLE_RATE };
}

/** Coin Pouch: a leather pouch set down, coins jingling inside. 1.3 s. */
export function coinPouch() {
  const random = mulberry32(0xc014);
  const length = samples(1.3);
  const out = new Float64Array(length);
  // Leather: a soft thud and rustle.
  const leather = filter(noise(samples(0.25), random), biquad("bandpass", 700, 0.8));
  for (let i = 0; i < leather.length; i++) leather[i] *= Math.exp(-i / (0.05 * SAMPLE_RATE));
  mixIn([out], leather, 0, { gain: 0.6 });
  mixIn([out], drum(140, 0.3, random, { drop: 1.2, decay: 0.05, noiseLevel: 0.2, noiseTone: 400 }), 0, { gain: 0.35 });
  // Coins: short, bright, slightly out-of-tune metal clinks, most just after the drop.
  for (let n = 0; n < 26; n++) {
    const at = 0.01 + 0.6 * random() ** 1.8;
    const base = 2800 + 2600 * random();
    const clink = bell(base, 0.3, { partials: [[1, 1, 0.5], [1.52, 0.6, 0.35], [2.31, 0.35, 0.25]], decay: 0.12 + 0.1 * random() });
    mixIn([out], clink, at, { gain: 0.12 + 0.12 * random() });
  }
  return { channels: [inRoom(out, { size: 0.3, wet: 0.12 })], rate: SAMPLE_RATE };
}
