import type { Entry, News, Video } from "./types.js";

/** The protocol's limit per file; above it the sitemap becomes an index of parts. */
export const MAX_URLS = 50_000;

/** Google reads at most this many images per page. */
const MAX_IMAGES = 1_000;

const NS = {
  xhtml: `xmlns:xhtml="http://www.w3.org/1999/xhtml"`,
  image: `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`,
  video: `xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"`,
  news: `xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`,
};

/** A W3C date or datetime as given, or undefined: one invalid date makes Search Console reject the file. */
const w3c = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.test(value.trim()) && !Number.isNaN(Date.parse(value)) ? value.trim() : undefined;

const tag = (name: string, value: string | number | undefined) => (value === undefined || value === "" ? [] : [`<${name}>${escapeXml(String(value))}</${name}>`]);

function videoXml(v: Video, page: string): string | null {
  const content = v.content ?? v.player;
  if (!v.thumbnail || !v.title || !v.description || !content) return null; // Google's required fields
  return [
    "<video:video>",
    ...tag("video:thumbnail_loc", new URL(v.thumbnail, page).href),
    ...tag("video:title", v.title),
    ...tag("video:description", v.description.slice(0, 2048)),
    ...(v.content ? tag("video:content_loc", new URL(v.content, page).href) : tag("video:player_loc", new URL(v.player!, page).href)),
    ...tag("video:duration", v.duration === undefined ? undefined : Math.round(v.duration)),
    ...tag("video:publication_date", w3c(v.publicationDate)),
    ...tag("video:family_friendly", v.familyFriendly === undefined ? undefined : v.familyFriendly ? "yes" : "no"),
    ...tag("video:live", v.live === undefined ? undefined : v.live ? "yes" : "no"),
    "</video:video>",
  ].join("");
}

function newsXml(n: News): string | null {
  const date = w3c(n.publicationDate);
  if (!date || !n.title || !n.publication?.name || !n.publication?.language) return null;
  return `<news:news><news:publication>${tag("news:name", n.publication.name)}${tag("news:language", n.publication.language)}</news:publication>${tag("news:publication_date", date)}${tag("news:title", n.title)}</news:news>`;
}

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const head = (stylesheet?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  (stylesheet ? `<?xml-stylesheet type="text/css" href="${escapeXml(stylesheet)}"?>\n` : "");

export function urlsetXml(entries: Entry[], stylesheet?: string): string {
  const urls = entries.map((e) => {
    const lines = [`    <loc>${escapeXml(e.loc)}</loc>`];
    for (const a of e.alternates ?? []) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`);
    }
    if (e.lastmod) lines.push(`    <lastmod>${escapeXml(e.lastmod)}</lastmod>`);
    for (const image of [...new Set(e.images ?? [])].slice(0, MAX_IMAGES)) {
      lines.push(`    <image:image><image:loc>${escapeXml(new URL(image, e.loc).href)}</image:loc></image:image>`);
    }
    for (const v of e.videos ?? []) {
      const video = videoXml(v, e.loc);
      if (video) lines.push(`    ${video}`);
    }
    const news = e.news ? newsXml(e.news) : null;
    if (news) lines.push(`    ${news}`);
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });
  const body = urls.join("\n");
  // Only the namespaces the file uses.
  const used = (Object.keys(NS) as (keyof typeof NS)[]).filter((k) => body.includes(`<${k}:`)).map((k) => NS[k]);
  const ns = [`xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`, ...used].join(" ");
  return `${head(stylesheet)}<urlset ${ns}>\n${urls.join("\n")}\n</urlset>\n`;
}

export function indexXml(parts: { loc: string; lastmod?: string }[], stylesheet?: string): string {
  const items = parts.map(
    (p) => `  <sitemap>\n    <loc>${escapeXml(p.loc)}</loc>${p.lastmod ? `\n    <lastmod>${escapeXml(p.lastmod)}</lastmod>` : ""}\n  </sitemap>`,
  );
  return `${head(stylesheet)}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}

/** The newest date among the entries, for an index part's lastmod. */
export const newest = (entries: Entry[]) =>
  entries.reduce<string | undefined>((max, e) => (e.lastmod && (!max || e.lastmod > max) ? e.lastmod : max), undefined);
