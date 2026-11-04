/**
 * SEC-15: opening files from the user's computer in a tab.
 *
 * Website tabs never load `file:` addresses (urlPolicy.ts). The user may open
 * one from the address bar or a bookmark; the main process then asks
 * "Open this file from your computer?" with the full path, unless the file is
 * in a folder the user chose to remember. The answer comes from a dialog the
 * main process shows itself, never from the renderer.
 *
 * Kept free of Electron imports so the rules can be unit-tested; the dialog
 * and the saved folder list are passed in (see localFileStore.ts and
 * BrowserViewManagerMain).
 */
import nodePath from "path";
import { fileURLToPath } from "url";
import { checkLocalFileUrl, isLocalFile } from "../../common/security/urlPolicy";

type PathApi = typeof nodePath.posix;

/** Where the remembered folders are saved (main process only). */
export interface FolderStore {
  get(): string[];
  set(folders: string[]): void;
}

/** The parts of Electron's `MessageBoxOptions` used for the question. */
export interface LocalFilePrompt {
  type: "question";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
  checkboxLabel: string;
  checkboxChecked: false;
}

/** The parts of Electron's `MessageBoxReturnValue` used here. */
export interface PromptAnswer {
  response: number;
  checkboxChecked: boolean;
}

const OPEN = 0;
const CANCEL = 1;

/** The question shown before a file opens. Cancel is the default, so Enter does not open it. */
export function localFilePrompt(filePath: string, folder: string): LocalFilePrompt {
  return {
    type: "question",
    title: "Open a file",
    message: "Open this file from your computer?",
    detail:
      `${filePath}\n\n` +
      "Only open files you trust. The file opens in its own tab, kept apart from websites.",
    buttons: ["Open", "Cancel"],
    defaultId: CANCEL,
    cancelId: CANCEL,
    noLink: true,
    checkboxLabel: `Don't ask again for files in ${folder}`,
    checkboxChecked: false,
  };
}

/**
 * True when `filePath` is `folder` or inside it. Windows paths are compared
 * without regard to upper and lower case, as Windows does.
 */
export function isInsideFolder(filePath: string, folder: string, pathApi: PathApi = nodePath): boolean {
  const windows = pathApi.sep === "\\";
  const normalise = (value: string) => {
    const resolved = pathApi.resolve(value);
    return windows ? resolved.toLowerCase() : resolved;
  };
  const relative = pathApi.relative(normalise(folder), normalise(filePath));
  return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

/** The folders whose files open without asking, as the user chose them. */
export class LocalFileFolders {
  constructor(
    private readonly store: FolderStore,
    private readonly pathApi: PathApi = nodePath,
  ) {}

  /** Remembered folders, in the order they were added. Anything odd in the saved file is skipped. */
  list(): string[] {
    const saved = this.store.get();
    if (!Array.isArray(saved)) {
      return [];
    }
    return saved.filter(
      (folder): folder is string =>
        typeof folder === "string" && folder !== "" && this.pathApi.isAbsolute(folder) && !this.isRoot(folder),
    );
  }

  /** Remember `folder`. The root of a drive is never remembered: that would mean every file. */
  remember(folder: string): void {
    const clean = this.clean(folder);
    if (this.isRoot(clean) || this.list().some((known) => this.same(known, clean))) {
      return;
    }
    this.store.set([...this.list(), clean]);
  }

  forget(folder: string): void {
    this.store.set(this.list().filter((known) => !this.same(known, folder)));
  }

  allows(filePath: string): boolean {
    return this.list().some((folder) => isInsideFolder(filePath, folder, this.pathApi));
  }

  private clean(folder: string): string {
    const resolved = this.pathApi.resolve(folder);
    return this.isRoot(resolved) ? resolved : resolved.replace(/[\\/]+$/, "");
  }

  private isRoot(folder: string): boolean {
    const resolved = this.pathApi.resolve(folder);
    return this.pathApi.parse(resolved).root === resolved;
  }

  private same(a: string, b: string): boolean {
    return isInsideFolder(a, b, this.pathApi) && isInsideFolder(b, a, this.pathApi);
  }
}

/**
 * Decides whether a file the user asked for may open: refuses anything the URL
 * policy does not accept as a local file, opens files in remembered folders,
 * and asks about everything else.
 */
export class LocalFileGate {
  private readonly folders: LocalFileFolders;
  private readonly ask: (prompt: LocalFilePrompt) => Promise<PromptAnswer>;
  private readonly windowsPaths: boolean;

  constructor(options: {
    folders: LocalFileFolders;
    /** Show the question; in the app, `dialog.showMessageBox` on the main window. */
    ask: (prompt: LocalFilePrompt) => Promise<PromptAnswer>;
    /** Read file addresses as Windows paths. Defaults to the platform the app runs on. */
    windowsPaths?: boolean;
  }) {
    this.folders = options.folders;
    this.ask = options.ask;
    this.windowsPaths = options.windowsPaths ?? process.platform === "win32";
  }

  /**
   * @returns the address to load, or undefined when the address is not a
   *   local file or the user said no.
   */
  async approve(rawUrl: string): Promise<string | undefined> {
    const check = checkLocalFileUrl(rawUrl);
    if (!isLocalFile(check)) {
      console.warn(`Refused to open a file: ${check.reason}`);
      return undefined;
    }
    let filePath: string;
    try {
      filePath = fileURLToPath(check.url, { windows: this.windowsPaths });
    } catch {
      console.warn("Refused to open a file whose address is not a path on this computer");
      return undefined;
    }
    if (this.folders.allows(filePath)) {
      return check.url;
    }
    const pathApi = this.windowsPaths ? nodePath.win32 : nodePath.posix;
    const folder = pathApi.dirname(filePath);
    let answer: PromptAnswer;
    try {
      answer = await this.ask(localFilePrompt(filePath, folder));
    } catch (error) {
      console.error("Could not ask about opening a file", error);
      return undefined;
    }
    if (answer.response !== OPEN) {
      return undefined;
    }
    if (answer.checkboxChecked) {
      this.folders.remember(folder);
    }
    return check.url;
  }
}
