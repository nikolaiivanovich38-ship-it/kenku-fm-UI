/**
 * Security review of wave 4, Must 1: whether the first bytes of a file are the audio format its extension names.
 * A .lyre file comes from someone else, so before Lyre unpacks an audio part it checks that the part starts the way
 * a file of that kind starts. A program, a script, a shortcut or an archive under an audio name is left out.
 *
 * The rules cover every extension in AUDIO_EXTENSIONS (hostileFile.test.ts checks that none is missing). They follow
 * each format's published header; formats made of frames with no file header (MP3, AAC, AC-3) may start with an
 * ID3 tag, and a few MP3 files start after some zero bytes, which are passed over.
 */

/** How many first bytes the check reads. */
export const AUDIO_HEAD_BYTES = 4096;

const ascii = (head: Buffer, at: number, text: string) => head.length >= at + text.length && head.toString("latin1", at, at + text.length) === text;
const bytes = (head: Buffer, at: number, values: readonly number[]) => head.length >= at + values.length && values.every((v, i) => head[at + i] === v);

const ASF = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11];
const id3 = (head: Buffer) => ascii(head, 0, "ID3");

/** Where the data starts once leading zero bytes are passed over (some MP3 encoders pad the start). */
function afterZeros(head: Buffer): number {
  let at = 0;
  while (at < head.length && head[at] === 0) at++;
  return at;
}

/** An MPEG audio frame header: 11 sync bits, a valid version and layer, and a bit rate that is not "bad". */
function mpegFrame(head: Buffer, at: number): boolean {
  if (head.length < at + 3 || head[at] !== 0xff || (head[at + 1] & 0xe0) !== 0xe0) return false;
  const version = (head[at + 1] >> 3) & 0x03;
  const layer = (head[at + 1] >> 1) & 0x03;
  const bitrate = head[at + 2] >> 4;
  return version !== 0x01 && layer !== 0x00 && bitrate !== 0x0f;
}

/** An AAC ADTS frame header: 12 sync bits and layer 0. */
const adts = (head: Buffer, at: number) => head.length >= at + 2 && head[at] === 0xff && (head[at + 1] & 0xf6) === 0xf0;

const RULES: Record<string, (head: Buffer) => boolean> = {
  ".flac": (h) => ascii(h, 0, "fLaC") || id3(h),
  ".mp3": (h) => id3(h) || mpegFrame(h, afterZeros(h)),
  ".wav": (h) => (ascii(h, 0, "RIFF") || ascii(h, 0, "RF64") || ascii(h, 0, "BW64")) && ascii(h, 8, "WAVE"),
  ".ogg": (h) => ascii(h, 0, "OggS"),
  ".oga": (h) => ascii(h, 0, "OggS"),
  ".opus": (h) => ascii(h, 0, "OggS"),
  ".m4a": (h) => ascii(h, 4, "ftyp"),
  ".aac": (h) => id3(h) || ascii(h, 0, "ADIF") || adts(h, 0),
  ".wma": (h) => bytes(h, 0, ASF),
  ".asf": (h) => bytes(h, 0, ASF),
  ".aif": (h) => ascii(h, 0, "FORM") && (ascii(h, 8, "AIFF") || ascii(h, 8, "AIFC")),
  ".aiff": (h) => ascii(h, 0, "FORM") && (ascii(h, 8, "AIFF") || ascii(h, 8, "AIFC")),
  ".aifc": (h) => ascii(h, 0, "FORM") && (ascii(h, 8, "AIFF") || ascii(h, 8, "AIFC")),
  ".mka": (h) => bytes(h, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  ".ape": (h) => ascii(h, 0, "MAC ") || id3(h),
  ".wv": (h) => ascii(h, 0, "wvpk"),
  ".tta": (h) => ascii(h, 0, "TTA1") || id3(h),
  ".ac3": (h) => bytes(h, 0, [0x0b, 0x77]) || id3(h),
  ".mpc": (h) => ascii(h, 0, "MPCK") || ascii(h, 0, "MP+") || id3(h),
};

/** True when `head` (a file's first bytes) starts the way a file with extension `ext` (".mp3") starts. */
export function looksLikeAudio(ext: string, head: Buffer): boolean {
  const rule = Object.prototype.hasOwnProperty.call(RULES, ext.toLowerCase()) ? RULES[ext.toLowerCase()] : undefined;
  return !!rule && head.length > 0 && rule(head);
}
