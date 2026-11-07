import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { NOT_SAVED, type WriteResult } from "../../common/lyre/api";
import { AnnouncerProvider } from "./Announcer";
import { useSave } from "./useSave";

const ok = (): Promise<WriteResult> => Promise.resolve({ ok: true, value: undefined, undoLabel: "Notes" } as unknown as WriteResult);
const refused = (code: string, message: string): Promise<WriteResult> => Promise.resolve({ ok: false, refusal: { code, message } } as unknown as WriteResult);

function Saver({ write }: { write: () => Promise<WriteResult> }) {
  const save = useSave();
  return (
    <button type="button" onClick={() => void save("The Sunken Crown notes", write)}>
      Save
    </button>
  );
}

async function press() {
  await act(async () => screen.getByRole("button", { name: "Save" }).click());
}

describe("useSave: every screen's save shows in the one pop-up (UX-19)", () => {
  it("a saved write says Saved and what", async () => {
    render(
      <AnnouncerProvider>
        <Saver write={ok} />
      </AnnouncerProvider>,
    );
    await press();
    expect(screen.getByRole("status")).toHaveTextContent("Saved: The Sunken Crown notes");
  });

  it("a write the computer could not save shows the failure card, and Try again writes it again", async () => {
    const write = vi.fn().mockReturnValueOnce(refused("not-saved", NOT_SAVED)).mockImplementation(ok);
    render(
      <AnnouncerProvider>
        <Saver write={write} />
      </AnnouncerProvider>,
    );
    await press();
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved: The Sunken Crown notes");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await act(async () => screen.getByRole("button", { name: "Try again" }).click());
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toHaveTextContent("Saved: The Sunken Crown notes");
  });

  it("another refusal says why in a note, with no Saved and no failure card", async () => {
    render(
      <AnnouncerProvider>
        <Saver write={() => refused("invalid", "A name cannot be empty.")} />
      </AnnouncerProvider>,
    );
    await press();
    expect(screen.getByRole("status")).toHaveTextContent("A name cannot be empty.");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
