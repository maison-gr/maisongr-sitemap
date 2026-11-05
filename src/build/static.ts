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

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];

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
    for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#?]+)/gi)) {
      const href = m[1]!;
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
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => /(?:property|name)\s*=\s*["'](?:og:site_name|application-name)["']/i.test(t));
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
    if (existing) existing.files.push(file);
    else fonts.push({ family, role: /mono|code/i.test(family) ? "mono" : fonts.some((f) => f.role === "body") ? "display" : "body", files: [file] });
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
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).filter((t) => /property\s*=\s*["']og:image["']/i.test(t)).map((t) => attr(t, "content"));
  const img = [...html.matchAll(/<img\b[^>]*>/gi)].map((t) => attr(t[0], "src"));
  const urls = [...og, ...img].filter((u): u is string => !!u && !u.startsWith("data:")).map((u) => new URL(u.replace(/&amp;/g, "&"), pageUrl).href);
  return [...new Set(urls)];
}

export type StaticOptions = {
  name?: string;
  credit?: boolean;
  images?: boolean;
  /** Addresses no HTML file holds: a single-page app's routes, and any given with --add. */
  extra?: string[];
  /** Force /about over /about.html, whatever the site's links do. */
  cleanUrls?: boolean;
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
    if (/^\/(404|500)(\.html?|\/)?$/.test(path) || path.startsWith("/sitemap/")) continue;
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
  for (const raw of options.extra ?? []) {
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const loc = `${base}${path}`;
    if (!entries.some((e) => e.loc === loc || e.loc === `${loc}/`)) entries.push({ loc });
  }
  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  const home = files.find((f) => relative(dir, f) === "index.html");
  const homeHtml = home ? sources.get(home)! : "";
  // Stylesheets, then the CSS a build inlined into the home page (Astro and Vite inline small ones).
  const css = [
    ...files.filter((f) => f.endsWith(".css") && !f.includes(`${sep}sitemap${sep}`) && relative(dir, f) !== "sitemap.css").map((f) => readFileSync(f, "utf8")),
    styleBlocks(homeHtml),
  ].join("\n");
  const icon = ["favicon.svg", "icon.svg", "favicon.png", "favicon.ico"].find((n) => files.some((f) => relative(dir, f) === n));
  const theme = themeOf({ css, pages: [...sources.values()], home: homeHtml, icon: icon && `/${icon}`, name: options.name, base });
  return { pages: entries.length, skipped, written: writeSitemapFiles(dir, entries, theme, options.credit), theme };
}

/** What one page says about itself: why it is left out, or its entry (language, alternates, images). */
export function pageFacts(html: string, loc: string, base: string, withImages = false): { skip: string } | { entry: Entry } {
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => /name\s*=\s*["']robots["']/i.test(t));
  if (robots && /noindex/i.test(attr(robots, "content") ?? "")) return { skip: "noindex" };
  if (/<meta[^>]+http-equiv\s*=\s*["']refresh["']/i.test(html)) return { skip: "redirect" };
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
  const alternates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((t) => t[0])
    .filter((t) => /rel\s*=\s*["']alternate["']/i.test(t) && attr(t, "hreflang"))
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
export function writeSitemapFiles(dir: string, entries: Entry[], theme: Theme, credit?: boolean): string[] {
  mkdirSync(join(dir, "sitemap"), { recursive: true });
  const written = [
    ["sitemap.xml", urlsetXml(entries, "/sitemap.css")],
    ["sitemap.css", xmlCss(theme)],
    ["sitemap/index.html", urlsetPage(entries, theme, { credit, assets: { css: "/sitemap/page.css", js: "/sitemap/page.js" } })],
    ["sitemap/page.css", pageCss(theme)],
    ["sitemap/page.js", PAGE_JS],
  ] as const;
  for (const [file, body] of written) writeFileSync(join(dir, file), body);
  return written.map(([f]) => f);
}
