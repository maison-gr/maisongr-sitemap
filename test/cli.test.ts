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

  it("refuses to replace a sitemap route that is not its own, and changes nothing", async () => {
    const root = project({ ...NEXT, "app/sitemap.xml/route.js": "export function GET() {}" });
    const { code, err } = await run(["init", "--offline"], root);
    expect(code).toBe(1);
    expect(err).toContain("is not this package's");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(NEXT["package.json"]);
  });
});

describe("init on a server whose routes live in code", () => {
  it("shows the Node adapter instead of scanning", async () => {
    const { code, err } = await run(["init"], project({ "package.json": '{"dependencies":{"express":"5"}}' }));
    expect(code).toBe(1);
    expect(err).toContain('import { sitemap } from "@maison-gr/sitemap/node"');
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
