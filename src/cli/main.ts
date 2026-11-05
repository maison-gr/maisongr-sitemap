import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { detect, readPackage } from "../build/detect.js";
import { buildFramework, configuredSite } from "../build/framework-build.js";
import { buildNext, usesCacheComponents, type BuildReport } from "../build/next-build.js";
import { withBuildStep, withStaticStep } from "../build/scripts.js";
import { buildStatic } from "../build/static.js";
import { trimSlashes } from "../entries.js";
import { changedSince, readSitemap, submit, validKey, type Sitemap } from "../indexnow.js";
import { existingRoutes, LABEL, RIVALS, routePath, routeSource, STATIC_OUT, type ServerKind } from "./routes.js";
const HELP = `maisongr-sitemap

  maisongr-sitemap init              Detect the framework (Next.js, Astro, SvelteKit, Nuxt) and set the sitemap up
  maisongr-sitemap build             Re-read routes, dates and theme (run before each build)
  maisongr-sitemap static <dir> --site <url>
                                     For sites with no server: write sitemap.xml and /sitemap/ into <dir>
  maisongr-sitemap indexnow --site <url> --key <key>
                                     Tell Bing and the other IndexNow engines which pages changed (after a deploy)
                                     --since <YYYY-MM-DD> (default: yesterday)  --all  --dry-run  --sitemap <file or url>
                                     --wait [seconds]  wait for a deploy to serve the key first (default 180)

  Options:  --offline   do not download fonts      --no-credit   (static) leave out the footer credit
            --site      the address the site is served at (init, for a static build)
            --images    (static) list each page's <img> and og:image in an image sitemap
            --version   print the version          --help        print this
`;

/** The package's own version, from the package.json beside dist/ (or src/). */
const version = () => JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Io = { out: (s: string) => void; err: (s: string) => void };

/** A message for the person at the terminal; the command stops and exits with 1. */
class Exit extends Error {}

// Set by main() for the one command it runs.
let args: string[] = [];
let root = "";
let io: Io;

const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const rel = (p: string) => relative(root, p).split("\\").join("/");
const say = (s = "") => io.out(`${s}\n`);
const fail = (s: string): never => {
  throw new Exit(s);
};

/** Each framework's own build, for a project whose package.json has no build script yet. */
const BUILD: Record<ServerKind["kind"], string> = { next: "next build", astro: "astro build", sveltekit: "vite build", nuxt: "nuxt build" };
/** Where each framework's dev server listens, for the closing hint. */
const DEV_PORT: Record<ServerKind["kind"], number> = { next: 3000, astro: 4321, sveltekit: 5173, nuxt: 3000 };

const REBUILT = "manifest.json could not be read (a merge conflict?), so it was rebuilt from the project. Dates Git cannot see in this clone are left out.";

