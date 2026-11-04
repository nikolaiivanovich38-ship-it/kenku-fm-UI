const webpack = require("webpack");
const rules = require("./webpack.rules");
const plugins = require("./webpack.plugins");

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

rules.push({
  test: /\.worklet\.js$/,
  use: { loader: "worklet-loader", options: { inline: true } },
});

rules.push({
  test: /\.worker\.js$/,
  use: { loader: "worker-loader", options: { inline: "fallback" } },
});

module.exports = {
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    // WP4: test-only hooks (the engine for e2e/engine.spec.ts) exist only in
    // packages built for the end-to-end tests; release builds compile them out.
    new webpack.DefinePlugin({
      __CUE_DESK_TEST_BUILD__: JSON.stringify(process.env.CUE_DESK_E2E_BUILD === "1"),
    }),
  ],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
  },
};
