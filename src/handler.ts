import { dateOf, expand, linkFolders, matches, trimSlashes, type DateLike, type ExpandOptions, type Locales } from "./entries.js";
import { DEFAULT_PALETTE } from "./build/palette.js";
import { indexPage, pageCss, PAGE_JS, urlsetPage, xmlCss } from "./page.js";
import type { Entry, Manifest, Palette, Theme } from "./types.js";
import { indexXml, MAX_URLS, newest, urlsetXml } from "./xml.js";

export type SitemapOptions = {
  /**
   * What the build step wrote (manifest.json): routes, their dates, and the theme. Checked when the route loads.
   * Without one, the sitemap lists `entries` alone, in a neutral theme `theme` can adjust.
   */
  manifest?: Manifest | Record<string, unknown>;
  /** The address the site is served at, e.g. "https://www.example.com". Defaults to the manifest's, then the request's origin. */
  site?: string;
  locales?: Locales;
  /** Values for dynamic routes, keyed by pattern: { "/blog/[slug]": async () => [{ slug: "hello" }] }. */
  params?: ExpandOptions["params"];
  /** Addresses no route file describes. A `loc` may be a path ("/press"), resolved against `site`. */
  entries?: () => EntryInput[] | Promise<EntryInput[]>;
  /**
   * More sitemaps, by name: { companies: async () => [...] }. /sitemap.xml then
   * becomes their index, with the routes and `entries` as "pages", and each one
   * at /sitemap.xml?sitemap=<name>, which Search Console reports on separately.
   */
  sitemaps?: Record<string, () => EntryInput[] | Promise<EntryInput[]>>;
  /** Paths to leave out, from routes and `entries` alike: exact paths, prefixes ("/drafts/") or patterns. */
  exclude?: (string | RegExp)[];
  /** The site serves "/about/" rather than "/about". Defaults to the manifest's (Next.js `trailingSlash`). */
  trailingSlash?: boolean;
  /** The path the site is mounted under, e.g. "/docs". Defaults to the manifest's (Next.js `basePath`). */
  basePath?: string;
  /** Seconds the list of addresses is kept before params and entries run again. Default 3600. */
  revalidate?: number;
  /** Overrides for what was read from the site. */
  theme?: Partial<Omit<Theme, "light" | "dark">> & { light?: Partial<Palette>; dark?: Partial<Palette> };
  /** The "Sitemap by Maison GR" footer line. Default true. */
  credit?: boolean;
};

/** An address given through `entries`, its date in any form `DateLike` takes. */
export type EntryInput = Omit<Entry, "lastmod"> & { lastmod?: DateLike };

const VARY = { Vary: "Sec-Fetch-Dest" };

function respond(body: string, type: string, headers: Record<string, string> = {}) {
  return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, ...headers } });
}

function mergeTheme(base: Theme, over: SitemapOptions["theme"]): Theme {
  if (!over) return base;
  return {
    ...base,
    ...over,
    light: { ...base.light, ...over.light },
    dark: base.dark || over.dark ? ({ ...base.light, ...base.dark, ...over.dark } as Palette) : undefined,
    fonts: over.fonts ?? base.fonts,
  };
}

/** For a server with no build step: no routes of its own, a neutral theme, the name taken from the address. */
const BARE: Manifest = { version: 1, framework: "custom", routes: [], theme: { name: "", light: DEFAULT_PALETTE, fonts: [] } };

/** The manifest as the build step writes it; anything else is a setup mistake worth naming. */
function asManifest(value: unknown): Manifest {
  if (value === undefined) return BARE;
  const m = value as Partial<Manifest> | null;
  if (!m || m.version !== 1 || !Array.isArray(m.routes) || !m.theme?.light) {
    throw new Error("maisongr-sitemap: the manifest is missing or from another version. Run `maisongr-sitemap build`.");
  }
  return m as Manifest;
}

const hostOf = (site: string) => new URL(site).hostname.replace(/^www\./, "");

/**
 * One address, two readers. A browser opening the sitemap announces a page
 * visit with `Sec-Fetch-Dest: document` and gets the designed page; crawlers
 * never send it and get the XML. Both list exactly the same addresses (one
 * file presented two ways, not cloaking); the page is noindex, and Vary keeps
 * any cache from handing one to the other.
 */
