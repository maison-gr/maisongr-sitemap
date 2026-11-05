import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { toPosix, type FoundRoute } from "./route-rules.js";
import type { Manifest } from "../types.js";
import type { Detected } from "./detect.js";
import { nextFonts } from "./fonts.js";
import { read, writeManifest, type BuildReport } from "./manifest.js";
import { appRoutes, pagesRoutes } from "./next-routes.js";
import { cssFiles, findHreflang, findIcon, findLocales, findName, findSite, sourceFiles } from "./project.js";

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
  if (!found) return undefined;
  const hreflang = findHreflang(files, found.list);
  return { ...found, ...(prefixed ? { prefix: true } : {}), ...(hreflang ? { hreflang } : {}) };
}

/**
 * Paths the middleware keeps for signed-in visitors, from a list it names for
 * that: const PROTECTED = ["/dashboard", "/session"]. Crawlers are never signed
 * in, so for them every page under one of these is a redirect to the login.
 */
export function protectedPaths(root: string): string[] {
  const file = MIDDLEWARE.map((f) => join(root, f)).find(existsSync);
  if (!file) return [];
  const paths: string[] = [];
  for (const m of read(file).matchAll(/\b(?:const|let|var)\s+\w*(?:PROTECTED|PRIVATE|AUTH_REQUIRED|REQUIRES_AUTH|AUTHENTICATED|MEMBERS_ONLY)\w*\s*(?::[^=]+)?=\s*\[([^\]]*)\]/gi)) {
    for (const p of m[1]!.matchAll(/["'](\/[^"']*)["']/g)) paths.push(p[1]!.replace(/\/+$/, "") || "/");
  }
  return [...new Set(paths)].filter((p) => p !== "/");
}

/** The protected path a route falls under, its language segment set aside. */
function underProtected(pattern: string, paths: string[]): string | undefined {
  const path = pattern.replace(/^\/\[(locale|lang)\]/, "") || "/";
  return paths.find((p) => path === p || path.startsWith(`${p}/`));
}

const NEXT_CONFIGS =["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];

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

/**
 * Next.js 16's cacheComponents (dynamicIO before it) refuses a route's
 * `dynamic` export; a route that reads the request is rendered on each
 * request there without it.
 */
export function usesCacheComponents(root: string): boolean {
  const file = NEXT_CONFIGS.map((f) => join(root, f)).find(existsSync);
  const src = file ? read(file).replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, "$1") : "";
  return /\b(cacheComponents|dynamicIO)\s*:\s*true\b/.test(src);
}

const LAYOUTS = ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"];

/**
 * The layout that sets the site's fonts and name: the root one, or, in an
 * app with no root layout, the one in a first [lang], [locale] or (group) folder.
 */
export function layoutOf(root: string, appDir?: string): string | undefined {
  if (!appDir) return undefined;
  const base = join(root, appDir);
  const own = LAYOUTS.map((n) => join(base, n)).find(existsSync);
  if (own || !existsSync(base)) return own;
  for (const dir of readdirSync(base).sort()) {
    if (!/^(\[(lang|locale)\]|\(.+\))$/.test(dir)) continue;
    const nested = LAYOUTS.map((n) => join(base, dir, n)).find(existsSync);
    if (nested) return nested;
  }
  return undefined;
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
  const found = [...app.routes, ...pages.routes.filter((p) => !app.routes.some((a) => a.pattern === p.pattern))];
  // Pages the middleware sends signed-out visitors (crawlers among them) away from.
  const guarded = protectedPaths(root);
  const signedIn = found.flatMap((r) => {
    const path = underProtected(r.pattern, guarded);
    return path ? [{ pattern: r.pattern, reason: `signed-in only (${path})` }] : [];
  });
  const routes = found.filter((r) => !signedIn.some((s) => s.pattern === r.pattern));

  const files = sourceFiles(root);
  const layout = layoutOf(root, detected.appDir);
  // Fonts from wherever next/font is called, the root layout first.
  const fontFiles = [...(layout ? [layout] : []), ...files.filter((f) => f !== layout && read(f).includes("next/font/"))];

  const report = await writeManifest(
    root,
    {
      framework: "next",
      manifestPath: manifestPathOf(root, appDir),
      routes,
      skipped: [...app.skipped, ...pages.skipped, ...signedIn],
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

  // Dynamic pages that already list their values, through generateStaticParams, need nothing from the route file.
  const fromPages = routes.filter((r) => report.needParams.includes(r.pattern) && r.page && STATIC_PARAMS.test(read(join(root, r.page))));
  writeParamsFile(root, appDir, fromPages);
  return { ...report, needParams: report.needParams.filter((p) => !fromPages.some((r) => r.pattern === p)), fromPages: fromPages.map((r) => r.pattern) };
}

/** export function generateStaticParams, export async function…, or export const generateStaticParams = … */
const STATIC_PARAMS = /\bexport\s+(?:async\s+)?(?:function\s+generateStaticParams\b|const\s+generateStaticParams\s*=)/;

/** The file beside the route that hands each dynamic page's generateStaticParams to the sitemap, rewritten on every build. */
export function paramsPathOf(root: string, appDir: string) {
  const ts = existsSync(join(root, "tsconfig.json"));
  return join(root, appDir, "sitemap.xml", ts ? "params.ts" : "params.js");
}

function writeParamsFile(root: string, appDir: string, routes: FoundRoute[]) {
  const file = paramsPathOf(root, appDir);
  const ts = file.endsWith(".ts");
  const lines = routes.map((r) => {
    const spec = toPosix(relative(dirname(file), join(root, r.page!))).replace(/\.(tsx|ts|jsx|js)$/, "");
    return `  ${JSON.stringify(r.pattern)}: staticParams(() => import(${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)})),`;
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `// Written by \`maisongr-sitemap build\` before each build: each dynamic page's own generateStaticParams,
// so its addresses are listed with nothing to keep in sync. Don't edit it; give other values in route${ts ? ".ts" : ".js"} with \`params\`.
import { staticParams } from "maisongr-sitemap/next";

export const pageParams = {
${lines.join("\n")}
};
`,
  );
}
