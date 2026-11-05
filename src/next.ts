import { createSitemap, type SitemapOptions } from "./handler.js";

/**
 * The Next.js App Router route: app/sitemap.xml/route.ts.
 *
 *   import { sitemap } from "@maison-gr/sitemap/next";
 *   import manifest from "./manifest.json";
 *
 *   // The answer depends on the request's Sec-Fetch-Dest header.
 *   export const dynamic = "force-dynamic";
 *   export const GET = sitemap({ manifest });
 *
 * `dynamic` is written out in the route file because Next reads it from the
 * source. The list of addresses is cached in memory (see `revalidate`).
 */
export function sitemap(options: SitemapOptions): (request: Request) => Promise<Response> {
  return createSitemap(options);
}

export type { SitemapOptions };
