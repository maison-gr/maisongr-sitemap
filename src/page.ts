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

const titleOf = (section: string) => (section ? `/${decodeURIComponent(section)}/` : "Pages");

function shell(theme: Theme, title: string, body: string, options: PageOptions): string {
  const assets = options.assets ?? ASSETS;
  return `<!doctype html>
<html lang="en">
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
<footer class="foot"><span>Search engines read the XML version of this list.</span>${options.credit !== false ? `<span>Sitemap by <a href="https://www.maisongr.com" rel="noopener">Maison GR</a></span>` : ""}</footer>
</main>
<script src="${esc(assets.js)}" defer></script>
</body>
</html>`;
}

export function urlsetPage(entries: Entry[], theme: Theme, options: PageOptions = {}): string {
  const langs = [...new Set(entries.map((e) => e.lang).filter((l): l is string => !!l))];
  const width = String(entries.length).length < 2 ? 2 : String(entries.length).length;

  const sections = sectionsOf(entries);

  let n = 0;
  const groups = [...sections].map(([key, rows], i) => {
    const id = `s-${i}`;
    const items = rows
      .map((e) => {
        n += 1;
        const path = pathOf(e.loc);
        return `<li class="row" data-u="${esc(path.toLowerCase())}"${e.lang ? ` data-l="${esc(e.lang)}"` : ""}>
<span class="num">${pad(n, width)}</span><a class="url" href="${esc(path)}">${esc(path)}</a>${e.lang ? `<span class="lang">${esc(e.lang.toUpperCase())}</span>` : "<span></span>"}<span class="date">${e.lastmod ? esc(e.lastmod) : ""}</span>
</li>`;
      })
      .join("\n");
    return `<section class="group" id="${id}" aria-labelledby="${id}-h"><header class="group-head"><h2 id="${id}-h">${esc(titleOf(key))}</h2><span class="count">${rows.length}</span></header>
<ol class="rows">
${items}
</ol></section>`;
  });

  const counts = langs.map((l) => `<span><b>${entries.filter((e) => e.lang === l).length}</b> ${esc(l.toUpperCase())}</span>`).join("");
  const chips = langs.length > 1
    ? `<div class="chips" role="group" aria-label="Language"><button type="button" class="chip" data-f="" aria-pressed="true">All</button>${langs.map((l) => `<button type="button" class="chip" data-f="${esc(l)}" aria-pressed="false">${esc(l.toUpperCase())}</button>`).join("")}</div>`
    : "";

  const heading = `<p class="eyebrow">Sitemap</p>
<h1>Every page on ${esc(theme.name)}<span class="mark">.</span></h1>`;
  if (!entries.length) {
    return shell(theme, "Sitemap", `${heading}\n<p class="empty">No pages are listed yet. They appear here, and in the XML, once the site publishes them.</p>`, options);
  }

  const body = `${heading}
<p class="facts"><span><b>${entries.length}</b> ${entries.length === 1 ? "page" : "pages"}</span>${counts}</p>
<div class="tools">
<input id="q" class="search" type="search" placeholder="Filter by path" aria-label="Filter pages by path" autocomplete="off" spellcheck="false">
${chips}
<p class="tally" id="tally" aria-live="polite"></p>
</div>
${sections.size > 1 && sections.size <= 12 ? `<nav class="jump" aria-label="Sections">${[...sections].map(([key, rows], i) => `<a href="#s-${i}">${esc(titleOf(key))} <span>${rows.length}</span></a>`).join("")}</nav>` : ""}
${groups.join("\n")}
<p class="empty" id="empty" hidden>No page matches this filter.</p>`;

  return shell(theme, "Sitemap", body, options);
}

