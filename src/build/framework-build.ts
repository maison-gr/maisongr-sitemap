import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Manifest } from "../types.js";
import { astroRoutes } from "./astro-routes.js";
import { cssFonts } from "./css-fonts.js";
import { ASTRO_CONFIGS, configOf, NUXT_CONFIGS, SVELTE_CONFIGS, type Detected } from "./detect.js";
import { read, writeManifest, type BuildReport, type ProjectFacts } from "./manifest.js";
import { nuxtRoutes } from "./nuxt-routes.js";
import { filesIn, findIcon, findLocales, findName, findSite, sourceFiles, styleBlocks } from "./project.js";
import { toPosix, type FoundRoute } from "./route-rules.js";
import { svelteRoutes } from "./svelte-routes.js";

type Server = Extract<Detected, { kind: "astro" | "sveltekit" | "nuxt" }>;

const CSS = /\.css$/;
const CODE = /\.(ts|tsx|js|jsx|mjs|astro|svelte|vue)$/;

/** Where each framework's sitemap route keeps its manifest. */
export function manifestPathFor(root: string, detected: Server): string {
  if (detected.kind === "astro") return join(root, "src", "sitemap.manifest.json");
  if (detected.kind === "sveltekit") return join(root, detected.routesDir, "sitemap.xml", "manifest.json");
  return join(root, "server", "sitemap.manifest.json");
}

/** Languages, when the routes carry them in a first [locale] or [lang] segment. */
function localesOf(routes: FoundRoute[], files: string[]): Manifest["locales"] {
  return routes.some((r) => /^\/\[(locale|lang)\]/.test(r.pattern)) ? findLocales(files) : undefined;
}

const firstMatch = (source: string, ...patterns: RegExp[]) => patterns.map((p) => source.match(p)?.[1]).find(Boolean);
const httpSite = (url: string | undefined) => (url && !/localhost|127\.0\.0\.1|example\.com/.test(url) ? url.replace(/\/+$/, "") : undefined);
const base = (path: string | undefined) => (path && path !== "/" ? `/${path.replace(/^\/+|\/+$/g, "")}` : undefined);

/** The facts every framework shares: stylesheets and fonts from its source directories. */
function themeFacts(root: string, dirs: string[], layouts: string[], publicDir: string, astroConfig?: string) {
  const stylesheets = dirs.flatMap((d) => filesIn(root, d, CSS));
  const inlineStyles = layouts.filter(existsSync).map((f) => styleBlocks(read(f)));
  const code = dirs.flatMap((d) => filesIn(root, d, CODE));
  const fonts = cssFonts({
    root,
    stylesheets: [...layouts.filter(existsSync).map((file, i) => ({ file, css: inlineStyles[i] ?? "" })), ...stylesheets.map((file) => ({ file, css: read(file) }))],
    sources: code.map(read),
    publicDir,
    astroConfig,
  });
  return { stylesheets, inlineStyles, fonts };
}

function astroFacts(root: string, detected: Extract<Server, { kind: "astro" }>): ProjectFacts {
  const config = configOf(root, ASTRO_CONFIGS)?.source ?? "";
  const publicDir = join(root, "public");
  const { routes, skipped } = astroRoutes(root, detected.pagesDir);
  const layouts = [...filesIn(root, "src/layouts", /\.astro$/), join(root, detected.pagesDir, "index.astro")];
  const files = sourceFiles(root);
  return {
    framework: "astro",
    manifestPath: manifestPathFor(root, detected),
    routes,
    skipped,
    ...themeFacts(root, ["src"], layouts, publicDir, config),
    publicDir,
    name: findName(root, layouts.filter(existsSync).map(read).join("\n")),
    icon: findIcon(root, undefined, publicDir),
    site: findSite([]) ?? httpSite(firstMatch(config, /\bsite\s*:\s*["'](https?:\/\/[^"']+)["']/)) ?? findSite(files),
    basePath: base(firstMatch(config, /\bbase\s*:\s*["']([^"']+)["']/)),
    trailingSlash: /\btrailingSlash\s*:\s*["']always["']/.test(config),
    locales: localesOf(routes, files),
  };
}

function svelteFacts(root: string, detected: Extract<Server, { kind: "sveltekit" }>): ProjectFacts {
  const config = configOf(root, SVELTE_CONFIGS)?.source ?? "";
  const publicDir = join(root, "static");
  const { routes, skipped } = svelteRoutes(root, detected.routesDir);
  const rootLayout = join(root, detected.routesDir, "+layout.svelte");
  // trailingSlash is a page option, set for the whole app in the root layout's load file.
  const layoutOptions = ["+layout.ts", "+layout.js", "+layout.server.ts", "+layout.server.js"].map((n) => read(join(root, detected.routesDir, n))).join("\n");
  const files = sourceFiles(root);
  return {
    framework: "sveltekit",
    manifestPath: manifestPathFor(root, detected),
    routes,
    skipped,
    ...themeFacts(root, ["src"], [rootLayout], publicDir),
    publicDir,
    name: findName(root, `${read(join(root, "src", "app.html"))}\n${read(rootLayout)}`),
    icon: findIcon(root, undefined, publicDir),
    site: findSite(files),
    basePath: base(firstMatch(config, /\bpaths\s*:\s*\{[^}]*\bbase\s*:\s*["']([^"']+)["']/)),
    trailingSlash: /\btrailingSlash\s*=\s*["']always["']/.test(layoutOptions),
    locales: localesOf(routes, files),
  };
}

function nuxtFacts(root: string, detected: Extract<Server, { kind: "nuxt" }>): ProjectFacts {
  const config = configOf(root, NUXT_CONFIGS)?.source ?? "";
  const publicDir = join(root, "public");
  const srcDir = existsSync(join(root, "app")) ? "app" : ".";
  const appVue = join(root, srcDir, "app.vue");
  let { routes, skipped } = nuxtRoutes(root, detected.pagesDir);
  // With no pages directory, app.vue is the whole site: one page at "/".
  if (!existsSync(join(root, detected.pagesDir)) && existsSync(appVue)) routes = [{ pattern: "/", files: [toPosix(relative(root, appVue))] }];
  const layouts = [appVue, ...filesIn(root, join(srcDir, "layouts"), /\.vue$/)];
  const files = sourceFiles(root);
  return {
    framework: "nuxt",
    manifestPath: manifestPathFor(root, detected),
    routes,
    skipped,
    ...themeFacts(root, srcDir === "app" ? ["app"] : ["assets", "layouts", "components"], layouts, publicDir),
    publicDir,
    name: findName(root, `${config}\n${read(appVue)}`),
    icon: findIcon(root, undefined, publicDir),
    site: findSite([]) ?? httpSite(firstMatch(config, /\bsite\s*:\s*\{[^}]*\burl\s*:\s*["'](https?:\/\/[^"']+)["']/, /\bsiteUrl\s*:\s*["'](https?:\/\/[^"']+)["']/)) ?? findSite(files),
    basePath: base(firstMatch(config, /\bbaseURL\s*:\s*["']([^"']+)["']/)),
    locales: localesOf(routes, files),
  };
}

/** Builds the manifest for an Astro, SvelteKit or Nuxt site that runs a server. */
export function buildFramework(root: string, detected: Server, options: { offline?: boolean } = {}): Promise<BuildReport> {
  const facts = detected.kind === "astro" ? astroFacts(root, detected) : detected.kind === "sveltekit" ? svelteFacts(root, detected) : nuxtFacts(root, detected);
  return writeManifest(root, facts, options);
}
