import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import nuxtSitemap, { nuxtRouteSource } from "../src/nuxt.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-nuxt-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const PAGE = '<html lang="en"><head><title>Copper Bakery</title></head><body><h1>Copper</h1></body></html>';
const NUXT = {
  "package.json": JSON.stringify({ name: "copper", dependencies: { nuxt: "^4.6.0" } }),
  "app/pages/index.vue": "<template><h1>Home</h1></template>",
  "app/pages/about.vue": "<template><h1>About</h1></template>",
};

type Hooked = (...args: any[]) => void;

/** Nuxt as the module sees it: its options, and the nitro:init hook, which `fire` runs with a stand-in Nitro. */
async function install(root: string, options: Record<string, unknown> = {}, inline?: Record<string, unknown>) {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const hooks: Record<string, Hooked[]> = {};
  const nuxt = {
    options: { rootDir: root, buildDir: join(root, ".nuxt"), dev: false, app: { baseURL: "/" }, serverHandlers: [] as { route: string; handler: string }[], nitro: {} as Record<string, any>, ...options },
    hook: (name: string, fn: Hooked) => (hooks[name] ??= []).push(fn),
  };
  await nuxtSitemap(inline, nuxt as never);
  const nitroHooks: Record<string, Hooked[]> = {};
  const fire = (publicDir: string) => {
    for (const fn of hooks["nitro:init"] ?? []) fn({ options: { output: { publicDir } }, hooks: { hook: (name: string, h: Hooked) => (nitroHooks[name] ??= []).push(h) } });
    for (const fn of nitroHooks["prerender:done"] ?? []) fn();
  };
  return { nuxt, fire };
}

describe("the Nuxt module", () => {
  it("tells Nuxt its name and the nuxt.config key its options live under", async () => {
    expect(await nuxtSitemap.getMeta()).toEqual({ name: "maisongr-sitemap", configKey: "maisongrSitemap" });
  });

  it("serves /sitemap.xml from the server, as a virtual module, from a manifest it refreshes before the build", async () => {
    const root = project(NUXT);
    const { nuxt } = await install(root, { maisongrSitemap: { site: "https://copper.example.org", name: "Copper" } });
    expect(nuxt.options.serverHandlers).toEqual([{ route: "/sitemap.xml", handler: "#maisongr-sitemap/sitemap.xml.mjs" }]);
    const source = nuxt.options.nitro.virtual["#maisongr-sitemap/sitemap.xml.mjs"]();
    expect(source).toContain(`import manifest from ${JSON.stringify(join(root, "server", "sitemap.manifest.json").split("\\").join("/"))}`);
    expect(source).toContain('site: "https://copper.example.org", theme: { ...options.theme, name: "Copper" }');
    // Nothing is written into the build folder, which Nuxt 4 keeps under node_modules/.cache.
    expect(existsSync(join(root, ".nuxt"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(root, "server", "sitemap.manifest.json"), "utf8"));
    expect(manifest.routes.map((r: { pattern: string }) => r.pattern)).toEqual(["/", "/about"]);
  });

  it("lets the module's own entry win over the maisongrSitemap key", async () => {
    const root = project(NUXT);
    const { nuxt } = await install(root, { maisongrSitemap: { name: "From the key" } }, { name: "From the entry" });
    expect(nuxt.options.nitro.virtual["#maisongr-sitemap/sitemap.xml.mjs"]()).toContain('name: "From the entry"');
  });

  it("writes the sitemap into the output once nuxt generate has prerendered the pages, under the base URL", async () => {
    const root = project(NUXT);
    const { nuxt, fire } = await install(root, { _generate: true, app: { baseURL: "/shop/" }, maisongrSitemap: { site: "https://copper.example.org" } });
    expect(nuxt.options.serverHandlers).toEqual([]);
    const out = join(root, ".output", "public");
    mkdirSync(join(out, "about"), { recursive: true });
    writeFileSync(join(out, "index.html"), PAGE);
    writeFileSync(join(out, "about", "index.html"), PAGE);
    fire(out);
    const xml = readFileSync(join(out, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://copper.example.org/shop/</loc>");
    expect(xml).toContain("<loc>https://copper.example.org/shop/about/</loc>");
    expect(existsSync(join(out, "sitemap", "index.html"))).toBe(true);
  });

  it("treats a static Nitro preset as nuxt generate", async () => {
    const { nuxt } = await install(project(NUXT), { nitro: { preset: "github-pages" }, maisongrSitemap: { site: "https://copper.example.org" } });
    expect(nuxt.options.serverHandlers).toEqual([]);
  });

  it("asks for the site's address before nuxt generate", async () => {
    await expect(install(project(NUXT), { _generate: true })).rejects.toThrow(/set maisongrSitemap\.site/);
  });

  it("stops when a server route already answers /sitemap.xml", async () => {
    const root = project({ ...NUXT, "server/routes/sitemap.xml.ts": "export default defineEventHandler(() => '')" });
    await expect(install(root)).rejects.toThrow(/sitemap\.xml\.ts already answers \/sitemap\.xml/);
  });

  it("never rewrites a manifest in dev, where it is the committed one", async () => {
    const root = project({ ...NUXT, "server/sitemap.manifest.json": '{"version":1,"routes":[],"theme":{"name":"Kept"}}\n' });
    const { nuxt } = await install(root, { dev: true });
    expect(nuxt.options.serverHandlers).toHaveLength(1);
    expect(readFileSync(join(root, "server", "sitemap.manifest.json"), "utf8")).toContain('"Kept"');
  });
});

describe("the handler it serves", () => {
  it("imports h3 as a namespace, so h3 v2, which has no toWebRequest, still builds", () => {
    const source = nuxtRouteSource("C:\\p\\server\\sitemap.manifest.json", "C:\\p\\server\\sitemap.config.ts");
    expect(source).toContain('import * as h3 from "h3";');
    expect(source).toContain('import manifest from "C:/p/server/sitemap.manifest.json";');
    expect(source).toContain('import options from "C:/p/server/sitemap.config.ts";');
    expect(source).toContain("h3.toWebRequest(event)");
  });
});
