import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crawl, robotsRules } from "../src/build/crawl.js";
import { detect } from "../src/build/detect.js";
import { routePaths, spaRoutes } from "../src/build/spa-routes.js";
import { buildStatic, siteNameOf } from "../src/build/static.js";
import { main } from "../src/cli/main.js";

const dirs: string[] = [];
const servers: Server[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-any-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const s of servers.splice(0)) s.close();
});

const git = (root: string, args: string[], date: string) =>
  execFileSync("git", args, {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });

describe("a single-page app's router table", () => {
  it("joins nested route objects and <Route> elements, skipping strings and comments", () => {
    const objects = `
      // { path: "/commented-out" }
      const label = "path: '/in-a-string'";
      createBrowserRouter([
        { path: "/", element: <Home /> },
        { path: "docs", element: <Docs />, children: [{ path: "setup", element: <Setup /> }, { index: true }] },
        { path: "/blog/:slug", element: <Post /> },
      ]);`;
    expect(routePaths(objects)).toEqual(["/", "/docs", "/docs/setup", "/blog/:slug"]);
    const jsx = `<Routes>
      <Route path="/" element={<Layout title="x" />}>
        <Route path="pricing" element={<Pricing />} />
        <Route path="team">
          <Route path="careers" element={<Careers />} />
        </Route>
      </Route>
      <Route path="/legal" element={<Legal />} />
    </Routes>`;
    expect(routePaths(jsx)).toEqual(["/", "/pricing", "/team", "/team/careers", "/legal"]);
  });

  it("lists the public pages and says why the others are left out", () => {
    const root = project({
      "package.json": '{"dependencies":{"vue":"3","vue-router":"4","vite":"7"}}',
      "index.html": "<div id=app></div>",
      "src/router.ts": `import { createRouter } from "vue-router";
        export default createRouter({ routes: [{ path: "/" }, { path: "/about" }, { path: "/user/:id" }, { path: "/admin" }, { path: "/about" }] });`,
      "src/api.ts": 'fetch({ path: "/not-a-route" });',
    });
    expect(detect(root)).toEqual({ kind: "spa", name: "Vue (Vite)", outDir: "dist" });
    expect(spaRoutes(root)).toEqual({
      router: "vue-router",
      paths: [{ path: "/" }, { path: "/about" }],
      skipped: [
        { path: "/user/:id", reason: "dynamic: list its pages with --add" },
        { path: "/admin", reason: "private page (admin)" },
      ],
    });
  });

  it("leaves out redirects and the not-found page, and dates each page by its component's file", () => {
    // AquaDrill's routes: eager and lazy pages, an old address kept as a redirect, and a catch-all 404.
    const root = project({
      "package.json": '{"dependencies":{"react-router-dom":"6","vite":"7"}}',
      "index.html": "<div id=root></div>",
      "src/pages/Index.tsx": "export default () => null;",
      "src/pages/Services.tsx": "export default () => null;",
      "src/pages/Contact.tsx": "export default () => null;",
      "src/App.tsx": `import { Navigate, Route, Routes } from "react-router-dom";
        import Index from "./pages/Index";
        const ServicesPage = lazy(() => import("./pages/Services"));
        const Contact = React.lazy(() => import("@/pages/Contact"));
        export const App = () => (
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route
              path="/contact"
              element={<Contact />}
            />
            <Route path="/about" element={<Navigate to="/aquadrill" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        );`,
    });
    git(root, ["init", "-q"], "2026-01-02T10:00:00Z");
    git(root, ["add", "package.json", "index.html", "src/App.tsx", "src/pages/Index.tsx", "src/pages/Services.tsx", "src/pages/Contact.tsx"], "2026-01-02T10:00:00Z");
    git(root, ["commit", "-qm", "one"], "2026-01-02T10:00:00Z");
    writeFileSync(join(root, "src/pages/Services.tsx"), "export default () => 'new';");
    git(root, ["commit", "-qam", "two"], "2026-03-04T10:00:00Z");

    expect(spaRoutes(root)).toEqual({
      router: "react-router-dom",
      paths: [
        { path: "/", lastmod: "2026-01-02" },
        { path: "/contact", lastmod: "2026-01-02" },
        { path: "/services", lastmod: "2026-03-04" },
      ],
      skipped: [
        { path: "/about", reason: "redirect" },
        { path: "/*", reason: "not-found page" },
      ],
    });
  });

  it("dates a route a prerendered page already lists, and keeps a page's own date", () => {
    const root = project({ "index.html": "<html lang=fr><title>Accueil | Puits</title></html>" });
    buildStatic(root, "https://puits.example", { extra: [{ path: "/", lastmod: "2026-02-01" }, { path: "/services", lastmod: "2026-03-01" }, "/contact"] });
    const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://puits.example/</loc>\n    <lastmod>2026-02-01</lastmod>");
    expect(xml).toContain("<loc>https://puits.example/services</loc>\n    <lastmod>2026-03-01</lastmod>");
    expect(xml).toContain("<loc>https://puits.example/contact</loc>\n  </url>");
  });

  it("keeps React Router's framework mode out of single-page app handling", () => {
    const root = project({ "package.json": '{"dependencies":{"react-router":"8","@react-router/dev":"8","vite":"7"}}', "index.html": "" });
    expect(detect(root)).toEqual({ kind: "unsupported", name: "React Router" });
  });
});

