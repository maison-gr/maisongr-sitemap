import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { detect, readPackage } from "../build/detect.js";
import { buildNext, manifestPathOf, type BuildReport } from "../build/next-build.js";
import { COMMAND, withBuildStep } from "../build/scripts.js";
import { buildStatic } from "../build/static.js";
const HELP = `@maison-gr/sitemap

  maisongr-sitemap init              Detect the framework and set the sitemap up
  maisongr-sitemap build             Re-read routes, dates and theme (run before each build)
  maisongr-sitemap static <dir> --site <url>
                                     For sites with no server: write sitemap.xml and /sitemap/ into <dir>

  Options:  --offline   do not download fonts      --no-credit   (static) leave out the footer credit
`;

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

const routeFile = () => `// The sitemap: XML for search engines, a designed page for people, at one address.
// Routes, dates and theme come from ./manifest.json, which \`${COMMAND}\` rewrites before each build.
// Docs: https://github.com/maison-gr/sitemap
import { sitemap } from "@maison-gr/sitemap/next";
import manifest from "./manifest.json";

// The answer depends on the request's Sec-Fetch-Dest header, so the route stays dynamic.
export const dynamic = "force-dynamic";

export const GET = sitemap({
  manifest,
  // Dynamic routes are listed once you give their values, for example:
  // params: { "/blog/[slug]": async () => (await getPosts()).map((p) => ({ slug: p.slug, lastmod: p.updatedAt })) },
});
`;

function printReport(r: BuildReport) {
  say(`  ${r.routes} pages found, ${r.dated} dated from Git`);
  if (r.locales) say(`  Languages: ${r.locales.list.join(", ")} (x-default: ${r.locales.default})`);
  say(`  Site: ${r.site ?? "not found; the request's address is used (set SITEMAP_SITE_URL or pass site)"}`);
  say(`  Theme: ${r.theme.name} · ${r.theme.dark ? "light and dark" : "light only, as the site"} · fonts: ${r.theme.fonts.map((f) => `${f.family} (${f.role})`).join(", ") || "system"}`);
  if (r.missedFonts.length) say(`  Fonts not brought in (system fonts used instead): ${r.missedFonts.join(", ")}`);
  if (r.skipped.length) {
    say(`  Left out:`);
    for (const s of r.skipped) say(`    ${s.pattern}  ${s.reason}`);
  }
  if (r.needParams.length) {
    say(`  Dynamic routes, listed only once the route file gives their values (params):`);
    for (const p of r.needParams) say(`    ${p}`);
  }
}

