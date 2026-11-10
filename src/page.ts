import { stringsFor, type Strings } from "./strings.js";
import type { Entry, Font, Palette, Theme } from "./types.js";

/*
 * The sitemap as a person sees it: the same addresses the XML lists, set in
 * the site's own colours and type, grouped by section, with a filter. No
 * inline script or style: both load from the sitemap's own address
 * (?asset=page.css, ?asset=page.js), so a CSP of default-src 'self' allows
 * the page without hashes or nonces.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pathOf = (loc: string) => loc.replace(/^https?:\/\/[^/]+/, "") || "/";
const pad = (n: number, width: number) => String(n).padStart(width, "0");

export type PageOptions = {
  /** Show the "Sitemap by Maison GR" line in the footer. */
  credit?: boolean;
  /** Where the page's stylesheet and script are served. Default: the sitemap's own address. */
  assets?: { css: string; js: string };
  /** Where the site's name links to. Default "/"; the basePath for a site mounted under one. */
  home?: string;
  /** The page's own language: its labels, and <html lang>. Default English; "fr" for French. */
  lang?: string;
};

const ASSETS = { css: "?asset=page.css", js: "?asset=page.js" };

/** The path without its language prefix, split: "/en/blog/post" → ["blog", "post"]. */
function partsOf(e: Entry): string[] {
  const parts = pathOf(e.loc).split("/").filter(Boolean);
  if (e.lang && parts[0] === e.lang) parts.shift();
  return parts;
}

/**
 * Sections are the site's real folders: a first segment holding more than one
 * page (whatever the languages). Everything else is one "Pages" section. Titles
 * are the paths themselves, so the page never invents a name ("Adhd").
 */
function sectionsOf(entries: Entry[]): Map<string, Entry[]> {
  const pagesUnder = new Map<string, Set<string>>();
  for (const e of entries) {
    const parts = partsOf(e);
    if (parts.length < 2) continue;
    const pages = pagesUnder.get(parts[0]!) ?? new Set();
    pages.add(parts.join("/"));
    pagesUnder.set(parts[0]!, pages);
  }
  const sections = new Map<string, Entry[]>([["", []]]);
  for (const e of entries) {
    const first = partsOf(e)[0];
    const key = first && (pagesUnder.get(first)?.size ?? 0) > 1 ? first : "";
    sections.set(key, [...(sections.get(key) ?? []), e]);
  }
  if (!sections.get("")!.length) sections.delete("");
  return sections;
}

const titleOf = (section: string, t: Strings) => (section ? `/${decodeURIComponent(section)}/` : t.pagesSection);

/** Above this many rows the page gets its filter and sort; below, the list reads faster on its own. */
const TOOLS_FROM = 10;

/** One page as a row: its version in the page's language first, and its other language versions. */
type Row = { main: Entry; versions: Entry[] };

const primary = (lang: string | undefined) => (lang ?? "").toLowerCase().split(/[-_]/)[0];

/**
 * Language versions of one page share a row: entries whose alternates name each
 * other, one per language. The row shows the version in the page's language (or
 * the first one) and links the others beside it, so every address is still
 * listed exactly once. An entry without a language is a row of its own.
 */
function rowsOf(entries: Entry[], lang: string | undefined): Row[] {
  const index = new Map(entries.map((e, i) => [e.loc, i]));
  const root = entries.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  entries.forEach((e, i) => {
    if (!e.lang) return;
    for (const a of e.alternates ?? []) {
      const j = index.get(a.href);
      if (j !== undefined && j !== i && entries[j]!.lang) root[find(j)] = find(i);
    }
  });
  const rows: Row[] = [];
  const open = new Map<number, Row>();
  entries.forEach((e, i) => {
    const row = open.get(find(i));
    // Two entries in the same language can't share a row: the second gets its own.
    if (row && e.lang && !row.versions.some((v) => v.lang === e.lang)) return void row.versions.push(e);
    const fresh = { main: e, versions: [e] };
    rows.push(fresh);
    if (!row) open.set(find(i), fresh);
  });
  const own = primary(lang);
  for (const row of rows) row.main = row.versions.find((v) => primary(v.lang) === own) ?? row.versions[0]!;
  return rows;
}

