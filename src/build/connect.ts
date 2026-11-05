import { randomBytes } from "node:crypto";

/**
 * What `connect` writes so search engines find the sitemap and trust the
 * site: the Sitemap line in robots.txt, and the files Google, Bing and
 * IndexNow fetch to check the site is yours. Pure: the CLI decides where,
 * and asks before it changes anything.
 */

/** robots.txt with the sitemap named: a new one, or the existing one with the line added at its end. */
export function robotsWithSitemap(current: string | null, site: string): { text: string; change: "created" | "added" | "none" } {
  const line = `Sitemap: ${site}/sitemap.xml`;
  if (current === null) return { text: `User-agent: *\nAllow: /\n\n${line}\n`, change: "created" };
  if (/^\s*sitemap\s*:/im.test(current)) return { text: current, change: "none" };
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const body = current.replace(/\s+$/, "");
  return { text: `${body}${body ? `${eol}${eol}` : ""}${line}${eol}`, change: "added" };
}

/** The sitemap robots.txt already names, when it names another address than this one. */
export function otherSitemap(current: string, site: string): string | undefined {
  const named = [...current.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]!);
  return named.length && !named.includes(`${site}/sitemap.xml`) ? named[0] : undefined;
}

/** Google's HTML file: google1234abcd.html, holding its own name. Accepts the token, the file name, or the meta tag's content. */
export function googleFile(token: string): { name: string; body: string } | null {
  const id = token.trim().replace(/^google-site-verification:\s*/i, "").replace(/\.html$/i, "");
  if (!/^google[0-9a-f]{8,32}$/i.test(id)) return null;
  return { name: `${id}.html`, body: `google-site-verification: ${id}.html` };
}

/** Bing's BingSiteAuth.xml, holding the code from Bing Webmaster Tools. */
export function bingFile(token: string): { name: string; body: string } | null {
  const code = token.trim();
  if (!/^[0-9A-F]{32}$/i.test(code)) return null;
  return { name: "BingSiteAuth.xml", body: `<?xml version="1.0"?>\n<users>\n\t<user>${code.toUpperCase()}</user>\n</users>\n` };
}

/** The IndexNow key file: <key>.txt, holding the key. A new key is 32 hex characters, as Bing makes them. */
export function indexNowFile(key = randomBytes(16).toString("hex")): { name: string; body: string; key: string } | null {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) return null;
  return { name: `${key}.txt`, body: key, key };
}
