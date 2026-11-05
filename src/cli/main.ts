import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { detect, readPackage } from "../build/detect.js";
import { buildFramework, configuredSite } from "../build/framework-build.js";
import { buildNext, usesCacheComponents, type BuildReport } from "../build/next-build.js";
import { buildNode, nodePaths, type ModuleFormat } from "../build/node-build.js";
import { findSite, sourceFiles } from "../build/project.js";
import { COMMAND, withBuildStep, withStaticStep } from "../build/scripts.js";
import { spaRoutes } from "../build/spa-routes.js";
import { crawl } from "../build/crawl.js";
import { buildStatic, writeSitemapFiles } from "../build/static.js";
import { trimSlashes } from "../entries.js";
import { changedSince, readSitemap, submit, validKey, type Sitemap } from "../indexnow.js";
import { existingRoutes, LABEL, nodeModuleSource, RIVALS, routePath, routeSource, STATIC_OUT, type ServerKind } from "./routes.js";
import { createUi, styleFor, type Style, type Ui } from "./ui.js";
const HELP = `
  maisongr-sitemap · one sitemap: XML for search engines, a designed page for people

  Set up
    maisongr-sitemap init               Detect the site and set the sitemap up
                                        Next.js, Astro, SvelteKit, Nuxt, Express, Vite, static sites
    maisongr-sitemap build              Re-read pages, dates and theme (init puts it in your build)

  Sites without a server, and other languages
    maisongr-sitemap static <dir> --site <url>
                                        Write sitemap.xml and the page at /sitemap/ into a built site
                                        --add /a,/b  more addresses     --clean-urls  /about, never /about.html
    maisongr-sitemap crawl <url> --out <dir> [--site <url>] [--max <pages>]
                                        Any site (PHP, Python, Ruby, a CMS), read as a search engine reads it

  After a deploy
    maisongr-sitemap indexnow --site <url> --key <key>
                                        Tell Bing and the other IndexNow engines which pages changed
                                        --since <YYYY-MM-DD>  --all  --dry-run  --wait [s]  --sitemap <file|url>

  Options
    --site <url>   the address the site is served at     --offline    don't download fonts
    --images       list each page's images               --no-credit  leave out the footer credit
    --no-color     plain text (also NO_COLOR=1)          --version    --help

  Docs: https://github.com/maison-gr/sitemap
`;

/** The package's own version, from the package.json beside dist/ (or src/). */
const version = () => JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Io = { out: (s: string) => void; err: (s: string) => void; style?: Style; errStyle?: Style };

/** A message for the person at the terminal; the command stops and exits with 1. */
class Exit extends Error {}

// Set by main() for the one command it runs.
let args: string[] = [];
let root = "";
let u: Ui;

const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const rel = (p: string) => relative(root, p).split("\\").join("/");
const fail = (s: string): never => {
  throw new Exit(s);
};

/** Each framework's own build, for a project whose package.json has no build script yet. */
const BUILD: Record<ServerKind["kind"], string> = { next: "next build", astro: "astro build", sveltekit: "vite build", nuxt: "nuxt build" };
/** Where each framework's dev server listens, for the closing hint. */
const DEV_PORT: Record<ServerKind["kind"], number> = { next: 3000, astro: 4321, sveltekit: 5173, nuxt: 3000 };

const REBUILT = "manifest.json could not be read (a merge conflict?), so it was rebuilt from the project";
const REBUILT_NOTE = "dates Git cannot see in this clone are left out";

