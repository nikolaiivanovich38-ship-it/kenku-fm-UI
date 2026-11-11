/**
 * PLY-14: the Audio profile opened from a scene or a session list goes back there. "Back to <scene>" leaves a note
 * here and opens the session planner, which takes it once: the scene opens, and focus goes to the button that opened
 * the Audio profile (the prototype's L.state.openScene).
 */

export interface SceneReturn {
  campaignId: string;
  sessionId: string;
  /** The scene to open; null for the session's own lists. */
  sceneId: string | null;
  /** The track whose Audio profile it was, so its button takes the focus. */
  trackId: string;
}

let pending: SceneReturn | null = null;

/** Leave the note and open the session planner. */
export function returnToSession(back: SceneReturn): void {
  pending = back;
  window.location.hash = `#/session/${back.campaignId}/${back.sessionId}`;
}

/** The note for this session, taken once (null when there is none, or it is for another session). */
export function takeSceneReturn(campaignId: string, sessionId: string): SceneReturn | null {
  const back = pending;
  if (!back || back.campaignId !== campaignId || back.sessionId !== sessionId) return null;
  pending = null;
  return back;
}
