/**
 * PLY-13 the play order button, the same everywhere a playlist is shown (views/_shared.js L.orderButton, orderMenu):
 * two small icons, shuffle (or in order) and repeat (all, one, or faded for none), and a menu to change them.
 *
 * `place` is where the button is shown: a scene, a session list or a campaign list, whose choice applies only there;
 * null is the playlist's own order (the Playlists page), used wherever a place has made no choice. A place with its
 * own order has the accent edge and dot. The menu stays open on the item after a choice, so shuffle and repeat can
 * both be changed; the live region says the new order and where. Reads and writes through LyreApi's play order
 * calls (playlists.playOrders, setPlayOrder, clearPlayOrder); the words come from the domain (orderWords,
 * orderPlaceWords).
 */
import React from "react";

import { orderPlaceWords, orderWords, resolvePlayOrder, type PlayOrder, type Repeat, type UsePlace } from "../../common/domain";
import { isRefused } from "../../common/lyre/api";
import { useLyreApi } from "../api";
import { useAnnounce } from "../shell/Announcer";
import { Icon, type IconName } from "./Icon";
import { cx } from "./cx";
import { playOrderIn, playOrderStoreOf, usePlayOrders } from "./playOrders";
import { usePlaceNames } from "./placeNames";
import { PopMenuButton, TwoLines, type PopMenuEntry } from "./PopMenu";

export interface PlayOrderButtonProps {
  playlistId: string;
  /** Where it is shown; null for the playlist's own order. */
  place: UsePlace | null;
}

const REPEAT_CHOICES: { repeat: Repeat; label: string; icon: IconName; hint: (inScene: boolean) => string }[] = [
  { repeat: "off", label: "No repeat", icon: "right", hint: (inScene) => (inScene ? "After its last track the scene moves on" : "Stops after its last track") },
  { repeat: "all", label: "Repeat all", icon: "loop", hint: () => "Starts again after its last track" },
  { repeat: "one", label: "Repeat one", icon: "repeat1", hint: () => "The track playing repeats until you press Next" },
];

export function PlayOrderButton({ playlistId, place }: PlayOrderButtonProps) {
  const api = useLyreApi();
  const data = usePlayOrders();
  const names = usePlaceNames();
  const { say, toast } = useAnnounce();
  const playlist = data?.playlists.get(playlistId);
  if (!data || !playlist) return null;

  const { order, source, elsewhere } = playOrderIn(data, playlistId, place);
  const own = !!place && source === "place";
  const where = orderPlaceWords(place, names);
  const words = orderWords(order);
  const store = playOrderStoreOf(api);

  const choose = async (next: PlayOrder) => {
    store.put(playlistId, place, next);
    const result = await api.playlists.setPlayOrder(playlistId, place, next);
    if (isRefused(result)) {
      toast(result.refusal.message);
      store.load();
      return;
    }
    say(`${orderWords(result.value)} ${where}`);
  };
  const backToOwn = async () => {
    store.put(playlistId, place, null);
    const result = await api.playlists.clearPlayOrder(playlistId, place);
    if (isRefused(result)) {
      toast(result.refusal.message);
      store.load();
      return;
    }
    // What now applies here: the playlist's own order, or the default for this kind of place.
    say(`Uses the playlist's own order here: ${orderWords(resolvePlayOrder(playlistId, playlist.order, place, {}).order)}`);
  };

  const items = (): PopMenuEntry[] => [
    { group: place ? `Play order ${where}` : "Play order of this playlist" },
    {
      key: "shuffle",
      role: "menuitemcheckbox",
      checked: order.shuffle,
      keepOpen: true,
      content: (
        <>
          <Icon name={order.shuffle ? "check" : "shuffle"} size="s" />
          Shuffle
        </>
      ),
      onSelect: () => void choose({ ...order, shuffle: !order.shuffle }),
    },
    { separator: true },
    ...REPEAT_CHOICES.map(
      (c): PopMenuEntry => ({
        key: c.repeat,
        role: "menuitemradio",
        checked: order.repeat === c.repeat,
        keepOpen: true,
        content: <TwoLines icon={order.repeat === c.repeat ? "check" : c.icon} first={c.label} second={c.hint(place?.kind === "scene")} />,
        onSelect: () => void choose({ ...order, repeat: c.repeat }),
      }),
    ),
    { separator: true },
    {
      note: !place
        ? "Scenes, sessions and campaigns can have their own."
        : own
          ? `Only ${where}. Elsewhere: ${orderWords(elsewhere)}.`
          : `Uses the playlist's own order. A change here applies only ${where}.`,
    },
    ...(own
      ? [
          {
            key: "own",
            content: (
              <>
                <Icon name="restart" size="s" />
                Use the playlist&apos;s own order here
              </>
            ),
            onSelect: () => void backToOwn(),
          } satisfies PopMenuEntry,
        ]
      : []),
  ];

  return (
    <PopMenuButton
      label="Play order"
      className={cx("btn", "s", "ord", own && "own")}
      ariaLabel={`Play order of ${playlist.name}: ${words}`}
      title={`Play order ${where}: ${words}${place && !own ? " (the playlist's own)" : ""}`}
      items={items}
    >
      <Icon name={order.shuffle ? "shuffle" : "inorder"} size="s" />
      <Icon name={order.repeat === "one" ? "repeat1" : "loop"} size="s" className={cx("ord-rep", order.repeat === "off" && "off")} />
      {own && <span className="ord-dot" aria-hidden="true" />}
    </PopMenuButton>
  );
}
