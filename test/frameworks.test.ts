import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroRoutes } from "../src/build/astro-routes.js";
import { detect } from "../src/build/detect.js";
import { buildFramework } from "../src/build/framework-build.js";
import { nuxtRoutes } from "../src/build/nuxt-routes.js";
import { svelteRoutes } from "../src/build/svelte-routes.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-fw-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const patterns = (found: { routes: { pattern: string }[] }) => found.routes.map((r) => r.pattern).sort();

describe("Astro routes", () => {
  it("lists pages, leaves out endpoints, underscored files and error pages", () => {
    const root = project({
      "src/pages/index.astro": "",
      "src/pages/about.md": "",
      "src/pages/blog/index.mdx": "",
      "src/pages/blog/[slug].astro": "",
      "src/pages/docs/[...path].astro": "",
      "src/pages/[lang]-[version]/info.astro": "",
      "src/pages/rss.xml.ts": "export const GET = () => new Response('')",
      "src/pages/_drafts/next.astro": "",
      "src/pages/_card.astro": "",
      "src/pages/404.astro": "",
      "src/pages/login.astro": "",
      "src/pages/thanks.astro": '<Layout title="Thanks" noindex />',
    });
    const found = astroRoutes(root, "src/pages");
    expect(patterns(found)).toEqual(["/", "/[lang]-[version]/info", "/about", "/blog", "/blog/[slug]", "/docs/[[...path]]"]);
    expect(found.skipped).toEqual([
      { pattern: "/login", reason: "private page (login)" },
      { pattern: "/thanks", reason: "noindex" },
    ]);
    expect(found.routes.find((r) => r.pattern === "/blog")!.files).toEqual(["src/pages/blog/index.mdx"]);
  });
});

describe("SvelteKit routes", () => {
  it("follows groups, matchers, optional and rest parameters, and encoded characters", () => {
    const root = project({
      "src/routes/+layout.svelte": "",
      "src/routes/+page.svelte": "",
      "src/routes/(marketing)/pricing/+page.svelte": "",
      "src/routes/(marketing)/pricing/+page.server.ts": "export const load = () => ({})",
      "src/routes/blog/[slug=slug]/+page.svelte": "",
      "src/routes/[[lang]]/about/+page@.svelte": "",
      "src/routes/docs/[...path]/+page.svelte": "",
      "src/routes/[x+2e]well-known/security/+page.svelte": "",
      "src/routes/api/health/+server.ts": "",
      "src/routes/pricing-card.svelte": "",
    });
    const found = svelteRoutes(root, "src/routes");
    expect(patterns(found)).toEqual(["/", "/.well-known/security", "/[[lang]]/about", "/blog/[slug]", "/docs/[[...path]]", "/pricing"]);
    expect(found.routes.find((r) => r.pattern === "/pricing")!.files).toEqual([
      "src/routes/(marketing)/pricing/+page.server.ts",
      "src/routes/(marketing)/pricing/+page.svelte",
    ]);
  });

  it("leaves out pages under a noindex layout, and private ones", () => {
    const root = project({
      "src/routes/+page.svelte": "",
      "src/routes/(app)/+layout.svelte": '<svelte:head><meta name="robots" content="noindex" /></svelte:head>',
      "src/routes/(app)/inbox/+page.svelte": "",
      "src/routes/account/+page.svelte": "",
    });
    const found = svelteRoutes(root, "src/routes");
    expect(patterns(found)).toEqual(["/"]);
    expect(found.skipped).toEqual([
      { pattern: "/inbox", reason: "noindex" },
      { pattern: "/account", reason: "private page (account)" },
    ]);
  });
});

