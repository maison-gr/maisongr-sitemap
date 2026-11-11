# Changelog

All notable changes to `maisongr-sitemap`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A Claude Code plugin: the Agent Skill and the MCP server in one install, `/plugin install maisongr-sitemap --marketplace maison-gr/maisongr-skills`. The server it starts is pinned to the plugin's own version, and a test keeps the two in step with the package.
- `llms` warns about meta descriptions over 160 characters, which search results cut, and under 50, naming up to three pages for each.

### Changed

- The repository is now `maison-gr/maisongr-sitemap`, matching the npm package. The old address redirects. The Agent Skill installs with `npx skills add maison-gr/maisongr-sitemap`; the MCP server keeps its registry name, `io.github.maison-gr/sitemap`.

### Fixed

- `static` leaves out `200.html`, the empty app shell `nuxt generate` writes for every route it didn't prerender, which it listed as a page called `/200` ([#4](https://github.com/maison-gr/maisongr-sitemap/issues/4)).
- `indexnow` follows only the parts of a sitemap index on the site's own host, as search engines do, so a sitemap can no longer make it fetch another address. Reading the sitemap and checking the key file now give up after 20 seconds instead of waiting forever.
- A Next.js icon kept in a route group (`app/(site)/icon.svg`) now shows on the sitemap page. Next serves such an icon at a hashed address, so `build` copies it to `public/_sitemap/` beside the fonts and links it from there; before, the page had no icon and browsers asked for a missing `/favicon.ico`.

## [1.7.0] - 2026-11-10

The XML search engines read is byte for byte what 1.6.0 served; every change below is about the page people see, and about keeping the two answers apart.

### Added

- One row per page on the page people see: a page's language versions share a row, the version in the page's language shown and the others linked beside it, so a bilingual site lists half as many rows. Every address is still a link, exactly once. Picking a language in the filter shows each row's version in that language.
- A "Recently updated" button lists the pages newest first, then puts them back in their sections.
- An `ETag` on every answer, and `304 Not Modified` when a request's `If-None-Match` still matches, so a crawler skips an unchanged sitemap. Only the tag decides, never a date: a date would miss an address that was taken out. A `Last-Modified` header gives the newest page's date.

### Changed

- The filter, language buttons and sort appear above 10 rows; a shorter list reads faster on its own. The facts line counts pages and, when language versions share rows, addresses.
- The page is `Cache-Control: private`, so a shared cache never stores it, even one that ignores `Vary` (some CDNs do) and could otherwise give it to a crawler as the sitemap. The XML stays `public`.
- A browser gets the page only when it sends both `Sec-Fetch-Dest: document` and an `Accept` that asks for HTML, as every browser does when a person opens an address; a fetcher built on a browser engine that sends only the first gets the XML. The Vite plugin decides the same way. Check a server setup with `curl -H "Sec-Fetch-Dest: document" -H "Accept: text/html"`.
- A sitemap splits into parts past 50 MB of XML as well as past 50,000 addresses, the protocol's two limits per file: a multilingual site with images can reach 50 MB first.
- On a phone, a page in more than three languages puts its language links on their own line; two or three stay beside the address.

## [1.6.0] - 2026-11-05

### Added

- `init --replace` takes over from another sitemap: next-sitemap, @astrojs/sitemap, @nuxtjs/sitemap, super-sitemap, svelte-sitemap, a hand-written route, or a sitemap in the public folder, with its `.xsl` file. The old files move to `.sitemap-replaced/`, nothing is deleted, the old tool leaves the scripts and the Astro or Nuxt config (copied aside first), and next-sitemap's `siteUrl` is kept. It warns about rules that don't carry over, and about Astro's address changing from `/sitemap-index.xml` to `/sitemap.xml`. `init` without the flag stops as before, and now says this is possible.
- `--json` on any command prints one report on stdout, for scripts and coding agents.
- `maisongr-sitemap mcp` serves the commands as tools over the Model Context Protocol (stdio).
- An Agent Skill (`npx skills add maison-gr/maisongr-sitemap`) and `llms.txt`, both in the package.

## [1.5.1] - 2026-11-05

### Changed

- `maisongr-sitemap/vite` answers `/sitemap`, `/sitemap/` and `/sitemap/index.html` with a redirect to `/sitemap.xml`, so the sitemap has one address in dev, as with the host rules. The README's Cloudflare and Vercel rules add the same redirect.

## [1.5.0] - 2026-11-05

Found by testing AquaDrill, a Vite app on a static host, as its visitors and search engines see it.

### Added

