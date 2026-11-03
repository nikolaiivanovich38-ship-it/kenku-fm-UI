import type { AppPageRole } from "./permissions";

/** The parts of an Electron WebContents the registry needs. */
export interface IdentifiableContents {
  id: number;
  once(event: "destroyed", listener: () => void): unknown;
}

/**
 * SEC-3: remembers which web contents are Kenku FM's own pages (main window,
 * hidden audio-capture window, player view). Anything not registered here is
 * treated as an untrusted website by the permission handlers.
 */
export class TrustedContentsRegistry {
  private readonly roles = new Map<number, AppPageRole>();

  /** Register an app page; it is forgotten automatically when destroyed. */
  trust(contents: IdentifiableContents, role: AppPageRole): void {
    this.roles.set(contents.id, role);
    contents.once("destroyed", () => {
      if (this.roles.get(contents.id) === role) {
        this.roles.delete(contents.id);
      }
    });
  }

  forget(contents: { id: number }): void {
    this.roles.delete(contents.id);
  }

  /** Role of a page, or null when it is not one of Kenku FM's own pages. */
  roleOf(contents: { id: number } | null | undefined): AppPageRole | null {
    if (!contents) {
      return null;
    }
    return this.roles.get(contents.id) ?? null;
  }
}

/** Registry shared by the whole main process. */
export const trustedContents = new TrustedContentsRegistry();
