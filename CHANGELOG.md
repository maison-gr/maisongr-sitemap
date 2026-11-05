# Changelog

All notable changes to `maisongr-sitemap`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Every kind of site, tested on real projects: a Vite app, a Pages Router project, Eleventy, a hand-written HTML site and a server that renders each page on request.

### Added

- `crawl <url> --out <dir>`: a sitemap for a site in any language (PHP, Python, Ruby, Go, a CMS), read the way a search engine reads it. It follows `robots.txt`, `noindex` and `X-Robots-Tag`, `nofollow`, canonicals, redirects and `hreflang`, and dates a page only from what it states.
- Single-page apps: `init` sets up Vite and Create React App projects, and static mode lists the pages their router declares (React Router, Vue Router, TanStack, Solid, Wouter, Preact Router, svelte-spa-router), nested routes joined.
- Pages Router pages are listed from their own `getStaticPaths`.
- Static mode dates hand-written HTML from Git, takes `--add` for addresses no file holds, and `--clean-urls`.
- `init --site` for a static generator with a `build` script (Eleventy and the like) adds static mode to it.
- A clearer CLI: every line is marked ✓ done, ! needs a look or → next step, grouped under Found, Left out, Wrote and Next, and each run ends with Done and how many lines need a look. Errors say the cause first and the fix under it; a mistyped command suggests the one meant; an unexpected failure says it's a bug and where to report it, and exits with 2. Colour only on a terminal that shows it (`NO_COLOR`, `FORCE_COLOR` and `--no-color` are followed), and ASCII symbols in the old Windows console. `crawl` shows its progress as it reads.

### Fixed

- Static mode lists `/about.html` when the site links to it that way, instead of an `/about` that plain Apache and nginx don't serve.
- Static mode names the site from `og:site_name` or the part its titles share, not the first word of the home page's title.
- `init --site` is written into the route of a site with a server, and `init` no longer says "App Router" for a project that only has the Pages Router.

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

[1.1.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.1.0
[1.0.0]: https://github.com/maison-gr/sitemap/releases/tag/v1.0.0
