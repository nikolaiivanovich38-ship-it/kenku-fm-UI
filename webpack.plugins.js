const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const { ThirdPartyLicencesPlugin } = require("./scripts/third-party-licences.cjs");

// Security review 13: THIRD_PARTY_LICENSES.txt beside each bundle (the licences of the libraries in it).
module.exports = [new ForkTsCheckerWebpackPlugin(), new ThirdPartyLicencesPlugin()];