export function createSitemap(options: SitemapOptions = {}): (request: Request) => Promise<Response> {
  const manifest = asManifest(options.manifest);
  const theme = mergeTheme(manifest.theme, options.theme);
  const ttl = (options.revalidate ?? 3600) * 1000;
  const trailingSlash = options.trailingSlash ?? manifest.trailingSlash;
  const basePath = trimSlashes(options.basePath ?? manifest.basePath ?? "") || undefined;
  const page = { credit: options.credit, home: basePath || "/" };
  let cache: { at: number; site: string; groups: Promise<Map<string, Entry[]>> } | undefined;
  const names = Object.keys(options.sitemaps ?? {});
  for (const name of names) {
    if (name === "pages" || !/^[\w-]+$/.test(name)) throw new Error(`maisongr-sitemap: "${name}" can't name a sitemap: use letters, digits, - and _, and not "pages", which the routes use.`);
  }

  /** An address's path as routes and `exclude` write it: without the basePath. */
  const ownPath = (loc: string) => {
    const path = new URL(loc).pathname;
    const under = basePath && (path === basePath || path.startsWith(`${basePath}/`));
    return under ? path.slice(basePath.length) || "/" : path;
  };

  /** Addresses as given, made absolute and dated, without the excluded ones. */
  const normalize = (list: EntryInput[], site: string, from: string): Entry[] =>
    list
      .map(({ lastmod, ...e }) => {
        const loc = e.loc.startsWith("/") ? `${site}${e.loc}` : e.loc;
        if (!URL.canParse(loc)) throw new Error(`maisongr-sitemap: ${from} gave "${e.loc}", which is neither an address nor a path.`);
        const day = dateOf(lastmod);
        return day ? { ...e, loc, lastmod: day } : { ...e, loc };
      })
      .filter((e) => !matches(ownPath(e.loc), options.exclude ?? []));

  /** The sitemaps by name: "pages" (routes and `entries`), then each of `sitemaps`. */
  const load = (site: string) => {
    if (!cache || cache.site !== site || Date.now() - cache.at > ttl) {
      const groups = (async () => {
        const locales = options.locales ?? manifest.locales;
        const fromRoutes = await expand(manifest.routes, { ...options, locales, site, trailingSlash, basePath });
        const extra = normalize(options.entries ? await options.entries() : [], site, "entries");
        const named = await Promise.all(names.map(async (n) => [n, normalize(await options.sitemaps![n]!(), site, `sitemaps.${n}`)] as const));
        // Each address once, whatever produced it, in the first sitemap that has it.
        const seen = new Set(fromRoutes.map((e) => e.loc));
        const once = (list: Entry[]) => list.filter((e) => !seen.has(e.loc) && !!seen.add(e.loc));
        const pages = [...fromRoutes, ...once(extra)];
        const all = new Map<string, Entry[]>([["pages", pages], ...named.map(([n, list]) => [n, once(list)] as const)]);
        // Languages in folders: an address from `entries` is a version of the same page as a route's.
        if (locales?.folders && extra.length) {
          linkFolders(pages.filter((e) => e.loc.startsWith(`${site}/`) || e.loc === site).map((entry) => ({ path: ownPath(entry.loc), entry })), locales);
        }
        return all;
      })();
      cache = { at: Date.now(), site, groups };
      // A failed load is not kept: the next request tries again.
      groups.catch(() => {
        if (cache?.groups === groups) cache = undefined;
      });
    }
    return cache.groups;
  };

  /** A sitemap in files of at most 50,000 addresses. */
  const chunksOf = (entries: Entry[]) => {
    const chunks: Entry[][] = [];
    for (let i = 0; i < entries.length; i += MAX_URLS) chunks.push(entries.slice(i, i + MAX_URLS));
    return chunks.length ? chunks : [[]];
  };

  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const asset = url.searchParams.get("asset");
    if (asset === "page.css") return respond(pageCss(theme), "text/css", { "Cache-Control": "public, max-age=86400" });
    if (asset === "page.js") return respond(PAGE_JS, "text/javascript", { "Cache-Control": "public, max-age=86400" });
    if (asset === "xml.css") return respond(xmlCss(theme), "text/css", { "Cache-Control": "public, max-age=86400" });

    const site = trimSlashes(options.site ?? manifest.site ?? url.origin);
    const groups = await load(site);
    const named = theme.name ? theme : { ...theme, name: hostOf(site) };
    const browser = request.headers.get("sec-fetch-dest") === "document";
    const self = `${url.pathname}?asset=xml.css`;
    const pageHeaders = { ...VARY, "X-Robots-Tag": "noindex", "Cache-Control": "public, max-age=3600" };
    const xmlHeaders = { ...VARY, "Cache-Control": "public, max-age=3600" };
    const notFound = () => new Response("Not found", { status: 404, headers: VARY });
    const urlset = (entries: Entry[]) =>
      browser ? respond(urlsetPage(entries, named, page), "text/html", pageHeaders) : respond(urlsetXml(entries, self), "application/xml", xmlHeaders);
    const index = (parts: { loc: string; lastmod?: string; count: number; label?: string }[]) =>
      browser ? respond(indexPage(parts, named, page), "text/html", pageHeaders) : respond(indexXml(parts, self), "application/xml", xmlHeaders);

    const name = url.searchParams.get("sitemap");
    const part = Number(url.searchParams.get("part") ?? 0);
    const at = (query: string) => `${site}${url.pathname}?${query}`;

    // One sitemap: past the protocol's limit it becomes an index of ?part=N files.
    if (!names.length) {
      const chunks = chunksOf(groups.get("pages")!);
      if (chunks.length === 1 && !part) return urlset(chunks[0]!);
      if (!part) return index(chunks.map((c, i) => ({ loc: at(`part=${i + 1}`), lastmod: newest(c), count: c.length })));
      return chunks[part - 1] ? urlset(chunks[part - 1]!) : notFound();
    }

    // Several: /sitemap.xml is their index, each one (or each of its parts) a file of its own.
    if (!name) {
      return index(
        [...groups].flatMap(([n, entries]) => {
          const chunks = chunksOf(entries);
          return chunks.map((c, i) => ({
            loc: at(`sitemap=${n}${chunks.length > 1 ? `&part=${i + 1}` : ""}`),
            lastmod: newest(c),
            count: c.length,
            label: chunks.length > 1 ? `${n} ${i + 1}` : n,
          }));
        }),
      );
    }
    const entries = groups.get(name);
    if (!entries) return notFound();
    const chunk = chunksOf(entries)[Math.max(part, 1) - 1];
    return chunk ? urlset(chunk) : notFound();
  };
}
