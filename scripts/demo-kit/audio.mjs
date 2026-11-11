// Levels and files for the Lyre demo kit: loudness (ITU-R BS.1770 / EBU R128
// integrated loudness, the "LUFS" figure streaming services use), peak level,
// a gentle peak limiter, and reading and writing 16-bit PCM WAV files.
// Shared by build.mjs and the tests in scripts/demo-kit.test.mjs.

/** Highest absolute sample value across channels, in dBFS (0 = full scale). */
export function peakDb(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

/**
 * Biquad coefficients of the K-weighting filters for any sample rate
 * (BS.1770-4), computed the way libebur128 does; at 48 kHz they equal the
 * coefficients printed in the standard.
 */
function kWeighting(rate) {
  // Stage 1: high shelf, about +4 dB above 1.5 kHz (the head's effect).
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / rate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  // Stage 2: high pass at about 38 Hz (RLB weighting).
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + k / q + k * k;
  const high = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
  return [shelf, high];
}

function runBiquad(input, { b0, b1, b2, a1, a2 }) {
  const out = new Float64Array(input.length);
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
    out[i] = y;
  }
  return out;
}

/**
 * Integrated loudness in LUFS: K-weighted mean square over 400 ms blocks
 * (75 % overlap), ignoring blocks below -70 LUFS and then blocks more than
 * 10 LU below the average. Mono counts as one channel, as in BS.1770 and
 * ffmpeg's ebur128 filter. Returns -Infinity for silence.
 */
export function integratedLoudness(channels, rate) {
  const [shelf, high] = kWeighting(rate);
  const weighted = channels.map((channel) => runBiquad(runBiquad(channel, shelf), high));
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const length = channels[0].length;
  const powers = [];
  for (let start = 0; start + block <= length; start += step) {
    let sum = 0;
    for (const channel of weighted) {
      let squares = 0;
      for (let i = start; i < start + block; i++) squares += channel[i] * channel[i];
      sum += squares / block;
    }
    powers.push(sum);
  }
  const loudness = (power) => -0.691 + 10 * Math.log10(power);
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const aboveAbsolute = powers.filter((p) => loudness(p) > -70);
  if (aboveAbsolute.length === 0) return -Infinity;
  const relativeGate = loudness(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((p) => loudness(p) > relativeGate);
  return loudness(mean(gated));
}

/**
 * Peak limiter: wherever a sample would pass `ceilingDb`, the gain dips
 * smoothly around it (5 ms look-ahead, 80 ms recovery), so loud hits are
 * tamed without the crackle of clipping. Works in place.
 */
export function limit(channels, rate, ceilingDb = -1.5) {
  const ceiling = 10 ** (ceilingDb / 20);
  const length = channels[0].length;
  const wanted = new Float64Array(length).fill(1);
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
    if (peak > ceiling) wanted[i] = ceiling / peak;
  }
  const lookahead = Math.round(0.005 * rate);
  // Lowest wanted gain within the look-ahead window, so the dip starts early.
  const held = new Float64Array(length).fill(1);
  for (let i = 0; i < length; i++) {
    if (wanted[i] === 1) continue;
    for (let k = Math.max(0, i - lookahead + 1); k <= i; k++) held[k] = Math.min(held[k], wanted[i]);
  }
  const release = Math.exp(-1 / (0.08 * rate));
  const attack = Math.exp(-1 / (0.001 * rate));
  let gain = 1;
  for (let i = 0; i < length; i++) {
    const target = held[i];
    gain = target < gain ? target + (gain - target) * attack : target + (gain - target) * release;
    // Never let the smoothing overshoot the ceiling.
    const g = Math.min(gain, wanted[i]);
    for (const channel of channels) channel[i] *= g;
  }
  return channels;
}

/**
 * Bring a sound to `targetLufs`, then hold its peaks under `ceilingDb`.
 * The limiter lowers loudness a little on very spiky sounds, so the two
 * steps are repeated a few times.
 */
export function master(channels, rate, targetLufs, ceilingDb = -1.5) {
  for (let pass = 0; pass < 4; pass++) {
    const loudness = integratedLoudness(channels, rate);
    const gain = 10 ** ((targetLufs - loudness) / 20);
    if (Math.abs(gain - 1) < 0.01 && peakDb(channels) <= ceilingDb) break;
    for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= gain;
    limit(channels, rate, ceilingDb);
  }
  return channels;
}

