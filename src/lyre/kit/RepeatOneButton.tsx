/**
 * PLY-17 (round 6 part 3, Nik 6 Nov 12:30: saved with the scene): Repeat one on a scene's track, the same button in
 * the planner and in Live (core.js L.repeatOneButton). Pressed, the track plays again when it ends, every time the
 * scene plays. The hover text says it is saved, unlike On air's Repeat (this play only); a pressed one carries a small
 * dot, as a play order chosen for one place does. A room playing the track hears the change at once.
 */
import React from "react";
import type { SceneAddress } from "../../common/lyre/api";
import { useLyreApi } from "../api";
import { useOptionalLyreAudio } from "../audio";
import { useSave } from "../shell/useSave";
import { Icon } from "./Icon";
import { cx } from "./cx";

export function RepeatOneButton({ scene, sceneName, trackId, name, on, shown }: { scene: SceneAddress; sceneName: string; trackId: string; name: string; on: boolean; shown?: boolean }) {
  const api = useLyreApi();
  const audio = useOptionalLyreAudio();
  const save = useSave();
  const toggle = async () => {
    const done = await save(`${sceneName} · Repeat one ${on ? "off" : "on"}: ${name}`, () => api.sessions.setRepeatOne(scene, trackId, !on), { key: `rep1-${scene.sceneId}-${trackId}` });
    if (done) audio?.savedRepeatOneChanged(scene, trackId);
  };
  return (
    <button
      type="button"
      className={cx("closer rep1", (on || shown) && "shown")}
      aria-pressed={on}
      aria-label={`Repeat one: ${name}`}
      title={on ? "Repeat in this scene (saved): press to stop" : "Repeat in this scene (saved): plays again when it ends, every time this scene plays"}
      onClick={() => void toggle()}
    >
      <Icon name="repeat1" />
      {on && <span className="ord-dot" aria-hidden="true" />}
    </button>
  );
}
