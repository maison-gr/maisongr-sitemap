import type { Entry } from "./types.js";

/** The protocol's limit per file; above it the sitemap becomes an index of parts. */
export const MAX_URLS = 50_000;

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const head = (stylesheet?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  (stylesheet ? `<?xml-stylesheet type="text/css" href="${escapeXml(stylesheet)}"?>\n` : "");

export function urlsetXml(entries: Entry[], stylesheet?: string): string {
  const hasAlternates = entries.some((e) => e.alternates?.length);
  const ns = `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasAlternates ? ` xmlns:xhtml="http://www.w3.org/1999/xhtml"` : ""}`;
  const urls = entries.map((e) => {
    const lines = [`    <loc>${escapeXml(e.loc)}</loc>`];
    for (const a of e.alternates ?? []) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`);
    }
    if (e.lastmod) lines.push(`    <lastmod>${escapeXml(e.lastmod)}</lastmod>`);
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });
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
