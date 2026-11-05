---
name: maisongr-sitemap
description: Add, replace or repair a website's sitemap with the maisongr-sitemap CLI. Use when the user asks for a sitemap.xml, hreflang alternates in a sitemap, true lastmod dates, a sitemap people can read, a replacement for an XSLT (.xsl) sitemap, or a move away from next-sitemap, @astrojs/sitemap or @nuxtjs/sitemap. Also covers robots.txt naming the sitemap, llms.txt and IndexNow.
license: MIT
---

# maisongr-sitemap

One command sets up a sitemap with two readers: search engines get the XML at `/sitemap.xml`, and a person opening the same address gets a page in the site's own design. It works with Next.js, Astro, SvelteKit, Nuxt, Express, Vite and Create React App, any static site, and any other language through `crawl`.

Add `--json` to every command. It prints one report on stdout: `{ ok, sections: [{ heading, items }], warnings, error }`. Exit codes: 0 done, 1 stopped with a reason in `error`, 2 a bug in the tool.

## Set it up

1. Run it from the project's root, the folder with `package.json`:

   ```sh
   npx maisongr-sitemap init --json
   ```

   Pass `--site https://the.site` when the report says the site address was not found. Static builds and single-page apps require it. Use the address the site really serves, with or without `www`, or every listed address redirects.

2. Do each step in the report's `Next` section. The first is usually `npm install maisongr-sitemap`; use the project's own package manager.

3. Read the `Needs values` section. Each dynamic route listed there is missing from the sitemap until the route file gives its values:

   ```ts
   params: {
     "/blog/[slug]": async () => (await getPosts()).map((p) => ({ slug: p.slug, lastmod: p.updatedAt })),
   },
   ```

4. Read the `Left out` section. Pages are left out when they are `noindex` or look private (sign-in, account, admin, checkout). Tell the user if a public page is on that list.

5. Commit the route and its manifest. Shallow CI clones rely on the dates in the manifest.

## Replace another sitemap

`init` stops without changing anything when another sitemap exists. Ask the user before taking over, then run:

```sh
npx maisongr-sitemap init --replace --json
```

It moves the old files to `.sitemap-replaced/`, including `.xsl` stylesheets and `next-sitemap.config.*`, and takes the old tool out of the scripts and the Astro or Nuxt config. It deletes nothing and leaves the old package installed, so afterwards:

- run the `npm uninstall` line from the report;
- if the report says rules written in code don't carry over, read `.sitemap-replaced/` and move them into `params`, `entries` or `exclude` before the site deploys, because a page they left out may now be listed;
- if the report says the address changes, update `robots.txt` and tell the user to submit `/sitemap.xml` in Search Console;
- delete `.sitemap-replaced/` once the user has checked the result.

## Sites with no framework

| Site | Command |
|---|---|
| A built static site | `npx maisongr-sitemap static dist --site https://the.site --json` |
| PHP, Python, Ruby, a CMS | `npx maisongr-sitemap crawl http://localhost:8000 --out public --site https://the.site --json` |

Express and other Node servers get `sitemap.js` from `init`. List the addresses in its `entries()`, then mount it before any catch-all route. The report gives the exact line.

## Check the result

Start the site, then check both readers:

```sh
curl -sI http://localhost:3000/sitemap.xml                               # application/xml
curl -sI -H "Sec-Fetch-Dest: document" http://localhost:3000/sitemap.xml # text/html
```

On a static host both answers are XML until the host has its rewrite rule. The README's "One address on a static host" gives the rule for Cloudflare and Vercel. The page is at `/sitemap/` either way.

If middleware rewrites or redirects every path, let `/sitemap.xml` and `/_sitemap/` through untouched.

## After it works

- `npx maisongr-sitemap connect --site https://the.site --json` says what robots.txt needs. Add `--yes` to write it.
- `npx maisongr-sitemap llms --site https://the.site --from http://localhost:3000 --json` writes `llms.txt`.
- `npx maisongr-sitemap indexnow` sends addresses to outside search engines. Run it only when the user asks.

Full reference: https://github.com/maison-gr/sitemap#readme
