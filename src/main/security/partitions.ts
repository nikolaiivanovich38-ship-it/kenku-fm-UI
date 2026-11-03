/**
 * SEC-3: persistent storage partition for website tabs, kept apart from the
 * default session that Kenku FM's own pages use. Changing this name logs the
 * user out of every website opened in a tab.
 */
export const TAB_PARTITION = "persist:tabs";
