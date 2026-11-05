import { describe, expect, it } from "vitest";
import { dateOf, expand, unfilled } from "../src/entries.js";

const site = "https://www.example.com";

describe("expand", () => {
  it("lists static routes with their dates", async () => {
    const out = await expand([{ pattern: "/", lastmod: "2026-10-01" }, { pattern: "/about" }], { site });
    expect(out).toEqual([{ loc: `${site}/`, lastmod: "2026-10-01" }, { loc: `${site}/about`, lastmod: undefined }]);
  });

  it("gives every language its own entry, and each names all the others plus x-default", async () => {
    const out = await expand([{ pattern: "/[locale]/pricing" }], { site, locales: { list: ["en", "fr", "es"], default: "en" } });
    expect(out.map((e) => [e.loc, e.lang])).toEqual([
      [`${site}/en/pricing`, "en"],
      [`${site}/fr/pricing`, "fr"],
      [`${site}/es/pricing`, "es"],
    ]);
    expect(out[1]!.alternates).toEqual([
      { hreflang: "en", href: `${site}/en/pricing` },
      { hreflang: "fr", href: `${site}/fr/pricing` },
      { hreflang: "es", href: `${site}/es/pricing` },
      { hreflang: "x-default", href: `${site}/en/pricing` },
    ]);
  });

  it("maps the locale root to /en, not /en/", async () => {
    const out = await expand([{ pattern: "/[lang]" }], { site, locales: { list: ["en", "fr"], default: "en" } });
    expect(out.map((e) => e.loc)).toEqual([`${site}/en`, `${site}/fr`]);
  });

  it("fills dynamic routes from params, with each row's own date", async () => {
    const out = await expand([{ pattern: "/blog/[slug]", lastmod: "2026-01-01" }], {
      site,
      params: { "/blog/[slug]": () => [{ slug: "a b", lastmod: "2026-09-09" }, { slug: "c" }] },
    });
    expect(out).toEqual([
      { loc: `${site}/blog/a%20b`, lastmod: "2026-09-09" },
      { loc: `${site}/blog/c`, lastmod: "2026-01-01" },
    ]);
  });

  it("leaves out dynamic routes nothing fills, and reports them", async () => {
    const routes = [{ pattern: "/" }, { pattern: "/blog/[slug]" }, { pattern: "/[locale]/docs/[...path]" }];
    const locales = { list: ["en", "fr"], default: "en" };
    expect((await expand(routes, { site, locales })).map((e) => e.loc)).toEqual([`${site}/`]);
    expect(unfilled(routes, { locales })).toEqual(["/blog/[slug]", "/[locale]/docs/[...path]"]);
  });

  it("lets an optional catch-all be empty", async () => {
    const out = await expand([{ pattern: "/docs/[[...path]]" }], { site, params: { "/docs/[[...path]]": () => [{}, { path: ["a", "b"] }] } });
    expect(out.map((e) => e.loc)).toEqual([`${site}/docs`, `${site}/docs/a/b`]);
  });

  it("names only the languages a row exists in", async () => {
    const out = await expand([{ pattern: "/[locale]/blog/[slug]" }], {
      site,
      locales: { list: ["en", "fr"], default: "en" },
      params: { "/[locale]/blog/[slug]": () => [{ locale: "fr", slug: "seulement" }] },
    });
    expect(out).toEqual([{ loc: `${site}/fr/blog/seulement`, lastmod: undefined, lang: "fr", alternates: undefined }]);
  });

  it("drops excluded paths and duplicates", async () => {
    const out = await expand([{ pattern: "/a" }, { pattern: "/drafts/x" }, { pattern: "/a" }], { site, exclude: ["/drafts/"] });
    expect(out.map((e) => e.loc)).toEqual([`${site}/a`]);
  });

  it("takes a row's date as a Date, a timestamp or milliseconds, and drops one that is not a date", async () => {
    const out = await expand([{ pattern: "/blog/[slug]", lastmod: "2026-01-01" }], {
      site,
      params: {
        "/blog/[slug]": () => [
          { slug: "date", lastmod: new Date("2026-10-31T12:00:00Z") },
          { slug: "iso", lastmod: "2026-10-30T23:30:00-05:00" },
          { slug: "ms", lastmod: Date.UTC(2026, 9, 29) },
          { slug: "junk", lastmod: "last tuesday" },
        ],
      },
    });
    expect(out.map((e) => e.lastmod)).toEqual(["2026-10-31", "2026-10-30", "2026-10-29", "2026-01-01"]);
  });

  it("adds a trailing slash when the site uses them", async () => {
    const out = await expand([{ pattern: "/" }, { pattern: "/a" }], { site, trailingSlash: true });
    expect(out.map((e) => e.loc)).toEqual([`${site}/`, `${site}/a/`]);
  });
});

describe("dateOf", () => {
  it("keeps W3C dates as the day they name and rejects the rest", () => {
    expect(dateOf("2026-11-04")).toBe("2026-11-04");
    expect(dateOf("2026-11-04T08:00:00.000Z")).toBe("2026-11-04");
    for (const bad of ["2026-13-45", "04/11/2026", "", NaN, new Date("nope"), undefined, null]) expect(dateOf(bad as never)).toBeUndefined();
  });
});
