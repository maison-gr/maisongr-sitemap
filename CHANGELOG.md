# Changelog

All notable changes to `maisongr-sitemap`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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
