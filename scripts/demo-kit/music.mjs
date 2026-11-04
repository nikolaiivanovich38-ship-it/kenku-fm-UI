// The four music cues of the Lyre demo kit, composed and synthesised in code.
// Each function returns { channels: [left, right], rate } before mastering.
import {
  SAMPLE_RATE,
  addInto,
  additive,
  adsr,
  bell,
  biquad,
  drum,
  echo,
  fades,
  filter,
  hz,
  mixIn,
  mulberry32,
  noise,
  pluck,
  reverb,
  samples,
  stereo,
} from "./synth.mjs";

/**
 * Reverb or echo for a loop: process the loop twice in a row and keep the
 * second pass, so the tail that rings over the loop point is already
 * present at the start.
 */
function cyclic(effect, channels, options) {
  const doubled = channels.map((channel) => {
    const twice = new Float64Array(channel.length * 2);
    twice.set(channel, 0);
    twice.set(channel, channel.length);
    return twice;
  });
  return effect(doubled, options).map((channel) => channel.slice(channel.length / 2));
}

/** Small timing and level differences, so plucked notes sound played rather than sequenced. */
function humanise(random, seconds = 0.008) {
  return (random() * 2 - 1) * seconds;
}

/**
 * Tavern Warmth: a lute-like waltz in D major, 16 bars of 3/4 at 90 bpm
 * (32 s), arpeggiated chords, a folk melody, a soft frame drum and a little
 * room echo. Every note that rings past the end continues at the start, so it
 * loops without a seam.
 */
export function tavernWarmth() {
  const random = mulberry32(0x7a7e1);
  const beat = 60 / 90;
  const bar = 3 * beat;
  const loop = 16 * bar;
  const out = stereo(loop);
  const chords = ["D", "G", "A", "D", "Bm", "G", "A", "D", "D", "G", "Em", "A", "G", "A", "D", "D"];
  const shapes = { D: [50, 4], G: [43, 4], A: [45, 4], Bm: [47, 3], Em: [52, 3] };
  // [bar, beat, note, beats]
  const melody = [
    [0, 0, 66, 1], [0, 1, 69, 1], [0, 2, 74, 1],
    [1, 0, 71, 2], [1, 2, 69, 1],
    [2, 0, 69, 1], [2, 1, 67, 1], [2, 2, 66, 1],
    [3, 0, 66, 3],
    [4, 0, 66, 1], [4, 1, 71, 1], [4, 2, 74, 1],
    [5, 0, 71, 2], [5, 2, 67, 1],
    [6, 0, 69, 1], [6, 1, 71, 1], [6, 2, 73, 1],
    [7, 0, 74, 3],
    [8, 0, 78, 1], [8, 1, 76, 1], [8, 2, 74, 1],
    [9, 0, 71, 2], [9, 2, 74, 1],
    [10, 0, 76, 1], [10, 1, 74, 1], [10, 2, 71, 1],
    [11, 0, 69, 3],
    [12, 0, 67, 1], [12, 1, 71, 1], [12, 2, 74, 1],
    [13, 0, 73, 1], [13, 1, 71, 1], [13, 2, 69, 1],
    [14, 0, 66, 1], [14, 1, 69, 1], [14, 2, 64, 1],
    [15, 0, 62, 3],
  ];

  chords.forEach((name, index) => {
    const [root, third] = shapes[name];
    const start = index * bar;
    // Bass string on the downbeat.
    const bass = root - 12 >= 38 ? root - 12 : root;
    mixIn(out, pluck(hz(bass), 3, random, { brightness: 0.35, sustain: 0.998, position: 0.25 }), start + humanise(random), { gain: 0.55, pan: 0, wrap: true });
    // Six eighth notes across the bar.
    const arpeggio = [root + 7, root + 12, root + 12 + third, root + 19, root + 12 + third, root + 12];
    arpeggio.forEach((note, step) => {
      const level = (step === 0 ? 0.36 : 0.28) * (0.85 + 0.3 * random());
      mixIn(out, pluck(hz(note), 1.8, random, { brightness: 0.45, sustain: 0.995, position: 0.18 }), start + (step * beat) / 2 + humanise(random), { gain: level, pan: -0.35, wrap: true });
    });
    // A warm, very quiet bed under the strings.
    for (const note of [root + 12, root + 12 + third, root + 19]) {
      mixIn(out, additive(hz(note), bar + 0.6, { attack: 0.4, decay: 0.3, sustain: 0.8, release: 0.6 }, { harmonics: 5, rolloff: 2, random }), start, { gain: 0.05, pan: 0.2, wrap: true });
    }
    // Frame drum: deep on beat one, a light tap on beat three.
    mixIn(out, drum(95, 0.6, random, { decay: 0.18, noiseLevel: 0.4, noiseTone: 600 }), start, { gain: 0.22, pan: 0.1, wrap: true });
    mixIn(out, drum(170, 0.3, random, { decay: 0.07, noiseLevel: 0.6, noiseTone: 1500 }), start + 2 * beat, { gain: 0.14, pan: 0.1, wrap: true });
  });

  for (const [barIndex, beatIndex, note, beats] of melody) {
    const start = barIndex * bar + beatIndex * beat + humanise(random);
    mixIn(out, pluck(hz(note), beats * beat + 1.2, random, { brightness: 0.6, sustain: 0.997, position: 0.12 }), start, { gain: 0.42 * (0.9 + 0.2 * random()), pan: 0.3, wrap: true });
  }

  addInto(out, cyclic(echo, out, { seconds: beat * 0.75, feedback: 0.3, tone: 2500 }), 0.18);
  addInto(out, cyclic(reverb, out, { size: 0.45, damping: 0.5 }), 0.22);
  return { channels: out, rate: SAMPLE_RATE };
}

