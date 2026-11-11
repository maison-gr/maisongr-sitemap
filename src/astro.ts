import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detect } from "./build/detect.js";
import { buildFramework, manifestPathFor } from "./build/framework-build.js";
import { buildStatic } from "./build/static.js";
import { trimSlashes } from "./entries.js";
import { existingRoutes } from "./cli/routes.js";

export type AstroSitemapOptions = {
  /**
   * A module, relative to the project, whose default export holds the route's
   * options: values for dynamic routes, more addresses, more sitemaps, rules.
   * On-demand sites only; a static build lists the pages it wrote.
   *   export default { params: { "/blog/[slug]": async () => (await getCollection("blog")).map((p) => ({ slug: p.id })) } };
   */
  config?: string;
  /** The site's name on the page. Default what the site's pages say. */
  name?: string;
  /** The "Sitemap by Maison GR" footer line. Default true. */
  credit?: boolean;
  /** The language of the page people see: "en" or "fr". Default the site's own. */
  lang?: string;
  /** Static builds: list each page's images too. */
  images?: boolean;
};

/** The few parts of Astro's integration API this uses, so Astro need not be a dependency. */
type AstroConfig = { root: URL; site?: string; base?: string; adapter?: unknown };
type Logger = { info(message: string): void; warn(message: string): void };
type SetupOptions = {
  config: AstroConfig;
  command: "dev" | "build" | "preview" | "sync";
  injectRoute(route: { pattern: string; entrypoint: string | URL; prerender?: boolean }): void;
  createCodegenDir(): URL;
  logger: Logger;
};

const NAME = "maisongr-sitemap";

/** An import specifier from one file to another, relative and with forward slashes, as Vite resolves it on every system. */
function specifier(from: string, to: string): string {
  const path = relative(from, to).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/** The route Astro renders on demand at /sitemap.xml: the same as the file `init` writes in src/pages, kept out of the project. */
export function astroRouteSource(dir: string, manifest: string, config?: string, page: Pick<AstroSitemapOptions, "name" | "credit" | "lang"> = {}): string {
  // The integration's own options, as the route's. The name goes in the theme, where the handler reads it, beside the config module's theme.
  const own = [
    page.name ? `theme: { ...options.theme, name: ${JSON.stringify(page.name)} }` : "",
    page.credit === false ? "credit: false" : "",
    page.lang ? `lang: ${JSON.stringify(page.lang)}` : "",
  ].filter(Boolean);
  return `// Written by maisongr-sitemap's Astro integration before each build. Edit astro.config, not this file.
import { createSitemap } from "maisongr-sitemap";
import manifest from ${JSON.stringify(specifier(dir, manifest))};
${config ? `import options from ${JSON.stringify(specifier(dir, config))};\n` : "const options = {};\n"}
// The answer depends on the request's Sec-Fetch-Dest header, so it is rendered on demand.
export const prerender = false;

const sitemap = createSitemap({ ...options, manifest${own.map((o) => `, ${o}`).join("")} });

export const GET = ({ request }) => sitemap(request);
`;
}

/** The site's public address with its base path: what each address in a static build starts with. */
export function staticSite(site: string, base?: string): string {
  const path = base && base !== "/" ? `/${base.replace(/^\/+|\/+$/g, "")}` : "";
  return `${trimSlashes(site)}${path}`;
}

/**
 * The sitemap as an Astro integration:
 *
 *   import sitemap from "maisongr-sitemap/astro";
 *
 *   export default defineConfig({ site: "https://www.example.com", integrations: [sitemap()] });
 *
 * With an adapter, /sitemap.xml is rendered on demand: XML for search engines,
 * the designed page for a browser, and the manifest is refreshed before each build.
 * Without one, the sitemap is written into the build output after `astro build`,
 * as `maisongr-sitemap static` does.
 */
export default function sitemap(options: AstroSitemapOptions = {}) {
  let site: string | undefined;
  let base: string | undefined;
  let onDemand = false;
  return {
    name: NAME,
    hooks: {
      "astro:config:setup": async ({ config, command, injectRoute, createCodegenDir, logger }: SetupOptions) => {
        if (command === "sync" || command === "preview") return;
        const root = fileURLToPath(config.root);
        const detected = detect(root);
        const astro = detected.kind === "astro" ? detected : { kind: "astro" as const, pagesDir: "src/pages", server: false };
        const own = existingRoutes({ ...astro, server: true }).filter((f) => existsSync(join(root, f)));
        if (own.length) throw new Error(`${NAME}: ${own[0]} already answers /sitemap.xml. Remove it, or remove the integration from astro.config.`);

        site = config.site;
        base = config.base;
        onDemand = !!config.adapter;
        if (!onDemand && command === "build" && !/^https?:\/\//.test(site ?? "")) {
          throw new Error(`${NAME}: set site in astro.config to the address the site is served at, e.g. site: "https://www.example.com". A static build needs it for every address in the sitemap.`);
        }
        // A static build is read once it is written. On demand, and in dev, the route answers from the manifest.
        if (!onDemand && command === "build") return;

        const manifest = manifestPathFor(root, astro);
        // Dev never rewrites a manifest that exists: it is committed, and its dates and fonts come from the build.
        if (command === "build" || !existsSync(manifest)) {
          const report = await buildFramework(root, { ...astro, server: true });
          logger.info(`${report.routes} routes, ${report.dated} dated from Git`);
          if (report.needParams.length) logger.warn(`Dynamic routes not listed until the config module gives their values: ${report.needParams.join(", ")}`);
        }
        const config_ = options.config ? (isAbsolute(options.config) ? options.config : resolve(root, options.config)) : undefined;
        if (config_ && !existsSync(config_)) throw new Error(`${NAME}: the config module ${options.config} was not found.`);
        const dir = fileURLToPath(createCodegenDir());
        const route = join(dir, "sitemap.xml.mjs");
        writeFileSync(route, astroRouteSource(dir, manifest, config_, options));
        injectRoute({ pattern: "/sitemap.xml", entrypoint: pathToFileURL(route), prerender: false });
      },
      "astro:build:done": ({ dir, logger }: { dir: URL; logger: Logger }) => {
        if (onDemand) return;
        const report = buildStatic(fileURLToPath(dir), staticSite(site!, base), {
          name: options.name,
          credit: options.credit,
          lang: options.lang,
          images: options.images,
        });
        logger.info(`${report.pages} pages in sitemap.xml, the page people see at /sitemap/`);
      },
    },
  };
}

export { sitemap };
