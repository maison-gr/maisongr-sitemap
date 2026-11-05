import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type FoundRoute = {
  pattern: string;
  /** Files whose last commit dates the route: the page and what sits beside it. */
  files: string[];
};

export type Skipped = { pattern: string; reason: string };

const PAGE = /^page\.(tsx|ts|jsx|js|mdx|md)$/;
const SOURCE = /\.(tsx|ts|jsx|js|mdx|md|json)$/;

/** Sign-in, account and similar pages never belong in a sitemap. */
export const PRIVATE_SEGMENTS = new Set([
  "login", "logout", "signin", "sign-in", "signup", "sign-up", "register", "auth", "account", "accounts",
  "dashboard", "settings", "admin", "checkout", "onboarding", "reset-password", "forgot-password",
  "verify", "verify-email", "invite", "invitation", "api",
]);

/** Developer and test pages: dev-reset, debug, test-email, internal… */
const TOOL_SEGMENT = /^(dev|debug|test|internal|sandbox)(-|$)/;

const privateOf = (segments: string[]) => segments.find((s) => PRIVATE_SEGMENTS.has(s) || TOOL_SEGMENT.test(s));

/** robots: { index: false }, robots: "noindex", or a noindex meta tag. */
const NOINDEX = /index\s*:\s*false|["']noindex/;

const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const toPosix = (p: string) => p.split(sep).join("/");

/** Helpers whose name says they hide a page, e.g. privatePageMetadata(), noIndexMetadata(). */
const HIDING_HELPER = /private|no-?index|unlisted|hidden/i;

function moduleFile(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(root, existsSync(join(root, "src")) ? "src" : "", spec.slice(2))
    : spec.startsWith(".")
      ? join(from, "..", spec)
      : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

/** A page or layout is noindex when it says so, or calls a local helper named for hiding that does. */
function isNoindex(root: string, file: string): boolean {
  const src = read(file);
  if (NOINDEX.test(src)) return true;
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = m[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]!);
    if (!names.some((n) => HIDING_HELPER.test(n))) continue;
    const target = moduleFile(root, file, m[2]!);
    if (target && NOINDEX.test(read(target))) return true;
  }
  return false;
}

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
