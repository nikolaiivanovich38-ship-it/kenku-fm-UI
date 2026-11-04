const webpack = require("webpack");

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: "./src/index.ts",
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
    "zlib-sync": "commonjs2 zlib-sync",
  },
};
