/** FND-8: a help article's Markdown, as text (webpack's asset/source for `?raw`; Vite reads `?raw` itself in tests). */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
