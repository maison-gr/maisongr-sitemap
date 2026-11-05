import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `server` says whether the site answers requests itself (and so can tell a
 * browser from a crawler at /sitemap.xml) or is built to static files, which
 * get static mode instead.
 */
export type Detected =
  | { kind: "next"; version?: string; appDir?: string; pagesDir?: string; srcDir: boolean }
  | { kind: "astro"; version?: string; pagesDir: string; server: boolean }
  | { kind: "sveltekit"; version?: string; routesDir: string; server: boolean }
  | { kind: "nuxt"; version?: string; pagesDir: string; server: boolean }
  /** A server whose routes live in code: the Node adapter serves the sitemap, with the addresses it is given. */
  | { kind: "node"; name: string }
  | { kind: "static"; outDir: string }
  | { kind: "unsupported"; name: string }
  | { kind: "unknown" };

/** Frameworks recognised but without their own adapter yet: they can use static mode on their build output. */
const LATER: [string, string][] = [
  ["@remix-run/react", "Remix"],
  ["react-router", "React Router"],
  ["gatsby", "Gatsby"],
];

const BUILD_DIRS = ["out", "dist", "build", "_site", "public"];

export function readPackage(root: string): Record<string, any> | null {
  const file = join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The first of these files that exists in the project, as text. */
export function configOf(root: string, names: string[]): { file: string; source: string } | null {
  for (const name of names) {
    const file = join(root, name);
    if (existsSync(file)) return { file, source: readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, "$1") };
  }
  return null;
}

export const ASTRO_CONFIGS = ["astro.config.mjs", "astro.config.ts", "astro.config.mts", "astro.config.js", "astro.config.cjs"];
export const SVELTE_CONFIGS = ["svelte.config.js", "svelte.config.ts", "vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];
export const NUXT_CONFIGS = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"];

export function detect(root: string): Detected {
  const pkg = readPackage(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies } as Record<string, string>;
  const dir = (...candidates: string[]) => candidates.find((c) => existsSync(join(root, c)));

  if (deps.next) {
    const appDir = dir("src/app", "app");
    const pagesDir = dir("src/pages", "pages");
    return { kind: "next", version: deps.next, appDir, pagesDir, srcDir: !!appDir?.startsWith("src/") || !!pagesDir?.startsWith("src/") };
  }
  if (deps.astro) {
    // On-demand rendering needs an adapter; without one every page, the sitemap included, is prerendered.
    const server = /\badapter\s*:/.test(configOf(root, ASTRO_CONFIGS)?.source ?? "");
    return { kind: "astro", version: deps.astro, pagesDir: "src/pages", server };
  }
  if (deps["@sveltejs/kit"]) {
    return { kind: "sveltekit", version: deps["@sveltejs/kit"], routesDir: "src/routes", server: !deps["@sveltejs/adapter-static"] };
  }
  if (deps.nuxt) {
    // `nuxt generate` (or the static preset) writes files; `nuxt build` runs a server.
    const config = configOf(root, NUXT_CONFIGS)?.source ?? "";
    const server = !/\bnuxt\s+generate\b/.test(String(pkg?.scripts?.build ?? "")) && !/preset\s*:\s*["']static["']/.test(config);
    return { kind: "nuxt", version: deps.nuxt, pagesDir: dir("app/pages", "pages") ?? "app/pages", server };
  }

  for (const [name, label] of LATER) if (deps[name]) return { kind: "unsupported", name: label };
  for (const [name, label] of [["express", "Express"], ["polka", "Polka"], ["connect", "Connect"]]) {
    if (deps[name!]) return { kind: "node", name: label! };
  }

  const outDir = BUILD_DIRS.find((d) => existsSync(join(root, d, "index.html")));
  if (outDir) return { kind: "static", outDir };
  if (existsSync(join(root, "index.html"))) return { kind: "static", outDir: "." };
  return { kind: "unknown" };
}
