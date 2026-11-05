import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bingFile, googleFile, indexNowFile, otherSitemap, robotsWithSitemap } from "../src/build/connect.js";
import { main } from "../src/cli/main.js";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-connect-"));
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

async function run(args: string[], root: string, answer = false) {
  let out = "";
  let err = "";
  const asked: string[] = [];
  const code = await main(args, root, { out: (s) => (out += s), err: (s) => (err += s), ask: async (q) => (asked.push(q), answer) });
  return { code, out, err, asked };
}

const NEXT = { "package.json": '{"dependencies":{"next":"16"}}', "app/page.tsx": "", "public/.keep": "" };
const SITE = ["--site", "https://www.atelier.dev"];

describe("robots.txt", () => {
  it("is created or given the line it lacks, keeping the file's own line endings", () => {
    expect(robotsWithSitemap(null, "https://a.dev")).toEqual({ text: "User-agent: *\nAllow: /\n\nSitemap: https://a.dev/sitemap.xml\n", change: "created" });
    expect(robotsWithSitemap("User-agent: *\r\nDisallow: /api/\r\n\r\n", "https://a.dev").text).toBe("User-agent: *\r\nDisallow: /api/\r\n\r\nSitemap: https://a.dev/sitemap.xml\r\n");
    expect(robotsWithSitemap("User-agent: *\nSitemap: https://a.dev/sitemap.xml\n", "https://a.dev").change).toBe("none");
    expect(otherSitemap("Sitemap: https://a.dev/sitemap-index.xml", "https://a.dev")).toBe("https://a.dev/sitemap-index.xml");
    expect(otherSitemap("Sitemap: https://a.dev/sitemap.xml", "https://a.dev")).toBeUndefined();
  });

  it("asks before creating it, and leaves it alone on no", async () => {
    const root = project(NEXT);
    const no = await run(["connect", ...SITE], root, false);
    expect(no.code).toBe(0);
    expect(no.asked).toEqual(["Create public/robots.txt, allowing every crawler and naming the sitemap?"]);
    expect(existsSync(join(root, "public/robots.txt"))).toBe(false);
    expect(no.out).toContain("! No robots.txt  left as it is; run again with --yes to create it");

    const yes = await run(["connect", ...SITE], root, true);
    expect(yes.out).toContain("✓ public/robots.txt  created, naming the sitemap");
    expect(readFileSync(join(root, "public/robots.txt"), "utf8")).toContain("Sitemap: https://www.atelier.dev/sitemap.xml");
  });

  it("adds the line with --yes without asking, and never touches one that names another sitemap", async () => {
    const root = project({ ...NEXT, "public/robots.txt": "User-agent: *\nDisallow: /api/\n" });
    const { asked, out } = await run(["connect", ...SITE, "--yes"], root);
    expect(asked).toEqual([]);
    expect(out).toContain("the Sitemap line added at its end");
    expect(readFileSync(join(root, "public/robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /api/\n\nSitemap: https://www.atelier.dev/sitemap.xml\n");

    const other = project({ ...NEXT, "public/robots.txt": "Sitemap: https://www.atelier.dev/sitemap-index.xml\n" });
    const res = await run(["connect", ...SITE, "--yes"], other);
    expect(res.out).toContain("! robots.txt names https://www.atelier.dev/sitemap-index.xml");
    expect(readFileSync(join(other, "public/robots.txt"), "utf8")).toBe("Sitemap: https://www.atelier.dev/sitemap.xml\n".replace("sitemap.xml", "sitemap-index.xml"));
  });

  it("only advises when the site writes robots.txt from code", async () => {
    const root = project({ ...NEXT, "app/robots.ts": "export default () => ({ rules: { userAgent: '*' } });" });
    const { out, asked } = await run(["connect", ...SITE, "--yes"], root);
    expect(asked).toEqual([]);
    expect(out).toContain("! app/robots.ts writes robots.txt and does not name the sitemap");
    expect(existsSync(join(root, "public/robots.txt"))).toBe(false);
  });
});

describe("verification files", () => {
  it("are written as each engine expects them", () => {
    expect(googleFile("google1234abcd5678ef90.html")).toEqual({ name: "google1234abcd5678ef90.html", body: "google-site-verification: google1234abcd5678ef90.html" });
    expect(googleFile("google-site-verification: google1234abcd5678ef90.html")?.name).toBe("google1234abcd5678ef90.html");
    expect(googleFile("not-a-token")).toBeNull();
    expect(bingFile("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")?.body).toBe('<?xml version="1.0"?>\n<users>\n\t<user>A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6</user>\n</users>\n');
    expect(bingFile("short")).toBeNull();
    expect(indexNowFile()!.key).toMatch(/^[0-9a-f]{32}$/);
    expect(indexNowFile("no spaces please")).toBeNull();
  });

  it("land in the site's public folder, and one with other content is never replaced", async () => {
    const root = project({ ...NEXT, "public/robots.txt": "Sitemap: https://www.atelier.dev/sitemap.xml\n", "public/BingSiteAuth.xml": "theirs" });
    const { code, out } = await run(["connect", ...SITE, "--google", "google1234abcd5678ef90.html", "--bing", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "--indexnow", "atelier-key-2026"], root);
    expect(code).toBe(0);
    expect(readFileSync(join(root, "public/google1234abcd5678ef90.html"), "utf8")).toBe("google-site-verification: google1234abcd5678ef90.html");
    expect(readFileSync(join(root, "public/BingSiteAuth.xml"), "utf8")).toBe("theirs");
    expect(out).toContain("! public/BingSiteAuth.xml is already there, with other content");
    expect(readFileSync(join(root, "public/atelier-key-2026.txt"), "utf8")).toBe("atelier-key-2026");
    expect(out).toContain("npx maisongr-sitemap indexnow --site https://www.atelier.dev --key atelier-key-2026");
    expect(out).toContain("https://search.google.com/search-console");
  });

  it("says what a token should look like when it's wrong", async () => {
    const { code, err } = await run(["connect", ...SITE, "--google", "abc"], project(NEXT));
    expect(code).toBe(1);
    expect(err).toContain("✗ --google takes the file Google gives you");
  });

  it("asks for the address and the folder when it can't find them", async () => {
    expect((await run(["connect"], project(NEXT))).err).toContain("✗ Give the address the site is served at.");
    expect((await run(["connect", ...SITE], project({ "index.html": "" }))).code).toBe(0); // a plain site serves its own folder
    expect((await run(["connect", ...SITE], project({ "package.json": "{}", "dist/index.html": "" }))).err).toContain("✗ Name the folder your site serves files from");
  });
});
