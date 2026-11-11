import { relative } from "node:path";
import { trimSlashes } from "./entries.js";

/** What a framework integration passes to the page people see. */
export type PageOptions = {
  /** The site's name on the page. Default what the site's pages say. */
  name?: string;
  /** The "Sitemap by Maison GR" footer line. Default true. */
  credit?: boolean;
  /** The language of the page people see: "en" or "fr". Default the site's own. */
  lang?: string;
};

/** An import specifier from one file to another, relative and with forward slashes, as a bundler resolves it on every system. */
export function specifier(from: string, to: string): string {
  const path = relative(from, to).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * The lines a generated route adds after `manifest` in createSitemap's options, from an
 * integration's own options. The name goes in the theme, beside the config module's theme.
 */
export function pageOptionLines(page: PageOptions): string[] {
  return [
    page.name ? `theme: { ...options.theme, name: ${JSON.stringify(page.name)} }` : "",
    page.credit === false ? "credit: false" : "",
    page.lang ? `lang: ${JSON.stringify(page.lang)}` : "",
  ].filter(Boolean);
}

/** The imports a generated route starts with: the handler, the manifest, and the person's config module or an empty one, each as the bundler should resolve it. */
export function routeImports(manifest: string, config?: string): string {
  return `import { createSitemap } from "maisongr-sitemap";
import manifest from ${JSON.stringify(manifest)};
${config ? `import options from ${JSON.stringify(config)};` : "const options = {};"}`;
}

/** The site's public address with its base path: what each address in a static build starts with. */
export function staticSite(site: string, base?: string): string {
  // Slashes trimmed by counting, not by a regex, which a long run of "/" in a config could make slow.
  let start = 0;
  while (base && base.charCodeAt(start) === 47) start++;
  const path = base ? trimSlashes(base.slice(start)) : "";
  return `${trimSlashes(site)}${path ? `/${path}` : ""}`;
}
