import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroRoutes } from "../src/build/astro-routes.js";

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
