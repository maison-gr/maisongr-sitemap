import { readable } from "../entries.js";
import { attr } from "./static.js";

/**
 * llms.txt (llmstxt.org): a short Markdown file that says what the site is and
 * links its key pages, for AI assistants. Written from the sitemap and the
 * pages' own titles and descriptions, so it says only what the site says, and
 * a run after each content change keeps it current.
 */

export const LLMS_MARK = "<!-- Written by maisongr-sitemap llms from the sitemap and each page's own title and description. Run it again to update. -->";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** HTML's entities as text: &amp;, &#39; and &#x27; alike. */
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) =>
    code[0] === "#" ? String.fromCodePoint(code[1]!.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (NAMED[code.toLowerCase()] ?? whole),
  );

/**
 * The addresses of a urlset, one version per page: where a page lists
 * x-default, only that version is kept, so a site in ten languages is listed
 * once, in the language its x-default names.
 */
export function onePerPage(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1]!.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) continue;
    const xDefault = m[1]!.match(/hreflang="x-default"\s+href="([^"]+)"/)?.[1];
    const url = unescape(loc.trim());
    if (!xDefault || unescape(xDefault) === url) out.push(url);
  }
  return [...new Set(out)];
}

export type PageInfo = { url: string; title: string; description?: string };

/** A page's title (without the site name after its separator) and meta description. */
export function pageInfo(html: string, url: string, siteName?: string): PageInfo {
  const raw = unescape(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  // The site's name, before or after the page's own ("Maison GR — Services", "Services | Maison GR"), says nothing here.
  const parts = raw.split(/\s+[|·—–-]\s+/);
  const own = parts.length > 1 && siteName ? parts.filter((p, i) => !(p === siteName && (i === 0 || i === parts.length - 1))) : parts;
  const title = own.join(" · ") || raw || new URL(url).pathname;
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => attr(t, "name")?.toLowerCase() === "description");
  const description = meta ? unescape(attr(meta, "content") ?? "").trim() : "";
  return { url, title, ...(description ? { description } : {}) };
}

/** Groups pages by their first path segment, the home page's section first. */
function sections(pages: PageInfo[]): [string, PageInfo[]][] {
  const by = new Map<string, PageInfo[]>();
  for (const p of pages) {
    const parts = new URL(p.url).pathname.split("/").filter(Boolean);
    // A language prefix (/fr, /en-CA) is not a section.
    if (parts[0] && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(parts[0])) parts.shift();
    const key = parts.length > 1 ? parts[0]! : "";
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  return [...by].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

const title = (key: string) => (key ? readable(key).replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Pages");

/** The file itself: the site's name, what its home page says it is, and its pages by section. */
export function llmsText(site: { name: string; description?: string; pages: PageInfo[] }): string {
  const lines = [`# ${site.name}`, ""];
  if (site.description) lines.push(`> ${site.description.replace(/\s+/g, " ")}`, "");
  for (const [key, pages] of sections(site.pages)) {
    lines.push(`## ${title(key)}`, "");
    for (const p of pages) lines.push(`- [${p.title.replace(/[[\]]/g, "")}](${p.url})${p.description ? `: ${p.description.replace(/\s+/g, " ")}` : ""}`);
    lines.push("");
  }
  lines.push(LLMS_MARK, "");
  return lines.join("\n");
}
