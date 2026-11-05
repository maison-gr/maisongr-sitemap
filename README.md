# @maison-gr/sitemap

One sitemap, two readers. Search engines get the XML they need. A person who opens `/sitemap.xml` gets a page in your site's own colours, fonts and dark mode, with every address as a link and a filter.

```sh
npx @maison-gr/sitemap init
```

`init` detects your framework, finds your pages, dates each one from Git, reads your theme, and writes one route file. Nothing to design, nothing to keep in sync.

## Why

- **Browsers are removing XSLT.** A sitemap styled with an `.xsl` file now opens on a warning, or not at all.
- **Hand-written sitemaps drift.** A new page, a new language, or a renamed route is forgotten until Search Console complains.
- **`<lastmod>` is usually false.** Most generators stamp the build time on every page, so Google and Bing learn to ignore it. This one uses the date of the last commit that changed each page.

## What `init` does (Next.js)

1. **Detects** Next.js, App Router and Pages Router.
2. **Finds the pages** from your route files. It leaves out:
   - route groups, private folders, parallel and intercepting routes;
   - pages marked `noindex`, including through a helper such as `privatePageMetadata()`;
   - sign-in, account, admin, checkout and developer pages.

   Every page it leaves out is listed, with the reason.
3. **Finds your languages**, from `[locale]` folders or from middleware that puts every page under `/{language}/`. Each language version is its own entry, with `hreflang` alternates and `x-default`.
4. **Dates every page** from Git. Commit `manifest.json`: in a shallow CI clone, where Git can't date older files, it keeps the dates already there instead of inventing new ones.
5. **Reads your theme**:
   - colour tokens: shadcn, Tailwind v4 `@theme`, or plain CSS variables, light and dark;
   - your `next/font` fonts, served from your own domain under `/_sitemap/`;
   - your site name and icon.
6. **Writes** `app/sitemap.xml/route.ts` and `manifest.json`, and puts `maisongr-sitemap build` at the start of your `build` script, so every build re-reads all of it. It goes in `build` itself, not `prebuild`, because pnpm and Yarn 2+ never run `prebuild`.

Then install it: `npm install @maison-gr/sitemap`.

## The route

```ts
import { sitemap } from "@maison-gr/sitemap/next";
import manifest from "./manifest.json";

export const dynamic = "force-dynamic";

export const GET = sitemap({
  manifest,
  // Dynamic routes are listed once you give their values:
  params: {
    "/blog/[slug]": async () => (await getPosts()).map((p) => ({ slug: p.slug, lastmod: p.updatedAt })),
  },
});
```

| Option | |
|---|---|
| `params` | Values for dynamic routes, keyed by route pattern. Each row may carry its own `lastmod`. |
| `entries` | Extra addresses no route file describes. |
| `exclude` | Paths to leave out: exact (`"/thanks"`), prefix (`"/drafts/"`) or `RegExp`. |
| `locales` | Override the detected languages: `{ list, default, prefix? }`. |
| `site` | The address the site is served at. Detected from `metadataBase` or `SITE_URL`. |
| `revalidate` | Seconds the list is kept before `params` and `entries` run again. Default 3600. |
| `theme` | Override any detected colour, font, name or icon. |
| `credit` | The "Sitemap by Maison GR" footer line. Default `true`. |

## How it serves two readers

A browser opening a page sends `Sec-Fetch-Dest: document`; crawlers never do. That request gets the designed page; every other request gets the XML.

- Both list exactly the same addresses. It's one file presented two ways, not cloaking.
- The page is `X-Robots-Tag: noindex`, and both carry `Vary: Sec-Fetch-Dest`, so no cache mixes them up.
- The XML keeps an `<?xml-stylesheet?>` with plain CSS for browsers that don't send the header.

**It works under a strict Content-Security-Policy.** The page has no inline script or style: both load from the sitemap's own address (`?asset=page.css`, `?asset=page.js`), and the fonts load from your own domain. `default-src 'self'` allows all of it, with no hashes or nonces to maintain.

Past 50,000 addresses, it becomes a sitemap index of `?part=N` files.

## Static sites

A static host can't tell browsers from crawlers, so this writes two things side by side:

```sh
npx @maison-gr/sitemap static out --site https://www.example.com
```

- `sitemap.xml`, styled with CSS, for crawlers;
- the designed page at `/sitemap/`, for people.

It reads the built HTML, so each page's language and `hreflang` links come from the pages themselves. Pages marked `noindex` and redirects are left out. Fonts come from your stylesheets' `@font-face` rules.

## Status

`0.1`: Next.js, plus static mode, which covers any framework's static build. Astro, SvelteKit, Nuxt and Express adapters are next. `init` recognises them already and points to static mode for now.

Zero runtime dependencies. Node 18.18 or later.

## License

MIT © [Maison GR](https://www.maisongr.com)
