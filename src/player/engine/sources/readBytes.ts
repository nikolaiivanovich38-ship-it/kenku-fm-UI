/**
 * Read a small audio file into memory for decoding, giving up early on big
 * ones. Uses XMLHttpRequest because Chromium's fetch() refuses file://
 * addresses, while XHR from the player's own file:// page may read them (this
 * is how Howler loads soundboard sounds today). The player's CSP allows file:,
 * https: and http: in connect-src.
 */

/** The parts of XMLHttpRequest used here, so tests can script a fake one. */
export interface XhrLike {
  responseType: XMLHttpRequestResponseType;
  readonly response: unknown;
  readonly status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  open(method: string, url: string): void;
  send(): void;
  abort(): void;
}

/** Resolves to the bytes, or null when the file is over `limitBytes`. */
export function readBytes(
  url: string,
  limitBytes: number,
  createXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike,
): Promise<ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr();
    let tooBig = false;
    xhr.responseType = "arraybuffer";
    xhr.onprogress = (event) => {
      const size = event.lengthComputable ? event.total : event.loaded;
      if (size > limitBytes && !tooBig) {
        tooBig = true;
        xhr.abort();
      }
    };
    xhr.onabort = () => {
      if (tooBig) {
        resolve(null);
      } else {
        reject(new Error("Reading the audio file was cancelled"));
      }
    };
    xhr.onerror = () => reject(new Error("Could not read the audio file"));
    xhr.onload = () => {
      // file:// answers with status 0; web addresses with 200.
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
        reject(new Error(`Could not read the audio file (${xhr.status})`));
        return;
      }
      const bytes = xhr.response as ArrayBuffer | null;
      if (!bytes) {
        reject(new Error("Could not read the audio file"));
      } else {
        resolve(bytes.byteLength > limitBytes ? null : bytes);
      }
    };
    xhr.open("GET", url);
    xhr.send();
  });
}