- `maisongr-sitemap/vite`: a Vite plugin that serves the sitemap during `vite dev`, where the build's static step never runs and the app's catch-all route answered `/sitemap.xml` with its 404. A browser opening `/sitemap.xml` gets the page and a crawler the XML, as in production with the host rule now documented under "One address on a static host" (Cloudflare and Vercel). It answers `/sitemap.xml`, `/sitemap/` and their files from the router's routes and the source stylesheets, the same files the build writes, and reads the routes again on each request.

### Changed

- The page's footer says when the newest page last changed (« Mis à jour le 5 novembre 2026 »), and the credit names the tool it was made with and links to its source: "Made with maisongr-sitemap, open source, by Maison GR". `credit: false` and `--no-credit` still leave it out.
- The XML file, as a browser shows it on a static host, is set in the site's fonts and colours, light and dark, with a heading, and says what it is. In static mode it names the page for people: « La page à lire est à l’adresse /sitemap/ ». It was a bare list in the system font.

### Fixed

- `build` no longer warns about a dynamic route that the route file gives values for, and a route named only in a comment still counts as missing.
- Static mode wrote a font's `@font-face` twice when the build held it both in a stylesheet and inlined in the home page.
- A single-page app's routes and `--add` addresses take the language `index.html` declares, so the page counts every page in it, not only the prerendered ones.

## [1.4.1] - 2026-11-05

### Fixed

- Words such as recovery, verify, confirm, register and invite make a page private only on their own (`/register`) or beside an account word (`verify-email`, `order-confirmation`). A guide named `recovery-strategies` was left out by `crawl` and static mode.

## [1.4.0] - 2026-11-05

Found by moving AquaDrill, a prerendered Vite app, onto the package.

### Added

- A single-page app's pages are dated from Git by the file of the component each route renders (`element={<Services />}`, `lazy(() => import("./pages/Services"))`), so each `lastmod` is true. A page the build prerendered takes its route's date.

### Fixed

- Routes that only redirect (`<Navigate>`, `redirect:`) and the not-found catch-all (`*`, `/:pathMatch(.*)*`) are left out, and named as such, instead of being listed or asked for values.
- The CLI says "its" for one dynamic route, "their" for several.

## [1.3.0] - 2026-11-05

### Added

- The page people see speaks French for a French site: « Plan du site », « Toutes les pages de… », the filter and its live count, the footer, and `<html lang>`. It follows the site's default language; `lang` sets it, and `--lang` in static mode and `crawl`, which otherwise take the home page's `<html lang>`.
- `connect`: robots.txt naming the sitemap (created, or the line added, after asking; `--yes` in CI), and the files Google Search Console (`--google`), Bing Webmaster Tools (`--bing`) and IndexNow (`--indexnow`) check to verify the site. A file with other content is never replaced; a robots.txt written by code, or naming another sitemap, gets advice instead of an edit.
- `llms`: llms.txt for AI assistants, from the sitemap, one version of each page, in each page's own title and description. Reads a running copy with `--from`; never replaces one written by hand.

### Fixed

- A page that is noindex only for some content (`shouldIndex ? { index: true } : { index: false }`) is listed, not left out as always noindex.

## [1.2.0] - 2026-11-05

Every kind of site, tested on real projects: a Vite app, a Pages Router project, Eleventy, a hand-written HTML site and a server that renders each page on request.

### Added

- `crawl <url> --out <dir>`: a sitemap for a site in any language (PHP, Python, Ruby, Go, a CMS), read the way a search engine reads it. It follows `robots.txt`, `noindex` and `X-Robots-Tag`, `nofollow`, canonicals, redirects and `hreflang`, and dates a page only from what it states.
- Single-page apps: `init` sets up Vite and Create React App projects, and static mode lists the pages their router declares (React Router, Vue Router, TanStack, Solid, Wouter, Preact Router, svelte-spa-router), nested routes joined.
- Pages Router pages are listed from their own `getStaticPaths`.
- Static mode dates hand-written HTML from Git, takes `--add` for addresses no file holds, and `--clean-urls`.
- `init --site` for a static generator with a `build` script (Eleventy and the like) adds static mode to it.
- A clearer CLI: every line is marked ✓ done, ! needs a look or → next step, grouped under Found, Left out, Wrote and Next, and each run ends with Done and how many lines need a look. Errors say the cause first and the fix under it; a mistyped command suggests the one meant; an unexpected failure says it's a bug and where to report it, and exits with 2. Colour only on a terminal that shows it (`NO_COLOR`, `FORCE_COLOR` and `--no-color` are followed), and ASCII symbols in the old Windows console. `crawl` shows its progress as it reads.
- After `init`, a "You can also" list: `build`, `indexnow`, `--help` and the guide. The fixes it prints use `npx`, as you'd type them.

### Fixed

