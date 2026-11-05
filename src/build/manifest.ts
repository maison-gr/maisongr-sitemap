import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { unfilled } from "../entries.js";
import type { Manifest, Theme } from "../types.js";
import { blocks, scopes } from "./css.js";
import { materialize, type FontSource } from "./fonts.js";
import { gitDates } from "./git-dates.js";
import type { FoundRoute, Skipped } from "./route-rules.js";
import { DEFAULT_PALETTE, palette } from "./palette.js";

export type BuildReport = {
  manifestPath: string;
  routes: number;
  dated: number;
  skipped: Skipped[];
  /** Dynamic routes that need `params` in the route file to be listed. */
  needParams: string[];
  /** Dynamic routes listed from their page's own generateStaticParams (Next.js). */
  fromPages?: string[];
  missedFonts: string[];
  /** The manifest already there could not be read (a merge conflict, say), so it was rebuilt from the project. */
  rebuilt: boolean;
  site?: string;
  locales?: Manifest["locales"];
  theme: Theme;
};

/** What a framework's build step found in the project; the rest is the same for every framework. */
export type ProjectFacts = {
  framework: string;
  manifestPath: string;
  routes: FoundRoute[];
  skipped: Skipped[];
  /** The site's stylesheets, entry points first. */
  stylesheets: string[];
  /** CSS from components' <style> blocks (Astro, Svelte, Vue layouts), read before the stylesheets. */
  inlineStyles?: string[];
  fonts: FontSource[];
  /** Where files the site serves from its root live (public/, static/). */
  publicDir: string;
  name: string;
  icon?: string;
  site?: string;
  locales?: Manifest["locales"];
  basePath?: string;
  trailingSlash?: boolean;
};

export const read = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

/** A stylesheet and the ones it @imports from the project. */
export function withImports(file: string, seen = new Set<string>()): string {
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
export const NON_LATIN = /arabic|hebrew|devanagari|bengali|thai|khmer|\b(jp|sc|tc|kr|hk)\b|japanese|chinese|korean|cyrillic|greek|naskh|kufi/i;

/** The manifest the last build wrote, whose dates a shallow clone keeps. Unreadable counts as none. */
function previousManifest(file: string): { previous: Manifest | null; rebuilt: boolean } {
  if (!existsSync(file)) return { previous: null, rebuilt: false };
  try {
    const m = JSON.parse(read(file)) as Partial<Manifest>;
    if (Array.isArray(m?.routes)) return { previous: m as Manifest, rebuilt: false };
  } catch {
    // Conflict markers or a hand edit: the project itself has everything else.
  }
  return { previous: null, rebuilt: true };
}

/** Dates the routes, reads the theme and writes the manifest. */
export async function writeManifest(root: string, facts: ProjectFacts, options: { offline?: boolean } = {}): Promise<BuildReport> {
  const { previous, rebuilt } = previousManifest(facts.manifestPath);

  // Dates: the newest commit among each route's files; in a shallow clone,
  // the date already in the manifest for a file Git can no longer date.
  const dates = gitDates(root, facts.routes.flatMap((r) => r.files));
  const before = new Map(previous?.routes.map((r) => [r.pattern, r.lastmod]) ?? []);
  const routes = facts.routes
    .map((r) => {
      const own = r.files.map((f) => dates.get(f)).filter((d): d is string => !!d).sort().at(-1);
      const kept = before.get(r.pattern);
      const lastmod = own && kept && kept > own ? kept : own ?? kept;
      return { pattern: r.pattern, ...(lastmod ? { lastmod } : {}) };
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  const css = [...(facts.inlineStyles ?? []), ...facts.stylesheets.map((f) => withImports(f))].join("\n");
  const { light, dark } = scopes(blocks(css));
  const darkPalette = dark.size ? palette(dark, light) : null;
  const { fonts, missed } = await materialize(facts.fonts.filter((s) => !NON_LATIN.test(s.family)), facts.publicDir, options.offline);

  const theme: Theme = {
    name: facts.name,
    light: palette(light) ?? DEFAULT_PALETTE,
    ...(darkPalette ? { dark: darkPalette } : {}),
    fonts,
    ...(facts.icon ? { icon: facts.icon } : {}),
  };

  const manifest: Manifest = {
    version: 1,
    framework: facts.framework,
    ...(facts.site ? { site: facts.site } : {}),
    ...(facts.basePath ? { basePath: facts.basePath } : {}),
    ...(facts.trailingSlash ? { trailingSlash: true } : {}),
    ...(facts.locales ? { locales: facts.locales } : {}),
    routes,
    theme,
  };
  mkdirSync(dirname(facts.manifestPath), { recursive: true });
  writeFileSync(facts.manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return {
    manifestPath: facts.manifestPath,
    routes: routes.length,
    dated: routes.filter((r) => r.lastmod).length,
    skipped: facts.skipped,
    needParams: unfilled(routes, { locales: facts.locales }),
    missedFonts: missed,
    rebuilt,
    site: facts.site,
    locales: facts.locales,
    theme,
  };
}
