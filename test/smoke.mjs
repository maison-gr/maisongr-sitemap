// The built package on the oldest Node it supports, with no test runner: `npm run build && node test/smoke.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createSitemap } from "../dist/index.js";
import { sitemap as nodeSitemap } from "../dist/node.js";

const entries = () => [{ loc: "/" }, { loc: "/about", lastmod: new Date("2026-10-01T12:00:00Z") }];
const handler = createSitemap({ site: "https://www.example.com", entries });

const xml = await (await handler(new Request("https://www.example.com/sitemap.xml"))).text();
assert.match(xml, /<loc>https:\/\/www\.example\.com\/about<\/loc>/);
assert.match(xml, /<lastmod>2026-10-01<\/lastmod>/);

const page = await handler(new Request("https://www.example.com/sitemap.xml", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" } }));
assert.equal(page.headers.get("x-robots-tag"), "noindex");

const server = createServer(nodeSitemap({ site: "https://www.example.com", entries }));
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const res = await fetch(`http://127.0.0.1:${server.address().port}/sitemap.xml`);
assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
server.close();

// The Astro integration loads without Astro, as an integration Astro can call.
const { default: astroSitemap } = await import("../dist/astro.js");
const integration = astroSitemap();
assert.equal(integration.name, "maisongr-sitemap");
assert.equal(typeof integration.hooks["astro:config:setup"], "function");

const version = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), "--version"], { encoding: "utf8" });
assert.match(version, /^\d+\.\d+\.\d+/);

// The MCP server, over its real transport: one JSON message per line, and nothing else on stdout.
const mcp = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), "mcp"], {
  encoding: "utf8",
  input: [{ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { method: "notifications/initialized" }, { id: 2, method: "tools/list" }].map((m) => JSON.stringify({ jsonrpc: "2.0", ...m })).join("\n"),
});
const answers = mcp.trim().split("\n").map((l) => JSON.parse(l));
assert.equal(answers.length, 2);
assert.equal(answers[0].result.protocolVersion, "2025-06-18");
assert.ok(answers[1].result.tools.some((t) => t.name === "sitemap_init"));

console.log(`smoke ok on Node ${process.version}`);
