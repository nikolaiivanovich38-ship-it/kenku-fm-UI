/**
 * The drop tray's document listeners (ORG-5) with the page's drop guard (SEC-7) installed, as in src/lyre/index.tsx.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeLyreApi } from "../../../common/lyre/fake";
import { installDocumentDropGuard } from "../../../common/security/dragGuard";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { DropTray } from "./DropTray";

let removeGuard: () => void;
beforeEach(() => {
  removeGuard = installDocumentDropGuard(document);
});
afterEach(() => removeGuard());

function renderTray() {
  return render(
    <LyreApiProvider api={createFakeLyreApi()}>
      <LyreAudioProvider audio={new FakeLyreAudio()}>
        <ShellSettingsProvider>
          <AnnouncerProvider>
            <main>
              <div draggable data-track="t1">
                A track
              </div>
              <p>Somewhere else on the page</p>
            </main>
            <DropTray resolve={(el) => (el.dataset.track ? { ids: [el.dataset.track], from: null } : null)} />
          </AnnouncerProvider>
        </ShellSettingsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
}

describe("the drop tray and the page's drop guard (SEC-7)", () => {
  it("CR-8 (review 0.5.0): after Esc, a file dragged over the page still cannot be dropped there", async () => {
    const view = renderTray();
    fireEvent.dragStart(view.getByText("A track"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    const dataTransfer = { types: ["Files"], dropEffect: "copy" };
    const allowed = fireEvent.dragOver(view.getByText("Somewhere else on the page"), { dataTransfer });
    // The browser's own handling (open the file in the page) is prevented, and the pointer says "no drop".
    expect(allowed).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
  });
});
