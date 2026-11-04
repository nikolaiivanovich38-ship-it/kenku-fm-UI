/**
 * SEC-3: persistent storage partition for website tabs, kept apart from the
 * default session that Kenku FM's own pages use. Changing this name logs the
 * user out of every website opened in a tab.
 */
export const TAB_PARTITION = "persist:tabs";

/**
 * SEC-15: files from the user's computer open in tabs of their own, in this
 * partition, so they never share cookies or storage with websites.
 */
export const LOCAL_FILE_PARTITION = "persist:local-files";