const latest = (entries: Entry[]) => entries.reduce<string | undefined>((max, e) => (e.lastmod && (!max || e.lastmod > max) ? e.lastmod : max), undefined);

function rowHtml(row: Row, n: number, width: number): string {
  const path = pathOf(row.main.loc);
  const date = latest(row.versions);
  const search = row.versions.map((v) => pathOf(v.loc).toLowerCase()).join(" ");
  const langs = row.versions.flatMap((v) => (v.lang ? [v.lang] : [])).join(" ");
  // Every version, for the page's script: picking a language in the filter shows each row's version in it.
  const versions = row.versions.length > 1 ? ` data-v="${esc(JSON.stringify(row.versions.map((v) => [v.lang, pathOf(v.loc)])))}"` : "";
  const tags = row.versions
    .filter((v) => v.lang)
    .map((v) =>
      v === row.main
        ? `<span class="lang is-current">${esc(v.lang!.toUpperCase())}</span>`
        : `<a class="lang" href="${esc(pathOf(v.loc))}" hreflang="${esc(v.lang!)}">${esc(v.lang!.toUpperCase())}</a>`,
    )
    .join("");
  // Many languages take their own line on a phone; two or three fit beside the address.
  return `<li class="row${row.versions.length > 3 ? " many" : ""}" data-u="${esc(search)}"${langs ? ` data-l="${esc(langs)}"` : ""}${date ? ` data-d="${esc(date)}"` : ""}${versions}>
<span class="num">${pad(n, width)}</span><a class="url" href="${esc(path)}"${row.main.lang ? ` hreflang="${esc(row.main.lang)}"` : ""}>${esc(path)}</a><span class="langs">${tags}</span><span class="date">${date ? esc(date) : ""}</span>
</li>`;
}

/** The newest of a list's dates, as a Date, or undefined when none is valid. */
function newestDate(dates: (string | undefined)[]): Date | undefined {
  const times = dates.map((d) => (d ? Date.parse(d) : NaN)).filter((n) => !Number.isNaN(n));
  return times.length ? new Date(Math.max(...times)) : undefined;
}

const TOOL = '<a href="https://github.com/maison-gr/maisongr-sitemap" rel="noopener">maisongr-sitemap</a>';
const STUDIO = '<a href="https://www.maisongr.com" rel="noopener">Maison GR</a>';

function shell(theme: Theme, title: string, body: string, options: PageOptions, updated?: Date): string {
  const assets = options.assets ?? ASSETS;
  const t = stringsFor(options.lang);
  const about = `${updated ? `<span>${esc(t.updated(updated))}</span>` : ""}<span>${esc(t.footer)}</span>`;
  return `<!doctype html>
<html lang="${esc(t.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="${theme.dark ? "light dark" : "light"}">
<title>${esc(title)} · ${esc(theme.name)}</title>
${theme.icon ? `<link rel="icon" href="${esc(theme.icon)}">` : ""}
${theme.fonts.flatMap((f) => f.files.slice(0, 1)).map((file) => `<link rel="preload" href="${esc(file.url)}" as="font" type="font/woff2" crossorigin>`).join("\n")}
<link rel="stylesheet" href="${esc(assets.css)}">
</head>
<body>
<main class="page">
<a class="brand" href="${esc(options.home ?? "/")}">${esc(theme.name)}</a>
${body}
<footer class="foot"><p class="about">${about}</p>${options.credit !== false ? `<p class="credit">${t.credit(TOOL, STUDIO)}</p>` : ""}</footer>
</main>
<script src="${esc(assets.js)}" defer></script>
</body>
</html>`;
}

