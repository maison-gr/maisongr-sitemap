import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { trimSlashes } from "../entries.js";
import { PAGE_JS, pageCss, urlsetPage, xmlCss } from "../page.js";
import type { Entry, Font, Theme } from "../types.js";
import { urlsetXml } from "../xml.js";
import { blocks, scopes } from "./css.js";
import { gitDates } from "./git-dates.js";
import { DEFAULT_PALETTE, palette } from "./palette.js";
import { styleBlocks } from "./project.js";
import { privateOf } from "./route-rules.js";

export type StaticReport = { pages: number; skipped: { path: string; reason: string }[]; written: string[]; theme: Theme };

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) {
      if (n !== "node_modules" && !n.startsWith(".")) walk(full, out);
    } else out.push(full);
  }
  return out;
}

/** An attribute's value, in double, single or no quotes (minified HTML drops them): href=/about. */
export const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

/** Whether an attribute holds this word among its words, as rel="alternate icon" holds icon. */
export const holds = (tag: string, name: string, word: string) => (attr(tag, name) ?? "").toLowerCase().split(/\s+/).includes(word);

/** "about/index.html" → "/about/"; "about.html" → "/about", or "/about.html" where the site links to it that way. */
function pathOf(file: string, dir: string, keepHtml = false): string {
  const rel = relative(dir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return keepHtml ? `/${rel}` : `/${rel.replace(/\.html?$/, "")}`;
}

/**
 * Whether the site's own links keep ".html". Hosts such as Netlify and
 * Cloudflare Pages serve /about for about.html, but plain Apache and nginx
 * answer only /about.html, and the links say which one this site relies on.
 */
function linksKeepHtml(pages: string[]): boolean {
  let withExt = 0;
  let without = 0;
  for (const html of pages) {
    for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(m[0], "href")?.split(/[#?]/)[0];
      if (!href) continue;
      if (/^[a-z][\w+.-]*:|^\/\//i.test(href)) continue; // another site, mailto:, tel:
      const last = href.split("/").pop()!;
      if (/\.html?$/i.test(last) && !/^index\.html?$/i.test(last)) withExt++;
      else if (last && !last.includes(".")) without++;
    }
  }
  return withExt > without;
}

const TITLE_SEPARATOR = /\s+[|·—–-]\s+/;

/**
 * The site's name: what its pages say it is (og:site_name, application-name),
 * else the part their titles share ("About | Lumen" and "Menu | Lumen" give
 * "Lumen"), else the first part of the home page's title.
 */
export function siteNameOf(pages: string[], home: string): string | undefined {
  for (const html of [home, ...pages]) {
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => ["property", "name"].some((n) => /^(?:og:site_name|application-name)$/i.test(attr(t, n) ?? "")));
    const named = meta && attr(meta, "content")?.trim();
    if (named) return named;
  }
  const titles = pages.map((h) => h.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()).filter((t): t is string => !!t);
  const counts = new Map<string, number>();
  for (const t of titles) for (const part of new Set(t.split(TITLE_SEPARATOR).map((p) => p.trim()).filter(Boolean))) counts.set(part, (counts.get(part) ?? 0) + 1);
  const shared = [...counts].filter(([, c]) => c >= 2 && c === Math.max(...counts.values())).map(([p]) => p);
  if (shared.length === 1) return shared[0];
  return home.match(/<title>([^<]*)<\/title>/i)?.[1]?.split(TITLE_SEPARATOR)[0]?.trim() || undefined;
}

/** @font-face rules the site's own stylesheets declare, which the page can use as they are. */
function siteFonts(css: string): Font[] {
  const fonts: Font[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1]!;
    const family = body.match(/font-family\s*:\s*["']?([^;"']+)["']?/)?.[1]?.trim();
    const url = body.match(/url\(\s*["']?(\/[^)"']+\.woff2)["']?\s*\)/)?.[1];
    if (!family || !url) continue;
    const existing = fonts.find((f) => f.family === family);
    const file = { url, weight: body.match(/font-weight\s*:\s*([^;]+)/)?.[1]?.trim(), style: body.match(/font-style\s*:\s*([^;]+)/)?.[1]?.trim() };
    // A build can hold the same @font-face twice (a stylesheet and the CSS inlined into the home page).
    if (existing) {
      if (!existing.files.some((f) => f.url === file.url && f.weight === file.weight && f.style === file.style)) existing.files.push(file);
    } else fonts.push({ family, role: /mono|code/i.test(family) ? "mono" : fonts.some((f) => f.role === "body") ? "display" : "body", files: [file] });
  }
  return fonts.filter((f, i, all) => all.findIndex((g) => g.role === f.role) === i);
}

/**
 * For sites with no server to tell browsers from crawlers: writes
 * sitemap.xml (styled by sitemap.css) for crawlers, and the designed page at
 * /sitemap/ for people, from the HTML files of the build output.
 */
/** A page's own images: its og:image and <img> sources, not inline data. */
function imagesIn(html: string, pageUrl: string): string[] {
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).filter((t) => attr(t, "property")?.toLowerCase() === "og:image").map((t) => attr(t, "content"));
  const img = [...html.matchAll(/<img\b[^>]*>/gi)].map((t) => attr(t[0], "src"));
  const urls = [...og, ...img].filter((u): u is string => !!u && !u.startsWith("data:")).map((u) => new URL(u.replace(/&amp;/g, "&"), pageUrl).href);
  return [...new Set(urls)];
}

