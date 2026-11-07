/**
 * UX-12: Next scene and Fade everything out from other programs too (Settings › Keyboard shortcuts, off by default),
 * with Electron's globalShortcut. Only the two actions' keys are ever registered, only while the switch is on, and
 * every one Lyre registered is let go of when the switch goes off, a key changes, the main window closes
 * (LyreManager.destroy) and when Lyre quits (src/index.ts, will-quit).
 *
 * globalShortcut.register answers false when another program already holds the key; Settings then says so in plain
 * words and the action keeps working inside Lyre. Keys used for typing or by other programs' own commands are refused
 * before Electron is asked (src/common/globalKeys.ts globalKeyProblem).
 */
import { SHORTCUT_ACTIONS } from "../common/domain/round7";
import {
  GLOBAL_KEY_ACTIONS,
  acceleratorOf,
  globalKeyProblem,
  type GlobalKeyAction,
  type GlobalKeyRefusal,
  type GlobalKeysAnswer,
  type GlobalKeysRequest,
} from "../common/globalKeys";

/** The parts of Electron's globalShortcut this needs. */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const nameOf = (action: GlobalKeyAction) => SHORTCUT_ACTIONS.find((a) => a.id === action)?.name ?? action;

export class GlobalKeys {
  /** The accelerators this registered, and for which action. */
  private readonly held = new Map<string, GlobalKeyAction>();
  private disposed = false;

  constructor(
    private readonly shortcuts: GlobalShortcutLike,
    private readonly onPress: (action: GlobalKeyAction) => void,
  ) {}

  /** Register the keys asked for (or none when off); answers which were refused and why. */
  set(request: GlobalKeysRequest): GlobalKeysAnswer {
    this.releaseAll();
    const refused: GlobalKeyRefusal[] = [];
    if (!request.on || this.disposed) return { refused };
    const taken = new Map<string, GlobalKeyAction>();
    for (const action of GLOBAL_KEY_ACTIONS) {
      const key = request.keys[action];
      if (!key) continue;
      const problem = globalKeyProblem(action, key);
      const accelerator = acceleratorOf(key);
      if (problem || !accelerator) {
        refused.push({ action, key, message: problem ?? `Lyre cannot listen to ${key} in other programs.` });
        continue;
      }
      const other = taken.get(accelerator);
      if (other) {
        refused.push({ action, key, message: `${key} is already ${nameOf(other)}. Give ${nameOf(action)} another key.` });
        continue;
      }
      taken.set(accelerator, action);
      let registered = false;
      try {
        registered = this.shortcuts.register(accelerator, () => this.onPress(action));
      } catch {
        refused.push({ action, key, message: `Lyre cannot listen to ${key} in other programs. Give ${nameOf(action)} a key such as F9 or Ctrl+Alt+N.` });
        continue;
      }
      if (registered) this.held.set(accelerator, action);
      else refused.push({ action, key, message: `Another program already uses ${key} everywhere, so ${nameOf(action)} works only in Lyre. Give it another key, or close that program.` });
    }
    return { refused };
  }

  /** Let go of every key this registered; later requests register nothing. */
  dispose(): void {
    this.releaseAll();
    this.disposed = true;
  }

  private releaseAll(): void {
    for (const accelerator of this.held.keys()) {
      try {
        this.shortcuts.unregister(accelerator);
      } catch {
        // Already gone (Electron quitting): nothing to let go of.
      }
    }
    this.held.clear();
  }
}
