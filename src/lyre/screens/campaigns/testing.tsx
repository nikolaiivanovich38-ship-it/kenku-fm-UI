/**
 * Test harness for the Campaigns screens: the whole page (providers, shell and these screens) over the in-memory
 * LyreApi seeded from the prototype and a FakeLyreAudio, opened at a route as the app opens it ("#/campaign/crown").
 */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";

import { createFakeLyreApi, type FakeLyreApi } from "../../../common/lyre/fake";
import { AppProviders } from "../../AppProviders";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { Shell } from "../../shell/Shell";
import { SCREENS } from "..";
import { CampaignScreen, CampaignsScreen, SessionScreen } from ".";

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
