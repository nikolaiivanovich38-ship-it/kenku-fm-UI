import type { IdentifiableContents } from "./trustedContents";

/**
 * Origin of a URL as Chromium reports it in a permission request's
 * `securityOrigin`: "scheme://host:port/", or "file:///" for any file.
 * Returns undefined for anything that is not a URL.
 */
function requestOrigin(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return "file:///";
    }
    return parsed.origin === "null" ? undefined : `${parsed.origin}/`;
  } catch {
    return undefined;
  }
}

/**
 * SEC-3: pages whose audio the app has chosen to capture for Discord (the
 * player view and website tabs).
 *
 * Chromium raises tab capture as a "media" permission request on the captured
 * page itself, with no media types and with the origin of the page that
 * called getUserMedia: the capture window. A website that asks for its own
 * screen or desktop audio raises the same request with no media types, but
 * with its own origin. So a request is tab capture only when the page is
 * listed here and the request comes from the capture window's origin.
 *
 * `AudioCaptureManagerMain` names the capture window (`setCapturer`), adds a
 * page just before it hands its media source id to the capture window, and
 * removes it when the capture stops.
 */
export class CaptureTargetRegistry {
  private readonly ids = new Set<number>();
  private capturerOrigin: string | undefined;

  /** The capture window's address; requests must come from its origin. */
  setCapturer(url: string): void {
    this.capturerOrigin = requestOrigin(url);
  }

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

  /**
   * Whether a permission request raised on `contents` is the capture window
   * capturing it.
   * @param securityOrigin the request's `details.securityOrigin`
   */
  isCaptureRequest(
    contents: { id: number } | null | undefined,
    securityOrigin: string | undefined,
  ): boolean {
    return (
      this.has(contents) &&
      this.capturerOrigin !== undefined &&
      requestOrigin(securityOrigin) === this.capturerOrigin
    );
  }
}

/** Registry shared by the whole main process. */
export const captureTargets = new CaptureTargetRegistry();
