import { checkExternalUrl, isRefused } from "../../common/security/urlPolicy";

/**
 * SEC-10: open a link in the user's default browser only when it is a plain
 * https web address. Anything else (file:, smb:, custom protocol handlers)
 * could make the operating system run a program, so it is dropped.
 * @param openExternal usually Electron's `shell.openExternal`
 * @returns whether the link was handed to the operating system
 */
export function openExternalIfAllowed(
  url: string,
  openExternal: (url: string) => Promise<void>,
): boolean {
  const check = checkExternalUrl(url);
  if (isRefused(check)) {
    console.warn(`Refused to open external link: ${check.reason}`);
    return false;
  }
  openExternal(check.url).catch((error) => {
    console.error("Unable to open external link", error);
  });
  return true;
}
