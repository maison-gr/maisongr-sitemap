import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PAGE_JS, pageCss, urlsetPage, xmlCss } from "../page.js";
import type { Entry, Font, Theme } from "../types.js";
import { urlsetXml } from "../xml.js";
import { blocks, scopes } from "./css.js";
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

/** "about/index.html" → "/about/"; "about.html" → "/about". */
function pathOf(file: string, dir: string): string {
  const rel = relative(dir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel.replace(/\.html$/, "")}`;
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
export function buildStatic(dir: string, site: string, options: { name?: string; credit?: boolean } = {}): StaticReport {
  const base = site.replace(/\/+$/, "");
  const files = walk(dir);
  const skipped: StaticReport["skipped"] = [];
  const entries: Entry[] = [];

  for (const file of files.filter((f) => f.endsWith(".html"))) {
    const path = pathOf(file, dir);
    if (/^\/(404|500)(\.html|\/)?$/.test(path) || path.startsWith("/sitemap/")) continue;
    const privateSegment = privateOf(path.split("/").filter(Boolean));
    if (privateSegment) {
      skipped.push({ path, reason: `private page (${privateSegment})` });
      continue;
    }
    const html = readFileSync(file, "utf8");
    const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((t) => t[0]).find((t) => /name\s*=\s*["']robots["']/i.test(t));
    if (robots && /noindex/i.test(attr(robots, "content") ?? "")) {
      skipped.push({ path, reason: "noindex" });
      continue;
    }
    if (/<meta[^>]+http-equiv\s*=\s*["']refresh["']/i.test(html)) {
      skipped.push({ path, reason: "redirect" });
      continue;
    }
    const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
    const alternates = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((t) => t[0])
      .filter((t) => /rel\s*=\s*["']alternate["']/i.test(t) && attr(t, "hreflang"))
      .map((t) => ({ hreflang: attr(t, "hreflang")!, href: new URL(attr(t, "href") ?? "/", `${base}/`).href }));
    entries.push({ loc: `${base}${path}`, ...(lang ? { lang } : {}), ...(alternates.length ? { alternates } : {}) });
  }
  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  const home = files.find((f) => relative(dir, f) === "index.html");
  const homeHtml = home ? readFileSync(home, "utf8") : "";
  // Stylesheets, then the CSS a build inlined into the home page (Astro and Vite inline small ones).
  const css = [
    ...files.filter((f) => f.endsWith(".css") && !f.includes(`${sep}sitemap${sep}`) && relative(dir, f) !== "sitemap.css").map((f) => readFileSync(f, "utf8")),
    styleBlocks(homeHtml),
  ].join("\n");
  const { light, dark } = scopes(blocks(css));
  const name = options.name ?? homeHtml.match(/<title>([^<|·—–-]+)/i)?.[1]?.trim() ?? new URL(base).hostname;
  const darkPalette = dark.size ? palette(dark, light) : null;
  const icon = ["favicon.svg", "icon.svg", "favicon.png", "favicon.ico"].find((n) => files.some((f) => relative(dir, f) === n));
  const theme: Theme = {
    name,
    light: palette(light) ?? DEFAULT_PALETTE,
    ...(darkPalette ? { dark: darkPalette } : {}),
    fonts: siteFonts(css),
    ...(icon ? { icon: `/${icon}` } : {}),
  };

  mkdirSync(join(dir, "sitemap"), { recursive: true });
  const written = [
    ["sitemap.xml", urlsetXml(entries, "/sitemap.css")],
    ["sitemap.css", xmlCss(theme)],
    ["sitemap/index.html", urlsetPage(entries, theme, { credit: options.credit, assets: { css: "/sitemap/page.css", js: "/sitemap/page.js" } })],
    ["sitemap/page.css", pageCss(theme)],
    ["sitemap/page.js", PAGE_JS],
  ] as const;
  for (const [file, body] of written) writeFileSync(join(dir, file), body);
  return { pages: entries.length, skipped, written: written.map(([f]) => f), theme };
}
