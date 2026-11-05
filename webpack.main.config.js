const webpack = require("webpack");

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: {
    index: "./src/index.ts",
    // WP5 (w3-api): Lyre's library runs in its own utility process (src/main/lyreApi/startLibrary.ts forks it).
    lyreLibrary: "./src/main/lyreApi/libraryProcess.ts",
  },
  // Forge names the main bundle index.js; the library process gets its own file beside it.
  output: { filename: "[name].js" },
  // Put your normal webpack config below here
  module: {
    rules: require("./webpack.rules"),
  },
  plugins: [
    // FND-4: test-only switches (CUE_DESK_USER_DATA_DIR) work only in
    // packages built for the end-to-end tests; release builds compile them out.
    new webpack.DefinePlugin({
      __CUE_DESK_TEST_BUILD__: JSON.stringify(process.env.CUE_DESK_E2E_BUILD === "1"),
    }),
  ],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"],
  },
  externals: {
    opusscript: "commonjs2 opusscript",
    "prism-media": "commonjs2 prism-media",
    "@snazzah/davey": "commonjs2 @snazzah/davey",
    // Optional in discord.js and not installed (FND-10); its require() is in a try block.
    "zlib-sync": "commonjs2 zlib-sync",
  },
};