export function urlsetPage(entries: Entry[], theme: Theme, options: PageOptions = {}): string {
  const t = stringsFor(options.lang);
  const langs = [...new Set(entries.map((e) => e.lang).filter((l): l is string => !!l))];
  const rows = rowsOf(entries, options.lang);
  const width = Math.max(2, String(rows.length).length);
  const rowOf = new Map(rows.map((r) => [r.main, r]));

  const sections = sectionsOf(rows.map((r) => r.main));

  let n = 0;
  const groups = [...sections].map(([key, mains], i) => {
    const id = `s-${i}`;
    const items = mains.map((m) => rowHtml(rowOf.get(m)!, ++n, width)).join("\n");
    return `<section class="group" id="${id}" aria-labelledby="${id}-h"><header class="group-head"><h2 id="${id}-h">${esc(titleOf(key, t))}</h2><span class="count">${mains.length}</span></header>
<ol class="rows">
${items}
</ol></section>`;
  });

  const counts = langs.map((l) => `<span><b>${entries.filter((e) => e.lang === l).length}</b> ${esc(l.toUpperCase())}</span>`).join("");
  // When language versions share rows, the addresses are counted too: they are what the XML lists.
  const addresses = rows.length < entries.length ? `<span><b>${entries.length}</b> ${esc(t.addresses(entries.length))}</span>` : "";
  const chips = langs.length > 1
    ? `<div class="chips" role="group" aria-label="${esc(t.languageGroup)}"><button type="button" class="chip" data-f="" aria-pressed="true">${esc(t.all)}</button>${langs.map((l) => `<button type="button" class="chip" data-f="${esc(l)}" aria-pressed="false">${esc(l.toUpperCase())}</button>`).join("")}</div>`
    : "";

  const heading = `<p class="eyebrow">${esc(t.title)}</p>
<h1>${esc(t.heading(theme.name))}<span class="mark">.</span></h1>`;
  if (!entries.length) {
    return shell(theme, t.title, `${heading}\n<p class="empty">${esc(t.empty)}</p>`, options);
  }

  const tools = rows.length > TOOLS_FROM;
  const sort = tools && rows.filter((r) => latest(r.versions)).length > 1;
  const body = `${heading}
<p class="facts"><span><b>${rows.length}</b> ${esc(t.pages(rows.length))}</span>${addresses}${counts}</p>
${
  tools
    ? `<div class="tools">
<input id="q" class="search" type="search" placeholder="${esc(t.filterPlaceholder)}" aria-label="${esc(t.filterLabel)}" autocomplete="off" spellcheck="false">
${chips}${sort ? `<button type="button" class="chip sort" id="recent" aria-pressed="false">${esc(t.recent)}</button>` : ""}
<p class="tally" id="tally" aria-live="polite" data-t="${esc(t.tally)}"></p>
</div>`
    : ""
}
${sections.size > 1 && sections.size <= 12 ? `<nav class="jump" aria-label="${esc(t.sectionsNav)}">${[...sections].map(([key, mains], i) => `<a href="#s-${i}">${esc(titleOf(key, t))} <span>${mains.length}</span></a>`).join("")}</nav>` : ""}
${groups.join("\n")}
${sort ? `<section class="group" id="recent-list" aria-labelledby="recent-h" hidden><header class="group-head"><h2 id="recent-h">${esc(t.recent)}</h2></header><ol class="rows"></ol></section>` : ""}
${tools ? `<p class="empty" id="empty" hidden>${esc(t.noMatch)}</p>` : ""}`;

  return shell(theme, t.title, body, options, newestDate(entries.map((e) => e.lastmod)));
}

export function indexPage(parts: { loc: string; lastmod?: string; count: number; label?: string }[], theme: Theme, options: PageOptions = {}): string {
  const t = stringsFor(options.lang);
  const total = parts.reduce((s, p) => s + p.count, 0);
  const rows = parts
    .map((p, i) => `<li class="row"><span class="num">${pad(i + 1, 2)}</span><a class="url" href="${esc(pathOf(p.loc))}">${esc(p.label ?? pathOf(p.loc))}</a><span class="lang">${p.count}</span><span class="date">${p.lastmod ? esc(p.lastmod) : ""}</span></li>`)
    .join("\n");
  const body = `<p class="eyebrow">${esc(t.indexTitle)}</p>
<h1>${esc(t.heading(theme.name))}<span class="mark">.</span></h1>
<p class="facts"><span><b>${total}</b> ${esc(t.pages(total))}</span><span><b>${parts.length}</b> ${esc(t.files(parts.length))}</span></p>
<section class="group" aria-labelledby="parts-h"><header class="group-head"><h2 id="parts-h">${esc(t.filesSection)}</h2><span class="count">${parts.length}</span></header><ol class="rows">
${rows}
</ol></section>`;
  return shell(theme, t.indexTitle, body, options, newestDate(parts.map((p) => p.lastmod)));
}

