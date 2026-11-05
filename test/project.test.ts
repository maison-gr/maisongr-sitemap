import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detect } from "../src/build/detect.js";
import { gitDates } from "../src/build/git-dates.js";
import { buildNext } from "../src/build/next-build.js";
import { appRoutes, pagesRoutes } from "../src/build/next-routes.js";
import { buildStatic } from "../src/build/static.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-sitemap-"));
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

const git = (root: string, args: string[], date?: string) =>
  execFileSync("git", args, {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).toString();

describe("detect", () => {
  it("knows Next.js, its routers, static builds and what comes later", () => {
    expect(detect(project({ "package.json": '{"dependencies":{"next":"15.5.0"}}', "src/app/page.tsx": "" }))).toMatchObject({ kind: "next", appDir: "src/app" });
    expect(detect(project({ "package.json": '{"dependencies":{"next":"14"}}', "pages/index.tsx": "" }))).toMatchObject({ kind: "next", pagesDir: "pages" });
    expect(detect(project({ "package.json": '{"dependencies":{"astro":"7"}}' }))).toEqual({ kind: "astro", version: "7", pagesDir: "src/pages", server: false });
    expect(detect(project({ "package.json": '{"dependencies":{"astro":"7"}}', "astro.config.mjs": "export default defineConfig({ adapter: node({ mode: 'standalone' }) })" }))).toMatchObject({ kind: "astro", server: true });
    expect(detect(project({ "package.json": '{"devDependencies":{"@sveltejs/kit":"3","@sveltejs/adapter-static":"4"}}' }))).toMatchObject({ kind: "sveltekit", server: false });
    expect(detect(project({ "package.json": '{"devDependencies":{"@sveltejs/kit":"3","@sveltejs/adapter-auto":"8"}}' }))).toMatchObject({ kind: "sveltekit", routesDir: "src/routes", server: true });
    expect(detect(project({ "package.json": '{"dependencies":{"nuxt":"4"},"scripts":{"build":"nuxt build"}}' }))).toMatchObject({ kind: "nuxt", pagesDir: "app/pages", server: true });
    expect(detect(project({ "package.json": '{"dependencies":{"nuxt":"3"},"scripts":{"build":"nuxt generate"}}', "pages/index.vue": "" }))).toMatchObject({ kind: "nuxt", pagesDir: "pages", server: false });
    expect(detect(project({ "package.json": '{"dependencies":{"express":"5"}}' }))).toEqual({ kind: "node", name: "Express" });
    expect(detect(project({ "package.json": '{"dependencies":{"gatsby":"5"}}' }))).toEqual({ kind: "unsupported", name: "Gatsby" });
    expect(detect(project({ "dist/index.html": "<html></html>" }))).toEqual({ kind: "static", outDir: "dist" });
    expect(detect(project({}))).toEqual({ kind: "unknown" });
  });
});

describe("Next.js routes", () => {
  it("follows the App Router's conventions and leaves out what must not be indexed", () => {
    const root = project({
      "app/page.tsx": "",
      "app/(marketing)/pricing/page.tsx": "",
      "app/blog/[slug]/page.tsx": "",
      "app/_components/page.tsx": "",
      "app/@modal/photo/page.tsx": "",
      "app/(.)photo/page.tsx": "",
      "app/login/page.tsx": "",
      "app/thanks/page.tsx": "export const metadata = { robots: { index: false } };",
      "app/app/layout.tsx": 'export const metadata = { robots: "noindex" };',
      "app/app/home/page.tsx": "",
      "app/sitemap.xml/route.ts": "",
    });
    const { routes, skipped } = appRoutes(root, "app");
    expect(routes.map((r) => r.pattern).sort()).toEqual(["/", "/blog/[slug]", "/pricing"]);
    expect(skipped).toEqual(expect.arrayContaining([
      { pattern: "/login", reason: "private page (login)" },
      { pattern: "/thanks", reason: "noindex" },
      { pattern: "/app/home", reason: "noindex" },
    ]));
  });

  it("follows a helper named for hiding a page, but not a shared metadata helper", () => {
    const root = project({
      "src/lib/seo/private.ts": "export function privatePageMetadata() { return { robots: { index: false } }; }",
      "src/lib/seo/page.ts": "export function pageMetadata(o) { return { robots: { index: o.index ?? true, follow: true } }; }",
      "src/app/focus/layout.tsx": 'import { privatePageMetadata } from "@/lib/seo/private";',
      "src/app/focus/page.tsx": "",
      "src/app/pricing/page.tsx": 'import { pageMetadata } from "@/lib/seo/page";',
      "src/app/dev-reset/page.tsx": "",
    });
    const { routes, skipped } = appRoutes(root, "src/app");
    expect(routes.map((r) => r.pattern)).toEqual(["/pricing"]);
    expect(skipped).toEqual([
      { pattern: "/dev-reset", reason: "private page (dev-reset)" },
      { pattern: "/focus", reason: "noindex" },
    ]);
  });

  it("reads noindex passed to a layout as a prop, but not noindex={false}", () => {
    const root = project({
      "app/a/page.tsx": "<Shell noindex>",
      "app/b/page.tsx": "<Shell title='B' noindex />",
      "app/c/page.tsx": "<Shell noindex={true} />",
      "app/d/page.tsx": "<Shell noindex={false} />",
      "app/e/page.tsx": "const noindexed = list.filter(Boolean);",
    });
    expect(appRoutes(root, "app").routes.map((r) => r.pattern).sort()).toEqual(["/d", "/e"]);
  });

  it("does not let a conditional noindex in the root layout hide the whole site", () => {
    const root = project({ "app/layout.tsx": "robots: { index: process.env.X ? true : false }", "app/page.tsx": "" });
    expect(appRoutes(root, "app").routes.map((r) => r.pattern)).toEqual(["/"]);
  });

  it("reads the Pages Router", () => {
    const root = project({ "pages/index.tsx": "", "pages/_app.tsx": "", "pages/404.tsx": "", "pages/api/x.ts": "", "pages/docs/[id].tsx": "", "pages/about.mdx": "" });
    expect(pagesRoutes(root, "pages").routes.map((r) => r.pattern).sort()).toEqual(["/", "/about", "/docs/[id]"]);
  });
});

describe("dates from Git", () => {
  it("dates each file by the last commit that changed it", () => {
    const root = project({ "a.tsx": "1", "b.tsx": "1" });
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "one"], "2026-01-02T10:00:00Z");
    writeFileSync(join(root, "b.tsx"), "2");
    git(root, ["commit", "-qam", "two"], "2026-03-04T10:00:00Z");
    expect(Object.fromEntries(gitDates(root, ["a.tsx", "b.tsx", "c.tsx"]))).toEqual({ "a.tsx": "2026-01-02", "b.tsx": "2026-03-04" });
  });

  it("does not trust the boundary date of a shallow clone", () => {
    const origin = project({ "old.tsx": "1", "new.tsx": "1" });
    git(origin, ["init", "-q"]);
    git(origin, ["add", "."]);
    git(origin, ["commit", "-qm", "one"], "2025-01-01T10:00:00Z");
    writeFileSync(join(origin, "new.tsx"), "2");
    git(origin, ["commit", "-qam", "two"], "2026-05-05T10:00:00Z");
    const clone = mkdtempSync(join(tmpdir(), "mgr-shallow-"));
    dirs.push(clone);
    execFileSync("git", ["clone", "-q", "--depth=1", `file://${origin.replace(/\\/g, "/")}`, clone], { stdio: "pipe" });
    expect(Object.fromEntries(gitDates(clone, ["old.tsx", "new.tsx"]))).toEqual({});
  });

  it("keeps the manifest's dates when a shallow build cannot date a file", async () => {
    const root = project({
      "package.json": '{"name":"demo","dependencies":{"next":"15"}}',
      "app/page.tsx": "",
      "app/globals.css": ":root{--background:#fff;--foreground:#111}",
      "app/sitemap.xml/manifest.json": JSON.stringify({ version: 1, framework: "next", routes: [{ pattern: "/", lastmod: "2024-12-24" }], theme: {} }),
    });
    const report = await buildNext(root, { kind: "next", appDir: "app", srcDir: false }, { offline: true });
    const written = JSON.parse(readFileSync(report.manifestPath, "utf8"));
    expect(written.routes).toEqual([{ pattern: "/", lastmod: "2024-12-24" }]);
    expect(written.theme.light).toMatchObject({ background: "#fff", foreground: "#111" });
  });
});

