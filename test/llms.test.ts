import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LLMS_MARK, llmsText, onePerPage, pageInfo } from "../src/build/llms.js";
import { main } from "../src/cli/main.js";

const dirs: string[] = [];
const servers: Server[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-llms-"));
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

const PUBLIC = "https://www.atelier.dev";
const url = (path: string, alternates = "") => `<url><loc>${PUBLIC}${path}</loc>${alternates}</url>`;
const pair = (fr: string, en: string) =>
  `<xhtml:link rel="alternate" hreflang="fr-CA" href="${PUBLIC}${fr}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${PUBLIC}${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${PUBLIC}${fr}"/>`;
const html = (title: string, description?: string) =>
  `<!doctype html><html lang="fr"><head><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}</head><body></body></html>`;

describe("llms.txt", () => {
  it("keeps one version of each page: the one its x-default names", () => {
    const xml = `<urlset>${url("/fr", pair("/fr", "/en"))}${url("/en", pair("/fr", "/en"))}${url("/press")}${url("/press")}</urlset>`;
    expect(onePerPage(xml)).toEqual([`${PUBLIC}/fr`, `${PUBLIC}/press`]);
  });

  it("takes each page's own words, without the site name in its title", () => {
    expect(pageInfo(html("Services | Atelier", "What we build &amp; how."), `${PUBLIC}/fr/services`, "Atelier")).toEqual({ url: `${PUBLIC}/fr/services`, title: "Services", description: "What we build & how." });
    expect(pageInfo("", `${PUBLIC}/fr/x`).title).toBe("/fr/x");
    // The name first, as many French sites write it, and numeric entities decoded.
    expect(pageInfo(html("Atelier — Prix d&#x27;une application", "L&#39;équipe&nbsp;senior"), `${PUBLIC}/fr/couts`, "Atelier")).toMatchObject({ title: "Prix d'une application", description: "L'équipe senior" });
  });

  it("is Markdown: the name, what the site is, then its pages by section, marked as written by the tool", () => {
    const text = llmsText({
      name: "Atelier",
      description: "A design studio in Montreal.",
      pages: [
        { url: `${PUBLIC}/fr`, title: "Accueil" },
        { url: `${PUBLIC}/fr/work/harbour`, title: "Harbour", description: "A port's booking system." },
        { url: `${PUBLIC}/fr/work/field`, title: "Field" },
      ],
    });
    expect(text).toBe(
      `# Atelier\n\n> A design studio in Montreal.\n\n## Pages\n\n- [Accueil](${PUBLIC}/fr)\n\n## Work\n\n- [Harbour](${PUBLIC}/fr/work/harbour): A port's booking system.\n- [Field](${PUBLIC}/fr/work/field)\n\n${LLMS_MARK}\n`,
    );
  });

  async function site(): Promise<string> {
    const pages: Record<string, string> = {
      "/sitemap.xml": `<sitemapindex><sitemap><loc>${PUBLIC}/sitemap.xml?sitemap=pages</loc></sitemap></sitemapindex>`,
      "/sitemap.xml?sitemap=pages": `<urlset>${url("/fr", pair("/fr", "/en"))}${url("/en", pair("/fr", "/en"))}${url("/fr/services", pair("/fr/services", "/en/services"))}</urlset>`,
      "/fr": html("Accueil | Atelier", "Un studio de design à Montréal."),
      "/fr/services": html("Services | Atelier"),
    };
    const server = createServer((req, res) => {
      const body = Object.entries(pages).find(([p]) => p === req.url)?.[1];
      res.writeHead(body ? 200 : 404, { "content-type": req.url!.startsWith("/sitemap") ? "application/xml" : "text/html" });
      res.end(body ?? "");
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function run(args: string[], root: string) {
    let out = "";
    let err = "";
    const code = await main(args, root, { out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  }

  it("reads a running copy through the sitemap index, and writes where the site serves files", async () => {
    const from = await site();
    const root = project({ "package.json": '{"dependencies":{"next":"16"}}', "app/page.tsx": "", "public/.keep": "" });
    const { code, out } = await run(["llms", "--site", PUBLIC, "--from", from], root);
    expect(code).toBe(0);
    const text = readFileSync(join(root, "public/llms.txt"), "utf8");
    expect(text).toContain("# Atelier\n\n> Un studio de design à Montréal.");
    expect(text).toContain(`- [Accueil](${PUBLIC}/fr)`);
    expect(text).toContain(`- [Services](${PUBLIC}/fr/services)`);
    expect(text).not.toContain("/en");
    expect(out).toContain("! 1 page without a meta description");

    // Written by the tool, so a later run replaces it; one written by hand is kept.
    expect((await run(["llms", "--site", PUBLIC, "--from", from], root)).out).toContain("✓ public/llms.txt");
    writeFileSync(join(root, "public/llms.txt"), "# Our own\n");
    const kept = await run(["llms", "--site", PUBLIC, "--from", from], root);
    expect(kept.out).toContain("! public/llms.txt is already there, written by hand");
    expect(readFileSync(join(root, "public/llms.txt"), "utf8")).toBe("# Our own\n");
  });

  it("--stdout prints the file alone", async () => {
    const from = await site();
    const { out } = await run(["llms", "--site", PUBLIC, "--from", from, "--stdout"], project({}));
    expect(out.startsWith("# Atelier\n")).toBe(true);
    expect(out).not.toContain("Done");
  });

  it("says what to do when the sitemap can't be read", async () => {
    const { code, err } = await run(["llms", "--site", PUBLIC, "--from", "http://127.0.0.1:9", "--stdout"], project({}));
    expect(code).toBe(1);
    expect(err).toContain("could not be read");
    expect(err).toContain("--from http://localhost:3000");
  });
});