describe("Nuxt routes", () => {
  it("follows Nuxt's page conventions and leaves out what it ignores", () => {
    const root = project({
      "app/pages/index.vue": "",
      "app/pages/blog.vue": "<NuxtPage />",
      "app/pages/blog/index.vue": "",
      "app/pages/blog/[slug].vue": "",
      "app/pages/[[lang]]/about.vue": "",
      "app/pages/docs/[...path].vue": "",
      "app/pages/users-[group]/[id].vue": "",
      "app/pages/(shop)/cart.client.vue": "",
      "app/pages/-draft.vue": "",
      "app/pages/blog/[slug].spec.ts": "",
      "app/pages/types.d.ts": "",
      "app/pages/settings.vue": "",
      "app/pages/preview.vue": "<script setup>useSeoMeta({ robots: 'noindex, nofollow' })</script>",
    });
    const found = nuxtRoutes(root, "app/pages");
    expect(patterns(found)).toEqual(["/", "/[[lang]]/about", "/blog", "/blog/[slug]", "/cart", "/docs/[[...path]]", "/users-[group]/[id]"]);
    expect(found.routes.find((r) => r.pattern === "/blog")!.files).toEqual(["app/pages/blog/index.vue", "app/pages/blog.vue"]);
    expect(found.skipped).toEqual([
      { pattern: "/preview", reason: "noindex" },
      { pattern: "/settings", reason: "private page (settings)" },
    ]);
  });

  it("follows a hiding helper imported through ~/ into app/", () => {
    const root = project({
      "app/utils/seo.ts": "export const noindexMeta = () => useSeoMeta({ robots: 'noindex' });",
      "app/pages/index.vue": "",
      "app/pages/beta.vue": '<script setup>import { noindexMeta } from "~/utils/seo"; noindexMeta();</script>',
    });
    expect(patterns(nuxtRoutes(root, "app/pages"))).toEqual(["/"]);
  });
});

const manifestOf = async (root: string) => {
  const report = await buildFramework(root, detect(root) as never, { offline: true });
  return { report, manifest: JSON.parse(readFileSync(report.manifestPath, "utf8")) };
};