describe("an unreadable manifest", () => {
  it("is rebuilt from the project, and says so, instead of stopping the build", async () => {
    const conflicted = `<<<<<<< HEAD\n{"version":1,"routes":[]}\n=======\n{"version":1,"routes":[{"pattern":"/"}]}\n>>>>>>> feature\n`;
    const root = project({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "", "app/sitemap.xml/manifest.json": conflicted });
    const report = await buildNext(root, detect(root) as never, { offline: true });
    expect(report.rebuilt).toBe(true);
    expect(JSON.parse(readFileSync(report.manifestPath, "utf8")).routes).toEqual([{ pattern: "/" }]);
  });
});

describe("a full Next.js project", () => {
  it("finds routes, languages, site, name, icon and theme", async () => {
    const root = project({
      "package.json": '{"name":"demo","dependencies":{"next":"15"}}',
      "src/app/layout.tsx": `import "./globals.css";
        export const metadata = { metadataBase: new URL("https://www.demo.app"), title: { default: "Demo", template: "%s · Demo" } };`,
      "src/app/globals.css": ":root{--background:#fbfbfb;--foreground:#0b0b0b;--primary:#2f3bff} .dark{--background:#0b0b0b;--foreground:#fbfbfb}",
      "src/app/icon.svg": "<svg/>",
      "src/app/[locale]/page.tsx": "",
      "src/app/[locale]/pricing/page.tsx": "",
      "src/i18n/routing.ts": `export const routing = defineRouting({ locales: ["en", "fr", "ar"], defaultLocale: "fr" });`,
    });
    const report = await buildNext(root, detect(root) as never, { offline: true });
    expect(report.routes).toBe(2);
    expect(report.site).toBe("https://www.demo.app");
    expect(report.locales).toEqual({ list: ["en", "fr", "ar"], default: "fr" });
    expect(report.theme).toMatchObject({ name: "Demo", icon: "/icon.svg", light: { accent: "#2f3bff" }, dark: { background: "#0b0b0b" } });
  });
});

