const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const { ThirdPartyLicencesPlugin } = require("./scripts/third-party-licences.cjs");

// Security review 13: THIRD_PARTY_LICENSES.txt beside each bundle (the licences of the libraries in it).
// UX-R16: Settings shows Lyre's version (src/lyre/version.ts).
const { DefinePlugin } = require("webpack");
const { version } = require("./package.json");

module.exports = [new ForkTsCheckerWebpackPlugin(), new ThirdPartyLicencesPlugin(), new DefinePlugin({ __LYRE_VERSION__: JSON.stringify(version) })];
