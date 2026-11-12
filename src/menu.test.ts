import { beforeAll, describe, expect, it, vi } from "vitest";

type MenuItem = { label?: string; role?: string; submenu?: MenuItem[]; click?: () => unknown };

const electron = vi.hoisted(() => ({
  app: { name: "Lyre", isPackaged: true, getVersion: () => "0.1.1", setAboutPanelOptions: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] as unknown[] },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("electron", () => ({ ...electron, default: electron }));

beforeAll(async () => {
  await import("./menu");
});

describe("application menu (FND-1)", () => {
  it("'Learn More' opens the fork's README, not upstream's website", async () => {
    const template = electron.Menu.buildFromTemplate.mock.calls[0][0] as MenuItem[];
    const help = template.find((item) => item.role === "help");
    const learnMore = help?.submenu?.find((item) => item.label === "Learn More");
    expect(learnMore).toBeDefined();
    await learnMore?.click?.();
    expect(electron.shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI#readme",
    );
  });
});

describe("Help > About (rebrand)", () => {
  it("names Lyre, its version and the Kenku FM credit the licence asks for", () => {
    expect(electron.app.setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationName: "Lyre",
        applicationVersion: "0.1.1",
        website: "https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI#readme",
      }),
    );
    const [options] = electron.app.setAboutPanelOptions.mock.calls[0] as unknown as [{ copyright: string }];
    expect(options.copyright).toMatch(/Kenku FM by Owlbear Rodeo/);
    expect(options.copyright).toMatch(/GPL-3\.0/);
  });
});

describe("FND-16: no Tab menu (website tabs are gone from Lyre)", () => {
  it("has no New Tab or Close Tab, so Ctrl+T and Ctrl+W are free", async () => {
    const template = JSON.stringify(electron.Menu.buildFromTemplate.mock.calls[0][0]);
    expect(template).not.toContain("New Tab");
    expect(template).not.toContain("Close Tab");
  });
});
