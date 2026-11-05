import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroRoutes } from "../src/build/astro-routes.js";
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
