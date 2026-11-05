import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readPackage } from "./detect.js";

/** Where `init --replace` moves what it takes out of the way. Nothing is deleted: the person checks, then removes the folder. */
export const ASIDE = ".sitemap-replaced";

/** Sitemap tools run as a command after the build. */
const COMMANDS = ["next-sitemap", "svelte-sitemap"];
const CONFIGS = ["next-sitemap.config.js", "next-sitemap.config.cjs", "next-sitemap.config.mjs", "next-sitemap.config.ts"];
const ASTRO_CONFIGS = ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.mts", "astro.config.cjs"];
const NUXT_CONFIGS = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"];

/** A generated or hand-written sitemap in the public folder, its parts and its XSLT. */
const SITEMAP_FILE = /^sitemap[\w-]*\.(xml|xsl|xslt)$/;

/** The script without any step that runs a sitemap tool, or undefined when nothing else was in it. */
export function withoutSitemapStep(script: string): string | undefined {
  const tool = new RegExp(`^(?:(?:npx|bunx|yarn|pnpm(?:\\s+(?:exec|dlx))?)\\s+)?(?:${COMMANDS.join("|")})(?:\\s|$)`);
  const kept = script.split("&&").map((s) => s.trim()).filter((s) => !tool.test(s));
  return kept.length ? kept.join(" && ") : undefined;
}

/** Where a call that opens at `open` closes, counting brackets. -1 when it never does. */
function closing(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Takes a span out of a list, with the comma that belonged to it. */
function cut(source: string, start: number, end: number): string {
  const before = source.slice(0, start);
  const after = source.slice(end).match(/^\s*,[ \t]*/)?.[0].length ?? 0;
  if (!after) return before.replace(/,\s*$/, "") + source.slice(end);
  const rest = source.slice(end + after);
  // Alone on its line: the whole line goes.
  return /(^|\n)[ \t]*$/.test(before) && /^\r?\n/.test(rest) ? before.replace(/[ \t]+$/, "") + rest.replace(/^\r?\n/, "") : before + rest;
}

/** astro.config without @astrojs/sitemap's import and call, and whether the call had options; null when it isn't written the usual way. */
function astroEdit(source: string): { text: string; rules: boolean } | null {
  const name = source.match(/^\s*import\s+(\w+)\s+from\s+["']@astrojs\/sitemap["'];?[ \t]*\r?\n/m);
  if (!name) return null;
  const rest = source.replace(name[0], name[0].startsWith("\n") ? "\n" : "");
  const call = new RegExp(`\\b${name[1]}\\s*\\(`).exec(rest);
  if (!call) return null;
  const open = call.index + call[0].length - 1;
  const end = closing(rest, open);
  return end === -1 ? null : { text: cut(rest, call.index, end + 1), rules: rest.slice(open + 1, end).trim() !== "" };
}

export const astroWithoutSitemap = (source: string) => astroEdit(source)?.text ?? null;

/** nuxt.config without a sitemap module named in `modules`, or null when it isn't written as a plain string there. */
export function nuxtWithoutSitemap(source: string, rival: string): string | null {
  const entry = new RegExp(`["']${rival.replace("/", "\\/")}["']`).exec(source);
  if (!entry || /\[\s*$/.test(source.slice(0, entry.index)) && /^\s*,\s*\{/.test(source.slice(entry.index + entry[0].length))) return null;
  return cut(source, entry.index, entry.index + entry[0].length);
}

/** The same, with whether a top-level `sitemap` key still holds the module's options. */
function nuxtEdit(source: string, rival: string): { text: string; rules: boolean } | null {
  const text = nuxtWithoutSitemap(source, rival);
  return text === null ? null : { text, rules: /^\s*sitemap\s*:/m.test(text) };
}

export type Replacement = {
  /** Files to move aside, relative to the project. */
  files: string[];
  /** Scripts that run a sitemap tool, by name. */
  scripts: string[];
  /** The address another tool's settings give, kept for the new sitemap. */
  site?: string;
};

/** What `init --replace` would move and change, read without touching anything. */
export function planReplacement(root: string, routes: string[], publicDir: string): Replacement {
  const inPublic = existsSync(join(root, publicDir)) ? readdirSync(join(root, publicDir)).filter((n) => SITEMAP_FILE.test(n)).map((n) => `${publicDir}/${n}`) : [];
  const own = (f: string) => readFileSync(join(root, f), "utf8").includes("maisongr-sitemap");
  const files = [...routes.filter((f) => existsSync(join(root, f)) && !own(f)), ...inPublic, ...CONFIGS.filter((f) => existsSync(join(root, f)))];
  const scripts = Object.entries<string>(readPackage(root)?.scripts ?? {}).filter(([, s]) => withoutSitemapStep(s) !== s.trim()).map(([name]) => name);
  const config = CONFIGS.find((f) => existsSync(join(root, f)));
  const site = config && readFileSync(join(root, config), "utf8").match(/\bsiteUrl\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/)?.[1];
  return { files, scripts, site };
}

/** Moves a file into the aside folder, under its own path, never over an earlier one. */
export function moveAside(root: string, file: string): string {
  let target = join(root, ASIDE, file);
  for (let n = 1; existsSync(target); n++) target = join(root, ASIDE, `${file}.${n}`);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(root, file), target);
  return target;
}

/**
 * Edits the framework's config so it stops loading the rival, keeping the file
 * as it was in the aside folder. Says which file changed, or which needs a
 * person, and whether it held sitemap rules the new route won't apply.
 */
export function dropFromConfig(root: string, rival: string): { file: string; done: boolean; rules?: boolean } | undefined {
  const astro = rival === "@astrojs/sitemap";
  if (!astro && !rival.includes("nuxt")) return undefined;
  const file = (astro ? ASTRO_CONFIGS : NUXT_CONFIGS).find((f) => existsSync(join(root, f)));
  if (!file) return undefined;
  const source = readFileSync(join(root, file), "utf8");
  if (!source.includes(rival)) return undefined;
  const edit = astro ? astroEdit(source) : nuxtEdit(source, rival);
  if (edit === null) return { file, done: false };
  mkdirSync(join(root, ASIDE), { recursive: true });
  copyFileSync(join(root, file), join(root, ASIDE, file));
  writeFileSync(join(root, file), edit.text);
  return { file, done: true, rules: edit.rules };
}
