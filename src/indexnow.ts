/*
 * IndexNow: tells Bing, Yandex, Seznam, Naver and the other participating
 * engines which addresses changed, instead of waiting for them to recrawl.
 * One shared endpoint passes each submission to all of them.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The protocol's limit per submission. */
const BATCH = 10_000;

/** 8 to 128 characters of a-z, A-Z, 0-9 and "-", as the protocol defines a key. */
export const validKey = (key: string) => /^[a-zA-Z0-9-]{8,128}$/.test(key);

/** What each answer means, in the protocol's words. */
const MEANING: Record<number, string> = {
  200: "received",
  202: "received; the key is still being checked",
  400: "the request was not valid",
  403: "the key was not found at the key file's address",
  422: "an address is not on the site, or the key does not match",
  429: "too many requests; try again later",
};

export type Sitemap = { urls: { loc: string; lastmod?: string }[]; parts: string[] };

/** The addresses in a urlset, or the part files of a sitemap index. */
export function readSitemap(xml: string): Sitemap {
  const text = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: text(m[1]!.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? ""),
    lastmod: m[1]!.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim(),
  }));
  const parts = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/g)].map((m) => text(m[1]!));
  return { urls: urls.filter((u) => u.loc), parts };
}

/** Addresses changed on or after `since` (YYYY-MM-DD); all of them when `since` is not given. */
export const changedSince = (urls: Sitemap["urls"], since?: string) => urls.filter((u) => !since || (u.lastmod !== undefined && u.lastmod.slice(0, 10) >= since)).map((u) => u.loc);

export type Submission = { batch: number; urls: number; status: number; meaning: string };

/** Sends the addresses in batches of 10,000, and reports each answer. Addresses on other hosts are refused by the protocol, so they are left out. */
export async function submit(options: { site: string; key: string; urls: string[]; endpoint?: string; keyLocation?: string }): Promise<Submission[]> {
  const host = new URL(options.site).host;
  const own = options.urls.filter((u) => new URL(u).host === host);
  const results: Submission[] = [];
  for (let i = 0; i < own.length; i += BATCH) {
    const urlList = own.slice(i, i + BATCH);
    const res = await fetch(options.endpoint ?? INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: options.key, ...(options.keyLocation ? { keyLocation: options.keyLocation } : {}), urlList }),
    });
    results.push({ batch: results.length + 1, urls: urlList.length, status: res.status, meaning: MEANING[res.status] ?? res.statusText });
  }
  return results;
}
