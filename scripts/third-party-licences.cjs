/**
 * Licence notices of the libraries webpack bundles (security review 13). Webpack copies a library's code into
 * Lyre's bundles and drops the package around it, its LICENSE file included, though MIT and similar licences ask
 * for the notice to travel with the code. `ThirdPartyLicencesPlugin` writes THIRD_PARTY_LICENSES.txt beside each
 * bundle: every package from node_modules that went into it, its version, its licence and the licence text.
 * Libraries kept outside the bundles (externals: opusscript, ffmpeg-static…) ship their own folder and files.
 */
const fs = require("fs");
const path = require("path");

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const OUTPUT = "THIRD_PARTY_LICENSES.txt";

/** The folder of the package that holds `file` (the nearest package.json with a name, under node_modules). */
function packageRootOf(file) {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return null;
  const scoped = parts[at + 1]?.startsWith("@");
  const end = at + (scoped ? 3 : 2);
  if (parts.length < end) return null;
  return parts.slice(0, end).join(path.sep);
}

/** One entry per package among `resources` (module file paths), in name order. */
function licenceEntries(resources) {
  const roots = new Set();
  for (const resource of resources) {
    if (typeof resource !== "string") continue;
    const root = packageRootOf(resource.split("?")[0]);
    if (root) roots.add(root);
  }
  const entries = [];
  for (const root of roots) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    } catch {
      continue;
    }
    let text = "";
    try {
      const file = fs.readdirSync(root).filter((name) => LICENCE_FILE.test(name)).sort()[0];
      if (file) text = fs.readFileSync(path.join(root, file), "utf8").trim();
    } catch {
      // No readable licence file: the licence's name below is all there is.
    }
    const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "see the package");
    entries.push({ name: pkg.name ?? path.basename(root), version: pkg.version ?? "", license, text });
  }
  const seen = new Set();
  return entries
    .filter((entry) => {
      const key = `${entry.name}@${entry.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenceText(entries) {
  const head = "Libraries included in this part of Lyre, with their licences.\n";
  return [head, ...entries.map((e) => `${"=".repeat(72)}\n${e.name}@${e.version} (${e.license})\n\n${e.text}\n`)].join("\n");
}

class ThirdPartyLicencesPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap("ThirdPartyLicencesPlugin", (compilation) => {
      compilation.hooks.processAssets.tap({ name: "ThirdPartyLicencesPlugin", stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        const resources = [];
        for (const module of compilation.modules) {
          for (const inner of [module, ...(module.modules ?? [])]) if (inner.resource) resources.push(inner.resource);
        }
        compilation.emitAsset(OUTPUT, new sources.RawSource(licenceText(licenceEntries(resources))));
      });
    });
  }
}

module.exports = { ThirdPartyLicencesPlugin, licenceEntries, licenceText, packageRootOf, OUTPUT };
