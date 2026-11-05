import { trimSlashes } from "../entries.js";
import type { Entry, Theme } from "../types.js";
import { styleBlocks } from "./project.js";
import { privateOf } from "./route-rules.js";
import { attr, holds, htmlLang, pageFacts, themeOf } from "./static.js";

/**
 * For a site no file describes (PHP, Python, Ruby, Go, a CMS…): reads it the
 * way a search engine does, from the home page along its own links, and lists
 * the pages a search engine would keep. It follows robots.txt, noindex (in the
 * page or its X-Robots-Tag), nofollow, canonicals and redirects.
 */
export type CrawlOptions = {
  /** The address the site is served at publicly, when the crawl reads another (http://localhost:8000). */
  site?: string;
  /** Stop after this many pages. Default 10,000. */
  max?: number;
  /** Requests at a time. Default 4, gentle on a small server. */
  concurrency?: number;
  images?: boolean;
  fetch?: typeof fetch;
  /** Called after each page is read, with the pages listed and the addresses seen so far. */
  onPage?: (listed: number, seen: number) => void;
};

export type CrawlReport = { entries: Entry[]; skipped: { path: string; reason: string }[]; theme: Theme; capped: boolean; queries: number; lang?: string };

const NOT_PAGES = /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|css|js|mjs|json|xml|txt|csv|zip|gz|rar|7z|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|map|docx?|xlsx?|pptx?)$/i;
const AGENT = "maisongr-sitemap (+https://github.com/maison-gr/sitemap)";

const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const unescape = (s: string) => s.replace(/&amp;/g, "&");

/** robots.txt's rules for every crawler (User-agent: *), longest match wins, Allow over Disallow on a tie. */
export function robotsRules(text: string): (path: string) => boolean {
  const rules: { allow: boolean; prefix: string }[] = [];
  let applies = false;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [key, value] = [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
    if (key === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*") applies = true;
      continue;
    }
    inAgents = false;
    if (applies && (key === "allow" || key === "disallow") && value) rules.push({ allow: key === "allow", prefix: value.replace(/\*$/, "").replace(/\$$/, "") });
  }
  return (path) => {
    let best: { allow: boolean; prefix: string } | undefined;
    for (const r of rules) {
      if (!path.startsWith(r.prefix)) continue;
      if (!best || r.prefix.length > best.prefix.length || (r.prefix.length === best.prefix.length && r.allow)) best = r;
    }
    return best ? best.allow : true;
  };
}

/** The date a page states for its last change, if it states one. */
function statedDate(html: string, lastModified: string | null): string | undefined {
  const meta = tags(html, "meta").find((t) => ["property", "name", "itemprop"].some((n) => /^(?:article:modified_time|og:updated_time|datemodified|last-modified)$/i.test(attr(t, n) ?? "")));
  const ld = html.match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1];
  for (const value of [meta && attr(meta, "content"), ld]) {
    if (value && !Number.isNaN(Date.parse(value))) return value;
  }
  // A Last-Modified that is "now" is a dynamic page stamping every response, not a real date.
  if (lastModified) {
    const t = Date.parse(lastModified);
    if (!Number.isNaN(t) && Date.now() - t > 5 * 60_000) return new Date(t).toISOString();
  }
  return undefined;
}

/** url(...) in a stylesheet made absolute, so the page served from the site's root finds the same fonts. */
const absoluteUrls = (css: string, from: URL, origin: string) =>
  css.replace(/url\(([^)]*)\)/g, (whole, inner: string) => {
    const href = inner.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!href || href.startsWith("data:")) return whole;
    let url: URL;
    try {
      url = new URL(href, from);
    } catch {
      return whole;
    }
    return url.origin === origin ? `url("${url.pathname}")` : whole;
  });

