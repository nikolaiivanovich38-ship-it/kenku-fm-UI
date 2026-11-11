/**
 * PLY-11: which tracks to keep buffered (ReadAhead.want): the one playing and
 * the one that plays next, by the same rules Next follows. The host maps the
 * track ids to media requests.
 */
import { SequenceStep, stepSequence } from "../../common/domain";
import { currentEntry, QueueState, upNext } from "../queue/queue";

/** In a scene's music (sceneSequence): the step at `at`, then the step Next would play. */
export function upcomingInSequence(sequence: readonly SequenceStep[], at: number): string[] {
  if (sequence.length === 0) {
    return [];
  }
  const steps = [...sequence];
  const current = steps[((at % steps.length) + steps.length) % steps.length].trackId;
  const next = stepSequence(steps, at, 1);
  return distinct([current, next === null ? undefined : steps[next].trackId]);
}

/** In a playlist queue: the current entry, then the next in play order (repeat one keeps the current one). */
export function upcomingInQueue(state: QueueState): string[] {
  const current = currentEntry(state);
  if (!current) {
    return [];
  }
  const next = state.repeat === "one" ? undefined : upNext(state, 1)[0]?.trackId;
  return distinct([current.trackId, next]);
}

function distinct(ids: (string | undefined)[]): string[] {
  return ids.filter((id, index): id is string => id !== undefined && ids.indexOf(id) === index);
}
