/**
 * Checks for the design's structured values (DAT-11): audio profiles and
 * dynamic playlist rules, given in the shared domain shapes and stored as rows
 * (audio_profiles, rule_conditions …). Like validate.ts, nothing is trusted:
 * unknown keys are refused, and the clean value keeps only what was given,
 * because a missing profile field means "use the default" (resolveProfile in
 * src/common/domain). The checks match the tables' CHECK constraints, so a bad
 * value is reported in plain words before the database would refuse it.
 */
import { TRACK_SHAPES, type AudioProfileInput, type Fade, type PlaylistRule, type TagCondition } from "../../common/domain";
import { ValidationError } from "./errors";
import * as v from "./validate";

const PROFILE_KEYS = ["startMs", "endMs", "after", "loopStartMs", "loopCrossfadeMs", "fadeIn", "fadeOut", "markers"] as const;
const AFTER_END = ["loop", "next", "stop"] as const;
const MATCHES = ["any", "all", "none"] as const;
/** Generous limits that keep one profile or rule small. */
const MAX_MARKERS = 500;
const MAX_CONDITIONS = 50;
const MAX_VALUES = 200;

function onlyKeys(field: string, input: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(`${field}.${key}`, `${field} has no setting called "${key}".`);
  }
}

function list(field: string, value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(field, `${field} must be a list.`);
  if (value.length > max) throw new ValidationError(field, `${field} can hold at most ${max} entries.`);
  return value;
}

function fade(field: string, value: unknown): Fade {
  const input = v.record(field, value);
  onlyKeys(field, input, ["ms", "shape"]);
  return { ms: v.milliseconds(`${field}.ms`, input.ms), shape: v.numberInRange(`${field}.shape`, input.shape, 0, 100) };
}

/** A checked audio profile: only the given fields, each in range. */
export function cleanProfile(field: string, value: unknown): AudioProfileInput {
  const input = v.record(field, value);
  onlyKeys(field, input, PROFILE_KEYS);
  const clean: AudioProfileInput = {};
  for (const key of ["startMs", "endMs", "loopStartMs", "loopCrossfadeMs"] as const) {
    if (input[key] !== undefined) clean[key] = v.milliseconds(`${field}.${key}`, input[key]);
  }
  if (input.after !== undefined) clean.after = v.oneOf(`${field}.after`, input.after, AFTER_END);
  if (input.fadeIn !== undefined) clean.fadeIn = fade(`${field}.fadeIn`, input.fadeIn);
  if (input.fadeOut !== undefined) clean.fadeOut = fade(`${field}.fadeOut`, input.fadeOut);
  if (input.markers !== undefined) {
    clean.markers = list(`${field}.markers`, input.markers, MAX_MARKERS).map((marker, index) => {
      const m = v.record(`${field}.markers[${index}]`, marker);
      onlyKeys(`${field}.markers[${index}]`, m, ["atMs", "label", "mix"]);
      if (typeof m.label !== "string") throw new ValidationError(`${field}.markers[${index}].label`, "A marker needs a label (it may be empty).");
      const out: { atMs: number; label: string; mix?: boolean } = { atMs: v.milliseconds(`${field}.markers[${index}].atMs`, m.atMs), label: v.optionalText("label", m.label, v.MAX_NAME_LENGTH) };
      // DAT-3: the mix-out point, where the next track crossfades in.
      if (m.mix !== undefined && v.boolean(`${field}.markers[${index}].mix`, m.mix)) out.mix = true;
      return out;
    });
    if (clean.markers.filter((m) => m.mix).length > 1) throw new ValidationError(`${field}.markers`, "A track has one mix-out marker: choose one.");
  }
  const { startMs, endMs, loopStartMs } = clean;
  if (startMs !== undefined && endMs !== undefined && startMs >= endMs) {
    throw new ValidationError(`${field}.endMs`, "The end must come after the start.");
  }
  if (loopStartMs !== undefined && endMs !== undefined && loopStartMs >= endMs) {
    throw new ValidationError(`${field}.loopStartMs`, "The loop must start before the end.");
  }
  if (loopStartMs !== undefined && startMs !== undefined && loopStartMs < startMs) {
    throw new ValidationError(`${field}.loopStartMs`, "The loop cannot start before the start.");
  }
  return clean;
}

/** A checked dynamic playlist rule. Tag groups are checked by the caller (they live in the database). */
export function cleanRule(field: string, value: unknown): PlaylistRule {
  const input = v.record(field, value);
  onlyKeys(field, input, ["conds", "energy", "leaveOutStings", "shapes"]);
  const conds: TagCondition[] = list(`${field}.conds`, input.conds, MAX_CONDITIONS).map((cond, index) => {
    const name = `${field}.conds[${index}]`;
    const c = v.record(name, cond);
    onlyKeys(name, c, ["group", "match", "values"]);
    return {
      group: v.id(`${name}.group`, c.group),
      match: v.oneOf(`${name}.match`, c.match, MATCHES),
      values: list(`${name}.values`, c.values, MAX_VALUES).map((tag, i) => v.requiredName(`${name}.values[${i}]`, tag)),
    };
  });
  const rule: PlaylistRule = { conds };
  if (input.energy !== undefined) {
    const range = list(`${field}.energy`, input.energy, 2);
    if (range.length !== 2) throw new ValidationError(`${field}.energy`, "The energy range needs a lowest and a highest value.");
    const low = v.integer(`${field}.energy`, range[0], 0, 5);
    const high = v.integer(`${field}.energy`, range[1], 0, 5);
    if (low > high) throw new ValidationError(`${field}.energy`, "The lowest energy cannot be above the highest.");
    rule.energy = [low, high];
  }
  if (input.leaveOutStings !== undefined) rule.leaveOutStings = v.boolean(`${field}.leaveOutStings`, input.leaveOutStings);
  // DAT-13: the shapes the rule asks for; none (or an empty list) means any shape.
  if (input.shapes !== undefined) {
    const shapes = [...new Set(list(`${field}.shapes`, input.shapes, TRACK_SHAPES.length).map((s, i) => v.oneOf(`${field}.shapes[${i}]`, s, TRACK_SHAPES)))];
    if (shapes.length > 0) rule.shapes = shapes;
  }
  return rule;
}
