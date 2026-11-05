import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Detected =
  | { kind: "next"; version?: string; appDir?: string; pagesDir?: string; srcDir: boolean }
  | { kind: "static"; outDir: string }
  | { kind: "unsupported"; name: string }
  | { kind: "unknown" };

/** Frameworks recognised but without their own adapter yet: they can use static mode on their build output. */
const LATER: [string, string][] = [
  ["astro", "Astro"],
  ["nuxt", "Nuxt"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@remix-run/react", "Remix"],
  ["react-router", "React Router"],
  ["gatsby", "Gatsby"],
  ["express", "Express"],
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

export function detect(root: string): Detected {
  const pkg = readPackage(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies } as Record<string, string>;

  if (deps.next) {
    const dir = (...candidates: string[]) => candidates.find((c) => existsSync(join(root, c)));
    const appDir = dir("src/app", "app");
    const pagesDir = dir("src/pages", "pages");
    return { kind: "next", version: deps.next, appDir, pagesDir, srcDir: !!appDir?.startsWith("src/") || !!pagesDir?.startsWith("src/") };
  }

  for (const [name, label] of LATER) if (deps[name]) return { kind: "unsupported", name: label };

  const outDir = BUILD_DIRS.find((d) => existsSync(join(root, d, "index.html")));
  if (outDir) return { kind: "static", outDir };
  if (existsSync(join(root, "index.html"))) return { kind: "static", outDir: "." };
  return { kind: "unknown" };
}
