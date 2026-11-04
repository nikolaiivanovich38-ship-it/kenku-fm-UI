import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(window, { kenku: { showBrowserView: vi.fn(), hideBrowserView: vi.fn() } });
});

import reducer, { addTab, replaceTab, selectTab, type Tab } from "./tabsSlice";

const tab = (id: number, extra: Partial<Tab> = {}): Tab => ({
  id,
  url: `https://example.com/${id}`,
  title: `Tab ${id}`,
  icon: "",
  playingMedia: 0,
  muted: false,
  ...extra,
});

describe("replaceTab (SEC-15)", () => {
  it("puts the new tab in the old one's place and keeps it selected", () => {
    let state = reducer(undefined, addTab(tab(1)));
    state = reducer(state, addTab(tab(2)));
    state = reducer(state, addTab(tab(3)));
    state = reducer(state, selectTab(2));
    state = reducer(
      state,
      replaceTab({ oldId: 2, tab: tab(9, { url: "file:///C:/Maps/index.html", kind: "local-file" }) }),
    );
    expect(state.tabs.allIds).toEqual([1, 9, 3]);
    expect(state.tabs.byId[2]).toBeUndefined();
    expect(state.tabs.byId[9]).toMatchObject({ kind: "local-file" });
    expect(state.selectedTab).toBe(9);
  });

  it("adds the tab at the end when the old one is gone", () => {
    let state = reducer(undefined, addTab(tab(1)));
    state = reducer(state, replaceTab({ oldId: 5, tab: tab(6) }));
    expect(state.tabs.allIds).toEqual([1, 6]);
  });
});
