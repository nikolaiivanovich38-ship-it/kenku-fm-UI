import { describe, expect, it, vi } from "vitest";

import { MainMediaResolver, MediaBridge } from "./mainMediaResolver";

function bridge(answer: Awaited<ReturnType<MediaBridge["prepare"]>>) {
  return { prepare: vi.fn<MediaBridge["prepare"]>(async () => answer) };
}

describe("MainMediaResolver (BUG-10, PLY-11): files are prepared by the main process", () => {
  it("asks the main process for every file on this computer and plays the address it answers", async () => {
    const main = bridge({ url: "file:///cache/0123.flac" });
    const resolved = await new MainMediaResolver(main).resolve({ url: "file:///music/old.wma", sizeBytes: 10 });
    expect(main.prepare).toHaveBeenCalledWith("file:///music/old.wma", { keepLocal: false });
    expect(resolved).toEqual({ url: "file:///cache/0123.flac" });
  });

  it("passes on a request for a copy on this computer's disk", async () => {
    const main = bridge({ url: "file:///music/big.flac" });
    await new MainMediaResolver(main).resolve({ url: "file:///music/big.flac", keepLocal: true });
    expect(main.prepare).toHaveBeenCalledWith("file:///music/big.flac", { keepLocal: true });
  });

  it("passes the main process's plain message on as the failure", async () => {
    const main = bridge({ error: "Could not convert old.wma." });
    await expect(new MainMediaResolver(main).resolve({ url: "file:///music/old.wma" })).rejects.toThrow(
      "Could not convert old.wma.",
    );
  });

  it("leaves other addresses alone", async () => {
    const main = bridge({ url: "x" });
    const resolved = await new MainMediaResolver(main).resolve({ url: "https://example.com/a.mp3", sizeBytes: 5 });
    expect(resolved).toEqual({ url: "https://example.com/a.mp3", sizeBytes: 5 });
    expect(main.prepare).not.toHaveBeenCalled();
  });

  it("refuses an answer that is not a file address, so a fault cannot point the player elsewhere", async () => {
    const main = bridge({ url: "https://example.com/elsewhere.mp3" });
    await expect(new MainMediaResolver(main).resolve({ url: "file:///music/a.flac" })).rejects.toThrow(
      /could not be prepared/,
    );
  });
});