- Static mode lists `/about.html` when the site links to it that way, instead of an `/about` that plain Apache and nginx don't serve.
- Static mode names the site from `og:site_name` or the part its titles share, not the first word of the home page's title.
- `init --site` is written into the route of a site with a server, and `init` no longer says "App Router" for a project that only has the Pages Router.
- `init` run again keeps the route and says so; given a `--site` the route lacks, it adds it, and one that names another address is kept with a warning. It used to report the route as written while keeping the old one.
- `crawl` and static mode read minified HTML, whose attributes have no quotes (`<a href=/pricing>`, `<link rel=canonical …>`). A crawl of such a site found only its home page.
- A missing `public/robots.txt` is reported as missing, not as a file that doesn't name the sitemap.

## [1.1.0] - 2026-11-05

Found and fixed by moving four production sites onto the package.

### Added

- Next.js dynamic pages are listed from their own `generateStaticParams`, with no `params` entry.
- `transform` option: change each entry before it's listed, or return `null` to leave it out.
- `invalidate()` on the handler, so new content is listed at once instead of when `revalidate` runs out.
- Regional `hreflang` codes the pages declare, such as `fr-CA` and `en-CA`.
- `init` and `build` for Express: they follow `express.static(...)` to the frontend and read its theme, write `sitemap.js` as CommonJS or ESM to match the server, and flag an old sitemap route left in it.
- Languages declared as a TypeScript type, and a layout found under `[lang]` when there is no root layout.
- Pages that only redirect or answer not found, and pages the middleware keeps for signed-in visitors, are left out.
- Fontsource packages hoisted to a workspace's root are found, and font roles are read from a Tailwind config.
- `indexnow --wait`, for a deploy that isn't serving the key yet, and an explanation when an engine answers 403.

### Changed

- Empty sitemaps are left out of the index.
- When a load fails, the last good list is served instead of an error.

### Fixed

- A language version given as a path (`"/fr/a-propos"`) is written as a full address, not a relative one.
- A catch-all's value given as a string keeps its slashes instead of becoming `%2F`.
- Secondary text tokens such as `--color-text-2` are recognised, and so is a site address written as `process.env.SITE_URL || "https://…"`.
- A local font is named after its file, not its CSS variable.
- `readonly` arrays are accepted for images, videos and `params` values.
- Route patterns and slashes are read in linear time, including a language type that could backtrack, and the route file is written atomically.
- A downloaded font is written only when it really is a WOFF2 file.
- A server's entry is found when its `start` script passes options first (`node -r dotenv/config server.js`), and generated route code escapes every character a folder name could hold.

## [1.0.0] - 2026-11-04

The first release.

### Added

- One address, two readers: `/sitemap.xml` serves the XML to crawlers and a designed page, marked `noindex`, to browsers. It decides by `Sec-Fetch-Dest`, with `Vary` on both responses.
- A page with no inline script or style, so it works under `default-src 'self'`.
- `init` for Next.js (App and Pages Router), Astro, SvelteKit and Nuxt, served or static. It refuses to overwrite another sitemap.
- Pages found from each framework's route files. It leaves out `noindex`, private and developer pages, and lists each one it leaves out, with the reason.
- `lastmod` from Git, kept true in shallow CI clones through the committed manifest.
- `hreflang` alternates and `x-default` for:
  - `[locale]` and `[lang]` routes;
  - Next.js middleware that prefixes every page;
  - Astro's `i18n` folders;
  - `@nuxtjs/i18n`.

  A default language served without a prefix is followed too.
- The theme read from the site: colour tokens light and dark, with an AA contrast check on secondary text. Fonts from `next/font`, `@font-face`, Fontsource, Astro's Fonts API or Google Fonts, all served from the site's own domain.
- `basePath`, `trailingSlash` and the site address read from each framework's config.
- `maisongr-sitemap/node` for Express, Connect, Polka and `node:http`, and `createSitemap` for any server that speaks `Request` and `Response`.
- `static <dir>` for static sites: `sitemap.xml` styled with CSS, and the designed page at `/sitemap/`.
- Sitemap index of `?part=N` files past 50,000 addresses.
- Named sitemaps (`sitemaps: { companies, jobs }`) served from the same route, under an index.
- Image, video and news sitemaps, with only the tags Google still reads. `static --images` takes each page's images from its HTML.
- `indexnow`: sends changed addresses to Bing and the other IndexNow engines, after checking the site serves its key.
- `init` says when `robots.txt` doesn't name the sitemap.
- Next.js 16 `cacheComponents` support: the route is written without the `dynamic` export that mode refuses.

[1.6.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.6.0
[1.5.1]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.5.1
[1.5.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.5.0
[1.4.1]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.4.1
[1.4.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.4.0
[1.3.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.3.0
[1.2.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.2.0
[1.1.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.1.0
[1.0.0]: https://github.com/maison-gr/maisongr-sitemap/releases/tag/v1.0.0
