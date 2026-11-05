# Changelog

All notable changes to `maisongr-sitemap`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[1.5.1]: https://github.com/maison-gr/sitemap/releases/tag/v1.5.1
[1.5.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.5.0
[1.4.1]: https://github.com/maison-gr/sitemap/releases/tag/v1.4.1
[1.4.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.4.0
[1.3.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.3.0
[1.2.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.2.0
[1.1.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.1.0
[1.0.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.0.0
