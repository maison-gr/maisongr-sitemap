import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { entryOf } from "../src/build/node-build.js";
import { main } from "../src/cli/main.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-cli-"));
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

async function run(args: string[], root: string) {
  let out = "";
  let err = "";
  const code = await main(args, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

const NEXT = { "package.json": '{\n  "name": "demo",\n  "scripts": { "build": "next build" },\n  "dependencies": { "next": "15" }\n}\n', "app/page.tsx": "", "app/globals.css": ":root{--background:#fff;--foreground:#111}" };

describe("init", () => {
  it("writes the route, the manifest and the build step", async () => {
    const root = project(NEXT);
    const { code, out } = await run(["init", "--offline"], root);
    expect(code).toBe(0);
    expect(readFileSync(join(root, "app/sitemap.xml/route.js"), "utf8")).toContain('export const dynamic = "force-dynamic"');
    expect(JSON.parse(readFileSync(join(root, "app/sitemap.xml/manifest.json"), "utf8")).routes).toEqual([{ pattern: "/" }]);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.build).toBe("maisongr-sitemap build && next build");
    expect(out).toContain("1 page found");
  });

  it("refuses when next-sitemap or a Pages Router sitemap would shadow or clash with the route", async () => {
    const withNextSitemap = project({ ...NEXT, "package.json": '{"dependencies":{"next":"15"},"devDependencies":{"next-sitemap":"4"}}' });
    expect((await run(["init", "--offline"], withNextSitemap)).err).toContain("next-sitemap writes public/sitemap.xml");
    const withPagesSitemap = project({ ...NEXT, "pages/sitemap.xml.ts": "export default function S() {}" });
    const result = await run(["init", "--offline"], withPagesSitemap);
    expect(result.code).toBe(1);
    expect(result.err).toContain("pages/sitemap.xml.ts already serves /sitemap.xml");
  });

  it("leaves out the dynamic export under Next.js 16's cacheComponents, which refuses it", async () => {
    const root = project({ ...NEXT, "next.config.ts": "const nextConfig = { cacheComponents: true };\nexport default nextConfig;" });
    expect((await run(["init", "--offline"], root)).code).toBe(0);
    const route = readFileSync(join(root, "app/sitemap.xml/route.js"), "utf8");
    expect(route).not.toMatch(/export\s+const\s+dynamic/);
    expect(route).toContain("export const GET = sitemap({");

    writeFileSync(join(root, "app/sitemap.xml/route.js"), `export const dynamic = "force-dynamic";\n${route}`);
    expect((await run(["build", "--offline"], root)).out).toContain("cacheComponents is on, and it refuses the `dynamic` export");
  });

  it("says when robots.txt is missing or does not name the sitemap, and leaves it as it is", async () => {
    expect((await run(["init", "--offline"], project(NEXT))).out).toContain('Add:   a robots.txt that names the sitemap: "Sitemap: https://your.site/sitemap.xml"');
    const silent = project({ ...NEXT, "public/robots.txt": "User-agent: *\nAllow: /\n" });
    expect((await run(["init", "--offline"], silent)).out).toContain("public/robots.txt does not name the sitemap.");
    expect(readFileSync(join(silent, "public/robots.txt"), "utf8")).toBe("User-agent: *\nAllow: /\n");
    const named = project({ ...NEXT, "app/robots.ts": 'export default () => ({ rules: { userAgent: "*" }, sitemap: "https://a.dev/sitemap.xml" })' });
    expect((await run(["init", "--offline"], named)).out).not.toContain("Add:");
  });

  it("refuses to replace a sitemap route that is not its own, and changes nothing", async () => {
    const root = project({ ...NEXT, "app/sitemap.xml/route.js": "export function GET() {}" });
    const { code, err } = await run(["init", "--offline"], root);
    expect(code).toBe(1);
    expect(err).toContain("is not this package's");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(NEXT["package.json"]);
  });
});

describe("init for Astro, SvelteKit and Nuxt", () => {
  const scripts = (root: string) => JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;

  it("writes an on-demand Astro endpoint when the site has an adapter", async () => {
    const root = project({
      "package.json": '{"name":"a","scripts":{"build":"astro build"},"dependencies":{"astro":"7"}}',
      "tsconfig.json": "{}",
      "astro.config.mjs": "export default defineConfig({ adapter: node({ mode: 'standalone' }) })",
      "src/pages/index.astro": "",
    });
    const { code, out } = await run(["init", "--offline"], root);
    expect(code).toBe(0);
    const route = readFileSync(join(root, "src/pages/sitemap.xml.ts"), "utf8");
    expect(route).toContain("export const prerender = false;");
    expect(route).toContain('import manifest from "../sitemap.manifest.json";');
    expect(route).toContain("export const GET: APIRoute = ({ request }) => sitemap(request);");
    expect(JSON.parse(readFileSync(join(root, "src/sitemap.manifest.json"), "utf8")).framework).toBe("astro");
    expect(scripts(root).build).toBe("maisongr-sitemap build && astro build");
    expect(out).toContain("http://localhost:4321/sitemap.xml");
  });

  it("writes the SvelteKit and Nuxt routes where each framework routes them", async () => {
    const kit = project({ "package.json": '{"devDependencies":{"@sveltejs/kit":"3","@sveltejs/adapter-node":"6"}}', "src/routes/+page.svelte": "" });
    expect((await run(["init", "--offline"], kit)).code).toBe(0);
    expect(readFileSync(join(kit, "src/routes/sitemap.xml/+server.js"), "utf8")).toContain("export const GET = ({ request }) => sitemap(request);");
    expect(scripts(kit).build).toBe("maisongr-sitemap build && vite build");

    const nuxt = project({ "package.json": '{"dependencies":{"nuxt":"4"},"scripts":{"build":"nuxt build"}}', "app/app.vue": "" });
    expect((await run(["init", "--offline"], nuxt)).code).toBe(0);
    expect(readFileSync(join(nuxt, "server/routes/sitemap.xml.js"), "utf8")).toContain("toWebRequest(event)");
    expect(JSON.parse(readFileSync(join(nuxt, "server/sitemap.manifest.json"), "utf8")).routes).toEqual([{ pattern: "/" }]);
  });

  it("runs static mode after a static build, with the site from astro.config", async () => {
    const root = project({
      "package.json": '{"scripts":{"build":"astro build"},"dependencies":{"astro":"7"}}',
      "astro.config.mjs": 'export default defineConfig({ site: "https://www.atelier.dev/" })',
      "src/pages/index.astro": "",
    });
    expect((await run(["init"], root)).code).toBe(0);
    expect(scripts(root).build).toBe("astro build && maisongr-sitemap static dist --site https://www.atelier.dev");
    expect((await run(["build"], root)).out).toContain("builds static files here");
  });

  it("asks for the address when a static build does not give one, and changes nothing", async () => {
    const pkg = '{"scripts":{"build":"nuxt generate"},"dependencies":{"nuxt":"4"}}';
    const root = project({ "package.json": pkg, "app/app.vue": "" });
    const { code, err } = await run(["init"], root);
    expect(code).toBe(1);
    expect(err).toContain("it is built with nuxt generate");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(pkg);
    expect((await run(["init", "--site", "https://harbour.app"], root)).code).toBe(0);
    expect(scripts(root).build).toBe("nuxt generate && maisongr-sitemap static .output/public --site https://harbour.app");
  });

  it("refuses when another sitemap package would serve a second sitemap", async () => {
    const root = project({ "package.json": '{"dependencies":{"nuxt":"4","@nuxtjs/sitemap":"7"}}', "app/app.vue": "" });
    expect((await run(["init", "--offline"], root)).err).toContain("@nuxtjs/sitemap serves a sitemap of its own");
  });
});

describe("init on a server whose routes live in code", () => {
  // A workspace: an Express API serving the Vite app it sits beside, fonts hoisted to the root node_modules.
  const WORKSPACE = {
    "package.json": '{"private":true,"workspaces":["frontend","backend"]}',
    "backend/package.json": '{\n  "name": "api",\n  "main": "src/index.js",\n  "scripts": { "start": "node src/index.js" },\n  "dependencies": { "express": "5" }\n}\n',
    "backend/src/index.js": [
      "const path = require('path');",
      "const BASE_URL = (process.env.ATLAS_URL || 'https://www.atlas.dev').replace(/\\/+$/, '');",
      "const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');",
      "app.use('/assets', express.static(path.join(FRONTEND_DIST, 'assets'), { maxAge: '1y' }));",
      "app.use(express.static(FRONTEND_DIST, { index: false }));",
      "app.get('/sitemap-old.xml', oldSitemap);",
    ].join("\n"),
    "frontend/package.json": '{"name":"web","dependencies":{"@fontsource-variable/fraunces":"5"}}',
    "frontend/index.html": "<!doctype html><html><head><title>Atlas | Jobs that fit</title></head><body></body></html>",
    "frontend/public/favicon.ico": "",
    "frontend/src/main.tsx": "import '@fontsource-variable/fraunces';",
    "frontend/src/index.css": ":root{--color-bg:#f3f1ea;--color-text:#171c1a;--color-text-2:#56615b;--color-action:#123c35}",
    "frontend/tailwind.config.js": "module.exports = { theme: { extend: { fontFamily: { display: ['\"Fraunces Variable\"', 'Georgia', 'serif'], sans: ['ui-sans-serif'] } } } };",
    "node_modules/@fontsource-variable/fraunces/index.css": "@font-face{font-family:'Fraunces Variable';font-weight:100 900;src:url(./files/fraunces-latin-wght-normal.woff2) format('woff2-variations')}",
    "node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2": "wOF2",
  };

  it("finds the entry the start script names after the runner's options, in linear time", () => {
    const root = project({ "package.json": '{"scripts":{"start":"node --watch -r dotenv/config server/app.js"}}', "server/app.js": "" });
    expect(entryOf(root)).toBe(join(root, "server/app.js"));
    // CodeQL js/redos: options and their values once overlapped, so this took exponential time.
    const slow = project({ "package.json": JSON.stringify({ scripts: { start: `node ${"-- -".repeat(5000)}` } }) });
    const started = Date.now();
    expect(entryOf(slow)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("reads the theme from the frontend the server serves, and writes a CommonJS module beside its entry", async () => {
    const root = project(WORKSPACE);
    const { code, out } = await run(["init", "--offline"], join(root, "backend"));
    expect(code).toBe(0);

    const manifest = JSON.parse(readFileSync(join(root, "backend/src/sitemap.manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ framework: "express", site: "https://www.atlas.dev", routes: [] });
    expect(manifest.theme).toMatchObject({ name: "Atlas", icon: "/favicon.ico", light: { background: "#f3f1ea", foreground: "#171c1a", muted: "#56615b", accent: "#123c35" } });
    // The Tailwind key says Fraunces is the display face; its hoisted file is served from the frontend's public/.
    const url = "/_sitemap/fraunces-variable-fraunces-latin-wght-normal.woff2";
    expect(manifest.theme.fonts).toEqual([{ role: "display", family: "Fraunces Variable", files: [{ url, weight: "100 900" }] }]);
    expect(readFileSync(join(root, `frontend/public${url}`), "utf8")).toBe("wOF2");

    const module = readFileSync(join(root, "backend/src/sitemap.js"), "utf8");
    expect(module).toContain('const manifest = require("./sitemap.manifest.json");');
    expect(module).toContain('import("maisongr-sitemap/node")');
    expect(module).toContain("module.exports.invalidate");
    expect(JSON.parse(readFileSync(join(root, "backend/package.json"), "utf8")).scripts.build).toBe("maisongr-sitemap build");
    expect(out).toContain('app.get("/sitemap.xml", require("./sitemap.js"));');
    expect(out).toContain("src/index.js already answers a /sitemap…xml route");

    // build reads it all again, and leaves the module alone.
    writeFileSync(join(root, "backend/src/sitemap.js"), "// mine");
    expect((await run(["build", "--offline"], join(root, "backend"))).out).toContain("theme from ../frontend");
    expect(readFileSync(join(root, "backend/src/sitemap.js"), "utf8")).toBe("// mine");
  });

  it("writes an ES module for a server that is one, themed from the public/ folder it serves", async () => {
    const root = project({
      "package.json": '{"type":"module","dependencies":{"express":"5"}}',
      "server.js": 'app.use(express.static("public"));',
      "public/index.html": "<title>Harbour</title><style>:root{--background:#fff;--foreground:#111}</style>",
    });
    expect((await run(["init", "--offline"], root)).code).toBe(0);
    const module = readFileSync(join(root, "sitemap.js"), "utf8");
    expect(module).toContain('import { sitemap as createSitemap } from "maisongr-sitemap/node";');
    expect(module).toContain("export const sitemap = createSitemap({ manifest, entries });");
    expect(JSON.parse(readFileSync(join(root, "sitemap.manifest.json"), "utf8")).theme).toMatchObject({ name: "Harbour", light: { background: "#fff", foreground: "#111" } });
  });

  it("still sets the sitemap up, in a neutral theme, when there is no frontend to read", async () => {
    const root = project({ "package.json": '{"dependencies":{"express":"5"}}', "index.js": "" });
    const { code, out } = await run(["init", "--offline"], root);
    expect(code).toBe(0);
    expect(out).toContain("Frontend: none found");
    expect(readFileSync(join(root, "sitemap.js"), "utf8")).toContain("module.exports = async function sitemap");
  });
});

describe("help", () => {
  it("prints the commands", async () => {
    const { code, out } = await run([], project({}));
    expect(code).toBe(0);
    expect(out).toContain("maisongr-sitemap init");
  });

  it("prints the package's version", async () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect((await run(["--version"], project({}))).out.trim()).toBe(version);
  });

  it("fails on an unknown command instead of passing silently in a script", async () => {
    const { code, err } = await run(["biuld"], project({}));
    expect(code).toBe(1);
    expect(err).toContain('Unknown command "biuld"');
  });
});
