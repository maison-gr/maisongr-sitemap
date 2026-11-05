import type { ParamRow } from "./entries.js";
import { createSitemap, type SitemapOptions } from "./handler.js";

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
export function sitemap(options: SitemapOptions): (request: Request) => Promise<Response> {
  return createSitemap(options);
}

/**
 * A dynamic page's own values, from its generateStaticParams, for `params`.
 * params.ts (written by the build step) uses it for every page that has one.
 * A page whose generateStaticParams fails is left out with a warning, rather
 * than taking the whole sitemap down with it.
 */
export function staticParams(load: () => Promise<{ generateStaticParams?: (...args: any[]) => unknown }>): () => Promise<ParamRow[]> {
  return async () => {
    try {
      const page = await load();
      const rows = await page.generateStaticParams?.({ params: {} });
      return Array.isArray(rows) ? (rows as ParamRow[]) : [];
    } catch (error) {
      console.warn(`maisongr-sitemap: a page's generateStaticParams failed, so its addresses are left out: ${(error as Error).message}`);
      return [];
    }
  };
}

export type { SitemapOptions };
