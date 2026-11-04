// Small sound-synthesis toolkit for the Lyre demo kit (scripts/demo-kit).
// Everything is plain JavaScript on Float64Arrays, driven by a seeded random
// generator, so the same code always produces the same samples.

export const SAMPLE_RATE = 44_100;

/** Seeded random numbers in [0, 1) (mulberry32). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Frequency of a MIDI note number (69 = A4 = 440 Hz). */
export function hz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

export function samples(seconds, rate = SAMPLE_RATE) {
  return Math.round(seconds * rate);
}

/** A silent stereo buffer: [left, right]. */
export function stereo(seconds, rate = SAMPLE_RATE) {
  const length = samples(seconds, rate);
  return [new Float64Array(length), new Float64Array(length)];
}

/**
 * Add a mono sound into a stereo buffer at `startSeconds`, panned with equal
 * power (pan -1 = left, 0 = centre, 1 = right). Samples past the end are
 * dropped unless `wrap` is on, when they continue at the start: that is how a
 * loop's last notes ring on into its first bar.
 */
export function mixIn(target, sound, startSeconds, { gain = 1, pan = 0, wrap = false, rate = SAMPLE_RATE } = {}) {
  const angle = ((pan + 1) * Math.PI) / 4;
  const gains = target.length === 1 ? [gain] : [gain * Math.cos(angle), gain * Math.sin(angle)];
  const length = target[0].length;
  const start = Math.round(startSeconds * rate);
  for (let channel = 0; channel < target.length; channel++) {
    const out = target[channel];
    const g = gains[channel];
    for (let i = 0; i < sound.length; i++) {
      let at = start + i;
      if (at >= length) {
        if (!wrap) break;
        at %= length;
      }
      if (at >= 0) out[at] += sound[i] * g;
    }
  }
}

// ---------------------------------------------------------------- filters