/**
 * Tense Crossing: a low, pulsing D minor cue at 80 bpm, 11 bars of 4/4
 * (33 s). It builds: string tremolo from bar 5, a heartbeat drum from bar 7,
 * a ticking figure from bar 9; in the last bar everything but the pulse falls
 * away, so it loops back to the quiet start.
 */
export function tenseCrossing() {
  const random = mulberry32(0x7e45e);
  const beat = 60 / 80;
  const bar = 4 * beat;
  const loop = 11 * bar;
  const out = stereo(loop);
  const chords = ["Dm", "Dm", "Bb", "Bb", "Gm", "Gm", "A", "A", "Dm", "Bb", "A"];
  const pulseRoot = { Dm: 38, Bb: 46, Gm: 43, A: 45 };
  const padNotes = { Dm: [50, 53, 57], Bb: [50, 53, 58], Gm: [50, 55, 58], A: [49, 52, 57] };

  chords.forEach((name, index) => {
    const start = index * bar;
    const build = index / 10; // 0 at the start, 1 in the last bar
    // Pulse: eighth notes, accents in a 3-3-2 pattern; louder as it builds,
    // easing off again in the last bar.
    const pulseLevel = index === 10 ? 0.55 : 0.45 + 0.4 * build;
    for (let step = 0; step < 8; step++) {
      const accent = step === 0 || step === 3 || step === 6 ? 1 : 0.6;
      const tone = additive(hz(pulseRoot[name]), 0.4, { attack: 0.004, decay: 0.25, sustain: 0, release: 0.12 }, { harmonics: 7, rolloff: 1.1, random });
      mixIn(out, tone, start + (step * beat) / 2, { gain: 0.5 * pulseLevel * accent, pan: 0, wrap: true });
    }
    // Low strings holding the chord.
    for (const [voice, note] of padNotes[name].entries()) {
      const level = index === 10 ? 0.06 : 0.07 + 0.03 * build;
      const length = bar + 1.2;
      mixIn(out, additive(hz(note), length, { attack: 1.2, decay: 0.5, sustain: 0.85, release: 1.2 }, { harmonics: 10, rolloff: 1.4, detuneCents: -5, vibrato: 0.002, vibratoRate: 4.6, random }), start, { gain: level, pan: -0.5 + voice * 0.15, wrap: true });
      mixIn(out, additive(hz(note), length, { attack: 1.2, decay: 0.5, sustain: 0.85, release: 1.2 }, { harmonics: 10, rolloff: 1.4, detuneCents: 5, vibrato: 0.002, vibratoRate: 5.1, random }), start, { gain: level, pan: 0.5 - voice * 0.15, wrap: true });
    }
    // Bars 5-10: high string tremolo, A5 and B-flat 5 rubbing against each other.
    if (index >= 4 && index < 10) {
      const note = index % 2 === 0 ? 81 : 82;
      const tremolo = additive(hz(note), bar + 0.4, { attack: 0.6, decay: 0.2, sustain: 0.9, release: 0.4 }, { harmonics: 6, rolloff: 1.5, vibrato: 0.003, random });
      for (let i = 0; i < tremolo.length; i++) tremolo[i] *= 0.65 + 0.35 * Math.sin((2 * Math.PI * 9 * i) / SAMPLE_RATE);
      mixIn(out, tremolo, start, { gain: 0.035 + 0.03 * (index - 4) / 5, pan: 0.4, wrap: true });
    }
    // Bars 7-10: heartbeat drum.
    if (index >= 6 && index < 10) {
      for (const offset of [0, 0.35 * beat, 2 * beat, 2.35 * beat]) {
        const soft = offset > 0 && offset < 1 ? 0.7 : 1;
        mixIn(out, drum(62, 0.7, random, { drop: 1.4, decay: 0.22, noiseLevel: 0.25, noiseTone: 400 }), start + offset, { gain: 0.38 * soft, wrap: true });
      }
    }
    // Bars 9-10: a ticking figure, like a clock or footsteps on stone.
    if (index >= 8 && index < 10) {
      for (let step = 0; step < 8; step++) {
        const note = step % 2 === 0 ? 86 : 87;
        mixIn(out, pluck(hz(note), 0.5, random, { brightness: 0.8, sustain: 0.985, position: 0.1 }), start + (step * beat) / 2 + beat / 4, { gain: 0.07, pan: step % 2 === 0 ? -0.5 : 0.5, wrap: true });
      }
    }
  });

  addInto(out, cyclic(reverb, out, { size: 0.75, damping: 0.6 }), 0.3);
  return { channels: out, rate: SAMPLE_RATE };
}

