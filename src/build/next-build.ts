import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "../types.js";
import type { Detected } from "./detect.js";
import { nextFonts } from "./fonts.js";
import { read, writeManifest, type BuildReport } from "./manifest.js";
import { appRoutes, pagesRoutes } from "./next-routes.js";
import { cssFiles, findIcon, findLocales, findName, findSite, sourceFiles } from "./project.js";

export type { BuildReport };

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

const NEXT_CONFIGS = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];

/**
 * basePath and trailingSlash as next.config writes them. Without them every
 * listed address would redirect, which Search Console reports as an error.
 * A value computed at runtime (basePath: process.env.X) is not read: pass it
 * to the route instead.
 */
export function nextConfigOf(root: string): { basePath?: string; trailingSlash?: boolean } {
  const file = NEXT_CONFIGS.map((f) => join(root, f)).find(existsSync);
  const src = file ? read(file).replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, "$1") : "";
  const basePath = src.match(/\bbasePath\s*:\s*["'](\/[^"']*?)\/?["']/)?.[1];
  const trailingSlash = /\btrailingSlash\s*:\s*true\b/.test(src);
  return { ...(basePath ? { basePath } : {}), ...(trailingSlash ? { trailingSlash } : {}) };
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

  // Routes, from both routers when the project has both.
  const app = detected.appDir ? appRoutes(root, detected.appDir) : { routes: [], skipped: [] };
  const pages = detected.pagesDir ? pagesRoutes(root, detected.pagesDir) : { routes: [], skipped: [] };
  const routes = [...app.routes, ...pages.routes.filter((p) => !app.routes.some((a) => a.pattern === p.pattern))];

  const files = sourceFiles(root);
  const layout = layoutOf(root, detected.appDir);
  // Fonts from wherever next/font is called, the root layout first.
  const fontFiles = [...(layout ? [layout] : []), ...files.filter((f) => f !== layout && read(f).includes("next/font/"))];

  return writeManifest(
    root,
    {
      framework: "next",
      manifestPath: manifestPathOf(root, appDir),
      routes,
      skipped: [...app.skipped, ...pages.skipped],
      stylesheets: cssFiles(root, layout),
      fonts: fontFiles.flatMap((f) => nextFonts(read(f), dirname(f))),
      publicDir: join(root, "public"),
      name: findName(root, layout ? read(layout) : ""),
      icon: findIcon(root, detected.appDir),
      site: findSite(files),
      locales: localesOf(root, routes, files),
      ...nextConfigOf(root),
    },
    options,
  );
}
