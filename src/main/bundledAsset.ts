import path from "path";

/**
 * Absolute path of an image imported in the main process.
 *
 * webpack's `asset/resource` rule turns `import icon from "./x.png"` into the
 * emitted file name only (for example `5ab1….png`), relative to the bundle's
 * folder. Electron resolves relative paths against the working directory, so
 * the window icon was never found. Join it with the bundle folder instead.
 * @param asset what the import returned
 * @param bundleDir the main bundle's folder (`__dirname` in src/index.ts)
 */
export function bundledAssetPath(asset: string, bundleDir: string): string {
  return path.isAbsolute(asset) ? asset : path.join(bundleDir, asset);
}