export async function crawl(start: string, options: CrawlOptions = {}): Promise<CrawlReport> {
  const get = options.fetch ?? fetch;
  const startUrl = new URL(start);
  const origin = startUrl.origin;
  const base = trimSlashes(options.site ?? origin);
  const publicOrigin = new URL(base).origin;
  const max = options.max ?? 10_000;
  const request = (url: string) => get(url, { redirect: "manual", headers: { "user-agent": AGENT, accept: "text/html,*/*;q=0.5" }, signal: AbortSignal.timeout(20_000) });

  const robotsRes = await request(`${origin}/robots.txt`).catch(() => null);
  const allowed = robotsRules(robotsRes?.ok ? await robotsRes.text() : "");

  /** A link as a path on this site, or null when it leaves the site or isn't a page. */
  const queries = new Set<string>();
  const pathOf = (href: string, from: string): string | null => {
    let url: URL;
    try {
      url = new URL(unescape(href), from);
    } catch {
      return null;
    }
    if (url.origin !== origin && url.origin !== publicOrigin) return null;
    if (!/^https?:$/.test(url.protocol) || NOT_PAGES.test(url.pathname)) return null;
    if (url.search) {
      queries.add(url.pathname + url.search);
      return null;
    }
    return url.pathname;
  };

  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (path: string | null) => {
    if (path === null || seen.has(path) || path === "/sitemap.xml" || path.startsWith("/sitemap/")) return;
    seen.add(path);
    queue.push(path);
  };
  add(startUrl.pathname);

  const entries: Entry[] = [];
  const skipped: CrawlReport["skipped"] = [];
  const pages: string[] = [];
  let home = "";

  async function visit(path: string) {
    if (!allowed(path)) return void skipped.push({ path, reason: "robots.txt disallows it" });
    const privateSegment = privateOf(path.split("/").filter(Boolean));
    if (privateSegment) return void skipped.push({ path, reason: `private page (${privateSegment})` });
    const res = await request(`${origin}${path}`).catch((error: Error) => ({ error }));
    if ("error" in res) return void skipped.push({ path, reason: `could not be read (${res.error.message})` });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      const target = to ? pathOf(to, `${origin}${path}`) : null;
      skipped.push({ path, reason: `redirects${target ? ` to ${target}` : ""}` });
      return add(target);
    }
    if (res.status !== 200) return void skipped.push({ path, reason: `answers ${res.status}` });
    if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")) return;
    const html = await res.text();
    if (path === startUrl.pathname) home = html;
    pages.push(html);

    const robots = tags(html, "meta").find((t) => attr(t, "name")?.toLowerCase() === "robots");
    const directives = `${attr(robots ?? "", "content") ?? ""},${res.headers.get("x-robots-tag") ?? ""}`;
    if (!/nofollow/i.test(directives)) {
      for (const a of tags(html, "a")) {
        if (holds(a, "rel", "nofollow")) continue;
        const href = attr(a, "href");
        if (href && !href.startsWith("#")) add(pathOf(href, `${origin}${path}`));
      }
    }
    // Language versions named only in hreflang are followed too, as search engines do.
    for (const link of tags(html, "link").filter((t) => holds(t, "rel", "alternate") && attr(t, "hreflang"))) {
      const href = attr(link, "href");
      if (href) add(pathOf(href, `${origin}${path}`));
    }
    if (/noindex/i.test(directives)) return void skipped.push({ path, reason: "noindex" });
    // A page whose canonical is another address is a copy: the canonical one is listed instead.
    const canonical = tags(html, "link").find((t) => holds(t, "rel", "canonical"));
    const canonicalPath = canonical && attr(canonical, "href") ? pathOf(attr(canonical, "href")!, `${origin}${path}`) : null;
    if (canonicalPath !== null && canonicalPath !== path) {
      skipped.push({ path, reason: `canonical is ${canonicalPath}` });
      return add(canonicalPath);
    }

    const facts = pageFacts(html, `${base}${path}`, base, options.images);
    if ("skip" in facts) return void skipped.push({ path, reason: facts.skip });
    // Alternates the page writes with the address the crawl reads are given the public one.
    const alternates = facts.entry.alternates?.map((a) => (a.href.startsWith(origin) ? { ...a, href: `${base}${a.href.slice(origin.length)}` } : a));
    const lastmod = statedDate(html, res.headers.get("last-modified"));
    entries.push({ ...facts.entry, ...(alternates ? { alternates } : {}), ...(lastmod ? { lastmod } : {}) });
  }

  // A few requests at a time, as the queue grows.
  let capped = false;
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      if (entries.length >= max) {
        capped = true;
        return;
      }
      await visit(queue[next++]!);
      options.onPage?.(entries.length, seen.size);
    }
  }
  // Workers stop when the queue is momentarily empty, so start more until nothing new is found.
  while (next < queue.length && !capped) await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));

  // The theme, from the home page's own stylesheets and <style> blocks.
  const css: string[] = [];
  for (const link of tags(home, "link").filter((t) => holds(t, "rel", "stylesheet"))) {
    const href = attr(link, "href");
    if (!href) continue;
    const url = new URL(unescape(href), `${origin}/`);
    if (url.origin !== origin) continue;
    const res = await request(url.href).catch(() => null);
    if (res?.ok) css.push(absoluteUrls(await res.text(), url, origin));
  }
  css.push(absoluteUrls(styleBlocks(home), new URL(`${origin}/`), origin));
  const iconTag = tags(home, "link").find((t) => holds(t, "rel", "icon"));
  const iconHref = iconTag && attr(iconTag, "href");
  const iconUrl = iconHref ? new URL(unescape(iconHref), `${origin}/`) : undefined;
  const icon = iconUrl && iconUrl.origin === origin ? iconUrl.pathname : undefined;

  entries.sort((a, b) => a.loc.localeCompare(b.loc));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, skipped, theme: themeOf({ css: css.join("\n"), pages, home, icon, base }), capped, queries: queries.size, lang: htmlLang(home) };
}
