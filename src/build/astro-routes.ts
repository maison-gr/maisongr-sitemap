import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isNoindex, privateOf, toPosix, type FoundRoute, type Skipped } from "./route-rules.js";

/** Files in src/pages that are pages. .js and .ts files there are endpoints, not pages. */
const PAGE = /^(.+)\.(astro|md|mdx|markdown|html)$/;

/** Astro's rest parameter also matches the page above it ("/docs"), as an optional catch-all does. */
const segmentOf = (part: string) => part.replace(/^\[\.\.\.([^\]]+)\]$/, "[[...$1]]");

/** Pages of an Astro site, from src/pages. Names starting with _ are not routed. */
export function astroRoutes(root: string, pagesDir: string): { routes: FoundRoute[]; skipped: Skipped[] } {
  const routes: FoundRoute[] = [];
  const skipped: Skipped[] = [];

  function walk(dir: string, segments: string[]) {
    for (const n of readdirSync(dir).sort()) {
      if (n.startsWith("_") || n.startsWith(".")) continue;
      const full = join(dir, n);
      if (statSync(full).isDirectory()) {
        walk(full, [...segments, n]);
        continue;
      }
      const name = n.match(PAGE)?.[1];
      if (!name || name === "404" || name === "500") continue;
      const parts = name === "index" ? segments : [...segments, name];
      const pattern = "/" + parts.map(segmentOf).join("/");
      const privateSegment = privateOf(parts);
      if (privateSegment) skipped.push({ pattern, reason: `private page (${privateSegment})` });
      else if (isNoindex(root, full)) skipped.push({ pattern, reason: "noindex" });
      else routes.push({ pattern, files: [toPosix(relative(root, full))] });
    }
  }

  const base = join(root, pagesDir);
  if (existsSync(base)) walk(base, []);
  return { routes, skipped };
}
