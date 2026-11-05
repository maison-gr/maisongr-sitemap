import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import type { Font, FontRole } from "../types.js";

/** Where the page's fonts are written, under the site's public directory. */
export const FONT_DIR = "_sitemap";

export type FontSource =
  | { kind: "google"; family: string; role: FontRole }
  | { kind: "local"; family: string; role: FontRole; files: { path: string; weight?: string; style?: string }[] };

/** The role a font's variable or name says it plays, if either says. */
export function hintOf(variable: string | undefined, family: string): FontRole | null {
  const v = variable?.toLowerCase() ?? "";
  if (/mono|code/.test(`${v} ${family.toLowerCase()}`)) return "mono";
  if (/display|heading|head|title|serif/.test(v)) return "display";
  if (/body|sans|text|base|ui/.test(v)) return "body";
  return null;
}

/** Fonts with no hint take the body role first, then display. */
export function assignRoles<T extends { role: FontRole | null }>(fonts: T[]): (T & { role: FontRole })[] {
  const taken = new Set(fonts.map((f) => f.role).filter(Boolean));
  return fonts.map((f) => {
    if (f.role) return f as T & { role: FontRole };
    const role: FontRole = taken.has("body") ? "display" : "body";
    taken.add(role);
    return { ...f, role };
  });
}

/** Fonts the root layout loads through next/font, with the role each plays. */
export function nextFonts(layoutSource: string, layoutDir: string): FontSource[] {
  type Found =
    | { kind: "google"; family: string; role: FontRole | null }
    | { kind: "local"; family: string; role: FontRole | null; files: { path: string; weight?: string; style?: string }[] };
  const out: Found[] = [];
  const calls = (name: string) => {
    const m = layoutSource.match(new RegExp(`\\b${name}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`));
    return m?.[1] ?? "";
  };
  const variableOf = (opts: string) => opts.match(/variable\s*:\s*["'](--[\w-]+)["']/)?.[1];

  const google = layoutSource.match(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/);
  for (const raw of google?.[1]?.split(",") ?? []) {
    const [name, alias] = raw.trim().split(/\s+as\s+/).map((s) => s.trim());
    if (!name) continue;
    const family = name.replace(/_/g, " ");
    out.push({ kind: "google", family, role: hintOf(variableOf(calls(alias ?? name)), family) });
  }

  const local = layoutSource.match(/import\s+(\w+)\s+from\s*["']next\/font\/local["']/)?.[1];
  if (local) {
    for (const m of layoutSource.matchAll(new RegExp(`\\b${local}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g"))) {
      const opts = m[1]!;
      const files = [...opts.matchAll(/(?:src|path)\s*:\s*["']([^"']+\.(?:woff2|woff|ttf|otf))["']/g)].map((f) => ({
        path: resolvePath(layoutDir, f[1]!),
      }));
      if (!files.length) continue;
      const variable = variableOf(opts);
      const family = variable ? variable.replace(/^--(font-)?/, "").replace(/-/g, " ") : basename(files[0]!.path).replace(/\.\w+$/, "");
      out.push({ kind: "local", family, role: hintOf(variable, family), files });
    }
  }
  return assignRoles(out) as FontSource[];
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Downloads a Google font's Latin files once, at build time, so the page serves them from the site itself. */
async function google(family: string, role: FontRole, publicDir: string): Promise<Font | null> {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const axes = role === "mono" ? ":wght@400;500" : ":wght@400;600";
  let css = "";
  for (const q of [`${name}${axes}`, name]) {
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, { headers: { "User-Agent": UA } });
      if (res.ok) {
        css = await res.text();
        break;
      }
    } catch {
      return null; // offline: the page falls back to system fonts
    }
  }
  const faces = [...css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)].map((m) => ({
    url: m[1]!.match(/url\((https:[^)]+\.woff2)\)/)?.[1],
    weight: m[1]!.match(/font-weight:\s*([^;]+);/)?.[1]?.trim(),
    style: m[1]!.match(/font-style:\s*([^;]+);/)?.[1]?.trim(),
  }));

  // A variable font answers every weight with one file: keep it once, with its range.
  const byUrl = new Map<string, { weights: string[]; style?: string }>();
  for (const f of faces) {
    if (!f.url) continue;
    const seen = byUrl.get(f.url);
    if (seen) seen.weights.push(f.weight ?? "400");
    else byUrl.set(f.url, { weights: [f.weight ?? "400"], style: f.style });
  }

  const dir = join(publicDir, FONT_DIR);
  mkdirSync(dir, { recursive: true });
  const files: Font["files"] = [];
  for (const [url, { weights, style }] of byUrl) {
    const sorted = weights.map(Number).sort((a, b) => a - b);
    const weight = sorted.length > 1 ? `${sorted[0]} ${sorted.at(-1)}` : String(sorted[0]);
    const file = `${slug(family)}-${weight.replace(" ", "-")}${style === "italic" ? "-italic" : ""}.woff2`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()));
      files.push({ url: `/${FONT_DIR}/${file}`, weight, style });
    } catch {
      continue;
    }
  }
  return files.length ? { role, family, files } : null;
}

function local(source: Extract<FontSource, { kind: "local" }>, publicDir: string): Font | null {
  const dir = join(publicDir, FONT_DIR);
  mkdirSync(dir, { recursive: true });
  const files: Font["files"] = [];
  for (const f of source.files) {
    if (!existsSync(f.path) || !f.path.endsWith(".woff2")) continue;
    const name = `${slug(source.family)}-${basename(f.path)}`;
    copyFileSync(f.path, join(dir, name));
    files.push({ url: `/${FONT_DIR}/${name}`, weight: f.weight, style: f.style });
  }
  return files.length ? { role: source.role, family: source.family, files } : null;
}

/** Brings each font into public/_sitemap/ and returns the ones the page can use. */
export async function materialize(sources: FontSource[], publicDir: string, offline = false): Promise<{ fonts: Font[]; missed: string[] }> {
  const fonts: Font[] = [];
  const missed: string[] = [];
  for (const s of sources) {
    if (fonts.some((f) => f.role === s.role)) continue; // one font per role
    const font = s.kind === "local" ? local(s, publicDir) : offline ? null : await google(s.family, s.role, publicDir);
    if (font) fonts.push(font);
    else missed.push(s.family);
  }
  return { fonts, missed };
}
