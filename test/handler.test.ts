import { describe, expect, it } from "vitest";
import { createSitemap } from "../src/handler.js";
import type { Manifest } from "../src/types.js";

const manifest: Manifest = {
  version: 1,
  framework: "next",
  site: "https://www.example.com",
  locales: { list: ["en", "fr", "ar", "es", "pt", "de", "it", "nl", "ja", "zh-CN"], default: "en" },
  routes: [
    { pattern: "/[locale]", lastmod: "2026-11-03" },
    { pattern: "/[locale]/pricing", lastmod: "2026-06-11" },
    { pattern: "/[locale]/blog/[slug]" },
  ],
  theme: {
    name: "Example & Co",
    light: { background: "#fff", foreground: "#111", muted: "#555", border: "#ddd", accent: "#06c", surface: "#fff" },
    fonts: [],
  },
};

const get = (handler: (r: Request) => Promise<Response>, path = "/sitemap.xml", browser = false) =>
  handler(new Request(`https://www.example.com${path}`, { headers: browser ? { "Sec-Fetch-Dest": "document" } : {} }));

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

describe("createSitemap", () => {
  const handler = createSitemap({ manifest, params: { "/[locale]/blog/[slug]": () => [{ slug: "hello" }] } });

  it("gives crawlers the XML, never the page", async () => {
    const res = await get(handler);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Dest");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    const xml = await res.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(locs(xml)).toHaveLength(30);
  });

  it("gives a browser the page, noindex, listing exactly the XML's addresses once each", async () => {
    const xml = await (await get(handler)).text();
    const res = await get(handler, "/sitemap.xml", true);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Dest");
    const html = await res.text();
    for (const loc of locs(xml)) {
      const path = new URL(loc).pathname;
      expect(html.split(`href="${path}"`).length - 1, path).toBe(1);
    }
  });

  it("labels, counts and filters every language, not just the first few", async () => {
    const html = await (await get(handler, "/sitemap.xml", true)).text();
    for (const l of manifest.locales!.list) {
      expect(html).toContain(`<span><b>3</b> ${l.toUpperCase()}</span>`);
      expect(html).toContain(`data-f="${l}"`);
    }
    expect(html).toMatch(/href="\/zh-CN\/pricing">[^<]*<\/a><span class="lang">ZH-CN</);
  });

  it("carries no inline script or style, so default-src 'self' allows it", async () => {
    const html = await (await get(handler, "/sitemap.xml", true)).text();
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style\b|\sstyle=/);
    expect(html).toContain('<script src="?asset=page.js" defer></script>');
    const css = await get(handler, "/sitemap.xml?asset=page.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const js = await get(handler, "/sitemap.xml?asset=page.js");
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("groups single pages together and gives real folders their own section, titled by path", async () => {
    const { urlsetPage } = await import("../src/page.js");
    const e = (p: string) => ({ loc: `https://x.dev${p}` });
    const html = urlsetPage([e("/"), e("/about"), e("/security"), e("/security/ack"), e("/blog"), e("/blog/a"), e("/blog/b")], manifest.theme);
    const sections = [...html.matchAll(/<h2 id="[^"]+">([^<]+)<\/h2><span class="count">(\d+)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(sections).toEqual(["Pages 4", "/blog/ 3"]);
  });

  it("says so when there are no pages yet, instead of showing an empty list and a filter", async () => {
    const { urlsetPage } = await import("../src/page.js");
    const html = urlsetPage([], manifest.theme);
    expect(html).toContain('<p class="empty">No pages are listed yet.');
    expect(html).not.toContain('id="q"');
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });

  it("escapes what it prints", async () => {
    const html = await (await get(handler, "/sitemap.xml", true)).text();
    expect(html).toContain("Every page on Example &amp; Co");
  });

  it("reads params once per revalidate window, not on every request", async () => {
    let calls = 0;
    const counted = createSitemap({ manifest, params: { "/[locale]/blog/[slug]": () => (calls++, [{ slug: "x" }]) } });
    await get(counted);
    await get(counted, "/sitemap.xml", true);
    await get(counted);
    expect(calls).toBe(1);
  });

  it("reads them again after invalidate(), so a new post is listed at once", async () => {
    let slugs = ["first"];
    const live = createSitemap({ manifest, params: { "/[locale]/blog/[slug]": () => slugs.map((slug) => ({ slug })) } });
    expect(locs(await (await get(live)).text())).not.toContain("https://www.example.com/en/blog/second");
    slugs = ["first", "second"];
    live.invalidate();
    expect(locs(await (await get(live)).text())).toContain("https://www.example.com/en/blog/second");
  });

  it("tries again after a failed load instead of keeping the failure", async () => {
    let calls = 0;
    const flaky = createSitemap({
      manifest,
      params: {
        "/[locale]/blog/[slug]": () => {
          calls++;
          if (calls === 1) throw new Error("db down");
          return [{ slug: "x" }];
        },
      },
    });
    await expect(get(flaky)).rejects.toThrow("db down");
    expect((await get(flaky)).status).toBe(200);
  });

  it("takes extra entries dated with a Date, as a database returns them", async () => {
    const dated = createSitemap({
      manifest: { ...manifest, routes: [], locales: undefined },
      entries: () => [{ loc: "https://www.example.com/press", lastmod: new Date("2026-10-31T09:00:00Z") }],
    });
    expect(await (await get(dated)).text()).toContain("<lastmod>2026-10-31</lastmod>");
  });

  it("resolves language versions given as paths, as it does the address itself", async () => {
    const pairs = createSitemap({
      manifest: { ...manifest, routes: [], locales: undefined },
      entries: () => [{ loc: "/about", alternates: [{ hreflang: "fr-CA", href: "/fr/a-propos" }, { hreflang: "en-CA", href: "/about" }] }],
    });
    const xml = await (await get(pairs)).text();
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="fr-CA" href="https://www.example.com/fr/a-propos"/>');
    expect(xml).not.toMatch(/hreflang="[^"]+" href="\//);
  });

  it("resolves relative entries against the site and applies exclude to them too", async () => {
    const extra = createSitemap({
      manifest: { ...manifest, routes: [], locales: undefined },
      entries: () => [{ loc: "/press" }, { loc: "/drafts/next" }, { loc: "https://www.example.com/team" }],
      exclude: ["/drafts/"],
    });
    expect(locs(await (await get(extra)).text())).toEqual(["https://www.example.com/press", "https://www.example.com/team"]);
  });

  it("follows the manifest's basePath and trailingSlash, in the XML and on the page", async () => {
    const mounted = createSitemap({
      manifest: { ...manifest, basePath: "/docs", trailingSlash: true, routes: [{ pattern: "/" }, { pattern: "/guide" }], locales: undefined },
      entries: () => [{ loc: "/docs/changelog/" }, { loc: "/docs/drafts/x/" }],
      exclude: ["/drafts/"],
    });
    expect(locs(await (await get(mounted)).text())).toEqual([
      "https://www.example.com/docs/",
      "https://www.example.com/docs/guide/",
      "https://www.example.com/docs/changelog/",
    ]);
    expect(await (await get(mounted, "/sitemap.xml", true)).text()).toContain('<a class="brand" href="/docs">');
  });

  it("lists an address given twice once, and matches basePath by whole segment", async () => {
    const extra = createSitemap({
      manifest: { ...manifest, routes: [], locales: undefined },
      basePath: "/docs/",
      entries: () => [{ loc: "/docs/a" }, { loc: "/docs/a" }, { loc: "/docsearch" }, { loc: "/docs/search" }],
      exclude: ["/search"],
    });
    expect(locs(await (await get(extra)).text())).toEqual(["https://www.example.com/docs/a", "https://www.example.com/docsearch"]);
  });

  it("links entries kept in language folders with each other and with the routes", async () => {
    const folders = createSitemap({
      manifest: { ...manifest, routes: [{ pattern: "/about" }], locales: { list: ["en", "fr"], default: "en", folders: true, prefixDefault: false } },
      entries: () => [{ loc: "/fr/about" }, { loc: "https://elsewhere.dev/fr/about" }],
    });
    const xml = await (await get(folders)).text();
    expect(xml).toContain(
      '<loc>https://www.example.com/fr/about</loc>\n    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/about"/>\n    <xhtml:link rel="alternate" hreflang="fr" href="https://www.example.com/fr/about"/>',
    );
    expect(xml).toContain("<loc>https://elsewhere.dev/fr/about</loc>\n  </url>");
  });

  it("serves the last good list, marked stale, when a later load fails", async () => {
    let calls = 0;
    const flaky = createSitemap({
      manifest: { ...manifest, routes: [], locales: undefined },
      revalidate: 0,
      entries: () => {
        calls++;
        if (calls > 1) throw new Error("db down");
        return [{ loc: "/jobs/1" }];
      },
    });
    const first = await get(flaky);
    expect(first.headers.get("x-sitemap-stale")).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const second = await get(flaky);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-sitemap-stale")).toBe("true");
    expect(second.headers.get("cache-control")).toBe("public, max-age=60");
    expect(locs(await second.text())).toEqual(["https://www.example.com/jobs/1"]);
  });

  it("lets transform add images to any address, or leave one out", async () => {
    const shaped = createSitemap({
      manifest: { ...manifest, routes: [{ pattern: "/" }, { pattern: "/work" }, { pattern: "/drafts" }], locales: undefined },
      transform: (e) => (e.loc.endsWith("/drafts") ? null : e.loc.endsWith("/work") ? { ...e, images: ["/studio.jpeg"] } : e),
    });
    const xml = await (await get(shaped)).text();
    expect(locs(xml)).toEqual(["https://www.example.com/", "https://www.example.com/work"]);
    expect(xml).toContain("<image:loc>https://www.example.com/studio.jpeg</image:loc>");
  });

  it("takes a site's readonly lists as they are (this test only compiles if it does)", async () => {
    const images: readonly string[] = ["/cover.jpg"];
    const slugs: readonly string[] = ["a", "b"];
    const typed = createSitemap({
      manifest: { ...manifest, routes: [{ pattern: "/docs/[...path]" }], locales: undefined },
      params: { "/docs/[...path]": () => [{ path: slugs, images }] },
      transform: (e) => ({ ...e, images }),
    });
    expect(await (await get(typed)).text()).toContain("<loc>https://www.example.com/docs/a/b</loc>");
  });

  it("becomes an index of parts past 50,000 addresses", async () => {
    const many = Array.from({ length: 50_001 }, (_, i) => ({ loc: `https://www.example.com/p/${i}` }));
    const big = createSitemap({ manifest: { ...manifest, routes: [], locales: undefined }, entries: () => many });
    const index = await (await get(big)).text();
    expect(index).toContain("<sitemapindex");
    expect(locs(index)).toEqual(["https://www.example.com/sitemap.xml?part=1", "https://www.example.com/sitemap.xml?part=2"]);
    expect(locs(await (await get(big, "/sitemap.xml?part=2")).text())).toEqual(["https://www.example.com/p/50000"]);
    expect((await get(big, "/sitemap.xml?part=3")).status).toBe(404);
  });

  it("works with no manifest at all, for a server that lists its own addresses", async () => {
    const bare = createSitemap({ site: "https://www.atelier.dev", entries: () => [{ loc: "/" }, { loc: "/work" }] });
    expect(locs(await (await bare(new Request("http://internal:8080/sitemap.xml"))).text())).toEqual(["https://www.atelier.dev/", "https://www.atelier.dev/work"]);
    const html = await (await bare(new Request("http://internal:8080/sitemap.xml", { headers: { "Sec-Fetch-Dest": "document" } }))).text();
    expect(html).toContain("Every page on atelier.dev");
    const css = await (await bare(new Request("http://internal:8080/sitemap.xml?asset=page.css"))).text();
    expect(css).toContain("--bg:#fbfaf7");
  });

  it("serves named sitemaps from one route, with /sitemap.xml as their index", async () => {
    const several = createSitemap({
      manifest: { ...manifest, routes: [{ pattern: "/", lastmod: "2026-10-01" }], locales: undefined },
      sitemaps: {
        companies: () => [{ loc: "/c/acme", lastmod: "2026-11-02" }, { loc: "/" }],
        jobs: () => [],
      },
    });
    const index = await (await get(several)).text();
    expect(index).toContain("<sitemapindex");
    // "jobs" is empty, so the index leaves it out: Search Console would report it as an error.
    expect(locs(index)).toEqual(["https://www.example.com/sitemap.xml?sitemap=pages", "https://www.example.com/sitemap.xml?sitemap=companies"]);
    expect(locs(await (await get(several, "/sitemap.xml?sitemap=jobs")).text())).toEqual([]);
    expect(index).toContain("<lastmod>2026-11-02</lastmod>");
    // "/" is listed once, in the first sitemap that has it.
    expect(locs(await (await get(several, "/sitemap.xml?sitemap=companies")).text())).toEqual(["https://www.example.com/c/acme"]);
    expect(locs(await (await get(several, "/sitemap.xml?sitemap=pages")).text())).toEqual(["https://www.example.com/"]);
    expect((await get(several, "/sitemap.xml?sitemap=nope")).status).toBe(404);
    const html = await (await get(several, "/sitemap.xml", true)).text();
    expect(html).toContain('<a class="url" href="/sitemap.xml?sitemap=companies">companies</a>');
  });

  it("splits a named sitemap past 50,000 addresses into parts the index lists", async () => {
    const many = Array.from({ length: 50_001 }, (_, i) => ({ loc: `/p/${i}` }));
    const big = createSitemap({ manifest: { ...manifest, routes: [], locales: undefined }, sitemaps: { products: () => many } });
    expect(locs(await (await get(big)).text())).toEqual([
      // "pages" has nothing (no routes, no entries), so it isn't listed. & is written &amp; in XML.
      "https://www.example.com/sitemap.xml?sitemap=products&amp;part=1",
      "https://www.example.com/sitemap.xml?sitemap=products&amp;part=2",
    ]);
    expect(locs(await (await get(big, "/sitemap.xml?sitemap=products&part=2")).text())).toEqual(["https://www.example.com/p/50000"]);
  });

  it("refuses a sitemap name that would clash or break the address", () => {
    expect(() => createSitemap({ sitemaps: { pages: () => [] } })).toThrow(/not "pages"/);
    expect(() => createSitemap({ sitemaps: { "a b": () => [] } })).toThrow(/can't name a sitemap/);
  });

  it("names a broken manifest instead of serving an empty sitemap", () => {
    expect(() => createSitemap({ manifest: {} })).toThrow(/maisongr-sitemap build/);
  });
});

describe("the page's language", () => {
  const french = { ...manifest, locales: { list: ["fr", "en"], default: "fr" } };

  it("speaks the site's own default language", async () => {
    const html = await (await get(createSitemap({ manifest: french }), "/sitemap.xml", true)).text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<title>Plan du site · Example &amp; Co</title>");
    expect(html).toContain("<h1>Toutes les pages d’Example &amp; Co");
    expect(html).toContain('placeholder="Filtrer par adresse"');
    expect(html).toContain('data-t="{shown} sur {total} pages"');
    expect(html).toContain("Les moteurs de recherche lisent la version XML de cette liste.");
    expect(html).not.toMatch(/Every page|Filter by path|Search engines read/);
  });

  it("follows lang over the default, and falls back to English for a language it lacks", async () => {
    expect(await (await get(createSitemap({ manifest: french, lang: "en" }), "/sitemap.xml", true)).text()).toContain("<h1>Every page on");
    expect(await (await get(createSitemap({ manifest, lang: "fr-CA" }), "/sitemap.xml", true)).text()).toContain("<h1>Toutes les pages d’Example");
    expect(await (await get(createSitemap({ manifest, lang: "ja" }), "/sitemap.xml", true)).text()).toContain('<html lang="en">');
  });
});
