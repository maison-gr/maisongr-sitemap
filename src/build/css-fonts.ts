import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FontRole } from "../types.js";
import { assignRoles, hintOf, type FontSource } from "./fonts.js";

/*
 * Fonts for sites without next/font, in the order the page trusts them:
 * the site's own @font-face files, Fontsource packages, Astro's Fonts API,
 * and last the family names its CSS asks for, fetched from Google Fonts.
 */

type Face = { family: string; path: string; weight?: string; style?: string };
type Found = { kind: "google"; family: string; role: FontRole | null } | { kind: "local"; family: string; role: FontRole | null; files: Omit<Face, "family">[] };

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|emoji|math|fangsong|inherit|initial|unset|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica( neue)?|arial|georgia|times( new roman)?|menlo|monaco|consolas|courier( new)?|sfmono-regular|liberation mono|apple color emoji|segoe ui emoji|var\(.*)$/i;

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/** @font-face rules whose woff2 files exist on disk, resolved from the stylesheet that declares them. */
export function fontFaces(css: string, cssFile: string, publicDir: string): Face[] {
  const faces: Face[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1]!;
    const family = body.match(/font-family\s*:\s*([^;]+)/)?.[1];
    const url = body.match(/url\(\s*["']?([^)"'?#]+\.woff2)/)?.[1];
    if (!family || !url || /^(https?:)?\/\//.test(url)) continue;
    // "/fonts/x.woff2" is served from the public directory; anything else sits beside the stylesheet.
    const path = url.startsWith("/") ? join(publicDir, url) : resolve(dirname(cssFile), url);
    if (!existsSync(path)) continue;
    faces.push({ family: unquote(family), path, weight: body.match(/font-weight\s*:\s*([^;]+)/)?.[1]?.trim(), style: body.match(/font-style\s*:\s*([^;]+)/)?.[1]?.trim() });
  }
  return faces;
}

/** Latin, regular-style faces only: the page shows Latin paths, upright. */
const latinUpright = (f: Face) => !/italic/.test(f.style ?? "") && (!/-(latin-ext|cyrillic|greek|vietnamese|hebrew|arabic|devanagari)/.test(f.path));

function group(faces: Face[], role: (family: string) => FontRole | null): Found[] {
  const families = new Map<string, Face[]>();
  for (const f of faces.filter(latinUpright)) families.set(f.family, [...(families.get(f.family) ?? []), f]);
  return [...families].map(([family, list]) => ({ kind: "local", family, role: role(family), files: list.map(({ family: _, ...file }) => file) }));
}

/** Fontsource packages the code or the CSS imports: their Latin files are already in node_modules. */
function fontsource(root: string, sources: string[]): Face[] {
  const faces: Face[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/["'](@fontsource(?:-variable)?\/[\w-]+)(\/[\w./-]+\.css)?["']/g)) {
      const css = join(root, "node_modules", m[1]!, m[2] ?? "index.css");
      if (seen.has(css) || !existsSync(css)) continue;
      seen.add(css);
      faces.push(...fontFaces(readFileSync(css, "utf8"), css, ""));
    }
  }
  return faces;
}

/** Astro's Fonts API: fonts: [{ provider: fontProviders.google(), name: "Inter", cssVariable: "--font-inter" }]. */
function astroConfigFonts(config: string): Found[] {
  const out: Found[] = [];
  for (const m of config.matchAll(/\{[^{}]*\bname\s*:\s*["']([^"']+)["'][^{}]*\}/g)) {
    if (!/cssVariable/.test(m[0])) continue;
    const variable = m[0].match(/cssVariable\s*:\s*["'](--[\w-]+)["']/)?.[1];
    out.push({ kind: "google", family: m[1]!, role: hintOf(variable, m[1]!) });
  }
  return out;
}

/** The first real family each role's CSS asks for: body text, headings, code, and --font-* tokens. */
function askedFamilies(css: string): Found[] {
  const out: Found[] = [];
  const first = (stack: string) => stack.split(",").map(unquote).find((f) => /[a-z]/i.test(f) && !GENERIC.test(f));
  // --font-display, --font-sans… but not --font-weight-bold or --font-size-lg.
  for (const m of css.matchAll(/(--font-(?!weight|size|feature|variation|stretch|style|smoothing)[\w-]+)\s*:\s*([^;}]+)/g)) {
    const family = first(m[2]!);
    if (family) out.push({ kind: "google", family, role: hintOf(m[1], family) ?? "body" });
  }
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*font-family\s*:\s*([^;}]+)/g)) {
    const family = first(m[2]!);
    if (!family) continue;
    const selector = m[1]!;
    const role: FontRole | null = /\b(code|pre|kbd)\b/.test(selector) ? "mono" : /\bh[1-3]\b/.test(selector) ? "display" : /(^|[\s,])(html|body|:root)\b/.test(selector) ? "body" : null;
    if (role) out.push({ kind: "google", family, role });
  }
  return out;
}

/**
 * Every font the site uses, best source first, each with a role. The caller
 * keeps one font per role, so a family found on disk wins over the same
 * family found only by name.
 */
export function cssFonts(options: { root: string; stylesheets: { file: string; css: string }[]; sources: string[]; publicDir: string; astroConfig?: string }): FontSource[] {
  const tokens = new Map<string, FontRole>();
  for (const { css } of options.stylesheets) {
    for (const f of askedFamilies(css)) if (f.role && !tokens.has(f.family)) tokens.set(f.family, f.role);
  }
  const roleOf = (family: string) => tokens.get(family) ?? hintOf(undefined, family);
  const found: Found[] = [
    ...group(options.stylesheets.flatMap(({ file, css }) => fontFaces(css, file, options.publicDir)), roleOf),
    ...group(fontsource(options.root, [...options.sources, ...options.stylesheets.map((s) => s.css)]), roleOf),
    ...(options.astroConfig ? astroConfigFonts(options.astroConfig) : []),
    ...options.stylesheets.flatMap(({ css }) => askedFamilies(css)),
  ];
  const unique = found.filter((f, i) => found.findIndex((g) => g.family === f.family) === i);
  return assignRoles(unique) as FontSource[];
}
