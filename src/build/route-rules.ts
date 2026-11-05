import { existsSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** A page route found in the project, in the bracket syntax the manifest uses ("/blog/[slug]"). */
export type FoundRoute = {
  pattern: string;
  /** Files whose last commit dates the route: the page and what sits beside it. */
  files: string[];
};

export type Skipped = { pattern: string; reason: string };

/**
 * Words that make a page private wherever they appear in its name, as whole
 * words: "account-recovery", "confirm-email-change" and "reset-password" are
 * private; "accounting-services" is not.
 */
export const PRIVATE_WORDS = new Set([
  "login", "logout", "signin", "signout", "signup", "register", "auth", "oauth", "sso", "callback",
  "account", "accounts", "dashboard", "settings", "admin", "checkout", "cart", "billing", "onboarding",
  "password", "verify", "confirm", "confirmation", "recovery", "unsubscribe", "invite", "invitation", "api",
]);

/** Written as two words: sign-in, sign-up, sign-out, log-in, log-out. */
const SPLIT_WORDS = /(^|-)(sign|log)-(in|up|out)(-|$)/;

/** Developer and test pages: dev-reset, debug, test-email, internal… */
const TOOL_SEGMENT = /^(dev|debug|test|internal|sandbox)(-|$)/;

const isPrivate = (segment: string) =>
  !/^[[(]/.test(segment) && (SPLIT_WORDS.test(segment) || TOOL_SEGMENT.test(segment) || segment.split(/[-_.]/).some((w) => PRIVATE_WORDS.has(w)));

export const privateOf = (segments: string[]) => segments.find(isPrivate);

/**
 * robots: { index: false }, robots: "noindex", a noindex meta tag, or a
 * layout told so through a prop: <Layout noindex />, noindex={true}.
 */
const NOINDEX = /index\s*:\s*false|["']noindex|\snoindex(?=\s*(?:\/?>|\s[\w:@-]|=\{?\s*true\s*\}?))/;

export const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

export const toPosix = (p: string) => p.split(sep).join("/");

/** Helpers whose name says they hide a page, e.g. privatePageMetadata(), noIndexMetadata(). */
const HIDING_HELPER = /private|no-?index|unlisted|hidden/i;

/**
 * The file an import names: relative, or through the "@/" and "~/" aliases,
 * which point at src/ (Next.js), the root, or app/ (Nuxt 4), whichever has it.
 */
function moduleFile(root: string, from: string, spec: string): string | null {
  const bases = spec.startsWith("@/") || spec.startsWith("~/")
    ? ["src", "", "app"].map((dir) => join(root, dir, spec.slice(2)))
    : spec.startsWith(".")
      ? [join(from, "..", spec)]
      : [];
  for (const base of bases) {
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
      const f = base + ext;
      if (existsSync(f) && statSync(f).isFile()) return f;
    }
  }
  return null;
}

/**
 * Why a page has nothing to list, if so: it only answers "not found" (a
 * [...missing] catch-all giving each language its 404) or only sends the
 * visitor elsewhere (an old address kept as a redirect). Either way it calls
 * notFound() or redirect() and never returns anything to render.
 */
export function emptyPageReason(file: string): string | null {
  const src = read(file);
  if (/\breturn\b/.test(src)) return null;
  if (/\b(permanentRedirect|redirect)\s*\(/.test(src)) return "redirect";
  if (/\bnotFound\s*\(\s*\)/.test(src)) return "not-found page";
  return null;
}

/** A page or layout is noindex when it says so, or calls a local helper named for hiding that does. */
export function isNoindex(root: string, file: string): boolean {
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
