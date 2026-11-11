/**
 * "To: Table ▾" in the header of Scene music, Off script and Pads (live.js toChip): where that box plays. Shown only
 * with two or more rooms; the menu offers each room and All rooms. Scenes always play in the first room.
 */
import React from "react";

import { Icon } from "../../kit/Icon";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { useAnnounce } from "../../shell/Announcer";
import { useBoxTarget, useLive } from "./liveData";
import { BOX_WORDS, boxTarget, type LiveBox } from "./liveModel";
import { updateLive } from "./liveState";

export function ToChip({ box }: { box: LiveBox }) {
  const { rooms } = useLive();
  const { say } = useAnnounce();
  const target = useBoxTarget(box);
  if (rooms.length < 2) return null;
  const choose = (choice: string) => {
    updateLive((s) => ({ to: { ...s.to, [box]: choice } }));
    say(`${BOX_WORDS[box]} now plays in ${boxTarget(rooms, choice).name}`);
  };
  const items = (): PopMenuEntry[] => [
    { group: `${BOX_WORDS[box]} plays in` },
    ...rooms.map(
      (r): PopMenuEntry => ({
        key: r.roomId,
        role: "menuitemradio",
        checked: target.choice === r.roomId,
        content: (
          <>
            {target.choice === r.roomId ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
            {r.name}
          </>
        ),
        onSelect: () => choose(r.roomId),
      }),
    ),
    {
      key: "all",
      role: "menuitemradio",
      checked: target.choice === "all",
      content: (
        <>
          {target.choice === "all" ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
          All rooms
        </>
      ),
      onSelect: () => choose("all"),
    },
  ];
  const shown = target.name.charAt(0).toUpperCase() + target.name.slice(1);
  return (
    <PopMenuButton label={`Where ${BOX_WORDS[box]} plays`} className="lv-to" ariaLabel={`To: ${shown}, choose a room`} title={`Where this box plays: ${target.name}`} items={items}>
      <span className="faint">To:</span> <b className="ellipsis">{shown}</b>
      <Icon name="chevdown" size="s" />
    </PopMenuButton>
  );
}
