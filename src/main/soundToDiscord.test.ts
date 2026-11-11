import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SoundToDiscord } from "./soundToDiscord";

describe("SoundToDiscord (FND-16: Sound to Discord is applied by the main process)", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-sound-"));
    file = path.join(dir, "this-computer.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("applies Lighter on the computer when this computer has no choice yet", () => {
    const apply = vi.fn();
    new SoundToDiscord({ file, apply });
    expect(apply).toHaveBeenCalledWith("performance");
  });

  it("applies the saved choice at once", () => {
    fs.writeFileSync(file, JSON.stringify({ streamingMode: "lowLatency" }));
    const apply = vi.fn();
    new SoundToDiscord({ file, apply });
    expect(apply).toHaveBeenCalledWith("lowLatency");
  });

  it("applies a change when the settings change, and nothing when Sound to Discord stayed the same", () => {
    const apply = vi.fn();
    const sound = new SoundToDiscord({ file, apply });
    apply.mockClear();
    fs.writeFileSync(file, JSON.stringify({ globalKeys: true }));
    sound.refresh();
    expect(apply).not.toHaveBeenCalled();
    fs.writeFileSync(file, JSON.stringify({ streamingMode: "lowLatency" }));
    sound.refresh();
    expect(apply).toHaveBeenCalledWith("lowLatency");
  });

  it("listens for the library's settings changes only", () => {
    const apply = vi.fn();
    const sound = new SoundToDiscord({ file, apply });
    apply.mockClear();
    fs.writeFileSync(file, JSON.stringify({ streamingMode: "lowLatency" }));
    sound.onLibraryEvent({ type: "changed", areas: ["tracks"] });
    expect(apply).not.toHaveBeenCalled();
    sound.onLibraryEvent({ type: "changed", areas: ["settings"] });
    expect(apply).toHaveBeenCalledWith("lowLatency");
  });
});
