# maisongr-sitemap

**One sitemap, two readers.** Search engines get the XML they need. A person who opens `/sitemap.xml` gets a page in your site's own colours, fonts and dark mode, with every address as a link and a filter.

[![npm version](https://img.shields.io/npm/v/maisongr-sitemap?color=1b1a17)](https://www.npmjs.com/package/maisongr-sitemap)
[![CI](https://github.com/maison-gr/sitemap/actions/workflows/ci.yml/badge.svg)](https://github.com/maison-gr/sitemap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1b1a17)](LICENSE)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime_dependencies-0-1b1a17)
![Node 20.9+](https://img.shields.io/badge/node-%E2%89%A520.9-1b1a17)

![One address, two answers: at https://your.site/sitemap.xml, Google and Bing get the standard XML sitemap, and a person opening the same address in a browser gets a page in the site's own design.](.github/assets/hero.png)

```sh
npx maisongr-sitemap init
```

`init` detects your framework, finds your pages, dates each one from Git, reads your theme, and writes one route file. There's nothing to design and nothing to keep in sync.

## It takes your site's design

The page reads your colours, fonts and dark mode from your own stylesheets. The same package, on three example sites:

![The sitemap page on three example sites, an architecture studio, a software company and a nature blog, each in its own colours and fonts.](.github/assets/themes.png)

## How it compares

| | **maisongr-sitemap** | next-sitemap | @astrojs/sitemap |
|---|---|---|---|
| Frameworks | Next.js, Astro, SvelteKit, Nuxt, Express, any `Request`/`Response` server, any static site | Next.js | Astro |
| What a person sees at `/sitemap.xml` | A page in your site's design | Raw XML | XML styled with your own XSL |
| `lastmod` | The last commit that changed each page | Build time, by default | What you set |
| `hreflang` alternates | Read from your routes and i18n config | Configured | From its `i18n` option |
| Images, videos, news | Yes | Through `transform` | Not documented per page |
| Several sitemaps | Yes | Yes | Yes |
| `robots.txt` | Says when it's missing the sitemap | Generates it | No |
| IndexNow | `maisongr-sitemap indexnow` | No | No |
| Strict CSP (`default-src 'self'`) | Works as is | Raw XML (nothing to load) | Depends on your XSL |

## Why

- **Browsers are removing XSLT.** A sitemap styled with an `.xsl` file now opens on a warning, or not at all.
- **Hand-written sitemaps drift.** A new page, a new language or a renamed route is forgotten until Search Console complains.
- **`<lastmod>` is usually false.** Most generators stamp the build time on every page, so Google and Bing learn to ignore it. This one uses the date of the last commit that changed each page.

## Works with

| | What `init` sets up |
|---|---|
| **Next.js** (App and Pages Router) | `app/sitemap.xml/route.ts` |
| **Astro** with an adapter | `src/pages/sitemap.xml.ts`, rendered on demand |
| **SvelteKit** | `src/routes/sitemap.xml/+server.ts` |
| **Nuxt** 3 and 4 | `server/routes/sitemap.xml.ts` |
| **Static builds**: Astro without an adapter, SvelteKit with `adapter-static`, `nuxt generate` | Static mode, run after your build |
| **Express**, Connect, Polka, `node:http` | `sitemap.js` beside the server's entry, themed from the frontend it serves (see [Express](#express-and-nodehttp)) |
| **Anything that speaks `Request` and `Response`**: Hono, Cloudflare Workers, Bun, Deno, React Router | The [handler](#any-other-server) itself |
| **Any static site**, from any generator | [`static`](#static-sites) on the build output |

Each one has been checked on a real production build: Next.js 15 and 16 (with `cacheComponents`), Astro 7, SvelteKit 3, Nuxt 4 (with `@nuxtjs/i18n`), Express 5, Hono 4 and React Router 8. The handler also runs on Bun 1.4 and Deno 2.9.

## What `init` does

1. **Detects** the framework, and whether the site runs a server or builds static files.
2. **Finds the pages** from your route files, following each framework's rules: route groups, private folders, optional and rest parameters, matchers, ignored files. It leaves out:
   - pages marked `noindex`: in metadata, in a robots meta tag, through a layout prop such as `<Layout noindex />`, or through a helper such as `privatePageMetadata()`;
   - sign-in, account, admin, checkout and developer pages, wherever the word appears in the name (`account-recovery`, `confirm-email-change`), but not inside another word (`accounting` stays). Pass `exclude` for anything else that's private.

   Every page it leaves out is listed, with the reason.
3. **Finds your languages**. Each language version is its own entry, with `hreflang` alternates and `x-default`. It reads:
   - `[locale]` or `[lang]` route folders;
   - Next.js middleware that puts every page under `/{language}/`;
   - Astro's `i18n`, with one folder per language (`src/pages/fr/about.astro`);
   - `@nuxtjs/i18n` and its `strategy`.

   A default language served without a prefix (`/about` beside `/fr/about`) is followed too.
4. **Dates every page** from Git (see [Dates](#dates)).
5. **Reads your theme**:
   - colour tokens, light and dark: shadcn, Tailwind v4 `@theme`, or plain CSS variables, in stylesheets or in a layout's `<style>`;
   - fonts: `next/font`, your own `@font-face` files, Fontsource packages, Astro's Fonts API, or the family your CSS names, fetched once from Google Fonts. All are served from your own domain under `/_sitemap/`;
   - your site's name and icon.
6. **Reads your config**: the site address, and the base path and trailing slash (Next.js `basePath` and `trailingSlash`, Astro `site`, `base` and `trailingSlash`, SvelteKit `paths.base`, Nuxt `app.baseURL` and `site.url`). No address in the sitemap redirects.
7. **Writes** the route and its `manifest.json`, then puts `maisongr-sitemap build` at the start of your `build` script, so every build re-reads all of it. It goes in `build` itself, not `prebuild`, because pnpm and Yarn 2+ never run `prebuild`.

If another file or package already serves `/sitemap.xml` (`next-sitemap`, `@astrojs/sitemap`, `@nuxtjs/sitemap`, a `public/sitemap.xml`), `init` stops and says so, before writing anything.

Then install it: `npm install maisongr-sitemap`.

## The route

The Next.js route, as `init` writes it:

```ts
import { sitemap } from "maisongr-sitemap/next";
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

A dynamic page that exports `generateStaticParams` needs no `params` entry: the route lists the values that function returns.

With Next.js 16's `cacheComponents`, `init` leaves out the `dynamic` line, which that mode refuses. The route stays dynamic because it reads the request.

Astro, SvelteKit and Nuxt routes call `createSitemap` from `maisongr-sitemap` with the same options.

| Option | |
|---|---|
| `manifest` | What the build step wrote. Without one, the sitemap lists `entries` alone, in a neutral theme. |
| `params` | Values for dynamic routes, keyed by the route as the build report names it (`"/blog/[slug]"`). Each row may carry its own `lastmod` and `images`. |
| `entries` | Extra addresses no route file describes. A `loc` may be a path (`"/press"`). Each may carry `images`, `videos` and `news`. |
| `sitemaps` | More sitemaps, by name (see [Several sitemaps](#several-sitemaps)). |
| `exclude` | Paths to leave out, from routes and `entries` alike: exact (`"/thanks"`), prefix (`"/drafts/"`) or `RegExp`. |
| `transform` | Called with each entry before it's listed. Return it changed (to add `images`, say) or `null` to leave it out. |
| `site` | The address the site is served at. Defaults to the manifest's, then the request's. |
| `basePath`, `trailingSlash` | Override what was read from your config. |
| `locales` | Override the detected languages: `{ list, default, prefix?, prefixDefault?, folders? }`. |
| `revalidate` | Seconds the list is kept before `params` and `entries` run again. Default 3600. A failed load is not kept. To list new content at once, call the handler's `invalidate()` when it is published. |
| `theme` | Override any detected colour, font, name or icon. |
| `credit` | The "Sitemap by Maison GR" footer line. Default `true`. |

A `lastmod` can be a `YYYY-MM-DD` string, an ISO timestamp, a `Date` or milliseconds. One that isn't a real date is left out, because an invalid date makes Search Console reject the whole file.

Past 50,000 addresses, the sitemap becomes a sitemap index of `?part=N` files.

There is no `changefreq` or `priority`: Google says it ignores both.

## Several sitemaps

A large site often keeps one sitemap per kind of page, so Search Console reports on each separately:

```ts
sitemap({
  manifest,
  sitemaps: {
    companies: async () => (await db.companies()).map((c) => ({ loc: `/c/${c.slug}`, lastmod: c.updatedAt })),
    jobs: async () => (await db.jobs()).map((j) => ({ loc: `/jobs/${j.id}`, lastmod: j.updatedAt })),
  },
});
```

`/sitemap.xml` then becomes their index:
- `?sitemap=pages`, for the routes and `entries`;
- then `?sitemap=companies` and `?sitemap=jobs`.

Each one still splits into parts past 50,000 addresses. An address is listed once, in the first sitemap that has it. Opened in a browser, the index is a page that links to each sitemap.

## Images, videos and news

Google reads three extensions to the sitemap. Give them per address, and the file declares only the ones it uses:

```ts
entries: async () =>
  (await getPosts()).map((p) => ({
    loc: `/blog/${p.slug}`,
    lastmod: p.updatedAt,
    images: [p.cover], // up to 1,000 per page; paths resolve against the page
    videos: p.video ? [{ thumbnail: p.video.poster, title: p.title, description: p.summary, content: p.video.src }] : [],
    news: p.isNews ? { publication: { name: "Harbour Daily", language: "en" }, publicationDate: p.publishedAt, title: p.title } : undefined,
  })),
```

- **Images** need only their address. Google no longer reads captions, titles or licences, so none are written.
- **Videos** need four things:
  - a thumbnail;
  - a title;
  - a description, up to 2,048 characters;
  - the file (`content`) or a page that plays it (`player`).

  `duration`, `publicationDate`, `familyFriendly` and `live` are optional. A video missing a required field is left out.
- **News** is for news publishers, and Google wants only articles from the last two days.

Rows from `params` take `images` too.

## Express and `node:http`

A server's routes live in code, but its look lives in the frontend it serves. `npx maisongr-sitemap init` in the server's folder:

- follows its `express.static(...)` folders to that frontend: a `public/` folder, or the project a `dist/` is built from (a Vite app beside an API, in a workspace or not);
- reads the theme there (CSS tokens, light and dark, `index.html`, a Tailwind `fontFamily`, Fontsource packages even when a workspace hoists them) and copies the fonts to its `public/_sitemap/`;
- writes `sitemap.manifest.json` and `sitemap.js` beside the server's entry, as CommonJS or an ES module to match it, and prints the line that mounts it.

You list the pages in `sitemap.js`, since only your code knows them:

```js
async function entries() {
  return [{ loc: "/" }, ...(await db.posts()).map((p) => ({ loc: `/blog/${p.slug}`, lastmod: p.updatedAt }))];
}
```

Call `sitemap.invalidate()` when a post is published, so it is listed at once. `maisongr-sitemap build` reads the frontend's theme again after a redesign.

Without the CLI, the adapter takes the same options as everything else:

```ts
import { sitemap } from "maisongr-sitemap/node";

app.get(
  "/sitemap.xml",
  sitemap({
    site: "https://www.example.com",
    entries: async () => [{ loc: "/" }, ...(await db.posts()).map((p) => ({ loc: `/blog/${p.slug}`, lastmod: p.updatedAt }))],
  }),
);
```

It follows Express's `originalUrl` when mounted under a path, and its `protocol` and `hostname` behind a proxy you trust (`app.set("trust proxy", …)`). Errors go to Express's error handler.

## Any other server

The handler takes a `Request` and returns a `Response`:

```ts
import { createSitemap } from "maisongr-sitemap";

const sitemap = createSitemap({ site: "https://www.example.com", entries: () => [{ loc: "/" }, { loc: "/about" }] });

// Hono
app.get("/sitemap.xml", (c) => sitemap(c.req.raw));

// Cloudflare Workers, Bun, Deno
export default {
  fetch(request) {
    if (new URL(request.url).pathname === "/sitemap.xml") return sitemap(request);
    // …the rest of your routes
  },
};

// React Router: route("sitemap.xml", "routes/sitemap.ts") in app/routes.ts, then in app/routes/sitemap.ts
export const loader = ({ request }) => sitemap(request);
```

## How it serves two readers

A browser opening a page sends `Sec-Fetch-Dest: document`; crawlers never do. That request gets the designed page; every other request gets the XML.

- Both list exactly the same addresses. It's one file presented two ways, not cloaking.
- The page is `X-Robots-Tag: noindex`, and both carry `Vary: Sec-Fetch-Dest`, so no cache mixes them up.
- The XML keeps an `<?xml-stylesheet?>` with plain CSS for browsers that don't send the header.

**It works under a strict Content-Security-Policy.** The page has no inline script or style: both load from the sitemap's own address (`?asset=page.css`, `?asset=page.js`), and the fonts load from your own domain. `default-src 'self'` allows all of it, with no hashes or nonces to maintain.

If middleware rewrites or redirects every path (by language, say), let `/sitemap.xml` and `/_sitemap/` through untouched.

## Dates

Each page's `lastmod` is the date of the last commit that changed its route files.

Commit `manifest.json`. Most CI builds clone with a shallow history, where Git can't date older files: the boundary commit would make every page look changed today. The build step leaves those dates out and keeps the ones already in the manifest.

Rows from `params` and `entries` carry their own dates, from your data.

## Static sites

A static host can't tell browsers from crawlers, so this writes two things side by side:

```sh
npx maisongr-sitemap static dist --site https://www.example.com
```

- `sitemap.xml`, styled with CSS, for crawlers;
- the designed page at `/sitemap/`, for people.

It reads the built HTML, so each page's language and `hreflang` links come from the pages themselves. It leaves out pages marked `noindex`, redirects, and sign-in and account pages. The theme comes from your stylesheets and the CSS your build inlined. For a static build of Astro, SvelteKit or Nuxt, `init` adds this step to the end of your `build` script.

Static mode writes no `lastmod`: built files don't say when their content changed, and a build date would be false.

With `--images`, each page's `og:image` and `<img>` sources go into an image sitemap. It's off by default, so icons and tracking pixels aren't listed unless you ask for them.

## Telling search engines

- **robots.txt.** Crawlers find a sitemap through a `Sitemap:` line in `robots.txt`. `init` tells you when the line is missing, without editing the file.
- **Search Console and Bing Webmaster Tools.** Submit `https://your.site/sitemap.xml` once in each.
- **IndexNow.** Bing, Yandex, Seznam, Naver and the other participating engines take a list of changed addresses directly. After a deploy:

  ```sh
  npx maisongr-sitemap indexnow --site https://www.example.com --key your-key
  ```

  It reads the live sitemap (or a built one, with `--sitemap dist/sitemap.xml`) and sends the addresses whose `lastmod` is on or after yesterday.
  - `--since 2026-11-01` picks the date.
  - `--all` sends everything.
  - `--dry-run` lists the addresses without sending them.
  - `--wait` waits up to 180 seconds (or the number you give) for a fresh deploy to serve the key.

  The key is yours to choose: 8 to 128 letters, digits or dashes. The site must serve it at `/<key>.txt`, and the command checks that before it sends anything.

## Limits

- **Dynamic routes** are listed only when the route is given their values through `params`. The build report names every route that needs them.
- **The URL is the language code.** An Astro locale written as `{ path: "spanish", codes: ["es"] }` is listed with `hreflang="spanish"`. Pass `locales` to the route to correct it.

## Requirements

Node 20.9 or later. No runtime dependencies.

The package is an ES module. A CommonJS project that calls `require("maisongr-sitemap/node")` itself needs Node 20.19 or 22.12 or later, which load ES modules through `require`; the `sitemap.js` that `init` writes loads it with `import()`, which works on every supported version.

## License

MIT © [Maison GR](https://www.maisongr.com)
