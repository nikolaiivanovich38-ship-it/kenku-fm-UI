/**
 * PLY-13: one play order button wherever a playlist is shown (views/_shared.js L.orderButton, orderMenu): shuffle and
 * repeat as two small icons, a menu to change them for that place only, and "Use the playlist's own order here".
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UsePlace } from "../../common/domain";
import type { LyreApi } from "../../common/lyre/api";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
import { AnnouncerProvider } from "../shell/Announcer";
import { expectNoAxeViolations } from "../test/axe";
import { PlayOrderButton } from "./PlayOrderButton";

const ruins: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
const crown: UsePlace = { kind: "campaign", campaignId: "crown" };

function show(ui: React.ReactNode, api: LyreApi = createFakeLyreApi()) {
  render(
    <LyreApiProvider api={api}>
      <AnnouncerProvider>{ui}</AnnouncerProvider>
    </LyreApiProvider>,
  );
  return api;
}

const said = () => document.getElementById("lyre-live")?.textContent ?? "";

describe("the button", () => {
  it("says the play order where it is shown, with shuffle and repeat as two icons", async () => {
    show(<PlayOrderButton playlistId="p-company" place={crown} />);
    const button = await screen.findByRole("button", { name: "Play order of The Company themes: In order, repeat all" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("title", "Play order in The Sunken Crown: In order, repeat all (the playlist's own)");
    expect(button.querySelectorAll("svg")).toHaveLength(2);
    expect(button).not.toHaveClass("own");
    expect(button.querySelector(".ord-dot")).toBeNull();
  });

  it("a place with its own order has the accent edge and dot", async () => {
    show(<PlayOrderButton playlistId="p-abbey-eerie" place={ruins} />);
    const button = await screen.findByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" });
    expect(button).toHaveClass("ord", "own");
    expect(button.querySelector(".ord-dot")).not.toBeNull();
    expect(button).toHaveAttribute("title", "Play order in the scene The abbey ruins: Shuffle, no repeat");
    // No repeat shows its repeat icon faded.
    expect(button.querySelector(".ord-rep")).toHaveClass("off");
  });

  it("the same playlist elsewhere keeps its own order: a scene's choice stays in the scene", async () => {
    show(<PlayOrderButton playlistId="p-abbey-eerie" place={{ ...ruins, sceneId: "sc4" }} />);
    await screen.findByRole("button", { name: "Play order of Abbey: eerie, low energy: In order, no repeat" });
  });

  it("shows nothing for a playlist that is not in the library", async () => {
    const { container } = render(
      <LyreApiProvider api={createFakeLyreApi()}>
        <PlayOrderButton playlistId="nope" place={null} />
      </LyreApiProvider>,
    );
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the menu", () => {
  it("in a scene: Shuffle, the three repeats with what each does, where it applies, and the way back to the playlist's own order", async () => {
    show(<PlayOrderButton playlistId="p-abbey-eerie" place={ruins} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of Abbey/ }));
    const menu = screen.getByRole("menu", { name: "Play order" });
    expect(menu).toHaveTextContent("Play order in the scene The abbey ruins");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveFocus();
    const radios = within(menu).getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "No repeatAfter its last track the scene moves on",
      "Repeat allStarts again after its last track",
      "Repeat oneThe track playing repeats until you press Next",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(menu).toHaveTextContent("Only in the scene The abbey ruins. Elsewhere: In order, repeat all.");
    expect(menu).toHaveAccessibleDescription("Only in the scene The abbey ruins. Elsewhere: In order, repeat all.");
    expect(within(menu).getByRole("menuitem", { name: "Use the playlist's own order here" })).toBeVisible();
  });

  it("stays open on the item after a choice, keeps the choice for that place only, and says the new order and where", async () => {
    const api = show(<PlayOrderButton playlistId="p-abbey-eerie" place={ruins} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of Abbey/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^Repeat all/ }));
    const all = screen.getByRole("menuitemradio", { name: /^Repeat all/ });
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /^No repeat/ })).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(said()).toBe("Shuffle, repeat all in the scene The abbey ruins"));
    expect((await api.playlists.playOrders())["sc:crown:s14:sc3"]["p-abbey-eerie"]).toEqual({ shuffle: true, repeat: "all" });
    expect((await api.playlists.list()).find((p) => p.id === "p-abbey-eerie")?.order ?? null).toBeNull();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(screen.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Play order of Abbey: eerie, low energy: In order, repeat all" })).toHaveFocus();
  });

  it("Use the playlist's own order here takes the place's choice away", async () => {
    const api = show(<PlayOrderButton playlistId="p-abbey-eerie" place={ruins} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of Abbey/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Use the playlist's own order here" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const button = await screen.findByRole("button", { name: "Play order of Abbey: eerie, low energy: In order, no repeat" });
    expect(button).not.toHaveClass("own");
    await waitFor(() => expect(said()).toBe("Uses the playlist's own order here: In order, no repeat"));
    expect((await api.playlists.playOrders())["sc:crown:s14:sc3"]).toBeUndefined();
  });

  it("a place that uses the playlist's own order says a change applies only there", async () => {
    show(<PlayOrderButton playlistId="p-company" place={crown} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of The Company themes/ }));
    const menu = screen.getByRole("menu", { name: "Play order" });
    expect(menu).toHaveTextContent("Play order in The Sunken Crown");
    expect(menu).toHaveTextContent("Uses the playlist's own order. A change here applies only in The Sunken Crown.");
    expect(within(menu).getByRole("menuitemradio", { name: /^No repeat/ })).toHaveTextContent("Stops after its last track");
    expect(within(menu).queryByRole("menuitem", { name: "Use the playlist's own order here" })).toBeNull();
  });

  it("on the Playlists page it is the playlist's own order", async () => {
    const api = show(<PlayOrderButton playlistId="p-company" place={null} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of The Company themes/ }));
    const menu = screen.getByRole("menu", { name: "Play order" });
    expect(menu).toHaveTextContent("Play order of this playlist");
    expect(menu).toHaveTextContent("Scenes, sessions and campaigns can have their own.");
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: /^Repeat one/ }));
    await waitFor(async () => expect((await api.playlists.list()).find((p) => p.id === "p-company")?.order).toEqual({ shuffle: false, repeat: "one" }));
    await waitFor(() => expect(said()).toBe("In order, repeat one everywhere it has no order of its own"));
  });

  it("a refused change is said in plain words and the order shown goes back", async () => {
    const api = createFakeLyreApi();
    vi.spyOn(api.playlists, "setPlayOrder").mockResolvedValue({ ok: false, refusal: { code: "busy", message: "Lyre is busy. Try again in a moment." } } as never);
    show(<PlayOrderButton playlistId="p-company" place={crown} />, api);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of The Company themes/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Shuffle" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Lyre is busy. Try again in a moment."));
    await waitFor(() => expect(screen.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveAttribute("aria-checked", "false"));
  });

  it("has no accessibility failures, closed or open", async () => {
    show(<PlayOrderButton playlistId="p-abbey-eerie" place={ruins} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play order of Abbey/ }));
    await expectNoAxeViolations(document.body);
  });
});