describe("a hand-written HTML site", () => {
  const page = (title: string, body = "") => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;

  it("takes the name the titles share, keeps .html where the links do, and dates each file from Git", () => {
    const root = project({
      "index.html": page("Home | Lumen Bakery", '<a href="/about.html">About</a> <a href="/menu.html">Menu</a> <a href="https://x.com/a">x</a>'),
      "about.html": page("About | Lumen Bakery"),
      "menu.html": page("Menu | Lumen Bakery"),
    });
    git(root, ["init", "-q"], "2026-01-02T10:00:00Z");
    git(root, ["add", "index.html", "about.html", "menu.html"], "2026-01-02T10:00:00Z");
    git(root, ["commit", "-qm", "one"], "2026-01-02T10:00:00Z");
    writeFileSync(join(root, "menu.html"), page("Menu | Lumen Bakery", "new dishes"));
    git(root, ["commit", "-qam", "two"], "2026-03-04T10:00:00Z");

    const report = buildStatic(root, "https://lumen.example");
    expect(report.theme.name).toBe("Lumen Bakery");
    const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://lumen.example/about.html</loc>\n    <lastmod>2026-01-02</lastmod>");
    expect(xml).toContain("<loc>https://lumen.example/menu.html</loc>\n    <lastmod>2026-03-04</lastmod>");
    buildStatic(root, "https://lumen.example", { cleanUrls: true });
    expect(readFileSync(join(root, "sitemap.xml"), "utf8")).toContain("<loc>https://lumen.example/about</loc>");
  });

  it("prefers the name the site declares, and adds addresses no file holds", () => {
    const root = project({ "index.html": page("Welcome", '<meta property="og:site_name" content="Orbit">') });
    const report = buildStatic(root, "https://orbit.example", { extra: ["/pricing", "about", "/"] });
    expect(report.theme.name).toBe("Orbit");
    expect(report.pages).toBe(3);
    // The added addresses render from index.html, so they speak its language too.
    expect(readFileSync(join(root, "sitemap/index.html"), "utf8")).toContain("<b>3</b> EN");
    expect(siteNameOf([], "<title>Orbit — Plan your launch</title>")).toBe("Orbit");
  });

  it("leaves out the error pages and the 200.html fallback that nuxt generate writes for every other route", () => {
    const root = project({
      "index.html": page("Copper"),
      "about/index.html": page("About"),
      "200.html": page("Copper"),
      "404.html": page("Not found"),
      "500.html": page("Error"),
    });
    expect(buildStatic(root, "https://copper.example").pages).toBe(2);
    const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
    expect(xml).not.toMatch(/\/(200|404|500)</);
  });

  it("loads each font once, though a build holds its @font-face in a stylesheet and inlined in the home page", () => {
    const face = '@font-face{font-family:Inter;src:url("/fonts/inter.woff2") format("woff2");font-weight:400 700}';
    const root = project({ "index.html": page("Orbit", `<style>${face}</style>`), "assets/index.css": face });
    const report = buildStatic(root, "https://orbit.example");
    expect(report.theme.fonts.find((f) => f.family === "Inter")!.files).toHaveLength(1);
  });
});

