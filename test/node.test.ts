import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { sitemap } from "../src/node.js";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A real server on a free port, as Express would run the handler. */
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const options = { site: "https://www.example.com", entries: () => [{ loc: "/" }, { loc: "/about", lastmod: "2026-10-01" }] };

describe("the Node adapter", () => {
  it("serves the XML to crawlers and the page to browsers, from one address", async () => {
    const base = await serve(sitemap(options));
    const xml = await fetch(`${base}/sitemap.xml`);
    expect(xml.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(xml.headers.get("vary")).toBe("Sec-Fetch-Dest");
    expect(await xml.text()).toContain("<loc>https://www.example.com/about</loc>");
    const page = await fetch(`${base}/sitemap.xml`, { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" } });
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(await page.text()).toContain('<a class="url" href="/about">/about</a>');
    const css = await fetch(`${base}/sitemap.xml?asset=page.css`);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  it("answers HEAD with the headers and no body", async () => {
    const base = await serve(sitemap(options));
    const res = await fetch(`${base}/sitemap.xml`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await res.text()).toBe("");
  });

  it("uses Express's originalUrl, so the stylesheet link survives mounting", async () => {
    const handler = sitemap(options);
    const base = await serve((req, res) => {
      // Express, mounted with app.use("/seo", router): req.url is relative to the mount.
      Object.assign(req, { originalUrl: req.url, url: req.url!.replace(/^\/seo/, "") });
      void handler(req, res);
    });
    expect(await (await fetch(`${base}/seo/sitemap.xml`)).text()).toContain('href="/seo/sitemap.xml?asset=xml.css"');
  });

  it("takes the host and protocol Express reads behind a trusted proxy", async () => {
    const handler = sitemap({ entries: () => [{ loc: "/" }] });
    const base = await serve((req, res) => {
      Object.assign(req, { protocol: "https", hostname: "www.atelier.dev" }); // what `trust proxy` gives from X-Forwarded-*
      void handler(req, res);
    });
    expect(await (await fetch(`${base}/sitemap.xml`)).text()).toContain("<loc>https://www.atelier.dev/</loc>");
  });

  it("hands errors to next, and answers 500 without it", async () => {
    const failing = sitemap({ ...options, entries: () => Promise.reject(new Error("db down")) });
    let passed: unknown;
    const withNext = await serve((req, res) =>
      failing(req, res, (error) => {
        passed = error;
        res.statusCode = 503;
        res.end();
      }),
    );
    expect((await fetch(`${withNext}/sitemap.xml`)).status).toBe(503);
    expect((passed as Error).message).toBe("db down");
    const bare = await serve((req, res) => void failing(req, res));
    const res = await fetch(`${bare}/sitemap.xml`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("db down");
  });
});