/** A CSS string literal: quotes and backslashes escaped, a newline as \A. */
const cssText = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;

/**
 * The XML as a browser shows it when it can't be told apart from a crawler:
 * a static host, or a browser without Sec-Fetch-Dest. CSS can't add links, so
 * it sets the file in the site's type and colours, says what the file is, and
 * names the page for people when there is one (static mode's /sitemap/).
 */
export function xmlCss(theme: Theme, options: { lang?: string; page?: string } = {}): string {
  const t = stringsFor(options.lang);
  const root = "urlset,sitemapindex";
  const dark = theme.dark ? `@media (prefers-color-scheme:dark){:root{${vars(theme.dark)}color-scheme:dark}}` : "";
  return `${fontFaces(theme)}
:root{${vars(theme.light)}color-scheme:light;background:var(--bg)}
${dark}
${root}{display:block;max-width:68rem;margin:0 auto;padding:clamp(2rem,6vw,4.5rem) clamp(1rem,4vw,2.5rem) 4rem;color:var(--fg);font:16px/1.6 ${family(theme.fonts, "body")};-webkit-font-smoothing:antialiased}
${root.split(",").map((r) => `${r}::before`).join(",")}{content:${cssText(t.xmlEyebrow)};display:block;margin-bottom:1rem;font:500 .75rem/1.4 ${family(theme.fonts, "mono")};letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
url:first-of-type,sitemap:first-of-type{padding-top:0}
url:first-of-type::before,sitemap:first-of-type::before{content:${cssText(`${t.heading(theme.name)}.`)};display:block;margin-bottom:clamp(2rem,5vw,3.5rem);padding-bottom:1.25rem;border-bottom:1px solid var(--fg);font:600 clamp(2.25rem,7vw,4.5rem)/1.02 ${family(theme.fonts, "display")};letter-spacing:-.035em;text-wrap:balance}
${root.split(",").map((r) => `${r}::after`).join(",")}{content:${cssText(options.page ? `${t.xmlNote} ${t.xmlPage(options.page)}` : t.xmlNote)};display:block;margin-top:2.5rem;font:400 .75rem/1.6 ${family(theme.fonts, "mono")};color:var(--muted)}
url,sitemap{display:block;padding:.85rem 0;border-bottom:1px solid var(--border)}
loc{display:block;overflow-wrap:anywhere;font-size:1.0625rem;letter-spacing:-.005em}
lastmod{display:block;margin-top:.15rem;font:400 .75rem/1.5 ${family(theme.fonts, "mono")};color:var(--muted)}
url>:not(loc):not(lastmod),sitemap>:not(loc):not(lastmod){display:none}`;
}

const fontFaces = (theme: Theme) =>
  theme.fonts
    .flatMap((f) => f.files.map((file) => `@font-face{font-family:"${f.family}";src:url("${file.url}") format("woff2");font-weight:${file.weight ?? "100 900"};font-style:${file.style ?? "normal"};font-display:swap}`))
    .join("\n");

const vars = (p: Palette) =>
  `--bg:${p.background};--fg:${p.foreground};--muted:${p.muted};--border:${p.border};--accent:${p.accent};--surface:${p.surface};`;

const stack = { display: "ui-serif, Georgia, serif", body: "ui-sans-serif, system-ui, sans-serif", mono: "ui-monospace, SFMono-Regular, Menlo, monospace" };

function family(fonts: Font[], role: Font["role"]): string {
  const own = fonts.find((f) => f.role === role) ?? (role === "display" ? fonts.find((f) => f.role === "body") : undefined);
  const fallback = role === "display" && !own ? stack.body : stack[role];
  return own ? `"${own.family}", ${fallback}` : fallback;
}

