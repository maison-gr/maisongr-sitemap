import { dateOf, expand, linkFolders, matches, trimSlashes, type DateLike, type ExpandOptions, type Locales } from "./entries.js";
import { DEFAULT_PALETTE } from "./build/palette.js";
import { indexPage, pageCss, PAGE_JS, urlsetPage, xmlCss } from "./page.js";
import type { Entry, Manifest, Palette, Theme } from "./types.js";
import { chunk, indexXml, newest, urlsetXml } from "./xml.js";

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
  /**
   * Changes each address before it is written: add images, set a date, or return
   * null to leave it out. Runs last, on every sitemap, after `exclude`.
   *   transform: (entry) => ({ ...entry, images: imagesFor(new URL(entry.loc).pathname) })
   */
  transform?: (entry: Entry) => Entry | null | Promise<Entry | null>;
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
  /** The language of the page people see: "en" or "fr". Default the site's own default language, else English. */
  lang?: string;
};

/** An address given through `entries`, its date in any form `DateLike` takes. */
export type EntryInput = Omit<Entry, "lastmod"> & { lastmod?: DateLike };

/**
 * The sitemap's request handler. `invalidate()` drops the cached list, so the
 * next request reads `params`, `entries` and `sitemaps` again: call it when
 * the content changes (a post is published) rather than waiting for `revalidate`.
 */
export type SitemapHandler = ((request: Request) => Promise<Response>) & { invalidate(): void };

const VARY = { Vary: "Sec-Fetch-Dest" };

function respond(body: string, type: string, headers: Record<string, string> = {}) {
  return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, ...headers } });
}