describe("crawl", () => {
  /** A site written in nothing the package can read: every page made at request time, as PHP would. */
  async function site(pages: Record<string, (req: { url: string }) => { status?: number; headers?: Record<string, string>; body?: string }>): Promise<string> {
    const routes = Object.entries(pages);
    const server = createServer((req, res) => {
      // Matched against the list, never looked up by the request's own text (/constructor, /__proto__).
      const path = req.url!.split("?")[0];
      const handler = routes.find(([p]) => p === path)?.[1];
      const out = handler ? handler({ url: req.url! }) : { status: 404, body: "not found" };
      res.writeHead(out.status ?? 200, { "content-type": "text/html; charset=utf-8", ...out.headers });
      res.end(out.body ?? "");
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const html = (head: string, links: string[]) => `<!doctype html><html lang="en"><head>${head}</head><body>${links.map((l) => `<a href="${l}">x</a>`).join(" ")}</body></html>`;

  it("lists what a search engine would keep, under the public address", async () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toUTCString();
    const base = await site({
      "/": () => ({ body: html('<title>Home | Atlas</title><link rel="stylesheet" href="/css/site.css"><link rel="icon" href="/favicon.png"><link rel="alternate" hreflang="fr" href="/fr/">', ["/about", "/old", "/drafts/x", "/search?q=a", "/search?q=a", "/terms", "/copy", "/brochure.pdf", "/hidden", "https://elsewhere.example/", "mailto:a@b.c", "#top"]) }), // /fr/ only through hreflang
      "/about": () => ({ headers: { "last-modified": old }, body: html("<title>About | Atlas</title>", ["/team"]) }),
      "/team": () => ({ headers: { "last-modified": new Date().toUTCString() }, body: html("<title>Team | Atlas</title>", []) }),
      "/fr/": () => ({ body: html('<title>Accueil | Atlas</title><meta property="article:modified_time" content="2026-05-06T08:00:00Z">', ["/"]) }),
      "/old": () => ({ status: 301, headers: { location: "/about" } }),
      "/terms": () => ({ headers: { "x-robots-tag": "noindex" }, body: html("<title>Terms</title>", ["/terms/archive"]) }),
      "/terms/archive": () => ({ body: html("<title>Archive</title>", []) }),
      "/copy": () => ({ body: html('<link rel="canonical" href="https://www.atlas.example/about">', []) }),
      "/hidden": () => ({ body: html('<meta name="robots" content="noindex, nofollow">', ["/never"]) }),
      "/never": () => ({ body: html("<title>Never</title>", []) }),
      "/robots.txt": () => ({ headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /drafts/\n" }),
      "/css/site.css": () => ({ headers: { "content-type": "text/css" }, body: '@font-face{font-family:"Atlas Sans";src:url(../fonts/atlas.woff2) format("woff2")}:root{--background:#f7f5f0;--foreground:#111827}' }),
    });
    const report = await crawl(`${base}/`, { site: "https://www.atlas.example" });

    expect(report.entries.map((e) => e.loc)).toEqual(["https://www.atlas.example/", "https://www.atlas.example/about", "https://www.atlas.example/fr/", "https://www.atlas.example/team", "https://www.atlas.example/terms/archive"]);
    const byPath = Object.fromEntries(report.entries.map((e) => [new URL(e.loc).pathname, e]));
    expect(byPath["/about"]!.lastmod).toBeDefined(); // an old Last-Modified is a real date
    expect(byPath["/team"]!.lastmod).toBeUndefined(); // "now" on every response is not
    expect(byPath["/fr/"]!.lastmod).toBe("2026-05-06T08:00:00Z");
    expect(byPath["/"]!.alternates).toEqual([{ hreflang: "fr", href: "https://www.atlas.example/fr/" }]);
    expect(report.skipped).toEqual([
      { path: "/copy", reason: "canonical is /about" },
      { path: "/drafts/x", reason: "robots.txt disallows it" },
      { path: "/hidden", reason: "noindex" },
      { path: "/old", reason: "redirects to /about" },
      { path: "/terms", reason: "noindex" },
    ]);
    expect(report.queries).toBe(1);
    expect(report.theme).toMatchObject({ name: "Atlas", icon: "/favicon.png", light: { background: "#f7f5f0" } });
    expect(report.theme.fonts).toEqual([{ family: "Atlas Sans", role: "body", files: [{ url: "/fonts/atlas.woff2" }] }]);
  });

  it("turns a date a page states in another form into a W3C date, and drops one that isn't a day (#12)", async () => {
    const base = await site({
      "/": () => ({ body: html('<meta property="article:modified_time" content="November 12, 2026 10:00 UTC">', ["/a", "/b"]) }),
      "/a": () => ({ body: html('<meta property="article:modified_time" content="2026-02-30">', []) }),
      "/b": () => ({ body: html('<script type="application/ld+json">{"dateModified":"2026-05-06"}</script>', []) }),
    });
    const report = await crawl(`${base}/`, { site: "https://www.atlas.example" });
    const byPath = Object.fromEntries(report.entries.map((e) => [new URL(e.loc).pathname, e.lastmod]));
    expect(byPath).toEqual({ "/": "2026-11-12T10:00:00.000Z", "/a": undefined, "/b": "2026-05-06" });
  });

  it("stops at --max, and the command writes the files where the server serves them", async () => {
    const base = await site({
      "/": () => ({ body: html("<title>Shop</title>", ["/a", "/b", "/c"]) }),
      "/a": () => ({ body: html("", []) }),
      "/b": () => ({ body: html("", []) }),
      "/c": () => ({ body: html("", []) }),
    });
    expect((await crawl(`${base}/`, { max: 2, concurrency: 1 })).capped).toBe(true);
    const root = project({ "public/.keep": "" });
    let out = "";
    const code = await main(["crawl", `${base}/`, "--out", "public", "--site", "https://shop.example"], root, { out: (s) => (out += s), err: (s) => (out += s) });
    expect(code).toBe(0);
    expect(out).toContain("4 pages");
    expect(readFileSync(join(root, "public/sitemap.xml"), "utf8")).toContain("<loc>https://shop.example/c</loc>");
    expect(readFileSync(join(root, "public/sitemap/index.html"), "utf8")).toContain('href="/c"');
  });

  it("reads minified HTML, whose attributes have no quotes", async () => {
    const base = await site({
      "/": () => ({ body: "<html lang=en><head><title>Home | Rivet</title><link rel=alternate hreflang=fr href=/fr/></head><body><a href=/pricing>Pricing</a><a class=nav href=/old rel=nofollow>x</a></body></html>" }),
      "/pricing": () => ({ body: "<html lang=en><head><meta property=article:modified_time content=2026-11-04></head><body><a href=/copy>c</a><a href=/hidden>h</a></body></html>" }),
      "/fr/": () => ({ body: "<html lang=fr><body></body></html>" }),
      "/copy": () => ({ body: "<html><head><link rel=canonical href=/pricing></head></html>" }),
      "/hidden": () => ({ body: "<html><head><meta name=robots content=noindex></head></html>" }),
      "/old": () => ({ body: "<html></html>" }),
    });
    const report = await crawl(`${base}/`, { site: "https://rivet.example" });
    expect(report.entries.map((e) => [new URL(e.loc).pathname, e.lang, e.lastmod])).toEqual([
      ["/", "en", undefined],
      ["/fr/", "fr", undefined],
      ["/pricing", "en", "2026-11-04"],
    ]);
    expect(report.skipped).toEqual([
      { path: "/copy", reason: "canonical is /pricing" },
      { path: "/hidden", reason: "noindex" },
    ]);
  });

  it("reads robots.txt as crawlers do", () => {
    const allowed = robotsRules("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/press\n");
    expect(allowed("/")).toBe(true);
    expect(allowed("/private/x")).toBe(false);
    expect(allowed("/private/press/kit")).toBe(true);
  });
});

describe("the page's language in static mode", () => {
  it("takes the home page's <html lang>, and --lang over it", () => {
    const page = (title: string) => `<!doctype html><html lang="fr-CA"><head><title>${title} | Levain</title></head><body></body></html>`;
    const root = project({ "index.html": page("Accueil"), "a-propos.html": page("À propos") });
    buildStatic(root, "https://levain.example");
    expect(readFileSync(join(root, "sitemap/index.html"), "utf8")).toContain("<h1>Toutes les pages de Levain");
    buildStatic(root, "https://levain.example", { lang: "en" });
    expect(readFileSync(join(root, "sitemap/index.html"), "utf8")).toContain("<h1>Every page on Levain");
  });
});
