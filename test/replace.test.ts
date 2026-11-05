import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroWithoutSitemap, nuxtWithoutSitemap, withoutSitemapStep } from "../src/build/replace.js";
import { main } from "../src/cli/main.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-replace-"));
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

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

const NEXT_SITEMAP = {
  "package.json": '{\n  "name": "demo",\n  "scripts": { "build": "next build", "postbuild": "next-sitemap" },\n  "dependencies": { "next": "15" },\n  "devDependencies": { "next-sitemap": "4" }\n}\n',
  "app/page.tsx": "",
  "next-sitemap.config.js": "module.exports = { siteUrl: 'https://www.atelier.dev', generateRobotsTxt: true };",
  "public/sitemap.xml": '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?><sitemapindex/>',
  "public/sitemap-0.xml": "<urlset/>",
  "public/sitemap.xsl": "<xsl:stylesheet/>",
  "public/robots.txt": "User-agent: *\nSitemap: https://www.atelier.dev/sitemap.xml\n",
};

describe("init --replace", () => {
  it("says it can take over, and changes nothing without the flag", async () => {
    const root = project(NEXT_SITEMAP);
    const { code, err } = await run(["init", "--offline"], root);
    expect(code).toBe(1);
    expect(err).toContain("init --replace");
    expect(read(root, "package.json")).toBe(NEXT_SITEMAP["package.json"]);
    expect(existsSync(join(root, ".sitemap-replaced"))).toBe(false);
  });

  it("moves next-sitemap's files aside with their content, and keeps its site address", async () => {
    const root = project(NEXT_SITEMAP);
    const { code, out } = await run(["init", "--offline", "--replace"], root);
    expect(code).toBe(0);
    for (const f of ["public/sitemap.xml", "public/sitemap-0.xml", "public/sitemap.xsl", "next-sitemap.config.js"]) {
      expect(existsSync(join(root, f))).toBe(false);
      expect(read(root, `.sitemap-replaced/${f}`)).toBe(NEXT_SITEMAP[f as keyof typeof NEXT_SITEMAP]);
    }
    expect(read(root, "public/robots.txt")).toBe(NEXT_SITEMAP["public/robots.txt"]);
    const pkg = JSON.parse(read(root, "package.json"));
    expect(pkg.scripts).toEqual({ build: "maisongr-sitemap build && next build" });
    // The package stays until the person uninstalls it, so package.json and the lockfile agree.
    expect(pkg.devDependencies["next-sitemap"]).toBe("4");
    expect(out).toContain("npm uninstall next-sitemap");
    expect(read(root, "app/sitemap.xml/route.js")).toContain('site: "https://www.atelier.dev"');
  });

  it("moves a hand-written route aside and says its addresses don't carry over", async () => {
    const root = project({ "package.json": '{"dependencies":{"next":"15"}}', "app/page.tsx": "", "app/sitemap.ts": "export default () => [];" });
    const { code, out } = await run(["init", "--offline", "--replace"], root);
    expect(code).toBe(0);
    expect(read(root, ".sitemap-replaced/app/sitemap.ts")).toBe("export default () => [];");
    expect(out).toContain("written in code don't carry over");
    expect(existsSync(join(root, "app/sitemap.xml/route.js"))).toBe(true);
  });

  it("changes nothing when --site is wrong", async () => {
    const root = project(NEXT_SITEMAP);
    expect((await run(["init", "--offline", "--replace", "--site", "atelier.dev"], root)).code).toBe(1);
    expect(existsSync(join(root, "public/sitemap.xml"))).toBe(true);
  });

  it("takes @astrojs/sitemap out of astro.config", async () => {
    const config = 'import { defineConfig } from "astro/config";\nimport sitemap from "@astrojs/sitemap";\nimport mdx from "@astrojs/mdx";\n\nexport default defineConfig({\n  site: "https://www.atelier.dev",\n  integrations: [mdx(), sitemap({ filter: (p) => !p.includes("x") })],\n});\n';
    const root = project({ "package.json": '{"scripts":{"build":"astro build"},"dependencies":{"astro":"7","@astrojs/sitemap":"3"}}', "astro.config.mjs": config, "src/pages/index.astro": "" });
    const { code, out } = await run(["init", "--replace"], root);
    expect(code).toBe(0);
    const next = read(root, "astro.config.mjs");
    expect(next).not.toContain("sitemap");
    expect(next).toContain("integrations: [mdx()]");
    expect(JSON.parse(read(root, "package.json")).scripts.build).toBe("astro build && maisongr-sitemap static dist --site https://www.atelier.dev");
    // The filter would otherwise vanish in silence, and a page it hid would be listed.
    expect(read(root, ".sitemap-replaced/astro.config.mjs")).toBe(config);
    expect(out).toContain("a page left out before may now be listed");
    expect(out).toContain("/sitemap-index.xml to /sitemap.xml");
  });

  it("says nothing about rules or the aside folder when the config had neither to keep", async () => {
    const root = project({ "package.json": '{"dependencies":{"next":"15","next-sitemap":"4"}}', "app/page.tsx": "" });
    const { code, out } = await run(["init", "--offline", "--replace"], root);
    expect(code).toBe(0);
    expect(out).not.toContain(".sitemap-replaced");
    expect(out).not.toContain("don't carry over");
  });

  it("keeps a Nuxt config as it was, and names the sitemap key left in it", async () => {
    const config = 'export default defineNuxtConfig({\n  modules: ["@nuxtjs/sitemap"],\n  sitemap: { exclude: ["/secret"] },\n});\n';
    const root = project({ "package.json": '{"dependencies":{"nuxt":"4","@nuxtjs/sitemap":"7"}}', "nuxt.config.ts": config, "app/app.vue": "" });
    const { code, out } = await run(["init", "--offline", "--replace"], root);
    expect(code).toBe(0);
    expect(read(root, ".sitemap-replaced/nuxt.config.ts")).toBe(config);
    expect(out).toContain("nuxt.config.ts still has a sitemap key");
    expect(out).toContain("a page left out before may now be listed");
  });

  it("takes over from a sitemap in a single-page app's public folder", async () => {
    const root = project({
      "package.json": '{"scripts":{"build":"vite build"},"dependencies":{"react":"19","vite":"8"}}',
      "index.html": "<title>Atelier</title>",
      "public/sitemap.xml": "<urlset/>",
      "src/main.tsx": "",
    });
    expect((await run(["init", "--site", "https://www.atelier.dev"], root)).err).toContain("init --replace");
    expect((await run(["init", "--site", "https://www.atelier.dev", "--replace"], root)).code).toBe(0);
    expect(read(root, ".sitemap-replaced/public/sitemap.xml")).toBe("<urlset/>");
  });
});

