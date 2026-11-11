import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { detect } from "./build/detect.js";
import { buildFramework, manifestPathFor } from "./build/framework-build.js";
import { buildStatic } from "./build/static.js";
import { existingRoutes } from "./cli/routes.js";
import { pageOptionLines, routeImports, staticSite, type PageOptions } from "./integration.js";

export type NuxtSitemapOptions = PageOptions & {
  /** The address the site is served at. Required for `nuxt generate`; a server falls back to the manifest's, then the request's. */
  site?: string;
  /**
   * A module, relative to the project, whose default export holds the route's
   * options: values for dynamic routes, more addresses, more sitemaps, rules.
   * Server builds only; `nuxt generate` lists the pages it wrote.
   */
  config?: string;
  /** `nuxt generate`: list each page's images too. */
  images?: boolean;
};

/** The few parts of Nuxt and Nitro this uses, so neither need be a dependency. */
type Nitro = { options: { static?: boolean; output: { publicDir: string } }; hooks: { hook(name: "prerender:done", fn: () => void): void } };
type Nuxt = {
  options: {
    rootDir: string;
    buildDir: string;
    dev: boolean;
    _generate?: boolean;
    app?: { baseURL?: string };
    nitro?: { static?: boolean; preset?: string; virtual?: Record<string, () => string> };
    serverHandlers: { route: string; handler: string }[];
    site?: { url?: string };
    maisongrSitemap?: NuxtSitemapOptions;
  };
  hook(name: "nitro:init", fn: (nitro: Nitro) => void): void;
};

const NAME = "maisongr-sitemap";
const HANDLER = "#maisongr-sitemap/sitemap.xml.mjs";

/** A path as an import Nitro resolves on every system: absolute, with forward slashes. */
const importPath = (file: string) => file.split("\\").join("/");

/**
 * The handler Nitro serves at /sitemap.xml: the same as the file `init` writes in server/routes,
 * as a virtual module, so nothing is written into the project. The imports are absolute.
 */
export function nuxtRouteSource(manifest: string, config?: string, page: PageOptions = {}, site?: string): string {
  const lines = [...(site ? [`site: ${JSON.stringify(site)}`] : []), ...pageOptionLines(page)];
  return `// maisongr-sitemap's Nuxt module. Edit nuxt.config, not this module.
import * as h3 from "h3";
${routeImports(importPath(manifest), config && importPath(config))}

const sitemap = createSitemap({ ...options, manifest${lines.map((o) => `, ${o}`).join("")} });

// h3 v2 hands over a web Request; h3 v1 (Nuxt 3 and 4) builds one from the event.
export default h3.defineEventHandler((event) => sitemap(event.req instanceof Request ? event.req : h3.toWebRequest(event)));
`;
}

/** A build that writes files only: `nuxt generate`, or a static preset. */
function staticBuild(nuxt: Nuxt): boolean {
  if (nuxt.options.dev) return false;
  const preset = nuxt.options.nitro?.preset ?? process.env.NITRO_PRESET ?? "";
  return !!nuxt.options._generate || !!nuxt.options.nitro?.static || /static|github[-_]pages/.test(preset);
}

/**
 * The sitemap as a Nuxt module:
 *
 *   export default defineNuxtConfig({
 *     modules: ["maisongr-sitemap/nuxt"],
 *     maisongrSitemap: { site: "https://www.example.com" },
 *   });
 *
 * `nuxt build` serves /sitemap.xml from the server: XML for search engines, the
 * designed page for a browser, from a manifest refreshed before each build.
 * `nuxt generate` writes the sitemap into the output once the pages are prerendered,
 * as `maisongr-sitemap static` does. `nuxt dev` serves it either way.
 */
async function nuxtSitemap(inline: NuxtSitemapOptions | undefined, nuxt: Nuxt) {
  // Options from the module's entry ([module, options]) win over the maisongrSitemap key.
  const options: NuxtSitemapOptions = { ...nuxt.options.maisongrSitemap, ...inline };
  const root = nuxt.options.rootDir;
  const detected = detect(root);
  const kind = detected.kind === "nuxt" ? detected : { kind: "nuxt" as const, pagesDir: "app/pages", server: true };
  const own = existingRoutes({ ...kind, server: true }).filter((f) => existsSync(join(root, f)));
  if (own.length) throw new Error(`${NAME}: ${own[0]} already answers /sitemap.xml. Remove it, or remove the module from nuxt.config.`);
  const site = options.site ?? nuxt.options.site?.url;

  if (staticBuild(nuxt)) {
    if (!/^https?:\/\//.test(site ?? "")) {
      throw new Error(`${NAME}: set maisongrSitemap.site in nuxt.config to the address the site is served at, e.g. "https://www.example.com". nuxt generate needs it for every address in the sitemap.`);
    }
    nuxt.hook("nitro:init", (nitro) => {
      nitro.hooks.hook("prerender:done", () => {
        const report = buildStatic(nitro.options.output.publicDir, staticSite(site!, nuxt.options.app?.baseURL), {
          name: options.name,
          credit: options.credit,
          lang: options.lang,
          images: options.images,
        });
        console.info(`[${NAME}] ${report.pages} pages in sitemap.xml, the page people see at /sitemap/`);
      });
    });
    return;
  }

  const manifest = manifestPathFor(root, kind);
  // Dev never rewrites a manifest that exists: it is committed, and its dates and fonts come from the build.
  if (!nuxt.options.dev || !existsSync(manifest)) {
    const report = await buildFramework(root, { ...kind, server: true });
    console.info(`[${NAME}] ${report.routes} routes, ${report.dated} dated from Git`);
    if (report.needParams.length) {
      if (options.config) console.info(`[${NAME}] Dynamic routes, listed with the values ${options.config} gives: ${report.needParams.join(", ")}`);
      else console.warn(`[${NAME}] Dynamic routes not listed until a config module gives their values (maisongrSitemap.config): ${report.needParams.join(", ")}`);
    }
  }
  const config = options.config ? (isAbsolute(options.config) ? options.config : resolve(root, options.config)) : undefined;
  if (config && !existsSync(config)) throw new Error(`${NAME}: the config module ${options.config} was not found.`);
  // A virtual module, as @nuxt/kit's addServerTemplate makes one: a file in the build folder would sit under
  // node_modules/.cache in Nuxt 4, where Nitro leaves it out of the server bundle.
  const source = nuxtRouteSource(manifest, config, options, options.site);
  nuxt.options.nitro ??= {};
  nuxt.options.nitro.virtual = { ...nuxt.options.nitro.virtual, [HANDLER]: () => source };
  nuxt.options.serverHandlers.push({ route: "/sitemap.xml", handler: HANDLER });
}

/** What Nuxt reads before calling the module: its name, and the nuxt.config key its options live under. */
nuxtSitemap.getMeta = () => Promise.resolve({ name: NAME, configKey: "maisongrSitemap" });

export default nuxtSitemap;