/**
 * Heroic Sting: a timpani roll and string swell rise for 4 seconds into a
 * brass fanfare in B-flat major (9 bars at 100 bpm), ending on a held chord
 * that rings out by 30 s. Not a loop.
 */
export function heroicSting() {
  const random = mulberry32(0x4e201c);
  const length = 30;
  const out = stereo(length);
  const rise = 4;
  const beat = 0.6;
  const bar = 4 * beat;

  // The rise: timpani roll on F with a crescendo, strings swelling on F major, a cymbal swell.
  for (let t = 0; t < rise - 0.05; t += 0.07) {
    const level = 0.03 + 0.22 * (t / rise) ** 2;
    mixIn(out, drum(hz(41), 0.5, random, { drop: 1.08, decay: 0.35, noiseLevel: 0.2, noiseTone: 700 }), t + humanise(random, 0.004), { gain: level });
  }
  for (const [voice, note] of [53, 57, 60, 65].entries()) {
    const swell = additive(hz(note), rise + 0.3, { attack: rise - 0.2, decay: 0.05, sustain: 1, release: 0.3 }, { harmonics: 10, rolloff: 1.2, detuneCents: voice % 2 ? 4 : -4, vibrato: 0.003, random });
    mixIn(out, swell, 0, { gain: 0.09, pan: -0.45 + voice * 0.3 });
  }
  const swish = filter(noise(samples(rise), random), biquad("highpass", 5000, 0.7));
  for (let i = 0; i < swish.length; i++) swish[i] *= (i / swish.length) ** 3;
  mixIn(out, swish, 0, { gain: 0.05, pan: 0.2 });

  // The fanfare.
  const chords = [
    [46, 53, 58, 62], [51, 55, 58, 63], [46, 53, 58, 62], [41, 53, 57, 60], [43, 55, 58, 62],
    [51, 55, 58, 63], [48, 55, 60, 63], [41, 53, 57, 63], [46, 53, 58, 62, 65],
  ];
  const melody = [
    [0, 0, 70, 1], [0, 1, 74, 1], [0, 2, 77, 2],
    [1, 0, 75, 1.5], [1, 1.5, 74, 0.5], [1, 2, 72, 2],
    [2, 0, 74, 1], [2, 1, 70, 1], [2, 2, 77, 2],
    [3, 0, 77, 1], [3, 1, 79, 1], [3, 2, 81, 2],
    [4, 0, 79, 2], [4, 2, 74, 1], [4, 3, 79, 1],
    [5, 0, 82, 3], [5, 3, 79, 1],
    [6, 0, 77, 1], [6, 1, 75, 1], [6, 2, 74, 1], [6, 3, 72, 1],
    [7, 0, 72, 2], [7, 2, 77, 2],
    [8, 0, 82, 8.5],
  ];
  const finalBar = 8;
  chords.forEach((notes, index) => {
    const start = rise + index * bar;
    const held = index === finalBar ? 5.4 : bar + 0.25;
    // Horns: soft, darker brass on the chord.
    for (const [voice, note] of notes.slice(1).entries()) {
      const horn = additive(hz(note), held, { attack: 0.08, decay: 0.3, sustain: 0.75, release: index === finalBar ? 2.2 : 0.3 }, { harmonics: 8, rolloff: 1.4, bright: true, vibrato: 0.002, random });
      mixIn(out, horn, start, { gain: 0.085, pan: -0.5 + voice * 0.3 });
    }
    // Strings an octave up, for shine.
    for (const [voice, note] of notes.slice(1).entries()) {
      const strings = additive(hz(note + 12), held, { attack: 0.25, decay: 0.3, sustain: 0.8, release: index === finalBar ? 2.6 : 0.4 }, { harmonics: 10, rolloff: 1.3, detuneCents: voice % 2 ? 5 : -5, vibrato: 0.004, random });
      mixIn(out, strings, start, { gain: 0.035, pan: 0.5 - voice * 0.3 });
    }
    // Low strings on the root.
    mixIn(out, additive(hz(notes[0] - 12), held, { attack: 0.06, decay: 0.4, sustain: 0.7, release: index === finalBar ? 2.6 : 0.3 }, { harmonics: 10, rolloff: 1.1, random }), start, { gain: 0.13 });
    // Timpani on beats one and three.
    const timpani = notes[0] < 44 ? notes[0] : notes[0] - 12;
    mixIn(out, drum(hz(timpani), 1.6, random, { drop: 1.06, decay: 0.55, noiseLevel: 0.25, noiseTone: 700 }), start, { gain: 0.35 });
    if (index !== finalBar) {
      mixIn(out, drum(hz(timpani), 1.2, random, { drop: 1.06, decay: 0.4, noiseLevel: 0.2, noiseTone: 700 }), start + 2 * beat, { gain: 0.3 });
    }
  });
  // A cymbal on the first hit and the final chord.
  for (const at of [rise, rise + finalBar * bar]) {
    const crash = filter(noise(samples(2.5), random), biquad("highpass", 3500, 0.7));
    for (let i = 0; i < crash.length; i++) crash[i] *= Math.exp(-i / (0.7 * SAMPLE_RATE));
    mixIn(out, crash, at, { gain: 0.07, pan: -0.2 });
  }
  // A last timpani roll under the final chord.
  for (let t = 0; t < 2.4; t += 0.08) {
    const level = 0.15 * (1 - t / 2.4) ** 2;
    mixIn(out, drum(hz(34), 0.5, random, { drop: 1.06, decay: 0.3, noiseLevel: 0.15, noiseTone: 600 }), rise + finalBar * bar + 0.3 + t, { gain: level });
  }
  // Trumpet melody, with a little vibrato on long notes.
  for (const [barIndex, beatIndex, note, beats] of melody) {
    const start = rise + barIndex * bar + beatIndex * beat;
    const last = barIndex === finalBar;
    const trumpet = additive(hz(note), beats * beat + (last ? 0 : 0.05), { attack: 0.05, decay: 0.15, sustain: 0.8, release: last ? 2.4 : 0.08 }, { harmonics: 12, rolloff: 0.95, bright: true, vibrato: beats >= 2 ? 0.004 : 0, vibratoRate: 5.5, random });
    mixIn(out, trumpet, start, { gain: 0.16, pan: 0.1 });
  }

  addInto(out, reverb(out, { size: 0.8, damping: 0.45 }), 0.3);
  fades(out, { fadeOut: 1.0 });
  return { channels: out, rate: SAMPLE_RATE };
}

