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

  it("treats a segment that mixes text and parameters as dynamic", async () => {
    const routes = [{ pattern: "/notes/v[version]" }, { pattern: "/[lang]-docs" }];
    expect(await expand(routes, { site })).toEqual([]);
    expect(unfilled(routes, {})).toEqual(["/notes/v[version]", "/[lang]-docs"]); // named in the build report, not dropped without a word
    const out = await expand(routes, { site, params: { "/notes/v[version]": () => [{ version: "2" }], "/[lang]-docs": () => [{ lang: "en" }] } });
    expect(out.map((e) => e.loc)).toEqual([`${site}/notes/v2`, `${site}/en-docs`]);
  });

  it("takes a catch-all's path as a string too, keeping its slashes", async () => {
    const out = await expand([{ pattern: "/adhd/[...slug]" }, { pattern: "/notes/[slug]" }], {
      site,
      params: { "/adhd/[...slug]": () => [{ slug: "fundamentals/what-is-adhd" }, { slug: ["a b", "c"] }], "/notes/[slug]": () => [{ slug: "a/b" }] },
    });
    expect(out.map((e) => e.loc)).toEqual([`${site}/adhd/fundamentals/what-is-adhd`, `${site}/adhd/a%20b/c`, `${site}/notes/a%2Fb`]);
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

describe("a default language without a prefix", () => {
  it("serves the default language at the bare path, the others under their prefix", async () => {
    const out = await expand([{ pattern: "/" }, { pattern: "/about" }], { site, locales: { list: ["en", "fr"], default: "en", prefix: true, prefixDefault: false } });
    expect(out.map((e) => [e.loc, e.lang])).toEqual([
      [`${site}/`, "en"],
      [`${site}/fr`, "fr"],
      [`${site}/about`, "en"],
      [`${site}/fr/about`, "fr"],
    ]);
    expect(out[3]!.alternates).toEqual([
      { hreflang: "en", href: `${site}/about` },
      { hreflang: "fr", href: `${site}/fr/about` },
      { hreflang: "x-default", href: `${site}/about` },
    ]);
  });
});

describe("languages kept in folders", () => {
  const locales = { list: ["en", "fr", "es"], default: "en", folders: true, prefixDefault: false };

  it("links the versions of each page, and leaves a page in one language alone", async () => {
    const routes = [{ pattern: "/" }, { pattern: "/about" }, { pattern: "/fr" }, { pattern: "/fr/about" }, { pattern: "/es/about" }, { pattern: "/legal" }];
    const out = await expand(routes, { site, locales });
    const about = out.find((e) => e.loc === `${site}/fr/about`)!;
    expect(about.lang).toBe("fr");
    expect(about.alternates).toEqual([
      { hreflang: "en", href: `${site}/about` },
      { hreflang: "fr", href: `${site}/fr/about` },
      { hreflang: "es", href: `${site}/es/about` },
      { hreflang: "x-default", href: `${site}/about` },
    ]);
    expect(out.find((e) => e.loc === `${site}/fr`)!.alternates?.map((a) => a.href)).toEqual([`${site}/`, `${site}/fr`, `${site}/`]);
    expect(out.find((e) => e.loc === `${site}/legal`)).toEqual({ loc: `${site}/legal`, lastmod: undefined, lang: "en" });
  });

  it("with a prefix on every language, leaves pages outside the language folders unlabelled", async () => {
    const out = await expand([{ pattern: "/en/about" }, { pattern: "/fr/about" }, { pattern: "/press-kit" }], { site, locales: { ...locales, prefixDefault: true } });
    expect(out.map((e) => [e.loc, e.lang, e.alternates?.length])).toEqual([
      [`${site}/en/about`, "en", 3],
      [`${site}/fr/about`, "fr", 3],
      [`${site}/press-kit`, undefined, undefined],
    ]);
  });
});

describe("basePath", () => {
  it("mounts every address under it, the home page without a slash that would redirect", async () => {
    const routes = [{ pattern: "/" }, { pattern: "/a" }, { pattern: "/drafts" }];
    const out = await expand(routes, { site, basePath: "/docs", exclude: ["/drafts"] });
    expect(out.map((e) => e.loc)).toEqual([`${site}/docs`, `${site}/docs/a`]);
    const slashed = await expand(routes.slice(0, 2), { site, basePath: "/docs", trailingSlash: true });
    expect(slashed.map((e) => e.loc)).toEqual([`${site}/docs/`, `${site}/docs/a/`]);
  });

  it("puts the language after it", async () => {
    const out = await expand([{ pattern: "/[locale]" }], { site, basePath: "/docs", locales: { list: ["en", "fr"], default: "en" } });
    expect(out.map((e) => e.loc)).toEqual([`${site}/docs/en`, `${site}/docs/fr`]);
    expect(out[0]!.alternates?.at(-1)).toEqual({ hreflang: "x-default", href: `${site}/docs/en` });
  });
});

describe("input built to be slow", () => {
  it("trims trailing slashes in linear time", async () => {
    const { trimSlashes } = await import("../src/entries.js");
    expect(trimSlashes("https://a.dev///")).toBe("https://a.dev");
    expect(trimSlashes("///")).toBe("");
    const start = performance.now();
    trimSlashes(`${"/".repeat(100_000)}x`);
    await expand([{ pattern: "/" }], { site: `https://a.dev${"/".repeat(100_000)}x` });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("reads a language type built to backtrack in linear time", async () => {
    const { findLocales } = await import("../src/build/project.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "mgr-redos-"));
    writeFileSync(join(dir, "slow.ts"), `type Lang = ${' "-"'.repeat(30)} x`);
    writeFileSync(join(dir, "i18n.ts"), 'export type Lang = | "fr" | "en";');
    const start = performance.now();
    expect(findLocales([join(dir, "slow.ts"), join(dir, "i18n.ts")])).toEqual({ list: ["fr", "en"], default: "fr" });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("reads a route pattern full of brackets in linear time", async () => {
    const start = performance.now();
    await expand([{ pattern: `/${"[".repeat(100_000)}` }, { pattern: `/[${"[\\".repeat(50_000)}` }], { site });
    expect(unfilled([{ pattern: `/${"[".repeat(100_000)}` }], {})).toEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("dateOf", () => {
  it("keeps W3C dates as the day they name and rejects the rest", () => {
    expect(dateOf("2026-11-04")).toBe("2026-11-04");
    expect(dateOf("2026-11-04T08:00:00.000Z")).toBe("2026-11-04");
    for (const bad of ["2026-13-45", "04/11/2026", "", NaN, new Date("nope"), undefined, null]) expect(dateOf(bad as never)).toBeUndefined();
  });
});
