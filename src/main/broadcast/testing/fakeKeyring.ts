/**
 * Test builds only (CUE_DESK_FAKE_KEYRING=1, wantsFakeKeyring): a stand-in for Electron's safeStorage on a Linux test
 * machine with no keyring, so end-to-end tests can save a bot and start Lyre again with it (the saved bots log in at
 * start). Reversible and marked, never the plain token; it protects nothing and release builds compile it out.
 */
import type { SafeStorageLike } from "../botTokenStore";

const MARK = "fake-keyring:";

export const fakeKeyring: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "fake_keyring_for_tests",
  encryptString: (text) => Buffer.from(MARK + Buffer.from(text, "utf8").toString("hex")),
  decryptString: (data) => {
    const text = data.toString();
    if (!text.startsWith(MARK)) throw new Error("Not saved by the fake keyring");
    return Buffer.from(text.slice(MARK.length), "hex").toString("utf8");
  },
};