export function pageCss(theme: Theme): string {
  const faces = fontFaces(theme);
  const dark = theme.dark
    ? `@media (prefers-color-scheme:dark){:root{${vars(theme.dark)}color-scheme:dark}}`
    : "";
  return `${faces}
:root{${vars(theme.light)}color-scheme:light;--display:${family(theme.fonts, "display")};--body:${family(theme.fonts, "body")};--mono:${family(theme.fonts, "mono")}}
${dark}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
[hidden]{display:none!important}
body{background:var(--bg);color:var(--fg);font:16px/1.6 var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.page{max-width:68rem;margin:0 auto;padding:clamp(2rem,6vw,4.5rem) clamp(1rem,4vw,2.5rem) 4rem}
.brand{display:inline-flex;align-items:center;min-height:44px;font:600 1.125rem/1 var(--display);letter-spacing:-.01em;text-decoration:none}
.eyebrow{margin-top:clamp(2.5rem,7vw,4.5rem);font:500 .75rem/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
h1{margin-top:.75rem;max-width:18ch;font:600 clamp(2.25rem,6.5vw,4.5rem)/1.02 var(--display);letter-spacing:-.03em;text-wrap:balance}
.mark{color:var(--accent)}
.facts{margin-top:1.5rem;display:flex;flex-wrap:wrap;gap:.25rem 1.5rem;font:400 .8125rem/1.5 var(--mono);color:var(--muted)}
.facts b{color:var(--fg);font-weight:500}
.tools{position:sticky;top:0;z-index:2;margin:2rem calc(-1 * clamp(1rem,4vw,2.5rem)) 0;padding:.75rem clamp(1rem,4vw,2.5rem);display:flex;flex-wrap:wrap;align-items:center;gap:.625rem;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.search{flex:1 1 16rem;min-width:0;height:44px;padding:0 1rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--fg);font:inherit;font-size:.9375rem}
.search::placeholder{color:var(--muted)}
.search:focus-visible{outline-offset:0}
.chips{display:flex;gap:.375rem;min-width:0;max-width:calc(100% + 8px);overflow-x:auto;padding:4px;margin:-4px;scrollbar-width:none}
.chip{flex:none;height:44px;min-width:44px;padding:0 .875rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--muted);font:500 .75rem/1 var(--mono);letter-spacing:.04em;cursor:pointer}
.chip:hover{color:var(--fg)}
.chip[aria-pressed="true"]{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.tally{flex-basis:100%;font:400 .75rem/1 var(--mono);color:var(--muted)}
.tally:empty{display:none}
.jump{margin-top:1.5rem;display:flex;flex-wrap:wrap;gap:.5rem}
.jump a{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;padding:0 .875rem;border:1px solid var(--border);border-radius:999px;font-size:.8125rem;color:var(--muted);text-decoration:none}
.jump a:hover{color:var(--fg);border-color:var(--fg)}
.jump span{font-family:var(--mono);font-size:.75rem}
.group{margin-top:clamp(2.5rem,6vw,4rem);scroll-margin-top:6rem}
.group-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--fg)}
h2{min-width:0;overflow-wrap:anywhere;font:600 clamp(1.5rem,3.5vw,2.25rem)/1.1 var(--display);letter-spacing:-.02em}
.count{font:400 .8125rem/1 var(--mono);color:var(--muted)}
.rows{list-style:none}
.row{display:grid;grid-template-columns:3.25rem minmax(0,1fr) auto 6.5rem;align-items:baseline;gap:1rem;padding:.25rem 0;border-bottom:1px solid var(--border)}
.num,.date{font:400 .75rem/1.4 var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.date{text-align:right}
.url{display:block;min-width:0;min-height:44px;padding:.625rem 0;overflow-wrap:anywhere;text-decoration:none;font-size:.9375rem;line-height:1.5;text-underline-offset:.25em}
.url:hover{text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:2px}
.lang{font:500 .6875rem/1 var(--mono);letter-spacing:.06em;padding:.25rem .5rem;border:1px solid var(--border);border-radius:999px;color:var(--muted)}
.langs{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.375rem;max-width:16rem}
a.lang{position:relative;color:var(--fg);text-decoration:none}
a.lang:hover{border-color:var(--fg)}
a.lang::after{content:"";position:absolute;inset:-12px -2px}
#recent-list .num{visibility:hidden}
.empty{margin-top:clamp(2rem,5vw,3rem);max-width:44ch;color:var(--muted)}
.foot{margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem 1.5rem;font:400 .75rem/1.5 var(--mono);color:var(--muted)}
.foot p{margin:0}
.about span+span::before{content:" · "}
.foot a{color:var(--fg);text-underline-offset:.2em;white-space:nowrap}
.foot a:hover{color:var(--accent)}
@media (max-width:40rem){.row{grid-template-columns:2.5rem minmax(0,1fr) auto}.row.many .langs{grid-column:2/-1;justify-content:flex-start;max-width:none;padding-bottom:.75rem}.date{display:none}}
@media (prefers-reduced-motion:no-preference){.url,.chip,.jump a,a.lang{transition:color .15s,border-color .15s,background-color .15s}}
`;
}