/** Encode channels (Float64Arrays in [-1, 1]) as a 16-bit PCM WAV file. */
export function encodeWav(channels, rate) {
  const channelCount = channels.length;
  const frames = channels[0].length;
  const dataSize = frames * channelCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // plain PCM
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const value = Math.max(-1, Math.min(1, channels[c][i]));
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Add a RIFF INFO list (title INAM, artist IART, album IPRD) after the data chunk of a WAV file from encodeWav, the
 * tags Windows Explorer and Lyre's tag reader show. ASCII text only.
 */
export function withInfoTags(wav, { title, artist, album }) {
  const fields = [
    ["INAM", title],
    ["IART", artist],
    ["IPRD", album],
  ].map(([id, text]) => {
    const body = Buffer.from(`${text}\0`, "ascii");
    const padded = Buffer.alloc(body.length + (body.length % 2));
    body.copy(padded);
    const head = Buffer.alloc(8);
    head.write(id, 0, "ascii");
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, padded]);
  });
  const info = Buffer.concat([Buffer.from("INFO", "ascii"), ...fields]);
  const list = Buffer.alloc(8);
  list.write("LIST", 0, "ascii");
  list.writeUInt32LE(info.length, 4);
  const out = Buffer.concat([wav, list, info]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

/** A sample rate as the 80-bit extended number AIFF's COMM chunk holds (whole numbers only). */
function extended80(rate) {
  const out = Buffer.alloc(10);
  const exponent = Math.floor(Math.log2(rate));
  out.writeUInt16BE(16383 + exponent, 0);
  out.writeBigUInt64BE(BigInt(rate) << BigInt(63 - exponent), 2);
  return out;
}

/** Encode channels (Float64Array per channel, -1..1) as a 16-bit AIFF file (big-endian PCM). */
export function encodeAiff(channels, rate) {
  const channelCount = channels.length;
  const frames = channels[0].length;
  const dataSize = frames * channelCount * 2;
  const buffer = Buffer.alloc(12 + 26 + 16 + dataSize);
  buffer.write("FORM", 0, "ascii");
  buffer.writeUInt32BE(buffer.length - 8, 4);
  buffer.write("AIFF", 8, "ascii");
  buffer.write("COMM", 12, "ascii");
  buffer.writeUInt32BE(18, 16);
  buffer.writeUInt16BE(channelCount, 20);
  buffer.writeUInt32BE(frames, 22);
  buffer.writeUInt16BE(16, 26);
  extended80(rate).copy(buffer, 28);
  buffer.write("SSND", 38, "ascii");
  buffer.writeUInt32BE(8 + dataSize, 42);
  buffer.writeUInt32BE(0, 46); // offset
  buffer.writeUInt32BE(0, 50); // block size
  let offset = 54;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      buffer.writeInt16BE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Read a 16-bit PCM WAV file. Throws with a plain message if the header is
 * not the simple form encodeWav writes.
 */
export function decodeWav(buffer) {
  const fail = (why) => {
    throw new Error(`Not a valid 16-bit PCM WAV file: ${why}`);
  };
  if (buffer.length < 44) fail("too short");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") fail("no RIFF/WAVE header");
  if (buffer.readUInt32LE(4) !== buffer.length - 8) fail("RIFF size does not match the file size");
  if (buffer.toString("ascii", 12, 16) !== "fmt " || buffer.readUInt32LE(16) !== 16) fail("no plain fmt chunk");
  const format = buffer.readUInt16LE(20);
  const channelCount = buffer.readUInt16LE(22);
  const rate = buffer.readUInt32LE(24);
  const byteRate = buffer.readUInt32LE(28);
  const blockAlign = buffer.readUInt16LE(32);
  const bits = buffer.readUInt16LE(34);
  if (format !== 1) fail(`format ${format} is not PCM`);
  if (bits !== 16) fail(`${bits} bits per sample`);
  if (channelCount < 1 || channelCount > 2) fail(`${channelCount} channels`);
  if (blockAlign !== channelCount * 2 || byteRate !== rate * blockAlign) fail("inconsistent block size or byte rate");
  if (buffer.toString("ascii", 36, 40) !== "data") fail("no data chunk");
  const dataSize = buffer.readUInt32LE(40);
  if (44 + dataSize > buffer.length || dataSize % blockAlign !== 0) fail("data size does not match");
  const rest = buffer.length - 44 - dataSize;
  if (rest > 0 && (buffer.toString("ascii", 44 + dataSize, 48 + dataSize) !== "LIST" || buffer.readUInt32LE(48 + dataSize) !== rest - 8)) {
    fail("unexpected bytes after the data chunk");
  }
  const frames = dataSize / blockAlign;
  const channels = Array.from({ length: channelCount }, () => new Float64Array(frames));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      channels[c][i] = buffer.readInt16LE(offset) / 32768;
      offset += 2;
    }
  }
  return { rate, channels, seconds: frames / rate };
}
