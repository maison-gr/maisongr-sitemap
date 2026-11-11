import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import sitemap, { astroRouteSource, staticSite } from "../src/astro.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-astro-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const PAGE = '<html lang="en"><head><title>Fern Studio</title></head><body><h1>Fern</h1></body></html>';
const ASTRO = {
  "package.json": JSON.stringify({ name: "fern", dependencies: { astro: "^7.4.0" } }),
  "src/pages/index.astro": "<h1>Home</h1>",
  "src/pages/about.astro": "<h1>About</h1>",
};

/** Astro's config:setup hook as the integration sees it, recording the routes it injects. */
async function setup(root: string, config: { site?: string; base?: string; adapter?: unknown }, command: "dev" | "build" = "build", options = {}) {
  const integration = sitemap(options);
  const routes: { pattern: string; entrypoint: string | URL; prerender?: boolean }[] = [];
  const logs: string[] = [];
  const codegen = join(root, ".astro", "integrations", "maisongr-sitemap");
  await integration.hooks["astro:config:setup"]({
    config: { root: pathToFileURL(`${root}/`), ...config },
    command,
    injectRoute: (r) => routes.push(r),
    createCodegenDir: () => (mkdirSync(codegen, { recursive: true }), pathToFileURL(`${codegen}/`)),
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  return { integration, routes, logs, codegen };
}

describe("the Astro integration", () => {
  it("renders /sitemap.xml on demand with an adapter, from a manifest it refreshes before the build", async () => {
    const root = project(ASTRO);
    const { routes, codegen } = await setup(root, { site: "https://fern.example.org", adapter: { name: "@astrojs/node" } });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ pattern: "/sitemap.xml", prerender: false });
    expect(fileURLToPath(routes[0]!.entrypoint as URL)).toBe(join(codegen, "sitemap.xml.mjs"));
    const manifest = JSON.parse(readFileSync(join(root, "src", "sitemap.manifest.json"), "utf8"));
    expect(manifest.routes.map((r: { pattern: string }) => r.pattern)).toEqual(["/", "/about"]);
    expect(readFileSync(join(codegen, "sitemap.xml.mjs"), "utf8")).toContain('import manifest from "../../../src/sitemap.manifest.json"');
  });

  it("writes the sitemap into the build output after a static build, under the site's base path", async () => {
    const root = project(ASTRO);
    const { integration, routes } = await setup(root, { site: "https://fern.example.org/", base: "/docs" });
    expect(routes).toEqual([]);
    const dist = join(root, "dist");
    mkdirSync(join(dist, "about"), { recursive: true });
    writeFileSync(join(dist, "index.html"), PAGE);
    writeFileSync(join(dist, "about", "index.html"), PAGE);
    integration.hooks["astro:build:done"]({ dir: pathToFileURL(`${dist}/`), logger: { info() {}, warn() {} } });
    const xml = readFileSync(join(dist, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://fern.example.org/docs/</loc>");
    expect(xml).toContain("<loc>https://fern.example.org/docs/about/</loc>");
    expect(existsSync(join(dist, "sitemap", "index.html"))).toBe(true);
    expect(existsSync(join(root, "src", "sitemap.manifest.json"))).toBe(false);
  });

  it("asks for the site's address before a static build", async () => {
    await expect(setup(project(ASTRO), {})).rejects.toThrow(/set site in astro\.config/);
  });

  it("stops when a page already answers /sitemap.xml", async () => {
    const root = project({ ...ASTRO, "src/pages/sitemap.xml.ts": "export const GET = () => new Response('');" });
    await expect(setup(root, { site: "https://fern.example.org", adapter: {} })).rejects.toThrow(/sitemap\.xml\.ts already answers \/sitemap\.xml/);
  });

  it("never rewrites a manifest in dev, where it is the committed one", async () => {
    const root = project({ ...ASTRO, "src/sitemap.manifest.json": '{"version":1,"routes":[],"theme":{"name":"Kept"}}\n' });
    const { routes } = await setup(root, { site: "https://fern.example.org" }, "dev");
    expect(routes).toHaveLength(1);
    expect(readFileSync(join(root, "src", "sitemap.manifest.json"), "utf8")).toContain('"Kept"');
  });

  it("names a config module that does not exist", async () => {
    await expect(setup(project(ASTRO), { site: "https://fern.example.org", adapter: {} }, "build", { config: "./src/missing.ts" })).rejects.toThrow(/missing\.ts was not found/);
  });
});

describe("the route it writes", () => {
  it("imports the manifest and the config module, and passes the integration's own options", () => {
    const dir = join("/p", ".astro", "integrations", "maisongr-sitemap");
    const source = astroRouteSource(dir, join("/p", "src", "sitemap.manifest.json"), join("/p", "src", "sitemap.config.ts"), { name: "Fern", credit: false, lang: "fr" });
    expect(source).toContain('import options from "../../../src/sitemap.config.ts"');
    expect(source).toContain('createSitemap({ ...options, manifest, theme: { ...options.theme, name: "Fern" }, credit: false, lang: "fr" })');
    expect(astroRouteSource(dir, join("/p", "src", "sitemap.manifest.json"))).toContain("const options = {};\n");
  });

  it("joins the site and the base path once", () => {
    expect(staticSite("https://a.dev/", "/docs/")).toBe("https://a.dev/docs");
    expect(staticSite("https://a.dev", "/")).toBe("https://a.dev");
    expect(staticSite("https://a.dev")).toBe("https://a.dev");
    expect(staticSite("https://a.dev", "//docs//")).toBe("https://a.dev/docs");
    expect(staticSite("https://a.dev", "/".repeat(100_000))).toBe("https://a.dev");
  });
});