/**
 * Melancholy Drift: slow string-pad chords in A minor (Am9, Fmaj7, Dm9,
 * Esus4), 8 s each, with a few soft glass-like notes in a large hall. Fades
 * in and fades out over the last 8 s.
 */
export function melancholyDrift() {
  const random = mulberry32(0x3e1a);
  const length = 32;
  const out = stereo(length);
  const chords = [
    [45, 52, 59, 60, 64],
    [41, 53, 57, 60, 64],
    [38, 53, 57, 60, 64],
    [40, 52, 57, 59, 64],
  ];
  chords.forEach((notes, index) => {
    const start = index * 8;
    const held = Math.min(10.5, length - start);
    for (const [voice, note] of notes.entries()) {
      const level = voice === 0 ? 0.11 : 0.07;
      const envelope = { attack: 2.5, decay: 1, sustain: 0.85, release: 3 };
      mixIn(out, additive(hz(note), held, envelope, { harmonics: 8, rolloff: 1.7, detuneCents: -6, vibrato: 0.0025, vibratoRate: 4.2, random }), start, { gain: level, pan: -0.6 });
      mixIn(out, additive(hz(note), held, envelope, { harmonics: 8, rolloff: 1.7, detuneCents: 6, vibrato: 0.0025, vibratoRate: 4.8, random }), start, { gain: level, pan: 0.6 });
    }
  });
  const glass = [[2, 76], [4, 72], [6, 71], [10, 69], [12, 72], [14, 76], [18, 77], [20, 76], [22, 72], [26, 71], [28, 69]];
  glass.forEach(([at, note], index) => {
    const tone = bell(hz(note), 4, { partials: [[1, 1, 1], [2, 0.3, 0.5], [3, 0.12, 0.3], [4.2, 0.04, 0.2]], decay: 1.6 });
    // A slower attack than a real bell, so the notes bloom out of the pad.
    const soft = adsr(tone.length, { attack: 0.03, decay: 0.01, sustain: 1, release: 0.05 });
    for (let i = 0; i < tone.length; i++) tone[i] *= soft[i];
    mixIn(out, tone, at, { gain: 0.12, pan: index % 2 ? 0.35 : -0.35 });
  });
  addInto(out, reverb(out, { size: 0.9, damping: 0.5 }), 0.4);
  fades(out, { fadeIn: 3, fadeOut: 8 });
  return { channels: out, rate: SAMPLE_RATE };
}
