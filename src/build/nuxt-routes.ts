import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isNoindex, privateOf, toPosix, type FoundRoute, type Skipped } from "./route-rules.js";

/** Nuxt's default page extensions. */
const PAGE = /^(.+?)(\.client|\.server)?\.(vue|tsx|jsx|ts|js|mjs)$/;
/** What Nuxt's default `ignore` leaves out of pages/. */
const IGNORED = /\.(spec|test|stories)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

/** Nuxt's catch-all also matches the page above it, as an optional catch-all does. */
const segmentOf = (part: string) => part.replace(/^\[\.\.\.([^\]]+)\]$/, "[[...$1]]");

/**
 * Pages of a Nuxt app, from app/pages (Nuxt 4) or pages (Nuxt 3). Files
 * starting with "-" are ignored, as Nuxt's ignorePrefix does; groups (shop)
 * do not appear in the URL. A parent page (blog.vue beside blog/) and its
 * index child share an address, so they are one route.
 */
export function nuxtRoutes(root: string, pagesDir: string): { routes: FoundRoute[]; skipped: Skipped[] } {
  const found = new Map<string, FoundRoute>();
  const skipped: Skipped[] = [];

  function walk(dir: string, segments: string[]) {
    for (const n of readdirSync(dir).sort()) {
      if (n.startsWith("-") || n.startsWith(".")) continue;
      const full = join(dir, n);
      if (statSync(full).isDirectory()) {
        walk(full, /^\(.+\)$/.test(n) ? segments : [...segments, n]);
        continue;
      }
      const name = IGNORED.test(n) ? undefined : n.match(PAGE)?.[1];
      if (!name) continue;
      const parts = name === "index" ? segments : [...segments, name];
      const pattern = "/" + parts.map(segmentOf).join("/");
      const privateSegment = privateOf(parts);
      if (privateSegment) skipped.push({ pattern, reason: `private page (${privateSegment})` });
      else if (isNoindex(root, full)) skipped.push({ pattern, reason: "noindex" });
      else {
        const route = found.get(pattern) ?? { pattern, files: [] };
        route.files.push(toPosix(relative(root, full)));
        found.set(pattern, route);
      }
    }
  }

  const base = join(root, pagesDir);
  if (existsSync(base)) walk(base, []);
  return { routes: [...found.values()], skipped };
}
