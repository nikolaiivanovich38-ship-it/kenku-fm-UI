/**
 * DAT-14: a track's name where it plays: the scene's name for it in that scene, its own name everywhere else, and
 * its own name on hover where they differ (core.js L.nameIn; the domain's trackNameIn).
 */
import React from "react";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UsePlace } from "../../common/domain";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
import { expectNoAxeViolations } from "../test/axe";
import { TrackName, ownNameTitle, useTrackNames } from "./trackName";

const aftermath: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc6" };
const ruins: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
const t07 = { id: "t07", title: "Sunrise after the storm", metaTitle: "", fileName: "t07.flac" };

describe("useTrackNames", () => {
  it("gathers every scene's names for its tracks from the campaigns", async () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => useTrackNames(), { wrapper: ({ children }) => <LyreApiProvider api={api}>{children}</LyreApiProvider> });
    await waitFor(() => expect(result.current["sc:crown:s14:sc6"]).toEqual({ t07: "Dawn over the abbey" }));
    expect(result.current["sc:crown:s14:sc4"]).toEqual({ t39: "The wight rises" });
  });
});

describe("ownNameTitle", () => {
  it("names the track's own name on hover when the scene calls it something else", () => {
    expect(ownNameTitle({ name: "Dawn over the abbey", own: "Sunrise after the storm" })).toBe("Its own name: Sunrise after the storm");
    expect(ownNameTitle({ name: "Sunrise after the storm", own: "Sunrise after the storm" })).toBe("Sunrise after the storm");
  });
});

describe("TrackName", () => {
  const names = { "sc:crown:s14:sc6": { t07: "Dawn over the abbey" } };

  it("in the scene that names it, shows the scene's name, with its own name on hover and for screen readers", () => {
    render(<TrackName track={t07} place={aftermath} names={names} />);
    const name = screen.getByTitle("Its own name: Sunrise after the storm");
    expect(name).toHaveTextContent("Dawn over the abbey");
    expect(name.querySelector(".sr-only")).toHaveTextContent("(its own name: Sunrise after the storm)");
  });

  it("anywhere else (another scene, a session, a campaign, nowhere) shows its own name", () => {
    for (const place of [ruins, { kind: "session", campaignId: "crown", sessionId: "s14" } as UsePlace, null]) {
      const { unmount } = render(<TrackName track={t07} place={place} names={names} />);
      expect(screen.getByTitle("Sunrise after the storm")).toHaveTextContent(/^Sunrise after the storm$/);
      unmount();
    }
  });

  it("has no accessibility failures", async () => {
    const { container } = render(
      <p>
        <TrackName track={t07} place={aftermath} names={names} />
      </p>,
    );
    await expectNoAxeViolations(container);
  });
});
