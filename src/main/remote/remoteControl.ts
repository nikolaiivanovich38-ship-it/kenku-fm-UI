/**
 * SEC-4: turns the remote-control server on and off as its settings say, and reports what it is doing in a form
 * Settings can show. One per PlayerManager; the settings and the code live in a RemoteSettingsStore shared by all.
 */
import type { FastifyInstance } from "fastify";

import type { RemoteHost } from ".";
import { isHomeNetworkAddress } from "./homeNetwork";
import { createRemoteServer } from "./remoteServer";
import type { RemoteState } from "../../common/remoteControl";
import { remoteAddressProblem, type Checked, type RemoteSettings, type RemoteSettingsStore } from "./remoteSettings";

export type { RemoteState } from "../../common/remoteControl";

export interface RemoteControlOptions {
  store: RemoteSettingsStore;
  host: RemoteHost;
  /** Called after every change of state, with the new state. */
  onChange?: (state: RemoteState) => void;
  /** This computer's home-network address (homeNetworkAddress(os.networkInterfaces()) in the app), asked each time. */
  homeAddress?: () => string | null;
}

export class RemoteControl {
  private server: FastifyInstance | null = null;
  private problem?: string;
  /** Changes run one after another, so a quick on-off-on cannot leave two servers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: RemoteControlOptions) {}

  state(): RemoteState {
    const { store } = this.options;
    return {
      ...store.settings(),
      running: this.server !== null,
      code: store.code(),
      codeRemembered: store.codeRemembered,
      ...(this.problem ? { problem: this.problem } : {}),
      homeAddress: this.homeAddress(),
    };
  }

  /** Only ever a private address: the home network and nowhere else (homeNetwork.ts). */
  private homeAddress(): string | null {
    const address = this.options.homeAddress?.() ?? null;
    return address && isHomeNetworkAddress(address) ? address : null;
  }

  /** Start listening if the settings say it is on (at start-up). */
  start(): Promise<RemoteState> {
    return this.serially(() => this.apply());
  }

  /** Change settings and start, move or stop the server to match. */
  set(change: Partial<RemoteSettings>): Promise<Checked<RemoteState>> {
    return this.serially(async () => {
      const saved = this.options.store.update(change);
      if ("error" in saved) return saved;
      return this.apply();
    });
  }

  /** Make a new secret code; the old one is refused from the next request on. */
  newCode(): Promise<RemoteState> {
    return this.serially(async () => {
      this.options.store.newCode();
      return this.report();
    });
  }

  /** Stop listening (the window is going) without changing the setting. */
  close(): Promise<void> {
    return this.serially(() => this.stopServer());
  }

  /** Where the server listens, as "address:port" (for tests and diagnostics). */
  listeningAddresses(): string[] {
    if (!this.server) return [];
    return this.server.addresses().map((info) => `${info.family === "IPv6" ? `[${info.address}]` : info.address}:${info.port}`);
  }

  private async apply(): Promise<RemoteState> {
    await this.stopServer();
    this.problem = undefined;
    const settings = this.options.store.settings();
    // CR-2: checked again before listening, whoever changed the settings: a home-network address must be this computer's.
    const addressProblem = settings.enabled ? remoteAddressProblem(settings.address, this.options.store.ownAddresses()) : null;
    if (addressProblem) this.problem = addressProblem;
    else if (settings.enabled) {
      const server = createRemoteServer({
        host: this.options.host,
        code: () => this.options.store.code(),
        port: () => settings.port,
      });
      try {
        await server.listen({ host: settings.address, port: settings.port });
        this.server = server;
      } catch (error) {
        this.problem = plainListenError(error, settings);
        await server.close().catch((): void => undefined);
      }
    }
    return this.report();
  }

  private report(): RemoteState {
    const state = this.state();
    this.options.onChange?.(state);
    return state;
  }

  private async stopServer() {
    const server = this.server;
    this.server = null;
    await server?.close();
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch((): void => undefined);
    return result;
  }
}

function plainListenError(error: unknown, { address, port }: RemoteSettings): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "EADDRINUSE") {
    return `Another program is already using port ${port}. Choose another port in Settings, or close that program.`;
  }
  if (code === "EADDRNOTAVAIL") {
    return `This computer does not have the address ${address}. Use 127.0.0.1, or the address your network gave this computer.`;
  }
  if (code === "EACCES") {
    return `Lyre may not use port ${port} on this computer. Choose another port in Settings, for example 3333.`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `The remote control could not start: ${detail}`;
}
