/**
 * PLY-10, BUG-11: the play queue and its next / previous / end-of-track rules,
 * in one place, as pure functions over an immutable state. No browser APIs, no
 * timers: the playback side asks `navigate` what to do and acts on the answer.
 *
 * The current entry is remembered by its entry id, never by a position, so
 * adding, removing or reordering other entries cannot change it (the old
 * reducer kept a position into a shuffled order, which caused BUG-11).
 *
 * Entries have their own ids, separate from track ids, so the same track can
 * be queued twice (Now Playing, PLY-1).
 */

export type RepeatMode = "off" | "one" | "all";

export interface QueueEntry {
  /** Unique within the queue. */
  readonly entryId: string;
  /** The library track this entry plays. */
  readonly trackId: string;
}

export interface QueueState {
  /** The list as the user arranged it. */
  readonly entries: readonly QueueEntry[];
  /** Entry ids in play order: the same as `entries` with shuffle off, a shuffled order with it on. */
  readonly order: readonly string[];
  /** The entry that is playing (or would play on Play), or null when there is none. */
  readonly currentId: string | null;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
}

/** A source of random numbers in [0, 1), like Math.random. Tests pass a seeded one. */
export type Random = () => number;

export type NavigationAction = "next" | "previous" | "ended";

export type NavigationOutcome =
  /** Start this entry (a different one from before). */
  | { kind: "play"; entryId: string }
  /** Play the current entry again from the start. */
  | { kind: "restart"; entryId: string }
  /** Stop playing; the current entry stays, so Play starts it again. */
  | { kind: "stop" };

/** "Previous" restarts the current track instead once it has played this long. */
export const RESTART_THRESHOLD_SECONDS = 5;

export function makeEntries(trackIds: readonly string[], newEntryId: (trackId: string, index: number) => string): QueueEntry[] {
  return trackIds.map((trackId, index) => ({ entryId: newEntryId(trackId, index), trackId }));
}

export function createQueue(options: {
  entries: readonly QueueEntry[];
  startEntryId?: string;
  repeat: RepeatMode;
  shuffle: boolean;
  random?: Random;
}): QueueState {
  const { entries, repeat, shuffle, random = Math.random } = options;
  assertUniqueIds(entries);
  const start = entries.find((entry) => entry.entryId === options.startEntryId) ?? entries[0];
  const state: QueueState = {
    entries: [...entries],
    order: entries.map((entry) => entry.entryId),
    currentId: start?.entryId ?? null,
    repeat,
    shuffle: false,
  };
  return shuffle ? setShuffle(state, true, random) : state;
}

export function currentEntry(state: QueueState): QueueEntry | null {
  return findEntry(state, state.currentId);
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return state.repeat === repeat ? state : { ...state, repeat };
}

/**
 * Turning shuffle on keeps the current entry and puts it first in a new
 * shuffled order; turning it off plays on in list order from the current entry.
 */
export function setShuffle(state: QueueState, shuffle: boolean, random: Random = Math.random): QueueState {
  if (state.shuffle === shuffle) {
    return state;
  }
  if (!shuffle) {
    return { ...state, shuffle, order: state.entries.map((entry) => entry.entryId) };
  }
  const current = currentEntry(state);
  const rest = state.entries.filter((entry) => entry !== current);
  const shuffled = shuffleWithoutRepeats(rest, current?.trackId ?? null, random);
  return {
    ...state,
    shuffle,
    order: [...(current ? [current.entryId] : []), ...shuffled.map((entry) => entry.entryId)],
  };
}

/**
 * Decide what next, previous or the end of a track does. Returns the new state
 * and what the player should do. Rules (see docs/playback-engine.md):
 * - repeat one: every action restarts the current entry;
 * - previous after RESTART_THRESHOLD_SECONDS restarts the current entry;
 * - past either end: repeat off stops, repeat all wraps around (a shuffled
 *   queue draws a new order for the next round that does not start with the
 *   track that just played);
 * - landing on the current entry again (a one-entry queue) restarts it.
 */
export function navigate(
  state: QueueState,
  action: NavigationAction,
  { positionSeconds, random = Math.random }: { positionSeconds: number; random?: Random },
): { state: QueueState; outcome: NavigationOutcome } {
  const current = currentEntry(state);
  if (!current) {
    return { state, outcome: { kind: "stop" } };
  }
  const restart = { state, outcome: { kind: "restart", entryId: current.entryId } as NavigationOutcome };
  if (state.repeat === "one") {
    return restart;
  }
  if (action === "previous" && positionSeconds >= RESTART_THRESHOLD_SECONDS) {
    return restart;
  }

  const position = state.order.indexOf(current.entryId);
  let next = state;
  let target = position + (action === "previous" ? -1 : 1);
  if (target < 0 || target >= state.order.length) {
    if (state.repeat === "off") {
      return { state, outcome: { kind: "stop" } };
    }
    if (target < 0) {
      target = state.order.length - 1;
    } else {
      target = 0;
      if (state.shuffle) {
        // A new round: reshuffle so a long session does not repeat one order,
        // and never open the round with the track that just played.
        const order = shuffleWithoutRepeats(state.entries, current.trackId, random).map((entry) => entry.entryId);
        next = { ...state, order };
      }
    }
  }

  const entryId = next.order[target];
  if (entryId === current.entryId) {
    return { state: next, outcome: { kind: "restart", entryId } };
  }
  return { state: { ...next, currentId: entryId }, outcome: { kind: "play", entryId } };
}

