/**
 * DAT-12: the rules of the agreed design, shared by the database layer, the engine and the screens.
 * Ported from the design prototype (design/prototype/src/core.js, views/live.js, views/profile.js),
 * where each rule was tried with the product owner. Pure functions only: no storage, no audio.
 */
import type {
  AudioProfile,
  DomainCampaign,
  DomainLookup,
  DomainPlaylist,
  DomainScene,
  DomainTrack,
  PlaylistRule,
  ProfileOverrides,
  ProfilePlace,
  ProfileSource,
  Room,
  RoomTarget,
  SequenceStep,
  Use,
} from "./types";
import { SHAPE_WORDS } from "./types";

/** FX covers sound effects and stings (short one-shot music cues). */
export function isFx(t: DomainTrack): boolean {
  return t.kind === "fx" || t.role === "sting";
}

/**
 * Whether a track belongs in a dynamic playlist. Every condition must match. A saved condition with no values
 * matches nothing (it can be left empty when its last tag is deleted, and must not widen the playlist to its whole
 * lane); the rule editor previews with withoutEmptyConditions, so a condition still being written is left out.
 */
export function matchesRule(t: DomainTrack, rule: PlaylistRule): boolean {
  if (rule.energy) {
    const e = t.energy ?? 0;
    if (e < rule.energy[0] || e > rule.energy[1]) return false;
  }
  if (rule.leaveOutStings && t.role === "sting") return false;
  if (rule.shapes && rule.shapes.length) {
    const shape = t.shape ?? t.suggestedShape ?? null;
    if (!shape || !rule.shapes.includes(shape)) return false;
  }
  return rule.conds.every((c) => {
    if (c.values.length === 0) return false;
    const have = t.tags[c.group] ?? [];
    const hits = c.values.filter((v) => have.includes(v)).length;
    if (c.match === "all") return hits === c.values.length;
    if (c.match === "none") return hits === 0;
    return hits > 0;
  });
}

/** The rule without conditions that have no values yet: what the rule editor previews while one is being written. */
export function withoutEmptyConditions(rule: PlaylistRule): PlaylistRule {
  return { ...rule, conds: rule.conds.filter((c) => c.values.length > 0) };
}

/** The rule in plain words, for lists and tooltips. groupNames maps tag group ids to their names. */
export function ruleText(rule: PlaylistRule, groupNames: Record<string, string>): string {
  const words = { any: "any of", all: "all of", none: "none of" } as const;
  const parts = rule.conds
    .filter((c) => c.values.length > 0)
    .map((c) => `${groupNames[c.group] ?? c.group} ${words[c.match]} ${c.values.join(", ")}`);
  if (rule.energy) parts.push(`energy ${rule.energy[0]} to ${rule.energy[1]}`);
  if (rule.leaveOutStings) parts.push("no stings");
  if (rule.shapes && rule.shapes.length) parts.push("shape " + rule.shapes.map((s) => SHAPE_WORDS[s].toLowerCase()).join(" or "));
  return parts.join("; ");
}

/** A playlist's tracks: a manual playlist in its own order (missing tracks skipped), a dynamic one by its rule and lane. */
export function playlistTracks(pl: DomainPlaylist, lookup: DomainLookup): DomainTrack[] {
  if (pl.kind === "manual") {
    return pl.trackIds.map((id) => lookup.track(id)).filter((t): t is DomainTrack => t !== undefined);
  }
  const inLane = (t: DomainTrack) => (pl.lane === "fx" ? isFx(t) : t.kind === pl.lane);
  return [...lookup.tracks()].filter((t) => inLane(t) && matchesRule(t, pl.rule));
}

/** The order a scene's music plays in: each track, then each playlist's tracks; afterwards it starts again. */
export function sceneSequence(scene: DomainScene, lookup: DomainLookup): SequenceStep[] {
  const out: SequenceStep[] = [];
  scene.music.forEach((ref, itemIndex) => {
    if (ref.kind === "track") {
      if (lookup.track(ref.id)) out.push({ trackId: ref.id, itemIndex, playlistId: null });
      return;
    }
    const pl = lookup.playlist(ref.id);
    if (!pl) return;
    for (const t of playlistTracks(pl, lookup)) out.push({ trackId: t.id, itemIndex, playlistId: pl.id });
  });
  return out;
}

