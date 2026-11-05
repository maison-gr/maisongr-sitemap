import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isNoindex, privateOf, toPosix, type FoundRoute, type Skipped } from "./route-rules.js";

export type { FoundRoute, Skipped };

const PAGE = /^page\.(tsx|ts|jsx|js|mdx|md)$/;
const SOURCE = /\.(tsx|ts|jsx|js|mdx|md|json)$/;

function nameOf(segment: string): string | null {
  if (/^\(.+\)$/.test(segment)) return ""; // route group: not in the URL
  return segment;
}

const skipDir = (segment: string) =>
  segment.startsWith("_") || // private folder
  segment.startsWith("@") || // parallel route slot
  /^\(\.{1,3}\)/.test(segment) || // intercepting route
  segment === "node_modules";

/** Page routes of the App Router, with the reason each excluded one was left out. */
export function appRoutes(root: string, appDir: string): { routes: FoundRoute[]; skipped: Skipped[] } {
  const routes: FoundRoute[] = [];
  const skipped: Skipped[] = [];
  const base = join(root, appDir);

  function walk(dir: string, segments: string[], layoutNoindex: boolean) {
    const names = readdirSync(dir);
    const here = names.filter((n) => statSync(join(dir, n)).isFile());
    const layout = here.find((n) => /^layout\.(tsx|ts|jsx|js)$/.test(n));
    // The root layout is not consulted: a conditional noindex there (staging) would hide the whole site.
    const noindex = layoutNoindex || (segments.length > 0 && !!layout && isNoindex(root, join(dir, layout)));
    const page = here.find((n) => PAGE.test(n));

    if (page) {
      const pattern = "/" + segments.filter(Boolean).join("/");
      const privateSegment = privateOf(segments);
      if (privateSegment) skipped.push({ pattern, reason: `private page (${privateSegment})` });
      else if (noindex || isNoindex(root, join(dir, page))) skipped.push({ pattern, reason: "noindex" });
      else routes.push({ pattern, files: here.filter((n) => SOURCE.test(n)).map((n) => toPosix(relative(root, join(dir, n)))) });
    }

    for (const n of names) {
      const full = join(dir, n);
      if (!statSync(full).isDirectory() || skipDir(n)) continue;
      const segment = nameOf(n);
      if (segment === null) continue;
      walk(full, [...segments, segment], noindex);
    }
  }

  if (existsSync(base)) walk(base, [], false);
  return { routes, skipped };
}

/** Page routes of the Pages Router. */
export function pagesRoutes(root: string, pagesDir: string): { routes: FoundRoute[]; skipped: Skipped[] } {
  const routes: FoundRoute[] = [];
  const skipped: Skipped[] = [];
  const base = join(root, pagesDir);

  function walk(dir: string, segments: string[]) {
    for (const n of readdirSync(dir)) {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) {
        if (n !== "api" && !n.startsWith("_")) walk(full, [...segments, n]);
        continue;
      }
      const m = n.match(/^(.+)\.(tsx|ts|jsx|js|mdx|md)$/);
      if (!m || m[1]!.startsWith("_") || ["404", "500"].includes(m[1]!)) continue;
      const parts = m[1] === "index" ? segments : [...segments, m[1]!];
      const pattern = "/" + parts.join("/");
      const privateSegment = privateOf(parts);
      if (privateSegment) skipped.push({ pattern, reason: `private page (${privateSegment})` });
      else if (isNoindex(root, full)) skipped.push({ pattern, reason: "noindex" });
      else routes.push({ pattern, files: [toPosix(relative(root, full))] });
    }
  }

  if (existsSync(base)) walk(base, []);
  return { routes, skipped };
}
