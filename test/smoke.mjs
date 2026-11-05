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

const page = await handler(new Request("https://www.example.com/sitemap.xml", { headers: { "Sec-Fetch-Dest": "document" } }));
assert.equal(page.headers.get("x-robots-tag"), "noindex");

const server = createServer(nodeSitemap({ site: "https://www.example.com", entries }));
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const res = await fetch(`http://127.0.0.1:${server.address().port}/sitemap.xml`);
assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
server.close();

const version = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), "--version"], { encoding: "utf8" });
assert.match(version, /^\d+\.\d+\.\d+/);

console.log(`smoke ok on Node ${process.version}`);
