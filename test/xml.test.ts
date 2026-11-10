import { describe, expect, it } from "vitest";
import { expand } from "../src/entries.js";
import { chunk, MAX_BYTES, MAX_URLS, urlsetXml } from "../src/xml.js";

const page = "https://www.example.com/journal/tides";

describe("image, video and news sitemaps", () => {
  it("declares only the namespaces the file uses", () => {
    const plain = urlsetXml([{ loc: page }]);
    expect(plain).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const images = urlsetXml([{ loc: page, images: ["/cover.jpg"] }]);
    expect(images).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(images).not.toContain("xmlns:video");
  });

  it("lists a page's images once each, resolved against the page, up to Google's 1,000", () => {
    const many = Array.from({ length: 1_005 }, (_, i) => `/img/${i}.jpg`);
    const xml = urlsetXml([{ loc: page, images: ["cover.jpg", "cover.jpg", "https://cdn.example.com/a&b.png", ...many] }]);
    expect(xml).toContain("<image:image><image:loc>https://www.example.com/journal/cover.jpg</image:loc></image:image>");
    expect(xml).toContain("<image:loc>https://cdn.example.com/a&amp;b.png</image:loc>");
    expect(xml.match(/<image:image>/g)).toHaveLength(1_000);
  });

  it("writes a video with Google's required fields, and leaves out one that lacks them", () => {
    const xml = urlsetXml([
      {
        loc: page,
        videos: [
          { thumbnail: "/thumbs/tides.jpg", title: "Tides & time", description: "x".repeat(3000), content: "/v/tides.mp4", duration: 94.6, familyFriendly: true, publicationDate: "not a date" },
          { thumbnail: "/t.jpg", title: "No file", description: "Neither content nor player" },
        ],
      },
    ]);
    expect(xml.match(/<video:video>/g)).toHaveLength(1);
    expect(xml).toContain("<video:thumbnail_loc>https://www.example.com/thumbs/tides.jpg</video:thumbnail_loc>");
    expect(xml).toContain("<video:title>Tides &amp; time</video:title>");
    expect(xml).toContain(`<video:description>${"x".repeat(2048)}</video:description>`);
    expect(xml).toContain("<video:content_loc>https://www.example.com/v/tides.mp4</video:content_loc><video:duration>95</video:duration>");
    expect(xml).toContain("<video:family_friendly>yes</video:family_friendly>");
    expect(xml).not.toContain("publication_date");
  });

  it("writes a news article, and leaves one out without a valid date", () => {
    const news = { publication: { name: "Harbour Daily", language: "en" }, title: "Spring tides", publicationDate: "2026-11-04T08:00:00Z" };
    const xml = urlsetXml([{ loc: page, news }, { loc: `${page}-2`, news: { ...news, publicationDate: "yesterday" } }]);
    expect(xml).toContain(
      "<news:news><news:publication><news:name>Harbour Daily</news:name><news:language>en</news:language></news:publication><news:publication_date>2026-11-04T08:00:00Z</news:publication_date><news:title>Spring tides</news:title></news:news>",
    );
    expect(xml.match(/<news:news>/g)).toHaveLength(1);
  });

  it("takes images from a dynamic route's rows, in every language", async () => {
    const out = await expand([{ pattern: "/[locale]/blog/[slug]" }], {
      site: "https://www.example.com",
      locales: { list: ["en", "fr"], default: "en" },
      params: { "/[locale]/blog/[slug]": () => [{ slug: "tides", images: ["/covers/tides.jpg"] }] },
    });
    expect(out.map((e) => e.images)).toEqual([["/covers/tides.jpg"], ["/covers/tides.jpg"]]);
  });
});

describe("the protocol's limits per file", () => {
  // A page in ten languages, each version naming the ten: about 1 KB of XML per address.
  const langs = ["en", "fr", "ar", "es", "pt", "de", "it", "nl", "ja", "zh-CN"];
  const entries = Array.from({ length: 400 }, (_, i) => ({
    loc: `https://www.example.com/en/p/${i}`,
    lastmod: "2026-11-09",
    alternates: langs.map((l) => ({ hreflang: l, href: `https://www.example.com/${l}/p/${i}` })),
  }));
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it("are 50,000 addresses and 50 MB, as the protocol and Google set them", () => {
    expect(MAX_URLS).toBe(50_000);
    expect(MAX_BYTES).toBe(52_428_800);
  });

  it("splits by size as well as by count, every file within the limit, nothing lost or reordered", () => {
    const limit = 100_000;
    const parts = chunk(entries, MAX_URLS, limit);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(bytes(urlsetXml(part, "/sitemap.xml?asset=xml.css"))).toBeLessThanOrEqual(limit);
    expect(parts.flat()).toEqual(entries);
  });

  it("still splits by count when the files are small", () => {
    expect(chunk(entries, 150).map((p) => p.length)).toEqual([150, 150, 100]);
    expect(chunk([])).toEqual([[]]);
  });
});