/** `pages` is false for a server whose pages come from its code, not from files. */
function printReport(r: BuildReport, pages = true) {
  u.heading("Found");
  if (r.rebuilt) u.warn(REBUILT, REBUILT_NOTE);
  if (pages) u.ok(`${plural(r.routes, "page")} found`, `${r.dated} dated from Git`);
  if (r.locales) u.ok(`Languages: ${r.locales.list.join(", ")}`, `x-default: ${r.locales.default}`);
  if (r.site) u.ok(`Site: ${r.site}`);
  else u.warn("Site address not found", "the request's address is used: pass --site or set SITEMAP_SITE_URL");
  u.ok(`Theme: ${r.theme.name}`, `${r.theme.dark ? "light and dark" : "light only, as the site"} · fonts: ${r.theme.fonts.map((f) => `${f.family} (${f.role})`).join(", ") || "system"}`);
  if (r.missedFonts.length) u.warn(`Fonts not brought in: ${r.missedFonts.join(", ")}`, "system fonts are used instead");
  if (r.fromPages?.length) {
    u.ok(`${plural(r.fromPages.length, "dynamic route")} listed from their own static params`);
    u.list(r.fromPages.map((path) => ({ path })));
  }
  if (r.skipped.length) {
    u.heading("Left out", r.skipped.length);
    u.list(r.skipped.map((s) => ({ path: s.pattern, reason: s.reason })));
  }
  if (r.needParams.length) {
    u.heading("Needs values", r.needParams.length);
    u.warn(`${plural(r.needParams.length, "dynamic route")} not listed yet`, "give their values in the route file's params");
    u.list(r.needParams.map((path) => ({ path })));
  }
}

/** Rewrites package.json's scripts, keeping its indentation. */
function editScripts(change: (scripts: Record<string, string> | undefined) => { scripts: Record<string, string>; note: string }): string {
  const file = join(root, "package.json");
  const pkg = readPackage(root) ?? fail("No package.json here.");
  const { scripts, note } = change(pkg.scripts);
  pkg.scripts = scripts;
  const indent = readFileSync(file, "utf8").match(/^\{\r?\n([ \t]+)/)?.[1] ?? "  ";
  writeFileSync(file, JSON.stringify(pkg, null, indent) + "\n");
  return note;
}

const dependsOn = (name: string) => {
  const pkg = readPackage(root);
  return !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name]);
};

/** Stops before anything is written if another file or package already answers /sitemap.xml. */
function refuseClashes(fw: ServerKind, publicDir: string) {
  for (const f of existingRoutes(fw)) {
    if (existsSync(join(root, f)) && !readFileSync(join(root, f), "utf8").includes("maisongr-sitemap")) {
      fail(`${f.split("\\").join("/")} already serves /sitemap.xml and is not this package's. Move it aside first; nothing was changed.`);
    }
  }
  if (existsSync(join(root, publicDir, "sitemap.xml"))) fail(`${publicDir}/sitemap.xml would shadow the route. Remove it first; this replaces it.`);
  for (const rival of RIVALS[fw.kind].filter(dependsOn)) {
    fail(
      rival === "next-sitemap"
        ? "next-sitemap writes public/sitemap.xml after each build, which would shadow this route.\n" +
            "Remove it and its postbuild script first. Keep a robots.txt that names /sitemap.xml (app/robots.ts or public/robots.txt)."
        : `${rival} serves a sitemap of its own. Remove it first, so search engines are given one sitemap, and point robots.txt at /sitemap.xml.`,
    );
  }
}

/**
 * Whether robots.txt names the sitemap, which is how crawlers that never read
 * Search Console find it. It only says what to add; it changes nothing.
 */
function robotsHint(fw: ServerKind, publicDir: string, site: string | undefined) {
  const line = `Sitemap: ${site ?? "https://your.site"}/sitemap.xml`;
  const appDir = fw.kind === "next" ? (fw.appDir ?? (fw.srcDir ? "src/app" : "app")) : undefined;
  const generated = appDir ? ["robots.ts", "robots.js"].map((n) => join(root, appDir, n)).find(existsSync) : undefined;
  const file = generated ?? [join(root, publicDir, "robots.txt")].find(existsSync);
  if (!file) return u.warn(`No robots.txt names the sitemap. Add one with: ${u.code(`"${line}"`)}`);
  if (!/sitemap/i.test(readFileSync(file, "utf8"))) u.warn(`${rel(file)} does not name the sitemap. Add ${u.code(`"${line}"`)}${generated ? " (the `sitemap` field)" : ""}.`);
}