describe("next.config", () => {
  it("records basePath and trailingSlash, and ignores them when commented out", async () => {
    const config = (body: string) => project({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "", "next.config.mjs": body });
    const read = async (root: string) => JSON.parse(readFileSync((await buildNext(root, detect(root) as never, { offline: true })).manifestPath, "utf8"));
    const on = await read(config(`const nextConfig = { images: { remotePatterns: [{ hostname: "cdn.x" }] }, basePath: "/docs/", trailingSlash: true };\nexport default nextConfig;`));
    expect(on).toMatchObject({ basePath: "/docs", trailingSlash: true });
    const off = await read(config(`export default {\n  // basePath: "/docs",\n  /* trailingSlash: true, */\n  reactStrictMode: true,\n};`));
    expect(off.basePath).toBeUndefined();
    expect(off.trailingSlash).toBeUndefined();
  });
});

describe("languages added by middleware", () => {
  it("prefixes every route when the middleware routes by locale and there is no [locale] folder", async () => {
    const root = project({
      "package.json": '{"dependencies":{"next":"15"}}',
      "src/app/page.tsx": "",
      "src/app/pricing/page.tsx": "",
      "src/app/root-shell.tsx": 'import { Newsreader, Noto_Naskh_Arabic } from "next/font/google";',
      "src/middleware.ts": "const locale = splitLocalePath(pathname).locale;",
      "src/lib/locales.ts": 'export const LOCALES = ["en", "fr", "ar"] as const; export const DEFAULT_LOCALE: Locale = "en";',
    });
    const report = await buildNext(root, detect(root) as never, { offline: true });
    expect(report.locales).toEqual({ list: ["en", "fr", "ar"], default: "en", prefix: true });
    const { expand } = await import("../src/entries.js");
    const out = await expand([{ pattern: "/" }, { pattern: "/pricing" }], { site: "https://x.dev", locales: report.locales });
    expect(out.map((e) => e.loc)).toEqual(["https://x.dev/en", "https://x.dev/fr", "https://x.dev/ar", "https://x.dev/en/pricing", "https://x.dev/fr/pricing", "https://x.dev/ar/pricing"]);
    expect(report.missedFonts).toEqual(["Newsreader"]); // offline; the Arabic cut is never attempted
  });

  it("adds no languages when nothing routes by them", async () => {
    const root = project({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "", "lib/i18n.ts": 'export const LOCALES = ["en", "fr"];' });
    expect((await buildNext(root, detect(root) as never, { offline: true })).locales).toBeUndefined();
  });
});

