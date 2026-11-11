/**
 * Copy text to the clipboard from the Lyre page. Electron lets the page write text, never read it
 * (src/main/security/permissions.ts: "clipboard-sanitized-write" for lyre-view). Resolves false when the clipboard
 * refused (no permission, the page not focused), so the screen can say so in plain words instead of "copied".
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
