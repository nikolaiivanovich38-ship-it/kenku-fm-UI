import type { IdentifiableContents } from "./trustedContents";

/**
 * SEC-3: pages whose audio the app has chosen to capture for Discord (the
 * player view and website tabs).
 *
 * Chromium raises tab capture as a "media" permission request on the captured
 * page itself, with no media types. The permission handler grants that
 * request only for pages listed here, so a website cannot obtain it by
 * itself. `AudioCaptureManagerMain` adds a page just before it hands its media
 * source id to the capture window, and removes it when the capture stops.
 */
export class CaptureTargetRegistry {
  private readonly ids = new Set<number>();

  /** The app is about to capture this page; forgotten when it is destroyed. */
  allow(contents: IdentifiableContents): void {
    if (this.ids.has(contents.id)) {
      return;
    }
    this.ids.add(contents.id);
    contents.once("destroyed", () => this.ids.delete(contents.id));
  }

  /** The capture of this page stopped. */
  revoke(contents: { id: number }): void {
    this.ids.delete(contents.id);
  }

  /** Every capture stopped. */
  revokeAll(): void {
    this.ids.clear();
  }

  has(contents: { id: number } | null | undefined): boolean {
    return Boolean(contents) && this.ids.has(contents!.id);
  }
}

/** Registry shared by the whole main process. */
export const captureTargets = new CaptureTargetRegistry();