describe("static sites", () => {
  it("lists the built pages with their language and alternates, and leaves out noindex and redirects", () => {
    const root = project({
      "out/index.html": '<html lang="en"><head><title>Atelier | Home</title><link rel="alternate" hreflang="fr" href="/fr/"></head></html>',
      "out/fr/index.html": '<html lang="fr"></html>',
      "out/about.html": "<html></html>",
      "out/private/index.html": '<html><meta name="robots" content="noindex"></html>',
      "out/old/index.html": '<html><meta http-equiv="refresh" content="0;url=/"></html>',
      "out/404.html": "<html></html>",
      "out/style.css": ":root{--bg:#fff;--fg:#123} @font-face{font-family:Brand;src:url(/fonts/brand.woff2) format('woff2')}",
    });
    const report = buildStatic(join(root, "out"), "https://atelier.dev");
    expect(report.pages).toBe(3);
    expect(report.skipped.map((s) => s.reason).sort()).toEqual(["noindex", "redirect"]);
    const xml = readFileSync(join(root, "out/sitemap.xml"), "utf8");
    expect(xml).toContain('<?xml-stylesheet type="text/css" href="/sitemap.css"?>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="fr" href="https://atelier.dev/fr/"/>');
    const page = readFileSync(join(root, "out/sitemap/index.html"), "utf8");
    expect(page).toContain("Every page on Atelier");
    expect(readFileSync(join(root, "out/sitemap/page.css"), "utf8")).toContain('font-family:"Brand"');
  });

  it("leaves out private pages, and reads the tokens and icon a build inlined into the home page", () => {
    const root = project({
      "dist/index.html": "<html><head><title>Atelier</title><style>:root{--background:#f6f3ee;--foreground:#16130f}</style></head></html>",
      "dist/about/index.html": "<html></html>",
      "dist/login/index.html": "<html></html>",
      "dist/favicon.svg": "<svg/>",
    });
    const report = buildStatic(join(root, "dist"), "https://atelier.dev");
    expect(report.pages).toBe(2);
    expect(report.skipped).toEqual([{ path: "/login/", reason: "private page (login)" }]);
    expect(report.theme).toMatchObject({ name: "Atelier", icon: "/favicon.svg", light: { background: "#f6f3ee", foreground: "#16130f" } });
  });

  it("does not read its own sitemap.css back as the site's theme on the next build", () => {
    const root = project({ "dist/index.html": "<html><style>:root{--background:#fff;--foreground:#111}</style></html>" });
    buildStatic(join(root, "dist"), "https://atelier.dev");
    expect(buildStatic(join(root, "dist"), "https://atelier.dev").theme.light.background).toBe("#fff");
  });
});
