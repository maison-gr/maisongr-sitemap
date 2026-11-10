import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { trimSlashes } from "./entries.js";
import { styleBlocks } from "./build/project.js";
import { spaRoutes } from "./build/spa-routes.js";
import { htmlLang, sitemapFiles, themeOf } from "./build/static.js";
import type { Entry } from "./types.js";

export type ViteSitemapOptions = {
  /** The address the site is served at, as in the build script's --site. */
  site: string;
  /** Addresses the router does not declare, as in --add. */
  add?: string[];
  name?: string;
  credit?: boolean;
  /** The page's language. Default the one index.html declares in <html lang>. */
  lang?: string;
};

/** The few parts of Vite's dev server the plugin uses, so Vite need not be a dependency. */
type DevServer = {
  config: { root: string };
  middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void };
};

const TYPES: Record<string, string> = {
  xml: "application/xml; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

/** Every .css file under a folder, skipping dependencies and hidden folders. */
function cssUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const full = join(dir, n);
    if (statSync(full).isDirectory()) cssUnder(full, out);
    else if (n.endsWith(".css")) out.push(full);
  }
  return out;
}

/** The files the build writes to dist/, made from the source instead: the router's pages, index.html, src/ and public/ stylesheets. */
export function devSitemapFiles(root: string, options: ViteSitemapOptions): Map<string, string> {
  const base = trimSlashes(options.site);
  const indexFile = join(root, "index.html");
  const home = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "";
  const routes = spaRoutes(root);
  // Every route renders in the one index.html, so each page speaks its language, as the prerendered build says.
  const lang = htmlLang(home);
  const entries: Entry[] = [];
  for (const { path, lastmod } of [...(routes?.paths ?? [{ path: "/" }]), ...(options.add ?? []).map((path) => ({ path, lastmod: undefined }))]) {
    const loc = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    if (!entries.some((e) => e.loc === loc)) entries.push({ loc, ...(lang ? { lang } : {}), ...(lastmod ? { lastmod } : {}) });
  }
  entries.sort((a, b) => a.loc.localeCompare(b.loc));
  const css = [...cssUnder(join(root, "src")), ...cssUnder(join(root, "public"))].map((f) => readFileSync(f, "utf8")).concat(styleBlocks(home)).join("\n");
  const icon = ["favicon.svg", "icon.svg", "favicon.png", "favicon.ico"].find((n) => existsSync(join(root, "public", n)));
  const theme = themeOf({ css, pages: [home], home, icon: icon && `/${icon}`, name: options.name, base });
  return new Map(sitemapFiles(entries, theme, { credit: options.credit, lang: options.lang ?? lang }));
}

/**
 * Serves the sitemap during `vite dev`, where the build's static step never
 * runs and the app's catch-all route would answer /sitemap.xml with its 404.
 *
 *   import { sitemap } from "maisongr-sitemap/vite";
 *
 *   plugins: [react(), sitemap({ site: "https://www.example.com" })]
 *
 * The build keeps writing the real files with `maisongr-sitemap static`.
 * Each request reads the routes again, so a page added in dev shows at once.
 */
export function sitemap(options: ViteSitemapOptions) {
  if (!/^https?:\/\//.test(options?.site ?? "")) throw new Error('maisongr-sitemap/vite: give site the full address, e.g. sitemap({ site: "https://www.example.com" }).');
  return {
    name: "maisongr-sitemap",
    apply: "serve" as const,
    configureServer(server: DevServer) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split(/[?#]/)[0]!.replace(/^\//, "");
        // One address, as the host's rules do in production: the page's own file is never an address people land on.
        if (path === "sitemap" || path === "sitemap/" || path === "sitemap/index.html") {
          res.statusCode = 308;
          res.setHeader("Location", "/sitemap.xml");
          res.end();
          return;
        }
        // Two readers: a browser opening /sitemap.xml gets the page, a crawler the XML (as in the handler).
        const browser = req.headers["sec-fetch-dest"] === "document" && /\btext\/html\b/i.test(String(req.headers.accept ?? ""));
        const file = path === "sitemap.xml" && browser ? "sitemap/index.html" : path;
        if (file !== "sitemap.xml" && file !== "sitemap.css" && !file.startsWith("sitemap/")) return next();
        let body: string | undefined;
        try {
          body = devSitemapFiles(server.config.root, options).get(file);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(`maisongr-sitemap could not build the sitemap: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (body === undefined) return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", TYPES[file.split(".").pop()!]!);
        res.setHeader("Cache-Control", "no-store");
        if (path === "sitemap.xml") res.setHeader("Vary", "Sec-Fetch-Dest");
        if (file === "sitemap/index.html") res.setHeader("X-Robots-Tag", "noindex");
        res.end(req.method === "HEAD" ? undefined : body);
      });
    },
  };
}