/** A strong ETag from the body: the same list, the same tag, whatever the dates say. */
async function etagOf(body: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${[...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/** If-None-Match names this tag (or "*"). Weak comparison, as for every GET: a proxy may have marked it W/. */
const unchanged = (ifNoneMatch: string | null, tag: string) =>
  !!ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === "*" || t.trim().replace(/^W\//, "") === tag);

/**
 * A person opening the address, not a crawler. A browser that opens a page sends
 * both `Sec-Fetch-Dest: document` and an Accept that asks for HTML; requiring
 * both keeps the XML for any fetcher built on a browser engine that sends only
 * the first. No user agent is read: everyone gets what they asked for.
 */
const isBrowser = (headers: Headers) => headers.get("sec-fetch-dest") === "document" && /\btext\/html\b/i.test(headers.get("accept") ?? "");

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
 * visit with `Sec-Fetch-Dest: document` and asks for HTML, and gets the
 * designed page; crawlers send neither and get the XML. Both list exactly the
 * same addresses (one file presented two ways, not cloaking); the page is
 * noindex and private, and Vary keeps any cache from handing one to the other.
 */
export function createSitemap(options: SitemapOptions = {}): SitemapHandler {
  const manifest = asManifest(options.manifest);
  const theme = mergeTheme(manifest.theme, options.theme);
  const ttl = (options.revalidate ?? 3600) * 1000;
  const trailingSlash = options.trailingSlash ?? manifest.trailingSlash;
  const basePath = trimSlashes(options.basePath ?? manifest.basePath ?? "") || undefined;
  const page = { credit: options.credit, home: basePath || "/", lang: options.lang ?? manifest.locales?.default };
  let cache: { at: number; site: string; groups: Promise<Map<string, Entry[]>> } | undefined;
  /** The last list that loaded, served when a later load fails: a 5xx on a sitemap costs crawl trust for every address in it. */
  let lastGood: { site: string; groups: Map<string, Entry[]> } | undefined;
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
  const normalize = (list: EntryInput[], site: string, from: string): Entry[] => {
    const absolute = (value: string) => {
      const loc = value.startsWith("/") ? `${site}${value}` : value;
      if (!URL.canParse(loc)) throw new Error(`maisongr-sitemap: ${from} gave "${value}", which is neither an address nor a path.`);
      return loc;
    };
    return list
      .map(({ lastmod, ...e }) => {
        const loc = absolute(e.loc);
        // Language versions may be paths too: "/fr/a-propos".
        const alternates = e.alternates?.map((a) => ({ ...a, href: absolute(a.href) }));
        const day = dateOf(lastmod);
        return { ...e, loc, ...(alternates ? { alternates } : {}), ...(day ? { lastmod: day } : {}) };
      })
      .filter((e) => !matches(ownPath(e.loc), options.exclude ?? []));
  };

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
        if (!options.transform) return all;
        const changed = new Map<string, Entry[]>();
        for (const [name, list] of all) {
          const out = await Promise.all(list.map((e) => options.transform!(e)));
          changed.set(name, out.filter((e): e is Entry => e !== null && e !== undefined));
        }
        return changed;
      })();
      cache = { at: Date.now(), site, groups };
      groups.then((loaded) => {
        lastGood = { site, groups: loaded };
      }, () => {});
      // A failed load is not kept: the next request tries again.
      groups.catch(() => {
        if (cache?.groups === groups) cache = undefined;
      });
    }
    return cache.groups;
  };

  /** A sitemap in files within the protocol's limits, worked out once per loaded list. */
  const chunked = new WeakMap<Entry[], Entry[][]>();
  const chunksOf = (entries: Entry[]) => {
    let chunks = chunked.get(entries);
    if (!chunks) chunked.set(entries, (chunks = chunk(entries)));
    return chunks;
  };

  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const asset = url.searchParams.get("asset");
    if (asset === "page.css") return respond(pageCss(theme), "text/css", { "Cache-Control": "public, max-age=86400" });
    if (asset === "page.js") return respond(PAGE_JS, "text/javascript", { "Cache-Control": "public, max-age=86400" });
    if (asset === "xml.css") return respond(xmlCss(theme, { lang: page.lang }), "text/css", { "Cache-Control": "public, max-age=86400" });

    const site = trimSlashes(options.site ?? manifest.site ?? url.origin);
    let groups: Map<string, Entry[]>;
    let stale = false;
    try {
      groups = await load(site);
    } catch (error) {
      // The database is down, say: answer with the last list that loaded, if there is one.
      if (lastGood?.site !== site) throw error;
      groups = lastGood.groups;
      stale = true;
    }
    const named = theme.name ? theme : { ...theme, name: hostOf(site) };
    const browser = isBrowser(request.headers);
    const self = `${url.pathname}?asset=xml.css`;
    // A stale answer is cached briefly, so the next request soon tries the source again.
    const age = stale ? 60 : 3600;
    const marked: Record<string, string> = stale ? { "X-Sitemap-Stale": "true" } : {};
    // The page is private: a shared cache that ignores Vary (some CDNs do) must never store it and
    // hand it to a crawler as the sitemap. The XML is the same for everyone, so caches may keep it.
    const pageHeaders = { ...VARY, "X-Robots-Tag": "noindex", "Cache-Control": `private, max-age=${age}`, ...marked };
    const xmlHeaders = { ...VARY, "Cache-Control": `public, max-age=${age}`, ...marked };
    const notFound = () => new Response("Not found", { status: 404, headers: VARY });
    // Answers "has it changed?" with 304 when the ETag still matches, so a crawler skips an unchanged
    // file. Only the ETag decides: a date alone would miss an address that was taken out.
    const answer = async (body: string, type: string, headers: Record<string, string>, lastmod?: string) => {
      const tag = await etagOf(body);
      const all: Record<string, string> = { ...headers, ETag: tag };
      if (lastmod && !Number.isNaN(Date.parse(lastmod))) all["Last-Modified"] = new Date(lastmod).toUTCString();
      return unchanged(request.headers.get("if-none-match"), tag) ? new Response(null, { status: 304, headers: all }) : respond(body, type, all);
    };
    const urlset = (entries: Entry[]) =>
      browser
        ? answer(urlsetPage(entries, named, page), "text/html", pageHeaders, newest(entries))
        : answer(urlsetXml(entries, self), "application/xml", xmlHeaders, newest(entries));
    const index = (parts: { loc: string; lastmod?: string; count: number; label?: string }[]) => {
      const lastmod = parts.reduce<string | undefined>((max, p) => (p.lastmod && (!max || p.lastmod > max) ? p.lastmod : max), undefined);
      return browser
        ? answer(indexPage(parts, named, page), "text/html", pageHeaders, lastmod)
        : answer(indexXml(parts, self), "application/xml", xmlHeaders, lastmod);
    };

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
      // An empty sitemap is not listed: Search Console reports an empty child as an error against the whole index.
      return index(
        [...groups].filter(([, entries]) => entries.length).flatMap(([n, entries]) => {
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
  }

  // The last good list stays, for a load that fails after it.
  return Object.assign(GET, { invalidate: () => void (cache = undefined) });
}
