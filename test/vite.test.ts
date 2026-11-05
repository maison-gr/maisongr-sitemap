import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sitemap } from "../src/vite.js";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mgr-vite-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

/** Vite's dev server as the plugin sees it: middlewares in order, then the app's index.html for everything else. */
async function devServer(root: string, plugin: ReturnType<typeof sitemap>): Promise<string> {
  const handlers: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void)[] = [];
  plugin.configureServer({ config: { root }, middlewares: { use: (h) => handlers.push(h) } });
  const server = createServer((req, res) => {
    const fallback = () => {
      res.setHeader("Content-Type", "text/html");
      res.end("<h1>Page introuvable</h1>");
    };
    handlers[0]!(req, res, fallback);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const SPA = {
  "package.json": '{"name":"wells","dependencies":{"react-router-dom":"6"}}',
  "index.html": '<!doctype html><html lang="fr"><head><title>AquaDrill</title></head><body><div id="root"></div></body></html>',
  "src/App.tsx": 'import { Route, Routes } from "react-router-dom";\nexport default () => <Routes><Route path="/" element={<Home />} /><Route path="/services" element={<Services />} /><Route path="*" element={<NotFound />} /></Routes>;',
  "src/index.css": ":root { --background: #f4efe6; --foreground: #14202b; }",
  "public/favicon.svg": "<svg/>",
};

describe("the Vite plugin", () => {
  it("serves in dev the files the build writes, from the router's routes", async () => {
    const base = await devServer(project(SPA), sitemap({ site: "https://aquadrill.example" }));
    const xml = await fetch(`${base}/sitemap.xml`);
    expect(xml.status).toBe(200);
    expect(xml.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await xml.text();
    expect(body).toContain("<loc>https://aquadrill.example/</loc>");
    expect(body).toContain("<loc>https://aquadrill.example/services</loc>");
    expect(body).not.toContain("*");
    expect(body).toContain('href="/sitemap.css"');

    const html = await (await fetch(`${base}/sitemap.xml`, { headers: { "Sec-Fetch-Dest": "document" } })).text();
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('href="/services"');
    // Each page counted in index.html's language, as the prerendered build counts it.
    expect(html).toContain("<b>2</b> FR");
    expect((await fetch(`${base}/sitemap.css`)).headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect((await fetch(`${base}/sitemap/page.css`)).status).toBe(200);
    expect((await fetch(`${base}/sitemap/page.js`)).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("answers one address two ways: a browser opening /sitemap.xml gets the page, a crawler the XML", async () => {
    const base = await devServer(project(SPA), sitemap({ site: "https://aquadrill.example" }));
    const person = await fetch(`${base}/sitemap.xml`, { headers: { "Sec-Fetch-Dest": "document" } });
    expect(person.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(person.headers.get("x-robots-tag")).toBe("noindex");
    expect(person.headers.get("vary")).toBe("Sec-Fetch-Dest");
    expect(await person.text()).toContain('href="/services"');
    const crawler = await fetch(`${base}/sitemap.xml`);
    expect(crawler.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(crawler.headers.get("vary")).toBe("Sec-Fetch-Dest");
    expect(crawler.headers.get("x-robots-tag")).toBeNull();
  });

  it("has one address: /sitemap, /sitemap/ and the page's own file redirect to /sitemap.xml", async () => {
    const base = await devServer(project(SPA), sitemap({ site: "https://aquadrill.example" }));
    for (const path of ["/sitemap", "/sitemap/", "/sitemap/index.html", "/sitemap/?q=1"]) {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("/sitemap.xml");
    }
  });

  it("takes the site's colours from its source stylesheets", async () => {
    const base = await devServer(project(SPA), sitemap({ site: "https://aquadrill.example" }));
    expect((await (await fetch(`${base}/sitemap/page.css`)).text()).toLowerCase()).toContain("#f4efe6");
  });

  it("leaves every other address to the app, the sitemap's neighbours included", async () => {
    const base = await devServer(project(SPA), sitemap({ site: "https://aquadrill.example" }));
    for (const path of ["/", "/services", "/sitemap.xml.bak", "/sitemap/other"]) expect(await (await fetch(`${base}${path}`)).text()).toContain("Page introuvable");
  });

  it("reads the routes on each request, and lists --add addresses", async () => {
    const root = project(SPA);
    const base = await devServer(root, sitemap({ site: "https://aquadrill.example/", add: ["/brochure.pdf"] }));
    expect(await (await fetch(`${base}/sitemap.xml`)).text()).toContain("<loc>https://aquadrill.example/brochure.pdf</loc>");
    writeFileSync(join(root, "src/App.tsx"), SPA["src/App.tsx"].replace('<Route path="*"', '<Route path="/contact" element={<Contact />} /><Route path="*"'));
    expect(await (await fetch(`${base}/sitemap.xml`)).text()).toContain("<loc>https://aquadrill.example/contact</loc>");
  });

  it("answers HEAD without a body, and runs in dev only", async () => {
    const plugin = sitemap({ site: "https://aquadrill.example" });
    expect(plugin.apply).toBe("serve");
    const base = await devServer(project(SPA), plugin);
    const head = await fetch(`${base}/sitemap.xml`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("refuses a site that is not a full address", () => {
    expect(() => sitemap({ site: "aquadrill.example" })).toThrow(/full address/);
  });
});
