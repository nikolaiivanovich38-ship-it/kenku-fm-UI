/**
 * SEC-11: the Content-Security-Policy of the three app pages is pinned here,
 * directive by directive, so an edit to an HTML file cannot silently loosen
 * it. The pages are webpack templates: `<%= ... %>` is evaluated at build time
 * with `webpackConfig.mode`, so each page is checked as built for production
 * and for development (`yarn start`).
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

type Mode = "production" | "development";
type Policy = Record<string, string[]>;

const SRC = path.resolve(__dirname, "../..");

/** Evaluate the `<%= expr %>` parts of a page template the way html-webpack-plugin does. */
function renderTemplate(template: string, mode: Mode): string {
  return template.replace(/<%=([\s\S]+?)%>/g, (_, expression: string) =>
    String(new Function("webpackConfig", `return (${expression});`)({ mode })),
  );
}

function cspMetaTags(html: string): string[] {
  return [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi)].map(
    (match) => match[1],
  );
}

function parsePolicy(content: string): Policy {
  const policy: Policy = {};
  for (const directive of content.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) {
      expect(policy, `directive ${name} appears twice`).not.toHaveProperty(name);
      policy[name] = sources;
    }
  }
  return policy;
}

function pagePolicy(file: string, mode: Mode): Policy {
  const html = renderTemplate(fs.readFileSync(path.join(SRC, file), "utf8"), mode);
  const tags = cspMetaTags(html);
  expect(tags, `${file} must have exactly one CSP meta tag`).toHaveLength(1);
  return parsePolicy(tags[0]);
}

/** Directives every app page shares. */
const COMMON: Policy = {
  "default-src": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "frame-src": ["'none'"],
};

const PRODUCTION: Record<string, Policy> = {
  "index.html": {
    ...COMMON,
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "file:", "https:", "http:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'none'"],
    "connect-src": ["'self'"],
    "worker-src": ["'none'"],
  },
  "player/index.html": {
    ...COMMON,
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "file:", "https:", "http:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "data:", "blob:", "file:", "https:", "http:"],
    "connect-src": ["'self'", "data:", "blob:", "file:", "https:", "http:"],
    "worker-src": ["'none'"],
  },
  "audioCapture/index.html": {
    ...COMMON,
    "script-src": ["'self'", "blob:"],
    "style-src": ["'self'"],
    "img-src": ["'none'"],
    "font-src": ["'none'"],
    "media-src": ["'self'", "blob:"],
    "connect-src": ["'self'", "ws://127.0.0.1:*"],
    "worker-src": ["'none'"],
  },
};

const PAGES = Object.keys(PRODUCTION);

describe("app page Content-Security-Policy (SEC-11)", () => {
  it.each(PAGES)("%s has exactly the expected production policy", (file) => {
    expect(pagePolicy(file, "production")).toEqual(PRODUCTION[file]);
  });

  it.each(PAGES)("%s never allows eval or inline scripts in production", (file) => {
    const scripts = pagePolicy(file, "production")["script-src"];
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("*");
  });

  it.each(PAGES)(
    "%s relaxes only what the development server needs (eval source maps, live reload socket)",
    (file) => {
      const production = PRODUCTION[file];
      const development = pagePolicy(file, "development");
      expect(development).toEqual({
        ...production,
        "script-src": [...production["script-src"], "'unsafe-eval'"],
        "connect-src": [...production["connect-src"], "ws://localhost:*"],
      });
    },
  );

  it.each(PAGES)("%s sets the policy before anything else loads and has no inline script", (file) => {
    const html = fs.readFileSync(path.join(SRC, file), "utf8");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    const firstTag = head.match(/<(?!head>)(\w+)[^>]*>/g) ?? [];
    expect(firstTag[0]).toMatch(/charset/i);
    expect(firstTag[1]).toMatch(/Content-Security-Policy/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son\w+=/i);
  });
});