describe("what --replace edits", () => {
  it("takes a sitemap tool out of a script and keeps the rest", () => {
    expect(withoutSitemapStep("next-sitemap")).toBeUndefined();
    expect(withoutSitemapStep("npx next-sitemap --config a.js")).toBeUndefined();
    expect(withoutSitemapStep("next build && next-sitemap && node after.js")).toBe("next build && node after.js");
    expect(withoutSitemapStep("svelte-sitemap --domain https://a.dev && echo ok")).toBe("echo ok");
    expect(withoutSitemapStep("node next-sitemap-report.js")).toBe("node next-sitemap-report.js");
  });

  it("removes the integration wherever it sits in the list, with nested brackets in its options", () => {
    const with_ = (list: string) => `import sitemap from "@astrojs/sitemap";\nexport default { integrations: [${list}] };\n`;
    expect(astroWithoutSitemap(with_("sitemap()"))).toBe("export default { integrations: [] };\n");
    expect(astroWithoutSitemap(with_("sitemap({ filter: (p) => f(p) }), mdx()"))).toBe("export default { integrations: [mdx()] };\n");
    expect(astroWithoutSitemap(with_("mdx(), sitemap(), react()"))).toBe("export default { integrations: [mdx(), react()] };\n");
    expect(astroWithoutSitemap("export default {};")).toBeNull();
  });

  it("removes a Nuxt module named as a string, and leaves a module given with options to the person", () => {
    expect(nuxtWithoutSitemap(`modules: ["@nuxt/image", "@nuxtjs/sitemap"]`, "@nuxtjs/sitemap")).toBe(`modules: ["@nuxt/image"]`);
    expect(nuxtWithoutSitemap(`modules: ['@nuxtjs/sitemap', '@nuxt/image']`, "@nuxtjs/sitemap")).toBe(`modules: ['@nuxt/image']`);
    expect(nuxtWithoutSitemap(`modules: [['@nuxtjs/sitemap', { a: 1 }]]`, "@nuxtjs/sitemap")).toBeNull();
  });
});

describe("--json", () => {
  it("prints one report, with what was written and what comes next", async () => {
    const root = project({ "package.json": '{"name":"demo","scripts":{"build":"next build"},"dependencies":{"next":"15"}}', "app/page.tsx": "" });
    const { code, out } = await run(["init", "--offline", "--json"], root);
    expect(code).toBe(0);
    const report = JSON.parse(out);
    expect(report).toMatchObject({ ok: true, command: "init" });
    expect(report.sections.find((s: { heading: string }) => s.heading === "Wrote").items[0]).toMatchObject({ status: "ok", text: "app/sitemap.xml/route.js" });
    expect(report.warnings).toBeGreaterThan(0);
  });

  it("reports a stop on stdout, with exit code 1", async () => {
    const { code, out, err } = await run(["init", "--json"], project({}));
    expect(code).toBe(1);
    expect(err).toBe("");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: expect.stringContaining("No site found") });
  });
});