export function indexPage(parts: { loc: string; lastmod?: string; count: number }[], theme: Theme, options: PageOptions = {}): string {
  const total = parts.reduce((s, p) => s + p.count, 0);
  const rows = parts
    .map((p, i) => `<li class="row"><span class="num">${pad(i + 1, 2)}</span><a class="url" href="${esc(pathOf(p.loc))}">${esc(pathOf(p.loc))}</a><span class="lang">${p.count}</span><span class="date">${p.lastmod ? esc(p.lastmod) : ""}</span></li>`)
    .join("\n");
  const body = `<p class="eyebrow">Sitemap index</p>
<h1>Every page on ${esc(theme.name)}<span class="mark">.</span></h1>
<p class="facts"><span><b>${total}</b> pages</span><span><b>${parts.length}</b> files</span></p>
<section class="group" aria-labelledby="parts-h"><header class="group-head"><h2 id="parts-h">Files</h2><span class="count">${parts.length}</span></header><ol class="rows">
${rows}
</ol></section>`;
  return shell(theme, "Sitemap index", body, options);
}

/** The XML styled with CSS, for browsers that open the sitemap without sending Sec-Fetch-Dest. */
export const xmlCss = (theme: Theme) => `urlset,sitemapindex{display:block;max-width:68rem;margin:0 auto;padding:3rem 1rem;background:${theme.light.background};color:${theme.light.foreground};font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
url,sitemap{display:block;padding:.5rem 0;border-bottom:1px solid ${theme.light.border}}
loc{display:block;overflow-wrap:anywhere}
lastmod{display:block;font:12px ui-monospace,monospace;color:${theme.light.muted}}
link{display:none}`;

const vars = (p: Palette) =>
  `--bg:${p.background};--fg:${p.foreground};--muted:${p.muted};--border:${p.border};--accent:${p.accent};--surface:${p.surface};`;

const stack = { display: "ui-serif, Georgia, serif", body: "ui-sans-serif, system-ui, sans-serif", mono: "ui-monospace, SFMono-Regular, Menlo, monospace" };

function family(fonts: Font[], role: Font["role"]): string {
  const own = fonts.find((f) => f.role === role) ?? (role === "display" ? fonts.find((f) => f.role === "body") : undefined);
  const fallback = role === "display" && !own ? stack.body : stack[role];
  return own ? `"${own.family}", ${fallback}` : fallback;
}

export function pageCss(theme: Theme): string {
  const faces = theme.fonts
    .flatMap((f) => f.files.map((file) => `@font-face{font-family:"${f.family}";src:url("${file.url}") format("woff2");font-weight:${file.weight ?? "100 900"};font-style:${file.style ?? "normal"};font-display:swap}`))
    .join("\n");
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
.empty{margin-top:clamp(2rem,5vw,3rem);max-width:44ch;color:var(--muted)}
.foot{margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem 1.5rem;font:400 .75rem/1.5 var(--mono);color:var(--muted)}
.foot a{color:var(--fg)}
@media (max-width:40rem){.row{grid-template-columns:2.5rem minmax(0,1fr) auto}.date{display:none}}
@media (prefers-reduced-motion:no-preference){.url,.chip,.jump a{transition:color .15s,border-color .15s,background-color .15s}}
`;
}

/** Served as ?asset=page.js. Filters by path and language; keeps the count live. */
export const PAGE_JS = `(function () {
  var q = document.getElementById("q");
  if (!q) return;
  var rows = [].slice.call(document.querySelectorAll(".row[data-u]"));
  var groups = [].slice.call(document.querySelectorAll(".group"));
  var chips = [].slice.call(document.querySelectorAll(".chip"));
  var tally = document.getElementById("tally");
  var empty = document.getElementById("empty");
  var lang = "";
  function apply() {
    var term = q.value.trim().toLowerCase(), shown = 0;
    rows.forEach(function (r) {
      var ok = (!term || r.getAttribute("data-u").indexOf(term) !== -1) && (!lang || r.getAttribute("data-l") === lang);
      r.hidden = !ok;
      if (ok) shown++;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector(".row:not([hidden])"); });
    tally.textContent = term || lang ? shown + " of " + rows.length + " pages" : "";
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
})();
`;
