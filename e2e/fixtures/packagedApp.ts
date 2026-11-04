/**
 * FND-4: where the packaged app is and how to start it for tests.
 * Kept free of Playwright so the rules are easy to read and reuse.
 */
import fs from "fs";
import path from "path";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import packageJson from "../../package.json";

const repoRoot = path.resolve(__dirname, "..", "..");

/** Path of the app built by `electron-forge package` for this computer, or CUE_DESK_EXECUTABLE. */
export function findPackagedExecutable(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.CUE_DESK_EXECUTABLE) {
    return env.CUE_DESK_EXECUTABLE;
  }
  const productName = packageJson.productName;
  const folder = path.join(repoRoot, "out", `${productName}-${platform}-${arch}`);
  const executable =
    platform === "win32"
      ? path.join(folder, `${packageJson.name}.exe`)
      : platform === "darwin"
        ? path.join(folder, `${productName}.app`, "Contents", "MacOS", productName)
        : path.join(folder, packageJson.name);
  if (!fs.existsSync(executable)) {
    throw new Error(
      `The packaged app was not found at ${executable}. Build it first with: CUE_DESK_E2E_BUILD=1 yarn package`,
    );
  }
  return executable;
}

/** How the fuse wire stores a switched-off fuse (the character "0"). */
const FUSE_DISABLED = "0".charCodeAt(0);

/**
 * Playwright controls Electron through the Node.js inspector (--inspect),
 * which release builds switch off with a fuse (SEC-13). Stop early with a
 * clear message if the app was not packaged for testing.
 */
export async function assertE2EBuild(executablePath: string): Promise<void> {
  // On macOS the fuses live in the Electron Framework, not the launcher.
  if (process.platform === "darwin") {
    return;
  }
  const wire = await getCurrentFuseWire(executablePath);
  if (wire[FuseV1Options.EnableNodeCliInspectArguments] === FUSE_DISABLED) {
    throw new Error("This build cannot be tested. Package it with CUE_DESK_E2E_BUILD=1 yarn package");
  }
}

/**
 * Chromium refuses to start its sandbox as root on Linux (containers, CI), so
 * only then is the sandbox switched off. Everywhere else it stays on.
 */
export function launchArgs(
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): { args: string[]; chromiumSandbox: boolean } {
  const runningAsLinuxRoot = platform === "linux" && uid === 0;
  return runningAsLinuxRoot
    ? { args: ["--no-sandbox"], chromiumSandbox: false }
    : { args: [], chromiumSandbox: true };
}
