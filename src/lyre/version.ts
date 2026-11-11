/**
 * UX-R16: Lyre's version, built in by webpack from package.json (webpack.plugins.js, __LYRE_VERSION__). Empty where
 * nothing builds it in (unit tests), so nothing is shown there.
 */
declare const __LYRE_VERSION__: string | undefined;

export const LYRE_VERSION: string = typeof __LYRE_VERSION__ === "string" ? __LYRE_VERSION__ : "";