/** Make a queued entry current (the user picked it). Unknown ids change nothing. */
export function jumpTo(state: QueueState, entryId: string): QueueState {
  return findEntry(state, entryId) ? { ...state, currentId: entryId } : state;
}

/**
 * Remove entries. When the current entry goes, the entry that would have
 * played next becomes current (wrapping only with repeat all); the player
 * decides whether to start it. Other entries never change the current one.
 */
export function remove(state: QueueState, entryIds: readonly string[]): QueueState {
  const removed = new Set(entryIds.filter((id) => findEntry(state, id)));
  if (removed.size === 0) {
    return state;
  }
  let currentId = state.currentId;
  if (currentId !== null && removed.has(currentId)) {
    currentId = nextSurvivor(state, currentId, removed);
  }
  return {
    ...state,
    entries: state.entries.filter((entry) => !removed.has(entry.entryId)),
    order: state.order.filter((id) => !removed.has(id)),
    currentId,
  };
}

/** Remove every entry of a track, e.g. when it is deleted from the library. */
export function removeTrack(state: QueueState, trackId: string): QueueState {
  return remove(
    state,
    state.entries.filter((entry) => entry.trackId === trackId).map((entry) => entry.entryId),
  );
}

/**
 * Move an entry to `toIndex` in the list. With shuffle off the play order
 * follows the list; with shuffle on the play order is left as it is, so a
 * shuffled queue stays stable while the user tidies the list.
 */
export function move(state: QueueState, entryId: string, toIndex: number): QueueState {
  const entry = findEntry(state, entryId);
  if (!entry) {
    return state;
  }
  const entries = state.entries.filter((e) => e !== entry);
  entries.splice(clamp(toIndex, 0, entries.length), 0, entry);
  return {
    ...state,
    entries,
    order: state.shuffle ? state.order : entries.map((e) => e.entryId),
  };
}

/**
 * Add entries straight after the current one ("next") or after everything
 * ("end"), in both the list and the play order. An empty queue makes the first
 * new entry current.
 */
export function insert(state: QueueState, added: readonly QueueEntry[], where: "next" | "end"): QueueState {
  assertUniqueIds([...state.entries, ...added]);
  if (added.length === 0) {
    return state;
  }
  const ids = added.map((entry) => entry.entryId);
  const entries = [...state.entries];
  const order = [...state.order];
  if (where === "next" && state.currentId !== null) {
    entries.splice(entries.findIndex((e) => e.entryId === state.currentId) + 1, 0, ...added);
    order.splice(order.indexOf(state.currentId) + 1, 0, ...ids);
  } else {
    entries.push(...added);
    order.push(...ids);
  }
  return { ...state, entries, order, currentId: state.currentId ?? ids[0] };
}

/** Up to `count` entries that will play after the current one. */
export function upNext(state: QueueState, count: number): QueueEntry[] {
  const position = state.currentId === null ? -1 : state.order.indexOf(state.currentId);
  const result: QueueEntry[] = [];
  for (let step = 1; step < state.order.length && result.length < count; step++) {
    let index = position + step;
    if (index >= state.order.length) {
      if (state.repeat !== "all") {
        break;
      }
      index -= state.order.length;
    }
    result.push(findEntry(state, state.order[index])!);
  }
  return result;
}

/**
 * Shuffle so that no two entries of the same track are side by side, and the
 * first is not `previousTrackId`, whenever that is possible. Repeats are
 * accepted only when nothing else is left (e.g. one track queued three times).
 *
 * At each step a track that needs every other remaining slot must go now;
 * otherwise any entry whose track differs from the last one is picked at random.
 */
export function shuffleWithoutRepeats(
  entries: readonly QueueEntry[],
  previousTrackId: string | null,
  random: Random,
): QueueEntry[] {
  const remaining = [...entries];
  const result: QueueEntry[] = [];
  let last = previousTrackId;
  while (remaining.length > 0) {
    const counts = new Map<string, number>();
    for (const entry of remaining) {
      counts.set(entry.trackId, (counts.get(entry.trackId) ?? 0) + 1);
    }
    let forced: string | null = null;
    for (const [trackId, count] of counts) {
      if (trackId !== last && count * 2 > remaining.length) {
        forced = trackId;
      }
    }
    let candidates = remaining.filter((entry) => (forced !== null ? entry.trackId === forced : entry.trackId !== last));
    if (candidates.length === 0) {
      candidates = remaining;
    }
    const pick = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    remaining.splice(remaining.indexOf(pick), 1);
    result.push(pick);
    last = pick.trackId;
  }
  return result;
}

function nextSurvivor(state: QueueState, fromId: string, removed: ReadonlySet<string>): string | null {
  const position = state.order.indexOf(fromId);
  for (let step = 1; step < state.order.length; step++) {
    let index = position + step;
    if (index >= state.order.length) {
      if (state.repeat !== "all") {
        return null;
      }
      index -= state.order.length;
    }
    if (!removed.has(state.order[index])) {
      return state.order[index];
    }
  }
  return null;
}

function findEntry(state: QueueState, entryId: string | null): QueueEntry | null {
  return entryId === null ? null : (state.entries.find((entry) => entry.entryId === entryId) ?? null);
}

function assertUniqueIds(entries: readonly QueueEntry[]) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.entryId)) {
      throw new Error(`Duplicate entry id in queue: ${entry.entryId}`);
    }
    seen.add(entry.entryId);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
