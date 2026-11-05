import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readPackage } from "./detect.js";

const IGNORE = new Set(["node_modules", ".next", ".git", "dist", "out", "build", ".turbo", ".vercel", "coverage", "public"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Source files of the project, for the few facts read from code. Bounded so a large repo stays fast. */
export function sourceFiles(root: string, limit = 4000): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (out.length >= limit) return;
      if (IGNORE.has(n) || n.startsWith(".")) continue;
      const full = join(dir, n);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (CODE.test(n) && s.size < 512 * 1024) out.push(full);
    }
  };
  walk(root);
  return out;
}

const read = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

const list = (body: string) => [...body.matchAll(/["']([\w-]+)["']/g)].map((m) => m[1]!);

/** The languages the site publishes, from next-intl, the Pages Router's i18n config, or a LOCALES constant. */
export function findLocales(files: string[]): { list: string[]; default: string } | undefined {
  for (const f of files) {
    const src = read(f);
    const locales = src.match(/\blocales\s*:\s*\[([^\]]+)\]/) ?? src.match(/\b(?:LOCALES|SUPPORTED_LOCALES|LANGUAGES)\s*(?::[^=]+)?=\s*\[([^\]]+)\]/);
    if (!locales) continue;
    const found = list(locales[1]!);
    if (found.length < 2) continue;
    const def =
      src.match(/\bdefaultLocale\s*:\s*["']([\w-]+)["']/)?.[1] ??
      files.map(read).map((s) => s.match(/\bDEFAULT_LOCALE\s*(?::[^=]+)?=\s*["']([\w-]+)["']/)?.[1]).find(Boolean) ??
      found[0]!;
    return { list: found, default: found.includes(def) ? def : found[0]! };
  }
  return undefined;
}

/** The address the site is served at: metadataBase, a SITE_URL constant, or the environment. */
export function findSite(files: string[]): string | undefined {
  const env = process.env.SITEMAP_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? process.env.NUXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/+$/, "");
  for (const f of files) {
    const src = read(f);
    const m =
      src.match(/metadataBase\s*:\s*new\s+URL\(\s*["'](https?:\/\/[^"']+)["']/) ??
      src.match(/\b(?:SITE_URL|SITE_ORIGIN|BASE_URL|siteUrl)\s*(?::[^=]+)?=\s*["'](https?:\/\/[^"']+)["']/);
    if (m && !/localhost|127\.0\.0\.1|example\.com/.test(m[1]!)) return m[1]!.replace(/\/+$/, "");
  }
  return undefined;
}

/** The site's name as its metadata gives it, else the package name. */
export function findName(root: string, layoutSource: string): string {
  const m =
    layoutSource.match(/siteName\s*:\s*["']([^"']+)["']/) ??
    layoutSource.match(/applicationName\s*:\s*["']([^"']+)["']/) ??
    layoutSource.match(/<title>\s*([^<{|·—–-]+?)\s*(?:[|·—–-][^<]*)?<\/title>/) ??
    layoutSource.match(/title\s*:\s*\{[^}]*default\s*:\s*["']([^"'|·—–-]+)/) ??
    layoutSource.match(/title\s*:\s*["']([^"'|·—–-]+)/);
  if (m) return m[1]!.trim();
  const name = String(readPackage(root)?.name ?? "Site").replace(/^@[^/]+\//, "");
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The icon path the site serves, if it has one: Next.js app/icon.*, or a favicon in the public directory. */
export function findIcon(root: string, appDir?: string, publicDir = join(root, "public")): string | undefined {
  const app = appDir ? join(root, appDir) : null;
  for (const n of ["icon.svg", "icon.png", "favicon.ico"]) if (app && existsSync(join(app, n))) return `/${n}`;
  for (const n of ["favicon.svg", "icon.svg", "favicon.ico", "favicon.png"]) if (existsSync(join(publicDir, n))) return `/${n}`;
  return undefined;
}

/** Files under one directory of the project whose names pass `test`, sorted, bounded so a large repo stays fast. */
export function filesIn(root: string, dir: string, test: RegExp, limit = 2000): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort()) {
      if (out.length >= limit) return;
      if (IGNORE.has(n) || n.startsWith(".")) continue;
      const full = join(d, n);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (test.test(n) && s.size < 512 * 1024) out.push(full);
    }
  };
  walk(join(root, dir));
  return out;
}

/** The CSS inside a component's <style> blocks, with Svelte's :global(:root) unwrapped so tokens read as global. */
export const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!.replace(/:global\(([^()]*)\)/g, "$1")).join("\n");

/** The stylesheets the root layout imports, plus the conventional global ones. */
export function cssFiles(root: string, layoutFile?: string): string[] {
  const found = new Set<string>();
  if (layoutFile) {
    for (const m of read(layoutFile).matchAll(/import\s+["']([^"']+\.css)["']/g)) {
      const spec = m[1]!;
      const file = spec.startsWith("@/") ? join(root, existsSync(join(root, "src")) ? "src" : "", spec.slice(2)) : resolve(dirname(layoutFile), spec);
      if (existsSync(file)) found.add(file);
    }
  }
  for (const c of ["src/app/globals.css", "app/globals.css", "src/styles/globals.css", "styles/globals.css", "src/index.css", "src/global.css"]) {
    if (existsSync(join(root, c))) found.add(join(root, c));
  }
  return [...found];
}
