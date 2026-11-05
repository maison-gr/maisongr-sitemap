import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { readPackage, type Detected } from "./detect.js";
import { themeFacts } from "./framework-build.js";
import { read, writeManifest, type BuildReport } from "./manifest.js";
import { findIcon, findName, findSite, sourceFiles } from "./project.js";

type NodeServer = Extract<Detected, { kind: "node" }>;

/*
 * An Express (or Connect, Polka) server keeps its routes in code, so there is
 * nothing to scan for pages. Its look lives in the frontend it serves: the
 * folder named in express.static(...), or the client project that folder is
 * built from. The theme and fonts are read there, as for any framework.
 */

const BUILD_OUTPUT = new Set(["dist", "build", "out", ".output"]);
const SERVER_ENTRIES = ["src/index.ts", "src/index.js", "src/server.ts", "src/server.js", "src/app.ts", "src/app.js", "index.ts", "index.js", "server.ts", "server.js", "app.ts", "app.js"];

/** The text of the call's first argument, its own parentheses included: path.join(__dirname, "../dist"). */
function firstArg(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return source.slice(open + 1, i);
    else if (c === "," && depth === 1) return source.slice(open + 1, i);
  }
  return "";
}

const QUOTED = /^["'`]([^"'`$]*)["'`]$/;

/**
 * Where an expression points, for the forms servers write: a string,
 * path.join/resolve(__dirname | import.meta.dirname | process.cwd(), "…"),
 * or a constant holding one of those. Null for anything computed.
 */
function pathOf(expr: string, file: string, cwd: string, depth = 0): string | null {
  const e = expr.trim();
  const quoted = e.match(QUOTED);
  if (quoted) return resolve(cwd, quoted[1]!);
  if (e === "__dirname" || e === "import.meta.dirname") return dirname(file);
  if (/^process\.cwd\(\)$/.test(e)) return cwd;
  const call = e.match(/^(?:path\.)?(join|resolve)\s*\(([\s\S]*)\)$/);
  if (call) {
    const parts = call[2]!.split(",").map((p) => p.trim()).filter(Boolean);
    const [head, ...rest] = parts;
    const base = head ? pathOf(head, file, cwd, depth) : null;
    const tail = rest.map((p) => p.match(QUOTED)?.[1]);
    return base && tail.every((t) => t !== undefined) ? resolve(base, ...(tail as string[])) : null;
  }
  // A constant from the same file: const FRONTEND_DIST = path.join(__dirname, "../../frontend/dist").
  if (/^[A-Za-z_$][\w$]*$/.test(e) && depth < 3) {
    const def = read(file).match(new RegExp(`\\b(?:const|let|var)\\s+${e.replace(/[\\$]/g, "\\$&")}\\s*=\\s*([^;\\n]+)`));
    return def ? pathOf(def[1]!, file, cwd, depth + 1) : null;
  }
  return null;
}

/** The folders the server serves files from, as its express.static, serveStatic and sirv calls name them. */
export function servedDirs(root: string, files: string[]): string[] {
  const dirs: string[] = [];
  for (const file of files) {
    const source = read(file);
    for (const m of source.matchAll(/\b(?:express\.static|serveStatic|sirv)\s*\(/g)) {
      const arg = firstArg(source, m.index! + m[0].length - 1);
      // A relative string is read from where the server starts: its package, or the repository above it.
      const dir = pathOf(arg, file, root);
      if (dir && !dirs.includes(dir)) dirs.push(dir);
    }
  }
  // The deepest folder last: "dist" before "dist/assets", so the site's root folder wins.
  return dirs.sort((a, b) => a.length - b.length);
}

/** The nearest folder at or above `dir` with a package.json, within `top`. */
function projectOf(dir: string, top: string): string | null {
  for (let d = dir; d.startsWith(top); d = dirname(d)) {
    if (existsSync(join(d, "package.json"))) return d;
    if (dirname(d) === d) break;
  }
  return null;
}

export type Client = {
  /** The frontend's project folder, whose sources hold its stylesheets and fonts. */
  root: string;
  /** Where files the site serves at its root are kept, and so where the page's fonts are written. */
  publicDir: string;
};

/**
 * The frontend the server serves. A build output (frontend/dist) belongs to
 * the project above it, whose public/ is copied into every build; a source
 * folder (public/) is served as it is.
 */
export function clientOf(root: string, served: string[]): Client | null {
  const top = dirname(resolve(root));
  for (const dir of served) {
    if (!dir.startsWith(top)) continue;
    const output = BUILD_OUTPUT.has(basename(dir)) || !existsSync(dir);
    const project = projectOf(output ? dirname(dir) : dir, top);
    if (!project) continue;
    if (!output) return { root: project, publicDir: dir };
    const pub = join(project, "public");
    return { root: project, publicDir: existsSync(pub) ? pub : dir };
  }
  // No express.static call to follow: the conventional places for a frontend.
  for (const candidate of ["public", "client", "frontend", "web", "../client", "../frontend", "../web"].map((c) => resolve(root, c))) {
    if (basename(candidate) === "public" && existsSync(join(candidate, "index.html"))) return { root, publicDir: candidate };
    if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "index.html"))) {
      const pub = join(candidate, "public");
      return { root: candidate, publicDir: existsSync(pub) ? pub : candidate };
    }
  }
  return null;
}

/** The server's entry file: package.json `main`, the file `start` runs, or a conventional name. */
export function entryOf(root: string): string | null {
  const pkg = readPackage(root);
  // Word by word, not one pattern: "node --watch -r dotenv/config src/index.js" names its file after the runner's options.
  const words = String(pkg?.scripts?.start ?? "").split(/\s+/);
  const runner = words.findIndex((w) => /^(?:node|tsx|ts-node|bun|nodemon)$/.test(w));
  const fromStart = runner < 0 ? undefined : words.slice(runner + 1).find((w) => /^[\w./-]+\.[cm]?[jt]s$/.test(w));
  for (const candidate of [pkg?.main, fromStart, ...SERVER_ENTRIES]) {
    if (typeof candidate === "string" && existsSync(join(root, candidate))) return join(root, candidate);
  }
  return null;
}

export type ModuleFormat = "cjs" | "esm" | "ts";

/** How the server's own files are written, so the sitemap module matches them. */
export function formatOf(root: string, entry: string): ModuleFormat {
  const ext = extname(entry);
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  if (ext === ".mjs") return "esm";
  if (ext === ".cjs") return "cjs";
  return readPackage(root)?.type === "module" ? "esm" : "cjs";
}

/** Where the sitemap module and its manifest go: beside the server's entry. */
export function nodePaths(root: string) {
  const entry = entryOf(root);
  const dir = entry ? dirname(entry) : root;
  const format = entry ? formatOf(root, entry) : readPackage(root)?.type === "module" ? "esm" : "cjs";
  const ext = format === "ts" ? ".ts" : entry && /\.[cm]js$/.test(entry) ? extname(entry) : ".js";
  return { entry, format, module: join(dir, `sitemap${ext}`), manifest: join(dir, "sitemap.manifest.json") };
}

export type NodeReport = BuildReport & { client: Client | null };

/** Builds the manifest for an Express-style server: no routes of its own, the theme of the frontend it serves. */
export async function buildNode(root: string, detected: NodeServer, options: { offline?: boolean } = {}): Promise<NodeReport> {
  const serverFiles = sourceFiles(root).filter((f) => !/[\\/](?:test|tests|__tests__)[\\/]/.test(f) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f));
  const client = clientOf(root, servedDirs(root, serverFiles));
  const paths = nodePaths(root);
  const from = client?.root ?? root;
  const publicDir = client?.publicDir ?? join(root, "public");
  const pages = [join(from, "index.html"), join(publicDir, "index.html")].filter((f, i, all) => all.indexOf(f) === i);
  const sourceDirs = ["src", "app", "styles", "css", "assets"].filter((d) => existsSync(join(from, d)));
  // A plain public/ folder is the site itself: its stylesheets are the site's.
  const publicRel = relative(from, publicDir);
  const dirs = client && !publicRel.startsWith("..") && !sourceDirs.includes(publicRel) && existsSync(join(publicDir, "index.html")) ? [...sourceDirs, publicRel || "."] : sourceDirs;

  const report = await writeManifest(
    root,
    {
      framework: detected.name.toLowerCase(),
      manifestPath: paths.manifest,
      routes: [],
      skipped: [],
      ...themeFacts(from, dirs, pages, publicDir),
      publicDir,
      name: findName(from, pages.map(read).join("\n")),
      icon: findIcon(from, undefined, publicDir),
      site: findSite([...serverFiles, ...(client ? sourceFiles(client.root, 2000) : [])]),
    },
    options,
  );
  return { ...report, client };
}