export type StaticOptions = {
  name?: string;
  credit?: boolean;
  images?: boolean;
  /** Addresses no HTML file holds: a single-page app's routes (dated by their component's file), and any given with --add. */
  extra?: (string | { path: string; lastmod?: string })[];
  /** Force /about over /about.html, whatever the site's links do. */
  cleanUrls?: boolean;
  /** The page's language. Default the one the home page declares in <html lang>. */
  lang?: string;
};

export function buildStatic(dir: string, site: string, options: StaticOptions = {}): StaticReport {
  const base = trimSlashes(site);
  const files = walk(dir);
  const skipped: StaticReport["skipped"] = [];
  const entries: Entry[] = [];
  const htmlFiles = files.filter((f) => /\.html?$/.test(f));
  const sources = new Map(htmlFiles.map((f) => [f, readFileSync(f, "utf8")]));
  const keepHtml = !options.cleanUrls && linksKeepHtml([...sources.values()]);
  // Hand-written HTML is its own source, so Git dates it truly. A build output Git ignores gets no date.
  const dates = gitDates(dir, htmlFiles.map((f) => relative(dir, f).split(sep).join("/")));

  for (const file of htmlFiles) {
    const path = pathOf(file, dir, keepHtml);
    // Error pages, and 200.html: the empty app shell nuxt generate (and hosts such as Surge) serve for every route not prerendered.
    if (/^\/(200|404|500)(\.html?|\/)?$/.test(path) || path.startsWith("/sitemap/")) continue;
    const privateSegment = privateOf(path.split("/").filter(Boolean));
    if (privateSegment) {
      skipped.push({ path, reason: `private page (${privateSegment})` });
      continue;
    }
    const facts = pageFacts(sources.get(file)!, `${base}${path}`, base, options.images);
    if ("skip" in facts) {
      skipped.push({ path, reason: facts.skip });
      continue;
    }
    const lastmod = dates.get(relative(dir, file).split(sep).join("/"));
    entries.push({ ...facts.entry, ...(lastmod ? { lastmod } : {}) });
  }
  const home = files.find((f) => relative(dir, f) === "index.html");
  const homeHtml = home ? sources.get(home)! : "";
  // An address no file holds is a route the app renders from index.html, in its language.
  const homeLang = htmlLang(homeHtml);
  for (const item of options.extra ?? []) {
    const { path: raw, lastmod } = typeof item === "string" ? { path: item, lastmod: undefined } : item;
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const loc = `${base}${path}`;
    const known = entries.find((e) => e.loc === loc || e.loc === `${loc}/`);
    // A prerendered page in the build output has no Git date; the route's component file has one.
    if (known) {
      if (!known.lastmod && lastmod) known.lastmod = lastmod;
    } else entries.push({ loc, ...(homeLang ? { lang: homeLang } : {}), ...(lastmod ? { lastmod } : {}) });
  }
  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  // Stylesheets, then the CSS a build inlined into the home page (Astro and Vite inline small ones).
  const css = [
    ...files.filter((f) => f.endsWith(".css") && !f.includes(`${sep}sitemap${sep}`) && relative(dir, f) !== "sitemap.css").map((f) => readFileSync(f, "utf8")),
    styleBlocks(homeHtml),
  ].join("\n");
  const icon = ["favicon.svg", "icon.svg", "favicon.png", "favicon.ico"].find((n) => files.some((f) => relative(dir, f) === n));
  const theme = themeOf({ css, pages: [...sources.values()], home: homeHtml, icon: icon && `/${icon}`, name: options.name, base });
  return { pages: entries.length, skipped, written: writeSitemapFiles(dir, entries, theme, { credit: options.credit, lang: options.lang ?? homeLang }), theme };
}

