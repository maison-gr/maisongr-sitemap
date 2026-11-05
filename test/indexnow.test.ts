import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main.js";
import { changedSince, readSitemap, submit } from "../src/indexnow.js";
import { indexXml, urlsetXml } from "../src/xml.js";

const site = "https://www.atelier.dev";
const KEY = "a1b2c3d4e5f6a7b8";

afterEach(() => vi.unstubAllGlobals());

/** A fake network: the site's pages by URL, and every IndexNow submission it receives. */
function network(pages: Record<string, string>, answer = 200) {
  const sent: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: answer });
    }
    return url in pages ? new Response(pages[url]) : new Response("Not found", { status: 404 });
  });
  return sent;
}

async function run(args: string[], root = mkdtempSync(join(tmpdir(), "mgr-in-"))) {
  let out = "";
  let err = "";
  const code = await main(args, root, { out: (s) => (out += s), err: (s) => (err += s) });
  rmSync(root, { recursive: true, force: true });
  return { code, out, err };
}

describe("reading a sitemap", () => {
  it("reads addresses with their dates, and the parts of an index", () => {
    const xml = urlsetXml([{ loc: `${site}/a?x=1&y=2`, lastmod: "2026-11-03" }, { loc: `${site}/b` }]);
    expect(readSitemap(xml).urls).toEqual([{ loc: `${site}/a?x=1&y=2`, lastmod: "2026-11-03" }, { loc: `${site}/b`, lastmod: undefined }]);
    expect(readSitemap(indexXml([{ loc: `${site}/sitemap.xml?part=1` }])).parts).toEqual([`${site}/sitemap.xml?part=1`]);
    expect(changedSince(readSitemap(xml).urls, "2026-11-01")).toEqual([`${site}/a?x=1&y=2`]);
  });
});

describe("submitting", () => {
  it("sends batches of 10,000 to the shared endpoint, with the host and key, and leaves out other hosts", async () => {
    const sent = network({});
    const urls = [...Array.from({ length: 10_001 }, (_, i) => `${site}/p/${i}`), "https://elsewhere.dev/x"];
    const results = await submit({ site, key: KEY, urls });
    expect(results.map((r) => [r.urls, r.status])).toEqual([[10_000, 200], [1, 200]]);
    expect(sent[0]!.url).toBe("https://api.indexnow.org/indexnow");
    expect(sent[0]!.body).toMatchObject({ host: "www.atelier.dev", key: KEY });
    expect(sent[1]!.body.urlList).toEqual([`${site}/p/10000`]);
  });
});

describe("the indexnow command", () => {
  const sitemap = urlsetXml([{ loc: `${site}/`, lastmod: "2026-01-01" }, { loc: `${site}/new`, lastmod: "2026-11-04" }, { loc: `${site}/undated` }]);

  it("sends only what changed since the date, once the site serves its key", async () => {
    const sent = network({ [`${site}/${KEY}.txt`]: `${KEY}\n`, [`${site}/sitemap.xml`]: sitemap });
    const { code, out } = await run(["indexnow", "--site", site, "--key", KEY, "--since", "2026-11-01"]);
    expect(code).toBe(0);
    expect(sent.map((s) => s.body.urlList)).toEqual([[`${site}/new`]]);
    expect(out).toContain("Batch 1: 1 page → 200 received");
  });

  it("sends nothing on a dry run, nor before the key file is served", async () => {
    const sent = network({ [`${site}/${KEY}.txt`]: KEY, [`${site}/sitemap.xml`]: sitemap });
    expect((await run(["indexnow", "--site", site, "--key", KEY, "--all", "--dry-run"])).out).toContain("Dry run: nothing was sent.");
    network({ [`${site}/sitemap.xml`]: sitemap });
    const missing = await run(["indexnow", "--site", site, "--key", KEY, "--all"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(`Put a file named ${KEY}.txt`);
    expect(sent).toEqual([]);
  });

  it("reads a built sitemap file, and fails when IndexNow refuses", async () => {
    const root = mkdtempSync(join(tmpdir(), "mgr-in-"));
    writeFileSync(join(root, "sitemap.xml"), sitemap);
    network({ [`${site}/${KEY}.txt`]: KEY }, 403);
    const { code, out, err } = await run(["indexnow", "--site", site, "--key", KEY, "--all", "--sitemap", "sitemap.xml"], root);
    expect(out).toContain("3 pages in the sitemap");
    expect(out).toContain("403 the key was not found");
    expect(code).toBe(1);
    expect(err).toContain("did not accept every batch");
  });

  it("refuses a key the protocol would refuse", async () => {
    network({});
    expect((await run(["indexnow", "--site", site, "--key", "short"])).err).toContain("Give your IndexNow key");
  });
});
