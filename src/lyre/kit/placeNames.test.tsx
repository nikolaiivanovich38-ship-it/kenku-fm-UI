/** The names place words need (UX-16, PLY-13), from the campaign trees screens already load. */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { originWords, placeLabel } from "../../common/domain";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
import { placeNamesOf, usePlaceNames } from "./placeNames";

describe("placeNamesOf and usePlaceNames", () => {
  it("name the samples' campaign, session and scene", async () => {
    const api = createFakeLyreApi();
    const names = placeNamesOf(await api.campaigns.list());
    expect(placeLabel({ kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, names)).toBe("The abbey ruins (Session 14)");
    expect(placeLabel({ kind: "session", campaignId: "crown", sessionId: "s14" }, names)).toBe("Session 14: The Drowned Abbey");
    expect(originWords({ place: { kind: "campaign", campaignId: "crown" }, playlistName: "The Company themes" }, names)).toBe("Playlist: The Company themes · The Sunken Crown");
    expect(names.campaign("gone")).toBeUndefined();
  });

  it("follow the campaigns as they load", async () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => usePlaceNames(), { wrapper: ({ children }) => <LyreApiProvider api={api}>{children}</LyreApiProvider> });
    expect(result.current.campaign("crown")).toBeUndefined();
    await waitFor(() => expect(result.current.campaign("crown")).toBe("The Sunken Crown"));
  });
});
