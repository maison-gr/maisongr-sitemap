import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isNoindex, privateOf, toPosix, type FoundRoute, type Skipped } from "./route-rules.js";

/** +page.svelte, and the layout resets +page@.svelte, +page@(app).svelte. */
const PAGE = /^\+page(@[^.]*)?\.svelte$/;
const LAYOUT = /^\+layout(@[^.]*)?\.svelte$/;
/** The files that make up a page, for its date: component, load functions, actions. */
const PAGE_FILES = /^\+page(@[^.]*)?(\.server)?\.(svelte|ts|js)$/;

/**
 * A directory name as the URL has it, in the manifest's syntax: matchers go
 * ([id=number] → [id]), a rest parameter may be empty ([...x] → [[...x]]),
 * and [x+2e] / [u+1f600] become the characters they encode.
 */
function segmentOf(name: string): string {
  return name
    .replace(/\[x\+([\da-f]{2})\]/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/(?:\[u\+([\da-f]{4,6})\])+/gi, (run: string) =>
      String.fromCharCode(...[...run.matchAll(/\[u\+([\da-f]{4,6})\]/gi)].map((m) => parseInt(m[1]!, 16))),
    )
    .replace(/(\[{1,2}(?:\.\.\.)?[^\]=]+)=[^\]]+(\]{1,2})/g, "$1$2")
    .replace(/^\[\.\.\.([^\]]+)\]$/, "[[...$1]]");
}

/** Pages of a SvelteKit app, from src/routes. Groups (app) do not appear in the URL. */
export function svelteRoutes(root: string, routesDir: string): { routes: FoundRoute[]; skipped: Skipped[] } {
  const routes: FoundRoute[] = [];
  const skipped: Skipped[] = [];

  function walk(dir: string, segments: string[], layoutNoindex: boolean) {
    const names = readdirSync(dir).sort();
    const here = names.filter((n) => statSync(join(dir, n)).isFile());
    const layout = here.find((n) => LAYOUT.test(n));
    // The root layout is not consulted: a conditional noindex there (staging) would hide the whole site.
    const noindex = layoutNoindex || (segments.length > 0 && !!layout && isNoindex(root, join(dir, layout)));
    const page = here.find((n) => PAGE.test(n));

    if (page) {
      const parts = segments.filter((s) => !/^\(.+\)$/.test(s));
      const pattern = "/" + parts.map(segmentOf).join("/");
      const privateSegment = privateOf(parts);
      if (privateSegment) skipped.push({ pattern, reason: `private page (${privateSegment})` });
      else if (noindex || isNoindex(root, join(dir, page))) skipped.push({ pattern, reason: "noindex" });
      else routes.push({ pattern, files: here.filter((n) => PAGE_FILES.test(n)).map((n) => toPosix(relative(root, join(dir, n)))) });
    }

    for (const n of names) {
      const full = join(dir, n);
      if (n.startsWith(".") || n === "node_modules" || !statSync(full).isDirectory()) continue;
      walk(full, [...segments, n], noindex);
    }
  }

  const base = join(root, routesDir);
  if (existsSync(base)) walk(base, [], false);
  return { routes, skipped };
}