/** What one page says about itself: why it is left out, or its entry (language, alternates, images). */
export function pageFacts(html: string, loc: string, base: string, withImages = false): { skip: string } | { entry: Entry } {
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => attr(t, "name")?.toLowerCase() === "robots");
  if (robots && /noindex/i.test(attr(robots, "content") ?? "")) return { skip: "noindex" };
  if ([...html.matchAll(/<meta\b[^>]*>/gi)].some((t) => attr(t[0], "http-equiv")?.toLowerCase() === "refresh")) return { skip: "redirect" };
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
  const alternates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((t) => t[0])
    .filter((t) => holds(t, "rel", "alternate") && attr(t, "hreflang"))
    .map((t) => ({ hreflang: attr(t, "hreflang")!, href: new URL(attr(t, "href") ?? "/", `${base}/`).href }));
  const images = withImages ? imagesIn(html, loc) : [];
  return { entry: { loc, ...(lang ? { lang } : {}), ...(alternates.length ? { alternates } : {}), ...(images.length ? { images } : {}) } };
}

/** The page's theme from the site's CSS: colour tokens light and dark, its @font-face fonts, name and icon. */
export function themeOf(site: { css: string; pages: string[]; home: string; icon?: string; name?: string; base: string }): Theme {
  const { light, dark } = scopes(blocks(site.css));
  const darkPalette = dark.size ? palette(dark, light) : null;
  return {
    name: site.name ?? siteNameOf(site.pages, site.home) ?? new URL(site.base).hostname,
    light: palette(light) ?? DEFAULT_PALETTE,
    ...(darkPalette ? { dark: darkPalette } : {}),
    fonts: siteFonts(site.css),
    ...(site.icon ? { icon: site.icon } : {}),
  };
}

/** sitemap.xml (styled by sitemap.css) for crawlers, and the designed page at /sitemap/ for people. */
/** The language a page declares: <html lang="fr-CA">. */
export const htmlLang = (html: string) => attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");

/** The five files static mode serves, by path: what writeSitemapFiles writes, and what the Vite plugin answers in dev. */
export function sitemapFiles(entries: Entry[], theme: Theme, page: { credit?: boolean; lang?: string } = {}): [string, string][] {
  return [
    ["sitemap.xml", urlsetXml(entries, "/sitemap.css")],
    ["sitemap.css", xmlCss(theme, { lang: page.lang, page: "/sitemap/" })],
    ["sitemap/index.html", urlsetPage(entries, theme, { ...page, assets: { css: "/sitemap/page.css", js: "/sitemap/page.js" } })],
    ["sitemap/page.css", pageCss(theme)],
    ["sitemap/page.js", PAGE_JS],
  ];
}

export function writeSitemapFiles(dir: string, entries: Entry[], theme: Theme, page: { credit?: boolean; lang?: string } = {}): string[] {
  mkdirSync(join(dir, "sitemap"), { recursive: true });
  const written = sitemapFiles(entries, theme, page);
  for (const [file, body] of written) writeFileSync(join(dir, file), body);
  return written.map(([f]) => f);
}
