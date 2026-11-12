import type { ParamRow } from "./entries.js";
import { createSitemap, type SitemapHandler, type SitemapOptions } from "./handler.js";

/**
 * The Next.js App Router route: app/sitemap.xml/route.ts.
 *
 *   import { sitemap } from "maisongr-sitemap/next";
 *   import manifest from "./manifest.json";
 *   import { pageParams } from "./params";
 *
 *   // The answer depends on the request's Sec-Fetch-Dest header.
 *   export const dynamic = "force-dynamic";
 *   export const GET = sitemap({ manifest, params: { ...pageParams } });
 *
 * `dynamic` is written out in the route file because Next reads it from the
 * source. The list of addresses is cached in memory (see `revalidate`).
 */
export function sitemap(options: SitemapOptions): SitemapHandler {
  return createSitemap(options);
}

/**
 * A dynamic page's own values, from its generateStaticParams, for `params`.
 * params.ts (written by the build step) uses it for every page that has one.
 * A page whose generateStaticParams fails is left out with a warning, rather
 * than taking the whole sitemap down with it.
 */
export function staticParams(
  load: () => Promise<{ generateStaticParams?: (...args: any[]) => unknown; getStaticPaths?: (...args: any[]) => unknown }>,
  pattern?: string,
): () => Promise<ParamRow[]> {
  return async () => {
    try {
      const page = await load();
      if (page.generateStaticParams) {
        const rows = await page.generateStaticParams({ params: {} });
        return Array.isArray(rows) ? (rows as ParamRow[]) : [];
      }
      // The Pages Router's getStaticPaths: { paths: [{ params }] } or { paths: ["/blog/hello"] }.
      const result = (await page.getStaticPaths?.({ locales: undefined, defaultLocale: undefined })) as { paths?: unknown[] } | undefined;
      return (result?.paths ?? []).flatMap((p): ParamRow[] => {
        if (typeof p === "string") {
          const row = pattern ? paramsFromPath(pattern, p) : null;
          return row ? [row] : [];
        }
        const params = (p as { params?: ParamRow })?.params;
        return params ? [params] : [];
      });
    } catch (error) {
      console.warn(`maisongr-sitemap: a page's ${pattern ?? ""} static paths failed, so its addresses are left out: ${(error as Error).message}`);
      return [];
    }
  };
}

/** "/blog/hello" against "/blog/[slug]" → { slug: "hello" }; catch-alls take the rest, as an array. */
function paramsFromPath(pattern: string, path: string): ParamRow | null {
  const want = pattern.split("/").filter(Boolean);
  let got: string[];
  try {
    got = path.split("?")[0]!.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // A % that isn't an escape ("50%off"): this path is left out, not the page's others.
    return null;
  }
  const row: ParamRow = {};
  for (let i = 0; i < want.length; i++) {
    const seg = want[i]!;
    const rest = seg.match(/^\[\[?\.\.\.(\w+)\]\]?$/);
    if (rest) {
      row[rest[1]!] = got.slice(i);
      return row;
    }
    const one = seg.match(/^\[(\w+)\]$/);
    if (one) {
      if (got[i] === undefined) return null;
      row[one[1]!] = got[i]!;
    } else if (seg !== got[i]) return null;
  }
  return got.length === want.length ? row : null;
}

export type { SitemapHandler, SitemapOptions };
