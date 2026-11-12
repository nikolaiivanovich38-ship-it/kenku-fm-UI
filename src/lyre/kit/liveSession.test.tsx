import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLiveSession, loadInLive, nextSceneInLive, subscribeLiveSession, takeNextScene, useLiveSession } from "./liveSession";

afterEach(() => loadInLive(null));

function Probe() {
  const live = useLiveSession();
  return <p>{live ? `${live.campaignId}/${live.sessionId}` : "nothing"}</p>;
}

describe("the session loaded in Live", () => {
  it("starts empty, is set by Run and Prep or Live, and tells its listeners", () => {
    expect(getLiveSession()).toBeNull();
    const listener = vi.fn();
    const stop = subscribeLiveSession(listener);
    loadInLive({ campaignId: "crown", sessionId: "s14" });
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s14" });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    loadInLive({ campaignId: "crown", sessionId: "s15" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("redraws components that show it", () => {
    render(<Probe />);
    expect(screen.getByText("nothing")).toBeInTheDocument();
    act(() => loadInLive({ campaignId: "sixth", sessionId: "w4" }));
    expect(screen.getByText("sixth/w4")).toBeInTheDocument();
  });
});

describe("Next scene pressed on another screen (w51-fix2)", () => {
  it("opens Live and is taken once, only within a few seconds", () => {
    window.location.hash = "#/settings";
    nextSceneInLive(1000);
    expect(window.location.hash).toBe("#/live");
    expect(takeNextScene(5000)).toBe(true);
    expect(takeNextScene(5000)).toBe(false);
    nextSceneInLive(1000);
    expect(takeNextScene(20_000)).toBe(false);
  });
});
