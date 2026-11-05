import { join } from "node:path";
import type { Detected } from "../build/detect.js";
import { COMMAND } from "../build/scripts.js";

export type ServerKind = Extract<Detected, { kind: "next" | "astro" | "sveltekit" | "nuxt" }>;

/** What each framework calls itself, for messages. */
export const LABEL: Record<ServerKind["kind"], string> = { next: "Next.js", astro: "Astro", sveltekit: "SvelteKit", nuxt: "Nuxt" };

/** Where a static build of each framework writes its files. */
export const STATIC_OUT: Record<"astro" | "sveltekit" | "nuxt", string> = { astro: "dist", sveltekit: "build", nuxt: ".output/public" };

/** Sitemap packages that would serve a second sitemap, or shadow this one. */
export const RIVALS: Record<ServerKind["kind"], string[]> = {
  next: ["next-sitemap"],
  astro: ["@astrojs/sitemap"],
  sveltekit: ["super-sitemap", "svelte-sitemap"],
  nuxt: ["@nuxtjs/sitemap", "nuxt-simple-sitemap"],
};

const HEADER = (manifest: string) => `// The sitemap: XML for search engines, a designed page for people, at one address.
// Routes, dates and theme come from ${manifest}, which \`${COMMAND}\` rewrites before each build.
// Docs: https://github.com/maison-gr/sitemap`;

const PARAMS_HINT = (example: string) => `  // Dynamic routes are listed once you give their values, for example:
  // params: ${example},`;

/** The route file's path, relative to the project, for TypeScript or JavaScript. */
export function routePath(detected: ServerKind, ts: boolean): string {
  const ext = ts ? "ts" : "js";
  if (detected.kind === "next") return join(detected.appDir ?? (detected.srcDir ? "src/app" : "app"), "sitemap.xml", `route.${ext}`);
  if (detected.kind === "astro") return join(detected.pagesDir, `sitemap.xml.${ext}`);
  if (detected.kind === "sveltekit") return join(detected.routesDir, "sitemap.xml", `+server.${ext}`);
  return join("server", "routes", `sitemap.xml.${ext}`);
}

/** Files that already answer /sitemap.xml in each framework, besides the route this would write. */
export function existingRoutes(detected: ServerKind): string[] {
  const exts = ["ts", "js", "mjs", "tsx", "jsx"];
  if (detected.kind === "next") {
    const appDir = detected.appDir ?? (detected.srcDir ? "src/app" : "app");
    const pages = detected.pagesDir ? exts.flatMap((e) => [join(detected.pagesDir!, `sitemap.xml.${e}`), join(detected.pagesDir!, "sitemap.xml", `index.${e}`)]) : [];
    return [...["sitemap.ts", "sitemap.js", "sitemap.tsx"].map((n) => join(appDir, n)), ...exts.map((e) => join(appDir, "sitemap.xml", `route.${e}`)), ...pages];
  }
  if (detected.kind === "astro") return exts.map((e) => join(detected.pagesDir, `sitemap.xml.${e}`));
  if (detected.kind === "sveltekit") return exts.map((e) => join(detected.routesDir, "sitemap.xml", `+server.${e}`));
  return exts.map((e) => join("server", "routes", `sitemap.xml.${e}`));
}

export function routeSource(detected: ServerKind, ts: boolean, options: { cacheComponents?: boolean } = {}): string {
  if (detected.kind === "next") {
    const dynamic = options.cacheComponents
      ? "// The answer depends on the request's Sec-Fetch-Dest header. With cacheComponents, reading the request keeps the route dynamic.\n"
      : `// The answer depends on the request's Sec-Fetch-Dest header, so the route stays dynamic.\nexport const dynamic = "force-dynamic";\n`;
    return `${HEADER("./manifest.json")}
import { sitemap } from "@maison-gr/sitemap/next";
import manifest from "./manifest.json";

${dynamic}
export const GET = sitemap({
  manifest,
${PARAMS_HINT(`{ "/blog/[slug]": async () => (await getPosts()).map((p) => ({ slug: p.slug, lastmod: p.updatedAt })) }`)}
});
`;
  }
  if (detected.kind === "astro") {
    return `${HEADER("../sitemap.manifest.json")}
${ts ? 'import type { APIRoute } from "astro";\n' : ""}import { createSitemap } from "@maison-gr/sitemap";
import manifest from "../sitemap.manifest.json";

// The answer depends on the request's Sec-Fetch-Dest header, so it is rendered on demand.
export const prerender = false;

const sitemap = createSitemap({
  manifest,
${PARAMS_HINT(`{ "/blog/[slug]": async () => (await getCollection("blog")).map((p) => ({ slug: p.id, lastmod: p.data.updated })) }`)}
});

export const GET${ts ? ": APIRoute" : ""} = ({ request }) => sitemap(request);
`;
  }
  if (detected.kind === "sveltekit") {
    return `${HEADER("./manifest.json")}
import { createSitemap } from "@maison-gr/sitemap";
import manifest from "./manifest.json";
${ts ? 'import type { RequestHandler } from "./$types";\n' : ""}
// The answer depends on the request's Sec-Fetch-Dest header, so it is never prerendered.
export const prerender = false;

const sitemap = createSitemap({
  manifest,
${PARAMS_HINT(`{ "/blog/[slug]": async () => (await getPosts()).map((p) => ({ slug: p.slug, lastmod: p.updated })) }`)}
});

export const GET${ts ? ": RequestHandler" : ""} = ({ request }) => sitemap(request);
`;
  }
  return `${HEADER("../sitemap.manifest.json")}
import { createSitemap } from "@maison-gr/sitemap";
import manifest from "../sitemap.manifest.json";

const sitemap = createSitemap({
  manifest,
${PARAMS_HINT(`{ "/blog/[slug]": async () => (await queryCollection("blog").all()).map((p) => ({ slug: p.slug, lastmod: p.updated })) }`)}
});

// h3 v2 hands over a web Request; h3 v1 (Nuxt 3 and 4) builds one from the event.
export default defineEventHandler((event) => sitemap(event.req instanceof Request ? event.req : toWebRequest(event)));
`;
}