/**
 * Served as ?asset=page.js. Filters by path and language, shows each row's
 * version in the language picked, lists the pages newest first on demand, and
 * keeps the count live.
 */
export const PAGE_JS = `(function () {
  var q = document.getElementById("q");
  if (!q) return;
  var rows = [].slice.call(document.querySelectorAll(".row[data-u]"));
  var homes = rows.map(function (r) { return r.parentNode; });
  var groups = [].slice.call(document.querySelectorAll(".group"));
  var chips = [].slice.call(document.querySelectorAll(".chip[data-f]"));
  var sort = document.getElementById("recent");
  var list = document.getElementById("recent-list");
  var jump = document.querySelector(".jump");
  var tally = document.getElementById("tally");
  var empty = document.getElementById("empty");
  var lang = "", recent = false;
  function show(r) {
    var data = r.getAttribute("data-v");
    if (!data) return;
    var versions = JSON.parse(data), url = r.querySelector(".url"), langs = r.querySelector(".langs"), pick = null;
    if (!r.own) r.own = [url.getAttribute("hreflang"), url.getAttribute("href")];
    versions.forEach(function (v) { if (v[0] === lang) pick = v; });
    pick = pick || r.own;
    if (url.getAttribute("href") === pick[1]) return;
    url.setAttribute("href", pick[1]);
    url.setAttribute("hreflang", pick[0]);
    url.textContent = pick[1];
    langs.textContent = "";
    versions.forEach(function (v) {
      var current = v[1] === pick[1], tag = document.createElement(current ? "span" : "a");
      tag.className = current ? "lang is-current" : "lang";
      if (!current) { tag.setAttribute("href", v[1]); tag.setAttribute("hreflang", v[0]); }
      tag.textContent = v[0].toUpperCase();
      langs.appendChild(tag);
    });
  }
  function order() {
    if (recent) {
      var target = list.querySelector(".rows");
      rows.slice().sort(function (a, b) {
        var x = a.getAttribute("data-d") || "", y = b.getAttribute("data-d") || "";
        return x < y ? 1 : x > y ? -1 : 0;
      }).forEach(function (r) { target.appendChild(r); });
    } else {
      rows.forEach(function (r, i) { homes[i].appendChild(r); });
    }
  }
  function apply() {
    var term = q.value.trim().toLowerCase(), shown = 0;
    rows.forEach(function (r) {
      var ok = (!term || r.getAttribute("data-u").indexOf(term) !== -1) && (!lang || (" " + (r.getAttribute("data-l") || "") + " ").indexOf(" " + lang + " ") !== -1);
      r.hidden = !ok;
      if (ok) shown++;
      show(r);
    });
    groups.forEach(function (g) { g.hidden = (g === list) !== recent || !g.querySelector(".row:not([hidden])"); });
    if (jump) jump.hidden = recent;
    tally.textContent = term || lang ? (tally.getAttribute("data-t") || "{shown} of {total} pages").replace("{shown}", shown).replace("{total}", rows.length) : "";
    empty.hidden = shown !== 0;
  }
  q.addEventListener("input", apply);
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      lang = chip.getAttribute("data-f");
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      apply();
    });
  });
  if (sort) {
    sort.addEventListener("click", function () {
      recent = !recent;
      sort.setAttribute("aria-pressed", recent ? "true" : "false");
      order();
      apply();
    });
  }
})();
`;
