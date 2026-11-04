import { checkTabUrl, isRefused } from "../../common/security/urlPolicy";
import type { AppPageRole } from "./permissions";
import { TrustedContentsRegistry, trustedContents } from "./trustedContents";

/** The navigation event fields used here (Electron's `will-navigate` / `will-redirect`). */
export interface NavigationEvent {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

/** The parts of an Electron WebContents the guards need. */
export interface GuardableContents {
  id: number;
  getURL(): string;
  once(event: "destroyed", listener: () => void): unknown;
  on(event: "will-navigate", listener: (event: NavigationEvent) => void): unknown;
  on(event: "will-redirect", listener: (event: NavigationEvent) => void): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
}

/**
 * True when `target` is the page at `current` with at most a different
 * #fragment, i.e. the navigation does not leave the document.
 */
export function isSameDocumentNavigation(current: string, target: string): boolean {
  try {
    const from = new URL(current);
    const to = new URL(target);
    from.hash = "";
    to.hash = "";
    return from.href === to.href;
  } catch {
    return false;
  }
}

/**
 * SEC-7: pin one of Kenku FM's own pages (whose preload exposes privileged
 * APIs) to its own document, and register it as trusted for SEC-3.
 * Navigation to any other page is cancelled and new windows are never
 * created; `onWindowOpen` may act on the requested URL instead (for example
 * open it in the system browser).
 */
export function lockAppPage(
  contents: GuardableContents,
  role: AppPageRole,
  {
    registry = trustedContents,
    onWindowOpen,
  }: {
    registry?: TrustedContentsRegistry;
    onWindowOpen?: (url: string) => void;
  } = {},
): void {
  registry.trust(contents, role);
  contents.on("will-navigate", (event) => {
    if (!isSameDocumentNavigation(contents.getURL(), event.url)) {
      console.warn(`Blocked ${role} from navigating away from the app`);
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    onWindowOpen?.(url);
    return { action: "deny" };
  });
}

/**
 * SEC-6: cancel any top-level navigation or redirect in a website tab to an
 * address the tab URL policy refuses (file:, custom app protocols, etc.).
 */
export function guardTabNavigation(contents: GuardableContents): void {
  const guard = (event: NavigationEvent) => {
    if (!event.isMainFrame) {
      return;
    }
    const check = checkTabUrl(event.url);
    if (isRefused(check)) {
      console.warn(`Blocked tab navigation: ${check.reason}`);
      event.preventDefault();
    }
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
}

/**
 * SEC-15: a tab showing a file from the user's computer. Only the user opens
 * files (from the address bar or a bookmark, after the main process asked), so
 * the page itself may not move to another file or anywhere else: links and
 * popups to web pages open in a new website tab through `onOpenWebPage`
 * (the file's tab and its partition never load a website), everything else is
 * cancelled. A jump to a #section of the same file is fine.
 */
export function guardLocalFileTab(
  contents: GuardableContents,
  { onOpenWebPage }: { onOpenWebPage: (url: string) => void },
): void {
  const openIfWebPage = (url: string) => {
    const check = checkTabUrl(url);
    if (isRefused(check)) {
      console.warn("Blocked a file's tab from opening another file or app");
      return;
    }
    onOpenWebPage(check.url);
  };
  contents.on("will-navigate", (event) => {
    if (!event.isMainFrame || isSameDocumentNavigation(contents.getURL(), event.url)) {
      return;
    }
    event.preventDefault();
    openIfWebPage(event.url);
  });
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    openIfWebPage(url);
    return { action: "deny" };
  });
}