/** A site that answers requests: the route tells browsers from crawlers at /sitemap.xml. */
async function initServer(fw: ServerKind) {
  const publicDir = fw.kind === "sveltekit" ? "static" : "public";
  refuseClashes(fw, publicDir);
  const route = join(root, routePath(fw, existsSync(join(root, "tsconfig.json"))));

  const routers = fw.kind === "next" ? [fw.appDir && "App Router", fw.pagesDir && "Pages Router"].filter(Boolean).join(" + ") : "";
  u.subject(`${LABEL[fw.kind]} ${fw.version ?? ""}${routers ? ` · ${routers}` : ""}`);
  const given = value("site");
  if (given && !/^https?:\/\//.test(given)) fail("--site takes the full address: --site https://your.site");
  const report = fw.kind === "next" ? await buildNext(root, fw, { offline: flag("offline") }) : await buildFramework(root, fw, { offline: flag("offline") });
  printReport(given ? { ...report, site: trimSlashes(given) } : report);

  // "wx" creates the route only if it isn't there, in one step: no gap between checking and writing.
  mkdirSync(dirname(route), { recursive: true });
  // --site goes in the route itself, so every later build keeps it.
  const source = routeSource(fw, route.endsWith(".ts"), { cacheComponents: fw.kind === "next" && usesCacheComponents(root) });
  try {
    writeFileSync(route, given ? source.replace("  manifest,\n", `  manifest,\n  site: ${JSON.stringify(trimSlashes(given))},\n`) : source, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  u.heading("Wrote");
  u.ok(rel(route));
  u.ok(rel(report.manifestPath), "commit it: shallow CI clones keep its dates");
  if (report.theme.fonts.length) u.ok(`${publicDir}/_sitemap/`, "the page's fonts, served from your own domain");
  u.ok("package.json", editScripts((s) => withBuildStep(s, BUILD[fw.kind])));

  u.heading("Next");
  if (!dependsOn("maisongr-sitemap")) u.next(u.code("npm install maisongr-sitemap"));
  robotsHint(fw, publicDir, given ? trimSlashes(given) : report.site);
  if (fw.kind === "next" && ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js", "src/middleware.ts", "src/proxy.ts"].some((f) => existsSync(join(root, f)))) {
    u.warn("Your middleware must let /sitemap.xml and /_sitemap/ through untouched", "no locale redirect");
  }
  u.next(`Open ${u.code(`http://localhost:${DEV_PORT[fw.kind]}/sitemap.xml`)}`, "a browser gets the page; curl gets the XML");
}

/** A site built to files: no server to tell browsers from crawlers, so static mode runs after each build. */
function initStatic(fw: Extract<ServerKind, { kind: "astro" | "sveltekit" | "nuxt" }>) {
  const out = STATIC_OUT[fw.kind];
  const site = value("site") ?? configuredSite(root, fw.kind);
  const why = { astro: "it has no adapter", sveltekit: "it uses adapter-static", nuxt: "it is built with nuxt generate" }[fw.kind];
  if (!site || !/^https?:\/\//.test(site)) {
    fail(`${LABEL[fw.kind]} builds to static files here (${why}). Static mode writes the sitemap into ./${out} after each build.\nGive the address the site is served at:\n  maisongr-sitemap init --site https://your.site`);
  }
  refuseClashes(fw, fw.kind === "sveltekit" ? "static" : "public");
  u.subject(`${LABEL[fw.kind]} ${fw.version ?? ""} · static build (${why})`);
  u.heading("Wrote");
  u.ok("package.json", editScripts((s) => withStaticStep(s, out, trimSlashes(site!), BUILD[fw.kind])));
  u.text(`After each build: ./${out}/sitemap.xml for search engines, and the designed page at /sitemap/ for people.`);
  u.heading("Next");
  if (!dependsOn("maisongr-sitemap")) u.next(u.code("npm install --save-dev maisongr-sitemap"));
  robotsHint(fw, fw.kind === "sveltekit" ? "static" : "public", trimSlashes(site!));
  u.next("For the designed page at /sitemap.xml itself, add a server adapter and run init again");
}

/** The line that mounts the sitemap module, written as the server's own files import. */
function mountLine(entry: string | null, module: string, format: ModuleFormat) {
  const from = `./${relative(entry ? dirname(entry) : root, module).split("\\").join("/").replace(/\.ts$/, ".js")}`;
  return format === "cjs" ? `app.get("/sitemap.xml", require("${from}"));` : `import { sitemap } from "${from}";  app.get("/sitemap.xml", sitemap);`;
}

/** Server files, other than this package's module, that already answer /sitemap.xml. */
function ownSitemapRoutes(module: string): string[] {
  return sourceFiles(root)
    .filter((f) => f !== module && !/[\\/](test|tests|__tests__)[\\/]|\.(test|spec)\./.test(f))
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return /\.(?:get|use|all)\s*\(\s*["'`]\/sitemap[\w-]*\.xml/.test(src) && !src.includes("maisongr-sitemap");
    });
}

/** An Express-style server: its routes live in code, its look in the frontend it serves. */
async function initNode(found: Extract<ReturnType<typeof detect>, { kind: "node" }>) {
  const paths = nodePaths(root);
  u.subject(`${found.name} server${paths.entry ? ` · ${rel(paths.entry)}` : ""}`);
  const report = await buildNode(root, found, { offline: flag("offline") });
  printReport(report, false);
  if (report.client) u.ok(`Frontend: ${rel(report.client.root) || "."}`, `fonts go to ${rel(report.client.publicDir)}/_sitemap/`);
  else u.warn("Frontend: none found", "the page uses a neutral theme: pass `theme` to set colours and fonts");

  u.heading("Wrote");
  try {
    writeFileSync(paths.module, nodeModuleSource(paths.format, mountLine(paths.entry, paths.module, paths.format)), { flag: "wx" });
    u.ok(rel(paths.module), "list your pages in its entries()");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    u.ok(rel(paths.module), "kept: already there");
  }
  u.ok(rel(report.manifestPath), "commit it");
  if (report.theme.fonts.length && report.client) u.ok(`${rel(report.client.publicDir)}/_sitemap/`, "the page's fonts, served from your own domain: commit them");
  u.ok("package.json", editScripts((s) => (s?.build ? withBuildStep(s) : { scripts: { ...s, build: COMMAND }, note: `"build" script added: run it when the frontend's design changes` })));

  u.heading("Next");
  if (!dependsOn("maisongr-sitemap")) u.next(u.code("npm install maisongr-sitemap"));
  u.next(`Mount it: ${u.code(mountLine(paths.entry, paths.module, paths.format))}`, `before any catch-all route (a single-page app's "*")`);
  for (const f of ownSitemapRoutes(paths.module)) u.warn(`${rel(f)} already answers a /sitemap…xml route`, "remove it, so there is one sitemap");
  u.next(`Check that robots.txt names ${report.site ?? "https://your.site"}/sitemap.xml`);
  u.next(`Open ${u.code("/sitemap.xml")}`, "a browser gets the page; curl gets the XML");
}

/** A single-page app: one index.html, its pages in the router's table, so static mode runs after each build and reads that table. */
function initSpa(found: Extract<ReturnType<typeof detect>, { kind: "spa" }>) {
  const site = value("site") ?? findSite(sourceFiles(root));
  if (!site || !/^https?:\/\//.test(site)) {
    fail(`${found.name} single-page app. Static mode writes the sitemap into ./${found.outDir} after each build.\nGive the address the site is served at:\n  maisongr-sitemap init --site https://your.site`);
  }
  if (existsSync(join(root, "public", "sitemap.xml"))) fail("public/sitemap.xml would be overwritten by this one. Remove it first; this replaces it.");
  u.subject(`${found.name} · single-page app, built to ./${found.outDir}`);
  const routes = spaRoutes(root);
  u.heading("Found");
  u.ok(`Site: ${trimSlashes(site!)}`);
  if (routes) u.ok(`${plural(routes.paths.length, "page")} found`, `in the ${routes.router} routes`);
  else u.warn("No client-side router found: only the home page is listed", "add others with --add in the build script");
  if (routes?.skipped.length) {
    u.heading("Left out", routes.skipped.length);
    u.list(routes.skipped);
  }
  u.heading("Wrote");
  u.ok("package.json", editScripts((s) => withStaticStep(s, found.outDir, trimSlashes(site!), "vite build")));
  u.text(`After each build: ./${found.outDir}/sitemap.xml for search engines, and the designed page at /sitemap/ for people.`);
  u.heading("Next");
  if (!dependsOn("maisongr-sitemap")) u.next(u.code("npm install --save-dev maisongr-sitemap"));
  const robots = join(root, "public", "robots.txt");
  if (!existsSync(robots) || !/sitemap/i.test(readFileSync(robots, "utf8"))) u.warn(`public/robots.txt does not name the sitemap. Add ${u.code(`"Sitemap: ${trimSlashes(site!)}/sitemap.xml"`)}`);
  u.next("Check that your host serves index.html for unknown paths", "the usual single-page app setting, so every listed page answers");
}

async function init() {
  const found = detect(root);
  if (found.kind === "unsupported") {
    fail(`${found.name} detected. Its adapter is not out yet; until then, build the site and run:\n  maisongr-sitemap static <build-dir> --site https://your.site`);
  }
  if (found.kind === "node") return initNode(found);
  if (found.kind === "spa") return initSpa(found);
  if (found.kind === "static") {
    const site = value("site");
    const pkg = readPackage(root);
    // A generator with a build script (Eleventy, Hugo through npm…): the sitemap is written after each build.
    if (pkg?.scripts?.build && site && /^https?:\/\//.test(site) && found.outDir !== ".") {
      u.subject(`Static site, built to ./${found.outDir}`);
      u.heading("Wrote");
      u.ok("package.json", editScripts((s) => withStaticStep(s, found.outDir, trimSlashes(site), "npm run build")));
      u.text(`After each build: ./${found.outDir}/sitemap.xml, and the designed page at /sitemap/.`);
      if (!dependsOn("maisongr-sitemap")) {
        u.heading("Next");
        u.next(u.code("npm install --save-dev maisongr-sitemap"));
      }
      return;
    }
    fail(
      `A static site in ./${found.outDir}. Run:\n  maisongr-sitemap static ${found.outDir} --site https://your.site` +
        (pkg?.scripts?.build ? `\nOr add --site https://your.site to init, to run it after every build.` : ""),
    );
  }
  if (found.kind === "unknown") {
    fail(
      "No site found in this folder.\n" +
        "init reads Next.js, Astro, SvelteKit, Nuxt, Express, Vite and Create React App projects, and static sites with an index.html.\n" +
        "Run it from your project's folder, or, for a site in another language (PHP, Python, Ruby…):\n" +
        "  maisongr-sitemap crawl http://localhost:8000 --out public --site https://your.site",
    );
  }
  const fw = found as ServerKind;
  if (fw.kind !== "next" && !fw.server) return initStatic(fw);
  return initServer(fw);
}

async function build() {
  const found = detect(root);
  if (found.kind === "node") {
    if (!existsSync(nodePaths(root).manifest)) fail("No sitemap set up here yet. Run `maisongr-sitemap init` first.");
    const report = await buildNode(root, found, { offline: flag("offline") });
    u.ok(`maisongr-sitemap: theme from ${report.client ? rel(report.client.root) || "." : "nothing (neutral)"}`, `→ ${rel(report.manifestPath)}`);
    return;
  }
  if (found.kind !== "next" && found.kind !== "astro" && found.kind !== "sveltekit" && found.kind !== "nuxt") {
    fail("`build` reads Next.js, Astro, SvelteKit, Nuxt and Express projects. For a static site use `maisongr-sitemap static <dir> --site <url>`.");
  }
  const fw = found as ServerKind;
  if (fw.kind !== "next" && !fw.server) {
    u.ok(`maisongr-sitemap: ${LABEL[fw.kind]} builds static files here`, "the sitemap is written after the build by `maisongr-sitemap static`");
    return;
  }
  const route = existingRoutes(fw).find((f) => existsSync(join(root, f)));
  if (!route) fail("No sitemap route yet. Run `maisongr-sitemap init` first.");
  if (fw.kind === "next" && usesCacheComponents(root) && /export\s+const\s+dynamic\b/.test(readFileSync(join(root, route!), "utf8"))) {
    u.warn(`maisongr-sitemap: cacheComponents is on, and it refuses the \`dynamic\` export in ${route!.split("\\").join("/")}.`, "remove that line: the route stays dynamic without it");
  }
  const report = fw.kind === "next" ? await buildNext(root, fw, { offline: flag("offline") }) : await buildFramework(root, fw, { offline: flag("offline") });
  if (report.rebuilt) u.warn(`maisongr-sitemap: ${REBUILT}`, REBUILT_NOTE);
  u.ok(`maisongr-sitemap: ${plural(report.routes, "page")}, ${report.dated} dated`, `→ ${rel(report.manifestPath)}`);
  if (report.needParams.length) u.warn(`${plural(report.needParams.length, "dynamic route")} not listed yet: ${report.needParams.join(", ")}`, "give their values in params");
}

function runStatic() {
  const dir = args[1];
  const site = value("site") ?? process.env.SITEMAP_SITE_URL;
  if (!dir || !existsSync(join(root, dir))) fail("Usage: maisongr-sitemap static <build-dir> --site https://your.site");
  if (!site || !/^https?:\/\//.test(site)) fail("Give the address the site is served at: --site https://your.site");
  // A single-page app's pages are in its router's table, not in the build output.
  const routes = spaRoutes(root);
  const added = (value("add") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const report = buildStatic(join(root, dir!), site!, { credit: !flag("no-credit"), images: flag("images"), cleanUrls: flag("clean-urls"), extra: [...(routes?.paths ?? []), ...added] });
  u.heading("Found");
  u.ok(`${plural(report.pages, "page")}`, routes ? `${routes.router} routes included` : undefined);
  u.ok(`Theme: ${report.theme.name}`, `${report.theme.dark ? "light and dark" : "light only, as the site"} · fonts: ${report.theme.fonts.map((f) => f.family).join(", ") || "system"}`);
  const skipped = [...report.skipped, ...(routes?.skipped ?? [])];
  if (skipped.length) {
    u.heading("Left out", skipped.length);
    u.list(skipped);
  }
  u.heading("Wrote");
  for (const f of report.written) u.ok(`${dir}/${f}`);
  u.text(u.paint("A static host can't tell browsers from crawlers: people get the page at /sitemap/, and /sitemap.xml is styled with CSS.", "dim"));
}

/** Any site at all (PHP, Python, Ruby, a CMS): read it as a search engine would, and write the sitemap files where its server serves files. */
async function runCrawl() {
  const start = args[1];
  const out = value("out");
  const site = value("site");
  if (!start || !/^https?:\/\//.test(start) || !out) fail("Usage: maisongr-sitemap crawl <url> --out <public dir> [--site https://your.site]");
  if (site && !/^https?:\/\//.test(site)) fail("--site takes the full address: --site https://your.site");
  if (!existsSync(join(root, out!))) fail(`${out} does not exist. Give the folder your server serves files from (public/, the web root…).`);
  const max = value("max") ? Number(value("max")) : undefined;
  if (max !== undefined && !(max > 0)) fail("--max takes a number of pages: --max 5000");
  u.subject(`Reading ${start}`);
  const report = await crawl(start!, { site, max, images: flag("images"), onPage: (listed, seen) => u.progress(`Reading… ${plural(listed, "page")} listed, ${seen} addresses seen`) });
  u.endProgress();
  if (!report.entries.length) fail(`No page could be listed from ${start}.\nIs the site running, and is its home page public? Open it in a browser to check.`);
  const written = writeSitemapFiles(join(root, out!), report.entries, report.theme, !flag("no-credit"));
  const dated = report.entries.filter((e) => e.lastmod).length;
  u.heading("Found");
  u.ok(plural(report.entries.length, "page"), `${dated} with a date the page states`);
  u.ok(`Theme: ${report.theme.name}`, `${report.theme.dark ? "light and dark" : "light only, as the site"} · fonts: ${report.theme.fonts.map((f) => f.family).join(", ") || "system"}`);
  if (report.capped) u.warn(`Stopped at ${plural(max ?? 10_000, "page")}`, "raise --max to read further");
  if (report.skipped.length) {
    u.heading("Left out", report.skipped.length);
    u.list(report.skipped);
  }
  if (report.queries) u.text(u.paint(`Not followed: ${report.queries} address${report.queries === 1 ? "" : "es"} with a query string (?…), which search engines treat as copies.`, "dim"));
  u.heading("Wrote");
  for (const f of written) u.ok(`${out}/${f}`);
  u.heading("Next");
  u.next("Run it again after content changes", "a deploy step or a daily cron, so the list stays current");
  u.next(`Open ${u.code(`${site ? trimSlashes(site) : new URL(start!).origin}/sitemap/`)}`, "the page; /sitemap.xml is styled with CSS for browsers that open it");
}

/** Reads a sitemap from a built file or the live site, following an index into its parts, as a crawler would. */
async function sitemapUrls(source: string): Promise<Sitemap["urls"]> {
  const read = async (where: string) => {
    if (!/^https?:\/\//.test(where)) return readSitemap(readFileSync(join(root, where), "utf8"));
    const res = await fetch(where);
    if (!res.ok) fail(`${where} answered ${res.status}. Deploy first, or pass --sitemap <file>.`);
    return readSitemap(await res.text());
  };
  const first = await read(source);
  const parts = await Promise.all(first.parts.map(read));
  return [...first.urls, ...parts.flatMap((p) => p.urls)];
}

async function runIndexNow() {
  const given = value("site") ?? process.env.SITEMAP_SITE_URL;
  const site = given === undefined ? undefined : trimSlashes(given);
  const key = value("key") ?? process.env.INDEXNOW_KEY;
  if (!site || !/^https?:\/\//.test(site)) fail("Give the address the site is served at: --site https://your.site");
  if (!key || !validKey(key)) fail("Give your IndexNow key: --key <8 to 128 letters, digits or dashes> (or set INDEXNOW_KEY).");

  // The engines fetch the key from the site to prove the submission is the owner's.
  const keyFile = `${site}/${key}.txt`;
  const servesKey = () => fetch(keyFile).then((r) => (r.ok ? r.text() : ""), () => "").then((t) => t.trim() === key);
  // --wait: right after a deploy, the new version (and its key file) may not be live yet.
  const waitFor = flag("wait") ? Number(value("wait")) || 180 : 0;
  const deadline = Date.now() + waitFor * 1000;
  u.subject(`IndexNow · ${site}`);
  let served = await servesKey();
  while (!served && Date.now() < deadline) {
    const left = `${Math.round((deadline - Date.now()) / 1000)}s left`;
    if (u.live) u.progress(`Waiting for ${keyFile}… ${left}`);
    else u.text(`Waiting for ${keyFile}… ${left}`);
    await new Promise((r) => setTimeout(r, Math.min(10_000, Math.max(0, deadline - Date.now()))));
    served = await servesKey();
  }
  u.endProgress();
  if (!served) {
    fail(
      `${keyFile} does not serve the key.\n` +
        `Put a file named ${key}.txt, containing only the key, in your public directory, deploy, and run this again${waitFor ? "." : ", or add --wait to wait for a deploy."}`,
    );
  }
  u.heading("Found");
  u.ok(`The site serves its key`, keyFile);

  const since = flag("all") ? undefined : value("since") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail("--since takes a date.\n  maisongr-sitemap indexnow --since 2026-11-01");
  const urls = changedSince(await sitemapUrls(value("sitemap") ?? `${site}/sitemap.xml`), since);
  if (!urls.length) {
    u.ok(`No page ${since ? `changed since ${since}` : "in the sitemap"}`, since ? "pages without a lastmod are sent only with --all" : undefined);
    return;
  }
  u.ok(`${plural(urls.length, "page")} ${since ? `changed since ${since}` : "in the sitemap"}`);

  if (flag("dry-run")) {
    u.heading("Would send", urls.length);
    u.list(urls.slice(0, 20).map((path) => ({ path })));
    if (urls.length > 20) u.text(u.paint(`… and ${urls.length - 20} more`, "dim"));
    u.warn("Dry run: nothing was sent", "run it without --dry-run to send");
    return;
  }
  const results = await submit({ site: site!, key: key!, urls });
  u.heading("Sent");
  for (const r of results) {
    const text = `Batch ${r.batch}: ${plural(r.urls, "page")}`;
    if (r.status < 300) u.ok(text, `${r.status} ${r.meaning}`);
    else u.warn(text, `${r.status} ${r.meaning}`);
  }
  if (results.some((r) => r.status === 403)) {
    u.next(`Add ${site}/ in Bing Webmaster Tools, with its own verification`, "a 403 means the engine has not verified the site; an import from Search Console is not always enough");
  }
  if (results.some((r) => r.status >= 300)) fail("IndexNow did not accept every batch.\nThe reason for each is above.");
}

/** Runs one command in `cwd` and returns the exit code. */
export async function main(
  argv: string[],
  cwd: string,
  streams: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), style: styleFor(process.stdout), errStyle: styleFor(process.stderr) },
): Promise<number> {
  args = argv;
  root = cwd;
  const plain: Style = { color: false, unicode: true };
  const noColor = args.includes("--no-color");
  const style = noColor ? { ...(streams.style ?? plain), color: false } : (streams.style ?? plain);
  u = createUi(streams.out, style);
  const started = Date.now();
  const command = args[0];
  try {
    if (command === "--version" || command === "-v") u.line(version());
    else if (command === undefined || command === "help" || command === "--help" || command === "-h") u.line(HELP);
    else if (COMMANDS[command]) {
      // build runs inside every build and CI log: its one or two lines stand alone.
      if (command !== "build") u.title(version(), command);
      await COMMANDS[command]!();
      if (command !== "build") u.done(Date.now() - started);
    } else {
      const near = Object.keys(COMMANDS).find((c) => distance(c, command) <= 2);
      fail(`Unknown command "${command}".${near ? `\nDid you mean ${near}?\n  maisongr-sitemap ${near}` : ""}\nmaisongr-sitemap --help lists them all.`);
    }
    return 0;
  } catch (error) {
    u.endProgress();
    if (!(error instanceof Exit)) {
      // A bug, not a mistake the person made: say so, with what to report.
      createUi(streams.err, noColor ? { ...(streams.errStyle ?? plain), color: false } : (streams.errStyle ?? plain)).error(
        `maisongr-sitemap stopped on an unexpected error: ${(error as Error).message}\n` +
          `Nothing past this point was written. Please report it, with the command you ran:\n  https://github.com/maison-gr/sitemap/issues`,
      );
      if (process.env.DEBUG) throw error;
      return 2;
    }
    createUi(streams.err, noColor ? { ...(streams.errStyle ?? plain), color: false } : (streams.errStyle ?? plain)).error(error.message);
    return 1;
  }
}

const COMMANDS: Record<string, () => unknown> = { init, build, static: runStatic, crawl: runCrawl, indexnow: runIndexNow };

/** How many letters apart two words are, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length]!;
}
