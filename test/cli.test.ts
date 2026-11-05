import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("shows the Node adapter instead of scanning", async () => {
    const { code, err } = await run(["init"], project({ "package.json": '{"dependencies":{"express":"5"}}' }));
    expect(code).toBe(1);
    expect(err).toContain('import { sitemap } from "maisongr-sitemap/node"');
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