/** RBJ biquad coefficients, normalised so a0 = 1. */
export function biquad(type, frequency, q = Math.SQRT1_2, rate = SAMPLE_RATE) {
  const w0 = (2 * Math.PI * Math.min(frequency, rate * 0.45)) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  if (type === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (type === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else if (type === "bandpass") {
    // Constant 0 dB peak gain.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    throw new Error(`Unknown filter type ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run a biquad over `input` in place (or into `output`). */
export function filter(input, coefficients, output = input) {
  const { b0, b1, b2, a1, a2 } = coefficients;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

/**
 * A filter whose cut-off moves over time: `frequencyAt(i)` gives the
 * frequency for sample i. Coefficients are refreshed every 32 samples, which
 * is smooth enough for slow sweeps such as wind.
 */
export function sweptFilter(input, type, frequencyAt, q, rate = SAMPLE_RATE) {
  const output = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let c = biquad(type, frequencyAt(0), q, rate);
  for (let i = 0; i < input.length; i++) {
    if (i % 32 === 0) c = biquad(type, frequencyAt(i), q, rate);
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

/** White noise in [-1, 1). */
export function noise(length, random) {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = random() * 2 - 1;
  return out;
}

/**
 * A slowly wandering curve in [0, 1]: random points every `stepSeconds`,
 * joined with smooth (cosine) curves. Used for gusts, flicker and swells.
 */
export function wander(length, stepSeconds, random, rate = SAMPLE_RATE) {
  const step = Math.max(1, Math.round(stepSeconds * rate));
  const points = Array.from({ length: Math.ceil(length / step) + 2 }, random);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const index = Math.floor(i / step);
    const t = (i % step) / step;
    const s = (1 - Math.cos(Math.PI * t)) / 2;
    out[i] = points[index] * (1 - s) + points[index + 1] * s;
  }
  return out;
}

// ----------------------------------------------------------------- voices

const SINE_TABLE_SIZE = 8192;
const SINE_TABLE = new Float64Array(SINE_TABLE_SIZE + 1);
for (let i = 0; i <= SINE_TABLE_SIZE; i++) SINE_TABLE[i] = Math.sin((2 * Math.PI * i) / SINE_TABLE_SIZE);

/** Sine of a phase given in cycles (table look-up; much faster than Math.sin for long pads). */
function sineCycles(phase) {
  const position = (phase - Math.floor(phase)) * SINE_TABLE_SIZE;
  const index = Math.floor(position);
  const fraction = position - index;
  return SINE_TABLE[index] + (SINE_TABLE[index + 1] - SINE_TABLE[index]) * fraction;
}

/** Attack-decay-sustain-release envelope over `length` samples (release ends at `length`). */
export function adsr(length, { attack = 0.01, decay = 0.1, sustain = 0.8, release = 0.2 }, rate = SAMPLE_RATE) {
  const env = new Float64Array(length);
  const a = Math.max(1, Math.round(attack * rate));
  const d = Math.max(1, Math.round(decay * rate));
  const r = Math.max(1, Math.round(release * rate));
  const releaseStart = Math.max(0, length - r);
  for (let i = 0; i < length; i++) {
    let level;
    if (i < a) level = (1 - Math.cos((Math.PI * i) / a)) / 2;
    else if (i < a + d) level = 1 - (1 - sustain) * ((i - a) / d);
    else level = sustain;
    if (i >= releaseStart) level *= (1 + Math.cos((Math.PI * (i - releaseStart)) / r)) / 2;
    env[i] = level;
  }
  return env;
}

/**
 * Plucked string (Karplus-Strong): a burst of filtered noise circulating in
 * a tuned delay line that loses a little treble on every pass, which is what
 * makes it sound like a lute or harp rather than a beep.
 */
export function pluck(frequency, seconds, random, { brightness = 0.5, sustain = 0.996, position = 0.2 } = {}) {
  const length = samples(seconds);
  const out = new Float64Array(length);
  // The averaging loss filter adds half a sample of delay; a first-order
  // all-pass makes up the fractional rest so high notes stay in tune.
  const period = SAMPLE_RATE / frequency - 0.5;
  const delay = Math.max(2, Math.floor(period - 0.5));
  const fraction = period - delay;
  const allpass = (1 - fraction) / (1 + fraction);
  const line = new Float64Array(delay);
  // Excitation: noise softened by a one-pole low-pass (brightness), with a
  // notch from the plucking position (pluck nearer the bridge = more nasal).
  let soft = 0;
  const excitation = new Float64Array(delay);
  for (let i = 0; i < delay; i++) {
    soft += brightness * (random() * 2 - 1 - soft);
    excitation[i] = soft;
  }
  const offset = Math.max(1, Math.round(delay * position));
  let mean = 0;
  for (let i = 0; i < delay; i++) {
    line[i] = excitation[i] - excitation[(i + offset) % delay];
    mean += line[i];
  }
  mean /= delay;
  let peak = 1e-9;
  for (let i = 0; i < delay; i++) {
    line[i] -= mean;
    peak = Math.max(peak, Math.abs(line[i]));
  }
  for (let i = 0; i < delay; i++) line[i] /= peak;

  let index = 0;
  let previous = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < length; i++) {
    const current = line[index];
    const averaged = sustain * 0.5 * (current + previous);
    previous = current;
    const tuned = allpass * averaged + apIn - allpass * apOut;
    apIn = averaged;
    apOut = tuned;
    line[index] = tuned;
    out[i] = current;
    index = (index + 1) % delay;
  }
  // A short fade at the end so a cut-off string does not click.
  const fade = Math.min(length, samples(0.05));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

/**
 * Sum-of-harmonics voice with gentle detune and vibrato: the basis of the
 * pads, strings and brass. `harmonics` is the number of partials,
 * `rolloff` how fast they fade (higher = darker). With `bright` set, the
 * upper partials follow the envelope, so louder means brighter (brass).
 */
export function additive(frequency, seconds, envelopeOptions, { harmonics = 8, rolloff = 1, detuneCents = 0, vibrato = 0, vibratoRate = 5, bright = false, random } = {}) {
  const length = samples(seconds);
  const env = adsr(length, envelopeOptions);
  const out = new Float64Array(length);
  const startPhase = random ? random() : 0;
  const ratio = 2 ** (detuneCents / 1200);
  const vibratoDelay = samples(0.3);
  let phase = startPhase;
  const amplitudes = [];
  let total = 0;
  for (let h = 1; h <= harmonics; h++) {
    if (frequency * h > SAMPLE_RATE * 0.45) break;
    const a = 1 / h ** rolloff;
    amplitudes.push(a);
    total += a;
  }
  for (let i = 0; i < length; i++) {
    const vib = vibrato && i > vibratoDelay ? 1 + vibrato * Math.sin((2 * Math.PI * vibratoRate * i) / SAMPLE_RATE) * Math.min(1, (i - vibratoDelay) / vibratoDelay) : 1;
    phase += (frequency * ratio * vib) / SAMPLE_RATE;
    const e = env[i];
    let value = 0;
    for (let h = 0; h < amplitudes.length; h++) {
      const weight = bright ? amplitudes[h] * e ** (h * 0.35) : amplitudes[h];
      value += weight * sineCycles(phase * (h + 1));
    }
    out[i] = (value / total) * e;
  }
  return out;
}

/** Bell or chime: inharmonic partials, each with its own decay. */
export function bell(frequency, seconds, { partials = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]], decay = 1.5 } = {}) {
  const length = samples(seconds);
  const out = new Float64Array(length);
  const attack = samples(0.002);
  for (const [ratio, amplitude, decayScale] of partials) {
    const f = frequency * ratio;
    if (f > SAMPLE_RATE * 0.45) continue;
    const tau = decay * decayScale * SAMPLE_RATE;
    for (let i = 0; i < length; i++) {
      const env = Math.exp(-i / tau) * Math.min(1, i / attack);
      out[i] += amplitude * env * sineCycles((f * i) / SAMPLE_RATE);
    }
  }
  const fade = Math.min(length, samples(0.05));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

/** Drum: a sine that drops in pitch, plus a soft noise thump. */
export function drum(frequency, seconds, random, { drop = 1.6, decay = 0.4, noiseLevel = 0.3, noiseTone = 900 } = {}) {
  const length = samples(seconds);
  const out = new Float64Array(length);
  let phase = 0;
  const thump = filter(noise(length, random), biquad("lowpass", noiseTone, 0.7));
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const f = frequency * (1 + (drop - 1) * Math.exp(-t / 0.03));
    phase += f / SAMPLE_RATE;
    const env = Math.exp(-t / decay) * Math.min(1, i / 40);
    out[i] = env * sineCycles(phase) + noiseLevel * thump[i] * Math.exp(-t / 0.03);
  }
  return out;
}

// ----------------------------------------------------------------- spaces

/**
 * A small room/hall reverb in the Freeverb style: eight damped comb filters
 * in parallel and four all-passes in series, with slightly different lengths
 * on the right so the sound spreads. `size` 0-1 sets the decay, `damping`
 * how quickly the echoes lose treble. Returns the wet signal only.
 */
export function reverb([left, right], { size = 0.7, damping = 0.4 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const feedback = 0.7 + 0.28 * size;
  const process = (input, spread) => {
    const out = new Float64Array(input.length);
    for (const base of combs) {
      const length = base + spread;
      const buffer = new Float64Array(length);
      let index = 0;
      let store = 0;
      for (let i = 0; i < input.length; i++) {
        const value = buffer[index];
        store = value * (1 - damping) + store * damping;
        buffer[index] = input[i] * 0.015 + store * feedback;
        out[i] += value;
        index = index + 1 === length ? 0 : index + 1;
      }
    }
    for (const base of allpasses) {
      const length = base + spread;
      const buffer = new Float64Array(length);
      let index = 0;
      for (let i = 0; i < out.length; i++) {
        const delayed = buffer[index];
        const value = out[i];
        buffer[index] = value + delayed * 0.5;
        out[i] = delayed - value;
        index = index + 1 === length ? 0 : index + 1;
      }
    }
    return out;
  };
  return [process(left, 0), process(right ?? left, 23)];
}

/** Echo: a feedback delay with a soft low-pass in the loop. Wet signal only. */
export function echo(channels, { seconds = 0.3, feedback = 0.35, tone = 3000 } = {}) {
  const length = samples(seconds);
  const c = biquad("lowpass", tone, 0.7);
  return channels.map((input) => {
    const out = new Float64Array(input.length);
    const buffer = new Float64Array(length);
    let index = 0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const delayed = buffer[index];
      const y = c.b0 * delayed + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = delayed;
      y2 = y1;
      y1 = y;
      buffer[index] = input[i] + y * feedback;
      out[i] = y;
      index = (index + 1) % length;
    }
    return out;
  });
}

/** Add `wet` into `dry` with a gain (both arrays of channels). */
export function addInto(dry, wet, gain) {
  for (let c = 0; c < dry.length; c++) {
    const d = dry[c];
    const w = wet[c];
    for (let i = 0; i < d.length; i++) d[i] += w[i] * gain;
  }
  return dry;
}

/**
 * Make a seamless loop of `loopSeconds` from a rendering that runs on past
 * the loop point: the overhang (reverb tails, last notes) is folded back onto
 * the start, so playing the result over and over sounds continuous.
 */
export function foldLoop(channels, loopSeconds, rate = SAMPLE_RATE) {
  const length = samples(loopSeconds, rate);
  return channels.map((input) => {
    const out = input.slice(0, length);
    for (let i = length; i < input.length; i++) out[i % length] += input[i];
    return out;
  });
}

/**
 * Make a loop from a texture (noise beds) by cross-fading its overhang into
 * its start with equal power, so there is no jump at the loop point.
 */
export function crossfadeLoop(channels, loopSeconds, fadeSeconds, rate = SAMPLE_RATE) {
  const length = samples(loopSeconds, rate);
  const fade = samples(fadeSeconds, rate);
  return channels.map((input) => {
    if (input.length < length + fade) throw new Error("crossfadeLoop needs the overhang rendered");
    const out = input.slice(0, length);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      out[i] = input[i] * Math.sin((Math.PI / 2) * t) + input[length + i] * Math.cos((Math.PI / 2) * t);
    }
    return out;
  });
}

/** Fade in and/or out over the given seconds (cosine curve). */
export function fades(channels, { fadeIn = 0, fadeOut = 0 }, rate = SAMPLE_RATE) {
  for (const channel of channels) {
    const fi = samples(fadeIn, rate);
    const fo = samples(fadeOut, rate);
    for (let i = 0; i < fi && i < channel.length; i++) channel[i] *= (1 - Math.cos((Math.PI * i) / fi)) / 2;
    for (let i = 0; i < fo && i < channel.length; i++) channel[channel.length - 1 - i] *= (1 - Math.cos((Math.PI * i) / fo)) / 2;
  }
  return channels;
}