function printReport(r: BuildReport) {
  if (r.rebuilt) say(`  Note: ${REBUILT}`);
  say(`  ${plural(r.routes, "page")} found, ${r.dated} dated from Git`);
  if (r.locales) say(`  Languages: ${r.locales.list.join(", ")} (x-default: ${r.locales.default})`);
  say(`  Site: ${r.site ?? "not found; the request's address is used (set SITEMAP_SITE_URL or pass site)"}`);
  say(`  Theme: ${r.theme.name} · ${r.theme.dark ? "light and dark" : "light only, as the site"} · fonts: ${r.theme.fonts.map((f) => `${f.family} (${f.role})`).join(", ") || "system"}`);
  if (r.missedFonts.length) say(`  Fonts not brought in (system fonts used instead): ${r.missedFonts.join(", ")}`);
  if (r.skipped.length) {
    say(`  Left out:`);
    for (const s of r.skipped) say(`    ${s.pattern}  ${s.reason}`);
  }
  if (r.fromPages?.length) {
    say(`  Dynamic routes listed from their own generateStaticParams:`);
    for (const p of r.fromPages) say(`    ${p}`);
  }
  if (r.needParams.length) {
    say(`  Dynamic routes, listed only once the route file gives their values (params):`);
    for (const p of r.needParams) say(`    ${p}`);
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
  if (!file) return say(`  Add:   a robots.txt that names the sitemap: "${line}"`);
  if (!/sitemap/i.test(readFileSync(file, "utf8"))) say(`  Add:   ${rel(file)} does not name the sitemap. Add "${line}"${generated ? " (the `sitemap` field)" : ""}.`);
}

/** A site that answers requests: the route tells browsers from crawlers at /sitemap.xml. */
async function initServer(fw: ServerKind) {
  const publicDir = fw.kind === "sveltekit" ? "static" : "public";
  refuseClashes(fw, publicDir);
  const route = join(root, routePath(fw, existsSync(join(root, "tsconfig.json"))));

  say(`\n${LABEL[fw.kind]} ${fw.version ?? ""}${fw.kind === "next" ? ` · App Router${fw.pagesDir ? " + Pages Router" : ""}` : ""}`);
  const report = fw.kind === "next" ? await buildNext(root, fw, { offline: flag("offline") }) : await buildFramework(root, fw, { offline: flag("offline") });
  printReport(report);

  // "wx" creates the route only if it isn't there, in one step: no gap between checking and writing.
  mkdirSync(dirname(route), { recursive: true });
  try {
    writeFileSync(route, routeSource(fw, route.endsWith(".ts"), { cacheComponents: fw.kind === "next" && usesCacheComponents(root) }), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  say(`\n  Wrote  ${rel(route)}`);
  say(`  Wrote  ${rel(report.manifestPath)}  (commit it: shallow CI clones keep its dates)`);
  if (report.theme.fonts.length) say(`  Wrote  ${publicDir}/_sitemap/  (the page's fonts, served from your own domain)`);
  say(`  Build  ${editScripts((s) => withBuildStep(s, BUILD[fw.kind]))}`);

  say();
  if (!dependsOn("maisongr-sitemap")) say(`  Next:  npm install maisongr-sitemap`);
  robotsHint(fw, publicDir, report.site);
  if (fw.kind === "next" && ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js", "src/middleware.ts", "src/proxy.ts"].some((f) => existsSync(join(root, f)))) {
    say(`  Check: your middleware must let /sitemap.xml and /_sitemap/ through untouched (no locale redirect).`);
  }
  say(`  Open http://localhost:${DEV_PORT[fw.kind]}/sitemap.xml in a browser: the page. curl it: the XML.\n`);
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
  say(`\n${LABEL[fw.kind]} ${fw.version ?? ""} · static build (${why})`);
  say(`  Build  ${editScripts((s) => withStaticStep(s, out, trimSlashes(site!), BUILD[fw.kind]))}`);
  say(`\n  After each build: ./${out}/sitemap.xml for search engines (styled with CSS), and the designed page at /sitemap/ for people.`);
  if (!dependsOn("maisongr-sitemap")) say(`  Next:  npm install --save-dev maisongr-sitemap`);
  robotsHint(fw, fw.kind === "sveltekit" ? "static" : "public", trimSlashes(site!));
  say(`  For the designed page at /sitemap.xml itself, add a server adapter and run init again.\n`);
}

async function init() {
  const found = detect(root);
  if (found.kind === "unsupported") {
    fail(`${found.name} detected. Its adapter is not out yet; until then, build the site and run:\n  maisongr-sitemap static <build-dir> --site https://your.site`);
  }
  if (found.kind === "node") {
    fail(
      `${found.name} detected. Its routes live in code, so there is nothing to scan: serve the sitemap with the addresses you have.\n\n` +
        `  import { sitemap } from "maisongr-sitemap/node";\n\n` +
        `  app.get("/sitemap.xml", sitemap({\n    site: "https://your.site",\n    entries: async () => [{ loc: "/" }, { loc: "/pricing", lastmod: "2026-11-04" }],\n  }));`,
    );
  }
  if (found.kind === "static") {
    fail(`A static site in ./${found.outDir}. Run:\n  maisongr-sitemap static ${found.outDir} --site https://your.site`);
  }
  if (found.kind === "unknown") fail("No supported framework found here (Next.js, Astro, SvelteKit, Nuxt, Express, or a static build with index.html).");
  const fw = found as ServerKind;
  if (fw.kind !== "next" && !fw.server) return initStatic(fw);
  return initServer(fw);
}

async function build() {
  const found = detect(root);
  if (found.kind !== "next" && found.kind !== "astro" && found.kind !== "sveltekit" && found.kind !== "nuxt") {
    fail("`build` reads Next.js, Astro, SvelteKit and Nuxt projects. For a static site use `maisongr-sitemap static <dir> --site <url>`.");
  }
  const fw = found as ServerKind;
  if (fw.kind !== "next" && !fw.server) {
    say(`maisongr-sitemap: ${LABEL[fw.kind]} builds static files here; the sitemap is written after the build by \`maisongr-sitemap static\`.`);
    return;
  }
  const route = existingRoutes(fw).find((f) => existsSync(join(root, f)));
  if (!route) fail("No sitemap route yet. Run `maisongr-sitemap init` first.");
  if (fw.kind === "next" && usesCacheComponents(root) && /export\s+const\s+dynamic\b/.test(readFileSync(join(root, route!), "utf8"))) {
    say(`maisongr-sitemap: cacheComponents is on, and it refuses the \`dynamic\` export in ${route!.split("\\").join("/")}. Remove that line: the route stays dynamic without it.`);
  }
  const report = fw.kind === "next" ? await buildNext(root, fw, { offline: flag("offline") }) : await buildFramework(root, fw, { offline: flag("offline") });
  if (report.rebuilt) say(`maisongr-sitemap: ${REBUILT}`);
  say(`maisongr-sitemap: ${plural(report.routes, "page")}, ${report.dated} dated → ${rel(report.manifestPath)}`);
}

function runStatic() {
  const dir = args[1];
  const site = value("site") ?? process.env.SITEMAP_SITE_URL;
  if (!dir || !existsSync(join(root, dir))) fail("Usage: maisongr-sitemap static <build-dir> --site https://your.site");
  if (!site || !/^https?:\/\//.test(site)) fail("Give the address the site is served at: --site https://your.site");
  const report = buildStatic(join(root, dir!), site!, { credit: !flag("no-credit"), images: flag("images") });
  say(`\n  ${plural(report.pages, "page")} · theme: ${report.theme.name}${report.theme.dark ? " (light and dark)" : ""}`);
  for (const s of report.skipped) say(`  Left out ${s.path}  ${s.reason}`);
  for (const f of report.written) say(`  Wrote ${dir}/${f}`);
  say(`\n  A static host cannot tell browsers from crawlers, so the designed page lives at /sitemap/ and /sitemap.xml is styled with CSS.\n`);
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
  let served = await servesKey();
  while (!served && Date.now() < deadline) {
    say(`  Waiting for ${keyFile}… (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    await new Promise((r) => setTimeout(r, Math.min(10_000, Math.max(0, deadline - Date.now()))));
    served = await servesKey();
  }
  if (!served) {
    fail(`${keyFile} does not serve the key. Put a file named ${key}.txt, containing only the key, in your public directory, deploy, and run this again${waitFor ? "" : " (or add --wait to wait for a deploy)"}.`);
  }

  const since = flag("all") ? undefined : value("since") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail("--since takes a date: --since 2026-11-01");
  const urls = changedSince(await sitemapUrls(value("sitemap") ?? `${site}/sitemap.xml`), since);
  say(`\n  ${plural(urls.length, "page")} ${since ? `changed since ${since}` : "in the sitemap"}`);
  if (!urls.length) return say(`  Nothing to send.${since ? " Pages without a lastmod are sent only with --all." : ""}\n`);

  if (flag("dry-run")) {
    for (const u of urls.slice(0, 20)) say(`    ${u}`);
    if (urls.length > 20) say(`    … and ${urls.length - 20} more`);
    return say(`  Dry run: nothing was sent.\n`);
  }
  const results = await submit({ site: site!, key: key!, urls });
  for (const r of results) say(`  Batch ${r.batch}: ${plural(r.urls, "page")} → ${r.status} ${r.meaning}`);
  if (results.some((r) => r.status === 403)) {
    say(`  A 403 usually means the engine has not verified the site: add ${site}/ in Bing Webmaster Tools with its own verification (an import from Google Search Console is not always enough).`);
  }
  if (results.some((r) => r.status >= 300)) fail("IndexNow did not accept every batch.");
  say();
}

/** Runs one command in `cwd` and returns the exit code. */
export async function main(
  argv: string[],
  cwd: string,
  streams: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
): Promise<number> {
  args = argv;
  root = cwd;
  io = streams;
  try {
    const command = args[0];
    if (command === "--version" || command === "-v") say(version());
    else if (command === undefined || command === "help" || command === "--help" || command === "-h") say(HELP);
    else if (command === "init") await init();
    else if (command === "build") await build();
    else if (command === "static") runStatic();
    else if (command === "indexnow") await runIndexNow();
    else fail(`Unknown command "${command}".\n\n${HELP}`);
    return 0;
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    io.err(`\n${error.message}\n\n`);
    return 1;
  }
}