/**
 * The next (step 1) or previous (step -1) position in a sequence, wrapping round.
 * A track that would play twice in a row is skipped, so Next always changes the music.
 */
export function stepSequence(seq: SequenceStep[], at: number, step: 1 | -1): number | null {
  if (seq.length === 0) return null;
  const wrap = (i: number) => ((i % seq.length) + seq.length) % seq.length;
  const current = seq[wrap(at)].trackId;
  let i = wrap(at);
  for (let n = 0; n < seq.length; n++) {
    i = wrap(i + step);
    if (seq[i].trackId !== current) return i;
  }
  return wrap(at + step);
}

/** A place written as a key: "pl:<playlistId>", "sc:<campaignId>:<sessionId>:<sceneId>" or "ss:<campaignId>:<sessionId>". */
export function placeKey(p: ProfilePlace): string {
  if (p.kind === "playlist") return `pl:${p.playlistId}`;
  if (p.kind === "session") return `ss:${p.campaignId}:${p.sessionId}`;
  return `sc:${p.campaignId}:${p.sessionId}:${p.sceneId}`;
}

export function parsePlaceKey(key: string): ProfilePlace | null {
  const parts = key.split(":");
  if (parts[0] === "pl" && parts.length === 2 && parts[1]) return { kind: "playlist", playlistId: parts[1] };
  if (parts[0] === "sc" && parts.length === 4 && parts.every(Boolean)) return { kind: "scene", campaignId: parts[1], sessionId: parts[2], sceneId: parts[3] };
  if (parts[0] === "ss" && parts.length === 3 && parts.every(Boolean)) return { kind: "session", campaignId: parts[1], sessionId: parts[2] };
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The audio profile that applies to a track in the given places, most specific first: pass the scene (or session)
 * before the playlist (profilePlacesFor gives them in that order). The first place with its own settings wins; otherwise the track's own profile. Missing fields take
 * defaults: the whole track, looping when the track loops well, no fades. Points are kept inside the track.
 */
export function resolveProfile(t: DomainTrack, places: ProfilePlace[], overrides: ProfileOverrides): { profile: AudioProfile; source: ProfileSource } {
  let input = t.profile ?? {};
  let source: ProfileSource = "track";
  for (const p of places) {
    const own = overrides[placeKey(p)]?.[t.id];
    if (own) {
      input = own;
      source = p.kind;
      break;
    }
  }
  const dur = Math.max(0, t.durationMs);
  const startMs = clamp(input.startMs ?? 0, 0, dur);
  const endMs = clamp(input.endMs ?? dur, startMs, dur);
  const after = input.after ?? (t.loop === "yes" || t.loop === "crossfade" ? "loop" : "next");
  const loopStartMs = clamp(input.loopStartMs ?? startMs, startMs, Math.max(startMs, endMs - 1));
  const fade = (f: { ms: number; shape: number } | undefined) => ({ ms: clamp(f?.ms ?? 0, 0, endMs - startMs), shape: clamp(f?.shape ?? 50, 0, 100) });
  return {
    profile: {
      startMs,
      endMs,
      after,
      loopStartMs,
      // At most half the looped part, so no more than two copies of the track ever sound at once.
      loopCrossfadeMs: clamp(input.loopCrossfadeMs ?? 0, 0, (endMs - loopStartMs) / 2),
      fadeIn: fade(input.fadeIn),
      fadeOut: fade(input.fadeOut),
      markers: (input.markers ?? []).filter((m) => m.atMs >= 0 && m.atMs <= dur),
    },
    source,
  };
}

/** How long one pass of the track plays, from Start to End. */
export function playedLengthMs(p: AudioProfile): number {
  return p.endMs - p.startMs;
}

/** Fade intensity names: Gentle 0-35, Even 36-64 (a straight line), Sharp 65-100. */
export function shapeName(shape: number): "Gentle" | "Even" | "Sharp" {
  return shape <= 35 ? "Gentle" : shape < 65 ? "Even" : "Sharp";
}

/** Gain during a fade out, u = how far through the fade (0 to 1). Gentle eases off early with a long quiet tail; sharp holds, then drops. */
export function fadeOutGain(u: number, shape: number): number {
  const x = clamp(u, 0, 1);
  const s = shape / 100;
  if (s <= 0.35) return Math.pow(1 - x, 1.5 + ((0.35 - s) / 0.35) * 2.5);
  if (s >= 0.65) return 1 - Math.pow(x, 1.5 + ((s - 0.65) / 0.35) * 2.5);
  return 1 - x;
}

/** Gain during a fade in: the fade out played backwards. */
export function fadeInGain(u: number, shape: number): number {
  return fadeOutGain(1 - u, shape);
}

/** The volume envelope at a position: the fade in after Start (not again after a loop) and the fade out before End. */
export function envelopeAt(p: AudioProfile, posMs: number, looped: boolean): number {
  if (posMs < p.startMs || posMs > p.endMs) return 1;
  let v = 1;
  if (!looped && p.fadeIn.ms > 0 && posMs < p.startMs + p.fadeIn.ms) v *= fadeInGain((posMs - p.startMs) / p.fadeIn.ms, p.fadeIn.shape);
  if (p.fadeOut.ms > 0 && posMs > p.endMs - p.fadeOut.ms) v *= fadeOutGain((posMs - (p.endMs - p.fadeOut.ms)) / p.fadeOut.ms, p.fadeOut.shape);
  return v;
}

/** Where a playlist is used: the whole campaign, a session, or a scene (as music or ambience). */
export function usesOfPlaylist(id: string, campaigns: DomainCampaign[]): Use[] {
  const out: Use[] = [];
  for (const c of campaigns) {
    if (c.playlistIds.includes(id)) out.push({ level: "campaign", campaignId: c.id });
    for (const s of c.sessions) {
      if (s.playlistIds.includes(id)) out.push({ level: "session", campaignId: c.id, sessionId: s.id });
      for (const sc of s.scenes) {
        sc.music.forEach((r, position) => {
          if (r.kind === "playlist" && r.id === id) out.push({ level: "scene", campaignId: c.id, sessionId: s.id, sceneId: sc.id, role: "music", position });
        });
        if (sc.ambience?.kind === "playlist" && sc.ambience.id === id) out.push({ level: "scene", campaignId: c.id, sessionId: s.id, sceneId: sc.id, role: "ambience", position: 0 });
      }
    }
  }
  return out;
}

/** Where a pad board is used. */
export function usesOfBoard(id: string, campaigns: DomainCampaign[]): Use[] {
  const out: Use[] = [];
  for (const c of campaigns) {
    if (c.boardIds.includes(id)) out.push({ level: "campaign", campaignId: c.id });
    for (const s of c.sessions) {
      if (s.boardIds.includes(id)) out.push({ level: "session", campaignId: c.id, sessionId: s.id });
      for (const sc of s.scenes) {
        sc.boardIds.forEach((b, position) => {
          if (b === id) out.push({ level: "scene", campaignId: c.id, sessionId: s.id, sceneId: sc.id, role: "board", position });
        });
      }
    }
  }
  return out;
}

/** Where a track is used directly (not through a playlist): kept on hand in a campaign or session (ORG-12), or in scenes. */
export function usesOfTrack(id: string, campaigns: DomainCampaign[]): Use[] {
  const out: Use[] = [];
  for (const c of campaigns) {
    if (c.trackIds?.includes(id)) out.push({ level: "campaign", campaignId: c.id });
    for (const s of c.sessions) {
      if (s.trackIds?.includes(id)) out.push({ level: "session", campaignId: c.id, sessionId: s.id });
      for (const sc of s.scenes) {
        sc.music.forEach((r, position) => {
          if (r.kind === "track" && r.id === id) out.push({ level: "scene", campaignId: c.id, sessionId: s.id, sceneId: sc.id, role: "music", position });
        });
        if (sc.ambience?.kind === "track" && sc.ambience.id === id) out.push({ level: "scene", campaignId: c.id, sessionId: s.id, sceneId: sc.id, role: "ambience", position: 0 });
      }
    }
  }
  return out;
}

/** The rooms an action's sound goes to. A room that has gone falls back to the first room. */
export function roomsFor(target: RoomTarget, rooms: Room[]): string[] {
  if (rooms.length === 0) return [];
  if (target === "all") return rooms.map((r) => r.botId);
  return rooms.some((r) => r.botId === target.room) ? [target.room] : [rooms[0].botId];
}

/** Scenes always start in the first room (the table). */
export function sceneRoom(rooms: Room[]): string | null {
  return rooms.length ? rooms[0].botId : null;
}
