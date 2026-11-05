# Changelog

All notable changes to `@maison-gr/sitemap`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- `@maison-gr/sitemap/node` for Express, Connect, Polka and `node:http`, and `createSitemap` for any server that speaks `Request` and `Response`.
- `static <dir>` for static sites: `sitemap.xml` styled with CSS, and the designed page at `/sitemap/`.
- Sitemap index of `?part=N` files past 50,000 addresses.
- Image, video and news sitemaps, with only the tags Google still reads. `static --images` takes each page's images from its HTML.
- `indexnow`: sends changed addresses to Bing and the other IndexNow engines, after checking the site serves its key.
- `init` says when `robots.txt` doesn't name the sitemap.
- Next.js 16 `cacheComponents` support: the route is written without the `dynamic` export that mode refuses.