/** Runs the build step before the site's own build, keeping the package.json's indentation. */
function addBuildStep(): string {
  const file = join(root, "package.json");
  const pkg = readPackage(root) ?? fail("No package.json here.");
  const { scripts, note } = withBuildStep(pkg.scripts);
  pkg.scripts = scripts;
  const indent = readFileSync(file, "utf8").match(/^\{\r?\n([ \t]+)/)?.[1] ?? "  ";
  writeFileSync(file, JSON.stringify(pkg, null, indent) + "\n");
  return note;
}

async function init() {
  const found = detect(root);
  if (found.kind === "unsupported") {
    fail(`${found.name} detected. Its adapter is not out yet; until then, build the site and run:\n  maisongr-sitemap static <build-dir> --site https://your.site`);
  }
  if (found.kind === "static") {
    fail(`A static site in ./${found.outDir}. Run:\n  maisongr-sitemap static ${found.outDir} --site https://your.site`);
  }
  if (found.kind !== "next") fail("No supported framework found here (Next.js, or a static build with index.html).");
  const next = found as Extract<typeof found, { kind: "next" }>;

  const appDir = next.appDir ?? (next.srcDir ? "src/app" : "app");
  for (const clash of ["sitemap.ts", "sitemap.js", "sitemap.tsx"]) {
    if (existsSync(join(root, appDir, clash))) fail(`${appDir}/${clash} already serves /sitemap.xml. Remove it first; this replaces it.`);
  }
  if (existsSync(join(root, "public", "sitemap.xml"))) fail("public/sitemap.xml would shadow the route. Remove it first; this replaces it.");

  const ts = existsSync(join(root, "tsconfig.json"));
  const route = join(root, appDir, "sitemap.xml", ts ? "route.ts" : "route.js");
  const other = join(root, appDir, "sitemap.xml", ts ? "route.js" : "route.ts");
  for (const f of [route, other]) {
    if (existsSync(f) && !readFileSync(f, "utf8").includes("@maison-gr/sitemap")) {
      fail(`${rel(f)} already exists and is not this package's. Move it aside first; nothing was changed.`);
    }
  }

  say(`\nNext.js ${next.version ?? ""} · App Router${next.pagesDir ? " + Pages Router" : ""}`);
  const report = await buildNext(root, next, { offline: flag("offline") });
  printReport(report);

  if (!existsSync(route)) {
    mkdirSync(dirname(route), { recursive: true });
    writeFileSync(route, routeFile());
  }
  say(`\n  Wrote  ${rel(route)}`);
  say(`  Wrote  ${rel(report.manifestPath)}  (commit it: shallow CI clones keep its dates)`);
  if (report.theme.fonts.length) say(`  Wrote  public/_sitemap/  (the page's fonts, served from your own domain)`);
  say(`  Build  ${addBuildStep()}`);

  const deps = { ...readPackage(root)?.dependencies };
  if (!deps["@maison-gr/sitemap"]) say(`\n  Next:  npm install @maison-gr/sitemap`);
  if (["middleware.ts", "middleware.js", "proxy.ts", "proxy.js", "src/middleware.ts", "src/proxy.ts"].some((f) => existsSync(join(root, f)))) {
    say(`  Check: your middleware must let /sitemap.xml and /_sitemap/ through untouched (no locale redirect).`);
  }
  say(`  Open http://localhost:3000/sitemap.xml in a browser: the page. curl it: the XML.\n`);
}

async function build() {
  const found = detect(root);
  if (found.kind !== "next") fail("`build` is for Next.js projects. For a static site use `maisongr-sitemap static <dir> --site <url>`.");
  const next = found as Extract<typeof found, { kind: "next" }>;
  const appDir = next.appDir ?? (next.srcDir ? "src/app" : "app");
  if (!existsSync(join(root, appDir, "sitemap.xml"))) fail("No sitemap route yet. Run `maisongr-sitemap init` first.");
  const report = await buildNext(root, next, { offline: flag("offline") });
  say(`@maison-gr/sitemap: ${report.routes} pages, ${report.dated} dated → ${rel(manifestPathOf(root, appDir))}`);
}

function runStatic() {
  const dir = args[1];
  const site = value("site") ?? process.env.SITEMAP_SITE_URL;
  if (!dir || !existsSync(join(root, dir))) fail("Usage: maisongr-sitemap static <build-dir> --site https://your.site");
  if (!site || !/^https?:\/\//.test(site)) fail("Give the address the site is served at: --site https://your.site");
  const report = buildStatic(join(root, dir!), site!, { credit: !flag("no-credit") });
  say(`\n  ${report.pages} pages · theme: ${report.theme.name}${report.theme.dark ? " (light and dark)" : ""}`);
  for (const s of report.skipped) say(`  Left out ${s.path}  ${s.reason}`);
  for (const f of report.written) say(`  Wrote ${dir}/${f}`);
  say(`\n  A static host cannot tell browsers from crawlers, so the designed page lives at /sitemap/ and /sitemap.xml is styled with CSS.\n`);
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
    if (command === "init") await init();
    else if (command === "build") await build();
    else if (command === "static") runStatic();
    else say(HELP);
    return 0;
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    io.err(`\n${error.message}\n\n`);
    return 1;
  }
}
