import { describe, expect, it, vi } from "vitest";
import { createLyreDiagnosticsBridge } from "./preloadDiagnostics";

describe("the Lyre page's Save diagnostics bridge (FND-9)", () => {
  it("asks the main process with no arguments and passes on only a well-formed answer", async () => {
    const ipc = { invoke: vi.fn(async () => ({ ok: true, folder: "Documents", file: "Lyre diagnostics.zip", path: "C:\\Users\\nik" })), send: vi.fn() };
    const bridge = createLyreDiagnosticsBridge(ipc);
    expect(await bridge.save()).toEqual({ ok: true, folder: "Documents", file: "Lyre diagnostics.zip" });
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_DIAGNOSTICS_SAVE");
    bridge.show();
    expect(ipc.send).toHaveBeenCalledWith("LYRE_DIAGNOSTICS_SHOW");
  });

  it("turns anything else into a plain failure", async () => {
    const ipc = { invoke: vi.fn(async () => ({ ok: "maybe" })), send: vi.fn() };
    expect(await createLyreDiagnosticsBridge(ipc).save()).toEqual({ ok: false, cancelled: false, message: "Lyre did not answer. Try again." });
  });
});