describe("building the manifest", () => {
  it("reads an Astro site: config, layout title, global CSS and its fonts", async () => {
    const root = project({
      "package.json": '{"name":"atelier","dependencies":{"astro":"7","@astrojs/node":"10"}}',
      "astro.config.mjs": `export default defineConfig({ site: "https://www.atelier.dev", base: "/studio", trailingSlash: "always", adapter: node({ mode: "standalone" }) });`,
      "src/layouts/Base.astro": "<html><head><title>Atelier | Studio</title></head><style is:global>:root { --background: #f7f5f0; --foreground: #121212; }</style></html>",
      "src/styles/global.css": `@font-face { font-family: "Atelier Sans"; src: url("./fonts/sans.woff2"); } body { font-family: "Atelier Sans", sans-serif; }`,
      "src/styles/fonts/sans.woff2": "x",
      "src/pages/index.astro": "",
      "src/pages/work/[slug].astro": "",
      "public/favicon.svg": "<svg/>",
    });
    const { report, manifest } = await manifestOf(root);
    expect(report.manifestPath).toBe(join(root, "src", "sitemap.manifest.json"));
    expect(manifest).toMatchObject({
      framework: "astro",
      site: "https://www.atelier.dev",
      basePath: "/studio",
      trailingSlash: true,
      routes: [{ pattern: "/" }, { pattern: "/work/[slug]" }],
      theme: { name: "Atelier", icon: "/favicon.svg", light: { background: "#f7f5f0", foreground: "#121212" }, fonts: [{ family: "Atelier Sans", role: "body" }] },
    });
    expect(report.needParams).toEqual(["/work/[slug]"]);
    expect(readFileSync(join(root, "public", manifest.theme.fonts[0].files[0].url), "utf8")).toBe("x");
  });

  it("links an Astro site's language folders, from its i18n config", async () => {
    const root = project({
      "package.json": '{"dependencies":{"astro":"7"}}',
      "astro.config.mjs": `export default defineConfig({ adapter: node(), i18n: { locales: ["en", "fr", { path: "es", codes: ["es", "es-MX"] }], defaultLocale: "en" } });`,
      "src/pages/index.astro": "",
      "src/pages/about.astro": "",
      "src/pages/fr/index.astro": "",
      "src/pages/fr/about.astro": "",
      "src/pages/es/about.astro": "",
    });
    const { manifest } = await manifestOf(root);
    expect(manifest.locales).toEqual({ list: ["en", "fr", "es"], default: "en", folders: true, prefixDefault: false });
    const { expand } = await import("../src/entries.js");
    const out = await expand(manifest.routes, { site: "https://a.dev", locales: manifest.locales });
    expect(out.find((e) => e.loc === "https://a.dev/es/about")!.alternates!.map((a) => a.hreflang)).toEqual(["en", "fr", "es", "x-default"]);
  });

  it("reads @nuxtjs/i18n: codes from locale objects, and its strategy", async () => {
    const config = (strategy: string) =>
      project({
        "package.json": '{"dependencies":{"nuxt":"4","@nuxtjs/i18n":"10"},"scripts":{"build":"nuxt build"}}',
        "nuxt.config.ts": `export default defineNuxtConfig({ modules: ["@nuxtjs/i18n"], i18n: { locales: [{ code: "en", name: "English" }, { code: "fr", name: "Français" }], defaultLocale: "fr"${strategy} } })`,
        "app/pages/index.vue": "",
      });
    expect((await manifestOf(config(""))).manifest.locales).toEqual({ list: ["en", "fr"], default: "fr", prefix: true, prefixDefault: false });
    expect((await manifestOf(config(', strategy: "prefix"'))).manifest.locales).toMatchObject({ prefix: true, prefixDefault: true });
    expect((await manifestOf(config(', strategy: "no_prefix"'))).manifest.locales).toBeUndefined();
  });

  it("reads a SvelteKit app: static/, paths.base, the root layout's tokens and trailingSlash", async () => {
    const root = project({
      "package.json": '{"name":"field-notes","devDependencies":{"@sveltejs/kit":"3","@sveltejs/adapter-node":"6"}}',
      "vite.config.ts": `export default defineConfig({ plugins: [sveltekit({ adapter: adapter(), paths: { base: "/notes" } })] });`,
      "src/app.html": "<html><head>%sveltekit.head%</head></html>",
      "src/routes/+layout.svelte": "<style>:global(:root) { --bg: #fffdf8; --fg: #1d1b16; --accent: #c2410c; }</style>",
      "src/routes/+layout.ts": "export const trailingSlash = 'always';",
      "src/routes/+page.svelte": "",
      "src/routes/[lang]/guide/+page.svelte": "",
      "src/lib/i18n.ts": 'export const LOCALES = ["en", "fr"];',
      "static/favicon.png": "x",
    });
    const { report, manifest } = await manifestOf(root);
    expect(report.manifestPath).toBe(join(root, "src", "routes", "sitemap.xml", "manifest.json"));
    expect(manifest).toMatchObject({
      framework: "sveltekit",
      basePath: "/notes",
      trailingSlash: true,
      locales: { list: ["en", "fr"], default: "en" },
      theme: { name: "Field Notes", icon: "/favicon.png", light: { background: "#fffdf8", foreground: "#1d1b16", accent: "#c2410c" } },
    });
  });

  it("reads a Nuxt app: app/ as srcDir, baseURL, site.url, and app.vue alone as one page", async () => {
    const root = project({
      "package.json": '{"name":"harbour","dependencies":{"nuxt":"4"},"scripts":{"build":"nuxt build"}}',
      "nuxt.config.ts": `export default defineNuxtConfig({ app: { baseURL: "/harbour/", head: { title: "Harbour" } }, site: { url: "https://harbour.app" } })`,
      "app/app.vue": "<template><NuxtPage /></template><style>:root { --color-background: #0f1115; --color-foreground: #e6e6e6 }</style>",
      "app/assets/css/main.css": ".dark { --color-background: #000; --color-foreground: #fff }",
    });
    const { report, manifest } = await manifestOf(root);
    expect(report.manifestPath).toBe(join(root, "server", "sitemap.manifest.json"));
    expect(manifest).toMatchObject({
      framework: "nuxt",
      site: "https://harbour.app",
      basePath: "/harbour",
      routes: [{ pattern: "/" }],
      theme: { name: "Harbour", light: { background: "#0f1115" }, dark: { background: "#000" } },
    });
  });
});