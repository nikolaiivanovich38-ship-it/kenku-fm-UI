/**
 * LyreApi across a message boundary (WP5, wave 3 step 2): the library's utility process serves the API over a
 * port; the main process relays page calls to it; the page calls through its preload. One small protocol for all,
 * kept free of Electron so it is tested with Node's own MessageChannel.
 *
 *   caller → server  { t: "call", id, area, method, args }
 *   server → caller  { t: "result", id, value } or { t: "fault", id, message }; { t: "event", event }
 *   server → caller  { t: "host", id, op, args } (the library asks for a chooser or File Explorer)
 *   caller → server  { t: "host-result", id, value } or { t: "host-fault", id, message }
 *
 * Refusals are ordinary results (a WriteResult with ok: false); a fault is a broken call (a bug, a lost process).
 */
import { LYRE_API_METHODS, type LyreApi, type LyreEvent } from "./api";

/** The parts of a message port (Node's, Electron's MessagePortMain, a utility process's parent port) used here. */
export interface PortLike {
  postMessage(message: unknown): void;
  /** Calls `listener` with each message's data; returns a function that stops it. */
  onMessage(listener: (data: unknown) => void): () => void;
}

export type LyreArea = keyof typeof LYRE_API_METHODS;

/** Whether `area.method` is a LyreApi method (anything else is refused before it reaches the library). */
export function isLyreMethod(area: unknown, method: unknown): boolean {
  if (typeof area !== "string" || typeof method !== "string" || !Object.prototype.hasOwnProperty.call(LYRE_API_METHODS, area)) return false;
  return (LYRE_API_METHODS[area as LyreArea] as readonly string[]).includes(method);
}

/** Answers calls with `api`, passes its events on, and lets it ask the caller's side for host work. */
export function serveLyreApi(api: LyreApi, port: PortLike): { askHost(op: string, args: unknown[]): Promise<unknown>; close(): void } {
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextHostId = 1;
  const stopEvents = api.subscribe((event) => port.postMessage({ t: "event", event }));
  const stopMessages = port.onMessage(async (data) => {
    const message = data as { t?: string; id?: number; area?: string; method?: string; args?: unknown[]; value?: unknown; message?: string };
    if (message?.t === "host-result" || message?.t === "host-fault") {
      const pending = waiting.get(message.id as number);
      waiting.delete(message.id as number);
      if (message.t === "host-result") pending?.resolve(message.value);
      else pending?.reject(new Error(message.message));
      return;
    }
    if (message?.t !== "call") return;
    const { id, area, method } = message;
    if (!isLyreMethod(area, method) || !Array.isArray(message.args)) {
      port.postMessage({ t: "fault", id, message: `Lyre's library has no ${String(area)}.${String(method)}.` });
      return;
    }
    try {
      const target = (api as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[area as string];
      const value = await target[method as string](...message.args);
      port.postMessage({ t: "result", id, value });
    } catch (error) {
      port.postMessage({ t: "fault", id, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return {
    askHost(op, args) {
      const id = nextHostId++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        port.postMessage({ t: "host", id, op, args });
      });
    },
    close() {
      stopEvents();
      stopMessages();
      for (const pending of waiting.values()) pending.reject(new Error("Lyre's library closed."));
      waiting.clear();
    },
  };
}

/** A call to the library: resolves to what the API returned (a refusal too), rejects on a fault. */
export type LyreInvoke = (area: string, method: string, args: unknown[]) => Promise<unknown>;

/** A LyreApi whose calls go through `invoke` and whose events come from `subscribe`. */
export function lyreApiFrom(invoke: LyreInvoke, subscribe: (listener: (event: LyreEvent) => void) => () => void): LyreApi {
  const api: Record<string, unknown> = { subscribe };
  for (const [area, methods] of Object.entries(LYRE_API_METHODS)) {
    const calls: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const method of methods) calls[method] = (...args) => invoke(area, method, args);
    api[area] = calls;
  }
  return api as unknown as LyreApi;
}

export interface PortClient {
  api: LyreApi;
  /** Rejects every call still waiting (the library process stopped) with these words. */
  failPending(message: string): void;
  close(): void;
}

/**
 * The caller's side over a port: calls, events, and host work the library asks for (`host`, by operation name).
 * Events are also given to `onEvent` before the API's own listeners (the main process forwards them to the page).
 */
export function lyreApiOverPort(port: PortLike, host: Record<string, (...args: unknown[]) => unknown> = {}): PortClient {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Set<(event: LyreEvent) => void>();
  let nextId = 1;
  const stop = port.onMessage(async (data) => {
    const message = data as { t?: string; id?: number; value?: unknown; message?: string; event?: LyreEvent; op?: string; args?: unknown[] };
    if (message?.t === "result" || message?.t === "fault") {
      const call = pending.get(message.id as number);
      pending.delete(message.id as number);
      if (message.t === "result") call?.resolve(message.value);
      else call?.reject(new Error(message.message));
    } else if (message?.t === "event" && message.event) {
      for (const listener of [...listeners]) listener(message.event);
    } else if (message?.t === "host") {
      const work = host[message.op as string];
      try {
        if (!work) throw new Error(`Lyre cannot ${String(message.op)} here.`);
        port.postMessage({ t: "host-result", id: message.id, value: await work(...(message.args ?? [])) });
      } catch (error) {
        port.postMessage({ t: "host-fault", id: message.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  const invoke: LyreInvoke = (area, method, args) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      port.postMessage({ t: "call", id, area, method, args });
    });
  return {
    api: lyreApiFrom(invoke, (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    failPending(message) {
      for (const call of pending.values()) call.reject(new Error(message));
      pending.clear();
    },
    close() {
      stop();
      this.failPending("Lyre's library closed.");
    },
  };
}
