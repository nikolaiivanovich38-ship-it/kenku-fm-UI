/**
 * Test harness for the Campaigns screens: the whole page (providers, shell and these screens) over the in-memory
 * LyreApi seeded from the prototype and a FakeLyreAudio, opened at a route as the app opens it ("#/campaign/crown").
 */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { createFakeLyreApi, type FakeLyreApi } from "../../../common/lyre/fake";
import { AppProviders } from "../../AppProviders";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { Shell } from "../../shell/Shell";
import { SCREENS } from "..";
import { CampaignScreen, CampaignsScreen, SessionScreen } from ".";
import { forgetOpenScenes } from "./SessionScreen";

export const CAMPAIGN_SCREENS = { ...SCREENS, campaigns: CampaignsScreen, campaign: CampaignScreen, session: SessionScreen };

export interface Opened {
  api: FakeLyreApi;
  audio: FakeLyreAudio;
}

/** Open the page at a route. The screen fills in once the library answers: tests wait with findBy… queries. */
export function openAt(path: string, options: { api?: FakeLyreApi; audio?: FakeLyreAudio } = {}): Opened {
  const api = options.api ?? createFakeLyreApi();
  const audio = options.audio ?? new FakeLyreAudio();
  window.history.replaceState(null, "", `#/${path}`);
  // Each test is a new start of Lyre: no scene is open from the one before.
  forgetOpenScenes();
  render(
    <AppProviders api={api} audio={audio}>
      <Shell screens={CAMPAIGN_SCREENS} />
    </AppProviders>,
  );
  return { api, audio };
}

/** Follow a link or change the address as a person would. */
export function go(path: string): void {
  act(() => {
    window.location.hash = `#/${path}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

export const main = () => within(screen.getByRole("main"));
export const region = (name: string) => within(screen.getByRole("region", { name }));

/**
 * Drag the first of `rows` by its handle onto the lower half of the last one, laid out by hand (jsdom has no layout):
 * rows 40 px high, 6 px apart, in a box (the pane's body) that ends right under the last row, as a full list does
 * (GitHub's window, and Nik's long lists). `between` runs after the dragover, before the drop (to look at the line).
 */
export function dragFirstOntoLowerHalfOfLast(rows: HTMLElement[], between: () => void = () => undefined): void {
  const top = (i: number) => 100 + i * 46;
  const last = rows.length - 1;
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const i = rows.indexOf(this as HTMLElement);
    const box = (y: number, height: number) => ({ top: y, bottom: y + height, height, left: 0, right: 600, width: 600, x: 0, y, toJSON: () => ({}) }) as DOMRect;
    if (i >= 0) return box(top(i), 40);
    if (this.classList.contains("pane-body")) return box(90, top(last) + 40 - 90);
    return original.call(this);
  };
  try {
    const data = { effectAllowed: "", dropEffect: "", types: ["text/plain"], files: [] as File[], setData: (): void => undefined };
    fireEvent.pointerDown(rows[0].querySelector("[title='Drag to reorder']")!);
    fireEvent.dragStart(rows[0], { dataTransfer: data });
    const at = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: top(last) + 30 });
      Object.defineProperty(event, "dataTransfer", { value: data });
      // The pointer is over something inside the row, as in the app.
      fireEvent(rows[last].firstElementChild ?? rows[last], event);
    };
    at("dragover");
    between();
    at("drop");
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}
