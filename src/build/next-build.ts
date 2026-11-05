import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { unfilled } from "../entries.js";
import type { Manifest, Theme } from "../types.js";
import { blocks, scopes } from "./css.js";
import type { Detected } from "./detect.js";
import { materialize, nextFonts } from "./fonts.js";
import { gitDates } from "./git-dates.js";
import { appRoutes, pagesRoutes, type Skipped } from "./next-routes.js";
import { DEFAULT_PALETTE, palette } from "./palette.js";
import { cssFiles, findIcon, findLocales, findName, findSite, sourceFiles } from "./project.js";

export type BuildReport = {
  manifestPath: string;
  routes: number;
  dated: number;
  skipped: Skipped[];
  /** Dynamic routes that need `params` in the route file to be listed. */
  needParams: string[];
  missedFonts: string[];
  site?: string;
  locales?: Manifest["locales"];
  theme: Theme;
};

const read = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

/** A stylesheet and the ones it @imports from the project. */
function withImports(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  const css = read(file);
  const imported = [...css.matchAll(/@import\s+(?:url\()?["']([^"']+\.css)["']/g)]
    .map((m) => resolve(dirname(file), m[1]!))
    .filter(existsSync)
    .map((f) => withImports(f, seen));
  return [...imported, css].join("\n");
}

/** Fonts for other scripts: the page shows Latin paths, so it takes the site's Latin cuts. */
const NON_LATIN = /arabic|hebrew|devanagari|bengali|thai|khmer|\b(jp|sc|tc|kr|hk)\b|japanese|chinese|korean|cyrillic|greek|naskh|kufi/i;

const MIDDLEWARE = ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js", "src/middleware.ts", "src/middleware.js", "src/proxy.ts", "src/proxy.js"];

/**
 * The site's languages: for routes under a [locale] folder, or, with no such
 * folder, when the middleware puts every page under /{language}/.
 */
function localesOf(root: string, routes: { pattern: string }[], files: string[]): Manifest["locales"] {
  const segmented = routes.some((r) => /^\/\[(locale|lang)\]/.test(r.pattern));
  const middleware = MIDDLEWARE.map((f) => join(root, f)).find(existsSync);
  const prefixed = !segmented && !!middleware && /locale/i.test(read(middleware));
  if (!segmented && !prefixed) return undefined;
  const found = findLocales(files);
  return found ? { ...found, ...(prefixed ? { prefix: true } : {}) } : undefined;
}

export function layoutOf(root: string, appDir?: string): string | undefined {
  if (!appDir) return undefined;
  return ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map((n) => join(root, appDir, n)).find(existsSync);
}

export function manifestPathOf(root: string, appDir: string) {
  return join(root, appDir, "sitemap.xml", "manifest.json");
}

export async function buildNext(
  root: string,
  detected: Extract<Detected, { kind: "next" }>,
  options: { offline?: boolean } = {},
): Promise<BuildReport> {
  const appDir = detected.appDir ?? (detected.srcDir ? "src/app" : "app");
  const manifestPath = manifestPathOf(root, appDir);
  const previous: Manifest | null = existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : null;

  // Routes, from both routers when the project has both.
  const app = detected.appDir ? appRoutes(root, detected.appDir) : { routes: [], skipped: [] };
  const pages = detected.pagesDir ? pagesRoutes(root, detected.pagesDir) : { routes: [], skipped: [] };
  const found = [...app.routes, ...pages.routes.filter((p) => !app.routes.some((a) => a.pattern === p.pattern))];

  // Dates: the newest commit among each route's files; in a shallow clone,
  // the date already in the manifest for a file Git can no longer date.
  const dates = gitDates(root, found.flatMap((r) => r.files));
  const before = new Map(previous?.routes.map((r) => [r.pattern, r.lastmod]) ?? []);
  const routes = found
    .map((r) => {
      const own = r.files.map((f) => dates.get(f)).filter((d): d is string => !!d).sort().at(-1);
      const kept = before.get(r.pattern);
      const lastmod = own && kept && kept > own ? kept : own ?? kept;
      return { pattern: r.pattern, ...(lastmod ? { lastmod } : {}) };
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  // The project's own facts.
  const files = sourceFiles(root);
  const layout = layoutOf(root, detected.appDir);
  const layoutSource = layout ? read(layout) : "";
  const locales = localesOf(root, routes, files);
  const site = findSite(files);

  // The theme: colours from the stylesheets, fonts from wherever next/font is called (layout first).
  const css = cssFiles(root, layout).map((f) => withImports(f)).join("\n");
  const { light, dark } = scopes(blocks(css));
  const lightPalette = palette(light) ?? DEFAULT_PALETTE;
  const darkPalette = dark.size ? palette(dark, light) : null;
  const fontFiles = [...(layout ? [layout] : []), ...files.filter((f) => f !== layout && read(f).includes("next/font/"))];
  const sources = fontFiles.flatMap((f) => nextFonts(read(f), dirname(f))).filter((s) => !NON_LATIN.test(s.family));
  const { fonts, missed } = await materialize(sources, join(root, "public"), options.offline);

  const theme: Theme = {
    name: findName(root, layoutSource),
    light: lightPalette,
    ...(darkPalette ? { dark: darkPalette } : {}),
    fonts,
    ...(findIcon(root, detected.appDir) ? { icon: findIcon(root, detected.appDir) } : {}),
  };

  const manifest: Manifest = {
    version: 1,
    framework: "next",
    ...(site ? { site } : {}),
    ...(locales ? { locales } : {}),
    routes,
    theme,
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return {
    manifestPath,
    routes: routes.length,
    dated: routes.filter((r) => r.lastmod).length,
    skipped: [...app.skipped, ...pages.skipped],
    needParams: unfilled(routes, { locales }),
    missedFonts: missed,
    site,
    locales,
    theme,
  };
}
